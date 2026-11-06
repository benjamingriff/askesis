import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, View } from 'react-native';
import {
  chatResult,
  isActive,
  type ChangeSummary,
  type Conversation,
  type Message,
  type Run,
  type Turn,
} from '../../data/chat';
import { api } from '../../lib/api';
import { daysBetween, formatShort } from '../../lib/format';
import { describeChanges, hasChanges } from '../../lib/presenters';
import { useSettings, useTheme } from '../../state/settings';
import { ChangeBadge } from '../WorkoutRow';
import { AccentFill, Notice, PressableScale, ProgressBar, Text } from '../ui';
import { RichText } from './RichText';

/** A run known only from conversation detail, before its turn projection has loaded. */
export const emptyTurn = (run: Run): Turn => ({
  ...run,
  activity: [],
  changes: null,
  legacyChanges: false,
  performanceChanged: false,
  output: [],
  replyTruncated: false,
});

/**
 * Merge the live text read with the turn projection, keeping each item's highest revision.
 * Text only grows, so neither an older cached stream nor a stale projection can win.
 */
function latestOutput(...sources: Turn['output'][]) {
  const items = new Map<string, Turn['output'][number]>();
  for (const item of sources.flat()) {
    const known = items.get(item.itemId);
    if (!known || item.revision > known.revision) items.set(item.itemId, item);
  }
  return [...items.values()].sort((a, b) => a.position - b.position);
}

const turnQuery = (runId: string) => ({
  queryKey: ['chat', 'turn', runId],
  queryFn: async () =>
    chatResult(await api.GET('/api/v1/agent-runs/{runId}/turn', { params: { path: { runId } } })),
});

function Dots() {
  const theme = useTheme();
  const anims = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const loops = anims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(a, {
            toValue: 1,
            duration: 320,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(a, {
            toValue: 0.3,
            duration: 320,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(280 - i * 140),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [anims]);
  return (
    <View style={{ flexDirection: 'row', gap: 5, height: 22, alignItems: 'center' }}>
      {anims.map((a, i) => (
        <Animated.View
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: theme.colors.textDim,
            opacity: a,
          }}
        />
      ))}
    </View>
  );
}

export function UserMessage({ content }: { content: string }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'flex-end', paddingLeft: 48 }}>
      <View
        style={{
          backgroundColor: theme.colors.surfaceRaised,
          borderRadius: 22,
          borderBottomRightRadius: 6,
          paddingHorizontal: 16,
          paddingVertical: 11,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        }}
      >
        <Text selectable>{content}</Text>
      </View>
    </View>
  );
}

function CoachHeader({ note }: { note?: string | null }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <AccentFill />
        <Ionicons name="sparkles" size={12} color={theme.onAccent} />
      </View>
      <Text variant="caption" style={{ fontWeight: '800' }} color="text">
        Coach
      </Text>
      {note ? (
        <Text variant="caption" color="muted">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

export function AssistantMessage({ content, testMode }: { content: string; testMode: boolean }) {
  return (
    <View style={{ gap: 10, paddingRight: 8 }}>
      <CoachHeader note={testMode ? 'test reply' : null} />
      <RichText text={content} />
    </View>
  );
}

/**
 * One coaching turn after the user's message: activity, any intermediate text, the reply and a
 * card for saved plan changes. The reply keeps its place when streamed text becomes the durable
 * message.
 */
export function TurnView({
  turn,
  reply,
  conversation,
  testMode,
  onReview,
}: {
  turn: Turn;
  reply: Message | undefined;
  conversation: Conversation | undefined;
  testMode: boolean;
  onReview?: () => void;
}) {
  const active = isActive(turn);
  // Activity and saved changes update live while the run works; afterwards the conversation's
  // run list (which seeds this cache) is authoritative.
  const live = useQuery({ ...turnQuery(turn.id), enabled: active, initialData: turn });
  const output = useQuery({
    queryKey: ['chat', 'output', turn.id],
    enabled: active,
    queryFn: async () =>
      chatResult(
        await api.GET('/api/v1/agent-runs/{runId}/output', {
          params: { path: { runId: turn.id } },
        }),
      ),
  });
  const view: Turn = {
    ...turn,
    activity: live.data.activity,
    changes: live.data.changes,
    legacyChanges: live.data.legacyChanges,
    performanceChanged: live.data.performanceChanged,
    output: live.data.output,
    replyTruncated: live.data.replyTruncated,
  };
  // Once the durable reply has loaded it presents the final segment.
  const segments = latestOutput(view.output, output.data?.items ?? []).filter(
    (item) => !(reply && (item.isFinal || reply.content.startsWith(item.content))),
  );
  const incomplete = !reply && segments.length > 0;
  const note =
    turn.status === 'failed' && incomplete
      ? 'Failed · incomplete'
      : turn.status === 'cancelled' && incomplete
        ? 'Stopped · incomplete'
        : active && segments.length
          ? 'Writing…'
          : testMode && reply
            ? 'test reply'
            : null;
  return (
    <View style={{ gap: 10, paddingRight: 8 }}>
      <CoachHeader note={note} />
      <RunActivity run={view} conversation={conversation} />
      {active && !segments.length && !reply ? <Dots /> : null}
      {segments.map((item, index) => (
        <View key={item.itemId}>
          <RichText
            text={item.content}
            cursor={active && !reply && index === segments.length - 1}
          />
          {item.truncated ? (
            <Text variant="caption" color="muted">
              Visible reply reached its length limit.
            </Text>
          ) : null}
        </View>
      ))}
      {reply ? <RichText text={reply.content} /> : null}
      {reply && view.replyTruncated ? (
        <Text variant="caption" color="muted">
          Reply shortened at its visible length limit.
        </Text>
      ) : null}
      {output.error || live.error ? (
        <Notice
          tone="warning"
          action="Retry"
          onAction={() => {
            if (output.error) void output.refetch();
            if (live.error) void live.refetch();
          }}
        >
          Could not refresh this reply and its activity.
        </Notice>
      ) : null}
      {view.changes && hasChanges(view.changes) ? (
        <PlanUpdateCard summary={view.changes} onReview={onReview} />
      ) : view.legacyChanges ? (
        <PlanUpdateCard onReview={onReview} />
      ) : null}
      {view.performanceChanged ? <PerformanceUpdateCard /> : null}
    </View>
  );
}

/** A plan-wide run that belongs to another chat for the same plan. */
export function OtherChatRun({ run, conversation }: { run: Run; conversation: Conversation }) {
  const turn = useQuery({ ...turnQuery(run.id), enabled: isActive(run) });
  return (
    <RunActivity run={{ ...(turn.data ?? emptyTurn(run)), ...run }} conversation={conversation} />
  );
}

function PlanUpdateCard({ summary, onReview }: { summary?: ChangeSummary; onReview?: () => void }) {
  const theme = useTheme();
  const shown = summary?.workouts.slice(0, 3) ?? [];
  const more = summary
    ? summary.workouts.length + (summary.omittedWorkouts ?? 0) - shown.length
    : 0;
  return (
    <PressableScale
      onPress={onReview}
      disabled={!onReview}
      scaleTo={0.985}
      accessibilityRole="button"
      accessibilityLabel="Review plan changes"
      style={{
        borderRadius: 20,
        backgroundColor: theme.accentSoft,
        borderWidth: 1,
        borderColor: theme.accentBorder,
        padding: 14,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <AccentFill />
          <Ionicons name="calendar" size={16} color={theme.onAccent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="subheading">Plan draft updated</Text>
          <Text variant="caption">
            {summary
              ? describeChanges(summary)
              : 'Saved before detailed change summaries were recorded.'}
          </Text>
        </View>
        {onReview ? <Ionicons name="arrow-forward" size={18} color={theme.accentText} /> : null}
      </View>
      {shown.length ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          {shown.map((change) => (
            <View
              key={change.lineageId}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <ChangeBadge change={change} />
              <Text variant="caption" color="text" numberOfLines={1} style={{ flex: 1 }}>
                {change.title}
              </Text>
              <Text variant="caption">{formatShort(change.date)}</Text>
            </View>
          ))}
          {more > 0 ? (
            <Text variant="caption" color="muted">
              + {more} more
            </Text>
          ) : null}
        </View>
      ) : null}
      {onReview ? (
        <Text variant="caption" color="accent" style={{ marginTop: 12, fontWeight: '800' }}>
          Swipe → or tap to review in Plan
        </Text>
      ) : null}
    </PressableScale>
  );
}

/** Fitness recorded from chat changes pace guides in every plan, so it links to Performance. */
function PerformanceUpdateCard() {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={() => router.push('/performance')}
      scaleTo={0.985}
      accessibilityRole="button"
      style={{
        borderRadius: 20,
        backgroundColor: theme.accentSoft,
        borderWidth: 1,
        borderColor: theme.accentBorder,
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Ionicons name="speedometer" size={20} color={theme.accentText} />
      <View style={{ flex: 1 }}>
        <Text variant="subheading">Pace guides updated</Text>
        <Text variant="caption">
          Every plan uses them from today. Earlier workouts keep their paces.
        </Text>
      </View>
      <Ionicons name="arrow-forward" size={18} color={theme.accentText} />
    </PressableScale>
  );
}

const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  read_plan_context: { running: 'Reading your plan', done: 'Read your plan' },
  read_schedule: { running: 'Reading the schedule', done: 'Read the schedule' },
  create_plan_draft: { running: 'Creating a plan draft', done: 'Created a plan draft' },
  update_plan_brief: {
    running: 'Updating planning assumptions',
    done: 'Updated planning assumptions',
  },
  read_performance: { running: 'Reading your fitness', done: 'Read your fitness' },
  preview_performance: { running: 'Comparing a result', done: 'Compared a result' },
  record_performance: { running: 'Updating pace guides', done: 'Updated pace guides' },
  retract_performance: { running: 'Withdrawing a result', done: 'Withdrew a result' },
  apply_schedule_changes: { running: 'Updating workouts', done: 'Updated workouts' },
  replace_schedule_range: { running: 'Writing the schedule', done: 'Wrote the schedule' },
  validate_plan: { running: 'Checking the plan', done: 'Checked the plan' },
};

const RUN_LABELS: Record<Run['status'], string> = {
  queued: 'Queued',
  running: 'Working',
  cancelling: 'Stopping…',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Stopped',
};

const actionLabel = (action: Turn['activity'][number]) =>
  TOOL_LABELS[action.name]?.[action.state === 'completed' ? 'done' : 'running'] ?? 'Plan action';

/**
 * T3-style activity card for one turn: what the coach is doing or did, and schedule generation
 * progress. Committed changes always stay saved, even after Stop.
 */
function RunActivity({ run, conversation }: { run: Turn; conversation: Conversation | undefined }) {
  const theme = useTheme();
  const { settings } = useSettings();
  const active = isActive(run);
  const [open, setOpen] = useState(false);
  const actions = run.activity;
  const seconds =
    run.startedAt && run.finishedAt
      ? Math.max(1, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000))
      : null;
  const generation = run.generation;
  const generationProgress =
    generation && generation.prescribedThrough
      ? Math.min(
          1,
          (daysBetween(generation.startDate, generation.prescribedThrough) + 1) /
            (daysBetween(generation.startDate, generation.endDate) + 1),
        )
      : 0;
  const latest = actions.at(-1);
  const summary = active
    ? run.status === 'running'
      ? latest
        ? `${RUN_LABELS.running} · ${actionLabel(latest)}${latest.state === 'failed' ? ' · failed' : ''}`
        : RUN_LABELS.running
      : RUN_LABELS[run.status]
    : `${RUN_LABELS[run.status]}${seconds ? ` · ${seconds}s` : ''}${actions.length ? ` · ${actions.length} ${actions.length === 1 ? 'action' : 'actions'}` : ''}`;
  const failure =
    run.failureCode === 'STALE_CONTEXT'
      ? 'The plan changed; refresh context before sending again.'
      : run.failureCode === 'EXECUTION_TIMEOUT'
        ? 'Execution timed out. You can send another message.'
        : run.failureCode
          ? 'Execution stopped. You can send another message.'
          : null;
  const expandable = settings.showActivity && actions.length > 0;
  if (!settings.showActivity && !active && !generation && !failure && run.status === 'completed')
    return null;
  return (
    <View
      style={{
        borderRadius: 16,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        overflow: 'hidden',
      }}
    >
      <PressableScale
        onPress={() => setOpen((o) => !o)}
        disabled={!expandable}
        scaleTo={0.99}
        haptic="select"
        accessibilityRole="button"
        accessibilityLabel={summary}
        accessibilityState={{ expanded: open }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 12,
          height: 40,
        }}
      >
        {active ? (
          <ActivityIndicator size="small" color={theme.accentText} />
        ) : run.status === 'completed' ? (
          <Ionicons name="checkmark-circle" size={16} color={theme.locked} />
        ) : (
          <Ionicons name="warning" size={16} color={theme.warning} />
        )}
        <Text variant="caption" numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>
          {summary}
        </Text>
        {expandable ? (
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={theme.colors.textMuted}
          />
        ) : null}
      </PressableScale>
      {open && expandable ? (
        <View
          style={{
            paddingHorizontal: 12,
            paddingBottom: 12,
            gap: 8,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
            paddingTop: 10,
          }}
        >
          {actions.map((action) => (
            <View
              key={action.operationId}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              {action.state === 'completed' ? (
                <Ionicons name="checkmark" size={14} color={theme.colors.textMuted} />
              ) : action.state === 'started' && active ? (
                <ActivityIndicator
                  size="small"
                  color={theme.accentText}
                  style={{ width: 14, height: 14 }}
                />
              ) : (
                <Ionicons name="warning-outline" size={14} color={theme.warning} />
              )}
              <Text variant="caption" style={{ flex: 1 }}>
                {actionLabel(action)}
                {action.state === 'failed'
                  ? ' · failed'
                  : action.state === 'started' && !active
                    ? ' · interrupted'
                    : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {generation ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>
          <Text variant="caption">
            {generation.status === 'completed'
              ? 'Schedule generation completed.'
              : generation.status === 'interrupted'
                ? 'Schedule generation remains unfinished.'
                : 'Schedule generation in progress.'}{' '}
            {formatShort(generation.startDate)} – {formatShort(generation.endDate)}
            {generation.prescribedThrough
              ? ` · prescribed through ${formatShort(generation.prescribedThrough)}`
              : ' · waiting for the first saved batch'}
          </Text>
          <ProgressBar value={generationProgress} height={6} />
        </View>
      ) : null}
      {failure || run.status === 'failed' || run.status === 'cancelled' ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 4 }}>
          {failure ? (
            <Text variant="caption" color="muted">
              {failure}
            </Text>
          ) : null}
          {run.status === 'failed' || run.status === 'cancelled' ? (
            <Text variant="caption" color="muted">
              Completed plan changes remain saved; review your draft before continuing.
            </Text>
          ) : null}
        </View>
      ) : null}
      {conversation && run.conversationId !== conversation.id ? (
        <PressableScale
          onPress={() =>
            router.push({ pathname: '/chat/[id]', params: { id: run.conversationId } })
          }
          style={{ paddingHorizontal: 12, paddingBottom: 12 }}
        >
          <Text variant="caption" color="accent" style={{ fontWeight: '700' }}>
            Running in another chat for this plan →
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}
