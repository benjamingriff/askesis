import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SUGGESTIONS } from '../../lib/coach-sim';
import { useTheme } from '../../state/settings';
import { PressableScale, Text, useHaptics } from '../ui';

export function Composer({
  running,
  onSend,
  onStop,
  initialText,
  placeholder,
  keyboardOpen,
}: {
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  initialText?: string;
  placeholder: string;
  keyboardOpen: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const buzz = useHaptics();
  const [text, setText] = useState(initialText ?? '');
  const canSend = text.trim().length > 0 && !running;

  useEffect(() => {
    if (initialText) setText(initialText);
  }, [initialText]);

  const submit = () => {
    if (!canSend) return;
    buzz('light');
    onSend(text);
    setText('');
  };

  return (
    <View
      style={{
        paddingBottom: keyboardOpen ? 8 : Math.max(insets.bottom, 10),
        backgroundColor: theme.colors.bg,
      }}
    >
      {!running && text.length === 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 10 }}
        >
          {SUGGESTIONS.map((s) => (
            <PressableScale
              key={s}
              haptic="select"
              onPress={() => setText(s)}
              accessibilityRole="button"
              style={{
                height: 34,
                paddingHorizontal: 14,
                borderRadius: 17,
                justifyContent: 'center',
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Text variant="caption" color="text" style={{ fontWeight: '600' }}>
                {s}
              </Text>
            </PressableScale>
          ))}
        </ScrollView>
      ) : null}
      <View
        style={{
          marginHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 8,
          padding: 6,
          paddingLeft: 16,
          borderRadius: 26,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          multiline
          editable={!running}
          onSubmitEditing={Platform.OS === 'web' ? submit : undefined}
          style={{
            flex: 1,
            maxHeight: 120,
            minHeight: 36,
            paddingTop: Platform.OS === 'ios' ? 9 : 6,
            paddingBottom: Platform.OS === 'ios' ? 9 : 6,
            fontSize: 16,
            color: theme.colors.text,
            ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
          }}
        />
        {running ? (
          <Pressable
            onPress={() => {
              buzz('warning');
              onStop();
            }}
            accessibilityRole="button"
            accessibilityLabel="Stop"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: theme.colors.text,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: theme.colors.bg }}
            />
          </Pressable>
        ) : (
          <Pressable
            onPress={submit}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: canSend ? theme.accent : theme.colors.surfaceRaised,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name="arrow-up"
              size={20}
              color={canSend ? theme.onAccent : theme.colors.textMuted}
            />
          </Pressable>
        )}
      </View>
    </View>
  );
}
