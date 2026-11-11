import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { Field, FormScreen, useFieldStyle } from '../components/forms';
import { Button, Text } from '../components/ui';
import { withQuestion } from '../lib/coach';
import { useTheme } from '../state/settings';

// Web has a share sheet only where the browser offers one.
const canShare =
  Platform.OS !== 'web' ||
  (typeof navigator !== 'undefined' && typeof navigator.share === 'function');

/**
 * Waddle cannot message the athlete's agent, so asking copies a prompt for them to paste. They add
 * their question here first. What gets copied stays one tap away, and opens by itself when the
 * clipboard refuses a write (Expo web after a slow save) so it can be copied by hand.
 */
export default function AskAgentScreen() {
  const theme = useTheme();
  const { prompt = '', subject } = useLocalSearchParams<{ prompt?: string; subject?: string }>();
  const field = useFieldStyle(false);
  const [question, setQuestion] = useState('');
  const [copied, setCopied] = useState<boolean | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  // An open request (`About “Tempo” on …: `) is finished by the question.
  const open = /:\s*$/.test(prompt);
  const text = withQuestion(prompt, question);

  const copy = async () => {
    let ok = false;
    try {
      ok = await Clipboard.setStringAsync(text);
    } catch {
      ok = false;
    }
    setCopied(ok);
    if (!ok) setShowPrompt(true);
  };

  return (
    <FormScreen
      title="Ask your agent"
      cancelLabel="Close"
      footer={
        <View style={{ gap: 10 }}>
          <Button
            label={copied ? 'Copied' : 'Copy for your agent'}
            icon={copied ? 'checkmark' : 'copy-outline'}
            onPress={() => void copy()}
          />
          {canShare ? (
            <Button
              label="Share…"
              icon="share-outline"
              variant="secondary"
              onPress={() => void Share.share({ message: text }).catch(() => undefined)}
            />
          ) : null}
        </View>
      }
    >
      <Text variant="body" color="dim">
        Add your question, copy the request, then paste it into Claude or another agent connected to
        Waddle. Changes it saves come back to Waddle for you to review.
      </Text>
      {subject ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="calendar-outline" size={16} color={theme.colors.textMuted} />
          <Text variant="caption" color="muted">
            About
          </Text>
          <Text
            variant="caption"
            color="text"
            numberOfLines={3}
            style={{ flex: 1, fontWeight: '700' }}
          >
            {subject}
          </Text>
        </View>
      ) : null}
      <Field
        label={open ? 'Your question' : 'Anything to add?'}
        hint={open ? undefined : 'Optional'}
        value={question}
        onChangeText={(value) => {
          setQuestion(value);
          setCopied(null);
        }}
        placeholder={
          open ? 'For example, can I move this to Thursday?' : 'Add context for your agent'
        }
        multiline
        maxLength={2000}
      />
      <View style={{ gap: 8 }}>
        <Pressable
          onPress={() => setShowPrompt(!showPrompt)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showPrompt }}
          hitSlop={8}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: 14,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
          }}
        >
          <Ionicons name="document-text-outline" size={16} color={theme.colors.textDim} />
          <Text variant="caption" color="text" style={{ flex: 1, fontWeight: '700' }}>
            {showPrompt ? 'Hide what gets copied' : 'Show what gets copied'}
          </Text>
          <Ionicons
            name={showPrompt ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={theme.accentText}
          />
        </Pressable>
        {showPrompt ? (
          <View style={[field, { paddingVertical: 12 }]}>
            {/* Selectable, so it can be copied by hand when the clipboard refuses. */}
            <Text variant="caption" color="dim" selectable>
              {text}
            </Text>
          </View>
        ) : null}
      </View>
      <Text variant="caption" color="muted" accessibilityLiveRegion="polite">
        {copied === true
          ? 'Copied. Paste it into your agent.'
          : copied === false
            ? 'Couldn’t copy. Select the text above and copy it, then paste it into your agent.'
            : ' '}
      </Text>
    </FormScreen>
  );
}
