import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useCoachWord } from '../data/account';
import {
  currentEntry,
  isEstimate,
  knownCoverage,
  usePerformance,
  type BriefState,
  type Calibration,
  type Plan,
} from '../data/plan-data';
import type { WorkoutSummary } from '../lib/api-types';
import { timeline, type PlanBlock } from '../lib/blocks';
import {
  addDays,
  daysBetween,
  formatDistance,
  formatDuration,
  formatRange,
  formatShort,
  formatShortYear,
  type Units,
} from '../lib/format';
import { describeEvidence, formatZoneValue, SYSTEM_META, systemsForSports } from '../lib/sports';
import { topRace, type WeekSummary } from '../lib/workouts';
import { effortTint, useSportUnits, useTheme } from '../state/settings';
import { alpha, zoneEffort } from '../theme/palette';
import { Badge, PressableScale, Text, type IconName } from './ui';

// ---- Plan state --------------------------------------------------------------------------------

/** State is shown as a pill; actions are separate buttons so an icon never means two things. */
export function StatusPill({ plan, onPress }: { plan: Plan; onPress?: () => void }) {
  const theme = useTheme();
  const locked = !plan.draft && !plan.archived;
  const [icon, label]: [IconName, string] = plan.archived
    ? ['archive-outline', 'Archived']
    : plan.draft && plan.locked
      ? ['lock-open-outline', 'Unlocked']
      : plan.draft
        ? ['create-outline', 'Draft']
        : ['lock-closed', 'Locked'];
  const color = plan.archived ? theme.colors.textDim : locked ? theme.locked : theme.accentText;
  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label}, plan status`}
    >
      <Badge
        label={label}
        icon={icon}
        size="lg"
        color={color}
        background={
          plan.archived ? theme.colors.surfaceRaised : locked ? theme.lockedSoft : theme.accentSoft
        }
        border={
          plan.archived ? theme.colors.border : locked ? theme.lockedBorder : theme.accentBorder
        }
      />
    </PressableScale>
  );
}

// ---- Coverage ----------------------------------------------------------------------------------

export function coverageGaps(state: Pick<BriefState, 'startDate' | 'endDate' | 'coverage'>) {
  const gaps: { start: string; end: string }[] = [];
  if (state.startDate && state.endDate && knownCoverage(state as BriefState)) {
    let next = state.startDate;
    for (const range of state.coverage) {
      if (range.startDate > next) gaps.push({ start: next, end: addDays(range.startDate, -1) });
      if (range.endDate >= next) next = addDays(range.endDate, 1);
    }
    if (next <= state.endDate) gaps.push({ start: next, end: state.endDate });
  }
  return gaps;
}

/** Whether the whole plan is prescribed and nothing about its coverage needs attention. */
export function fullyPlanned(state: BriefState) {
  return (
    !!knownCoverage(state) &&
    !coverageGaps(state).length &&
    !state.generations?.some((g) => g.status === 'interrupted' || g.status === 'in_progress') &&
    !state.coverage.some((range) => !range.current)
  );
}

/** How far the coach has prescribed versus the whole plan. */
export function CoverageNote({ state }: { state: BriefState }) {
  const theme = useTheme();
  const coach = useCoachWord();
  const gaps = coverageGaps(state);
  const interrupted = state.generations?.find((g) => g.status === 'interrupted');
  const generating = state.generations?.find((g) => g.status === 'in_progress');
  const stale = state.coverage.some((range) => !range.current);
  const through = state.coverage.at(-1)?.endDate;
  const known = !!knownCoverage(state);
  const complete = known && !gaps.length;
  const lines = !known
    ? ['Workout dates alone don’t show how far this plan is prescribed.']
    : [
        gaps.length
          ? `${gaps.map((gap) => `${formatShort(gap.start)} – ${formatShortYear(gap.end)}`).join(', ')} not planned yet`
          : null,
        generating ? `Your ${coach} is generating more of the schedule…` : null,
        interrupted
          ? `Generation stopped before ${formatShort(interrupted.endDate)}. Ask your ${coach} to continue.`
          : null,
        stale ? 'Planning inputs changed — review the affected weeks.' : null,
      ].filter((line): line is string => !!line);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        padding: 12,
        borderRadius: 16,
        backgroundColor: theme.colors.surfaceRaised,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: interrupted ? theme.warning : theme.colors.border,
      }}
    >
      <Ionicons
        name={
          interrupted || stale ? 'warning-outline' : complete ? 'checkmark-circle' : 'time-outline'
        }
        size={20}
        color={
          interrupted || stale ? theme.warning : complete ? theme.locked : theme.colors.textDim
        }
      />
      <View style={{ flex: 1 }}>
        <Text variant="caption" color="text" style={{ fontWeight: '700' }}>
          {!known
            ? 'Coverage not recorded'
            : complete
              ? 'Planned through the end date'
              : through
                ? `Prescribed through ${formatShort(through)}`
                : 'Nothing fully prescribed yet'}
        </Text>
        {lines.map((line) => (
          <Text key={line} variant="caption" color="muted">
            {line}
          </Text>
        ))}
      </View>
    </View>
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
  races?: Pick<WorkoutSummary, 'id' | 'scheduledDate' | 'racePriority'>[];
}) {
  const theme = useTheme();
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
  // Race markers sit above the bar on a short stem, so leave room for them.
  const top = marked.length ? 22 : 6;
  const end = line.segments.at(-1);
  const lastBlock = end?.kind === 'block' && end.days >= 5 ? end.block : null;
  return (
    <View>
      <View style={{ paddingTop: top }}>
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {line.segments.map((segment, index) => {
            if (segment.kind === 'gap')
              return (
                <View key={segment.startDate} style={{ flex: segment.days }}>
                  <View
                    style={{
                      height: 8,
                      borderRadius: 4,
                      borderWidth: 1,
                      borderStyle: 'dashed',
                      borderColor: theme.colors.border,
                    }}
                  />
                </View>
              );
            const { block } = segment;
            const color = effortTint(theme, block.effort);
            const state =
              block.endDate < today ? 'past' : block.startDate > today ? 'future' : 'current';
            // Bars stay proportional to days (the today and race markers rely on it). The last
            // block's label is drawn across the whole row, from its right edge (below), so a short
            // taper isn't cut to "TA…".
            const last = index === line.segments.length - 1;
            return (
              <View key={block.id} style={{ flex: segment.days, minWidth: 6 }}>
                <View
                  style={{
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: alpha(
                      color,
                      state === 'past' ? 1 : state === 'current' ? 0.6 : theme.isDark ? 0.35 : 0.45,
                    ),
                  }}
                />
                <Text
                  variant="label"
                  numberOfLines={1}
                  style={{
                    marginTop: 8,
                    fontSize: 10,
                    color: state === 'current' ? color : theme.colors.textMuted,
                  }}
                >
                  {segment.days >= 5 && !last ? block.label : ' '}
                </Text>
              </View>
            );
          })}
        </View>
        {lastBlock ? (
          <Text
            variant="label"
            numberOfLines={1}
            style={{
              position: 'absolute',
              right: 0,
              top: top + 16,
              fontSize: 10,
              color:
                lastBlock.startDate <= today && today <= lastBlock.endDate
                  ? effortTint(theme, lastBlock.effort)
                  : theme.colors.textMuted,
            }}
          >
            {lastBlock.label}
          </Text>
        ) : null}
        {marker !== null ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: `${marker}%`, top: top - 4, marginLeft: -2 }}
          >
            <View
              style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: theme.colors.text }}
            />
          </View>
        ) : null}
        {marked.map((race) => {
          const left = at(race.scheduledDate);
          return left === null ? null : (
            <View
              key={race.id}
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: `${left}%`,
                top: 0,
                marginLeft: -8,
                alignItems: 'center',
              }}
            >
              <View
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.efforts.max,
                }}
              >
                {race.racePriority === 'A' ? (
                  <Ionicons name="trophy" size={9} color="#fff" />
                ) : (
                  <Text
                    style={{
                      fontSize: 8,
                      lineHeight: 10,
                      fontWeight: '900',
                      color: '#fff',
                      includeFontPadding: false,
                    }}
                  >
                    B
                  </Text>
                )}
              </View>
              <View
                style={{ width: 2, height: 5, borderRadius: 1, backgroundColor: theme.efforts.max }}
              />
            </View>
          );
        })}
      </View>
      {focus ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
          <Text variant="label" style={{ fontSize: 10 }}>
            {current ? 'Now' : 'Starts with'}
          </Text>
          <Text
            variant="caption"
            style={{ color: effortTint(theme, focus.effort), fontWeight: '800' }}
          >
            {focus.label}
          </Text>
          <Text variant="caption" numberOfLines={1} style={{ flex: 1 }}>
            {focus.title} ·{' '}
            {current
              ? `until ${formatShort(focus.endDate)}`
              : `from ${formatShort(focus.startDate)}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ---- Weekly volume -----------------------------------------------------------------------------

/** Volume-per-week bars; tapping one selects the week. */
export function WeekChart({
  weeks,
  selected,
  current,
  onSelect,
  measure,
  blockOf,
  isCutback,
}: {
  weeks: WeekSummary[];
  selected: number;
  current: number | null;
  onSelect: (week: number) => void;
  measure: 'distance' | 'time';
  blockOf: (week: WeekSummary) => PlanBlock | null;
  isCutback: (week: WeekSummary) => boolean;
}) {
  const theme = useTheme();
  const amount = (week: WeekSummary) => (measure === 'time' ? week.seconds : week.metres);
  const max = Math.max(...weeks.map(amount), 1);
  const scroll = weeks.length > 16;
  const barHeight = (week: WeekSummary) =>
    week.planned ? Math.max(10, (amount(week) / max) * 36) : 16;
  // Every week shares one height, so bars stay bottom-aligned: the tallest bar plus its week
  // number (and a race label above it, 20px each with the gap), at least 66.
  const height = Math.max(
    66,
    ...weeks.map((week) => barHeight(week) + 20 + (topRace(week.workouts) ? 20 : 0)),
  );
  const bars = weeks.map((week) => {
    const active = week.number === selected;
    const block = blockOf(week);
    const race = topRace(week.workouts);
    const past = current !== null && week.number < current;
    const h = barHeight(week);
    const base = block ? effortTint(theme, block.effort) : theme.accent;
    // The selected week keeps its phase colour, outlined in the accent, so the phase stays readable.
    const fill = active ? base : alpha(base, past ? 0.9 : theme.isDark ? 0.6 : 0.65);
    return (
      <PressableScale
        key={week.number}
        haptic="select"
        onPress={() => onSelect(week.number)}
        scaleTo={0.92}
        accessibilityRole="button"
        accessibilityLabel={`Week ${week.number}${block ? `, ${block.label}` : ''}${isCutback(week) ? ', cutback week' : ''}${week.planned ? '' : ', not planned'}`}
        accessibilityState={{ selected: active }}
        style={{
          flex: scroll ? undefined : 1,
          width: scroll ? 18 : undefined,
          height,
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {race ? (
          <Text variant="label" style={{ fontSize: 9, color: theme.efforts.max }}>
            {race}
          </Text>
        ) : null}
        {week.planned ? (
          <View
            style={{
              width: '100%',
              height: h,
              borderRadius: 8,
              backgroundColor: fill,
              borderWidth: active ? 2 : isCutback(week) ? 1.5 : 0,
              borderStyle: active ? 'solid' : 'dashed',
              borderColor: active ? theme.colors.text : theme.colors.bg,
            }}
          />
        ) : (
          <View
            style={{
              width: '100%',
              height: h,
              borderRadius: 8,
              borderWidth: 1.5,
              borderStyle: 'dashed',
              borderColor: active ? theme.accent : theme.colors.border,
            }}
          />
        )}
        <Text
          variant="label"
          numeric
          style={{
            fontSize: 10,
            color: active
              ? theme.accentText
              : week.number === current
                ? theme.colors.text
                : theme.colors.textMuted,
          }}
        >
          {week.number}
        </Text>
      </PressableScale>
    );
  });
  if (scroll)
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: 5 }}>{bars}</View>
      </ScrollView>
    );
  return <View style={{ flexDirection: 'row', gap: 5 }}>{bars}</View>;
}

/** A week's totals in one line under its heading: volume, sessions and how many are hard. */
export function WeekSummaryLine({
  week,
  measure,
  units,
}: {
  week: WeekSummary;
  measure: 'distance' | 'time';
  units: Units;
}) {
  const hard = week.workouts.filter((workout) =>
    /interval|threshold|tempo|vo2|race|speed|sprint|test/i.test(workout.title),
  ).length;
  const volume =
    measure === 'time'
      ? formatDuration(week.seconds)
      : `${formatDistance(week.metres, units, false)} ${units} · ${formatDuration(week.seconds)}`;
  return (
    <Text variant="caption" color="text" numeric style={{ marginTop: 4, fontWeight: '700' }}>
      {volume}
      <Text variant="caption" numeric>
        {` · ${week.sessions} ${week.sessions === 1 ? 'session' : 'sessions'}${hard ? ` · ${hard} hard` : ''}`}
      </Text>
    </Text>
  );
}

// ---- Zones -------------------------------------------------------------------------------------

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

/** Where a system's zones came from; estimates are flagged so they get replaced by a result. */
export function CalibrationSource({
  calibration,
  units,
  style,
}: {
  calibration: Calibration;
  units: Units;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const { pool } = useSportUnits();
  const [open, setOpen] = useState(false);
  const estimate = isEstimate(calibration);
  const heading = SOURCE_HEADINGS[calibration.system];
  // The effective date, evidence and "update them" advice fold away, as they repeat for every
  // sport. The fold always holds the date, so it is always offered.
  return (
    <View style={[{ marginHorizontal: 20, flexDirection: 'row', gap: 10 }, style]}>
      <Ionicons
        name={estimate ? 'warning' : 'checkmark-circle'}
        size={15}
        color={estimate ? theme.warning : theme.locked}
        style={{ marginTop: 2 }}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="caption" color="text" style={{ fontWeight: '700' }}>
          {calibration.provenance === 'agent_estimate'
            ? `Coach-${heading.estimated.toLowerCase()}`
            : estimate
              ? heading.estimated
              : heading.measured}
        </Text>
        <Text variant="caption" numeric>
          {describeEvidence(calibration, { units, pool })}
          {calibration.observedOn ? ` on ${formatShortYear(calibration.observedOn)}` : ''}
        </Text>
        <Pressable
          onPress={() => setOpen(!open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
        >
          <Text variant="caption" color="accent" style={{ fontWeight: '800' }}>
            {open
              ? 'Hide'
              : estimate
                ? 'Why an estimate?'
                : calibration.estimateBasis
                  ? 'Evidence'
                  : 'Details'}
          </Text>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={13}
            color={theme.accentText}
          />
        </Pressable>
        {open && calibration.estimateBasis ? (
          <Text variant="caption" color="muted">
            {calibration.provenance === 'agent_estimate' ? 'Coach estimate: ' : 'Evidence: '}
            {calibration.estimateBasis}
          </Text>
        ) : null}
        {open ? (
          <Text variant="caption" color="muted" numeric>
            {`Applies from ${formatShortYear(calibration.effectiveFrom)}.`}
            {estimate
              ? ' These are estimates. Update them after a test, a race or a few sessions.'
              : ''}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** "Pace guides" for running-only plans, "Training zones" once other sports join. */
export function zonesTitle(sports: string[]) {
  const systems = systemsForSports(sports.length ? sports : ['run']);
  return systems.length === 1 ? SYSTEM_META[systems[0]!].title : 'Training zones';
}

/**
 * Horizontal zone cards for the sports a plan trains, one system after another. Sports without
 * calibration say so, because a plan cannot lock until each has some.
 */
export function ZoneCards({
  sports,
  units,
  showSource = false,
}: {
  sports: string[];
  units: Units;
  /** Say where each system's zones came from, flagging estimates. */
  showSource?: boolean;
}) {
  const theme = useTheme();
  const coach = useCoachWord();
  const { pool } = useSportUnits();
  const performance = usePerformance();
  const systems = systemsForSports(sports.length ? sports : ['run']);
  const display = { units, pool };
  const bare = (value: number, unit: string) =>
    formatZoneValue(value, unit, display).replace(/\/.*$/, '').replace(/ W$/, '');
  const suffix = (unit: string) =>
    unit === 'watts' ? 'W' : unit === 'seconds_per_100_metres' ? `/100${pool}` : `/${units}`;
  return (
    <View style={{ gap: 16 }}>
      {systems.map((system) => {
        const entry = currentEntry(performance.data, system);
        const meta = SYSTEM_META[system];
        return (
          <View key={system}>
            {systems.length > 1 ? (
              <Text variant="label" style={{ paddingHorizontal: 20, marginBottom: 8 }}>
                {meta.title}
              </Text>
            ) : null}
            {entry ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
              >
                {Object.keys(meta.zones)
                  .map((key) => entry.zones.find((zone) => zone.key === key))
                  .filter((zone): zone is NonNullable<typeof zone> => !!zone)
                  .map((zone) => (
                    <View
                      key={zone.key}
                      style={{
                        width: 132,
                        padding: 14,
                        borderRadius: 20,
                        backgroundColor: theme.colors.surface,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                      }}
                    >
                      <View
                        style={{
                          width: 28,
                          height: 4,
                          borderRadius: 2,
                          backgroundColor: theme.efforts[zoneEffort(zone.key)],
                          marginBottom: 12,
                        }}
                      />
                      <Text variant="label" numberOfLines={1}>
                        {meta.zones[zone.key]?.label ?? zone.key}
                      </Text>
                      <Text variant="heading" numeric style={{ marginTop: 4 }}>
                        {bare(zone.target, zone.unit)}
                        <Text variant="caption" numeric>
                          {` ${suffix(zone.unit)}`}
                        </Text>
                      </Text>
                      <Text variant="caption" numeric>
                        {bare(zone.minimum, zone.unit)}–{bare(zone.maximum, zone.unit)}{' '}
                        {suffix(zone.unit)}
                      </Text>
                    </View>
                  ))}
              </ScrollView>
            ) : performance.isPending ? null : (
              <Text variant="caption" color="muted" style={{ paddingHorizontal: 20 }}>
                {`No ${meta.noun} yet. Add a result or an estimate on the Performance page, or share one with your ${coach}.`}
              </Text>
            )}
            {entry && showSource ? (
              <CalibrationSource calibration={entry} units={units} style={{ marginTop: 10 }} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// ---- Coverage -----------------------------------------------------------------------------------

/** Detailed coverage: intended generation horizons, prescribed ranges and remaining gaps. */
export function CoverageSummary({ state }: { state: BriefState }) {
  const theme = useTheme();
  const gaps = coverageGaps(state);
  return (
    <View style={{ gap: 10 }}>
      <CoverageNote state={state} />
      {state.generations?.map((generation) => (
        <Text key={generation.runId} variant="caption">
          Intended horizon: {formatRange(generation.startDate, generation.endDate)}.{' '}
          {generation.status === 'completed'
            ? 'Generation completed.'
            : generation.status === 'in_progress'
              ? 'Generation in progress.'
              : 'Generation stopped before the intended horizon was complete.'}{' '}
          {generation.prescribedThrough
            ? `Fully prescribed through ${formatShortYear(generation.prescribedThrough)}.`
            : 'No complete coverage was recorded for this attempt.'}
        </Text>
      ))}
      {state.coverage.map((range) => (
        <View key={range.startDate} style={{ flexDirection: 'row', gap: 10 }}>
          <Text variant="label" style={{ width: 92, marginTop: 2 }}>
            Prescribed
          </Text>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="caption" color="text" numeric>
              {formatRange(range.startDate, range.endDate)}
            </Text>
            {!range.current ? (
              <Text variant="caption" style={{ color: theme.warning, fontWeight: '700' }}>
                Planning inputs changed; review this range
              </Text>
            ) : null}
          </View>
        </View>
      ))}
      {gaps.map((gap) => (
        <View key={gap.start} style={{ flexDirection: 'row', gap: 10 }}>
          <Text variant="label" style={{ width: 92, marginTop: 2, color: theme.warning }}>
            Unplanned
          </Text>
          <Text variant="caption" color="text" numeric style={{ flex: 1 }}>
            {formatRange(gap.start, gap.end)}
          </Text>
        </View>
      ))}
      <Text variant="caption" color="muted">
        You can lock an initial horizon and extend the plan in a later revision.
      </Text>
    </View>
  );
}
