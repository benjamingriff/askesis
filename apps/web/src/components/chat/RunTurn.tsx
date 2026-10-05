import type { paths } from '@askesis/api-client';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { chatResult, isActive, type Conversation, type Run } from '../../chat';
import { daysBetween, formatShort } from '../../lib/format';
import { useSettings } from '../../settings';
import { ChatMarkdown } from '../ChatMarkdown';
import { ChangeBadge, describeChanges, hasChanges, type ChangeSummary } from '../PlanChanges';
import { Button, Notice, ProgressBar, cx } from '../ui';

export type Turn =
  paths['/api/v1/agent-runs/{runId}/turn']['get']['responses'][200]['content']['application/json'];
export type Message =
  paths['/api/v1/conversations/{conversationId}/messages']['get']['responses'][200]['content']['application/json']['messages'][number];

/** A run known only from conversation detail, before its turn projection has loaded. */
export const emptyTurn = (run: Run): Turn => ({
  ...run,
  activity: [],
  changes: null,
  legacyChanges: false,
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

/**
 * One coaching turn after the user's message, presented like the prototype's assistant
 * message: activity, any intermediate text, the reply and a card for saved plan changes. The
 * reply keeps its place when streamed text becomes the durable message.
 */
export function RunTurn({
  turn,
  reply,
  conversation,
  testMode,
  onReview,
}: {
  turn: Turn;
  /** The durable assistant message this run produced, once loaded. */
  reply: Message | undefined;
  conversation: Conversation | undefined;
  testMode: boolean;
  onReview?: (() => void) | undefined;
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
    output: live.data.output,
    replyTruncated: live.data.replyTruncated,
  };
  // Streamed items still include the final segment, dropped once the durable reply loads.
  const source = latestOutput(view.output, output.data?.items ?? []);
  const segments = source.filter(
    (item) => !(reply && (item.isFinal || item.content === reply.content)),
  );
  const incomplete = !reply && segments.length > 0;
  return (
    <article className="message assistant turn">
      <span className="message-author">
        <span className="coach-avatar" aria-hidden="true">
          <Sparkles size={12} />
        </span>
        Askesis
        {turn.status === 'failed' && incomplete ? (
          <small>Failed · incomplete</small>
        ) : turn.status === 'cancelled' && incomplete ? (
          <small>Stopped · incomplete</small>
        ) : active && segments.length ? (
          <small>Writing…</small>
        ) : testMode && reply ? (
          <small>test reply</small>
        ) : null}
      </span>
      <RunActivity run={view} conversation={conversation} />
      {segments.map((item) => (
        <div key={item.itemId} className="turn-segment">
          <ChatMarkdown content={item.content} />
          {item.truncated ? (
            <p className="run-note">Visible reply reached its length limit.</p>
          ) : null}
        </div>
      ))}
      {reply ? <ChatMarkdown content={reply.content} /> : null}
      {reply && view.replyTruncated ? (
        <p className="run-note">Reply shortened at its visible length limit.</p>
      ) : null}
      {output.error || live.error ? (
        <Notice
          tone="warning"
          action={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (output.error) void output.refetch();
                if (live.error) void live.refetch();
              }}
            >
              Retry
            </Button>
          }
        >
          Could not refresh this reply and its activity.
        </Notice>
      ) : null}
      {view.changes && hasChanges(view.changes) ? (
        <PlanUpdateCard summary={view.changes} onReview={onReview} />
      ) : view.legacyChanges ? (
        <PlanUpdateCard onReview={onReview} />
      ) : null}
    </article>
  );
}

/** A plan-wide run that belongs to another chat for the same plan. */
export function OtherChatRun({ run, conversation }: { run: Run; conversation: Conversation }) {
  const turn = useQuery({ ...turnQuery(run.id), enabled: isActive(run) });
  return (
    <>
      <RunActivity run={{ ...(turn.data ?? emptyTurn(run)), ...run }} conversation={conversation} />
      {turn.error ? (
        <Notice
          tone="warning"
          action={
            <Button size="sm" variant="ghost" onClick={() => void turn.refetch()}>
              Retry
            </Button>
          }
        >
          Could not refresh the coach’s activity.
        </Notice>
      ) : null}
    </>
  );
}

/**
 * The prototype's "Plan draft updated" card: what this run saved, the first few workouts and
 * a route to review them beside the chat. Without a summary (older turns) it says so.
 */
function PlanUpdateCard({
  summary,
  onReview,
}: {
  summary?: ChangeSummary | undefined;
  onReview?: (() => void) | undefined;
}) {
  const shown = summary?.workouts.slice(0, 3) ?? [];
  const more = summary
    ? summary.workouts.length + (summary.omittedWorkouts ?? 0) - shown.length
    : 0;
  const content = (
    <>
      <span className="plan-update-head">
        <span className="callout-icon">
          <CalendarDays size={16} aria-hidden="true" />
        </span>
        <span>
          <strong>Plan draft updated</strong>
          <small>
            {summary
              ? describeChanges(summary)
              : 'Saved before detailed change summaries were recorded.'}
          </small>
        </span>
        {onReview ? <ArrowRight size={16} aria-hidden="true" /> : null}
      </span>
      {shown.length ? (
        <ul className="plan-update-changes">
          {shown.map((change) => (
            <li key={change.lineageId}>
              <ChangeBadge change={change} />
              <span>{change.title}</span>
              <small>{formatShort(change.date)}</small>
            </li>
          ))}
        </ul>
      ) : null}
      {more > 0 ? <small className="plan-update-more">+ {more} more</small> : null}
      {onReview ? <span className="plan-update-cta">Review in Plan</span> : null}
    </>
  );
  return onReview ? (
    <button type="button" className="plan-update plan-update-card" onClick={onReview}>
      {content}
    </button>
  ) : (
    <div className="plan-update plan-update-card">{content}</div>
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
  set_fitness_calibration: { running: 'Setting pace guides', done: 'Set pace guides' },
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
 * progress. Committed changes always stay saved, even after Stop. Only a working turn is a
 * live region, so history does not announce itself.
 */
function RunActivity({ run, conversation }: { run: Turn; conversation: Conversation | undefined }) {
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
  return (
    <div className={cx('run-activity', run.status)} role={active ? 'status' : undefined}>
      <button
        type="button"
        className="run-summary"
        aria-expanded={open}
        disabled={!settings.showActivity || !actions.length}
        onClick={() => setOpen((value) => !value)}
      >
        {active ? (
          <Loader2 className="spin" size={15} aria-hidden="true" />
        ) : run.status === 'completed' ? (
          <Check size={15} aria-hidden="true" className="ok" />
        ) : (
          <TriangleAlert size={15} aria-hidden="true" className="warn" />
        )}
        <span>{summary}</span>
        {settings.showActivity && actions.length ? (
          open ? (
            <ChevronUp size={14} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} aria-hidden="true" />
          )
        ) : null}
      </button>
      {open && settings.showActivity ? (
        <ol className="run-steps">
          {actions.map((action) => (
            <li key={action.operationId}>
              {action.state === 'completed' ? (
                <Check size={13} aria-hidden="true" />
              ) : action.state === 'started' && active ? (
                <Loader2 className="spin" size={13} aria-hidden="true" />
              ) : (
                <TriangleAlert size={13} aria-hidden="true" />
              )}
              {actionLabel(action)}
              {action.state === 'failed'
                ? ' · failed'
                : action.state === 'started' && !active
                  ? ' · interrupted'
                  : ''}
            </li>
          ))}
        </ol>
      ) : null}
      {generation ? (
        <div className="generation">
          <div className="generation-copy">
            <CalendarDays size={14} aria-hidden="true" />
            <span>
              {generation.status === 'completed'
                ? 'Schedule generation completed.'
                : generation.status === 'interrupted'
                  ? 'Schedule generation remains unfinished.'
                  : 'Schedule generation in progress.'}{' '}
              Intended horizon {formatShort(generation.startDate)} –{' '}
              {formatShort(generation.endDate)}
              {generation.prescribedThrough
                ? ` · fully prescribed through ${formatShort(generation.prescribedThrough)}`
                : ' · waiting for the first saved batch'}
            </span>
          </div>
          <ProgressBar value={generationProgress} label="Schedule generation progress" />
        </div>
      ) : null}
      {failure ? <p className="run-note">{failure}</p> : null}
      {run.status === 'failed' || run.status === 'cancelled' ? (
        <p className="run-note">
          Completed plan changes remain saved; review your draft before continuing.
        </p>
      ) : null}
      {conversation && run.conversationId !== conversation.id ? (
        <p className="run-note">
          Running in <Link to={`/chat/${run.conversationId}`}>another chat for this plan</Link>
        </p>
      ) : null}
    </div>
  );
}
