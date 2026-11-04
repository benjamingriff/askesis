import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import { Button, LoadingState, Text } from '../components/ui';
import { useAccount, useInAppCoach } from '../data/account';
import { configureAuthTokenProvider } from '../lib/api';
import { CLERK_PUBLISHABLE_KEY } from '../lib/config';
import { AccountQueryProvider } from '../state/query';
import { SettingsProvider, useTheme } from '../state/settings';

void SplashScreen.preventAutoHideAsync();

function ThemedStack({ signedIn }: { signedIn: boolean }) {
  const theme = useTheme();
  // Chat is part of the in-app coach; without it, old chat links land on Today.
  const coach = useInAppCoach();
  return (
    <>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.bg },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="workout/[id]" />
          <Stack.Protected guard={coach}>
            <Stack.Screen name="chat/[id]" />
          </Stack.Protected>
          <Stack.Screen
            name="ask-agent"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="lock-review"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen name="plans/index" />
          <Stack.Screen name="plans/[id]" />
          <Stack.Screen name="performance" />
          <Stack.Screen name="appearance" />
          <Stack.Screen name="plan-history" />
          <Stack.Screen name="revision" />
          <Stack.Screen name="brief" />
          <Stack.Screen name="draft-content" />
          <Stack.Screen
            name="plan-details"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="new-plan"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="record-result"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="account"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

/** Signed-in API calls carry Clerk's session token; the cache is per account. */
function AuthenticatedApp() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  useEffect(() => {
    configureAuthTokenProvider(isSignedIn ? () => getToken() : null);
  }, [isSignedIn, getToken]);
  useEffect(() => {
    if (isLoaded && !isSignedIn) void SplashScreen.hideAsync();
  }, [isLoaded, isSignedIn]);
  if (!isLoaded) return null;
  // Set synchronously too, so the first queries after sign-in are authenticated.
  configureAuthTokenProvider(isSignedIn ? () => getToken() : null);
  return (
    <AccountQueryProvider key={userId ?? 'signed-out'} accountId={userId ?? 'signed-out'}>
      {isSignedIn ? (
        <AccountGate>
          <ThemedStack signedIn />
        </AccountGate>
      ) : (
        <ThemedStack signedIn={false} />
      )}
    </AccountQueryProvider>
  );
}

/**
 * Features such as the in-app coach come with the account, so signed-in screens wait for it (behind
 * the splash screen) rather than showing the Coach tab and then removing it.
 */
function AccountGate({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const account = useAccount();
  const settled = !!account.data || account.isError;
  useEffect(() => {
    if (settled) void SplashScreen.hideAsync();
  }, [settled]);
  if (account.data) return children;
  return (
    <View
      style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: 'center', padding: 28 }}
    >
      {account.isError ? (
        <>
          <Text variant="title">Couldn’t load your account</Text>
          <Text variant="body" color="dim" style={{ marginTop: 10, marginBottom: 20 }}>
            {account.error.message}
          </Text>
          <Button
            label="Try again"
            busy={account.isFetching}
            onPress={() => void account.refetch()}
          />
        </>
      ) : (
        <LoadingState label="Loading Askesis…" />
      )}
    </View>
  );
}

function MissingConfiguration() {
  const theme = useTheme();
  useEffect(() => void SplashScreen.hideAsync(), []);
  return (
    <View
      style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: 'center', padding: 28 }}
    >
      <Text variant="title">Askesis</Text>
      <Text variant="body" color="dim" style={{ marginTop: 10 }}>
        No Clerk publishable key. Run `pnpm dev:setup` at the repository root (it writes the key to
        .env), or set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, then restart Expo.
      </Text>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SettingsProvider>
      {CLERK_PUBLISHABLE_KEY ? (
        <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
          <AuthenticatedApp />
        </ClerkProvider>
      ) : (
        <MissingConfiguration />
      )}
    </SettingsProvider>
  );
}
