import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CoverageSummary } from '../components/PlanWidgets';
import { Schedule } from '../components/PlanView';
import {
  Badge,
  Card,
  ErrorState,
  LoadingState,
  Screen,
  ScreenHeader,
  Text,
} from '../components/ui';
import { knownCoverage, useBlocks, useBriefState, useWorkouts } from '../data/plan-data';
import { api } from '../lib/api';
import { formatRange } from '../lib/format';
import { result } from '../lib/result';
import { useLocalToday } from '../lib/use-local-today';
import { useTheme, useUnits } from '../state/settings';

/** Read-only inspection of saved draft content, including the raw aggregate for debugging. */
export default function DraftContentScreen() {
  const { planId = '' } = useLocalSearchParams<{ planId: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const today = useLocalToday();
  const [technical, setTechnical] = useState(false);
  const draft = useQuery({
    queryKey: ['plans', planId, 'draft-content'],
    queryFn: async () =>
      result(await api.GET('/api/v1/plans/{planId}/draft', { params: { path: { planId } } })),
  });
  const version = draft.data?.version ?? null;
  const brief = useBriefState(planId, version ? { ...version, state: 'draft' as const } : null);
  const workouts = useWorkouts(version);
  const blockQuery = useBlocks(version);
  const units = useUnits(brief.data?.brief.unit);
  return (
    <Screen>
      <ScreenHeader
        title="Saved draft content"
        subtitle="Read-only · not the locked schedule"
        onBack={() => router.back()}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          {draft.isPending ? <LoadingState label="Loading draft…" /> : null}
          {draft.error ? (
            <ErrorState message={draft.error.message} onRetry={() => void draft.refetch()} />
          ) : null}
          {draft.data && version ? (
            <>
              <Card style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Badge
                    label={`Draft edit ${version.editNumber}`}
                    color={theme.accentText}
                    background={theme.accentSoft}
                  />
                  <Text variant="caption" numeric>
                    {formatRange(version.startDate, version.endDate)}
                  </Text>
                </View>
                {version.description ? (
                  <Text variant="body" color="dim">
                    {version.description}
                  </Text>
                ) : null}
                {brief.data ? <CoverageSummary state={brief.data} /> : null}
              </Card>
              <Card style={{ gap: 8 }}>
                <Text variant="label">Current validation findings</Text>
                {draft.data.findings.length === 0 ? (
                  <Text variant="caption">No validation findings.</Text>
                ) : (
                  draft.data.findings.map((finding, index) => (
                    <View key={index} style={{ flexDirection: 'row', gap: 8 }}>
                      <Ionicons
                        name={finding.severity === 'error' ? 'alert-circle' : 'warning'}
                        size={15}
                        color={finding.severity === 'error' ? theme.danger : theme.warning}
                        style={{ marginTop: 2 }}
                      />
                      <Text variant="caption" color="text" style={{ flex: 1 }}>
                        {finding.message}
                      </Text>
                    </View>
                  ))
                )}
              </Card>
              <Card style={{ gap: 8 }}>
                <Pressable
                  onPress={() => setTechnical(!technical)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: technical }}
                  style={{ flexDirection: 'row', alignItems: 'center' }}
                >
                  <Text variant="label" style={{ flex: 1 }}>
                    Technical details
                  </Text>
                  <Ionicons
                    name={technical ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={theme.colors.textMuted}
                  />
                </Pressable>
                {technical ? (
                  <ScrollView horizontal>
                    <Text
                      variant="caption"
                      color="muted"
                      style={{ fontFamily: 'monospace', fontSize: 11 }}
                    >
                      {JSON.stringify(draft.data.content, null, 2)}
                    </Text>
                  </ScrollView>
                ) : null}
              </Card>
            </>
          ) : null}
          {version && (workouts.isPending || brief.isPending) ? (
            <LoadingState label="Loading draft schedule…" />
          ) : null}
          {workouts.error ? (
            <ErrorState message={workouts.error.message} onRetry={() => void workouts.refetch()} />
          ) : null}
          {brief.error ? (
            <ErrorState
              message={`Couldn’t load this draft’s coverage: ${brief.error.message}`}
              onRetry={() => void brief.refetch()}
            />
          ) : null}
        </View>
        {version && workouts.data && brief.data && !brief.error ? (
          <Schedule
            workouts={workouts.data}
            version={version}
            startDate={version.startDate}
            endDate={version.endDate}
            coverage={knownCoverage(brief.data)}
            blocks={blockQuery.data?.blocks ?? []}
            storedWeeks={blockQuery.data?.weeks ?? []}
            units={units}
            today={today}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
