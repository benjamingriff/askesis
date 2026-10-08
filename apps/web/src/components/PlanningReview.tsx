import { CalendarDays, CalendarRange, Flag, Repeat, type LucideIcon } from 'lucide-react';
import {
  formatDistance,
  formatDuration,
  formatRange,
  formatShortYear,
  formatSwimDistance,
  WEEKDAYS_SHORT,
} from '../lib/format';
import { SPORT_META, type BriefSport } from '../lib/sports';
import { type BriefState } from '../plan-data';
import { useSportUnits, useUnits } from '../settings';
import { CoverageNote, PlanZones, coverageGaps } from './PlanWidgets';
import { Pill } from './ui';

/** Detailed coverage: intended generation horizons, prescribed ranges and remaining gaps. */
export function CoverageSummary({ state }: { state: BriefState }) {
  const gaps = coverageGaps(state);
  return (
    <section className="review-block" aria-label="Prescribed coverage">
      <h3>Prescribed schedule</h3>
      <CoverageNote state={state} />
      {!!state.generations?.length && (
        <ul className="plain-list" aria-label="Generation attempts">
          {state.generations.map((generation) => (
            <li key={generation.runId}>
              Intended horizon: {formatRange(generation.startDate, generation.endDate)}.{' '}
              {generation.status === 'completed'
                ? 'Generation completed.'
                : generation.status === 'in_progress'
                  ? 'Generation in progress.'
                  : 'Generation stopped before the intended horizon was complete.'}{' '}
              {generation.prescribedThrough
                ? `Fully prescribed through ${formatShortYear(generation.prescribedThrough)}.`
                : 'No complete coverage was recorded for this attempt.'}
            </li>
          ))}
        </ul>
      )}
      {state.coverage.length ? (
        <dl className="range-list">
          {state.coverage.map((range) => (
            <div key={range.startDate}>
              <dt>Prescribed</dt>
              <dd>
                {formatRange(range.startDate, range.endDate)}
                {!range.current ? (
                  <Pill tone="warning">Planning inputs changed; review this range</Pill>
                ) : null}
              </dd>
            </div>
          ))}
          {gaps.map((gap) => (
            <div key={gap.start} className="gap">
              <dt>Still unplanned</dt>
              <dd>{formatRange(gap.start, gap.end)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="muted">
        You can lock an initial horizon and extend the plan in a later revision.
      </p>
    </section>
  );
}

function Assumption({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="assumption">
      <Icon size={17} aria-hidden="true" />
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

type Answer = { status: 'unanswered' | 'unknown' | 'known'; value: unknown };
type Baseline = BriefState['brief']['sports'][number];

/** One sport's baseline in a sentence: sessions now and planned, weekly volume, longest. */
export function useBaselineSummary() {
  const { pool } = useSportUnits();
  return (baseline: Baseline, units: ReturnType<typeof useUnits>) => {
    const show = (answer: Answer, format: (value: number) => string) =>
      answer.status === 'known'
        ? format(answer.value as number)
        : answer.status === 'unanswered'
          ? 'not answered'
          : 'unknown';
    const distance = (value: number) =>
      baseline.sport === 'swim' ? formatSwimDistance(value, pool) : formatDistance(value, units);
    const sessions = `${show(baseline.currentSessions, String)} → ${baseline.desiredSessions ?? 'not set'} sessions a week`;
    if (baseline.sport === 'strength') return sessions;
    const [weekly, longest] =
      baseline.sport === 'cycle'
        ? [
            show(baseline.weeklyDuration, formatDuration),
            show(baseline.longestDuration, formatDuration),
          ]
        : [show(baseline.weeklyDistance, distance), show(baseline.longestDistance, distance)];
    return `${sessions} · ${weekly} weekly · longest ${longest}`;
  };
}

/** The brief as the coach will use it: what the human confirms before locking. */
export function PlanningReview({ state }: { state: BriefState }) {
  const units = useUnits(state.brief.unit);
  const summary = useBaselineSummary();
  const availability = state.brief.weekdays
    .map((value, index) =>
      value === 'unavailable'
        ? null
        : `${WEEKDAYS_SHORT[index]}${value === 'preferred' ? '★' : ''}`,
    )
    .filter(Boolean)
    .join(' · ');
  const sports = state.brief.sports.map((baseline) => baseline.sport);
  return (
    <section className="review-block" aria-label="Planning assumptions">
      <h3>Planning assumptions</h3>
      {state.brief.goal ? <p className="review-goal">{state.brief.goal}</p> : null}
      <dl className="assumptions">
        <Assumption
          icon={CalendarRange}
          label="Dates"
          value={formatRange(state.startDate, state.endDate)}
        />
        {state.brief.sports.length ? (
          state.brief.sports.map((baseline) => {
            const meta = SPORT_META[baseline.sport as BriefSport];
            return (
              <Assumption
                key={baseline.sport}
                icon={meta.icon}
                label={meta.label}
                value={summary(baseline, units)}
              />
            );
          })
        ) : (
          <Assumption icon={Repeat} label="Sports" value="None chosen" />
        )}
        <Assumption icon={CalendarDays} label="Available days" value={availability || 'None'} />
      </dl>
      {state.brief.context ? (
        <div className="review-context">
          <span className="label">
            <Flag size={12} aria-hidden="true" /> Context
          </span>
          <p>{state.brief.context}</p>
        </div>
      ) : null}
      <PlanZones sports={sports} units={units} compact />
      <CoverageSummary state={state} />
    </section>
  );
}
