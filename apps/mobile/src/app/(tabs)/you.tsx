import { useClerk, useUser } from '@clerk/expo';
import { useTabBarInset } from '../../components/FloatingTabBar';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, Switch, View } from 'react-native';
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
import { useInAppCoach } from '../../data/account';
import { useActivePlans } from '../../data/plan-data';
import { apiBaseUrl } from '../../lib/config';
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

function Group({ title, children }: { title?: string; children: ReactNode }) {
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
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  onPress,
  right,
  last,
  tint,
}: {
  icon: IconName;
  label: string;
  value?: string;
  onPress?: () => void;
  right?: ReactNode;
  last?: boolean;
  tint?: string;
}) {
  const theme = useTheme();
  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 16,
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
        <Ionicons name={icon} size={17} color={tint ?? theme.colors.text} />
      </View>
      <Text variant="subheading" style={{ flex: 1, fontWeight: '500' }}>
        {label}
      </Text>
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
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const themeDef = THEME_BY_ID[theme.themeId];
  const email = user?.primaryEmailAddress?.emailAddress;
  const name = user?.fullName || user?.firstName || email?.split('@')[0] || 'Athlete';
  const switchRow = (value: boolean, onValueChange: (value: boolean) => void) => (
    <Switch
      value={value}
      onValueChange={onValueChange}
      trackColor={{ true: theme.accent, false: theme.colors.surfaceRaised }}
      thumbColor="#FFFFFF"
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
                {email ?? 'Signed in'}
              </Text>
              {plans.data?.length ? (
                <Text variant="caption" color="muted" numberOfLines={1}>
                  {plans.data.map((plan) => plan.displayName).join(' · ')}
                </Text>
              ) : null}
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

        <Group title="Units">
          <Row
            icon="resize"
            label="Distance"
            right={
              <Segmented<UnitPreference>
                value={settings.units}
                onChange={(units) => update({ units })}
                style={{ width: 150 }}
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
                style={{ width: 112 }}
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
                style={{ width: 112 }}
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
            Askesis · v0.1.0
          </Text>
          <Text variant="caption" color="muted" style={{ textAlign: 'center' }}>
            {apiBaseUrl() ? `API ${apiBaseUrl()}` : 'API on this origin'}
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
