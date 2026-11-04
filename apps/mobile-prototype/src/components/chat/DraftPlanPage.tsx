import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatRange } from '../../data/dates';
import { weekNumberFor } from '../../data/seed';
import { changedWorkouts, summarizeWeeks } from '../../lib/plan-selectors';
import { usePlan } from '../../state/plan';
import { useTheme } from '../../state/settings';
import { CoverageNote, StatusPill } from '../PlanWidgets';
import { Button, Card, Text } from '../ui';
import { WorkoutRow } from '../WorkoutRow';

/** The "Plan" side of the chat pager: what the coach has changed in the draft, ready to review. */
export function DraftPlanPage({
  onAskPlanRest,
  width,
}: {
  onAskPlanRest: () => void;
  width: number;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { meta, workouts, status, version, today, unlock } = usePlan();
  const weeks = useMemo(() => summarizeWeeks(meta, workouts), [meta, workouts]);
  const changed = changedWorkouts(workouts);
  const locked = status === 'locked';
  const grouped = useMemo(() => {
    const byWeek = new Map<number, typeof changed>();
    for (const w of changed) {
      const n = weekNumberFor(meta, w.date);
      byWeek.set(n, [...(byWeek.get(n) ?? []), w]);
    }
    return [...byWeek.entries()].sort((a, b) => a[0] - b[0]);
  }, [changed, meta]);
  const hasUnplanned = weeks.some((w) => !w.planned);

  return (
    <View style={{ width, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}
      >
        <Card style={{ padding: 16 }}>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text variant="label">Plan</Text>
              <Text variant="heading" numberOfLines={1} style={{ marginTop: 2 }}>
                {meta.name}
              </Text>
            </View>
            <StatusPill status={status} version={version} />
          </View>
          <View style={{ marginTop: 14 }}>
            <CoverageNote meta={meta} weeks={weeks} />
          </View>
        </Card>

        {locked ? (
          <View
            style={{
              marginTop: 12,
              padding: 14,
              borderRadius: 20,
              backgroundColor: 'rgba(52,211,153,0.12)',
              borderWidth: 1,
              borderColor: 'rgba(52,211,153,0.35)',
              gap: 10,
            }}
          >
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Ionicons name="lock-closed" size={18} color="#34D399" />
              <Text variant="subheading" style={{ flex: 1 }}>
                Locked — your coach can’t edit this
              </Text>
            </View>
            <Button
              label="Unlock to edit"
              icon="lock-open"
              variant="secondary"
              size="md"
              onPress={unlock}
            />
          </View>
        ) : null}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginTop: 24,
            marginBottom: 12,
          }}
        >
          <Text variant="heading">{locked ? 'Latest changes' : 'Changes in this draft'}</Text>
          <Text variant="caption" numeric>
            {changed.length} {changed.length === 1 ? 'workout' : 'workouts'}
          </Text>
        </View>

        {grouped.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
            <Ionicons name="checkmark-done" size={28} color={theme.colors.textDim} />
            <Text variant="subheading" style={{ marginTop: 10 }}>
              No pending changes
            </Text>
            <Text variant="caption" style={{ textAlign: 'center', marginTop: 4 }}>
              Ask your coach for a change and it will appear here, highlighted, before anything is
              locked.
            </Text>
          </Card>
        ) : (
          grouped.map(([weekNo, items]) => {
            const week = weeks[weekNo - 1];
            return (
              <View key={weekNo} style={{ marginBottom: 6 }}>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}
                >
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: week.phase.color,
                    }}
                  />
                  <Text variant="subheading">Week {weekNo}</Text>
                  <Text variant="caption">
                    {week.phase.name} · {formatRange(week.startDate, week.endDate)}
                  </Text>
                </View>
                {items.map((w) => (
                  <WorkoutRow
                    key={w.id}
                    compact
                    workout={w}
                    date={w.date}
                    today={today}
                    onPress={() => router.push(`/workout/${w.id}`)}
                  />
                ))}
              </View>
            );
          })
        )}

        {hasUnplanned && !locked ? (
          <Card style={{ marginTop: 12 }}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <Ionicons name="time-outline" size={22} color={theme.colors.textDim} />
              <View style={{ flex: 1 }}>
                <Text variant="subheading">Later weeks are still open</Text>
                <Text variant="caption">
                  Locking now is fine — you can unlock and extend after your 10K.
                </Text>
              </View>
            </View>
            <Button
              label="Plan the final weeks now"
              variant="ghost"
              size="md"
              style={{ marginTop: 12 }}
              onPress={onAskPlanRest}
            />
          </Card>
        ) : null}
      </ScrollView>

      {!locked ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: Math.max(insets.bottom, 14),
            backgroundColor: theme.colors.bg,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          <Button
            label="Review & lock plan"
            icon="lock-closed"
            onPress={() => router.push('/lock-review')}
          />
        </View>
      ) : null}
    </View>
  );
}
