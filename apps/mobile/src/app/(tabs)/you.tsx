import { useClerk, useUser } from '@clerk/expo';
import { useTabBarInset } from '../../components/FloatingTabBar';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Platform, ScrollView, Switch, View } from 'react-native';
import {
  AccentFill,
  Button,
  ErrorState,
  PressableScale,
  Screen,
  Segmented,
  Text,
  Divider,
  type IconName,
} from '../../components/ui';
import { BottomSheet } from '../../components/BottomSheet';
import { StravaConnection } from '../../components/Strava';
import { Field } from '../../components/forms';
import {
  ACCOUNT_GRACE_DAYS,
  useAccountDeletion,
  useCoachWord,
  useDataExport,
  useInAppCoach,
} from '../../data/account';
import { useIntegrations } from '../../data/activities';
import { useActivePlans } from '../../data/plan-data';
import { apiBaseUrl } from '../../lib/config';
import { shortEmail } from '../../lib/format';
import {
  useSettings,
  useTheme,
  type LoadUnits,
  type PoolUnits,
  type UnitPreference,
} from '../../state/settings';
import { THEME_BY_ID } from '../../theme/palette';

/** "Local Verification" → "LV"; one word → its first letter. */
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    (words[0]?.[0] ?? '') + (words.length > 1 ? (words.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

/** A settings card. `note` is a caption beneath it that explains one of its rows. */
function Group({ title, note, children }: { title?: string; note?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ marginTop: 24, paddingHorizontal: 20 }}>
      {title ? (
        <Text variant="label" style={{ marginBottom: 8, marginLeft: 4 }}>
          {title}
        </Text>
      ) : null}
      <View
        style={{
          borderRadius: 22,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
      {note ? (
        <Text variant="caption" color="muted" style={{ marginTop: 8, marginHorizontal: 4 }}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

function Row({
  icon,
  label,
  hint,
  value,
  onPress,
  right,
  last,
  tint,
  danger,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  value?: string;
  onPress?: () => void;
  right?: ReactNode;
  last?: boolean;
  tint?: string;
  danger?: boolean;
}) {
  const theme = useTheme();
  const iconColor = danger ? theme.danger : (tint ?? theme.colors.text);
  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 16,
        paddingVertical: hint ? 12 : 0,
        minHeight: 56,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          backgroundColor: theme.colors.surfaceRaised,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={17} color={iconColor} />
      </View>
      <View style={{ flex: 1, minWidth: 72 }}>
        <Text
          variant="subheading"
          numberOfLines={1}
          style={{ fontWeight: '600', color: danger ? theme.danger : theme.colors.text }}
        >
          {label}
        </Text>
        {hint ? (
          <Text variant="caption" style={{ marginTop: 2 }}>
            {hint}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="caption" numeric>
          {value}
        </Text>
      ) : null}
      {right}
      {onPress ? (
        <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
      ) : null}
    </View>
  );
  return (
    <>
      {onPress ? (
        <PressableScale
          onPress={onPress}
          scaleTo={0.99}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          {content}
        </PressableScale>
      ) : (
        content
      )}
      {!last ? <Divider inset={62} /> : null}
    </>
  );
}

export default function YouScreen() {
  const tabInset = useTabBarInset();
  const theme = useTheme();
  const { settings, update } = useSettings();
  const coach = useInAppCoach();
  const { user } = useUser();
  const { signOut } = useClerk();
  const plans = useActivePlans();
  const integrations = useIntegrations();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const download = useDataExport();
  const themeDef = THEME_BY_ID[theme.themeId];
  const email = user?.primaryEmailAddress?.emailAddress;
  const name = user?.fullName || user?.firstName || email?.split('@')[0] || 'Athlete';
  const switchRow = (value: boolean, onValueChange: (value: boolean) => void) => (
    <Switch
      value={value}
      onValueChange={onValueChange}
      trackColor={{
        true: theme.isDark ? theme.accent : theme.accentText,
        false: theme.colors.surfaceRaised,
      }}
      thumbColor="#FFFFFF"
      // react-native-web colours the "on" thumb teal unless told otherwise.
      {...(Platform.OS === 'web' ? { activeThumbColor: '#FFFFFF' } : {})}
    />
  );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: tabInset }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
          <Text variant="title">You</Text>
        </View>

        <View style={{ paddingHorizontal: 20, marginTop: 18 }}>
          <PressableScale
            onPress={() => router.push('/account')}
            accessibilityRole="button"
            accessibilityLabel="Manage account"
            scaleTo={0.985}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              padding: 16,
              borderRadius: 24,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              <AccentFill />
              <Text variant="heading" style={{ color: theme.onAccent }}>
                {initials(name)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="heading" numberOfLines={1}>
                {name}
              </Text>
              <Text variant="caption" numberOfLines={1}>
                {email ? shortEmail(email) : 'Signed in'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
          </PressableScale>
        </View>

        <Group title="Training">
          <Row
            icon="speedometer"
            label="Performance & zones"
            onPress={() => router.push('/performance')}
          />
          <Row
            icon="library-outline"
            label="All plans"
            value={plans.data ? `${plans.data.length} active` : undefined}
            onPress={() => router.push('/plans')}
            last
          />
        </Group>

        {/* Strava only appears where this server can connect it (or a connection remains). */}
        {integrations.data &&
        !integrations.data.strava.available &&
        !integrations.data.strava.connection ? null : (
          <Group title="Connections">
            <StravaConnection />
          </Group>
        )}

        <Group title="Look & feel">
          <Row
            icon="color-palette"
            label="Appearance"
            tint={theme.accentText}
            value={themeDef.name}
            onPress={() => router.push('/appearance')}
            right={
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  overflow: 'hidden',
                  marginRight: 4,
                }}
              >
                <AccentFill />
              </View>
            }
            last
          />
        </Group>

        <Group title="Units" note="Distance “Plan” shows each plan in the unit it was written in.">
          <Row
            icon="resize"
            label="Distance"
            right={
              <Segmented<UnitPreference>
                value={settings.units}
                onChange={(units) => update({ units })}
                style={{ width: 190 }}
                options={[
                  { value: 'plan', label: 'Plan' },
                  { value: 'km', label: 'km' },
                  { value: 'mi', label: 'mi' },
                ]}
              />
            }
          />
          <Row
            icon="water-outline"
            label="Pool"
            right={
              <Segmented<PoolUnits>
                value={settings.pool}
                onChange={(pool) => update({ pool })}
                style={{ width: 190 }}
                options={[
                  { value: 'm', label: 'm' },
                  { value: 'yd', label: 'yd' },
                ]}
              />
            }
          />
          <Row
            icon="barbell-outline"
            label="Loads"
            last
            right={
              <Segmented<LoadUnits>
                value={settings.load}
                onChange={(load) => update({ load })}
                style={{ width: 190 }}
                options={[
                  { value: 'kg', label: 'kg' },
                  { value: 'lb', label: 'lb' },
                ]}
              />
            }
          />
        </Group>

        <Group title={coach ? 'Coach' : 'General'}>
          {coach ? (
            <Row
              icon="hammer"
              label="Show tool activity"
              right={switchRow(settings.showActivity, (showActivity) => update({ showActivity }))}
            />
          ) : null}
          <Row
            icon="phone-portrait"
            label="Haptic feedback"
            last
            right={switchRow(settings.haptics, (haptics) => update({ haptics }))}
          />
        </Group>

        <Group title="Your data">
          <Row
            icon="download-outline"
            label="Download my data"
            hint={
              coach
                ? 'Plans, coach conversations, training log, check-ins and fitness history as one JSON file.'
                : 'Plans, training log, check-ins and fitness history as one JSON file.'
            }
            value={download.isPending ? 'Preparing…' : undefined}
            onPress={download.isPending ? undefined : () => download.mutate()}
          />
          <Row
            icon="trash-outline"
            label="Delete account…"
            danger
            hint={`Permanently deletes everything after ${ACCOUNT_GRACE_DAYS} days. You can cancel until then.`}
            onPress={() => setDeleting(true)}
            last
          />
        </Group>
        {download.error ? (
          <ErrorState
            message={download.error.message}
            style={{ marginHorizontal: 20, marginTop: 10 }}
          />
        ) : null}

        <View style={{ paddingHorizontal: 20, marginTop: 24, gap: 10 }}>
          {error ? <ErrorState message={error} /> : null}
          <Button
            label="Sign out"
            icon="log-out-outline"
            variant="ghost"
            busy={signingOut}
            onPress={() => {
              setSigningOut(true);
              setError(null);
              signOut().catch((caught: unknown) => {
                setSigningOut(false);
                setError(caught instanceof Error ? caught.message : 'Sign-out failed.');
              });
            }}
          />
        </View>

        <View style={{ paddingHorizontal: 24, marginTop: 20, alignItems: 'center', gap: 4 }}>
          <Text variant="caption" color="muted">
            Waddle · v0.1.0
          </Text>
          {apiBaseUrl() ? (
            <Text variant="caption" color="muted" style={{ textAlign: 'center' }}>
              {`API ${apiBaseUrl()}`}
            </Text>
          ) : null}
        </View>
      </ScrollView>
      {/* Outside the ScrollView: touches follow the React tree, and that ScrollView would take the
          first tap to dismiss the keyboard instead of pressing Delete. */}
      <DeleteAccountSheet visible={deleting} onClose={() => setDeleting(false)} />
    </Screen>
  );
}

const CONFIRMATION = 'DELETE';

/** Schedules deletion after the grace period; the app is replaced by its countdown. */
function DeleteAccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const coach = useCoachWord();
  const [typed, setTyped] = useState('');
  const { request } = useAccountDeletion();
  const close = () => {
    if (request.isPending) return;
    setTyped('');
    request.reset();
    onClose();
  };
  return (
    <BottomSheet visible={visible} onClose={close} title="Delete your account?">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
        <Text variant="body" color="dim">
          Every plan, coach conversation, training log entry, check-in and fitness result will be
          permanently deleted, along with your sign-in. Your {coach} stops straight away.
        </Text>
        <Text variant="body" color="dim">
          You have {ACCOUNT_GRACE_DAYS} days to change your mind by signing in again. After that it
          can’t be undone. Download your data first if you want a copy.
        </Text>
        <Field
          label={`Type ${CONFIRMATION} to confirm`}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="characters"
          disabled={request.isPending}
        />
        {request.error ? <ErrorState message={request.error.message} /> : null}
        <View style={{ gap: 10, marginTop: 8 }}>
          <Button
            label="Delete account"
            icon="trash"
            variant="danger"
            busy={request.isPending}
            disabled={request.isPending || typed.trim() !== CONFIRMATION}
            onPress={() => request.mutate()}
          />
          <Button label="Cancel" variant="ghost" disabled={request.isPending} onPress={close} />
        </View>
      </ScrollView>
    </BottomSheet>
  );
}
