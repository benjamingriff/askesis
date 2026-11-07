import { useClerk } from '@clerk/expo';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAccountDeletion, useDataExport } from '../data/account';
import { formatInstantLong } from '../lib/format';
import { useTheme } from '../state/settings';
import { AccentFill, Button, ErrorState, Text } from './ui';

/** Shown instead of the app while a requested account deletion can still be cancelled. */
export function AccountDeletionPending({ purgeAfter }: { purgeAfter: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { signOut } = useClerk();
  const { cancel } = useAccountDeletion();
  const download = useDataExport();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const error = cancel.error?.message ?? download.error?.message ?? signOutError;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.bg }}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: 'center',
        padding: 28,
        paddingTop: insets.top + 28,
        paddingBottom: insets.bottom + 28,
      }}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
        }}
      >
        <AccentFill />
        <Text variant="heading" style={{ color: theme.onAccent }}>
          A
        </Text>
      </View>
      <Text variant="label" color="muted">
        Account deletion scheduled
      </Text>
      <Text variant="title" style={{ marginTop: 8 }} accessibilityRole="header">
        Your account will be deleted on {formatInstantLong(purgeAfter)}
      </Text>
      <Text variant="body" color="dim" style={{ marginTop: 12 }}>
        Your plans, conversations, training log and fitness history will be permanently deleted
        then, along with your sign-in. Until then you can change your mind, or download a copy of
        your data first.
      </Text>
      <View style={{ gap: 10, marginTop: 28 }}>
        <Button
          label="Keep my account"
          icon="arrow-undo"
          busy={cancel.isPending}
          disabled={cancel.isPending}
          onPress={() => cancel.mutate()}
        />
        <Button
          label="Download my data"
          icon="download-outline"
          variant="secondary"
          busy={download.isPending}
          disabled={download.isPending}
          onPress={() => download.mutate()}
        />
        <Button
          label="Sign out"
          icon="log-out-outline"
          variant="ghost"
          onPress={() => {
            setSignOutError(null);
            signOut().catch((caught: unknown) =>
              setSignOutError(caught instanceof Error ? caught.message : 'Sign-out failed.'),
            );
          }}
        />
      </View>
      {error ? <ErrorState message={error} style={{ marginTop: 16 }} /> : null}
    </ScrollView>
  );
}
