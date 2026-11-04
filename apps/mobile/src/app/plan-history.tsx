import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PressableScale,
  Screen,
  ScreenHeader,
  Text,
} from '../components/ui';
import { usePlan } from '../data/plan-data';
import { api } from '../lib/api';
import { formatDateTime, formatRange } from '../lib/format';
import { result } from '../lib/result';
import { useTheme } from '../state/settings';

export function useRevisions(planId: string, enabled = true) {
  return useQuery({
    queryKey: ['plans', planId, 'history'],
    enabled,
    queryFn: async () =>
      result(await api.GET('/api/v1/plans/{planId}/revisions', { params: { path: { planId } } })),
  });
}

/** Every locked version of a plan, newest first. */
export default function PlanHistoryScreen() {
  const { planId = '' } = useLocalSearchParams<{ planId: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const plan = usePlan(planId);
  const history = useRevisions(planId);
  const revisions = [...(history.data?.revisions ?? [])].sort(
    (a, b) => b.versionNumber - a.versionNumber,
  );
  const basis = revisions.find((revision) => revision.id === plan.data?.draft?.basedOnVersionId);
  return (
    <Screen>
      <ScreenHeader
        title="Version history"
        subtitle={plan.data?.displayName}
        onBack={() => router.back()}
      />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={history.isRefetching}
            onRefresh={() => void history.refetch()}
            tintColor={theme.colors.textDim}
          />
        }
      >
        {basis ? (
          <Text variant="caption" style={{ marginBottom: 14 }}>
            The editable draft is based on version {basis.versionNumber}.
          </Text>
        ) : null}
        {history.isPending ? <LoadingState label="Loading history…" /> : null}
        {history.error ? (
          <ErrorState message={history.error.message} onRetry={() => void history.refetch()} />
        ) : null}
        {history.data && !revisions.length ? (
          <EmptyState icon="lock-closed-outline" title="No locked versions yet" dashed>
            Each time you review and lock the plan, a version is saved here.
          </EmptyState>
        ) : null}
        {revisions.map((revision, i) => {
          const current = plan.data?.locked?.id === revision.id;
          const last = i === revisions.length - 1;
          return (
            <View key={revision.id} style={{ flexDirection: 'row', gap: 14 }}>
              <View style={{ alignItems: 'center', width: 26 }}>
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    marginTop: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: current ? theme.lockedSoft : theme.colors.surfaceRaised,
                  }}
                >
                  <Ionicons
                    name="lock-closed"
                    size={12}
                    color={current ? theme.locked : theme.colors.textDim}
                  />
                </View>
                {!last ? (
                  <View style={{ flex: 1, width: 2, backgroundColor: theme.colors.border }} />
                ) : null}
              </View>
              <PressableScale
                onPress={() =>
                  router.push({
                    pathname: '/revision',
                    params: { planId, revisionId: revision.id },
                  })
                }
                accessibilityRole="button"
                scaleTo={0.985}
                style={{
                  flex: 1,
                  marginBottom: last ? 0 : 10,
                  padding: 16,
                  borderRadius: 20,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: current ? theme.lockedBorder : theme.colors.border,
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text variant="subheading" style={{ flex: 1, fontWeight: '700' }}>
                    Version {revision.versionNumber}
                  </Text>
                  {current ? (
                    <Text variant="caption" style={{ color: theme.locked, fontWeight: '800' }}>
                      Current
                    </Text>
                  ) : null}
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
                </View>
                <Text variant="caption" numeric>
                  {revision.lockedAt ? `Locked ${formatDateTime(revision.lockedAt)} · ` : ''}
                  {formatRange(revision.startDate, revision.endDate)}
                </Text>
                {revision.description ? (
                  <Text variant="caption" color="muted" numberOfLines={3}>
                    {revision.description}
                  </Text>
                ) : null}
              </PressableScale>
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
