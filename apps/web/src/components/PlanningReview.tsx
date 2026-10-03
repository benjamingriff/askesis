import {
  CalendarDays,
  CalendarRange,
  Flag,
  Globe2,
  Repeat,
  Route,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { formatDistance, formatRange, formatShortYear, WEEKDAYS_SHORT } from '../lib/format';
import { latestCalibration, type BriefState } from '../plan-data';
import { useUnits } from '../settings';
import { CalibrationSource, CoverageNote, PaceGuides, coverageGaps } from './PlanWidgets';
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

/** The brief as the coach will use it: what the human confirms before locking. */
export function PlanningReview({ state }: { state: BriefState }) {
  const units = useUnits(state.brief.unit);
  const answer = (a: BriefState['brief']['weeklyDistance']) =>
    a.status === 'known'
      ? formatDistance(a.value, units)
      : a.status === 'unanswered'
        ? 'Not answered'
        : 'Unknown';
  const runs = state.brief.currentRuns;
  const pace = latestCalibration(state);
  const availability = state.brief.weekdays
    .map((value, index) =>
      value === 'unavailable'
        ? null
        : `${WEEKDAYS_SHORT[index]}${value === 'preferred' ? '★' : ''}`,
    )
    .filter(Boolean)
    .join(' · ');
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
        <Assumption icon={Globe2} label="Timezone" value={state.brief.timezone || 'Not set'} />
        <Assumption
          icon={TrendingUp}
          label="Current weekly distance"
          value={answer(state.brief.weeklyDistance)}
        />
        <Assumption
          icon={Route}
          label="Longest recent run"
          value={answer(state.brief.longestRun)}
        />
        <Assumption
          icon={Repeat}
          label="Runs per week"
          value={`${runs.status === 'known' ? runs.value : runs.status === 'unanswered' ? 'Not answered' : 'Unknown'} now → ${state.brief.desiredRuns ?? 'not set'} planned`}
        />
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
      {pace ? (
        <>
          <CalibrationSource calibration={pace} units={units} />
          <PaceGuides calibration={pace} units={units} compact />
        </>
      ) : (
        <p className="muted">No pace guides saved yet.</p>
      )}
      <CoverageSummary state={state} />
    </section>
  );
}
