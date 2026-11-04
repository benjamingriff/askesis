import { useClerk, useReverification, useSession, useUser } from '@clerk/expo';
import { useMutation } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { Field, FormScreen, FormSection, useLeaveGuard } from '../components/forms';
import { ActionList, Button, ErrorState, Notice, Text } from '../components/ui';
import { CLERK_PUBLISHABLE_KEY } from '../lib/config';

function clerkMessage(error: unknown) {
  const value = error as {
    errors?: { longMessage?: string; message?: string }[];
    message?: string;
  };
  return (
    value?.errors?.[0]?.longMessage ??
    value?.errors?.[0]?.message ??
    value?.message ??
    'Something went wrong.'
  );
}

/**
 * Clerk's hosted account pages for this instance: the publishable key encodes the Frontend API
 * host, and the Account Portal lives beside it (`*.clerk.accounts.dev` → `*.accounts.dev`,
 * `clerk.example.com` → `accounts.example.com`).
 */
export function accountPortalUrl(publishableKey = CLERK_PUBLISHABLE_KEY): string | null {
  try {
    const encoded = publishableKey.split('_').slice(2).join('_');
    const host = atob(encoded).replace(/\$$/, '');
    if (host.endsWith('.clerk.accounts.dev'))
      return `https://${host.replace('.clerk.accounts.dev', '.accounts.dev')}/user`;
    if (host.startsWith('clerk.')) return `https://accounts.${host.slice('clerk.'.length)}/user`;
    return null;
  } catch {
    return null;
  }
}

/** Your name, password and sign-in methods. */
export default function AccountScreen() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);
  const nameDirty =
    firstName.trim() !== (user?.firstName ?? '') || lastName.trim() !== (user?.lastName ?? '');
  const saveName = useMutation({
    mutationFn: async () => {
      try {
        await user!.update({ firstName: firstName.trim(), lastName: lastName.trim() });
      } catch (error) {
        throw new Error(clerkMessage(error));
      }
    },
  });
  // Sensitive changes may need a fresh check that it's you; Clerk asks through this callback.
  const [reverify, setReverify] = useState<Reverification | null>(null);
  const updatePassword = useReverification(
    (params: Parameters<NonNullable<typeof user>['updatePassword']>[0]) =>
      user!.updatePassword(params),
    { onNeedsReverification: setReverify },
  );
  const changePassword = useMutation({
    mutationFn: async () => {
      try {
        await updatePassword({
          ...(user!.passwordEnabled ? { currentPassword } : {}),
          newPassword,
          signOutOfOtherSessions: true,
        });
      } catch (error) {
        throw new Error(clerkMessage(error));
      }
    },
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setPasswordSaved(true);
    },
  });
  const portal = accountPortalUrl();
  const passwordDirty = !!(currentPassword || newPassword);
  const guard = useLeaveGuard(nameDirty || passwordDirty, {
    busy: saveName.isPending || changePassword.isPending,
  });
  return (
    <FormScreen
      title="Account"
      guard={guard}
      saveLabel="Save"
      canSave={nameDirty && !!firstName.trim()}
      saving={saveName.isPending}
      onSave={() => saveName.mutate()}
    >
      <FormSection title="Profile">
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Field
            label="First name"
            value={firstName}
            onChangeText={setFirstName}
            style={{ flex: 1 }}
          />
          <Field
            label="Last name"
            value={lastName}
            onChangeText={setLastName}
            style={{ flex: 1 }}
          />
        </View>
        {saveName.isSuccess && !nameDirty ? (
          <Text variant="caption" color="accent">
            Name saved.
          </Text>
        ) : null}
        {saveName.error ? <ErrorState message={saveName.error.message} /> : null}
      </FormSection>

      <FormSection title="Email">
        {user?.emailAddresses.map((address) => (
          <View key={address.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
              {address.emailAddress}
            </Text>
            {address.id === user.primaryEmailAddressId ? (
              <Text variant="caption" color="muted">
                Primary
              </Text>
            ) : null}
          </View>
        ))}
      </FormSection>

      <FormSection
        title="Password"
        description={
          user?.passwordEnabled
            ? 'Changing your password signs out your other devices.'
            : 'Add a password to sign in without an emailed code.'
        }
      >
        {user?.passwordEnabled ? (
          <Field
            label="Current password"
            secure
            value={currentPassword}
            onChangeText={(value) => {
              setPasswordSaved(false);
              setCurrentPassword(value);
            }}
          />
        ) : null}
        <Field
          label="New password"
          hint="At least 8 characters"
          secure
          value={newPassword}
          onChangeText={(value) => {
            setPasswordSaved(false);
            setNewPassword(value);
          }}
        />
        <ActionList
          actions={[
            {
              label: user?.passwordEnabled ? 'Change password' : 'Set password',
              icon: 'key-outline',
              busy: changePassword.isPending,
              onPress: () => {
                if (newPassword.length >= 8 && (!user?.passwordEnabled || currentPassword))
                  changePassword.mutate();
              },
            },
          ]}
        />
        {passwordSaved ? (
          <Notice tone="accent" icon="checkmark-circle">
            Password updated.
          </Notice>
        ) : null}
        {changePassword.error ? <ErrorState message={changePassword.error.message} /> : null}
      </FormSection>

      <ActionList
        actions={[
          !!portal && {
            label: 'Security & connected accounts',
            icon: 'shield-checkmark-outline',
            detail: 'Opens Clerk',
            onPress: () => void WebBrowser.openBrowserAsync(portal),
          },
          {
            label: 'Sign out',
            icon: 'log-out-outline',
            tone: 'danger',
            onPress: () => void signOut(),
          },
        ]}
      />
      <ConfirmIdentitySheet
        request={reverify}
        password={user?.passwordEnabled ? currentPassword : null}
        onDone={() => setReverify(null)}
      />
    </FormScreen>
  );
}

type Reverification = { complete: () => void; cancel: () => void; level: string | undefined };

/**
 * Clerk's "confirm it's you" step for sensitive changes, done natively: with the current password
 * when the account has one, otherwise with a code emailed to the primary address.
 */
function ConfirmIdentitySheet({
  request,
  password: initialPassword,
  onDone,
}: {
  request: Reverification | null;
  /** The account's password as typed on the form, or null when it has none. */
  password: string | null;
  onDone: () => void;
}) {
  const { session } = useSession();
  const { user } = useUser();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usesPassword = initialPassword !== null;
  const run = async (step: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await step();
    } catch (caught) {
      setError(clerkMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const start = async () => {
    const level = (request?.level ?? 'first_factor') as 'first_factor';
    return session!.startVerification({ level });
  };
  const finish = (status: string) => {
    if (status === 'complete') {
      request?.complete();
      reset();
    } else
      throw new Error(
        'This account needs a second factor to confirm. Use Security & connected accounts instead.',
      );
  };
  const reset = () => {
    setPassword('');
    setCode('');
    setCodeSent(false);
    setError(null);
    onDone();
  };
  const confirmPassword = () =>
    run(async () => {
      const started = await start();
      if (started.status === 'complete') return finish('complete');
      const verified = await session!.attemptFirstFactorVerification({
        strategy: 'password',
        password: password || initialPassword || '',
      });
      finish(verified.status);
    });
  const sendCode = () =>
    run(async () => {
      const started = await start();
      if (started.status === 'complete') return finish('complete');
      const factor = started.supportedFirstFactors?.find(
        (candidate) =>
          candidate.strategy === 'email_code' &&
          (!user?.primaryEmailAddressId ||
            ('emailAddressId' in candidate &&
              candidate.emailAddressId === user.primaryEmailAddressId)),
      );
      if (!factor || factor.strategy !== 'email_code')
        throw new Error('No email address can confirm this change.');
      await session!.prepareFirstFactorVerification({
        strategy: 'email_code',
        emailAddressId: factor.emailAddressId,
      });
      setCodeSent(true);
    });
  const verifyCode = () =>
    run(async () => {
      const verified = await session!.attemptFirstFactorVerification({
        strategy: 'email_code',
        code: code.trim(),
      });
      finish(verified.status);
    });
  return (
    <BottomSheet
      visible={!!request}
      onClose={() => {
        if (busy) return;
        request?.cancel();
        reset();
      }}
      title="Confirm it’s you"
    >
      <View style={{ gap: 12 }}>
        <Text variant="body" color="dim">
          {usesPassword
            ? 'Enter your current password to make this change.'
            : codeSent
              ? `Enter the code we emailed to ${user?.primaryEmailAddress?.emailAddress ?? 'you'}.`
              : 'We’ll email you a code to confirm this change.'}
        </Text>
        {usesPassword ? (
          <Field
            label="Current password"
            secure
            value={password || initialPassword || ''}
            onChangeText={setPassword}
          />
        ) : codeSent ? (
          <Field label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" />
        ) : null}
        {error ? <ErrorState message={error} /> : null}
        <Button
          label={usesPassword ? 'Confirm' : codeSent ? 'Verify code' : 'Email me a code'}
          icon="shield-checkmark-outline"
          busy={busy}
          disabled={codeSent ? code.trim().length < 6 : false}
          onPress={() =>
            void (usesPassword ? confirmPassword() : codeSent ? verifyCode() : sendCode())
          }
        />
        <Button
          label="Cancel"
          variant="ghost"
          disabled={busy}
          onPress={() => {
            request?.cancel();
            reset();
          }}
        />
      </View>
    </BottomSheet>
  );
}
