import type { ActivityDetail, ActivitySummary, WorkoutSummary } from '@askesis/api-client';
import {
  Activity as ActivityIcon,
  ExternalLink,
  Link2Off,
  RefreshCw,
  Repeat,
  X,
} from 'lucide-react';
import { createElement, useState } from 'react';
import { Link } from 'react-router';
import {
  useActivityLink,
  useActivityLinks,
  useConnectStrava,
  useDisconnectStrava,
  useIntegrations,
  useLinkActivity,
  useStravaActivities,
  useStravaActivity,
  useStravaReady,
} from '../activity-data';
import {
  addDays,
  daysBetween,
  formatClock,
  formatDistance,
  formatDuration,
  formatLong,
  formatPace,
  formatPower,
  formatSpeed,
  formatSwimDistance,
  formatSwimPace,
  type PoolUnits,
} from '../lib/format';
import { SPORT_META } from '../lib/sports';
import { useLocalToday } from '../lib/use-local-today';
import { useSportUnits, useUnits, type Units } from '../settings';
import { Button, cx, Dialog, ErrorState, IconButton, LoadingState, Notice } from './ui';

/** Shown wherever Strava data is: it is displayed for reference, never saved. */
export const STRAVA_NOTICE =
  'Strava details are displayed temporarily for reference. Information you enter in your review is saved separately.';

/** The Strava mark, for buttons and labels that lead to Strava data. */
export function StravaMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="strava-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"
      />
    </svg>
  );
}

/** Strava's brand guidelines: link text "View on Strava", bold or in Strava orange. */
export function ViewOnStrava({ url, compact = false }: { url: string; compact?: boolean }) {
  return (
    <a
      className={cx('strava-link', compact && 'compact')}
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      View on Strava <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}

// ---- Activity numbers --------------------------------------------------------------------------

function SportIcon({ sport }: { sport: ActivitySummary['sport'] }) {
  return createElement(sport === 'other' ? ActivityIcon : SPORT_META[sport].icon, {
    size: 17,
    'aria-hidden': true,
  });
}

/** "6.2 km", "1,500 m" for swims; nothing for gym sessions without distance. */
function distanceText(sport: string, metres: number | null, units: Units, pool: PoolUnits) {
  if (!metres) return null;
  return sport === 'swim' ? formatSwimDistance(metres, pool) : formatDistance(metres, units);
}

/** Pace for runs and swims, speed for everything else that moves. */
function paceText(
  sport: string,
  metres: number | null,
  seconds: number | null,
  units: Units,
  pool: PoolUnits,
) {
  if (!metres || !seconds) return null;
  if (sport === 'run') return formatPace((seconds / metres) * 1000, units);
  if (sport === 'swim') return formatSwimPace((seconds / metres) * 100, pool);
  if (sport === 'strength') return null;
  return formatSpeed(metres / seconds, units);
}

function summaryLine(activity: ActivitySummary, units: Units, pool: PoolUnits) {
  const seconds = activity.movingSeconds ?? activity.elapsedSeconds;
  return [
    distanceText(activity.sport, activity.distanceMetres, units, pool),
    formatDuration(activity.sport === 'strength' ? activity.elapsedSeconds : seconds),
    paceText(activity.sport, activity.distanceMetres, seconds, units, pool),
  ]
    .filter(Boolean)
    .join(' · ');
}

// ---- Picker ------------------------------------------------------------------------------------

function dayLabel(date: string, planned: string) {
  const offset = daysBetween(planned, date);
  const relative =
    offset === 0
      ? 'Planned day'
      : `${Math.abs(offset)} ${Math.abs(offset) === 1 ? 'day' : 'days'} ${offset < 0 ? 'before' : 'after'}`;
  return { title: formatLong(date), relative, planned: offset === 0 };
}

/** Choose which recorded activity was this workout, from the week either side of its date. */
function ActivityPicker({
  workout,
  onClose,
  onLinked,
}: {
  workout: WorkoutSummary;
  onClose: () => void;
  onLinked?: (() => void) | undefined;
}) {
  const units = useUnits(),
    { pool } = useSportUnits();
  const list = useStravaActivities(workout.scheduledDate);
  const links = useActivityLinks(workout.planId).data?.links ?? [];
  const current = links.find((l) => l.lineageId === workout.lineageId);
  const { link } = useLinkActivity(workout.planId, workout.lineageId);
  const [chosen, setChosen] = useState<string | null>(null);
  const days = new Map<string, ActivitySummary[]>();
  for (const activity of list.data?.activities ?? [])
    days.set(activity.date, [...(days.get(activity.date) ?? []), activity]);
  return (
    <Dialog
      open
      size="md"
      className="activity-picker"
      onClose={onClose}
      busy={link.isPending}
      title={
        <span className="picker-title">
          <StravaMark size={18} /> Find my activity
        </span>
      }
      description={`${workout.title} · ${formatLong(workout.scheduledDate)}`}
      footer={
        <>
          <p className="fb-footer-note">
            Showing your Strava activities from the week either side. {STRAVA_NOTICE}
          </p>
          <Button
            variant="ghost"
            icon={RefreshCw}
            disabled={list.isFetching}
            onClick={() => void list.refetch()}
          >
            Refresh
          </Button>
        </>
      }
    >
      {list.isPending ? <LoadingState>Loading your Strava activities…</LoadingState> : null}
      {list.error ? (
        <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
      ) : null}
      {link.error ? (
        <Notice tone="danger" role="alert">
          {link.error.message}
        </Notice>
      ) : null}
      {list.data && !list.data.activities.length ? (
        <p className="muted">
          No Strava activities between {formatLong(list.data.from)} and {formatLong(list.data.to)}.
          If you’ve just finished, give Strava a minute to process the upload, then refresh.
        </p>
      ) : null}
      {[...days].map(([date, activities]) => {
        const label = dayLabel(date, workout.scheduledDate);
        return (
          <section key={date} className="picker-day" aria-label={label.title}>
            <h3>
              {label.title}
              <span className={cx('picker-offset', label.planned && 'planned')}>
                {label.relative}
              </span>
            </h3>
            <ul>
              {activities.map((activity) => {
                const linkedHere = current?.activityId === activity.id;
                const elsewhere = !linkedHere && links.some((l) => l.activityId === activity.id);
                return (
                  <li key={activity.id}>
                    <button
                      type="button"
                      className={cx('picker-activity', linkedHere && 'linked')}
                      disabled={link.isPending || linkedHere}
                      aria-label={`Link ${activity.name || activity.sportType}, ${label.title} ${activity.startTime}`}
                      onClick={() => {
                        setChosen(activity.id);
                        link.mutate(activity.id, {
                          onSuccess: () => {
                            onLinked?.();
                            onClose();
                          },
                        });
                      }}
                    >
                      <span className="picker-icon">
                        <SportIcon sport={activity.sport} />
                      </span>
                      <span className="picker-copy">
                        <strong>{activity.name || activity.sportType}</strong>
                        <small>
                          {activity.startTime} · {summaryLine(activity, units, pool)}
                        </small>
                        {elsewhere ? (
                          <small className="picker-note">
                            Linked to another session; choosing it moves the link here.
                          </small>
                        ) : null}
                      </span>
                      <span className="picker-action">
                        {linkedHere
                          ? 'Linked'
                          : link.isPending && chosen === activity.id
                            ? 'Linking…'
                            : 'Link'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </Dialog>
  );
}

/** Strava's orange: the athlete is about to look at their Strava activities. */
export function FindActivityButton({
  workout,
  onLinked,
  label = 'Find my activity',
}: {
  workout: WorkoutSummary;
  onLinked?: (() => void) | undefined;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="strava-find" onClick={() => setOpen(true)}>
        <StravaMark size={15} /> {label}
      </button>
      {open ? (
        <ActivityPicker workout={workout} onClose={() => setOpen(false)} onLinked={onLinked} />
      ) : null}
    </>
  );
}

// ---- Linked activity ---------------------------------------------------------------------------

/**
 * A workout's Strava link: "Find my activity" until one is chosen, then "View on Strava" with
 * change and unlink. Only the link is known here; details load only in the log's panel.
 */
export function StravaLinkRow({
  workout,
  writable,
  details,
  onLinked,
}: {
  workout: WorkoutSummary;
  writable: boolean;
  /** The log sheet's details panel toggle. */
  details?: { open: boolean; toggle: () => void } | undefined;
  onLinked?: (() => void) | undefined;
}) {
  const { connected, active } = useStravaReady();
  const today = useLocalToday();
  const link = useActivityLink(workout.planId, workout.lineageId);
  const { unlink } = useLinkActivity(workout.planId, workout.lineageId);
  if (!connected) return null;
  if (!link) {
    if (!active || !writable || workout.scheduledDate > addDays(today, 1)) return null;
    return (
      <div className="strava-row-link">
        <FindActivityButton workout={workout} onLinked={onLinked} />
      </div>
    );
  }
  return (
    <div className="strava-row-link linked">
      <span className="strava-linked-label">
        <StravaMark size={14} /> Strava activity linked
      </span>
      <ViewOnStrava url={link.url} />
      {details && active ? (
        <Button size="sm" variant={details.open ? 'secondary' : 'ghost'} onClick={details.toggle}>
          {details.open ? 'Hide details' : 'Show details'}
        </Button>
      ) : null}
      {writable && active ? (
        <FindActivityButton workout={workout} onLinked={onLinked} label="Change" />
      ) : null}
      {writable ? (
        <Button
          size="sm"
          variant="ghost"
          icon={Link2Off}
          busy={unlink.isPending}
          onClick={() => unlink.mutate()}
        >
          Unlink
        </Button>
      ) : null}
      {unlink.error ? (
        <Notice tone="danger" role="alert">
          {unlink.error.message}
        </Notice>
      ) : null}
    </div>
  );
}

/** In the log sheet without a connection: point to Settings rather than hide the option. */
export function StravaConnectHint() {
  const integrations = useIntegrations().data;
  if (!integrations?.strava.available || integrations.strava.connection) return null;
  return (
    <p className="fb-hint strava-hint">
      <StravaMark size={12} /> Recorded this on Strava?{' '}
      <Link to="/settings#connections">Connect Strava</Link> to look it up while you log.
    </p>
  );
}

// ---- Details panel -----------------------------------------------------------------------------

function detailStats(activity: ActivityDetail, units: Units, pool: PoolUnits) {
  const moving = activity.movingSeconds ?? activity.elapsedSeconds;
  const stats: { label: string; value: string }[] = [];
  const distance = distanceText(activity.sport, activity.distanceMetres, units, pool);
  if (distance) stats.push({ label: 'Distance', value: distance });
  stats.push({ label: 'Moving time', value: formatClock(moving) });
  if (activity.elapsedSeconds !== moving)
    stats.push({ label: 'Elapsed time', value: formatClock(activity.elapsedSeconds) });
  const pace = paceText(activity.sport, activity.distanceMetres, moving, units, pool);
  if (pace)
    stats.push({ label: ['run', 'swim'].includes(activity.sport) ? 'Pace' : 'Speed', value: pace });
  if (activity.elevationGainMetres)
    stats.push({
      label: 'Elevation',
      value:
        units === 'mi'
          ? `${Math.round(activity.elevationGainMetres * 3.28084)} ft`
          : `${Math.round(activity.elevationGainMetres)} m`,
    });
  if (activity.averageHeartrate)
    stats.push({ label: 'Avg heart rate', value: `${activity.averageHeartrate} bpm` });
  if (activity.maxHeartrate)
    stats.push({ label: 'Max heart rate', value: `${activity.maxHeartrate} bpm` });
  if (activity.averageWatts)
    stats.push({ label: 'Avg power', value: formatPower(activity.averageWatts) });
  if (activity.averageCadence)
    stats.push({
      label: 'Cadence',
      // Strava reports running cadence per leg; runners think in steps per minute.
      value:
        activity.sport === 'run'
          ? `${Math.round(activity.averageCadence * 2)} spm`
          : `${Math.round(activity.averageCadence)} rpm`,
    });
  if (activity.calories) stats.push({ label: 'Calories', value: `${activity.calories}` });
  return stats;
}

/**
 * The linked activity, fetched from Strava each time the panel opens, beside the log form. The
 * athlete reads it and fills in their own review; nothing here is copied into the form.
 */
export function StravaActivityPanel({
  activityId,
  url,
  onClose,
}: {
  activityId: string;
  url: string;
  onClose: () => void;
}) {
  const units = useUnits(),
    { pool } = useSportUnits();
  const activity = useStravaActivity(activityId);
  const data = activity.data;
  return (
    <section className="strava-panel" aria-label="Strava activity details">
      <header className="strava-panel-head">
        <span className="strava-panel-source">
          <StravaMark size={14} /> From Strava
        </span>
        <IconButton icon={X} label="Hide Strava details" onClick={onClose} />
      </header>
      {activity.isPending ? <LoadingState>Loading from Strava…</LoadingState> : null}
      {activity.error ? (
        <ErrorState message={activity.error.message} onRetry={() => void activity.refetch()} />
      ) : null}
      {data ? (
        <>
          <div className="strava-panel-title">
            <span className="picker-icon">
              <SportIcon sport={data.sport} />
            </span>
            <div>
              <h3>{data.name || data.sportType}</h3>
              <small className="muted">
                {formatLong(data.date)} · {data.startTime} · {data.sportType}
                {data.deviceName ? ` · ${data.deviceName}` : ''}
                {data.trainer ? ' · Indoor' : ''}
                {data.manual ? ' · Entered manually' : ''}
              </small>
            </div>
          </div>
          <dl className="strava-stats">
            {detailStats(data, units, pool).map((stat) => (
              <div key={stat.label}>
                <dt>{stat.label}</dt>
                <dd>{stat.value}</dd>
              </div>
            ))}
          </dl>
          {data.description ? (
            <blockquote className="log-quote">{data.description}</blockquote>
          ) : null}
          {data.laps.length > 1 ? (
            <div className="strava-laps">
              <h4>
                <Repeat size={13} aria-hidden="true" /> Laps
              </h4>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Lap</th>
                    <th scope="col">Distance</th>
                    <th scope="col">Time</th>
                    <th scope="col">{['run', 'swim'].includes(data.sport) ? 'Pace' : 'Speed'}</th>
                    <th scope="col">HR</th>
                  </tr>
                </thead>
                <tbody>
                  {data.laps.map((lap) => {
                    const seconds = lap.movingSeconds || lap.elapsedSeconds;
                    return (
                      <tr key={lap.index}>
                        <td>{lap.index}</td>
                        <td>{distanceText(data.sport, lap.distanceMetres, units, pool) ?? '—'}</td>
                        <td>{formatClock(lap.elapsedSeconds)}</td>
                        <td>
                          {paceText(data.sport, lap.distanceMetres, seconds, units, pool) ?? '—'}
                        </td>
                        <td>{lap.averageHeartrate ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
      <footer className="strava-panel-foot">
        <ViewOnStrava url={url} />
        <p>{STRAVA_NOTICE}</p>
      </footer>
    </section>
  );
}

// ---- Settings ----------------------------------------------------------------------------------

export function StravaConnection() {
  const integrations = useIntegrations();
  const connect = useConnectStrava();
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
  const error = connect.error ?? disconnect.error;
  return (
    <div className="strava-connection">
      <div className="strava-row">
        <span className="strava-badge" aria-hidden="true">
          <StravaMark size={18} />
        </span>
        <div className="strava-copy">
          <strong>Strava</strong>
          <small className="muted">
            {connection
              ? connection.status === 'reauthorization_required'
                ? 'Strava no longer accepts this connection. Reconnect to look up activities.'
                : connection.displayName
                  ? `Connected as ${connection.displayName}`
                  : 'Connected'
              : available
                ? 'Look up the activity you recorded while you log a workout.'
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
              ) : null}
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
      {error ? <Notice tone="danger">{error.message}</Notice> : null}
      <p className="muted small">
        You choose which Strava activity belongs to each workout. Askesis keeps only that link;
        activity details are fetched from Strava when you open them, shown only to you, and never
        shared with your coach.
      </p>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Disconnect Strava?"
        description="Askesis revokes its access and deletes the links you made between workouts and Strava activities. Your workout logs stay."
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
