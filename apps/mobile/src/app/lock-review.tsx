import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CoverageNote } from '../components/PlanWidgets';
import { Button, Card, IconButton, Screen, Text, useHaptics } from '../components/ui';
import { formatShort } from '../data/dates';
import { weekNumberFor } from '../data/seed';
import { formatDistance, formatPace } from '../lib/metrics';
import { changedWorkouts, plannedThroughWeek, summarizeWeeks } from '../lib/plan-selectors';
import { usePlan } from '../state/plan';
import { useSettings, useTheme } from '../state/settings';

function Check({
  checked,
  onToggle,
  label,
  sub,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  sub?: string;
}) {
  const theme = useTheme();
  const buzz = useHaptics();
  return (
    <Pressable
      onPress={() => {
        buzz('select');
        onToggle();
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        borderRadius: 18,
        backgroundColor: theme.colors.surfaceRaised,
      }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 9,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: checked ? theme.accent : 'transparent',
          borderWidth: 2,
          borderColor: checked ? theme.accent : theme.colors.textMuted,
        }}
      >
        {checked ? <Ionicons name="checkmark" size={16} color={theme.onAccent} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="subheading">{label}</Text>
        {sub ? <Text variant="caption">{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

function Assumption({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
      <Ionicons name={icon} size={18} color={theme.colors.textDim} />
      <Text variant="body" color="dim" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="body" style={{ fontWeight: '700' }} numeric>
        {value}
      </Text>
    </View>
  );
}

export default function LockReviewScreen() {
  const theme = useTheme();
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const buzz = useHaptics();
  const { meta, workouts, status, version, lock } = usePlan();
  const [briefOk, setBriefOk] = useState(false);
  const [warnOk, setWarnOk] = useState(false);
  const [done, setDone] = useState(false);
  const pop = useRef(new Animated.Value(0)).current;

  const weeks = useMemo(() => summarizeWeeks(meta, workouts), [meta, workouts]);
  const changed = changedWorkouts(workouts);
  const through = plannedThroughWeek(weeks);
  const unplanned = meta.totalWeeks - through;

  // Warnings are derived from the plan itself, not hard-coded.
  const warnings = useMemo(() => {
    const out: { title: string; body: string }[] = [];
    if (unplanned > 0) {
      out.push({
        title: `Weeks ${through + 1}${unplanned > 1 ? `–${meta.totalWeeks}` : ''} are not planned`,
        body: 'That is intentional while you wait for race feedback. You can unlock and extend the plan later.',
      });
    }
    for (let i = 1; i < through; i++) {
      const prev = weeks[i - 1];
      const cur = weeks[i];
      // A rebound after a down-week is the point of a recovery week, not a spike.
      const afterRecovery = i >= 2 && prev.meters < weeks[i - 2].meters * 0.9;
      if (!afterRecovery && prev.meters > 0 && cur.meters / prev.meters > 1.15) {
        out.push({
          title: `Week ${cur.number} volume jumps ${Math.round((cur.meters / prev.meters - 1) * 100)}%`,
          body: `${formatDistance(prev.meters, settings.units)} → ${formatDistance(cur.meters, settings.units)}. A rise above ~10–15% raises injury risk.`,
        });
      }
    }
    const raceWeek = changed.find((w) => w.kind === 'race');
    if (raceWeek) {
      out.push({
        title: `${raceWeek.title} on ${formatShort(raceWeek.date)}`,
        body: `Week ${weekNumberFor(meta, raceWeek.date)} is shaped as a taper. A hard session within 3 days of a race is avoided.`,
      });
    }
    return out;
  }, [unplanned, through, weeks, changed, meta, settings.units]);

  useEffect(() => {
    if (!done) return;
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 10 }).start();
    const t = setTimeout(() => router.back(), 1400);
    return () => clearTimeout(t);
  }, [done, pop]);

  const needWarn = warnings.length > 0;
  const ready = briefOk && (!needWarn || warnOk);

  if (status === 'locked' && !done) {
    return (
      <Screen>
        <View style={{ padding: 20, gap: 16 }}>
          <IconButton
            icon="close"
            tone="filled"
            accessibilityLabel="Close"
            onPress={() => router.back()}
          />
          <Card style={{ alignItems: 'center', paddingVertical: 32 }}>
            <Ionicons name="lock-closed" size={32} color="#34D399" />
            <Text variant="heading" style={{ marginTop: 12 }}>
              Plan v{version} is locked
            </Text>
            <Text variant="body" color="dim" style={{ textAlign: 'center', marginTop: 6 }}>
              Nothing to review. Unlock it from the Plan tab to open a new draft.
            </Text>
          </Card>
        </View>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <Animated.View
            style={{
              width: 112,
              height: 112,
              borderRadius: 56,
              backgroundColor: '#34D399',
              alignItems: 'center',
              justifyContent: 'center',
              transform: [{ scale: pop }],
            }}
          >
            <Ionicons name="lock-closed" size={48} color="#06281D" />
          </Animated.View>
          <Text variant="title">Plan v{version} locked</Text>
          <Text variant="body" color="dim">
            Your brief and workouts are frozen together.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen top={false}>
      <View
        style={{
          paddingTop: 14,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <View style={{ flex: 1, paddingLeft: 8 }}>
          <Text variant="label">Review</Text>
          <Text variant="title" style={{ fontSize: 26, lineHeight: 32 }}>
            Lock plan v{version}
          </Text>
        </View>
        <IconButton
          icon="close"
          tone="filled"
          accessibilityLabel="Close"
          onPress={() => router.back()}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 150, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <CoverageNote meta={meta} weeks={weeks} />

        <Card>
          <Text variant="label" style={{ marginBottom: 6 }}>
            Brief assumptions
          </Text>
          <Assumption icon="flag" label="Goal" value="Sub 1:45 half" />
          <Assumption icon="calendar" label="Race" value={formatShort(meta.raceDate)} />
          <Assumption
            icon="trending-up"
            label="Starting weekly distance"
            value={formatDistance(38000, settings.units)}
          />
          <Assumption icon="repeat" label="Runs per week" value="5 + strength" />
          <Assumption icon="moon" label="Rest day" value="Friday" />
          <Assumption
            icon="speedometer"
            label="Threshold (estimated)"
            value={formatPace(290, settings.units)}
          />
          <View style={{ marginTop: 10 }}>
            <Check
              checked={briefOk}
              onToggle={() => setBriefOk((v) => !v)}
              label="These assumptions are right"
              sub="Confirming is a human decision — your coach can’t do it for you"
            />
          </View>
        </Card>

        <Card>
          <Text variant="label" style={{ marginBottom: 10 }}>
            What’s changing from v{version - 1}
          </Text>
          {changed.length === 0 ? (
            <Text variant="body" color="dim">
              No workout changes — only the plan status changes.
            </Text>
          ) : (
            <View style={{ gap: 8 }}>
              <Text variant="body">
                <Text style={{ fontWeight: '800' }}>
                  {changed.filter((w) => w.change === 'new').length}
                </Text>{' '}
                new workouts ·{' '}
                <Text style={{ fontWeight: '800' }}>
                  {changed.filter((w) => w.change === 'changed').length}
                </Text>{' '}
                edited
              </Text>
              {changed.slice(0, 6).map((w) => (
                <View key={w.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  <View
                    style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.accent }}
                  />
                  <Text variant="caption" color="text" style={{ flex: 1 }} numberOfLines={1}>
                    Wk {weekNumberFor(meta, w.date)} · {formatShort(w.date)} · {w.title}
                  </Text>
                </View>
              ))}
              {changed.length > 6 ? (
                <Text variant="caption" color="muted">
                  + {changed.length - 6} more
                </Text>
              ) : null}
            </View>
          )}
        </Card>

        {warnings.length ? (
          <Card>
            <Text variant="label" style={{ marginBottom: 10 }}>
              Things to know
            </Text>
            <View style={{ gap: 14 }}>
              {warnings.map((w) => (
                <View key={w.title} style={{ flexDirection: 'row', gap: 12 }}>
                  <Ionicons
                    name="alert-circle"
                    size={20}
                    color="#FBBF24"
                    style={{ marginTop: 1 }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text variant="subheading">{w.title}</Text>
                    <Text variant="caption" style={{ marginTop: 2 }}>
                      {w.body}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
            <View style={{ marginTop: 14 }}>
              <Check
                checked={warnOk}
                onToggle={() => setWarnOk((v) => !v)}
                label="I’ve seen these"
              />
            </View>
          </Card>
        ) : null}
      </ScrollView>

      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 16),
          backgroundColor: theme.colors.bg,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
        }}
      >
        <Button
          label={`Lock plan v${version}`}
          icon="lock-closed"
          disabled={!ready}
          onPress={() => {
            buzz('success');
            lock();
            setDone(true);
          }}
        />
      </View>
    </Screen>
  );
}
