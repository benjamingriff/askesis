import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import type { StepTarget, WorkoutStep } from '../lib/api-types';
import {
  formatDistance,
  formatLoad,
  formatSwimDistance,
  type LoadUnits,
  type PoolUnits,
  type Units,
} from '../lib/format';
import { formatZoneValue, SPORT_META, zoneLabel, type Sport } from '../lib/sports';
import { stepEffort } from '../lib/workouts';
import { useSportUnits, useTheme } from '../state/settings';
import { Badge, Text } from './ui';

type Display = { units: Units; pool: PoolUnits; load: LoadUnits };

function formatValue(
  value: number | null,
  unit: string | null,
  display: Display,
  discipline: string | null,
): string | null {
  if (value === null) return null;
  const { units } = display;
  if (unit === 'seconds') {
    if (value < 60) return `${value}s`;
    const seconds = value % 60;
    return seconds === 0
      ? `${value / 60} min`
      : `${Math.floor(value / 60)}:${String(seconds).padStart(2, '0')}`;
  }
  if (unit === 'minutes') return `${value} min`;
  if (unit === 'hours') return `${value} h`;
  if (unit === 'metres' && discipline === 'swim') return formatSwimDistance(value, display.pool);
  if (unit === 'metres') return value >= 1000 ? formatDistance(value, units) : `${value} m`;
  if (unit === 'kilometres') return formatDistance(value * 1000, units);
  if (unit === 'miles') return formatDistance(value * 1609.344, units);
  if (unit === 'repetitions') return `${value} reps`;
  if (unit === 'kilograms') return formatLoad(value, display.load);
  if (unit === 'pounds') return formatLoad(value / 2.20462, display.load);
  if (unit === null) return String(value);
  return formatZoneValue(value, unit, display);
}

function formatCompletion(step: WorkoutStep, display: Display): string | null {
  const completion = step.completion;
  if (completion === null) return null;
  if (completion.value !== null)
    return formatValue(completion.value, completion.unit, display, step.discipline);
  if (completion.type === 'until_condition')
    return `until ${completion.conditionType?.replaceAll('_', ' ') ?? 'complete'}`;
  if (completion.type === 'open') return 'Open-ended';
  return completion.type.replaceAll('_', ' ');
}

/** "137 W" and "184 W" → "137–184 W"; "4:23/km" and "4:57/km" → "4:23–4:57/km". */
export function compactRange(low: string, high: string): string {
  const unit = /[ /][^ /]*$/.exec(high)?.[0];
  return unit && low.endsWith(unit) ? `${low.slice(0, -unit.length)}–${high}` : `${low}–${high}`;
}

function formatTarget(target: StepTarget, display: Display, discipline: string | null): string {
  if (target.type === 'zone' && target.zoneKey !== null) {
    const zone = target.resolvedZone;
    const name = zoneLabel(target.zoneKey, target.zoneSystem);
    if (zone && zone.minimumValue !== null && zone.maximumValue !== null) {
      const low = formatValue(zone.minimumValue, zone.unit, display, discipline)!;
      const high = formatValue(zone.maximumValue, zone.unit, display, discipline)!;
      return `${name} · ${compactRange(low, high)}`;
    }
    return name;
  }
  if (target.text !== null) return target.text;
  if (target.type === 'rpe' && target.targetValue !== null) return `RPE ${target.targetValue}`;
  if (target.type === 'rir' && target.targetValue !== null)
    return `${target.targetValue} rep${target.targetValue === 1 ? '' : 's'} in reserve`;
  if (target.type === 'load' && target.targetValue !== null)
    return `~${formatValue(target.targetValue, target.unit, display, discipline)}`;
  const minimum = formatValue(target.minimumValue, target.unit, display, discipline);
  const preferred = formatValue(target.targetValue, target.unit, display, discipline);
  const maximum = formatValue(target.maximumValue, target.unit, display, discipline);
  const range =
    minimum !== null && maximum !== null
      ? minimum === maximum
        ? minimum
        : `${minimum}–${maximum}`
      : (preferred ?? minimum ?? maximum);
  return `${target.type.replaceAll('_', ' ')}${range === null ? '' : ` ${range}`}`;
}

function EffortRow({
  step,
  display,
  mixed,
  last,
}: {
  step: WorkoutStep;
  display: Display;
  mixed: boolean;
  last: boolean;
}) {
  const theme = useTheme();
  const color = theme.efforts[stepEffort(step).effort];
  const completion = formatCompletion(step, display);
  const sport = step.discipline ? SPORT_META[step.discipline as Sport] : undefined;
  const role = step.role?.replaceAll('_', ' ');
  return (
    <View style={{ flexDirection: 'row', gap: 14 }}>
      <View style={{ alignItems: 'center', width: 14 }}>
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            borderWidth: 3,
            borderColor: color,
            marginTop: 4,
            backgroundColor: theme.colors.bg,
          }}
        />
        {!last ? (
          <View
            style={{ flex: 1, width: 2, backgroundColor: theme.colors.border, marginVertical: 2 }}
          />
        ) : null}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : 16, gap: 2 }}>
        {role || (mixed && sport) ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {mixed && sport ? (
              <Ionicons name={sport.icon} size={11} color={theme.colors.textMuted} />
            ) : null}
            <Text variant="label" style={{ fontSize: 10 }}>
              {[mixed && sport ? sport.label : null, role].filter(Boolean).join(' · ')}
            </Text>
          </View>
        ) : null}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 8,
          }}
        >
          <Text variant="subheading" style={{ flex: 1 }}>
            {step.label ?? step.movement?.name ?? 'Effort'}
          </Text>
          {completion ? (
            step.completion?.value != null ? (
              <Text variant="subheading" numeric style={{ fontWeight: '800' }}>
                {completion}
              </Text>
            ) : (
              <Text variant="caption" color="muted" style={{ fontWeight: '600' }}>
                {completion}
              </Text>
            )
          ) : null}
        </View>
        {step.targets.map((target, index) => (
          <Text
            key={`${target.type}-${index}`}
            variant="caption"
            numeric
            style={target.type === 'zone' ? { color, fontWeight: '700' } : undefined}
          >
            {formatTarget(target, display, step.discipline)}
          </Text>
        ))}
        {step.instructions ? (
          <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
            {step.instructions}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Steps({
  steps,
  display,
  mixed,
}: {
  steps: WorkoutStep[];
  display: Display;
  mixed: boolean;
}) {
  const theme = useTheme();
  // Nested sequences, at any depth, read as one list.
  const flatten = (list: WorkoutStep[]): WorkoutStep[] =>
    list.flatMap((step) => (step.kind === 'sequence' ? flatten(step.steps) : [step]));
  const flat = flatten(steps);
  return (
    <View>
      {flat.map((step, i) => {
        const last = i === flat.length - 1;
        if (step.kind !== 'repeat')
          return (
            <EffortRow key={step.id} step={step} display={display} mixed={mixed} last={last} />
          );
        return (
          <View key={step.id} style={{ marginBottom: last ? 0 : 16 }}>
            <View
              style={{
                borderRadius: 18,
                backgroundColor: theme.colors.surfaceRaised,
                padding: 14,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}
              >
                <Badge
                  label={`Repeat ${step.repeatCount ?? 1}×`}
                  caps
                  color={theme.onAccent}
                  background={theme.accent}
                />
                {step.label ? (
                  <Text variant="caption" color="text" style={{ flex: 1, fontWeight: '700' }}>
                    {step.label}
                  </Text>
                ) : null}
              </View>
              <Steps steps={step.steps} display={display} mixed={mixed} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** The full prescription: efforts in order, with repeats grouped. */
export function StepList({
  prescription,
  units,
  mixed = false,
}: {
  prescription: WorkoutStep;
  units: Units;
  /** Label each effort's sport, as in a brick or a Hyrox session. */
  mixed?: boolean;
}) {
  const display = { units, ...useSportUnits() };
  return <Steps steps={[prescription]} display={display} mixed={mixed} />;
}
