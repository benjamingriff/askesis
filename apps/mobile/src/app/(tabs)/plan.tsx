import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { BottomSheet } from '../../components/BottomSheet';
import {
  CoverageNote,
  PhaseTimeline,
  StatusPill,
  WeekChart,
  WeekStatsRow,
} from '../../components/PlanWidgets';
import {
  Button,
  Card,
  PressableScale,
  ProgressBar,
  Screen,
  Segmented,
  Text,
} from '../../components/ui';
import { WorkoutRow } from '../../components/WorkoutRow';
import {
  formatLong,
  formatRange,
  monthGrid,
  monthTitle,
  shiftMonth,
  WEEKDAYS_SHORT,
  dayNumber,
  addDays,
  monthKey,
} from '../../data/dates';
import { weekNumberFor } from '../../data/seed';
import { KIND_META } from '../../lib/kinds';
import { changedWorkouts, summarizeWeeks, workoutOn } from '../../lib/plan-selectors';
import { usePlan } from '../../state/plan';
import { useTheme } from '../../state/settings';

type View_ = 'weeks' | 'calendar';

export default function PlanScreen() {
  const theme = useTheme();
  const { meta, workouts, today, status, version, unlock } = usePlan();
  const currentWeek = Math.min(meta.totalWeeks, Math.max(1, weekNumberFor(meta, today)));
  const [view, setView] = useState<View_>('weeks');
  const [selectedWeek, setSelectedWeek] = useState(currentWeek);
  const [selectedDate, setSelectedDate] = useState(today);
  const [month, setMonth] = useState(today);
  const [unlockOpen, setUnlockOpen] = useState(false);

  const weeks = useMemo(() => summarizeWeeks(meta, workouts), [meta, workouts]);
  const week = weeks[selectedWeek - 1];
  const changes = status === 'draft' ? changedWorkouts(workouts).length : 0;
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(week.startDate, i)),
    [week.startDate],
  );
  const unplannedFrom = weeks.find((w) => !w.planned)?.number;

  const openChat = (prefill?: string) =>
    router.push(
      prefill ? `/chat/c-extend?prefill=${encodeURIComponent(prefill)}` : '/chat/c-extend',
    );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 12,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text variant="title">Plan</Text>
          <StatusPill
            status={status}
            version={version}
            onPress={() => (status === 'draft' ? router.push('/lock-review') : setUnlockOpen(true))}
          />
        </View>

        {/* Plan hero */}
        <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
          <Card style={{ padding: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="flag" size={14} color={theme.accentText} />
              <Text variant="label" color="accent">
                {meta.goal}
              </Text>
            </View>
            <Text variant="heading" style={{ marginTop: 6, fontSize: 24, lineHeight: 30 }}>
              {meta.name}
            </Text>
            <Text variant="caption" style={{ marginTop: 2 }}>
              {formatRange(meta.startDate, meta.raceDate)} · {meta.raceName}
            </Text>
            <View style={{ marginTop: 18 }}>
              <PhaseTimeline meta={meta} currentWeek={currentWeek} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 }}>
              <View style={{ flex: 1 }}>
                <ProgressBar value={(currentWeek - 1) / meta.totalWeeks} height={6} />
              </View>
              <Text variant="caption" numeric style={{ fontWeight: '700' }}>
                Week {currentWeek}/{meta.totalWeeks}
              </Text>
            </View>
            <View style={{ marginTop: 16 }}>
              <CoverageNote meta={meta} weeks={weeks} />
            </View>
          </Card>
        </View>

        {changes > 0 ? (
          <PressableScale
            onPress={() => router.push('/lock-review')}
            style={{
              marginHorizontal: 20,
              marginTop: 12,
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
            <Ionicons name="sparkles" size={20} color={theme.accentText} />
            <View style={{ flex: 1 }}>
              <Text variant="subheading">{changes} draft changes</Text>
              <Text variant="caption">Review, then lock to freeze v{version}</Text>
            </View>
            <Text variant="caption" color="accent" style={{ fontWeight: '800' }}>
              Review
            </Text>
          </PressableScale>
        ) : null}

        <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
          <Segmented<View_>
            value={view}
            onChange={setView}
            options={[
              { value: 'weeks', label: 'Weeks', icon: 'list' },
              { value: 'calendar', label: 'Calendar', icon: 'grid' },
            ]}
          />
        </View>

        {view === 'weeks' ? (
          <>
            <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
              <WeekChart
                weeks={weeks}
                selected={selectedWeek}
                currentWeek={currentWeek}
                onSelect={setSelectedWeek}
              />
            </View>

            <View style={{ paddingHorizontal: 20, marginTop: 18 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text variant="heading">Week {week.number}</Text>
                    <View
                      style={{
                        paddingHorizontal: 8,
                        height: 22,
                        borderRadius: 11,
                        justifyContent: 'center',
                        backgroundColor: `${week.phase.color}26`,
                      }}
                    >
                      <Text variant="label" style={{ color: week.phase.color, fontSize: 10 }}>
                        {week.phase.name}
                      </Text>
                    </View>
                    {week.number === currentWeek ? (
                      <View
                        style={{
                          paddingHorizontal: 8,
                          height: 22,
                          borderRadius: 11,
                          justifyContent: 'center',
                          backgroundColor: theme.colors.surfaceRaised,
                        }}
                      >
                        <Text variant="label" style={{ fontSize: 10 }}>
                          This week
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text variant="caption" style={{ marginTop: 2 }}>
                    {formatRange(week.startDate, week.endDate)}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <NavChip
                    icon="chevron-back"
                    disabled={selectedWeek <= 1}
                    onPress={() => setSelectedWeek((w) => w - 1)}
                  />
                  <NavChip
                    icon="chevron-forward"
                    disabled={selectedWeek >= meta.totalWeeks}
                    onPress={() => setSelectedWeek((w) => w + 1)}
                  />
                </View>
              </View>
              {week.planned ? (
                <View style={{ marginTop: 16 }}>
                  <Card>
                    <WeekStatsRow week={week} />
                  </Card>
                </View>
              ) : null}
            </View>

            <View style={{ marginTop: 18 }}>
              {week.planned ? (
                days.map((d) => (
                  <WorkoutRow
                    key={d}
                    date={d}
                    today={today}
                    workout={workoutOn(workouts, d)}
                    onPress={() => {
                      const w = workoutOn(workouts, d);
                      if (w) router.push(`/workout/${w.id}`);
                    }}
                  />
                ))
              ) : (
                <UnplannedCard
                  from={week.number}
                  to={meta.totalWeeks}
                  raceDate={
                    meta.raceDate >= week.startDate && meta.raceDate <= week.endDate
                      ? meta.raceDate
                      : null
                  }
                  raceName={meta.raceName}
                  onAsk={() =>
                    openChat(
                      unplannedFrom === meta.totalWeeks - 1
                        ? 'Plan the final two weeks'
                        : `Plan weeks ${unplannedFrom ?? week.number}–${meta.totalWeeks}`,
                    )
                  }
                />
              )}
            </View>
          </>
        ) : (
          <CalendarView
            month={month}
            onMonth={setMonth}
            selected={selectedDate}
            onSelect={setSelectedDate}
            today={today}
          />
        )}
      </ScrollView>

      <BottomSheet
        visible={unlockOpen}
        onClose={() => setUnlockOpen(false)}
        title={`Plan v${version} is locked`}
      >
        <Text variant="body" color="dim">
          Locking freezes your brief, pace guides and workouts together. Unlock to open a new
          editable draft — your coach can then make changes, and you review and lock again when you
          are happy.
        </Text>
        <View style={{ gap: 10, marginTop: 20 }}>
          <Button
            label="Unlock and edit"
            icon="lock-open"
            onPress={() => {
              unlock();
              setUnlockOpen(false);
            }}
          />
          <Button label="Keep locked" variant="ghost" onPress={() => setUnlockOpen(false)} />
        </View>
      </BottomSheet>
    </Screen>
  );
}

function NavChip({
  icon,
  onPress,
  disabled,
}: {
  icon: 'chevron-back' | 'chevron-forward';
  onPress: () => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={disabled ? undefined : onPress}
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={icon === 'chevron-back' ? 'Previous week' : 'Next week'}
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: theme.colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Ionicons name={icon} size={18} color={theme.colors.text} />
    </PressableScale>
  );
}

function UnplannedCard({
  from,
  to,
  raceDate,
  raceName,
  onAsk,
}: {
  from: number;
  to: number;
  raceDate: string | null;
  raceName: string;
  onAsk: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ paddingHorizontal: 20, gap: 12 }}>
      <View
        style={{
          borderRadius: 24,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: theme.colors.border,
          padding: 22,
          alignItems: 'center',
        }}
      >
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: theme.accentSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="sparkles" size={22} color={theme.accentText} />
        </View>
        <Text variant="heading" style={{ marginTop: 14 }}>
          Not planned yet
        </Text>
        <Text variant="body" color="dim" style={{ textAlign: 'center', marginTop: 6 }}>
          Your coach is holding off on weeks {from}–{to} until your 10K result is in, so the final
          block is built on real fitness, not an estimate.
        </Text>
        <Button
          label="Plan it with your coach"
          icon="chatbubble-ellipses"
          size="md"
          style={{ marginTop: 18, alignSelf: 'stretch' }}
          onPress={onAsk}
        />
      </View>
      {raceDate ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            padding: 16,
            borderRadius: 20,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <Ionicons name="trophy" size={22} color={KIND_META.race.color} />
          <View style={{ flex: 1 }}>
            <Text variant="subheading">{raceName}</Text>
            <Text variant="caption">{formatLong(raceDate)} · Race day</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function CalendarView({
  month,
  onMonth,
  selected,
  onSelect,
  today,
}: {
  month: string;
  onMonth: (m: string) => void;
  selected: string;
  onSelect: (d: string) => void;
  today: string;
}) {
  const theme = useTheme();
  const { workouts, meta } = usePlan();
  const grid = useMemo(() => monthGrid(month), [month]);
  const selectedWorkout = workoutOn(workouts, selected);
  const inPlan = (d: string) => d >= meta.startDate && d <= meta.raceDate;

  return (
    <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <Text variant="heading">{monthTitle(month)}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <NavChip
            icon="chevron-back"
            disabled={false}
            onPress={() => onMonth(shiftMonth(month, -1))}
          />
          <NavChip
            icon="chevron-forward"
            disabled={false}
            onPress={() => onMonth(shiftMonth(month, 1))}
          />
        </View>
      </View>
      <View style={{ flexDirection: 'row', marginBottom: 6 }}>
        {WEEKDAYS_SHORT.map((d) => (
          <View key={d} style={{ flex: 1, alignItems: 'center' }}>
            <Text variant="label" style={{ fontSize: 10 }}>
              {d.slice(0, 2)}
            </Text>
          </View>
        ))}
      </View>
      {grid.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row' }}>
          {row.map((d) => {
            const w = workoutOn(workouts, d);
            const outside = monthKey(d) !== monthKey(month);
            const active = d === selected;
            const color = w && w.kind !== 'rest' ? KIND_META[w.kind].color : null;
            const isRace = d === meta.raceDate;
            return (
              <PressableScale
                key={d}
                haptic="select"
                onPress={() => onSelect(d)}
                scaleTo={0.9}
                accessibilityRole="button"
                accessibilityLabel={formatLong(d)}
                style={{
                  flex: 1,
                  height: 52,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: outside ? 0.3 : inPlan(d) ? 1 : 0.55,
                }}
              >
                <View
                  style={{
                    width: 38,
                    height: 44,
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    backgroundColor: active ? theme.accent : 'transparent',
                    borderWidth: d === today && !active ? 1.5 : 0,
                    borderColor: theme.accentBorder,
                  }}
                >
                  <Text
                    variant="subheading"
                    numeric
                    style={{
                      fontWeight: '700',
                      color: active ? theme.onAccent : theme.colors.text,
                    }}
                  >
                    {dayNumber(d)}
                  </Text>
                  {isRace ? (
                    <Ionicons
                      name="trophy"
                      size={11}
                      color={active ? theme.onAccent : KIND_META.race.color}
                    />
                  ) : (
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: color ? (active ? theme.onAccent : color) : 'transparent',
                        borderWidth: w?.change && !active ? 1.5 : 0,
                        borderColor: theme.colors.text,
                      }}
                    />
                  )}
                </View>
              </PressableScale>
            );
          })}
        </View>
      ))}
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12, marginBottom: 20 }}
      >
        {(['easy', 'long', 'tempo', 'intervals', 'strength', 'race'] as const).map((k) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: KIND_META[k].color }}
            />
            <Text variant="caption" style={{ fontSize: 12 }}>
              {KIND_META[k].label}
            </Text>
          </View>
        ))}
      </View>
      <Text variant="label" style={{ marginBottom: 10 }}>
        {formatLong(selected)}
      </Text>
      {selectedWorkout ? (
        <WorkoutRow
          compact
          showDate={false}
          date={selected}
          today={today}
          workout={selectedWorkout}
          onPress={() => router.push(`/workout/${selectedWorkout.id}`)}
        />
      ) : selected === meta.raceDate ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Ionicons name="trophy" size={22} color={KIND_META.race.color} />
          <View style={{ flex: 1 }}>
            <Text variant="subheading">{meta.raceName}</Text>
            <Text variant="caption">Race day · {meta.goal}</Text>
          </View>
        </Card>
      ) : (
        <Text variant="caption" color="muted">
          {inPlan(selected) ? 'Nothing prescribed for this day yet.' : 'Outside the plan.'}
        </Text>
      )}
    </View>
  );
}
