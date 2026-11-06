import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { FormScreen, useFieldStyle } from '../components/forms';
import { Button, Text } from '../components/ui';

/**
 * Waddle cannot message the athlete's agent, so asking copies a prompt for them to paste. The
 * prompt stays visible, because the clipboard can refuse a write (Expo web after a slow save).
 */
export default function AskAgentScreen() {
  const { prompt = '' } = useLocalSearchParams<{ prompt?: string }>();
  const field = useFieldStyle(false);
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = useCallback(async (text: string) => {
    try {
      setCopied(await Clipboard.setStringAsync(text));
    } catch {
      setCopied(false);
    }
  }, []);
  useEffect(() => {
    setCopied(null);
    if (prompt) void copy(prompt);
  }, [prompt, copy]);

  return (
    <FormScreen
      title="Ask your agent"
      cancelLabel="Done"
      footer={
        <Button
          label={copied ? 'Copied' : 'Copy prompt'}
          icon={copied ? 'checkmark' : 'copy-outline'}
          onPress={() => void copy(prompt)}
        />
      }
    >
      <Text variant="body" color="dim">
        Paste this into Claude or the agent you connected to Waddle. Changes it saves appear here
        for you to review.
      </Text>
      <View style={[field, { paddingVertical: 12 }]}>
        {/* Selectable, so it can be copied by hand when the clipboard refuses. */}
        <Text variant="body" selectable accessibilityLabel={`Prompt for your agent: ${prompt}`}>
          {prompt}
        </Text>
      </View>
      <Text variant="caption" color="muted" accessibilityLiveRegion="polite">
        {copied === true
          ? 'Copied to your clipboard.'
          : copied === false
            ? 'Select the prompt and copy it, then paste it into your agent.'
            : ' '}
      </Text>
    </FormScreen>
  );
}
