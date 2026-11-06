import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet } from '../components/BottomSheet';
import { Schedule } from '../components/PlanView';
import {
  ActionList,
  Badge,
  Button,
  Card,
  ErrorState,
  LoadingState,
  Notice,
  Screen,
  ScreenHeader,
  Text,
} from '../components/ui';
import {
  knownCoverage,
  useBlocks,
  useBriefState,
  usePlan,
  useWorkouts,
  writePlan,
} from '../data/plan-data';
import type { paths } from '../lib/api-types';
import { api } from '../lib/api';
import { formatDateTime, formatRange, formatShort } from '../lib/format';
import { useRequestKey } from '../lib/request-key';
import { result } from '../lib/result';
import { useLocalToday } from '../lib/use-local-today';
import { usePlanSelection } from '../state/plan-selection';
import { useTheme, useUnits } from '../state/settings';
import { useRevisions } from './plan-history';

type Preview =
  paths['/api/v1/plans/{planId}/revisions/{revisionId}/restore-preview']['post']['responses'][200]['content']['application/json'];

/** One locked version: what changed, how it validated, its schedule, and restoring it. */
export default function RevisionScreen() {
  const { planId = '', revisionId = '' } = useLocalSearchParams<{
    planId: string;
    revisionId: string;
  }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const today = useLocalToday();
  const client = useQueryClient();
  const { select } = usePlanSelection();
  const params = { path: { planId, revisionId } };
  const plan = usePlan(planId);
  const detail = useQuery({
    queryKey: ['plans', planId, 'revision', revisionId],
    queryFn: async () =>
      result(await api.GET('/api/v1/plans/{planId}/revisions/{revisionId}', { params })),
  });
  const revision = detail.data?.revision;
  const revisionKey = revision ? { id: revisionId, editNumber: revision.editNumber } : null;
  const workouts = useWorkouts(revisionKey);
  const blockQuery = useBlocks(revisionKey);
  // The revision brief carries the coverage saved with this version.
  const brief = useBriefState(
    planId,
    revision ? { ...revision, id: revisionId, state: 'locked' as const } : null,
  );
  const units = useUnits(brief.data?.brief.unit);
  const history = useRevisions(planId, !!revision);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [technical, setTechnical] = useState(false);
  const requestKey = useRequestKey();
  const mutation = useMutation({
    mutationFn: async (action: 'preview' | 'restore') => {
      if (action === 'preview') {
        setPreview(
          result(
            await api.POST('/api/v1/plans/{planId}/revisions/{revisionId}/restore-preview', {
              params,
            }),
          ),
        );
        return null;
      }
      if (!preview) throw new Error('Review the restore preview first.');
      const body = {
        expectedStateVersion: preview.stateVersion,
        expectedCurrentVersionId: preview.currentVersionId,
        expectedSourceHash: preview.sourceHash,
      };
      return result(
        await api.POST('/api/v1/plans/{planId}/revisions/{revisionId}/restore', {
          params: { ...params, header: { 'idempotency-key': requestKey(body) } },
          body,
        }),
      );
    },
    onSuccess: async (updated) => {
      if (!updated) return;
      setPreview(null);
      select({ planId, view: 'draft' });
      writePlan(client, updated);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plans'] }),
        client.invalidateQueries({ queryKey: ['plan-workouts'] }),
      ]);
      router.dismissTo({ pathname: '/plans/[id]', params: { id: planId } });
    },
    onError: () => setPreview(null),
  });
  const basedOn = history.data?.revisions?.find((item) => item.id === revision?.basedOnVersionId);
  const supersedes = history.data?.revisions?.find(
    (item) => item.id === revision?.supersedesVersionId,
  );
  const current = plan.data?.locked?.id === revisionId;
  const blocked = plan.data?.archived
    ? 'Unarchive this plan before restoring.'
    : plan.data?.draft
      ? 'Lock or discard the existing draft before restoring.'
      : current
        ? 'This is already the current locked version.'
        : null;
  const freshPreview =
    !!preview &&
    plan.data?.stateVersion === preview.stateVersion &&
    plan.data.locked?.id === preview.currentVersionId;
  return (
    <Screen>
      <ScreenHeader
        title={revision ? `Version ${revision.versionNumber}` : 'Version'}
        subtitle={plan.data?.displayName}
        onBack={() => router.back()}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          {plan.isPending || detail.isPending ? <LoadingState label="Loading version…" /> : null}
          {plan.error || detail.error ? (
            <ErrorState
              message={plan.error?.message ?? detail.error?.message ?? ''}
              onRetry={() => {
                void plan.refetch();
                void detail.refetch();
              }}
            />
          ) : null}
        </View>
        {revision ? (
          <View style={{ paddingHorizontal: 20, gap: 12, marginTop: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Badge
                label={current ? 'Current locked version' : 'Historical version'}
                icon="lock-closed"
                color={theme.locked}
                background={theme.lockedSoft}
              />
              {plan.data?.archived ? (
                <Badge
                  label="Archived plan"
                  color={theme.colors.textDim}
                  background={theme.colors.surfaceRaised}
                />
              ) : null}
              <Text variant="caption" numeric>
                {formatRange(revision.startDate, revision.endDate)}
              </Text>
            </View>
            <ActionList
              actions={[
                {
                  label: 'Brief & pace guides',
                  icon: 'clipboard-outline',
                  onPress: () =>
                    router.push({ pathname: '/brief', params: { planId, revisionId } }),
                },
              ]}
            />
            <Button
              label="Review restore as draft"
              icon="time-outline"
              disabled={!plan.data || !!blocked || mutation.isPending}
              busy={mutation.isPending && !preview}
              onPress={() => mutation.mutate('preview')}
            />
            {blocked ? <Notice icon="information-circle">{blocked}</Notice> : null}
            {mutation.error ? (
              <ErrorState message={mutation.error.message} onRetry={() => void plan.refetch()} />
            ) : null}
            {preview && !freshPreview ? (
              <Notice tone="warning">
                The plan changed. Review the restore again before confirming.
              </Notice>
            ) : null}

            <Card style={{ gap: 8 }}>
              <Text variant="label">About this version</Text>
              <Text variant="body">{revision.description ?? 'No description.'}</Text>
              {revision.lockedAt ? (
                <Text variant="caption">Locked {formatDateTime(revision.lockedAt)}</Text>
              ) : null}
              {basedOn ? (
                <Text variant="caption">Based on version {basedOn.versionNumber}.</Text>
              ) : null}
              {supersedes ? (
                <Text variant="caption">
                  Replaced version {supersedes.versionNumber} when locked.
                </Text>
              ) : null}
            </Card>
            <Card style={{ gap: 8 }}>
              <Text variant="label">Changes saved with this version</Text>
              <RevisionChanges summary={revision.summary} />
            </Card>
            <Card style={{ gap: 8 }}>
              <Text variant="label">Validation at lock time</Text>
              {revision.findings.length === 0 ? (
                <Text variant="caption">No validation findings.</Text>
              ) : (
                revision.findings.map((finding, index) => (
                  <View key={index} style={{ flexDirection: 'row', gap: 8 }}>
                    <Ionicons
                      name="warning"
                      size={15}
                      color={finding.severity === 'error' ? theme.danger : theme.warning}
                      style={{ marginTop: 2 }}
                    />
                    <Text variant="caption" color="text" style={{ flex: 1 }}>
                      {finding.message}
                      {revision.acknowledgedWarningCodes.includes(finding.code)
                        ? ' (acknowledged)'
                        : ''}
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
                <>
                  <Text variant="caption">
                    Validator version {revision.validatorVersion} · content hash{' '}
                    {revision.contentHash?.slice(0, 12)}
                  </Text>
                  <ScrollView horizontal>
                    <Text
                      variant="caption"
                      color="muted"
                      style={{ fontFamily: 'monospace', fontSize: 11 }}
                    >
                      {JSON.stringify(detail.data?.content, null, 2)}
                    </Text>
                  </ScrollView>
                </>
              ) : null}
            </Card>
          </View>
        ) : null}

        {revision && (workouts.isPending || brief.isPending) ? (
          <LoadingState label="Loading historical schedule…" style={{ paddingHorizontal: 20 }} />
        ) : null}
        {workouts.error ? (
          <ErrorState
            style={{ margin: 20 }}
            message={workouts.error.message}
            onRetry={() => void workouts.refetch()}
          />
        ) : null}
        {brief.error ? (
          <ErrorState
            style={{ margin: 20 }}
            message={`Couldn’t load this version’s coverage: ${brief.error.message}`}
            onRetry={() => void brief.refetch()}
          />
        ) : null}
        {revision && revisionKey && workouts.data && brief.data ? (
          <Schedule
            workouts={workouts.data}
            version={revisionKey}
            startDate={revision.startDate}
            endDate={revision.endDate}
            coverage={knownCoverage(brief.data)}
            blocks={blockQuery.data?.blocks ?? []}
            storedWeeks={blockQuery.data?.weeks ?? []}
            units={units}
            today={today}
          />
        ) : null}
      </ScrollView>

      <BottomSheet
        visible={freshPreview && !blocked}
        onClose={() => !mutation.isPending && setPreview(null)}
        title={revision ? `Restore version ${revision.versionNumber} as a draft?` : undefined}
      >
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 12 }}>
          <Text variant="body" color="dim">
            This creates an editable draft from version {revision?.versionNumber}. Current locked
            version {plan.data?.locked?.versionNumber} and all history remain unchanged.
          </Text>
          <Notice tone="warning">
            Locking this restored draft later will replace the current schedule with this older
            content. It creates a new version, not a rollback of history.
          </Notice>
          {preview ? <RevisionChanges summary={preview.summary} /> : null}
        </ScrollView>
        <View style={{ gap: 10, marginTop: 18 }}>
          <Button
            label="Confirm restore as draft"
            icon="time-outline"
            busy={mutation.isPending}
            onPress={() => mutation.mutate('restore')}
          />
          <Button
            label="Cancel"
            variant="ghost"
            disabled={mutation.isPending}
            onPress={() => setPreview(null)}
          />
        </View>
      </BottomSheet>
    </Screen>
  );
}

/** A version's saved change summary: header fields, affected workouts and entity counts. */
function RevisionChanges({ summary }: { summary: Preview['summary'] }) {
  const theme = useTheme();
  const entities = Object.entries(summary.entities).filter(
    ([, counts]) => counts.added || counts.changed || counts.removed,
  );
  return (
    <View style={{ gap: 8 }}>
      <Text variant="caption">Changed fields: {summary.headerChanges.join(', ') || 'none'}.</Text>
      {summary.affectedWorkouts?.map((workout, index) => (
        <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Badge
            label={workout.change}
            color={theme.accentText}
            background={theme.accentSoft}
            caps
          />
          <Text variant="caption" color="text" style={{ flex: 1 }} numberOfLines={2}>
            {formatShort(workout.date)} · {workout.title}
            {workout.previousDate && workout.previousDate !== workout.date
              ? ` (was ${formatShort(workout.previousDate)})`
              : ''}
          </Text>
        </View>
      ))}
      {entities.map(([name, counts]) => (
        <Text key={name} variant="caption">
          {name.replaceAll('_', ' ')}: {counts.added} added, {counts.changed} changed,{' '}
          {counts.removed} removed.
        </Text>
      ))}
    </View>
  );
}
