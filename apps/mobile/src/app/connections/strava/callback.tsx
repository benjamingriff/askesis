import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import { StravaButton, StravaMark } from '../../../components/Strava';
import { Button, Card, ErrorState, LoadingState, Screen, Text } from '../../../components/ui';
import {
  completeStravaConnection,
  useConnectStrava,
  useRefreshIntegrations,
} from '../../../data/activities';
import { useTheme } from '../../../state/settings';

/**
 * Strava returns here after consent: on the web build always, and in native builds when the link
 * opens the app rather than the in-app browser that started it. The athlete's session completes
 * the connection (the signed state proves this athlete started it). Nothing is imported:
 * activities are read from Strava when the athlete looks for one.
 */
export default function StravaCallbackScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{
    code?: string;
    state?: string;
    scope?: string;
    error?: string;
  }>();
  const reconnect = useConnectStrava();
  const refresh = useRefreshIntegrations();
  const finish = useMutation({
    mutationFn: () => completeStravaConnection(params),
    onSettled: (state) => refresh(state),
  });
  const denied = params.error === 'access_denied';
  const { mutate } = finish;
  const started = useRef<string | null>(null);
  useEffect(() => {
    // Keep the one-time code out of the address bar and history.
    if (Platform.OS === 'web') window.history.replaceState(null, '', window.location.pathname);
    if (!params.code || started.current === params.code) return;
    started.current = params.code;
    mutate();
  }, [params.code, mutate]);
  const leave = (path: '/' | '/plan' | '/you') =>
    router.canGoBack() ? router.back() : router.replace(path);

  return (
    <Screen>
      <View style={{ padding: 20, gap: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <StravaMark size={22} />
          <Text variant="title">Strava</Text>
        </View>
        <Card style={{ gap: 16 }}>
          {denied || (!params.code && !finish.isPending) ? (
            <>
              <Text variant="body">
                {denied
                  ? 'Strava wasn’t connected. You can connect it any time from You.'
                  : 'This page finishes connecting Strava, but no connection was in progress.'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <StravaButton
                  label="Connect with Strava"
                  busy={reconnect.isPending}
                  onPress={() => reconnect.mutate()}
                />
                <Button
                  size="md"
                  variant="ghost"
                  label="Back to You"
                  onPress={() => leave('/you')}
                />
              </View>
            </>
          ) : finish.error ? (
            <>
              <ErrorState message={finish.error.message} />
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <StravaButton
                  label="Try again"
                  busy={reconnect.isPending}
                  onPress={() => reconnect.mutate()}
                />
                <Button
                  size="md"
                  variant="ghost"
                  label="Back to You"
                  onPress={() => leave('/you')}
                />
              </View>
            </>
          ) : finish.isSuccess ? (
            <>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Ionicons name="checkmark-circle" size={22} color={theme.locked} />
                <Text variant="body" style={{ flex: 1 }}>
                  Connected
                  {finish.data?.strava.connection?.displayName
                    ? ` as ${finish.data.strava.connection.displayName}`
                    : ''}
                  . Open a workout and choose{' '}
                  <Text variant="body" style={{ fontWeight: '800' }}>
                    Find my activity
                  </Text>{' '}
                  to link what you recorded.
                </Text>
              </View>
              <View style={{ gap: 8 }}>
                <Button
                  label="See today"
                  icon="arrow-forward"
                  onPress={() => router.replace('/')}
                />
                <Button
                  label="See your plan"
                  variant="ghost"
                  onPress={() => router.replace('/plan')}
                />
              </View>
            </>
          ) : (
            <LoadingState label="Connecting Strava…" />
          )}
        </Card>
      </View>
    </Screen>
  );
}
