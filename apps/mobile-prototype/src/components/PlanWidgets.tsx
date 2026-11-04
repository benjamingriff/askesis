import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { formatShort } from '../data/dates';
import type { PlanMeta } from '../data/types';
import { plannedThroughWeek, type WeekSummary } from '../lib/plan-selectors';
import { useSettings, useTheme } from '../state/settings';
import { alpha } from '../theme/palette';
import { PressableScale, Text } from './ui';

export function PhaseTimeline({ meta, currentWeek }: { meta: PlanMeta; currentWeek: number }) {
  const theme = useTheme();
  const pos = ((currentWeek - 0.5) / meta.totalWeeks) * 100;
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {meta.phases.map((p) => {
          const weeks = p.toWeek - p.fromWeek + 1;
          const done = currentWeek > p.toWeek;
          const active = currentWeek >= p.fromWeek && currentWeek <= p.toWeek;
          return (
            <View key={p.name} style={{ flex: weeks }}>
              <View
                style={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: alpha(p.color, done ? 1 : active ? 0.55 : 0.22),
                }}
              />
              <Text
                variant="label"
                style={{
                  marginTop: 8,
                  color: active ? p.color : theme.colors.textMuted,
                  fontSize: 10,
                  // A one-week phase is too narrow for its name; let the label hang off the right edge.
                  ...(weeks === 1
                    ? { position: 'absolute', right: 0, top: 8, width: 60, textAlign: 'right' }
                    : null),
                }}
                numberOfLines={1}
              >
                {p.name}
              </Text>
            </View>
          );
        })}
      </View>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: `${pos}%`, top: -4, marginLeft: -2 }}
      >
        <View
          style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: theme.colors.text }}
        />
      </View>
    </View>
  );
}

/** Volume-per-week bars; tapping one selects the week. */
export function WeekChart({
  weeks,
  selected,
  currentWeek,
  onSelect,
}: {
  weeks: WeekSummary[];
  selected: number;
  currentWeek: number;
  onSelect: (week: number) => void;
}) {
  const theme = useTheme();
  const max = Math.max(...weeks.map((w) => w.meters), 1);
  return (
    <View style={{ flexDirection: 'row', gap: 5, height: 92, alignItems: 'flex-end' }}>
      {weeks.map((w) => {
        const active = w.number === selected;
        const h = w.planned ? Math.max(10, (w.meters / max) * 56) : 22;
        const fill = active
          ? theme.accent
          : alpha(w.phase.color, w.number < currentWeek ? 0.9 : 0.5);
        return (
          <PressableScale
            key={w.number}
            haptic="select"
            onPress={() => onSelect(w.number)}
            scaleTo={0.92}
            accessibilityRole="button"
            accessibilityLabel={`Week ${w.number}${w.planned ? '' : ', not planned'}`}
            accessibilityState={{ selected: active }}
            style={{
              flex: 1,
              height: 92,
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {w.planned ? (
              <View
                style={{
                  width: '100%',
                  height: h,
                  borderRadius: 8,
                  backgroundColor: fill,
                  justifyContent: 'flex-end',
                }}
              >
                {w.workouts.some((x) => x.change) ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: -3,
                      alignSelf: 'center',
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: theme.colors.text,
                      borderWidth: 1,
                      borderColor: theme.colors.bg,
                    }}
                  />
                ) : null}
              </View>
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
                  : w.number === currentWeek
                    ? theme.colors.text
                    : theme.colors.textMuted,
              }}
            >
              {w.number}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

/** Explicit planning coverage: how far the coach has prescribed versus the whole plan. */
export function CoverageNote({ meta, weeks }: { meta: PlanMeta; weeks: WeekSummary[] }) {
  const theme = useTheme();
  const through = plannedThroughWeek(weeks);
  const remaining = meta.totalWeeks - through;
  const complete = remaining <= 0;
  const throughWeek = weeks[Math.max(0, through - 1)];
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
        borderColor: theme.colors.border,
      }}
    >
      <Ionicons
        name={complete ? 'checkmark-circle' : 'time-outline'}
        size={20}
        color={complete ? '#34D399' : theme.colors.textDim}
      />
      <View style={{ flex: 1 }}>
        <Text variant="caption" color="text" style={{ fontWeight: '700' }}>
          {complete
            ? 'Planned through race day'
            : `Prescribed through week ${through} · ${formatShort(throughWeek.endDate)}`}
        </Text>
        {!complete ? (
          <Text variant="caption" color="muted">
            {remaining === 1 ? 'Week' : 'Weeks'} {through + 1}
            {remaining > 1 ? `–${meta.totalWeeks}` : ''} not planned yet
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function StatusPill({
  status,
  version,
  onPress,
}: {
  status: 'draft' | 'locked';
  version: number;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const locked = status === 'locked';
  const color = locked ? '#34D399' : theme.accentText;
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Plan ${status}, version ${version}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 16,
        backgroundColor: locked ? 'rgba(52,211,153,0.14)' : theme.accentSoft,
        borderWidth: 1,
        borderColor: locked ? 'rgba(52,211,153,0.35)' : theme.accentBorder,
      }}
    >
      <Ionicons name={locked ? 'lock-closed' : 'create-outline'} size={13} color={color} />
      <Text variant="caption" style={{ color, fontWeight: '800' }}>
        {locked ? 'Locked' : 'Draft'} v{version}
      </Text>
    </PressableScale>
  );
}

export function WeekStatsRow({ week }: { week: WeekSummary }) {
  const { settings } = useSettings();
  const km = settings.units === 'km' ? week.meters / 1000 : week.meters / 1609.344;
  const target = settings.units === 'km' ? week.targetMeters / 1000 : week.targetMeters / 1609.344;
  const items = [
    {
      label: 'Distance',
      value: km.toFixed(km >= 100 ? 0 : 1),
      unit: settings.units,
      sub: `target ${Math.round(target)}`,
    },
    { label: 'Runs', value: String(week.runs), unit: '', sub: `${week.hard} hard` },
    { label: 'Strength', value: String(week.strength), unit: '', sub: 'sessions' },
  ];
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {items.map((it) => (
        <View key={it.label} style={{ flex: 1 }}>
          <Text variant="label">{it.label}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: 3 }}>
            <Text variant="heading" numeric style={{ fontWeight: '800' }}>
              {it.value}
            </Text>
            {it.unit ? (
              <Text variant="caption" numeric>
                {it.unit}
              </Text>
            ) : null}
          </View>
          <Text variant="caption" color="muted" numeric>
            {it.sub}
          </Text>
        </View>
      ))}
    </View>
  );
}
