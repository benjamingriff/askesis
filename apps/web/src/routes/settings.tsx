import { useClerk, useUser } from '@clerk/react';
import {
  Check,
  FileCode2,
  Gauge,
  Library,
  LogOut,
  RotateCcw,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { initialsFor } from '../components/AppShell';
import { Button, ButtonLink, Card, Segmented, cx } from '../components/ui';
import { formatPace, formatPower, formatSwimPace } from '../lib/format';
import { usePerformance } from '../plan-data';
import { currentEntry, SYSTEM_META, SYSTEMS } from '../lib/sports';
import {
  useSettings,
  useUnits,
  type LoadUnits,
  type PoolUnits,
  type UnitPreference,
} from '../settings';
import {
  ACCENT_BY_ID,
  accentClash,
  accentFill,
  accentStops,
  ACCENTS,
  EFFORT_META,
  EFFORTS,
  isValidHex,
  luminance,
  normalizeHex,
  THEMES,
  type AccentOption,
  type ThemeDefinition,
} from '../theme/palette';

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
          '--swatch-border': theme.colors.border,
          '--swatch-accent': accentFill(accentStops(accent, theme.mode)),
        } as CSSProperties
      }
    >
      <span className="swatch-preview" aria-hidden="true">
        <i>
          {EFFORTS.map((effort) => (
            <em key={effort} style={{ background: EFFORT_META[effort][theme.mode] }} />
          ))}
        </i>
        <b />
      </span>
      <span>{theme.name}</span>
    </button>
  );
}

function AccentDot({
  accent,
  mode,
  selected,
  onSelect,
}: {
  accent: AccentOption;
  mode: 'dark' | 'light';
  selected: boolean;
  onSelect: () => void;
}) {
  const stops = accentStops(accent.id, mode);
  const onDot = Math.min(...stops.map(luminance)) > 0.3 ? '#0A0A0B' : '#FFFFFF';
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={accent.name}
      title={accent.name}
      className={cx('accent-dot', selected && 'selected')}
      style={{ '--dot': accentFill(stops), '--on-dot': onDot } as CSSProperties}
      onClick={onSelect}
    >
      {selected ? <Check size={14} aria-hidden="true" /> : null}
    </button>
  );
}

/** "You": account, appearance and display preferences. */
export function SettingsPage() {
  const { user } = useUser();
  const clerk = useClerk();
  const { settings, theme, update, reset } = useSettings();
  const units = useUnits();
  const performance = usePerformance().data;
  const { pool } = settings;
  /** The headline number of each calibrated system: threshold pace, FTP or CSS. */
  const fitness = SYSTEMS.flatMap((system) => {
    const threshold = currentEntry(performance, system)?.zones.find(
      (zone) => zone.key === 'threshold',
    );
    if (!threshold) return [];
    if (system === 'run_pace') return [`Threshold ${formatPace(threshold.target, units)}`];
    if (system === 'cycle_power') return [`FTP ${formatPower(threshold.target)}`];
    return [`CSS ${formatSwimPace(threshold.target, pool)}`];
  });
  const mode = theme.isDark ? 'dark' : 'light';
  const matchDevice = settings.mode === 'system';
  const preset = ACCENT_BY_ID[settings.accent];
  const [hex, setHex] = useState(preset ? '' : settings.accent);
  const clash = accentClash(hex);
  const displayName = user?.fullName ?? user?.firstName ?? 'Askesis athlete';
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const solids = ACCENTS.filter((accent) => accent.stops.length === 1);
  const blends = ACCENTS.filter((accent) => accent.stops.length > 1);
  const pickAccent = (accent: AccentOption) => {
    update({ accent: accent.id });
    setHex('');
  };
  /** Without Match device a swatch is the theme; with it, a swatch fills its own slot. */
  const pickTheme = (next: ThemeDefinition) =>
    update({
      [next.mode === 'dark' ? 'darkTheme' : 'lightTheme']: next.id,
      ...(matchDevice ? {} : { mode: next.mode }),
    });
  const themeSelected = (option: ThemeDefinition) =>
    matchDevice
      ? option.id === settings.darkTheme || option.id === settings.lightTheme
      : option.id === theme.themeId;

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

      <section className="settings-group" aria-labelledby="fitness-heading">
        <h2 id="fitness-heading" className="label">
          Fitness
        </h2>
        <Card>
          <Row
            label="Training zones"
            hint={
              fitness.length
                ? `${fitness.join(' · ')} · used by every plan`
                : `Add ${SYSTEMS.map((system) => SYSTEM_META[system].noun).join(', ')} for the sports you train. Every plan uses them.`
            }
          >
            <ButtonLink to="/performance" size="sm" icon={Gauge}>
              Performance
            </ButtonLink>
          </Row>
        </Card>
      </section>

      <section className="settings-group" aria-labelledby="appearance-heading" id="appearance">
        <h2 id="appearance-heading" className="label">
          Appearance
        </h2>
        <Card>
          <Row
            label="Theme"
            hint={
              matchDevice
                ? 'Pick one dark and one light theme; your device chooses between them.'
                : 'Choose any theme, dark or light.'
            }
          >
            <div className="theme-picker">
              {(['dark', 'light'] as const).map((group) => (
                <div className="swatch-group" key={group}>
                  <span className="label">{group === 'dark' ? 'Dark' : 'Light'}</span>
                  <div className="swatch-row">
                    {THEMES.filter((option) => option.mode === group).map((option) => (
                      <ThemeSwatch
                        key={option.id}
                        theme={option}
                        accent={settings.accent}
                        selected={themeSelected(option)}
                        onSelect={() => pickTheme(option)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Row>
          <Row
            label="Match device"
            hint="Switch between your dark and light theme with your device."
          >
            <label className="switch">
              <input
                type="checkbox"
                checked={matchDevice}
                onChange={(event) => update({ mode: event.target.checked ? 'system' : mode })}
              />
              <span aria-hidden="true" />
              <span className="sr-only">Match device</span>
            </label>
          </Row>
          <Row
            label="Accent"
            hint="The app’s own colour, for buttons and selection. Workout colours are kept for effort."
          >
            <div className="accent-picker">
              <div className="accent-row" role="radiogroup" aria-label="Accent colour">
                {solids.map((accent) => (
                  <AccentDot
                    key={accent.id}
                    accent={accent}
                    mode={mode}
                    selected={settings.accent === accent.id}
                    onSelect={() => pickAccent(accent)}
                  />
                ))}
                <span className="accent-divider" aria-hidden="true" />
                {blends.map((accent) => (
                  <AccentDot
                    key={accent.id}
                    accent={accent}
                    mode={mode}
                    selected={settings.accent === accent.id}
                    onSelect={() => pickAccent(accent)}
                  />
                ))}
                <form
                  className={cx('hex-input', !preset && 'selected')}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (isValidHex(hex)) update({ accent: normalizeHex(hex) });
                  }}
                >
                  <label>
                    <span className="sr-only">Custom accent hex</span>
                    <input
                      value={hex}
                      placeholder="#Custom"
                      maxLength={7}
                      onChange={(event) => setHex(event.target.value)}
                      onBlur={() => isValidHex(hex) && update({ accent: normalizeHex(hex) })}
                      aria-invalid={hex !== '' && !isValidHex(hex)}
                    />
                  </label>
                </form>
              </div>
              <small className="accent-name">
                {preset ? `${preset.name}${preset.stops.length > 1 ? ' · blend' : ''}` : 'Custom'}
              </small>
              {clash ? (
                <small className="accent-warning" role="status">
                  <TriangleAlert size={13} aria-hidden="true" /> Close to the{' '}
                  {EFFORT_META[clash].label.toLowerCase()} effort colour, so it may blend into your
                  workouts.
                </small>
              ) : null}
            </div>
          </Row>
          <Row
            label="Workout colours"
            hint="Colour shows effort, from recovery to max. Icons show the sport."
          >
            <div className="effort-key" aria-label="Effort colours, easiest to hardest">
              {EFFORTS.map((effort) => (
                <span key={effort} style={{ '--zone': EFFORT_META[effort][mode] } as CSSProperties}>
                  <i />
                  {EFFORT_META[effort].label}
                </span>
              ))}
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
          <Row label="Swimming" hint="Pool length for swim paces and distances.">
            <Segmented<PoolUnits>
              label="Pool units"
              value={settings.pool}
              onChange={(next) => update({ pool: next })}
              options={[
                { value: 'm', label: 'Metres' },
                { value: 'yd', label: 'Yards' },
              ]}
            />
          </Row>
          <Row label="Strength loads" hint="Units for suggested weights.">
            <Segmented<LoadUnits>
              label="Load units"
              value={settings.load}
              onChange={(load) => update({ load })}
              options={[
                { value: 'kg', label: 'kg' },
                { value: 'lb', label: 'lb' },
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
