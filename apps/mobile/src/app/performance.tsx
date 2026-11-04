import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet } from '../components/BottomSheet';
import { CalibrationSource } from '../components/PlanWidgets';
import { compactRange } from '../components/StepList';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  LoadingState,
  Pill,
  Screen,
  ScreenHeader,
  Text,
} from '../components/ui';
import { currentEntry, usePerformance, type Calibration } from '../data/plan-data';
import { useAskAgent, useCoachWord } from '../data/account';
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
  type System,
} from '../lib/sports';
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
  const insets = useSafeAreaInsets();
  const performance = usePerformance();
  const units = useUnits();
  const [added, setAdded] = useState<System[]>([]);
  const data = performance.data;
  const shown = data
    ? SYSTEMS.filter(
        (system) =>
          currentEntry(data, system) || data.usedByPlans.includes(system) || added.includes(system),
      )
    : [];
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
        <Text variant="body" color="dim">
          Your training zones belong to you, not to a plan. Every plan uses them from the day they
          change; earlier workouts keep the zones they had.
        </Text>
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
  const askAgent = useAskAgent();
  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="heading" style={{ flex: 1 }}>
          {meta.title}
        </Text>
        {entry && isEstimate(entry) ? (
          <Pill label="Estimate" icon="warning" color={theme.warning} />
        ) : null}
      </View>
      {entry ? (
        <>
          <View style={{ gap: 10 }}>
            {Object.keys(meta.zones)
              .map((key) => entry.zones.find((zone) => zone.key === key))
              .filter((zone): zone is NonNullable<typeof zone> => !!zone)
              .map((zone) => (
                <View
                  key={zone.key}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
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
                    <Text variant="subheading">
                      {[meta.zones[zone.key]?.short, meta.zones[zone.key]?.label ?? zone.key]
                        .filter((part, i, parts) => part && parts.indexOf(part) === i)
                        .join(' · ')}
                    </Text>
                    <Text variant="caption" color="muted">
                      {meta.zones[zone.key]?.description}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text variant="subheading" numeric style={{ fontWeight: '800' }}>
                      {formatZoneValue(zone.target, zone.unit, display)}
                    </Text>
                    <Text variant="caption" numeric>
                      {compactRange(
                        formatZoneValue(zone.minimum, zone.unit, display),
                        formatZoneValue(zone.maximum, zone.unit, display),
                      )}
                    </Text>
                  </View>
                </View>
              ))}
          </View>
          <CalibrationSource calibration={entry} units={units} style={{ marginHorizontal: 0 }} />
        </>
      ) : (
        <Text variant="body" color="dim">
          {EMPTY[system](coach)}
        </Text>
      )}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button
          label="Add result"
          icon="speedometer-outline"
          size="md"
          style={{ flex: 1 }}
          onPress={() => router.push({ pathname: '/record-result', params: { system } })}
        />
        <Button
          label={coach === 'coach' ? 'Ask coach' : 'Ask agent'}
          icon="chatbubble-ellipses-outline"
          size="md"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() =>
            coach === 'agent'
              ? askAgent(
                  agentPrompt(
                    `Help me update my ${meta.title.toLowerCase()}. Read my performance first, then ask me about recent results.`,
                  ),
                )
              : router.push({
                  pathname: '/chat/[id]',
                  params: {
                    id: 'new',
                    prefill: `I have a new ${SPORT_META[SYSTEM_META[system].sport].noun} result to update my zones: `,
                  },
                })
          }
        />
      </View>
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
            {entry.recordedBy === 'coach' ? (
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
            {entry.estimateBasis ? (
              <Text variant="caption" color="muted">
                {entry.estimateBasis}
              </Text>
            ) : null}
            {!entry.retractedAt ? (
              <Button
                label="Withdraw"
                icon="arrow-undo"
                size="sm"
                variant="ghost"
                style={{ alignSelf: 'flex-start', marginTop: 6 }}
                onPress={() => {
                  retract.reset();
                  setWithdrawing(entry);
                }}
              />
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
