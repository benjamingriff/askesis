import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View, Platform } from 'react-native';
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
import { ACCENTS, isValidHex, normalizeHex, THEMES, type ThemeDefinition } from '../theme/palette';
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
            Week 5 of 12
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
        <Text variant="label" style={{ color: '#FBBF24' }}>
          Tempo
        </Text>
        <Text variant="subheading" style={{ marginTop: 2 }}>
          2 × 10 min tempo
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
                backgroundColor: h > 0.6 ? '#FBBF24' : h < 0.3 ? '#7DD3FC' : '#34D399',
              }}
            />
          ))}
        </View>
      </View>
      <View
        style={{
          alignSelf: 'flex-end',
          borderRadius: 18,
          borderBottomRightRadius: 6,
          paddingHorizontal: 14,
          paddingVertical: 8,
          backgroundColor: theme.colors.surfaceRaised,
        }}
      >
        <Text variant="body" style={{ fontSize: 14 }}>
          Make Thursday easier
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View
          style={{
            flex: 1,
            height: 40,
            borderRadius: 20,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            justifyContent: 'center',
            paddingHorizontal: 14,
          }}
        >
          <Text variant="caption" color="muted">
            Ask your coach…
          </Text>
        </View>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: theme.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="arrow-up" size={20} color={theme.onAccent} />
        </View>
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
      style={{ width: '30%' }}
    >
      <View
        style={{
          height: 76,
          borderRadius: 18,
          backgroundColor: def.colors.bg,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? theme.accent : def.colors.border,
          padding: 10,
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <View
            style={{ flex: 1, height: 22, borderRadius: 7, backgroundColor: def.colors.surface }}
          />
          <View
            style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: theme.accent }}
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
  const customActive = !ACCENTS.some(
    (a) => a.color.toLowerCase() === settings.accent.toLowerCase(),
  );
  const hexValid = isValidHex(hex);

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

        <Text variant="label" style={{ marginTop: 28, marginBottom: 12 }}>
          Theme
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, rowGap: 14 }}>
          {THEMES.map((def) => (
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

        <Text variant="label" style={{ marginTop: 28, marginBottom: 12 }}>
          Accent colour
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          {ACCENTS.map((a) => {
            const selected = a.color.toLowerCase() === settings.accent.toLowerCase();
            return (
              <PressableScale
                key={a.id}
                haptic="select"
                onPress={() => update({ accent: a.color })}
                accessibilityRole="button"
                accessibilityLabel={`${a.name} accent`}
                accessibilityState={{ selected }}
                style={{ alignItems: 'center', gap: 6, width: 64 }}
              >
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    backgroundColor: a.color,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 3,
                    borderColor: selected ? theme.colors.text : 'transparent',
                  }}
                >
                  {selected ? (
                    <Ionicons
                      name="checkmark"
                      size={22}
                      color={buildTheme({ ...settings, accent: a.color }, system).onAccent}
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
                    ? settings.accent
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
            disabled={!hexValid}
            onPress={() => {
              update({ accent: normalizeHex(hex) });
              setHex('');
            }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
