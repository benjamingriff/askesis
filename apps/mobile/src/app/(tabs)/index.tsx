import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import {
  Card,
  Button,
  IconButton,
  PressableScale,
  ProgressBar,
  Screen,
  SectionHeader,
  Text,
} from '../../components/ui';
import { IntensityChart } from '../../components/IntensityChart';
import {
  dayNumber,
  formatLong,
  formatShort,
  greeting,
  startOfWeek,
  weekDates,
  WEEKDAYS_SHORT,
} from '../../data/dates';
import { weekNumberFor } from '../../data/seed';
import { KIND_META } from '../../lib/kinds';
import {
  formatDistance,
  formatDuration,
  formatPace,
  formatPaceRange,
  PACE_GUIDES,
  workoutTotals,
  ZONE_ORDER,
} from '../../lib/metrics';
import { changedWorkouts, daysUntil, summarizeWeek, workoutOn } from '../../lib/plan-selectors';
import { usePlan } from '../../state/plan';
import { useSettings, useTheme } from '../../state/settings';
import { alpha, ZONE_COLORS } from '../../theme/palette';

export default function TodayScreen() {
  const theme = useTheme();
  const { settings } = useSettings();
  const { meta, workouts, today, status, version } = usePlan();
  const [selected, setSelected] = useState(today);

  const days = useMemo(() => weekDates(startOfWeek(today)), [today]);
  const weekNumber = weekNumberFor(meta, today);
  const week = useMemo(
    () =>
      summarizeWeek(meta, workouts, { number: weekNumber, startDate: days[0], endDate: days[6] }),
    [meta, workouts, weekNumber, days],
  );
  const workout = workoutOn(workouts, selected);
  const kind = workout ? KIND_META[workout.kind] : null;
  const changes = status === 'draft' ? changedWorkouts(workouts).length : 0;
  const doneMeters = week.workouts
    .filter((w) => w.date < today)
    .reduce((sum, w) => sum + workoutTotals(w).meters, 0);
  const doneSessions = week.workouts.filter((w) => w.date < today && w.kind !== 'rest').length;
  const totalSessions = week.workouts.filter((w) => w.kind !== 'rest').length;
  const maxDay = Math.max(...week.workouts.map((w) => workoutTotals(w).meters), 1);
  const raceDays = daysUntil(meta.raceDate, today);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 12,
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
          }}
        >
          <View>
            <Text variant="label">{formatLong(today)}</Text>
            <Text variant="title" style={{ marginTop: 4 }}>
              {greeting()}
            </Text>
          </View>
          <IconButton
            icon="chatbubble-ellipses"
            tone="filled"
            accessibilityLabel="Open coach"
            onPress={() => router.push('/coach')}
          />
        </View>

        <PressableScale
          onPress={() => router.push('/plan')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 20,
            marginTop: 10,
          }}
        >
          <View
            style={{
              paddingHorizontal: 10,
              height: 26,
              borderRadius: 13,
              backgroundColor: theme.accentSoft,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Ionicons name="calendar" size={12} color={theme.accentText} />
            <Text variant="caption" color="accent" style={{ fontWeight: '800' }}>
              Week {weekNumber} of {meta.totalWeeks}
            </Text>
          </View>
          <Text variant="caption">
            {raceDays} days to {meta.raceName}
          </Text>
        </PressableScale>

        {/* Week strip */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginTop: 22, gap: 6 }}>
          {days.map((d, i) => {
            const w = workoutOn(workouts, d);
            const active = d === selected;
            const isToday = d === today;
            const dot = w && w.kind !== 'rest' ? KIND_META[w.kind].color : theme.colors.border;
            return (
              <PressableScale
                key={d}
                haptic="select"
                onPress={() => setSelected(d)}
                accessibilityRole="button"
                accessibilityLabel={formatLong(d)}
                accessibilityState={{ selected: active }}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: 10,
                  borderRadius: 18,
                  backgroundColor: active ? theme.accent : theme.colors.surface,
                  borderWidth: 1,
                  borderColor: active
                    ? theme.accent
                    : isToday
                      ? theme.accentBorder
                      : theme.colors.border,
                }}
              >
                <Text
                  variant="label"
                  style={{
                    color: active ? theme.onAccent : theme.colors.textMuted,
                    opacity: active ? 0.7 : 1,
                  }}
                >
                  {WEEKDAYS_SHORT[i].slice(0, 1)}
                </Text>
                <Text
                  variant="subheading"
                  numeric
                  style={{
                    marginTop: 4,
                    fontWeight: '800',
                    color: active ? theme.onAccent : theme.colors.text,
                  }}
                >
                  {dayNumber(d)}
                </Text>
                <View
                  style={{
                    marginTop: 6,
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: active ? theme.onAccent : dot,
                  }}
                />
              </PressableScale>
            );
          })}
        </View>

        {/* Selected day's workout */}
        <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
          <Text variant="caption" style={{ marginBottom: 10, fontWeight: '700' }}>
            {selected === today ? 'Today’s workout' : formatLong(selected)}
          </Text>
          {workout && workout.kind !== 'rest' && kind ? (
            <PressableScale onPress={() => router.push(`/workout/${workout.id}`)} scaleTo={0.985}>
              <View
                style={{
                  borderRadius: 28,
                  overflow: 'hidden',
                  borderWidth: 1,
                  borderColor: alpha(kind.color, 0.35),
                  backgroundColor: theme.colors.surface,
                }}
              >
                <LinearGradient
                  colors={[alpha(kind.color, theme.isDark ? 0.32 : 0.22), alpha(kind.color, 0)]}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.9, y: 1 }}
                  style={{ position: 'absolute', inset: 0 }}
                />
                <View style={{ padding: 20 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name={kind.icon} size={16} color={kind.color} />
                    <Text variant="label" style={{ color: kind.color }}>
                      {kind.label}
                    </Text>
                  </View>
                  <Text variant="title" style={{ marginTop: 8 }}>
                    {workout.title}
                  </Text>
                  <Text variant="body" color="dim" style={{ marginTop: 6 }} numberOfLines={2}>
                    {workout.blurb}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 28, marginTop: 18 }}>
                    {workout.kind !== 'strength' ? (
                      <Stat
                        label="Distance"
                        value={formatDistance(workoutTotals(workout).meters, settings.units, false)}
                        unit={settings.units}
                      />
                    ) : null}
                    <Stat label="Time" value={formatDuration(workoutTotals(workout).seconds)} />
                    {workout.kind !== 'strength' ? (
                      <Stat
                        label="Avg pace"
                        value={formatPace(
                          (workoutTotals(workout).seconds / workoutTotals(workout).meters) * 1000,
                          settings.units,
                          false,
                        )}
                        unit={`/${settings.units}`}
                      />
                    ) : null}
                  </View>
                  <View style={{ marginTop: 20 }}>
                    <IntensityChart steps={workout.steps} height={56} animate />
                  </View>
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', marginTop: 18, gap: 8 }}
                  >
                    <Text variant="subheading" color="accent" style={{ fontWeight: '800' }}>
                      View workout
                    </Text>
                    <Ionicons name="arrow-forward" size={16} color={theme.accentText} />
                  </View>
                </View>
              </View>
            </PressableScale>
          ) : (
            <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  backgroundColor: theme.colors.surfaceRaised,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="moon" size={24} color={theme.colors.textDim} />
              </View>
              <Text variant="heading" style={{ marginTop: 14 }}>
                Rest day
              </Text>
              <Text
                variant="body"
                color="dim"
                style={{ textAlign: 'center', marginTop: 6, maxWidth: 280 }}
              >
                {workout?.coachNote ??
                  'Nothing is scheduled. Easy walking, mobility work and good sleep.'}
              </Text>
            </Card>
          )}
        </View>

        {/* Draft banner */}
        {changes > 0 ? (
          <PressableScale
            onPress={() => router.push('/chat/c-extend?page=plan')}
            style={{
              marginHorizontal: 20,
              marginTop: 16,
              padding: 14,
              borderRadius: 20,
              backgroundColor: theme.accentSoft,
              borderWidth: 1,
              borderColor: theme.accentBorder,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: theme.accent,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="sparkles" size={18} color={theme.onAccent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="subheading">Draft v{version} needs your review</Text>
              <Text variant="caption">{changes} changes from your coach · not locked yet</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.accentText} />
          </PressableScale>
        ) : null}

        {/* Week overview */}
        <SectionHeader title="This week" action="See plan" onAction={() => router.push('/plan')} />
        <View style={{ paddingHorizontal: 20 }}>
          <Card>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
              }}
            >
              <View>
                <Text variant="label">Distance</Text>
                <View
                  style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}
                >
                  <Text variant="title" numeric>
                    {formatDistance(doneMeters, settings.units, false)}
                  </Text>
                  <Text variant="body" color="dim" numeric>
                    / {formatDistance(week.meters, settings.units)}
                  </Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="label">Sessions</Text>
                <Text variant="heading" numeric style={{ marginTop: 4 }}>
                  {doneSessions} / {totalSessions}
                </Text>
              </View>
            </View>
            <View style={{ marginTop: 14 }}>
              <ProgressBar value={week.meters ? doneMeters / week.meters : 0} />
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                gap: 8,
                height: 64,
                marginTop: 18,
              }}
            >
              {days.map((d, i) => {
                const w = workoutOn(workouts, d);
                const m = w ? workoutTotals(w).meters : 0;
                const color =
                  w && w.kind !== 'rest' ? KIND_META[w.kind].color : theme.colors.border;
                return (
                  <View key={d} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                    <View style={{ flex: 1, justifyContent: 'flex-end', width: '100%' }}>
                      <View
                        style={{
                          width: '100%',
                          height: m ? Math.max(8, (m / maxDay) * 40) : 4,
                          borderRadius: 6,
                          backgroundColor: color,
                          opacity: d < today ? 0.5 : 1,
                          borderWidth: d === today ? 2 : 0,
                          borderColor: theme.colors.text,
                        }}
                      />
                    </View>
                    <Text variant="label" style={{ fontSize: 9.5 }}>
                      {WEEKDAYS_SHORT[i].slice(0, 1)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Card>
        </View>

        {/* Pace guides */}
        <SectionHeader
          title="Your pace guides"
          action="Details"
          onAction={() => router.push('/pace-guides')}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
        >
          {ZONE_ORDER.map((z) => (
            <View
              key={z}
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
                  backgroundColor: ZONE_COLORS[z],
                  marginBottom: 12,
                }}
              />
              <Text variant="label">{PACE_GUIDES[z].label}</Text>
              <Text variant="heading" numeric style={{ marginTop: 4 }}>
                {formatPaceRange(z, settings.units).split(' ')[0]}
              </Text>
              <Text variant="caption" numeric>
                /{settings.units}
              </Text>
            </View>
          ))}
        </ScrollView>

        <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
          <Button
            label="Ask your coach"
            icon="chatbubble-ellipses"
            variant="secondary"
            onPress={() => router.push('/coach')}
          />
          <Text variant="caption" color="muted" style={{ textAlign: 'center', marginTop: 12 }}>
            {meta.goal} · {formatShort(meta.raceDate)}
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View>
      <Text variant="label">{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: 3 }}>
        <Text
          variant="heading"
          numeric
          style={{ fontSize: 24, fontWeight: '800', letterSpacing: -0.6 }}
        >
          {value}
        </Text>
        {unit ? (
          <Text variant="caption" numeric>
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
