import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { Text } from '../components/ui';
import { configureAuthTokenProvider } from '../lib/api';
import { CLERK_PUBLISHABLE_KEY } from '../lib/config';
import { AccountQueryProvider } from '../state/query';
import { SettingsProvider, useTheme } from '../state/settings';

void SplashScreen.preventAutoHideAsync();

function ThemedStack({ signedIn }: { signedIn: boolean }) {
  const theme = useTheme();
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
          <Stack.Screen name="chat/[id]" />
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
    if (isLoaded) void SplashScreen.hideAsync();
  }, [isLoaded]);
  if (!isLoaded) return null;
  // Set synchronously too, so the first queries after sign-in are authenticated.
  configureAuthTokenProvider(isSignedIn ? () => getToken() : null);
  return (
    <AccountQueryProvider key={userId ?? 'signed-out'} accountId={userId ?? 'signed-out'}>
      <ThemedStack signedIn={!!isSignedIn} />
    </AccountQueryProvider>
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
