import type { WorkoutSummary } from '@askesis/api-client';
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
  Trophy,
} from 'lucide-react';
import { timeline, type PlanBlock } from '../lib/blocks';
import {
  addDays,
  daysBetween,
  formatDistance,
  formatDuration,
  formatRange,
  formatShort,
  formatShortYear,
} from '../lib/format';
import {
  currentEntry,
  describeEvidence,
  formatZoneValue,
  isEstimate,
  SYSTEM_META,
  systemsForSports,
} from '../lib/sports';
import { RACE_META, topRace, type WeekSummary } from '../lib/workouts';
import {
  knownCoverage,
  usePerformance,
  type BriefState,
  type Calibration,
  type Plan,
} from '../plan-data';
import { useSportUnits, type Units } from '../settings';
import { KIND_COLORS, ZONE_COLORS } from '../theme/palette';
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

// ---- Training blocks ---------------------------------------------------------------------------

/**
 * The plan's shape: blocks end to end, sized by days and coloured by phase, with today marked.
 * Finished blocks are solid, the current one half-strength and later ones faint.
 */
export function BlockTimeline({
  blocks,
  startDate,
  endDate,
  today,
  races = [],
}: {
  blocks: PlanBlock[];
  startDate: string | null;
  endDate: string | null;
  today: string;
  /** A and B races are marked on the line; C races are training and stay off it. */
  races?: Pick<WorkoutSummary, 'id' | 'title' | 'scheduledDate' | 'racePriority'>[] | undefined;
}) {
  const line = timeline(blocks, startDate, endDate);
  if (!line) return null;
  const at = (date: string) => {
    const offset = daysBetween(line.startDate, date);
    return offset >= 0 && offset < line.days ? ((offset + 0.5) / line.days) * 100 : null;
  };
  const marker = at(today);
  const marked = races.filter((race) => race.racePriority === 'A' || race.racePriority === 'B');
  const current = blocks.find((block) => today >= block.startDate && today <= block.endDate);
  const next = current ? null : blocks.find((block) => block.startDate > today);
  const focus = current ?? next;
  return (
    <div className="block-timeline" style={{ '--race': KIND_COLORS.race } as CSSProperties}>
      <div className="block-track-wrap">
        <ol className="block-track" aria-label="Training blocks">
          {line.segments.map((segment) => {
            if (segment.kind === 'gap')
              return (
                <li
                  key={segment.startDate}
                  className="block-segment gap"
                  style={{ flexGrow: segment.days }}
                  title={`${formatRange(segment.startDate, segment.endDate)} · not organised into blocks yet`}
                >
                  <span className="block-bar" aria-hidden="true" />
                  <span className="sr-only">
                    {formatRange(segment.startDate, segment.endDate)}: not organised into blocks yet
                  </span>
                </li>
              );
            const { block } = segment;
            const state =
              block.endDate < today ? 'past' : block.startDate > today ? 'future' : 'current';
            const range = formatRange(block.startDate, block.endDate);
            return (
              <li
                key={block.id}
                className={cx('block-segment', state)}
                style={{ flexGrow: segment.days, '--phase': block.color } as CSSProperties}
                title={`${block.label} · ${block.title}\n${range}${block.description ? `\n${block.description}` : ''}`}
              >
                <span className="block-bar" aria-hidden="true" />
                <span className="block-label" aria-hidden="true">
                  {block.label}
                </span>
                <span className="sr-only">
                  {block.label}: {block.title}, {range}
                  {state === 'current' ? ' (current block)' : ''}
                </span>
              </li>
            );
          })}
        </ol>
        {marker !== null ? (
          <span className="block-today" style={{ left: `${marker}%` }} aria-hidden="true" />
        ) : null}
        {marked.map((race) => {
          const left = at(race.scheduledDate);
          return left === null ? null : (
            <span
              key={race.id}
              className={cx('block-race', `race-${race.racePriority!.toLowerCase()}`)}
              style={{ left: `${left}%` }}
              title={`${RACE_META[race.racePriority!].label}: ${race.title}, ${formatShort(race.scheduledDate)}`}
            >
              {race.racePriority === 'A' ? <Trophy size={11} aria-hidden="true" /> : null}
              <span className="sr-only">
                {RACE_META[race.racePriority!].label}: {race.title},{' '}
                {formatShort(race.scheduledDate)}
              </span>
            </span>
          );
        })}
      </div>
      {focus ? (
        <p className="block-now" style={{ '--phase': focus.color } as CSSProperties}>
          <span className="block-now-label">{current ? 'Now' : 'Starts with'}</span>
          <strong>{focus.label}</strong>
          <span>{focus.title}</span>
          <small>
            {current
              ? `until ${formatShort(focus.endDate)}`
              : `from ${formatShort(focus.startDate)}`}
          </small>
        </p>
      ) : null}
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
  measure = 'distance',
  blockOf,
  isCutback,
}: {
  weeks: WeekSummary[];
  selected: number;
  current: number | null;
  onSelect: (week: number) => void;
  units: Units;
  measure?: 'distance' | 'time' | undefined;
  /** Tints each bar by its block's phase; bars fall back to the accent without one. */
  blockOf?: ((week: WeekSummary) => PlanBlock | null) | undefined;
  /** Hatches deliberately lighter weeks. */
  isCutback?: ((week: WeekSummary) => boolean) | undefined;
}) {
  const amount = (week: WeekSummary) => (measure === 'time' ? week.seconds : week.metres);
  const max = Math.max(...weeks.map(amount), 1);
  // Leave headroom for race badges above the tallest bars.
  const room = weeks.some((week) => topRace(week.workouts)) ? 82 : 100;
  return (
    <div
      className="week-chart"
      role="group"
      aria-label="Weekly volume"
      style={{ '--race': KIND_COLORS.race } as CSSProperties}
    >
      {weeks.map((week) => {
        const active = week.number === selected;
        const block = blockOf?.(week) ?? null;
        const cutback = isCutback?.(week) ?? false;
        const race = topRace(week.workouts);
        const height = week.planned ? Math.max(10, (amount(week) / max) * room) : 26;
        return (
          <button
            key={week.number}
            type="button"
            className={cx(
              'week-bar',
              block && 'phased',
              cutback && 'cutback',
              active && 'active',
              !week.planned && 'unplanned',
              current !== null && week.number < current && 'past',
            )}
            style={{ '--bar': block?.color } as CSSProperties}
            aria-pressed={active}
            aria-label={`Week ${week.number}${block ? `, ${block.label}` : ''}${cutback ? ', cutback week' : ''}${race ? `, ${RACE_META[race].label}` : ''}${week.planned ? `, ${measure === 'time' ? formatDuration(week.seconds) : formatDistance(week.metres, units)}` : ', not planned'}`}
            onClick={() => onSelect(week.number)}
          >
            <span className="bar-track">
              <span className="bar-fill" style={{ height: `${height}%` }}>
                {race ? (
                  <span className={cx('bar-race', `race-${race.toLowerCase()}`)} aria-hidden="true">
                    {race}
                  </span>
                ) : null}
              </span>
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

// ---- Zone guides ------------------------------------------------------------------------------

/** One system's zones, easiest to hardest: running pace, cycling power or swim pace. */
export function ZoneGuides({
  calibration,
  units,
  compact,
}: {
  calibration: Calibration;
  units: Units;
  compact?: boolean | undefined;
}) {
  const { pool } = useSportUnits();
  const display = { units, pool };
  const meta = SYSTEM_META[calibration.system];
  const zones = Object.keys(meta.zones)
    .map((key) => calibration.zones.find((z) => z.key === key))
    .filter((zone): zone is NonNullable<typeof zone> => !!zone);
  const bare = (value: number, unit: string) =>
    formatZoneValue(value, unit, display).replace(/\/.*$/, '').replace(/ W$/, '');
  return (
    <div className={cx('pace-guides', compact && 'compact')} data-system={calibration.system}>
      {zones.map((zone) => {
        const zoneMeta = meta.zones[zone.key];
        return (
          <div
            className="pace-card"
            key={zone.key}
            style={{ '--zone': ZONE_COLORS[zone.key] ?? ZONE_COLORS.easy } as CSSProperties}
          >
            <span className="zone-swatch" aria-hidden="true" />
            <span className="label">
              {compact
                ? (zoneMeta?.label ?? zone.key)
                : `${zoneMeta?.short} · ${zoneMeta?.label ?? zone.key}`}
            </span>
            <strong>{bare(zone.target, zone.unit)}</strong>
            <small>
              {bare(zone.minimum, zone.unit)}–{formatZoneValue(zone.maximum, zone.unit, display)}
            </small>
            {!compact && zoneMeta ? <p>{zoneMeta.description}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

const SOURCE_HEADINGS: Record<Calibration['system'], { measured: string; estimated: string }> = {
  run_pace: {
    measured: 'Pace guides calculated from your race result',
    estimated: 'Estimated pace guides',
  },
  cycle_power: {
    measured: 'Power zones calculated from your FTP',
    estimated: 'Estimated power zones',
  },
  swim_pace: {
    measured: 'Swim paces calculated from your CSS',
    estimated: 'Estimated swim paces',
  },
};

export function CalibrationSource({
  calibration,
  units,
}: {
  calibration: Calibration;
  units: Units;
}) {
  const { pool } = useSportUnits();
  const estimate = isEstimate(calibration);
  const heading = SOURCE_HEADINGS[calibration.system];
  return (
    <div className="calibration-source">
      <div className="calibration-heading">
        <strong>
          {calibration.provenance === 'agent_estimate'
            ? `Coach-${heading.estimated.toLowerCase()}`
            : estimate
              ? heading.estimated
              : heading.measured}
        </strong>
        {estimate ? (
          <Pill tone="warning" icon={TriangleAlert}>
            Estimate
          </Pill>
        ) : null}
      </div>
      <p>
        {estimate ? 'Estimate: ' : 'Evidence: '}
        {describeEvidence(calibration, { units, pool })}
        {calibration.observedOn ? ` on ${formatShortYear(calibration.observedOn)}` : ''}
        {' · applies from '}
        {formatShortYear(calibration.effectiveFrom)}
      </p>
      {calibration.estimateBasis ? (
        <p>
          {calibration.provenance === 'agent_estimate' ? 'Coach estimate: ' : 'Evidence: '}
          {calibration.estimateBasis}
        </p>
      ) : null}
      {estimate ? (
        <p className="muted">
          These are estimates. Update them after a test, a race or a few sessions.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The zones a plan's sports use, one system after another. Sports without calibration say so,
 * because a plan cannot lock until each has some.
 */
export function PlanZones({
  sports,
  units,
  compact,
  showSource = true,
}: {
  sports: string[];
  units: Units;
  compact?: boolean | undefined;
  showSource?: boolean | undefined;
}) {
  const performance = usePerformance();
  const systems = systemsForSports(sports.length ? sports : ['run']);
  return (
    <div className="plan-zones">
      {systems.map((system) => {
        const entry = currentEntry(performance.data, system);
        const meta = SYSTEM_META[system];
        return (
          <section key={system} className="plan-zone-system" aria-label={meta.title}>
            {systems.length > 1 ? <h3 className="label">{meta.title}</h3> : null}
            {entry ? (
              <>
                <ZoneGuides calibration={entry} units={units} compact={compact} />
                {showSource ? <CalibrationSource calibration={entry} units={units} /> : null}
              </>
            ) : performance.isPending ? null : (
              <p className="muted">
                No {meta.noun} yet. Add a result or an estimate on the Performance page, or share
                one with your coach.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** "Pace guides" for running-only plans, "Training zones" once other sports join. */
export function zonesTitle(sports: string[]) {
  const systems = systemsForSports(sports.length ? sports : ['run']);
  return systems.length === 1 ? SYSTEM_META[systems[0]!].title : 'Training zones';
}
