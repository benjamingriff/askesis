import type { Activity, EffortSegment, WorkoutActual, WorkoutSummary } from '@askesis/api-client';
import {
  Check,
  CircleDashed,
  ExternalLink,
  Link2,
  Link2Off,
  RefreshCw,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { PlanVersion } from '../plan-data';
import {
  useActivityDecision,
  useConnectStrava,
  useDisconnectStrava,
  useIntegrations,
  useOutcome,
  useStravaSync,
  useWorkoutActual,
  type Outcome,
} from '../activity-data';
import {
  formatDistance,
  formatDuration,
  formatPace,
  formatPower,
  formatShort,
  formatSpeed,
  formatSwimDistance,
  formatSwimPace,
  relativeTime,
  WEEKDAYS_SHORT,
  weekdayIndex,
  type PoolUnits,
} from '../lib/format';
import { useSportUnits, type Units } from '../settings';
import { Button, cx, Dialog, ErrorState, LoadingState, Notice } from './ui';

// ---- Outcomes ------------------------------------------------------------------------------------

const STATUS_META = {
  completed: { label: 'Done', icon: Check },
  partial: { label: 'Partial', icon: CircleDashed },
  missed: { label: 'Missed', icon: X },
} as const;

/** "Done", "Done · Tue" when moved, "Done early" when ahead of the plan. */
export function outcomeLabel(outcome: Outcome): string {
  if (outcome.status === 'planned') return '';
  const base = STATUS_META[outcome.status].label;
  if (!outcome.dayOffset) return base;
  return outcome.dayOffset < 0
    ? `${base} early`
    : `${base} ${outcome.dayOffset === 1 ? 'a day' : `${outcome.dayOffset} days`} late`;
}

export function OutcomeIcon({ outcome, size = 12 }: { outcome: Outcome; size?: number }) {
  if (outcome.status === 'planned') return null;
  const Icon = STATUS_META[outcome.status].icon;
  return <Icon size={size} aria-hidden="true" />;
}

/** A small status chip beside the workout kind, once activities are connected. */
export function OutcomeBadge({ workoutId }: { workoutId: string }) {
  const outcome = useOutcome(workoutId);
  if (!outcome || outcome.status === 'planned') return null;
  return (
    <em className={cx('outcome-badge', outcome.status)}>
      <OutcomeIcon outcome={outcome} size={11} /> {outcomeLabel(outcome)}
    </em>
  );
}

// ---- Activity numbers --------------------------------------------------------------------------

/** Headline numbers for a recorded activity, in its sport's usual units. */
export function activityStats(activity: Activity, units: Units, pool: PoolUnits) {
  const seconds = activity.movingSeconds ?? activity.elapsedSeconds;
  const stats: { label: string; value: string }[] = [];
  if (activity.distanceMetres)
    stats.push({
      label: 'Distance',
      value:
        activity.sport === 'swim'
          ? formatSwimDistance(activity.distanceMetres, pool)
          : formatDistance(activity.distanceMetres, units),
    });
  stats.push({
    label: 'Time',
    value: formatDuration(activity.sport === 'strength' ? activity.elapsedSeconds : seconds),
  });
  if (activity.distanceMetres && seconds) {
    if (activity.sport === 'run')
      stats.push({
        label: 'Pace',
        value: formatPace((seconds / activity.distanceMetres) * 1000, units),
      });
    if (activity.sport === 'swim')
      stats.push({
        label: 'Pace',
        value: formatSwimPace((seconds / activity.distanceMetres) * 100, pool),
      });
    if (activity.sport === 'cycle')
      stats.push({ label: 'Speed', value: formatSpeed(activity.distanceMetres / seconds, units) });
  }
  if (activity.averageWatts)
    stats.push({ label: 'Power', value: formatPower(activity.averageWatts) });
  return stats;
}

/** Strava's brand guidelines: link text "View on Strava", bold or orange. */
export function ViewOnStrava({ activity }: { activity: Activity }) {
  return (
    <a className="strava-link" href={activity.sourceUrl} target="_blank" rel="noreferrer">
      View on Strava <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}

const dayLabel = (date: string) => `${WEEKDAYS_SHORT[weekdayIndex(date)]} ${formatShort(date)}`;

// ---- Efforts -------------------------------------------------------------------------------------

function intensityText(segment: EffortSegment, sport: string, units: Units, pool: PoolUnits) {
  if (!segment.band || segment.actualIntensity === null) return null;
  if (segment.band.metric === 'power') {
    return {
      actual: formatPower(segment.actualIntensity),
      target: `${Math.round(segment.band.low)}–${formatPower(segment.band.high)}`,
    };
  }
  // Speed bands come back as metres per second; show them as the sport's pace.
  const pace = (speed: number) =>
    sport === 'swim' ? formatSwimPace(100 / speed, pool) : formatPace(1000 / speed, units);
  return {
    actual: pace(segment.actualIntensity),
    target: `${pace(segment.band.high)}–${pace(segment.band.low)}`,
  };
}

const VERDICT_COPY: Record<string, string> = {
  no_laps:
    'This activity has a single lap, so its reps can’t be checked. Press lap at each rep, or follow the workout on your watch.',
  auto_laps:
    'Automatic kilometre laps hide the reps. Press lap at each rep, or follow the workout on your watch.',
  unaligned: 'The laps don’t line up with the prescription, so reps weren’t checked.',
};

function EffortChecks({
  actual,
  units,
}: {
  actual: WorkoutActual['activities'][number];
  units: Units;
}) {
  const { pool } = useSportUnits();
  const [showAll, setShowAll] = useState(false);
  const efforts = actual.efforts;
  if (actual.lapsPending)
    return <p className="muted small">Laps arrive with the next sync, then reps are checked.</p>;
  if (!efforts || efforts.verdict === 'not_applicable') return null;
  if (efforts.verdict !== 'aligned')
    return <p className="muted small">{VERDICT_COPY[efforts.verdict]}</p>;
  const keyRole = efforts.segments.some((s) => s.role === 'work') ? 'work' : 'main';
  const shown = showAll ? efforts.segments : efforts.segments.filter((s) => s.role === keyRole);
  const { work } = efforts;
  return (
    <div className="effort-checks">
      <p className="effort-summary">
        <strong>
          {work.done} of {work.planned} {keyRole === 'work' ? 'reps' : 'main sets'} done
        </strong>
        {work.checked ? (
          <span className="muted">
            {' '}
            · {work.onTarget} of {work.checked} on target
          </span>
        ) : null}
      </p>
      <ol className="effort-list">
        {shown.map((segment, index) => {
          const intensity = intensityText(segment, actual.sport, units, pool);
          return (
            <li
              key={`${segment.stepId}-${index}`}
              className={cx('effort-row', segment.status, segment.intensity ?? undefined)}
            >
              <span className="effort-name">
                {segment.label}
                {segment.repeat ? (
                  <small>
                    {' '}
                    {segment.repeat.index}/{segment.repeat.count}
                  </small>
                ) : null}
              </span>
              <span className="effort-amount">
                {segment.status === 'not_found'
                  ? 'Not in laps'
                  : segment.measure === 'distance' && segment.actualMetres !== null
                    ? `${Math.round(segment.actualMetres)} m`
                    : formatDuration(segment.actualSeconds)}
              </span>
              <span
                className="effort-intensity"
                title={intensity ? `Target ${intensity.target}` : undefined}
              >
                {intensity ? intensity.actual : ''}
                {segment.intensity === 'on_target' ? (
                  <Check size={13} aria-label="On target" />
                ) : segment.intensity ? (
                  <TriangleAlert
                    size={13}
                    aria-label={
                      segment.intensity === 'above' ? 'Harder than target' : 'Easier than target'
                    }
                  />
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="text-link small"
        onClick={() => setShowAll((value) => !value)}
      >
        {showAll ? 'Show key efforts only' : 'Show every lap'}
      </button>
    </div>
  );
}

// ---- Workout dialog section -------------------------------------------------------------------

/** What actually happened: linked activities, rep checks and other activities to link instead. */
export function WorkoutActualSection({
  workout,
  version,
  units,
  today,
}: {
  workout: WorkoutSummary;
  version: Pick<PlanVersion, 'id' | 'editNumber'> | null | undefined;
  units: Units;
  today: string;
}) {
  const integrations = useIntegrations().data;
  const connected = !!integrations?.strava.connection;
  const actual = useWorkoutActual(workout.id, version, connected);
  const decide = useActivityDecision(workout.id, version);
  const [choosing, setChoosing] = useState(false);
  const { pool } = useSportUnits();
  if (!integrations || (!connected && workout.scheduledDate > today)) return null;
  if (!connected)
    return (
      <section className="actual-section" aria-label="What you did">
        <h3 className="steps-heading">What you did</h3>
        <p className="muted small">
          Connect Strava in <Link to="/settings#connections">Settings</Link> to see whether this
          session was done and how each rep went.
        </p>
      </section>
    );
  if (actual.isPending) return <LoadingState>Loading what you did…</LoadingState>;
  if (actual.error)
    return <ErrorState message={actual.error.message} onRetry={() => void actual.refetch()} />;
  const { outcome, activities, candidates } = actual.data;
  const unlinked = candidates.filter((c) => c.linkedWorkoutId === null);
  return (
    <section className={cx('actual-section', outcome.status)} aria-label="What you did">
      <div className="actual-heading">
        <h3 className="steps-heading">What you did</h3>
        {outcome.status !== 'planned' ? (
          <span className={cx('outcome-badge', outcome.status)}>
            <OutcomeIcon outcome={outcome} size={12} /> {outcomeLabel(outcome)}
          </span>
        ) : null}
      </div>
      {decide.error ? <Notice tone="danger">{decide.error.message}</Notice> : null}
      {activities.length === 0 ? (
        <p className="muted small">
          {outcome.status === 'missed'
            ? 'No activity matched this session.'
            : 'Nothing recorded yet. Activities appear after Strava syncs.'}
        </p>
      ) : null}
      {activities.map((activity) => (
        <article className="actual-activity" key={activity.id}>
          <header>
            <div>
              <strong>{activity.name || activity.sourceSportType}</strong>
              <small className="muted">
                {dayLabel(activity.date)} · {activity.sourceSportType}
                {outcome.matchedBy === 'manual' ? ' · linked by you' : ' · matched automatically'}
              </small>
            </div>
            <ViewOnStrava activity={activity} />
          </header>
          <div className="actual-stats">
            {activityStats(activity, units, pool).map((stat) => (
              <span key={stat.label}>
                <small className="label">{stat.label}</small>
                <strong>{stat.value}</strong>
              </span>
            ))}
            {outcome.completion !== null && activities.length === 1 ? (
              <span>
                <small className="label">Of plan</small>
                <strong>{Math.round(outcome.completion * 100)}%</strong>
              </span>
            ) : null}
          </div>
          <EffortChecks actual={activity} units={units} />
          <Button
            size="sm"
            variant="ghost"
            icon={Link2Off}
            busy={decide.isPending && decide.variables?.activityId === activity.id}
            onClick={() => decide.mutate({ activityId: activity.id, decision: 'reject' })}
          >
            Not this session
          </Button>
        </article>
      ))}
      {candidates.length ? (
        choosing ? (
          <div className="candidate-list">
            <span className="label">Activities within a week</span>
            {candidates.map((candidate) => (
              <div className="candidate" key={candidate.id}>
                <span>
                  <strong>{candidate.name || candidate.sourceSportType}</strong>
                  <small className="muted">
                    {dayLabel(candidate.date)} ·{' '}
                    {activityStats(candidate, units, pool)
                      .slice(0, 2)
                      .map((s) => s.value)
                      .join(' · ')}
                    {candidate.linkedWorkoutId ? ' · linked to another session' : ''}
                  </small>
                </span>
                <Button
                  size="sm"
                  icon={Link2}
                  busy={decide.isPending && decide.variables?.activityId === candidate.id}
                  onClick={() => decide.mutate({ activityId: candidate.id, decision: 'link' })}
                >
                  Link
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <button type="button" className="text-link small" onClick={() => setChoosing(true)}>
            {activities.length
              ? 'Link a different activity'
              : `Link an activity (${unlinked.length} unlinked nearby)`}
          </button>
        )
      ) : null}
    </section>
  );
}

// ---- Settings -----------------------------------------------------------------------------------

const SYNC_ERRORS: Record<string, string> = {
  STRAVA_REAUTHORIZATION_REQUIRED:
    'Strava stopped accepting this connection. Reconnect to keep syncing.',
  STRAVA_RATE_LIMITED: 'Strava’s request limit was reached. The next sync will catch up.',
  STRAVA_UNAVAILABLE: 'Strava didn’t respond at the last sync.',
  SYNC_FAILED: 'The last sync failed.',
};

/** Connect, sync and disconnect Strava. Shown in Settings. */
export function StravaConnection() {
  const integrations = useIntegrations();
  const connect = useConnectStrava();
  const sync = useStravaSync();
  const disconnect = useDisconnectStrava();
  const [confirming, setConfirming] = useState(false);
  if (integrations.isPending) return <LoadingState>Loading connections…</LoadingState>;
  if (integrations.error)
    return (
      <ErrorState
        message={integrations.error.message}
        onRetry={() => void integrations.refetch()}
      />
    );
  const { available, connection } = integrations.data.strava;
  const error = connect.error ?? sync.error ?? disconnect.error;
  return (
    <div className="strava-connection">
      <div className="strava-row">
        <span className="strava-mark" aria-hidden="true">
          S
        </span>
        <div className="strava-copy">
          <strong>Strava</strong>
          <small className="muted">
            {connection
              ? [
                  connection.displayName ? `Connected as ${connection.displayName}` : 'Connected',
                  sync.isPending || connection.syncing
                    ? 'syncing…'
                    : connection.lastSyncedAt
                      ? `synced ${relativeTime(connection.lastSyncedAt)}`
                      : 'not synced yet',
                  `${connection.activityCount} ${connection.activityCount === 1 ? 'activity' : 'activities'}`,
                ].join(' · ')
              : available
                ? 'Match your recorded runs, rides and swims to your plan.'
                : 'Not configured on this server.'}
          </small>
        </div>
        <div className="button-row">
          {connection ? (
            <>
              {connection.status === 'reauthorization_required' ? (
                <Button
                  size="sm"
                  variant="primary"
                  busy={connect.isPending}
                  onClick={() => connect.mutate()}
                >
                  Reconnect
                </Button>
              ) : (
                <Button
                  size="sm"
                  icon={RefreshCw}
                  busy={sync.isPending}
                  disabled={connection.syncing}
                  onClick={() => sync.mutate()}
                >
                  Sync now
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            </>
          ) : available ? (
            <button
              type="button"
              className="strava-connect"
              disabled={connect.isPending}
              onClick={() => connect.mutate()}
            >
              Connect with Strava
            </button>
          ) : null}
        </div>
      </div>
      {connection?.lastSyncError && !sync.isPending ? (
        <Notice tone="warning">
          {SYNC_ERRORS[connection.lastSyncError] ?? SYNC_ERRORS.SYNC_FAILED}
        </Notice>
      ) : null}
      {error ? <Notice tone="danger">{error.message}</Notice> : null}
      {sync.data && !sync.isPending ? (
        <p className="muted small" role="status">
          {sync.data.imported} new, {sync.data.updated} refreshed
          {sync.data.removed ? `, ${sync.data.removed} removed` : ''}
          {sync.data.lapsFetched ? ` · laps for ${sync.data.lapsFetched}` : ''}.
        </p>
      ) : null}
      <p className="muted small">
        Activities are shown only to you and are never shared with your coach. Askesis keeps a
        rolling seven-day copy, refreshed each sync, and deletes it all when you disconnect.
      </p>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Disconnect Strava?"
        description="Askesis revokes its access and deletes your synced activities and the links you made between activities and workouts."
        busy={disconnect.isPending}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep connected
            </Button>
            <Button
              variant="danger"
              busy={disconnect.isPending}
              onClick={() =>
                disconnect.mutate(undefined, { onSuccess: () => setConfirming(false) })
              }
            >
              Disconnect
            </Button>
          </>
        }
      />
    </div>
  );
}
