import { useTabBarInset } from '../../components/FloatingTabBar';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import {
  PressableScale,
  Screen,
  Segmented,
  Text,
  Divider,
  type IconName,
} from '../../components/ui';
import { formatPace, PACE_GUIDES } from '../../lib/metrics';
import { useSettings, useTheme, type Units } from '../../state/settings';
import { THEME_BY_ID } from '../../theme/palette';

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
  const themeDef = THEME_BY_ID[theme.themeId];

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
          <View
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
                backgroundColor: theme.accent,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="person" size={26} color={theme.onAccent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="heading">Alpha runner</Text>
              <Text variant="caption">Autumn Half Marathon · private alpha</Text>
            </View>
          </View>
        </View>

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
                  backgroundColor: theme.accent,
                  marginRight: 4,
                }}
              />
            }
          />
          <Row
            icon="resize"
            label="Units"
            last
            right={
              <Segmented<Units>
                value={settings.units}
                onChange={(units) => update({ units })}
                style={{ width: 112 }}
                options={[
                  { value: 'km', label: 'km' },
                  { value: 'mi', label: 'mi' },
                ]}
              />
            }
          />
        </Group>

        <Group title="Training">
          <Row
            icon="speedometer"
            label="Pace guides"
            value={`Threshold ${formatPace(PACE_GUIDES.threshold.max, settings.units)}`}
            onPress={() => router.push('/pace-guides')}
          />
          <Row
            icon="document-text"
            label="Plan brief"
            value="Confirmed"
            onPress={() => router.push('/lock-review')}
            last
          />
        </Group>

        <Group title="Coach">
          <Row
            icon="hammer"
            label="Show tool activity"
            right={
              <Switch
                value={settings.showActivity}
                onValueChange={(showActivity) => update({ showActivity })}
                trackColor={{ true: theme.accent, false: theme.colors.surfaceRaised }}
                thumbColor="#FFFFFF"
              />
            }
          />
          <Row
            icon="phone-portrait"
            label="Haptic feedback"
            last
            right={
              <Switch
                value={settings.haptics}
                onValueChange={(haptics) => update({ haptics })}
                trackColor={{ true: theme.accent, false: theme.colors.surfaceRaised }}
                thumbColor="#FFFFFF"
              />
            }
          />
        </Group>

        <View style={{ paddingHorizontal: 24, marginTop: 28, alignItems: 'center', gap: 4 }}>
          <Text variant="caption" color="muted">
            Askesis prototype · v0.1.0
          </Text>
          <Text variant="caption" color="muted" style={{ textAlign: 'center' }}>
            Demo data only — nothing here is synced to the API yet.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
