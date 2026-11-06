import { Ionicons } from '@expo/vector-icons';
import type { ReactNode, RefObject } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type TextInputInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../state/settings';
import { AccentFill, PressableScale, Text, useHaptics } from '../ui';

/** Starting points for a new conversation. */
export const SUGGESTIONS = [
  'Help me build a plan for my next race',
  'How should I pace my long run?',
  'I missed a session this week — what now?',
  'Explain my pace guides',
];

export function Composer({
  input,
  text,
  onTextChange,
  onSubmit,
  placeholder,
  keyboardOpen,
  locked,
  canSend,
  sending,
  onStop,
  stopping,
  suggestions,
  notices,
}: {
  input: RefObject<TextInputInstance | null>;
  text: string;
  onTextChange: (text: string) => void;
  onSubmit: () => void;
  placeholder: string;
  keyboardOpen: boolean;
  /** The text can't be edited (sending, retrying or archived). */
  locked: boolean;
  canSend: boolean;
  sending: boolean;
  /** Present while the coach is working: the send button becomes Stop. */
  onStop?: () => void;
  stopping?: boolean;
  suggestions?: string[];
  notices?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const buzz = useHaptics();
  const ready = canSend && text.trim().length > 0;

  return (
    <View
      style={{
        paddingBottom: keyboardOpen ? 8 : Math.max(insets.bottom, 10),
        backgroundColor: theme.colors.bg,
        gap: 8,
      }}
    >
      {notices ? <View style={{ paddingHorizontal: 12, gap: 8 }}>{notices}</View> : null}
      {suggestions?.length && !onStop && text.length === 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        >
          {suggestions.map((s) => (
            <PressableScale
              key={s}
              haptic="select"
              onPress={() => {
                onTextChange(s);
                input.current?.focus();
              }}
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
          ref={input}
          value={text}
          onChangeText={onTextChange}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          multiline
          editable={!locked}
          accessibilityLabel="Message your coach"
          onKeyPress={
            Platform.OS === 'web'
              ? (event) => {
                  const native = event.nativeEvent as { key: string; shiftKey?: boolean };
                  if (native.key === 'Enter' && !native.shiftKey) {
                    event.preventDefault();
                    if (ready) onSubmit();
                  }
                }
              : undefined
          }
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
        {onStop ? (
          <Pressable
            onPress={() => {
              buzz('warning');
              onStop();
            }}
            disabled={stopping}
            accessibilityRole="button"
            accessibilityLabel="Stop"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: theme.colors.text,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: stopping ? 0.5 : 1,
            }}
          >
            {stopping ? (
              <ActivityIndicator size="small" color={theme.colors.bg} />
            ) : (
              <View
                style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: theme.colors.bg }}
              />
            )}
          </Pressable>
        ) : (
          <Pressable
            onPress={() => {
              buzz('light');
              onSubmit();
            }}
            disabled={!ready}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: theme.colors.surfaceRaised,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {ready ? <AccentFill /> : null}
            {sending ? (
              <ActivityIndicator size="small" color={theme.onAccent} />
            ) : (
              <Ionicons
                name="arrow-up"
                size={20}
                color={ready ? theme.onAccent : theme.colors.textMuted}
              />
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}
