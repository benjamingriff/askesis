import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useCoachWord } from '../data/account';
import { useOpenPlanChat, usePlanLifecycle, type LifecycleAction } from '../data/plan-actions';
import {
  knownCoverage,
  planVersion,
  useBlocks,
  useBriefState,
  useDraftChanges,
  useWorkouts,
  type DraftChanges,
  type Plan,
} from '../data/plan-data';
import type { TrainingWeek, WorkoutSummary } from '../lib/api-types';
import { coveringRange, isCutback, type PlanBlock } from '../lib/blocks';
import {
  addDays,
  dayNumber,
  daysBetween,
  formatLong,
  formatMonth,
  formatRange,
  formatShort,
  monthGrid,
  shiftMonth,
  startOfWeek,
  WEEKDAYS_SHORT,
} from '../lib/format';
import { describeChanges, hasChanges } from '../lib/presenters';
import { planSports } from '../lib/sports';
import { useLocalToday } from '../lib/use-local-today';
import { isCovered, summarizeWeeks, volumeMeasure, workoutLook, workoutsOn } from '../lib/workouts';
import type { PlanView as View_ } from '../state/plan-selection';
import { effortTint, useTheme, useUnits } from '../state/settings';
import { BottomSheet } from './BottomSheet';
import {
  BlockTimeline,
  CoverageNote,
  StatusPill,
  WeekChart,
  WeekStatsRow,
  ZoneCards,
  zonesTitle,
} from './PlanWidgets';
import { ChangeBadge, DayRow, WorkoutChangesContext, type DayStatus } from './WorkoutRow';
import {
  ActionList,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  Notice,
  PressableScale,
  ProgressBar,
  SectionHeader,
  Segmented,
  Text,
  type IconName,
  type ListAction,
} from './ui';

/** Progress in Monday-start calendar weeks, matching the schedule's week numbers. */
export function planProgress(start: string | null, end: string | null, today: string) {
  if (!start || !end) return null;
  const first = startOfWeek(start);
  const weeks = Math.floor(daysBetween(first, end) / 7) + 1;
  const total = Math.max(1, daysBetween(start, end) + 1);
  const elapsed = daysBetween(start, today);
  if (elapsed < 0)
    return {
      value: 0,
      text: `Starts in ${-elapsed} ${elapsed === -1 ? 'day' : 'days'}`,
      weeks,
      week: null,
    };
  if (elapsed >= total) return { value: 1, text: 'Plan complete', weeks, week: null };
  const week = Math.floor(daysBetween(first, today) / 7) + 1;
  return { value: elapsed / total, text: `Week ${week} of ${weeks}`, weeks, week };
}

export const openWorkout = (workout: Pick<WorkoutSummary, 'id'>) =>
  router.push({ pathname: '/workout/[id]', params: { id: workout.id } });

type Confirm = Exclude<LifecycleAction, 'activate' | 'deactivate'> | 'menu' | null;

/**
 * One plan, end to end: state, lifecycle actions, shape, schedule and zones. Inside a chat it is
 * `embedded`: the title row is compact and "ask your coach" fills that chat's composer.
 */
export function PlanView({
  plan,
  view: requestedView,
  onViewChange,
  title,
  embedded = false,
  onAskCoach,
  headerLeft,
  headerRight,
  menuActions,
}: {
  plan: Plan;
  view: View_;
  onViewChange: (view: View_) => void;
  /** The screen title; the plan's name moves into the hero card. */
  title?: string;
  embedded?: boolean;
  /** Replaces opening the plan's chat, for example to prefill the chat already beside it. */
  onAskCoach?: (prompt: string) => void;
  headerLeft?: ReactNode;
  headerRight?: ReactNode;
  /** Extra entries at the top of the plan options sheet, such as switching plans. */
  menuActions?: ListAction[];
}) {
  const theme = useTheme();
  const today = useLocalToday();
  const view: View_ =
    requestedView === 'draft' && plan.draft ? 'draft' : plan.locked ? 'locked' : 'draft';
  const version = planVersion(plan, view);
  const brief = useBriefState(plan.id, version);
  const workouts = useWorkouts(version);
  const blockQuery = useBlocks(version);
  const blocks = blockQuery.data?.blocks ?? [];
  const storedWeeks = blockQuery.data?.weeks ?? [];
  const changes = useDraftChanges(plan.id, view === 'draft' ? plan.draft : null);
  const units = useUnits(brief.data?.brief.unit);
  const coach = useCoachWord();
  const chat = useOpenPlanChat(plan);
  const lifecycle = usePlanLifecycle(plan);
  const askCoach = onAskCoach ?? ((prompt: string) => chat.mutate(prompt));
  const [confirm, setConfirm] = useState<Confirm>(null);
  const progress = planProgress(version?.startDate ?? null, version?.endDate ?? null, today);
  const sports = planSports(brief.data?.brief, workouts.data);
  const goal = brief.data?.brief.goal;
  const pending = changes.data
    ? changes.data.workouts.length + (changes.data.omittedWorkouts ?? 0)
    : 0;

  const reviewAndLock = () =>
    router.push({ pathname: '/lock-review', params: { planId: plan.id } });
  const run = (action: LifecycleAction) =>
    lifecycle.mutate(action, {
      onSuccess: () => {
        setConfirm(null);
        if (action === 'unlock') onViewChange('draft');
        if (action === 'discard') onViewChange('locked');
      },
    });

  return (
    <View>
      {/* Title row */}
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: embedded ? 4 : 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        {headerLeft}
        {title ? (
          <Text variant="title" numberOfLines={1} style={{ flexShrink: 1 }}>
            {title}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {headerRight}
          <StatusPill
            plan={plan}
            onPress={
              plan.archived
                ? undefined
                : plan.draft
                  ? reviewAndLock
                  : () => {
                      lifecycle.reset();
                      setConfirm('unlock');
                    }
            }
          />
          <IconButton
            icon="ellipsis-horizontal"
            tone="filled"
            size={18}
            accessibilityLabel="Plan options"
            onPress={() => {
              lifecycle.reset();
              setConfirm('menu');
            }}
          />
        </View>
      </View>

      {plan.draft && plan.locked ? (
        <View style={{ paddingHorizontal: 20, marginTop: 14 }}>
          <Segmented<View_>
            value={view}
            onChange={onViewChange}
            options={[
              {
                value: 'locked',
                label: `Locked v${plan.locked.versionNumber}`,
                icon: 'lock-closed',
              },
              { value: 'draft', label: 'Draft', icon: 'create-outline' },
            ]}
          />
        </View>
      ) : null}

      {/* Plan hero */}
      <View style={{ paddingHorizontal: 20, marginTop: 14 }}>
        <Card style={{ padding: 18, gap: 16 }}>
          <View>
            {goal ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="flag" size={14} color={theme.accentText} />
                <Text variant="label" color="accent" numberOfLines={2} style={{ flex: 1 }}>
                  {goal}
                </Text>
              </View>
            ) : null}
            <Text
              variant="heading"
              style={{ marginTop: goal ? 6 : 0, fontSize: 24, lineHeight: 30 }}
            >
              {plan.displayName}
            </Text>
            <Text variant="caption" style={{ marginTop: 2 }}>
              {formatRange(version?.startDate ?? null, version?.endDate ?? null)}
              {plan.active ? ' · Active' : ' · Inactive'}
            </Text>
          </View>
          {blocks.length ? (
            <BlockTimeline
              blocks={blocks}
              startDate={version?.startDate ?? null}
              endDate={version?.endDate ?? null}
              today={today}
              races={workouts.data?.filter((workout) => workout.racePriority)}
            />
          ) : null}
          {progress ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <ProgressBar value={progress.value} height={6} />
              </View>
              <Text variant="caption" numeric style={{ fontWeight: '700' }}>
                {progress.text}
              </Text>
            </View>
          ) : null}
          {version?.description ? (
            <Text variant="caption" color="dim">
              {version.description}
            </Text>
          ) : null}
          {brief.data ? <CoverageNote state={brief.data} /> : null}
          {brief.error ? (
            <ErrorState message={brief.error.message} onRetry={() => void brief.refetch()} />
          ) : null}
          {blockQuery.error ? (
            <ErrorState
              message="Couldn’t load this plan’s training blocks."
              onRetry={() => void blockQuery.refetch()}
            />
          ) : null}
        </Card>
      </View>

      {chat.error ? (
        <ErrorState
          style={{ marginHorizontal: 20, marginTop: 12 }}
          message={`Couldn’t open your coach conversation: ${chat.error.message}`}
          onRetry={() => chat.mutate(chat.variables)}
        />
      ) : null}
      {lifecycle.error && !confirm ? (
        <ErrorState
          style={{ marginHorizontal: 20, marginTop: 12 }}
          message={lifecycle.error.message}
        />
      ) : null}

      {/* Draft state */}
      {view === 'draft' ? (
        <PressableScale
          onPress={plan.archived ? undefined : reviewAndLock}
          style={{
            marginHorizontal: 20,
            marginTop: 12,
            padding: 14,
            borderRadius: 20,
            backgroundColor: theme.accentSoft,
            borderWidth: 1,
            borderColor: theme.accentBorder,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Ionicons name="sparkles" size={20} color={theme.accentText} />
          <View style={{ flex: 1 }}>
            <Text variant="subheading">
              {pending
                ? `${pending} draft ${pending === 1 ? 'change' : 'changes'}`
                : plan.locked
                  ? 'Unpublished draft'
                  : 'Initial draft'}
            </Text>
            <Text variant="caption">
              {changes.data && hasChanges(changes.data)
                ? describeChanges(changes.data)
                : plan.locked
                  ? `Your ${coach} can edit this. Locked v${plan.locked.versionNumber} stays unchanged until you lock.`
                  : `Your ${coach} can edit this. Review and lock it to start following it.`}
            </Text>
          </View>
          {plan.archived ? null : (
            <Text variant="caption" color="accent" style={{ fontWeight: '800' }}>
              Review
            </Text>
          )}
        </PressableScale>
      ) : plan.draft ? (
        <Notice
          style={{ marginHorizontal: 20, marginTop: 12 }}
          icon="create-outline"
          action="View draft"
          onAction={() => onViewChange('draft')}
        >
          You have unpublished draft changes. This is the stable locked version.
        </Notice>
      ) : null}

      {view === 'draft' && changes.data && changes.data.workouts.length ? (
        <DraftChanges changes={changes.data} />
      ) : null}
      {view === 'draft' && changes.error ? (
        <ErrorState
          style={{ marginHorizontal: 20, marginTop: 12 }}
          message="Couldn’t load the draft’s changes."
          onRetry={() => void changes.refetch()}
        />
      ) : null}

      {(workouts.isPending || brief.isPending) && version ? (
        <LoadingState label="Loading schedule…" style={{ paddingHorizontal: 20 }} />
      ) : null}
      {workouts.error ? (
        <ErrorState
          style={{ marginHorizontal: 20, marginTop: 12 }}
          message={workouts.error.message}
          onRetry={() => void workouts.refetch()}
        />
      ) : null}
      {!version ? (
        <EmptyState
          style={{ marginHorizontal: 20, marginTop: 16 }}
          icon="calendar-outline"
          title="Nothing saved yet"
          dashed
        >
          {`Ask your ${coach} to plan your first weeks.`}
        </EmptyState>
      ) : null}

      {workouts.data && version && brief.data ? (
        <WorkoutChangesContext.Provider value={changes.data?.workouts ?? []}>
          <Schedule
            key={version.id}
            workouts={workouts.data}
            version={version}
            startDate={version.startDate}
            endDate={version.endDate}
            coverage={knownCoverage(brief.data)}
            blocks={blocks}
            storedWeeks={storedWeeks}
            units={units}
            today={today}
            onPlanRest={plan.archived ? undefined : () => askCoach('Plan the remaining weeks')}
          />
        </WorkoutChangesContext.Provider>
      ) : null}

      <SectionHeader
        title={zonesTitle(sports)}
        action={embedded ? undefined : 'Update'}
        onAction={() => router.push('/performance')}
      />
      <ZoneCards sports={sports} units={units} showSource />

      <View style={{ paddingHorizontal: 20, marginTop: 24, gap: 8 }}>
        <Text variant="label" style={{ paddingHorizontal: 4 }}>
          Planning
        </Text>
        <ActionList
          actions={[
            {
              label: view === 'draft' ? 'Edit brief' : 'View brief',
              icon: 'clipboard-outline',
              detail: brief.data
                ? !goal
                  ? 'No goal yet'
                  : brief.data.confirmed
                    ? 'Confirmed'
                    : 'Needs confirmation'
                : undefined,
              onPress: () =>
                router.push({
                  pathname: '/brief',
                  params:
                    view === 'draft'
                      ? { planId: plan.id }
                      : { planId: plan.id, revisionId: version?.id ?? '' },
                }),
            },
            !!plan.locked && {
              label: 'Version history',
              icon: 'time-outline',
              detail: `v${plan.locked.versionNumber}`,
              onPress: () =>
                router.push({ pathname: '/plan-history', params: { planId: plan.id } }),
            },
          ]}
        />
      </View>

      <PlanActionsSheet
        plan={plan}
        confirm={confirm}
        busy={lifecycle.isPending}
        error={confirm ? lifecycle.error?.message : undefined}
        embedded={embedded}
        extra={menuActions?.map((action) => ({
          ...action,
          onPress: () => {
            setConfirm(null);
            action.onPress();
          },
        }))}
        onClose={() => {
          if (!lifecycle.isPending) setConfirm(null);
        }}
        onConfirm={setConfirm}
        onRun={run}
        onCoach={() => {
          setConfirm(null);
          if (onAskCoach) onAskCoach('');
          else chat.mutate(undefined);
        }}
        onReview={() => {
          setConfirm(null);
          reviewAndLock();
        }}
        onOpen={(href) => {
          setConfirm(null);
          router.push(href);
        }}
      />
    </View>
  );
}

/**
 * Everything pending in the draft. Changed workouts are highlighted in the schedule itself;
 * removed ones are listed because they are no longer in it, and the rest can be listed and opened.
 */
function DraftChanges({ changes }: { changes: NonNullable<DraftChanges> }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const removed = changes.workouts.filter((change) => change.change === 'removed');
  const listed = changes.workouts.filter((change) => change.change !== 'removed');
  const row = (change: (typeof changes.workouts)[number], onPress?: () => void) => (
    <Pressable
      key={change.lineageId}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}
    >
      <ChangeBadge change={change} />
      <Text
        variant="caption"
        color={onPress ? 'text' : 'dim'}
        numberOfLines={1}
        style={[{ flex: 1 }, onPress ? { fontWeight: '600' } : null]}
      >
        {change.title}
      </Text>
      <Text variant="caption" numeric>
        {change.change === 'moved' && change.previousDate
          ? `${formatShort(change.previousDate)} → `
          : ''}
        {formatShort(change.date)}
      </Text>
      {onPress ? (
        <Ionicons name="chevron-forward" size={14} color={theme.colors.textMuted} />
      ) : null}
    </Pressable>
  );
  return (
    <Card style={{ marginHorizontal: 20, marginTop: 12, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text variant="label" style={{ flex: 1 }}>
          Changes in this draft
        </Text>
        <Text variant="caption" color="muted">
          {changes.workouts.length} {changes.workouts.length === 1 ? 'workout' : 'workouts'}
        </Text>
      </View>
      {changes.omittedWorkouts ? (
        <Text variant="caption" color="muted">
          More workouts changed than are listed. They are all in the schedule.
        </Text>
      ) : null}
      {removed.map((change) => row(change))}
      {listed.length ? (
        <>
          <Pressable
            onPress={() => setOpen(!open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}
          >
            <Text variant="caption" color="accent" style={{ fontWeight: '800' }}>
              {open ? 'Hide changed workouts' : `Show ${listed.length} changed workouts`}
            </Text>
            <Ionicons
              name={open ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={theme.accentText}
            />
          </Pressable>
          {open
            ? listed.map((change) =>
                row(
                  change,
                  change.workoutId ? () => openWorkout({ id: change.workoutId! }) : undefined,
                ),
              )
            : null}
        </>
      ) : null}
    </Card>
  );
}

const CONFIRM_COPY = {
  unlock: {
    body: 'Locking freezes your brief, pace guides and workouts together. Unlocking copies the current version into an editable draft. Your {coach} can then make changes, and you review and lock again when you are happy. The locked version stays unchanged.',
    action: 'Unlock and edit',
    icon: 'lock-open' as IconName,
  },
  discard: {
    body: 'All draft changes will be permanently removed. The locked version stays unchanged.',
    action: 'Discard draft',
    icon: 'trash' as IconName,
  },
  archive: {
    body: 'This plan will be deactivated and become read-only. All saved draft content and locked versions are retained.',
    action: 'Archive plan',
    icon: 'archive' as IconName,
  },
  unarchive: {
    body: 'This restores the saved draft and locked state to your library. The plan will remain inactive until you activate it.',
    action: 'Unarchive plan',
    icon: 'arrow-undo' as IconName,
  },
};

function PlanActionsSheet({
  plan,
  confirm,
  busy,
  error,
  embedded,
  extra,
  onClose,
  onConfirm,
  onRun,
  onCoach,
  onReview,
  onOpen,
}: {
  plan: Plan;
  confirm: Confirm;
  busy: boolean;
  error?: string;
  embedded: boolean;
  extra?: ListAction[];
  onClose: () => void;
  onConfirm: (next: Confirm) => void;
  onRun: (action: LifecycleAction) => void;
  onCoach: () => void;
  onReview: () => void;
  onOpen: (href: Href) => void;
}) {
  const coach = useCoachWord();
  const archived = plan.archived;
  const copy = confirm && confirm !== 'menu' ? CONFIRM_COPY[confirm] : null;
  return (
    <BottomSheet
      visible={!!confirm}
      onClose={onClose}
      title={
        confirm === 'unlock'
          ? `Plan v${plan.locked?.versionNumber ?? ''} is locked`
          : confirm === 'discard'
            ? 'Discard this draft?'
            : confirm === 'archive'
              ? 'Archive this plan?'
              : confirm === 'unarchive'
                ? 'Unarchive this plan?'
                : plan.displayName
      }
    >
      {copy && confirm && confirm !== 'menu' ? (
        <>
          <Text variant="body" color="dim">
            {copy.body.replace('{coach}', coach)}
          </Text>
          {error ? <ErrorState message={error} style={{ marginTop: 14 }} /> : null}
          <View style={{ gap: 10, marginTop: 20 }}>
            <Button
              label={copy.action}
              icon={copy.icon}
              busy={busy}
              variant={confirm === 'discard' || confirm === 'archive' ? 'danger' : 'primary'}
              onPress={() => onRun(confirm)}
            />
            <Button
              label={confirm === 'unlock' ? 'Keep locked' : 'Cancel'}
              variant="ghost"
              disabled={busy}
              onPress={onClose}
            />
          </View>
        </>
      ) : (
        <View style={{ gap: 12 }}>
          {!archived && plan.draft ? (
            <Button label="Review & lock" icon="lock-closed" onPress={onReview} />
          ) : null}
          <ActionList
            actions={[
              !embedded &&
                !archived && {
                  label:
                    coach === 'coach' ? 'Chat about this plan' : 'Ask your agent about this plan',
                  icon: 'chatbubble-ellipses-outline',
                  onPress: onCoach,
                },
              !archived && {
                label: 'Edit details',
                icon: 'create-outline',
                onPress: () => onOpen({ pathname: '/plan-details', params: { planId: plan.id } }),
              },
              {
                label: plan.draft ? 'Brief & pace guides' : 'View brief & pace guides',
                icon: 'clipboard-outline',
                onPress: () =>
                  onOpen({
                    pathname: '/brief',
                    params: plan.draft
                      ? { planId: plan.id }
                      : { planId: plan.id, revisionId: plan.locked?.id ?? '' },
                  }),
              },
              !!plan.locked && {
                label: 'Version history',
                icon: 'time-outline',
                onPress: () => onOpen({ pathname: '/plan-history', params: { planId: plan.id } }),
              },
              !!plan.draft && {
                label: 'Inspect draft content',
                icon: 'document-text-outline',
                onPress: () => onOpen({ pathname: '/draft-content', params: { planId: plan.id } }),
              },
            ]}
          />
          <ActionList
            actions={[
              !archived &&
                !plan.draft && {
                  label: 'Unlock to edit',
                  icon: 'lock-open-outline',
                  onPress: () => onConfirm('unlock'),
                },
              !archived &&
                !!plan.locked && {
                  label: plan.active ? 'Deactivate plan' : 'Activate plan',
                  icon: plan.active ? 'power' : 'flash-outline',
                  busy,
                  onPress: () => onRun(plan.active ? 'deactivate' : 'activate'),
                },
              ...(extra ?? []),
            ]}
          />
          <ActionList
            actions={[
              !archived &&
                !!plan.draft &&
                !!plan.locked && {
                  label: 'Discard draft…',
                  icon: 'trash-outline',
                  tone: 'danger',
                  onPress: () => onConfirm('discard'),
                },
              {
                label: archived ? 'Unarchive plan…' : 'Archive plan…',
                icon: archived ? 'arrow-undo-outline' : 'archive-outline',
                tone: archived ? 'default' : 'danger',
                onPress: () => onConfirm(archived ? 'unarchive' : 'archive'),
              },
            ]}
          />
          {error ? <ErrorState message={error} /> : null}
        </View>
      )}
    </BottomSheet>
  );
}

// ---- Schedule ----------------------------------------------------------------------------------

type Mode = 'weeks' | 'calendar';

export function Schedule({
  workouts,
  version,
  startDate,
  endDate,
  coverage,
  blocks,
  storedWeeks,
  units,
  today,
  onPlanRest,
}: {
  workouts: WorkoutSummary[];
  version: { id: string; editNumber: number };
  startDate: string | null;
  endDate: string | null;
  coverage: ReturnType<typeof knownCoverage>;
  blocks: PlanBlock[];
  storedWeeks: TrainingWeek[];
  units: ReturnType<typeof useUnits>;
  today: string;
  onPlanRest?: () => void;
}) {
  const coach = useCoachWord();
  const weeks = useMemo(
    () => summarizeWeeks(workouts, startDate, endDate, coverage),
    [workouts, startDate, endDate, coverage],
  );
  const measure = volumeMeasure(workouts);
  const current = weeks.find((w) => today >= w.startDate && today <= w.endDate)?.number ?? null;
  const firstUpcoming =
    current ?? weeks.find((w) => w.endDate >= today)?.number ?? weeks.at(-1)?.number ?? 1;
  const [mode, setMode] = useState<Mode>('weeks');
  const [selectedWeek, setSelectedWeek] = useState(firstUpcoming);
  const [month, setMonth] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const week = weeks.find((w) => w.number === selectedWeek) ?? weeks[0];
  const blockOf = (range: { startDate: string; endDate: string }) => coveringRange(blocks, range);
  const cutback = (range: { startDate: string; endDate: string }) => isCutback(storedWeeks, range);
  const dayStatus = (date: string): DayStatus =>
    (startDate && date < startDate) || (endDate && date > endDate)
      ? 'outside'
      : coverage && !isCovered(date, coverage)
        ? 'unplanned'
        : 'planned';

  if (!weeks.length || !week)
    return (
      <EmptyState
        style={{ marginHorizontal: 20, marginTop: 16 }}
        icon="calendar-outline"
        title="No workouts scheduled yet"
        dashed
      >
        {`Your ${coach} adds workouts as you plan together.`}
      </EmptyState>
    );

  const days = Array.from({ length: 7 }, (_, i) => addDays(week.startDate, i));
  const weekBlock = blockOf(week);
  const unplannedWeek = !week.planned;

  return (
    <View>
      <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'weeks', label: 'Weeks', icon: 'list' },
            { value: 'calendar', label: 'Calendar', icon: 'grid' },
          ]}
        />
      </View>
      {mode === 'weeks' ? (
        <>
          <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
            <WeekChart
              weeks={weeks}
              selected={week.number}
              current={current}
              onSelect={setSelectedWeek}
              measure={measure}
              blockOf={blockOf}
              isCutback={cutback}
            />
          </View>
          <View style={{ paddingHorizontal: 20, marginTop: 18 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <View style={{ flex: 1 }}>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                >
                  <Text variant="heading">Week {week.number}</Text>
                  {weekBlock ? <Tag label={weekBlock.label} effort={weekBlock.effort} /> : null}
                  {cutback(week) ? <Tag label="Cutback" /> : null}
                  {week.number === current ? <Tag label="This week" /> : null}
                </View>
                <Text variant="caption" style={{ marginTop: 2 }}>
                  {formatRange(week.startDate, week.endDate)}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <NavChip
                  icon="chevron-back"
                  label="Previous week"
                  disabled={week.number <= 1}
                  onPress={() => setSelectedWeek(week.number - 1)}
                />
                <NavChip
                  icon="chevron-forward"
                  label="Next week"
                  disabled={week.number >= weeks.length}
                  onPress={() => setSelectedWeek(week.number + 1)}
                />
              </View>
            </View>
            {week.sessions ? (
              <Card style={{ marginTop: 16 }}>
                <WeekStatsRow week={week} measure={measure} units={units} />
              </Card>
            ) : null}
          </View>
          <View style={{ marginTop: 18 }}>
            {unplannedWeek && !week.sessions ? (
              <EmptyState
                style={{ marginHorizontal: 20 }}
                icon="sparkles"
                title="Not planned yet"
                dashed
                action={
                  onPlanRest ? (
                    <Button
                      label={`Plan it with your ${coach}`}
                      icon="chatbubble-ellipses"
                      size="md"
                      onPress={onPlanRest}
                    />
                  ) : undefined
                }
              >
                This week is inside your plan but hasn’t been prescribed yet.
              </EmptyState>
            ) : (
              days.map((date) => (
                <DayRow
                  key={date}
                  date={date}
                  today={today}
                  workouts={workoutsOn(week.workouts, date)}
                  units={units}
                  version={version}
                  status={dayStatus(date)}
                  onOpen={openWorkout}
                />
              ))
            )}
          </View>
        </>
      ) : (
        <CalendarView
          workouts={workouts}
          month={month}
          onMonth={setMonth}
          selected={selectedDate}
          onSelect={setSelectedDate}
          today={today}
          units={units}
          version={version}
          dayStatus={dayStatus}
        />
      )}
    </View>
  );
}

function Tag({ label, effort }: { label: string; effort?: Parameters<typeof effortTint>[1] }) {
  const theme = useTheme();
  const color = effort ? effortTint(theme, effort) : null;
  return (
    <Badge
      label={label}
      size="sm"
      caps
      color={color ?? theme.colors.textMuted}
      background={color ? `${color}26` : theme.colors.surfaceRaised}
    />
  );
}

function NavChip({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: 'chevron-back' | 'chevron-forward';
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={disabled ? undefined : onPress}
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: theme.colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Ionicons name={icon} size={18} color={theme.colors.text} />
    </PressableScale>
  );
}

function CalendarView({
  workouts,
  month,
  onMonth,
  selected,
  onSelect,
  today,
  units,
  version,
  dayStatus,
}: {
  workouts: WorkoutSummary[];
  month: string;
  onMonth: (month: string) => void;
  selected: string;
  onSelect: (date: string) => void;
  today: string;
  units: ReturnType<typeof useUnits>;
  version: { id: string; editNumber: number };
  dayStatus: (date: string) => DayStatus;
}) {
  const theme = useTheme();
  const grid = useMemo(() => monthGrid(month), [month]);
  const efforts = [
    ...new Set(workouts.map((workout) => workoutLook(workout).effort).filter(Boolean)),
  ] as NonNullable<ReturnType<typeof workoutLook>['effort']>[];
  return (
    <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <Text variant="heading">{formatMonth(month)}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <NavChip
            icon="chevron-back"
            label="Previous month"
            disabled={false}
            onPress={() => onMonth(shiftMonth(month, -1))}
          />
          <NavChip
            icon="chevron-forward"
            label="Next month"
            disabled={false}
            onPress={() => onMonth(shiftMonth(month, 1))}
          />
        </View>
      </View>
      <View style={{ flexDirection: 'row', marginBottom: 6 }}>
        {WEEKDAYS_SHORT.map((d) => (
          <View key={d} style={{ flex: 1, alignItems: 'center' }}>
            <Text variant="label" style={{ fontSize: 10 }}>
              {d.slice(0, 2)}
            </Text>
          </View>
        ))}
      </View>
      {grid.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row' }}>
          {row.map((d) => {
            const items = workoutsOn(workouts, d);
            const outside = d.slice(0, 7) !== month.slice(0, 7);
            const active = d === selected;
            const look = items[0] ? workoutLook(items[0]) : null;
            const race = items.some((w) => w.racePriority);
            const color = look ? effortTint(theme, look.effort) : null;
            const status = dayStatus(d);
            return (
              <PressableScale
                key={d}
                haptic="select"
                onPress={() => onSelect(d)}
                scaleTo={0.9}
                accessibilityRole="button"
                accessibilityLabel={formatLong(d)}
                style={{
                  flex: 1,
                  height: 52,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: outside ? 0.3 : status === 'outside' ? 0.55 : 1,
                }}
              >
                <View
                  style={{
                    width: 38,
                    height: 44,
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    backgroundColor: active ? theme.accent : 'transparent',
                    borderWidth: d === today && !active ? 1.5 : 0,
                    borderColor: theme.accentBorder,
                  }}
                >
                  <Text
                    variant="subheading"
                    numeric
                    style={{
                      fontWeight: '700',
                      color: active ? theme.onAccent : theme.colors.text,
                    }}
                  >
                    {dayNumber(d)}
                  </Text>
                  {race ? (
                    <Ionicons
                      name="trophy"
                      size={11}
                      color={active ? theme.onAccent : theme.efforts.max}
                    />
                  ) : (
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: color ? (active ? theme.onAccent : color) : 'transparent',
                      }}
                    />
                  )}
                </View>
              </PressableScale>
            );
          })}
        </View>
      ))}
      {efforts.length ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 12,
            marginTop: 12,
            marginBottom: 20,
          }}
        >
          {efforts.map((effort) => (
            <View key={effort} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: theme.efforts[effort],
                }}
              />
              <Text variant="caption" style={{ fontSize: 12, textTransform: 'capitalize' }}>
                {effort}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text variant="label" style={{ marginBottom: 10 }}>
        {formatLong(selected)}
      </Text>
      <DayRow
        compact
        showDate={false}
        date={selected}
        today={today}
        workouts={workoutsOn(workouts, selected)}
        units={units}
        version={version}
        status={dayStatus(selected)}
        onOpen={openWorkout}
      />
    </View>
  );
}
