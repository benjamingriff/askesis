import { Ionicons } from '@expo/vector-icons';
import { useSignIn, useSignUp, useSSO } from '@clerk/expo';
import * as AuthSession from 'expo-auth-session';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { AccentFill, Button, ErrorState, Screen, Text } from '../components/ui';
import { useTheme } from '../state/settings';

WebBrowser.maybeCompleteAuthSession();

type Step = 'email' | 'password' | 'code' | 'second-factor' | 'sign-up' | 'sign-up-code';

function message(error: unknown) {
  const value = error as { longMessage?: string; message?: string } | null;
  return value?.longMessage ?? value?.message ?? 'Sign-in failed. Try again.';
}

/**
 * Custom Clerk sign-in and sign-up, as the prebuilt components need a development build. An
 * athlete signs in with a password, an emailed code or Google, or creates an account with a
 * password and a verified email. A `ticket` (a Clerk sign-in token) signs straight in, for local
 * verification.
 */
export default function SignInScreen() {
  const theme = useTheme();
  const { ticket } = useLocalSearchParams<{ ticket?: string }>();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const { startSSOFlow } = useSSO();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const usedTicket = useRef(false);

  async function attempt(label: string, run: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await run();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(null);
    }
  }

  /** Activates the session once Clerk reports the sign-in complete, else moves to MFA. */
  async function settle() {
    if (signIn.status === 'complete') {
      const { error } = await signIn.finalize();
      if (error) throw error;
    } else if (signIn.status === 'needs_second_factor' || signIn.status === 'needs_client_trust') {
      const { error } = await signIn.mfa.sendEmailCode();
      if (error) throw error;
      setCode('');
      setStep('second-factor');
    } else throw new Error('This sign-in needs a step the app doesn’t support yet.');
  }

  useEffect(() => {
    if (!ticket || usedTicket.current) return;
    usedTicket.current = true;
    void attempt('ticket', async () => {
      const { error } = await signIn.ticket({ ticket });
      if (error) throw error;
      await settle();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket]);

  const submitPassword = () =>
    attempt('password', async () => {
      const { error } = await signIn.password({ identifier: email.trim(), password });
      if (error) throw error;
      await settle();
    });

  const sendCode = () =>
    attempt('code', async () => {
      const created = await signIn.create({ identifier: email.trim() });
      if (created.error) throw created.error;
      const { error } = await signIn.emailCode.sendCode();
      if (error) throw error;
      setCode('');
      setStep('code');
    });

  const verifyCode = () =>
    attempt('verify', async () => {
      const { error } =
        step === 'second-factor'
          ? await signIn.mfa.verifyEmailCode({ code: code.trim() })
          : await signIn.emailCode.verifyCode({ code: code.trim() });
      if (error) throw error;
      await settle();
    });

  const google = () =>
    attempt('google', async () => {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: AuthSession.makeRedirectUri({ path: 'sign-in' }),
      });
      if (createdSessionId) await setActive?.({ session: createdSessionId });
    });

  /** Activates the new account once every requirement is met. */
  async function settleSignUp() {
    if (signUp.status === 'complete') {
      const { error } = await signUp.finalize();
      if (error) throw error;
    } else if (signUp.unverifiedFields.includes('email_address')) {
      const { error } = await signUp.verifications.sendEmailCode();
      if (error) throw error;
      setCode('');
      setStep('sign-up-code');
    } else
      throw new Error(
        `Clerk needs more details to create this account (${signUp.missingFields.join(', ') || 'unknown'}). Create it on the web app instead.`,
      );
  }

  const createAccount = () =>
    attempt('sign-up', async () => {
      const { error } = await signUp.password({
        emailAddress: email.trim(),
        password,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
      });
      if (error) throw error;
      await settleSignUp();
    });

  const verifySignUp = () =>
    attempt('verify', async () => {
      const { error } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
      if (error) throw error;
      await settleSignUp();
    });

  const validEmail = /\S+@\S+\.\S+/.test(email.trim());
  const signingUp = step === 'sign-up' || step === 'sign-up-code';

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'center' }}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <AccentFill />
            <Text variant="title" style={{ color: theme.onAccent }}>
              A
            </Text>
          </View>
          <Text variant="display" style={{ marginTop: 22 }}>
            Askesis
          </Text>
          <Text variant="body" color="dim" style={{ marginTop: 6 }}>
            {step === 'code' || step === 'second-factor' || step === 'sign-up-code'
              ? `Enter the code we emailed to ${email.trim() || 'you'}.`
              : step === 'sign-up'
                ? 'Create your athlete profile.'
                : 'Sign in to your training plan and coach.'}
          </Text>

          {busy === 'ticket' ? (
            <Text variant="caption" style={{ marginTop: 24 }}>
              Signing you in…
            </Text>
          ) : null}

          <View style={{ marginTop: 28, gap: 12 }}>
            {step === 'sign-up' ? (
              <>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      icon="person-outline"
                      value={firstName}
                      onChangeText={setFirstName}
                      placeholder="First name"
                      autoComplete="given-name"
                      textContentType="givenName"
                      autoCapitalize="words"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      icon="person-outline"
                      value={lastName}
                      onChangeText={setLastName}
                      placeholder="Last name"
                      autoComplete="family-name"
                      textContentType="familyName"
                      autoCapitalize="words"
                    />
                  </View>
                </View>
                <Field
                  icon="mail-outline"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email address"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                />
                <Field
                  icon="key-outline"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password (8+ characters)"
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="go"
                  onSubmitEditing={() => validEmail && password.length >= 8 && void createAccount()}
                />
                <Button
                  label="Create account"
                  icon="person-add-outline"
                  busy={busy === 'sign-up'}
                  disabled={!validEmail || password.length < 8 || !!busy}
                  onPress={() => void createAccount()}
                />
                <Button
                  label="I already have an account"
                  variant="ghost"
                  disabled={!!busy}
                  onPress={() => {
                    setError(null);
                    setStep('email');
                  }}
                />
              </>
            ) : step === 'email' || step === 'password' ? (
              <>
                <Field
                  icon="mail-outline"
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    if (step === 'password') setStep('email');
                  }}
                  placeholder="Email address"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  returnKeyType="next"
                  onSubmitEditing={() => validEmail && setStep('password')}
                />
                {step === 'password' ? (
                  <Field
                    icon="key-outline"
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Password"
                    secureTextEntry
                    autoComplete="current-password"
                    textContentType="password"
                    autoFocus
                    returnKeyType="go"
                    onSubmitEditing={() => password && void submitPassword()}
                  />
                ) : null}
                {step === 'password' ? (
                  <Button
                    label="Sign in"
                    icon="log-in-outline"
                    busy={busy === 'password'}
                    disabled={!password || !!busy}
                    onPress={() => void submitPassword()}
                  />
                ) : (
                  <Button
                    label="Continue with password"
                    icon="key-outline"
                    disabled={!validEmail || !!busy}
                    onPress={() => setStep('password')}
                  />
                )}
                <Button
                  label="Email me a code"
                  icon="mail-unread-outline"
                  variant="secondary"
                  busy={busy === 'code'}
                  disabled={!validEmail || !!busy}
                  onPress={() => void sendCode()}
                />
              </>
            ) : (
              <>
                <Field
                  icon="keypad-outline"
                  value={code}
                  onChangeText={setCode}
                  placeholder="6-digit code"
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  autoFocus
                  maxLength={6}
                  onSubmitEditing={() =>
                    code.trim().length >= 6 && void (signingUp ? verifySignUp() : verifyCode())
                  }
                />
                <Button
                  label={signingUp ? 'Verify and create account' : 'Verify and sign in'}
                  icon="checkmark"
                  busy={busy === 'verify'}
                  disabled={code.trim().length < 6 || !!busy}
                  onPress={() => void (signingUp ? verifySignUp() : verifyCode())}
                />
                <Button
                  label="Use a different email"
                  variant="ghost"
                  disabled={!!busy}
                  onPress={() => {
                    if (signingUp) {
                      void signUp.reset();
                      setStep('sign-up');
                    } else {
                      void signIn.reset();
                      setStep('email');
                    }
                  }}
                />
              </>
            )}
          </View>

          {error ? <ErrorState message={error} style={{ marginTop: 16 }} /> : null}

          {Platform.OS !== 'web' &&
          (step === 'email' || step === 'password' || step === 'sign-up') ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 24 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
                <Text variant="caption" color="muted">
                  or
                </Text>
                <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
              </View>
              <Button
                label="Continue with Google"
                icon="logo-google"
                variant="ghost"
                style={{ marginTop: 16 }}
                busy={busy === 'google'}
                disabled={!!busy}
                onPress={() => void google()}
              />
            </>
          ) : null}

          {step === 'email' || step === 'password' ? (
            <Text variant="caption" color="muted" style={{ marginTop: 28, textAlign: 'center' }}>
              New to Askesis?{' '}
              <Text
                variant="caption"
                color="accent"
                style={{ fontWeight: '800' }}
                onPress={() => {
                  setError(null);
                  setStep('sign-up');
                }}
              >
                Create an account
              </Text>
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Field({ icon, ...props }: TextInputProps & { icon: keyof typeof Ionicons.glyphMap }) {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 54,
        borderRadius: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 16,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <Ionicons name={icon} size={18} color={theme.colors.textMuted} />
      <TextInput
        placeholderTextColor={theme.colors.textMuted}
        autoCorrect={false}
        {...props}
        style={{
          flex: 1,
          fontSize: 16,
          color: theme.colors.text,
          ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
        }}
      />
    </View>
  );
}
