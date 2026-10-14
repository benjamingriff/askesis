import type { WorkoutSummary } from '@askesis/api-client';
import {
  CalendarDays,
  Flag,
  Layers,
  Moon,
  Mountain,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import type { PlanBlock } from '../../lib/blocks';
import {
  addDays,
  daysBetween,
  formatDistance,
  formatDuration,
  formatShort,
  formatSwimDistance,
  startOfWeek,
  WEEKDAYS_LONG,
  WEEKDAYS_SHORT,
  weekdayIndex,
} from '../../lib/format';
import {
  FORM_STATES,
  formRatio,
  formState,
  sessionLoad,
  type LoadDay,
  type LoadSnapshot,
  type WeekLoad,
} from '../../lib/load';
import { SPORT_META } from '../../lib/sports';
import { firstMarkLabel, type Milestone, type PlanToDate } from '../../lib/today';
import { RACE_META, workoutLook, workoutsOn } from '../../lib/workouts';
import { useSportUnits, type Units } from '../../settings';
import { Stat } from '../PlanWidgets';
import { Card, KindIcon, ProgressBar, SectionHeader, cx } from '../ui';
import { LoadChart, signed } from './LoadChart';

// ---- Dates -------------------------------------------------------------------------------------

/**
 * "Tomorrow", "Saturday" within the week ahead, else "Sat 24 Oct". Inline, for use mid-sentence:
 * "tomorrow", "on Saturday".
 */
export function relativeDay(date: string, today: string, inline = false) {
  const days = daysBetween(today, date);
  if (days === 0) return inline ? 'today' : 'Today';
  if (days === 1) return inline ? 'tomorrow' : 'Tomorrow';
  const name =
    days > 1 && days < 7
      ? WEEKDAYS_LONG[weekdayIndex(date)]!
      : `${WEEKDAYS_SHORT[weekdayIndex(date)]} ${formatShort(date)}`;
  return inline ? `on ${name}` : name;
}

/** The next session that matters most: a race or a key session after today. */
export function nextKeySession(workouts: WorkoutSummary[], today: string) {
  return workouts
    .filter((w) => w.scheduledDate > today && (w.priority === 'high' || w.racePriority))
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))[0];
}

function inDays(date: string, today: string) {
  const days = daysBetween(today, date);
  return days === 1 ? 'in 1 day' : `in ${days} days`;
}

// ---- Status ------------------------------------------------------------------------------------

/** Week, block and countdown in one line under the greeting. */
export function StatusChips({
  week,
  weeks,
  block,
  countdown,
}: {
  week: number | null;
  weeks: number | null;
  block: PlanBlock | null;
  countdown: { days: number; label: string; race: WorkoutSummary | null } | null;
}) {
  return (
    <Link className="status-chips" to="/plan">
      {week && weeks ? (
        <span className="status-chip strong">
          <CalendarDays size={13} aria-hidden="true" /> Week {week} of {weeks}
        </span>
      ) : null}
      {block ? (
        <span className="status-chip" style={{ '--phase': block.color } as CSSProperties}>
          <i aria-hidden="true" /> {block.label}
          <span className="status-chip-detail"> · {block.title}</span>
        </span>
      ) : null}
      {countdown ? (
        <span className="status-chip">
          {countdown.race ? (
            <Trophy size={13} aria-hidden="true" />
          ) : (
            <Flag size={13} aria-hidden="true" />
          )}
          {countdown.days === 0
            ? countdown.race
              ? 'Race day'
              : 'Final day'
            : `${countdown.days} days${countdown.race ? '' : ' left'}`}
          {countdown.race ? (
            <span className="status-chip-detail"> to {countdown.label}</span>
          ) : null}
        </span>
      ) : null}
    </Link>
  );
}

// ---- Form --------------------------------------------------------------------------------------

/** Today's form in words, with fitness, fatigue and the trend around it. */
export function FormCard({
  snapshot,
  series,
  today,
  workouts,
  weeks,
  full = false,
}: {
  snapshot: LoadSnapshot;
  series: LoadDay[];
  today: string;
  workouts: WorkoutSummary[];
  weeks: WeekLoad[];
  /** The Load layout's large card: both charts, weekly load and race-day form. */
  full?: boolean | undefined;
}) {
  const state = formState(snapshot.today);
  const meta = FORM_STATES[state];
  const thisWeek = weeks.find((week) => week.startDate === startOfWeek(today));
  const lastWeek = weeks.find((week) => week.startDate === addDays(startOfWeek(today), -7));
  const change = (a?: WeekLoad, b?: WeekLoad) =>
    a && b && b.load ? Math.round(((a.load - b.load) / b.load) * 100) : null;
  const weekChange = change(thisWeek, lastWeek);
  const todayLoad = workoutsOn(workouts, today).reduce((sum, w) => sum + sessionLoad(w), 0);
  const tomorrow = series.find((day) => day.date === addDays(today, 1));
  const key = nextKeySession(workouts, today);
  const keyMorning = key ? series.find((day) => day.date === key.scheduledDate) : undefined;
  return (
    <Card className={cx('form-card', full && 'full')} aria-labelledby="form-heading">
      <div className="form-head">
        <div>
          <span className="label">Form today</span>
          <h2 id="form-heading" className={cx('form-state', `form-${state}`)}>
            <i aria-hidden="true" />
            {meta.label}
          </h2>
        </div>
        <span className="form-ratio">
          <strong>{signed(Math.round(formRatio(snapshot.today) * 100))}%</strong>
          <small>form</small>
        </span>
      </div>
      <p className="form-summary">{meta.summary}</p>
      <div className="form-stats">
        <Stat
          label="Fitness"
          value={String(Math.round(snapshot.today.fitness))}
          sub={
            Math.abs(snapshot.ramp) < 0.5
              ? 'steady this week'
              : `${signed(Math.round(snapshot.ramp))} this week`
          }
        />
        <Stat label="Fatigue" value={String(Math.round(snapshot.today.fatigue))} />
        <Stat
          label="This week"
          value={String(Math.round(thisWeek?.load ?? 0))}
          sub={weekChange === null ? 'load' : `load · ${signed(weekChange)}% on last`}
        />
      </div>
      <LoadChart
        series={series}
        today={today}
        workouts={workouts}
        parts={full ? 'both' : 'lines'}
      />
      <ul className="form-notes">
        {todayLoad && tomorrow ? (
          <li>
            <TrendingDown size={15} aria-hidden="true" />
            Today’s training adds {Math.round(todayLoad)} load; tomorrow you wake at{' '}
            {signed(Math.round(formRatio(tomorrow) * 100))}% form.
          </li>
        ) : null}
        {key && keyMorning && !key.racePriority ? (
          <li>
            <Sparkles size={15} aria-hidden="true" />
            Next key session {relativeDay(key.scheduledDate, today, true)}: you start it{' '}
            {FORM_STATES[formState(keyMorning)].label.toLowerCase()} (
            {signed(Math.round(formRatio(keyMorning) * 100))}% form).
          </li>
        ) : null}
        {full && snapshot.raceDay ? (
          <li>
            <Trophy size={15} aria-hidden="true" />
            Race morning, {formatShort(snapshot.raceDay.date)}:{' '}
            {FORM_STATES[formState(snapshot.raceDay)].label.toLowerCase()} at{' '}
            {signed(Math.round(formRatio(snapshot.raceDay) * 100))}% form, fitness{' '}
            {Math.round(snapshot.raceDay.fitness)}.
          </li>
        ) : null}
      </ul>
      <p className="form-caveat">
        Estimated from your scheduled sessions. Askesis doesn’t record completed training yet.
      </p>
    </Card>
  );
}

/** Load per week around now: this week and up to three either side. */
export function WeeklyLoad({ weeks, today }: { weeks: WeekLoad[]; today: string }) {
  const current = startOfWeek(today);
  const index = weeks.findIndex((week) => week.startDate === current);
  if (index < 0) return null;
  // Three weeks either side, shifted to keep seven bars near the plan's start or end.
  const first = Math.max(0, Math.min(index - 3, weeks.length - 7));
  const window = weeks.slice(first, first + 7);
  const max = Math.max(...window.map((week) => week.load), 1);
  return (
    <Card aria-labelledby="weekly-load-heading">
      <SectionHeader id="weekly-load-heading" title="Weekly load" />
      <ol className="weekly-load">
        {window.map((week) => {
          const previous = weeks[weeks.indexOf(week) - 1];
          const change =
            previous && previous.load
              ? Math.round(((week.load - previous.load) / previous.load) * 100)
              : null;
          const state =
            week.startDate < current ? 'past' : week.startDate === current ? 'current' : 'ahead';
          return (
            <li key={week.startDate} className={state}>
              <span className="weekly-load-value">{Math.round(week.load)}</span>
              <span className="weekly-load-track">
                <i style={{ height: `${Math.max(6, (week.load / max) * 100)}%` }} />
              </span>
              <span className="weekly-load-label">
                {state === 'current' ? 'This wk' : formatShort(week.startDate)}
              </span>
              <small>{change === null ? '' : `${signed(change)}%`}</small>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// ---- Coming up ---------------------------------------------------------------------------------

const MILESTONE_ICONS: Record<Milestone['kind'], LucideIcon> = {
  race: Trophy,
  first: TrendingUp,
  block: Layers,
  cutback: Moon,
  'biggest-week': Mountain,
  halfway: Flag,
  finish: Flag,
};

export function milestoneText(
  item: Milestone,
  formatMetres: (metres: number) => string,
): { title: string; detail: string } {
  switch (item.kind) {
    case 'race':
      return {
        title: item.workout.title,
        detail: item.workout.racePriority ? RACE_META[item.workout.racePriority].description : '',
      };
    case 'first':
      return {
        title: firstMarkLabel(item.workout, item.mark, formatMetres),
        detail: `${item.workout.title}${item.workout.estimatedDurationSeconds ? `, ${formatDuration(item.workout.estimatedDurationSeconds)}` : ''}`,
      };
    case 'block':
      return { title: `${item.block.label} block begins`, detail: item.block.title };
    case 'cutback':
      return {
        title: 'Cutback week',
        detail: 'Lighter on purpose, so the work before it sinks in.',
      };
    case 'biggest-week':
      return {
        title: 'Biggest week of the plan',
        detail: `${formatDuration(item.seconds)} of training. Sleep and fuel for it.`,
      };
    case 'halfway':
      return {
        title: 'Halfway through the plan',
        detail: 'Everything after this builds on the first half.',
      };
    case 'finish':
      return { title: 'Plan complete', detail: 'The last day of this plan.' };
  }
}

/** Tomorrow's session, then notable moments ahead. */
export function ComingUp({
  workouts,
  milestones,
  today,
  units,
  onOpen,
  limit = 4,
}: {
  workouts: WorkoutSummary[];
  milestones: Milestone[];
  today: string;
  units: Units;
  onOpen: (workout: WorkoutSummary) => void;
  limit?: number;
}) {
  const tomorrow = addDays(today, 1);
  const next = workoutsOn(workouts, tomorrow);
  const key = nextKeySession(workouts, tomorrow);
  const keyFirst = milestones.find(
    (item): item is Extract<Milestone, { kind: 'first' }> =>
      item.kind === 'first' && item.workout.id === key?.id,
  );
  const { pool } = useSportUnits();
  return (
    <Card aria-labelledby="coming-up-heading">
      <SectionHeader
        id="coming-up-heading"
        title="Coming up"
        action={
          <Link className="text-link" to="/plan">
            Full plan
          </Link>
        }
      />
      <ol className="coming-up">
        {next.length ? (
          next.map((workout) => (
            <UpcomingSession
              key={workout.id}
              workout={workout}
              when="Tomorrow"
              units={units}
              pool={pool}
              onOpen={onOpen}
            />
          ))
        ) : (
          <li className="upcoming-rest">
            <KindIcon icon={Moon} color="var(--text-muted)" size={34} />
            <span>
              <span className="label">Tomorrow</span>
              <strong>Rest day</strong>
            </span>
          </li>
        )}
        {key ? (
          <UpcomingSession
            workout={key}
            when={`${relativeDay(key.scheduledDate, today)} · ${keyFirst ? firstMarkLabel(keyFirst.workout, keyFirst.mark, (metres) => formatSwimDistance(metres, pool)).toLowerCase() : 'key session'}`}
            units={units}
            pool={pool}
            onOpen={onOpen}
          />
        ) : null}
        {milestones
          .filter((item) => !('workout' in item && item.workout.id === key?.id))
          .slice(0, limit)
          .map((item) => {
            const Icon = MILESTONE_ICONS[item.kind];
            const text = milestoneText(item, (metres) => formatSwimDistance(metres, pool));
            return (
              <li key={`${item.kind}-${item.date}`} className="upcoming-milestone">
                <span className="milestone-icon">
                  <Icon size={15} aria-hidden="true" />
                </span>
                <span>
                  <span className="label">
                    {relativeDay(item.date, today)} · {inDays(item.date, today)}
                  </span>
                  <strong>{text.title}</strong>
                  <small>{text.detail}</small>
                </span>
              </li>
            );
          })}
      </ol>
    </Card>
  );
}

function UpcomingSession({
  workout,
  when,
  units,
  pool,
  onOpen,
}: {
  workout: WorkoutSummary;
  when: string;
  units: Units;
  pool: 'm' | 'yd';
  onOpen: (workout: WorkoutSummary) => void;
}) {
  const look = workoutLook(workout);
  const distance =
    workout.estimatedDistanceMetres === null
      ? null
      : workout.discipline === 'swim'
        ? formatSwimDistance(workout.estimatedDistanceMetres, pool)
        : formatDistance(workout.estimatedDistanceMetres, units);
  return (
    <li>
      <button type="button" className="upcoming-session" onClick={() => onOpen(workout)}>
        <KindIcon icon={look.icon} color={look.color} size={34} />
        <span>
          <span className="label">{when}</span>
          <strong>{workout.title}</strong>
          <small>
            {[
              look.label,
              distance,
              workout.estimatedDurationSeconds
                ? formatDuration(workout.estimatedDurationSeconds)
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </small>
        </span>
      </button>
    </li>
  );
}

// ---- Plan so far -------------------------------------------------------------------------------

export function PlanSoFar({
  progress,
  units,
  compact = false,
}: {
  progress: PlanToDate;
  units: Units;
  compact?: boolean | undefined;
}) {
  const { pool } = useSportUnits();
  return (
    <Card aria-labelledby="so-far-heading" className="so-far">
      <SectionHeader id="so-far-heading" title="Plan so far" />
      <div className="so-far-headline">
        <Ring value={progress.sessions ? progress.doneSessions / progress.sessions : 0}>
          <strong>
            {Math.round((progress.doneSessions / Math.max(1, progress.sessions)) * 100)}%
          </strong>
        </Ring>
        <div className="so-far-numbers">
          <Stat
            label="Sessions"
            value={String(progress.doneSessions)}
            unit={`/ ${progress.sessions}`}
            large
          />
          <Stat
            label="Training time"
            value={formatDuration(progress.doneSeconds)}
            sub={`of ${formatDuration(progress.seconds)}`}
            large
          />
        </div>
      </div>
      {compact ? null : (
        <ul className="so-far-sports">
          {progress.sports.map((sport) => {
            const meta = SPORT_META[sport.sport];
            const distance =
              sport.doneMetres > 0
                ? sport.sport === 'swim'
                  ? formatSwimDistance(sport.doneMetres, pool)
                  : formatDistance(sport.doneMetres, units)
                : null;
            return (
              <li key={sport.sport}>
                <span className="so-far-sport">
                  <meta.icon size={15} aria-hidden="true" /> {meta.label}
                </span>
                <span className="so-far-sport-numbers">
                  <strong>{formatDuration(sport.doneSeconds)}</strong>
                  {distance ? <small> · {distance}</small> : null}
                  <small>
                    {' '}
                    · {sport.doneSessions}/{sport.sessions}
                  </small>
                </span>
                <ProgressBar
                  value={sport.seconds ? sport.doneSeconds / sport.seconds : 0}
                  label={`${meta.label} progress`}
                />
              </li>
            );
          })}
        </ul>
      )}
      <p className="form-caveat">Counts sessions scheduled before today.</p>
    </Card>
  );
}

function Ring({ value, children }: { value: number; children: ReactNode }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  return (
    <span className="ring">
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <circle className="ring-track" cx="40" cy="40" r={radius} />
        <circle
          className="ring-fill"
          cx="40"
          cy="40"
          r={radius}
          strokeDasharray={`${circumference * Math.max(0, Math.min(1, value))} ${circumference}`}
        />
      </svg>
      <span className="ring-value">{children}</span>
    </span>
  );
}

// ---- Journey -----------------------------------------------------------------------------------

/** The countdown as the page's one big number, over a week-by-week track of the plan. */
export function CountdownHero({
  countdown,
  weeks,
  currentWeek,
  blocks,
  cutbacks,
  today,
}: {
  countdown: { date: string; days: number; label: string; race: WorkoutSummary | null };
  weeks: { startDate: string }[];
  currentWeek: number | null;
  blocks: PlanBlock[];
  cutbacks: Set<string>;
  today: string;
}) {
  const blockOf = (date: string) =>
    blocks.find((block) => date >= block.startDate && date <= block.endDate) ?? null;
  return (
    <Card className="countdown-hero" aria-labelledby="countdown-heading">
      <span className="label">
        {countdown.race ? 'Race day' : 'Plan ends'} · {formatShort(countdown.date)}
      </span>
      <h2 id="countdown-heading" className="countdown-number">
        {countdown.days === 0 ? 'Today' : countdown.days}
        {countdown.days ? <small>{countdown.days === 1 ? 'day' : 'days'}</small> : null}
      </h2>
      <p className="countdown-label">
        {countdown.race ? (
          <>
            to <strong>{countdown.label}</strong>
          </>
        ) : (
          'until this plan is complete'
        )}
      </p>
      <ol className="week-track" aria-label="Plan weeks">
        {weeks.map((week, index) => {
          const number = index + 1;
          const block = blockOf(week.startDate);
          const state =
            currentWeek === null
              ? week.startDate < today
                ? 'past'
                : 'ahead'
              : number < currentWeek
                ? 'past'
                : number === currentWeek
                  ? 'current'
                  : 'ahead';
          const last = index === weeks.length - 1;
          return (
            <li
              key={week.startDate}
              className={cx('track-week', state, cutbacks.has(week.startDate) && 'cutback')}
              style={{ '--phase': block?.color ?? 'var(--text-muted)' } as CSSProperties}
              title={`Week ${number}${block ? ` · ${block.label}` : ''}${cutbacks.has(week.startDate) ? ' · cutback' : ''}`}
            >
              <i />
              {state === 'current' ? (
                <span className="track-now" aria-hidden="true">
                  Now
                </span>
              ) : null}
              <span className="sr-only">
                Week {number}
                {block ? `, ${block.label}` : ''}
                {state === 'current' ? ' (this week)' : ''}
              </span>
              {last && countdown.race ? (
                <Trophy size={12} aria-hidden="true" className="track-race" />
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="week-track-legend" aria-hidden="true">
        <span>Week 1</span>
        <span>Week {weeks.length}</span>
      </div>
    </Card>
  );
}

/** Milestones as a vertical timeline. */
export function MilestoneTimeline({
  milestones,
  today,
}: {
  milestones: Milestone[];
  today: string;
}) {
  const { pool } = useSportUnits();
  if (!milestones.length) return null;
  return (
    <Card aria-labelledby="milestones-heading">
      <SectionHeader id="milestones-heading" title="Milestones ahead" />
      <ol className="milestone-timeline">
        {milestones.map((item) => {
          const Icon = MILESTONE_ICONS[item.kind];
          const text = milestoneText(item, (metres) => formatSwimDistance(metres, pool));
          return (
            <li key={`${item.kind}-${item.date}`} className={`milestone-${item.kind}`}>
              <span className="milestone-icon">
                <Icon size={15} aria-hidden="true" />
              </span>
              <span>
                <span className="label">
                  {relativeDay(item.date, today)} · {inDays(item.date, today)}
                </span>
                <strong>{text.title}</strong>
                <small>{text.detail}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
