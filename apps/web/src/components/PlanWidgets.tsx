import type { CSSProperties } from 'react';
import {
  Archive,
  CheckCircle2,
  Clock3,
  Lock,
  LockOpen,
  PencilLine,
  Power,
  PowerOff,
  TriangleAlert,
} from 'lucide-react';
import { addDays, formatDistance, formatPace, formatShort, formatShortYear } from '../lib/format';
import type { WeekSummary } from '../lib/workouts';
import {
  isEstimate,
  knownCoverage,
  type BriefState,
  type Calibration,
  type Plan,
} from '../plan-data';
import type { Units } from '../settings';
import { ZONE_COLORS } from '../theme/palette';
import { Pill, cx } from './ui';

// ---- Plan state --------------------------------------------------------------------------------

/** State is shown as a pill; actions live in the toolbar so an icon never means two things. */
export function StatusPill({ plan }: { plan: Plan }) {
  if (plan.archived)
    return (
      <Pill icon={Archive} tone="neutral">
        Archived
      </Pill>
    );
  if (plan.draft && plan.locked)
    return (
      <Pill
        icon={LockOpen}
        tone="accent"
        title="An editable draft exists alongside the unchanged locked version."
      >
        Unlocked
      </Pill>
    );
  if (plan.draft)
    return (
      <Pill icon={PencilLine} tone="accent" title="Editable draft. Your coach can change it.">
        Draft
      </Pill>
    );
  return (
    <Pill icon={Lock} tone="locked" title="Locked version. Unlock to make changes.">
      Locked
    </Pill>
  );
}

/** Lifecycle, activation and displayed content are independent facts. */
export function PlanStatus({ plan, view }: { plan: Plan; view?: 'locked' | 'draft' }) {
  const source = view === 'draft' && plan.draft ? plan.draft : (plan.locked ?? plan.draft);
  return (
    <>
      <StatusPill plan={plan} />
      <Pill
        icon={plan.active ? Power : PowerOff}
        tone="neutral"
        title={
          plan.archived
            ? 'Archived plans are inactive and read-only.'
            : plan.active
              ? 'Shown in Today and the active Plan area.'
              : !plan.locked
                ? 'Lock a version before activating this plan.'
                : 'Kept in your library; activate it to follow it.'
        }
      >
        {plan.active ? 'Active' : 'Inactive'}
      </Pill>
      {view && source ? (
        <Pill tone="neutral" title="Content currently shown below.">
          {source.state === 'draft'
            ? source.basedOnVersionId && source.basedOnVersionId !== plan.locked?.id
              ? 'Restored draft'
              : plan.locked
                ? `Draft · from v${plan.locked.versionNumber}`
                : 'Initial draft'
            : `Locked v${source.versionNumber}`}
        </Pill>
      ) : null}
    </>
  );
}

// ---- Coverage ----------------------------------------------------------------------------------

export function coverageGaps(state: Pick<BriefState, 'startDate' | 'endDate' | 'coverage'>) {
  const gaps: { start: string; end: string }[] = [];
  if (state.startDate && state.endDate && knownCoverage(state)) {
    let next = state.startDate;
    for (const range of state.coverage) {
      if (range.startDate > next) gaps.push({ start: next, end: addDays(range.startDate, -1) });
      if (range.endDate >= next) next = addDays(range.endDate, 1);
    }
    if (next <= state.endDate) gaps.push({ start: next, end: state.endDate });
  }
  return gaps;
}

/** One-line summary of how far the coach has prescribed versus the whole plan. */
export function CoverageNote({ state }: { state: BriefState }) {
  const gaps = coverageGaps(state);
  const interrupted = state.generations?.find((g) => g.status === 'interrupted');
  const generating = state.generations?.find((g) => g.status === 'in_progress');
  const stale = state.coverage.some((range) => !range.current);
  const through = state.coverage.at(-1)?.endDate;
  if (!knownCoverage(state))
    return (
      <div className="coverage-note">
        <Clock3 size={18} aria-hidden="true" />
        <div>
          <strong>Coverage not recorded</strong>
          <small>Workout dates alone don’t show how far this plan is prescribed.</small>
        </div>
      </div>
    );
  return (
    <div className={cx('coverage-note', interrupted && 'warning')}>
      {interrupted || stale ? (
        <TriangleAlert size={18} aria-hidden="true" />
      ) : gaps.length ? (
        <Clock3 size={18} aria-hidden="true" />
      ) : (
        <CheckCircle2 size={18} aria-hidden="true" className="ok" />
      )}
      <div>
        <strong>
          {!gaps.length
            ? 'Planned through the end date'
            : through
              ? `Prescribed through ${formatShort(through)}`
              : 'Nothing fully prescribed yet'}
        </strong>
        {gaps.length ? (
          <small>
            {gaps
              .map((gap) => `${formatShort(gap.start)} – ${formatShortYear(gap.end)}`)
              .join(', ')}{' '}
            not planned yet
          </small>
        ) : null}
        {generating ? <small>Your coach is generating more of the schedule…</small> : null}
        {interrupted ? (
          <small>
            Generation stopped before {formatShort(interrupted.endDate)}. Ask your coach to
            continue.
          </small>
        ) : null}
        {stale ? <small>Planning inputs changed — review the affected weeks.</small> : null}
      </div>
    </div>
  );
}

// ---- Weekly volume -----------------------------------------------------------------------------

export function WeekChart({
  weeks,
  selected,
  current,
  onSelect,
  units,
}: {
  weeks: WeekSummary[];
  selected: number;
  current: number | null;
  onSelect: (week: number) => void;
  units: Units;
}) {
  const max = Math.max(...weeks.map((w) => w.metres), 1);
  return (
    <div className="week-chart" role="group" aria-label="Weekly volume">
      {weeks.map((week) => {
        const active = week.number === selected;
        const height = week.planned ? Math.max(10, (week.metres / max) * 100) : 26;
        return (
          <button
            key={week.number}
            type="button"
            className={cx(
              'week-bar',
              active && 'active',
              !week.planned && 'unplanned',
              current !== null && week.number < current && 'past',
            )}
            aria-pressed={active}
            aria-label={`Week ${week.number}${week.planned ? `, ${formatDistance(week.metres, units)}` : ', not planned'}`}
            onClick={() => onSelect(week.number)}
          >
            <span className="bar-track">
              <span className="bar-fill" style={{ height: `${height}%` }} />
            </span>
            <span className={cx('bar-label', week.number === current && 'current')}>
              {week.number}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Stat({
  label,
  value,
  unit,
  sub,
  large,
}: {
  label: string;
  value: string;
  unit?: string | undefined;
  sub?: string | undefined;
  large?: boolean | undefined;
}) {
  return (
    <span className={cx('stat', large && 'stat-large')}>
      <span className="label">{label}</span>
      <span className="stat-value">
        <strong>{value}</strong>
        {unit ? <small>{unit}</small> : null}
      </span>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </span>
  );
}

// ---- Pace guides -------------------------------------------------------------------------------

const ZONE_ORDER = ['easy', 'marathon', 'threshold', 'interval', 'repetition'];
export const ZONE_LABELS: Record<string, { label: string; short: string; description: string }> = {
  easy: {
    label: 'Easy',
    short: 'E',
    description: 'Relaxed aerobic running, warm-ups, cool-downs and recovery.',
  },
  marathon: {
    label: 'Marathon',
    short: 'M',
    description: 'Sustained running guided by current marathon fitness.',
  },
  threshold: {
    label: 'Threshold',
    short: 'T',
    description: 'Comfortably hard, controlled tempos and cruise intervals.',
  },
  interval: {
    label: 'Interval',
    short: 'I',
    description: 'Hard aerobic repetitions with recovery between efforts.',
  },
  repetition: {
    label: 'Repetition',
    short: 'R',
    description: 'Short, fast, relaxed efforts with generous recovery.',
  },
};

export function PaceGuides({
  calibration,
  units,
  compact,
}: {
  calibration: Calibration;
  units: Units;
  compact?: boolean | undefined;
}) {
  const zones = ZONE_ORDER.map((key) => calibration.zones.find((z) => z.key === key)).filter(
    (zone): zone is NonNullable<typeof zone> => !!zone,
  );
  return (
    <div className={cx('pace-guides', compact && 'compact')}>
      {zones.map((zone) => {
        const meta = ZONE_LABELS[zone.key];
        return (
          <div
            className="pace-card"
            key={zone.key}
            style={{ '--zone': ZONE_COLORS[zone.key] ?? ZONE_COLORS.easy } as CSSProperties}
          >
            <span className="zone-swatch" aria-hidden="true" />
            <span className="label">
              {compact ? (meta?.label ?? zone.key) : `${meta?.short} · ${meta?.label ?? zone.key}`}
            </span>
            <strong>{formatPace(zone.target, units, false)}</strong>
            <small>
              {formatPace(zone.fast, units, false)}–{formatPace(zone.slow, units)}
            </small>
            {!compact && meta ? <p>{meta.description}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

export function CalibrationSource({
  calibration,
  units,
}: {
  calibration: Calibration;
  units: Units;
}) {
  const estimate = isEstimate(calibration);
  return (
    <div className="calibration-source">
      <div className="calibration-heading">
        <strong>
          {calibration.provenance === 'agent_estimate'
            ? 'Coach-estimated pace guides'
            : estimate
              ? 'Estimated pace guides'
              : 'Pace guides calculated from your race result'}
        </strong>
        {estimate ? (
          <Pill tone="warning" icon={TriangleAlert}>
            Estimate
          </Pill>
        ) : null}
      </div>
      <p>
        {calibration.method === 'threshold_pace'
          ? `Estimated threshold: ${formatPace(calibration.secondsPerKilometre!, units)}`
          : `Race evidence: ${formatDistance(calibration.distanceMetres, units)} in ${Math.floor(calibration.durationSeconds! / 60)}:${String(calibration.durationSeconds! % 60).padStart(2, '0')}`}
        {' · from '}
        {formatShortYear(calibration.effectiveFrom)}
      </p>
      {calibration.estimateBasis ? (
        <p>
          {calibration.provenance === 'agent_estimate' ? 'Coach estimate: ' : 'Pace evidence: '}
          {calibration.estimateBasis}
        </p>
      ) : null}
      {estimate ? (
        <p className="muted">
          These paces are estimates. Update the paces and plan after a few runs.
        </p>
      ) : null}
    </div>
  );
}
