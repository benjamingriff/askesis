import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import {
  Button,
  IconButton,
  PressableScale,
  Screen,
  Segmented,
  Text,
  useHaptics,
} from '../components/ui';
import { buildTheme, useSettings, type ThemeMode } from '../state/settings';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ACCENT_BY_ID,
  accentClash,
  accentStops,
  EFFORT_META,
  EFFORTS,
  isValidHex,
  normalizeHex,
  ACCENTS,
  THEMES,
  type ThemeDefinition,
} from '../theme/palette';
import { useColorScheme } from 'react-native';

/** A little phone-shaped preview that renders with an arbitrary theme + accent. */
function Preview() {
  const { theme } = useSettings();
  return (
    <View
      style={{
        borderRadius: 28,
        padding: 14,
        backgroundColor: theme.colors.bg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="heading">Today</Text>
        <View
          style={{
            paddingHorizontal: 10,
            height: 24,
            borderRadius: 12,
            backgroundColor: theme.accentSoft,
            justifyContent: 'center',
          }}
        >
          <Text variant="caption" color="accent" style={{ fontWeight: '800', fontSize: 11.5 }}>
            Week 2
          </Text>
        </View>
      </View>
      <View
        style={{
          borderRadius: 18,
          padding: 14,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        <Text variant="label" style={{ color: theme.efforts.threshold }}>
          Threshold
        </Text>
        <Text variant="subheading" style={{ marginTop: 2 }}>
          2 × 10 min threshold
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 2,
            height: 30,
            marginTop: 10,
          }}
        >
          {[0.4, 0.4, 0.72, 0.72, 0.22, 0.72, 0.72, 0.4].map((h, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: 30 * h,
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
                backgroundColor:
                  h > 0.6
                    ? theme.efforts.threshold
                    : h < 0.3
                      ? theme.efforts.recovery
                      : theme.efforts.easy,
              }}
            />
          ))}
        </View>
      </View>
      {/* The log buttons on Today's card: Done filled with the accent, Changed it and Skip neutral. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {(
          [
            ['checkmark', 'Done', true],
            ['pencil', 'Changed it', false],
            ['close', 'Skip', false],
          ] as const
        ).map(([icon, label, main]) => (
          <View
            key={label}
            style={{
              flex: 1,
              height: 36,
              borderRadius: 12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              overflow: 'hidden',
              backgroundColor: main ? theme.accent : theme.colors.surfaceRaised,
            }}
          >
            {main && theme.accentStops.length > 1 ? (
              <LinearGradient
                pointerEvents="none"
                colors={theme.accentStops as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <Ionicons name={icon} size={13} color={main ? theme.onAccent : theme.colors.textDim} />
            <Text
              variant="caption"
              numberOfLines={1}
              style={{
                fontWeight: '800',
                fontSize: 12,
                color: main ? theme.onAccent : theme.colors.text,
              }}
            >
              {label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ThemeSwatch({
  def,
  selected,
  onPress,
}: {
  def: ThemeDefinition;
  selected: boolean;
  onPress: () => void;
}) {
  const { theme } = useSettings();
  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={`${def.name} theme`}
      accessibilityState={{ selected }}
      style={{ width: '47.5%' }}
    >
      <View
        style={{
          height: 76,
          borderRadius: 18,
          backgroundColor: def.colors.bg,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? theme.accentText : def.colors.border,
          padding: 10,
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <View
            style={{ flex: 1, height: 22, borderRadius: 7, backgroundColor: def.colors.surface }}
          />
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: theme.accent,
              borderWidth: def.mode === 'light' ? 1 : 0,
              borderColor: 'rgba(0,0,0,0.25)',
            }}
          />
        </View>
        <View
          style={{ height: 6, width: '60%', borderRadius: 3, backgroundColor: def.colors.textDim }}
        />
      </View>
      <Text
        variant="caption"
        color={selected ? 'text' : 'dim'}
        style={{ marginTop: 6, textAlign: 'center', fontWeight: selected ? '800' : '600' }}
      >
        {def.name}
      </Text>
    </PressableScale>
  );
}

export default function AppearanceScreen() {
  const { settings, theme, update, reset } = useSettings();
  const buzz = useHaptics();
  const system = useColorScheme() === 'light' ? 'light' : 'dark';
  const [hex, setHex] = useState('');
  const customActive = !ACCENT_BY_ID[settings.accent];
  const hexValid = isValidHex(hex);
  const clash = hexValid ? accentClash(hex) : null;

  const pickTheme = (def: ThemeDefinition) => {
    update(
      def.mode === 'dark'
        ? { darkTheme: def.id, mode: settings.mode === 'system' ? 'system' : 'dark' }
        : { lightTheme: def.id, mode: settings.mode === 'system' ? 'system' : 'light' },
    );
  };

  return (
    <Screen>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 6,
          gap: 4,
        }}
      >
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <Text variant="heading" style={{ flex: 1 }}>
          Appearance
        </Text>
        <PressableScale
          onPress={() => {
            buzz('warning');
            reset();
          }}
          accessibilityRole="button"
          style={{ paddingHorizontal: 12, height: 32, justifyContent: 'center' }}
        >
          <Text variant="caption" color="accent" style={{ fontWeight: '800' }}>
            Reset
          </Text>
        </PressableScale>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Preview />

        <Text variant="label" style={{ marginTop: 28, marginBottom: 10 }}>
          Mode
        </Text>
        <Segmented<ThemeMode>
          value={settings.mode}
          onChange={(mode) => update({ mode })}
          options={[
            { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
            { value: 'dark', label: 'Dark', icon: 'moon' },
            { value: 'light', label: 'Light', icon: 'sunny' },
          ]}
        />
        {settings.mode === 'system' ? (
          <Text variant="caption" color="muted" style={{ marginTop: 8 }}>
            Following your phone: currently {system}. Pick a favourite for each mode below.
          </Text>
        ) : null}

        {/* Grouped by mode: picking a theme also picks its mode, unless Mode follows the system. */}
        {(['dark', 'light'] as const).map((mode) => (
          <View key={mode}>
            <Text
              variant="label"
              style={{ marginTop: mode === 'dark' ? 28 : 18, marginBottom: 12 }}
            >
              {mode === 'dark' ? 'Dark themes' : 'Light themes'}
            </Text>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                rowGap: 14,
              }}
            >
              {THEMES.filter((def) => def.mode === mode).map((def) => (
                <ThemeSwatch
                  key={def.id}
                  def={def}
                  selected={
                    settings.mode === 'system'
                      ? def.id === settings.darkTheme || def.id === settings.lightTheme
                      : def.id === theme.themeId
                  }
                  onPress={() => pickTheme(def)}
                />
              ))}
            </View>
          </View>
        ))}

        <Text variant="label" style={{ marginTop: 28, marginBottom: 12 }}>
          Accent colour
        </Text>
        {/* Four equal columns, so the two rows line up. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 }}>
          {ACCENTS.map((a) => {
            const selected = a.id === settings.accent;
            const stops = accentStops(a.id, theme.isDark ? 'dark' : 'light');
            return (
              <PressableScale
                key={a.id}
                haptic="select"
                onPress={() => update({ accent: a.id })}
                accessibilityRole="button"
                accessibilityLabel={`${a.name} accent`}
                accessibilityState={{ selected }}
                style={{ alignItems: 'center', gap: 6, width: '25%' }}
              >
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    backgroundColor: stops[0],
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 3,
                    borderColor: selected ? theme.colors.text : 'transparent',
                    overflow: 'hidden',
                  }}
                >
                  {stops.length > 1 ? (
                    <LinearGradient
                      colors={stops as [string, string]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={{ position: 'absolute', inset: 0 }}
                    />
                  ) : null}
                  {selected ? (
                    <Ionicons
                      name="checkmark"
                      size={22}
                      color={buildTheme({ ...settings, accent: a.id }, system).onAccent}
                    />
                  ) : null}
                </View>
                <Text
                  variant="caption"
                  style={{ fontSize: 12, fontWeight: selected ? '800' : '600' }}
                  color={selected ? 'text' : 'dim'}
                >
                  {a.name}
                </Text>
              </PressableScale>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22 }}>
          <View
            style={{
              flex: 1,
              height: 48,
              borderRadius: 16,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 14,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: customActive ? theme.accent : theme.colors.border,
            }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: hexValid
                  ? normalizeHex(hex)
                  : customActive
                    ? theme.accent
                    : theme.colors.surfaceRaised,
              }}
            />
            <TextInput
              value={hex}
              onChangeText={setHex}
              placeholder={customActive ? settings.accent : 'Custom hex, e.g. #FF8A00'}
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={7}
              style={{
                flex: 1,
                fontSize: 16,
                color: theme.colors.text,
                ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
              }}
            />
          </View>
          <Button
            label="Apply"
            size="md"
            // Neutral until a valid colour is typed: a pale accent fill looks enabled.
            variant={hexValid ? 'primary' : 'secondary'}
            disabled={!hexValid}
            onPress={() => {
              update({ accent: normalizeHex(hex) });
              setHex('');
            }}
          />
        </View>
        {clash ? (
          <Text variant="caption" style={{ marginTop: 8, color: theme.warning }}>
            This is close to the {EFFORT_META[clash].label.toLowerCase()} effort colour, so workouts
            and controls may be hard to tell apart.
          </Text>
        ) : null}

        <Text variant="label" style={{ marginTop: 28, marginBottom: 6 }}>
          Workout colours
        </Text>
        <Text variant="caption" style={{ marginBottom: 12 }}>
          Colour shows effort, from recovery to max. Icons show the sport. Workout colours stay the
          same whatever accent you choose.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 4 }}>
          {EFFORTS.map((effort) => (
            <View
              key={effort}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: 4,
                width: '33.3%',
              }}
            >
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: theme.efforts[effort],
                }}
              />
              <Text variant="caption" color="text" style={{ fontWeight: '700' }}>
                {EFFORT_META[effort].label}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
