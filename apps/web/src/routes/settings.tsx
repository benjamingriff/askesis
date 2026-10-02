import { useClerk, useUser } from '@clerk/react';
import {
  Check,
  FileCode2,
  Library,
  LogOut,
  Monitor,
  Moon,
  RotateCcw,
  Sun,
  UserRound,
} from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { initialsFor } from '../components/AppShell';
import { Button, ButtonLink, Card, Segmented, cx } from '../components/ui';
import { useSettings, type ThemeMode, type UnitPreference } from '../settings';
import { ACCENTS, isValidHex, normalizeHex, THEMES, type ThemeDefinition } from '../theme/palette';

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div>
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function ThemeSwatch({
  theme,
  selected,
  accent,
  onSelect,
}: {
  theme: ThemeDefinition;
  selected: boolean;
  accent: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cx('theme-swatch', selected && 'selected')}
      aria-pressed={selected}
      onClick={onSelect}
      style={
        {
          '--swatch-bg': theme.colors.bg,
          '--swatch-surface': theme.colors.surface,
          '--swatch-text': theme.colors.text,
          '--swatch-accent': accent,
        } as CSSProperties
      }
    >
      <span className="swatch-preview" aria-hidden="true">
        <i />
        <b />
      </span>
      <span>{theme.name}</span>
    </button>
  );
}

/** "You": account, appearance and display preferences. */
export function SettingsPage() {
  const { user } = useUser();
  const clerk = useClerk();
  const { settings, update, reset } = useSettings();
  const [hex, setHex] = useState(settings.accent);
  const displayName = user?.fullName ?? user?.firstName ?? 'Askesis athlete';
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const customAccent = !ACCENTS.some(
    (a) => a.color.toUpperCase() === settings.accent.toUpperCase(),
  );

  return (
    <div className="page settings-page">
      <header className="page-header">
        <div className="page-heading">
          <span className="label">Account</span>
          <h1>You</h1>
        </div>
      </header>

      <Card className="profile-card" aria-label="Profile">
        {user?.hasImage ? (
          <img className="large-avatar" src={user.imageUrl} alt="" />
        ) : (
          <span className="large-avatar">{initialsFor(displayName)}</span>
        )}
        <div>
          <strong>{displayName}</strong>
          <small>{email || 'Personal account'}</small>
        </div>
        <Button icon={UserRound} onClick={() => clerk.openUserProfile()}>
          Manage account
        </Button>
      </Card>

      <section className="settings-group" aria-labelledby="appearance-heading" id="appearance">
        <h2 id="appearance-heading" className="label">
          Appearance
        </h2>
        <Card>
          <Row label="Mode" hint="Follow your device, or always use dark or light.">
            <Segmented<ThemeMode>
              label="Colour mode"
              value={settings.mode}
              onChange={(mode) => update({ mode })}
              options={[
                { value: 'system', label: 'System', icon: Monitor },
                { value: 'dark', label: 'Dark', icon: Moon },
                { value: 'light', label: 'Light', icon: Sun },
              ]}
            />
          </Row>
          <Row label="Dark theme">
            <div className="swatch-row">
              {THEMES.filter((t) => t.mode === 'dark').map((theme) => (
                <ThemeSwatch
                  key={theme.id}
                  theme={theme}
                  accent={settings.accent}
                  selected={settings.darkTheme === theme.id}
                  onSelect={() =>
                    update({
                      darkTheme: theme.id,
                      mode: settings.mode === 'light' ? 'dark' : settings.mode,
                    })
                  }
                />
              ))}
            </div>
          </Row>
          <Row label="Light theme">
            <div className="swatch-row">
              {THEMES.filter((t) => t.mode === 'light').map((theme) => (
                <ThemeSwatch
                  key={theme.id}
                  theme={theme}
                  accent={settings.accent}
                  selected={settings.lightTheme === theme.id}
                  onSelect={() =>
                    update({
                      lightTheme: theme.id,
                      mode: settings.mode === 'dark' ? 'light' : settings.mode,
                    })
                  }
                />
              ))}
            </div>
          </Row>
          <Row label="Accent" hint="Text using the accent is adjusted automatically for contrast.">
            <div className="accent-row" role="radiogroup" aria-label="Accent colour">
              {ACCENTS.map((accent) => {
                const selected = accent.color.toUpperCase() === settings.accent.toUpperCase();
                return (
                  <button
                    key={accent.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={accent.name}
                    title={accent.name}
                    className={cx('accent-dot', selected && 'selected')}
                    style={{ '--dot': accent.color } as CSSProperties}
                    onClick={() => {
                      update({ accent: accent.color });
                      setHex(accent.color);
                    }}
                  >
                    {selected ? <Check size={14} aria-hidden="true" /> : null}
                  </button>
                );
              })}
              <form
                className={cx('hex-input', customAccent && 'selected')}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (isValidHex(hex)) update({ accent: normalizeHex(hex) });
                }}
              >
                <label>
                  <span className="sr-only">Custom accent hex</span>
                  <input
                    value={hex}
                    maxLength={7}
                    onChange={(event) => setHex(event.target.value)}
                    onBlur={() => isValidHex(hex) && update({ accent: normalizeHex(hex) })}
                    aria-invalid={!isValidHex(hex)}
                  />
                </label>
              </form>
            </div>
          </Row>
        </Card>
      </section>

      <section className="settings-group" aria-labelledby="training-heading">
        <h2 id="training-heading" className="label">
          Training display
        </h2>
        <Card>
          <Row label="Units" hint="Plan default uses the units chosen in each plan’s brief.">
            <Segmented<UnitPreference>
              label="Display units"
              value={settings.units}
              onChange={(units) => update({ units })}
              options={[
                { value: 'plan', label: 'Plan default' },
                { value: 'km', label: 'km' },
                { value: 'mi', label: 'mi' },
              ]}
            />
          </Row>
          <Row label="Show coach activity" hint="List the steps your coach took during each reply.">
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.showActivity}
                onChange={(event) => update({ showActivity: event.target.checked })}
              />
              <span aria-hidden="true" />
              <span className="sr-only">Show coach activity</span>
            </label>
          </Row>
        </Card>
      </section>

      <section className="settings-group" aria-labelledby="more-heading">
        <h2 id="more-heading" className="label">
          More
        </h2>
        <Card className="settings-links">
          <ButtonLink to="/plans" variant="plain" icon={Library}>
            All plans
          </ButtonLink>
          {import.meta.env.DEV ? (
            <a className="btn btn-plain btn-md" href="/api/docs">
              <FileCode2 size={17} aria-hidden="true" /> API docs (development)
            </a>
          ) : null}
          <Button variant="plain" icon={RotateCcw} onClick={reset}>
            Reset appearance
          </Button>
          <Button
            variant="plain"
            icon={LogOut}
            className="danger-text"
            onClick={() => void clerk.signOut({ redirectUrl: '/sign-in' })}
          >
            Sign out
          </Button>
        </Card>
      </section>
    </div>
  );
}
