import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet } from '../components/BottomSheet';
import { CalibrationSource } from '../components/PlanWidgets';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  LoadingState,
  Screen,
  ScreenHeader,
  Text,
} from '../components/ui';
import {
  currentEntry,
  planVersion,
  useActivePlans,
  useBriefState,
  usePerformance,
  type Calibration,
} from '../data/plan-data';
import { useAskAgent, useAskIcon, useCoachWord } from '../data/account';
import { api } from '../lib/api';
import { agentPrompt } from '../lib/coach';
import { formatDateTime, formatShortYear } from '../lib/format';
import { useRequestKey } from '../lib/request-key';
import { result } from '../lib/result';
import {
  describeEvidence,
  formatZoneValue,
  isEstimate,
  SPORT_META,
  SYSTEM_META,
  SYSTEMS,
  planSports,
  systemsForSports,
  type System,
} from '../lib/sports';
import { usePlanSelection } from '../state/plan-selection';
import { useSportUnits, useTheme, useUnits } from '../state/settings';
import { zoneEffort } from '../theme/palette';

/**
 * The athlete's fitness, shared by every plan. A sport appears once it has a result or one of
 * the athlete's plans trains it; other sports can be added. Recording a result changes zones
 * from today; earlier workouts keep the zones they had. The coach can record results from chat.
 */
export default function PerformanceScreen() {
  const theme = useTheme();
  const coach = useCoachWord();
  const askIcon = useAskIcon(true);
  const askAgent = useAskAgent();
  const insets = useSafeAreaInsets();
  const performance = usePerformance();
  const units = useUnits();
  const [added, setAdded] = useState<System[]>([]);
  const { selection } = usePlanSelection();
  const active = useActivePlans();
  const todayPlan = active.data?.find((p) => p.id === selection?.planId) ?? active.data?.[0];
  const todayBrief = useBriefState(
    todayPlan?.id ?? '',
    todayPlan ? planVersion(todayPlan, 'locked') : null,
  );
  const data = performance.data;
  const shown = data
    ? SYSTEMS.filter(
        (system) =>
          currentEntry(data, system) || data.usedByPlans.includes(system) || added.includes(system),
      )
    : [];
  // The sports of the plan Today follows come first.
  const first = new Set(systemsForSports(planSports(todayBrief.data?.brief, undefined)));
  shown.sort((a, b) => Number(first.has(b)) - Number(first.has(a)));
  // A new athlete starts with running, the most common first plan.
  const visible = data && !shown.length ? (['run_pace'] as System[]) : shown;
  const hidden = SYSTEMS.filter((system) => !visible.includes(system));
  return (
    <Screen>
      <ScreenHeader
        title="Performance"
        subtitle="Zones every plan uses from today"
        onBack={() => router.back()}
      />
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={performance.isRefetching}
            onRefresh={() => void performance.refetch()}
            tintColor={theme.colors.textDim}
          />
        }
      >
        {performance.isPending ? <LoadingState label="Loading your fitness…" /> : null}
        {performance.error ? (
          <ErrorState
            message={performance.error.message}
            onRetry={() => void performance.refetch()}
          />
        ) : null}
        {data
          ? visible.map((system) => (
              <SystemCard
                key={system}
                system={system}
                entry={currentEntry(data, system)}
                units={units}
              />
            ))
          : null}
        {data && hidden.length ? (
          <Card style={{ gap: 10 }}>
            <Text variant="subheading" style={{ fontWeight: '700' }}>
              Add another sport
            </Text>
            <Text variant="caption">
              {`Only needed for sports you train. Your ${coach} asks for these when a plan includes them.`}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {hidden.map((system) => (
                <Button
                  key={system}
                  label={SPORT_META[SYSTEM_META[system].sport].noun.replace(/^./, (c) =>
                    c.toUpperCase(),
                  )}
                  icon="add"
                  size="sm"
                  variant="secondary"
                  onPress={() => setAdded([...added, system])}
                />
              ))}
            </View>
          </Card>
        ) : null}
        {data ? <History entries={data.entries} units={units} /> : null}
        {/* One way to ask for help with zones, rather than one per sport, after the history. */}
        {data ? (
          <Button
            label={`Ask your ${coach} about my zones`}
            icon={askIcon}
            size="md"
            variant="ghost"
            onPress={() =>
              coach === 'agent'
                ? askAgent(
                    agentPrompt(
                      'Help me update my training zones. Read my performance first, then ask me about recent results.',
                    ),
                  )
                : router.push({
                    pathname: '/chat/[id]',
                    params: { id: 'new', prefill: 'I have a new result to update my zones: ' },
                  })
            }
          />
        ) : null}
        {data ? (
          <Text variant="caption" color="muted" style={{ textAlign: 'center' }}>
            Dates follow this device’s timezone ({data.timezone}). Workouts are written as zones, so
            they update automatically.
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const EMPTY: Record<System, (coach: string) => string> = {
  run_pace: (coach) =>
    `No running fitness yet. Add a recent race or an estimated threshold pace, or tell your ${coach} about a recent result.`,
  cycle_power: (coach) =>
    `No cycling power yet. Add your FTP or a recent test, or ask your ${coach} for an estimate.`,
  swim_pace: (coach) =>
    `No swim paces yet. Add a 400/200 CSS test or an estimated CSS pace, or ask your ${coach}.`,
};

function SystemCard({
  system,
  entry,
  units,
}: {
  system: System;
  entry: Calibration | undefined;
  units: ReturnType<typeof useUnits>;
}) {
  const theme = useTheme();
  const { pool } = useSportUnits();
  const display = { units, pool };
  const meta = SYSTEM_META[system];
  const coach = useCoachWord();
  // Zone values without their unit, which the column headings carry once.
  const bare = (value: number, unit: string) =>
    formatZoneValue(value, unit, display).replace(/\/.*$/, '').replace(/ W$/, '');
  const unitLabel = (unit: string) =>
    unit === 'watts'
      ? 'Watts'
      : unit === 'seconds_per_100_metres'
        ? `Pace per 100${pool}`
        : `Pace per ${units}`;
  // Names and numbers are what people come back for; what each zone is for is a tap away.
  const [described, setDescribed] = useState(false);
  return (
    <Card style={{ gap: 12 }}>
      <View>
        <Text variant="heading">{meta.title}</Text>
        {entry ? (
          <Text variant="caption" color="muted">
            {unitLabel(entry.zones[0]?.unit ?? '')}
          </Text>
        ) : null}
      </View>
      {entry ? (
        <>
          <View style={{ gap: 8 }}>
            <View
              style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingLeft: 18 }}
            >
              <Text variant="label" style={{ flex: 1 }}>
                Zone
              </Text>
              <Text variant="label" style={{ width: RANGE_WIDTH, textAlign: 'right' }}>
                Range
              </Text>
              <Text variant="label" style={{ width: TARGET_WIDTH, textAlign: 'right' }}>
                Target
              </Text>
            </View>
            {Object.keys(meta.zones)
              .map((key) => entry.zones.find((zone) => zone.key === key))
              .filter((zone): zone is NonNullable<typeof zone> => !!zone)
              .map((zone) => (
                <View
                  key={zone.key}
                  style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}
                >
                  <View
                    style={{
                      width: 6,
                      alignSelf: 'stretch',
                      borderRadius: 3,
                      backgroundColor: theme.efforts[zoneEffort(zone.key)],
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text variant="subheading" numberOfLines={1}>
                      {[meta.zones[zone.key]?.short, meta.zones[zone.key]?.label ?? zone.key]
                        .filter((part, i, parts) => part && parts.indexOf(part) === i)
                        .join(' · ')}
                    </Text>
                    {described ? (
                      <Text variant="caption" color="muted">
                        {meta.zones[zone.key]?.description}
                      </Text>
                    ) : null}
                  </View>
                  {/* Range then target on one line, so each zone takes one row; the unit is in the
                      column headings. */}
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                    <Text
                      variant="caption"
                      color="dim"
                      numeric
                      style={{ width: RANGE_WIDTH, textAlign: 'right' }}
                    >
                      {bare(zone.minimum, zone.unit)}–{bare(zone.maximum, zone.unit)}
                    </Text>
                    <Text
                      variant="subheading"
                      numeric
                      style={{ fontWeight: '800', width: TARGET_WIDTH, textAlign: 'right' }}
                    >
                      {bare(zone.target, zone.unit)}
                    </Text>
                  </View>
                </View>
              ))}
            <Pressable
              onPress={() => setDescribed(!described)}
              accessibilityRole="button"
              accessibilityState={{ expanded: described }}
              hitSlop={8}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                alignSelf: 'flex-start',
              }}
            >
              <Text variant="caption" color="accent" style={{ fontWeight: '800' }}>
                {described ? 'Hide zone descriptions' : 'What each zone is for'}
              </Text>
              <Ionicons
                name={described ? 'chevron-up' : 'chevron-down'}
                size={13}
                color={theme.accentText}
              />
            </Pressable>
          </View>
          <CalibrationSource calibration={entry} units={units} style={{ marginHorizontal: 0 }} />
        </>
      ) : (
        <Text variant="body" color="dim">
          {EMPTY[system](coach)}
        </Text>
      )}
      <Button
        label="Add result"
        icon="speedometer-outline"
        size="md"
        variant="tonal"
        onPress={() => router.push({ pathname: '/record-result', params: { system } })}
      />
    </Card>
  );
}

/** Every result you or your coach recorded, newest first; any can be withdrawn. */
function History({
  entries,
  units,
}: {
  entries: Calibration[];
  units: ReturnType<typeof useUnits>;
}) {
  const theme = useTheme();
  const coach = useCoachWord();
  const { pool } = useSportUnits();
  const evidence = (entry: Calibration) => describeEvidence(entry, { units, pool });
  const client = useQueryClient();
  const requestKey = useRequestKey();
  const [withdrawing, setWithdrawing] = useState<Calibration | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const retract = useMutation({
    mutationFn: async (entry: Calibration) => {
      const state = result(
        await api.POST('/api/v1/performance/calibrations/{calibrationId}/retract', {
          params: { path: { calibrationId: entry.id } },
          body: { idempotencyKey: requestKey(['retract', entry.id]) },
        }),
      );
      requestKey.settle(['retract', entry.id]);
      return state;
    },
    onSuccess: async (state) => {
      client.setQueryData(['performance'], state);
      setWithdrawing(null);
      await client.invalidateQueries({ queryKey: ['plan-workouts'] });
    },
  });
  return (
    <Card style={{ gap: 4 }}>
      <Text variant="heading" style={{ marginBottom: 6 }}>
        History
      </Text>
      {entries.length ? (
        entries.map((entry, i) => (
          <View
            key={entry.id}
            style={{
              paddingVertical: 12,
              borderTopWidth: i ? 1 : 0,
              borderTopColor: theme.colors.border,
              gap: 3,
              opacity: entry.retractedAt ? 0.6 : 1,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <Text
                variant="subheading"
                numeric
                style={[
                  { flex: 1, fontSize: 15 },
                  entry.retractedAt ? { textDecorationLine: 'line-through' } : null,
                ]}
              >
                {evidence(entry)}
              </Text>
              {entry.retractedAt ? (
                <Badge
                  label="Withdrawn"
                  size="sm"
                  color={theme.colors.textDim}
                  background={theme.colors.surfaceRaised}
                />
              ) : isEstimate(entry) ? (
                <Badge
                  label="Estimate"
                  size="sm"
                  icon="warning"
                  color={theme.warning}
                  background={theme.warningSoft}
                />
              ) : null}
            </View>
            <Text variant="caption">
              {SYSTEM_META[entry.system].title} ·{' '}
              {entry.observedOn ? `${formatShortYear(entry.observedOn)} · ` : ''}
              applies from {formatShortYear(entry.effectiveFrom)}
            </Text>
            {/* Who recorded it, the estimate's basis and Withdraw fold away, so the history
                stays a list of results. */}
            <Pressable
              onPress={() => setOpenId(openId === entry.id ? null : entry.id)}
              accessibilityRole="button"
              accessibilityState={{ expanded: openId === entry.id }}
              accessibilityLabel={`Details for ${evidence(entry)}`}
              hitSlop={8}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                alignSelf: 'flex-start',
                marginTop: 4,
              }}
            >
              <Text variant="caption" color="accent" style={{ fontWeight: '800' }}>
                {openId === entry.id ? 'Hide details' : 'Details'}
              </Text>
              <Ionicons
                name={openId === entry.id ? 'chevron-up' : 'chevron-down'}
                size={13}
                color={theme.accentText}
              />
            </Pressable>
            {openId !== entry.id ? null : entry.recordedBy === 'coach' ? (
              // Conversations are only shown with the in-app coach.
              <Text
                variant="caption"
                color={entry.conversationId && coach === 'coach' ? 'accent' : 'muted'}
                onPress={
                  entry.conversationId && coach === 'coach'
                    ? () =>
                        router.push({
                          pathname: '/chat/[id]',
                          params: { id: entry.conversationId! },
                        })
                    : undefined
                }
              >
                <Ionicons name="sparkles" size={12} /> Recorded by your coach
              </Text>
            ) : (
              <Text variant="caption" color="muted">
                Recorded {formatDateTime(entry.recordedAt)}
              </Text>
            )}
            {openId === entry.id && entry.estimateBasis ? (
              <Text variant="caption" color="muted">
                {entry.estimateBasis}
              </Text>
            ) : null}
            {openId === entry.id && !entry.retractedAt ? (
              <Pressable
                onPress={() => {
                  retract.reset();
                  setWithdrawing(entry);
                }}
                accessibilityRole="button"
                hitSlop={8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}
              >
                <Ionicons name="remove-circle-outline" size={14} color={theme.colors.textDim} />
                <Text variant="caption" color="dim" style={{ fontWeight: '700' }}>
                  Withdraw
                </Text>
              </Pressable>
            ) : null}
          </View>
        ))
      ) : (
        <Text variant="caption">{`Results you or your ${coach} record appear here.`}</Text>
      )}
      <BottomSheet
        visible={!!withdrawing}
        onClose={() => !retract.isPending && setWithdrawing(null)}
        title="Withdraw this result?"
      >
        <Text variant="body" color="dim">
          Use this for a result that was entered by mistake. The previous zones apply again in every
          plan.
        </Text>
        {withdrawing ? (
          <Text variant="subheading" numeric style={{ marginTop: 12 }}>
            {evidence(withdrawing)}
          </Text>
        ) : null}
        {retract.error ? (
          <ErrorState message={retract.error.message} style={{ marginTop: 12 }} />
        ) : null}
        <View style={{ gap: 10, marginTop: 20 }}>
          <Button
            label="Withdraw"
            icon="arrow-undo"
            variant="danger"
            busy={retract.isPending}
            onPress={() => withdrawing && retract.mutate(withdrawing)}
          />
          <Button
            label="Keep it"
            variant="ghost"
            disabled={retract.isPending}
            onPress={() => setWithdrawing(null)}
          />
        </View>
      </BottomSheet>
    </Card>
  );
}

const RANGE_WIDTH = 76;
const TARGET_WIDTH = 52;
