import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { ChatProvider } from '../state/chat';
import { PlanProvider } from '../state/plan';
import { SettingsProvider, useTheme } from '../state/settings';

void SplashScreen.preventAutoHideAsync();

function ThemedStack() {
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
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="workout/[id]" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen
          name="lock-review"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="appearance" />
        <Stack.Screen name="pace-guides" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SettingsProvider onReady={() => void SplashScreen.hideAsync()}>
      <PlanProvider>
        <ChatProvider>
          <ThemedStack />
        </ChatProvider>
      </PlanProvider>
    </SettingsProvider>
  );
}
