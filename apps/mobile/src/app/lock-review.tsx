import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CoverageNote, ZoneCards } from '../components/PlanWidgets';
import {
  Button,
  Card,
  ErrorState,
  IconButton,
  LoadingState,
  Notice,
  Screen,
  Text,
  useHaptics,
  type IconName,
} from '../components/ui';
import { useCoachWord } from '../data/account';
import { usePlan, writePlan, type BriefState, type Plan, type Preview } from '../data/plan-data';
import { api } from '../lib/api';
import {
  formatDistance,
  formatDuration,
  formatRange,
  formatShort,
  formatSwimDistance,
  WEEKDAYS_SHORT,
} from '../lib/format';
import { useRequestKey } from '../lib/request-key';
import { result } from '../lib/result';
import { SPORT_META, type BriefSport } from '../lib/sports';
import { usePlanSelection } from '../state/plan-selection';
import { useSportUnits, useTheme, useUnits } from '../state/settings';

const CHANGE_LABEL: Record<string, string> = {
  added: 'New',
  new: 'New',
  changed: 'Edited',
  updated: 'Edited',
  moved: 'Moved',
  removed: 'Removed',
  deleted: 'Removed',
};

function Check({
  checked,
  onToggle,
  label,
  sub,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  sub?: string;
}) {
  const theme = useTheme();
  const buzz = useHaptics();
  return (
    <Pressable
      onPress={() => {
        buzz('select');
        onToggle();
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        borderRadius: 18,
        backgroundColor: theme.colors.surfaceRaised,
      }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 9,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: checked ? theme.accent : 'transparent',
          borderWidth: 2,
          borderColor: checked ? theme.accent : theme.colors.textMuted,
        }}
      >
        {checked ? <Ionicons name="checkmark" size={16} color={theme.onAccent} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="subheading">{label}</Text>
        {sub ? <Text variant="caption">{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

function Assumption({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 9 }}>
      <Ionicons name={icon} size={18} color={theme.colors.textDim} style={{ marginTop: 2 }} />
      <Text variant="body" color="dim" style={{ width: 92 }}>
        {label}
      </Text>
      <Text variant="body" style={{ flex: 1, fontWeight: '600' }} numeric>
        {value}
      </Text>
    </View>
  );
}

type Answer = { status: 'unanswered' | 'unknown' | 'known'; value: unknown };

/** The brief as the coach will use it: what the human confirms before locking. */
function PlanningReview({ state }: { state: BriefState }) {
  const units = useUnits(state.brief.unit);
  const { pool } = useSportUnits();
  const show = (answer: Answer, format: (value: number) => string) =>
    answer.status === 'known'
      ? format(answer.value as number)
      : answer.status === 'unanswered'
        ? 'not answered'
        : 'unknown';
  const availability = state.brief.weekdays
    .map((value, index) =>
      value === 'unavailable'
        ? null
        : `${WEEKDAYS_SHORT[index]}${value === 'preferred' ? '★' : ''}`,
    )
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <Card>
        <Text variant="label" style={{ marginBottom: 6 }}>
          Planning assumptions
        </Text>
        {state.brief.goal ? (
          <Text variant="subheading" style={{ marginBottom: 4 }}>
            {state.brief.goal}
          </Text>
        ) : null}
        <Assumption
          icon="calendar"
          label="Dates"
          value={formatRange(state.startDate, state.endDate)}
        />
        {state.brief.sports.map((baseline) => {
          const meta = SPORT_META[baseline.sport as BriefSport];
          const distance = (value: number) =>
            baseline.sport === 'swim'
              ? formatSwimDistance(value, pool)
              : formatDistance(value, units);
          const sessions = `${show(baseline.currentSessions as Answer, String)} → ${baseline.desiredSessions ?? 'not set'} a week`;
          const detail =
            baseline.sport === 'strength'
              ? ''
              : baseline.sport === 'cycle'
                ? ` · ${show(baseline.weeklyDuration as Answer, formatDuration)} weekly · longest ${show(baseline.longestDuration as Answer, formatDuration)}`
                : ` · ${show(baseline.weeklyDistance as Answer, distance)} weekly · longest ${show(baseline.longestDistance as Answer, distance)}`;
          return (
            <Assumption
              key={baseline.sport}
              icon={meta?.icon ?? 'fitness'}
              label={meta?.label ?? baseline.sport}
              value={sessions + detail}
            />
          );
        })}
        <Assumption icon="today-outline" label="Days" value={availability || 'None'} />
        {state.brief.context ? (
          <Text variant="caption" style={{ marginTop: 6 }}>
            {state.brief.context}
          </Text>
        ) : null}
        <View style={{ marginTop: 10 }}>
          <CoverageNote state={state} />
        </View>
      </Card>
      <View style={{ marginHorizontal: -20 }}>
        <ZoneCards sports={state.brief.sports.map((s) => s.sport)} units={units} />
      </View>
    </>
  );
}

export default function LockReviewScreen() {
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const plan = usePlan(planId ?? null);
  if (!plan.data)
    return (
      <Screen top={false}>
        <View style={{ padding: 20 }}>
          {plan.error ? (
            <ErrorState message={plan.error.message} onRetry={() => void plan.refetch()} />
          ) : (
            <LoadingState label="Loading plan…" />
          )}
        </View>
      </Screen>
    );
  return <LockReview plan={plan.data} />;
}

function LockReview({ plan }: { plan: Plan }) {
  const theme = useTheme();
  const coach = useCoachWord();
  const insets = useSafeAreaInsets();
  const buzz = useHaptics();
  const client = useQueryClient();
  const { select } = usePlanSelection();
  const requestKey = useRequestKey();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [briefConfirmed, setBriefConfirmed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [locked, setLocked] = useState<number | null>(null);
  const pop = useRef(new Animated.Value(0)).current;
  const params = { path: { planId: plan.id } };

  const validate = useMutation({
    mutationFn: async () => result(await api.POST('/api/v1/plans/{planId}/validate', { params })),
    onMutate: () => {
      setPreview(null);
      setBriefConfirmed(false);
      setAcknowledged(false);
    },
    onSuccess: setPreview,
  });
  useEffect(() => {
    if (plan.draft) validate.mutate();
    // Validate once per opened review; Retry runs it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lock exactly what was reviewed: the preview carries the reviewed concurrency values.
  const lock = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error('Review the plan before locking.');
      const body = {
        expectedStateVersion: preview.stateVersion,
        expectedDraftId: preview.draftId,
        expectedEditNumber: preview.editNumber,
        ...(briefConfirmed && preview.briefReview && !preview.briefReview.confirmed
          ? { confirmBriefHash: preview.briefReview.hash }
          : {}),
        expectedContentHash: preview.contentHash,
        expectedValidationDigest: preview.validationDigest,
        acknowledgedWarningCodes: acknowledged
          ? preview.findings.filter((f) => f.severity === 'warning').map((f) => f.code)
          : [],
      };
      return result(
        await api.POST('/api/v1/plans/{planId}/lock', {
          params: {
            ...params,
            header: {
              'idempotency-key': requestKey({ body, preview, acknowledged, briefConfirmed }),
            },
          },
          body,
        }),
      );
    },
    onSuccess: async (updated) => {
      buzz('success');
      setLocked(updated.locked?.versionNumber ?? null);
      select({ planId: updated.id, view: 'locked' });
      writePlan(client, updated);
      // Let screens re-render with the new identities before anything refetches.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plans'] }),
        client.invalidateQueries({ queryKey: ['plan-workouts'] }),
      ]);
    },
    onError: () => {
      setPreview(null);
      void client.invalidateQueries({ queryKey: ['plans'] });
    },
  });

  useEffect(() => {
    if (locked === null) return;
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 10 }).start();
    const timer = setTimeout(() => router.back(), 1600);
    return () => clearTimeout(timer);
  }, [locked, pop]);

  const nextVersion = (plan.locked?.versionNumber ?? 0) + 1;

  if (locked !== null)
    return (
      <Screen>
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}
        >
          <Animated.View
            style={{
              width: 112,
              height: 112,
              borderRadius: 56,
              backgroundColor: theme.locked,
              alignItems: 'center',
              justifyContent: 'center',
              transform: [{ scale: pop }],
            }}
          >
            <Ionicons name="lock-closed" size={48} color="#06281D" />
          </Animated.View>
          <Text variant="title">Plan v{locked} locked</Text>
          <Text variant="body" color="dim" style={{ textAlign: 'center' }}>
            Your brief, pace guides and workouts are frozen together as version {locked}.
          </Text>
        </View>
      </Screen>
    );

  if (!plan.draft)
    return (
      <Screen>
        <View style={{ padding: 20, gap: 16 }}>
          <IconButton
            icon="close"
            tone="filled"
            accessibilityLabel="Close"
            onPress={() => router.back()}
          />
          <Card style={{ alignItems: 'center', paddingVertical: 32 }}>
            <Ionicons name="lock-closed" size={32} color={theme.locked} />
            <Text variant="heading" style={{ marginTop: 12 }}>
              Plan v{plan.locked?.versionNumber} is locked
            </Text>
            <Text variant="body" color="dim" style={{ textAlign: 'center', marginTop: 6 }}>
              Nothing to review. Unlock it from the Plan tab to open a new draft.
            </Text>
          </Card>
        </View>
      </Screen>
    );

  const errors = preview?.findings.filter((f) => f.severity === 'error') ?? [];
  const warnings = preview?.findings.filter((f) => f.severity === 'warning') ?? [];
  const blocking = errors.some(
    (f) => !(f.code === 'brief.confirmation_required' && briefConfirmed),
  );
  const needsBrief = !!preview?.briefReview && !preview.briefReview.confirmed;
  const ready =
    !!preview &&
    preview.hasChanges &&
    !blocking &&
    (!warnings.length || acknowledged) &&
    !lock.isPending;
  const workouts = preview?.summary.affectedWorkouts ?? [];
  const entities = Object.entries(preview?.summary.entities ?? {}).filter(
    ([, counts]) => counts.added || counts.changed || counts.removed,
  );
  const retry = () => {
    lock.reset();
    void client.invalidateQueries({ queryKey: ['plans'] }).then(() => validate.mutate());
  };

  return (
    <Screen top={false}>
      <View
        style={{
          paddingTop: 14,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <View style={{ flex: 1, paddingLeft: 8 }}>
          <Text variant="label">Review · {plan.displayName}</Text>
          <Text variant="title" style={{ fontSize: 26, lineHeight: 32 }}>
            Lock plan v{nextVersion}
          </Text>
        </View>
        <IconButton
          icon="close"
          tone="filled"
          accessibilityLabel="Close"
          onPress={() => router.back()}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 150, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="caption">
          {`Locking makes this version immutable. Confirming and locking are human decisions — your ${coach} can’t do them for you.`}
        </Text>
        {validate.isPending ? <LoadingState label="Checking the draft…" /> : null}
        {validate.error ? <ErrorState message={validate.error.message} onRetry={retry} /> : null}
        {lock.error ? <ErrorState message={lock.error.message} onRetry={retry} /> : null}

        {preview ? (
          <>
            {plan.draft.basedOnVersionId &&
            plan.locked &&
            plan.draft.basedOnVersionId !== plan.locked.id ? (
              <Notice tone="warning">
                This draft was restored from an older version. Locking it replaces the current
                schedule with the restored content while preserving all previous versions.
              </Notice>
            ) : null}
            {!preview.hasChanges ? (
              <Notice>
                No content changes since the locked version. Edit the draft or discard it; no new
                version will be created.
              </Notice>
            ) : null}

            {preview.briefReview ? (
              <>
                <PlanningReview state={preview.briefReview} />
                {needsBrief ? (
                  <Check
                    checked={briefConfirmed}
                    onToggle={() => setBriefConfirmed((v) => !v)}
                    label="These assumptions and pace guides are right"
                    sub={`Your ${coach} can update assumptions, but only you can confirm them.`}
                  />
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="checkmark-circle" size={16} color={theme.locked} />
                    <Text variant="caption">Assumptions already confirmed</Text>
                  </View>
                )}
              </>
            ) : null}

            <Card>
              <Text variant="label" style={{ marginBottom: 10 }}>
                What’s changing{plan.locked ? ` from v${plan.locked.versionNumber}` : ''}
              </Text>
              {preview.summary.headerChanges.length ? (
                <Text variant="caption" style={{ marginBottom: 8 }}>
                  Changed fields: {preview.summary.headerChanges.join(', ')}.
                </Text>
              ) : null}
              <View style={{ gap: 8 }}>
                {workouts.slice(0, 12).map((workout, index) => (
                  <View key={index} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                    <Text variant="label" color="accent" style={{ width: 62, fontSize: 10 }}>
                      {CHANGE_LABEL[workout.change] ?? workout.change}
                    </Text>
                    <Text variant="caption" color="text" style={{ flex: 1 }} numberOfLines={1}>
                      {formatShort(workout.date)} · {workout.title}
                      {workout.previousDate && workout.previousDate !== workout.date
                        ? ` (was ${formatShort(workout.previousDate)})`
                        : ''}
                    </Text>
                  </View>
                ))}
                {workouts.length > 12 ? (
                  <Text variant="caption" color="muted">
                    + {workouts.length - 12} more
                  </Text>
                ) : null}
                {entities.map(([entity, counts]) => (
                  <Text key={entity} variant="caption">
                    {entity.replaceAll('_', ' ')}: {counts.added} added, {counts.changed} changed,{' '}
                    {counts.removed} removed.
                  </Text>
                ))}
                {!workouts.length && !entities.length && !preview.summary.headerChanges.length ? (
                  <Text variant="body" color="dim">
                    No workout changes.
                  </Text>
                ) : null}
              </View>
            </Card>

            <Card>
              <Text variant="label" style={{ marginBottom: 10 }}>
                Things to know
              </Text>
              {preview.findings.length === 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="checkmark-circle" size={18} color={theme.locked} />
                  <Text variant="body">No validation issues.</Text>
                </View>
              ) : (
                <View style={{ gap: 14 }}>
                  {preview.findings.map((finding, index) => (
                    <View
                      key={`${finding.code}:${index}`}
                      style={{ flexDirection: 'row', gap: 12 }}
                    >
                      <Ionicons
                        name={finding.severity === 'error' ? 'close-circle' : 'alert-circle'}
                        size={20}
                        color={finding.severity === 'error' ? theme.danger : theme.warning}
                        style={{ marginTop: 1 }}
                      />
                      <Text variant="body" style={{ flex: 1 }}>
                        <Text style={{ fontWeight: '800' }}>
                          {finding.severity === 'error' ? 'Error: ' : 'Warning: '}
                        </Text>
                        {finding.message}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
              {warnings.length ? (
                <View style={{ marginTop: 14 }}>
                  <Check
                    checked={acknowledged}
                    onToggle={() => setAcknowledged((v) => !v)}
                    label="I’ve reviewed and accept these warnings"
                  />
                </View>
              ) : null}
            </Card>
          </>
        ) : null}
      </ScrollView>

      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 16),
          backgroundColor: theme.colors.bg,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
        }}
      >
        <Button
          label={`Lock plan v${nextVersion}`}
          icon="lock-closed"
          disabled={!ready}
          busy={lock.isPending}
          onPress={() => lock.mutate()}
        />
      </View>
    </Screen>
  );
}
