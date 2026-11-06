import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useCoachWord } from '../data/account';
import {
  useActivityLink,
  useConnectStrava,
  useDisconnectStrava,
  useIntegrations,
  useLinkActivity,
  useStravaActivity,
  useStravaReady,
  type ActivityDetail,
  type ActivitySummary,
} from '../data/activities';
import type { WorkoutSummary } from '../lib/api-types';
import {
  addDays,
  formatClock,
  formatDistance,
  formatDuration,
  formatLong,
  formatPace,
  formatPower,
  formatSpeed,
  formatSwimDistance,
  formatSwimPace,
  type PoolUnits,
  type Units,
} from '../lib/format';
import { SPORT_META } from '../lib/sports';
import { useLocalToday } from '../lib/use-local-today';
import { useSportUnits, useTheme, useUnits } from '../state/settings';
import { alpha } from '../theme/palette';
import { BottomSheet } from './BottomSheet';
import { Button, ErrorState, IconButton, LoadingState, Notice, PressableScale, Text } from './ui';

// Ported from apps/web/src/components/Strava.tsx; keep the two in step.

/** Strava's brand orange, for anything that leads to Strava data. */
export const STRAVA_ORANGE = '#FC5200';

/** Shown wherever Strava data is: it is displayed for reference, never saved. */
export const STRAVA_NOTICE =
  'Strava details are displayed temporarily for reference. Information you enter in your review is saved separately.';

/** The Strava mark, for buttons and labels that lead to Strava data. */
export function StravaMark({
  size = 14,
  color = STRAVA_ORANGE,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"
      />
    </Svg>
  );
}

/** Strava's brand guidelines: link text "View on Strava", bold or in Strava orange. */
export function ViewOnStrava({ url }: { url: string }) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="link"
      hitSlop={8}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
    >
      <Text variant="caption" style={{ color: STRAVA_ORANGE, fontWeight: '800' }}>
        View on Strava
      </Text>
      <Ionicons name="open-outline" size={13} color={STRAVA_ORANGE} />
    </Pressable>
  );
}

/** The orange Strava button: the athlete is about to look at their Strava activities. */
export function StravaButton({
  label,
  onPress,
  busy,
  size = 'md',
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <PressableScale
      onPress={busy ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!busy }}
      style={{
        height: size === 'sm' ? 34 : 42,
        paddingHorizontal: size === 'sm' ? 12 : 16,
        borderRadius: size === 'sm' ? 11 : 14,
        backgroundColor: STRAVA_ORANGE,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        opacity: busy ? 0.6 : 1,
      }}
    >
      <StravaMark size={size === 'sm' ? 13 : 15} color="#FFFFFF" />
      <Text variant="caption" style={{ color: '#FFFFFF', fontWeight: '800' }}>
        {label}
      </Text>
    </PressableScale>
  );
}

// ---- Activity numbers --------------------------------------------------------------------------

export function sportIcon(sport: ActivitySummary['sport']) {
  return sport === 'other' ? ('pulse' as const) : SPORT_META[sport].icon;
}

/** "6.2 km", "1,500 m" for swims; nothing for gym sessions without distance. */
export function distanceText(
  sport: string,
  metres: number | null,
  units: Units,
  pool: PoolUnits,
): string | null {
  if (!metres) return null;
  return sport === 'swim' ? formatSwimDistance(metres, pool) : formatDistance(metres, units);
}

/** Pace for runs and swims, speed for everything else that moves. */
export function paceText(
  sport: string,
  metres: number | null,
  seconds: number | null,
  units: Units,
  pool: PoolUnits,
): string | null {
  if (!metres || !seconds) return null;
  if (sport === 'run') return formatPace((seconds / metres) * 1000, units);
  if (sport === 'swim') return formatSwimPace((seconds / metres) * 100, pool);
  if (sport === 'strength') return null;
  return formatSpeed(metres / seconds, units);
}

export function summaryLine(activity: ActivitySummary, units: Units, pool: PoolUnits) {
  const seconds = activity.movingSeconds ?? activity.elapsedSeconds;
  return [
    distanceText(activity.sport, activity.distanceMetres, units, pool),
    formatDuration(activity.sport === 'strength' ? activity.elapsedSeconds : seconds),
    paceText(activity.sport, activity.distanceMetres, seconds, units, pool),
  ]
    .filter(Boolean)
    .join(' · ');
}

// ---- Linked activity ---------------------------------------------------------------------------

export function openActivityPicker(workout: WorkoutSummary) {
  router.push({
    pathname: '/find-activity',
    params: {
      planId: workout.planId,
      lineageId: workout.lineageId,
      date: workout.scheduledDate,
      title: workout.title,
    },
  });
}

/**
 * A workout's Strava link: "Find my activity" until one is chosen, then "View on Strava" with
 * change and unlink. Only the link is known here; details load only in the log's panel.
 */
export function StravaLinkRow({
  workout,
  writable,
  details,
}: {
  workout: WorkoutSummary;
  writable: boolean;
  /** The log form's details panel toggle. */
  details?: { open: boolean; toggle: () => void };
}) {
  const theme = useTheme();
  const { connected, active } = useStravaReady();
  const today = useLocalToday();
  const link = useActivityLink(workout.planId, workout.lineageId);
  const { unlink } = useLinkActivity(workout.planId, workout.lineageId);
  if (!connected) return null;
  if (!link) {
    if (!active || !writable || workout.scheduledDate > addDays(today, 1)) return null;
    return (
      <View style={{ flexDirection: 'row' }}>
        <StravaButton label="Find my activity" onPress={() => openActivityPicker(workout)} />
      </View>
    );
  }
  return (
    <View
      style={{
        gap: 10,
        padding: 12,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: alpha(STRAVA_ORANGE, 0.4),
        backgroundColor: alpha(STRAVA_ORANGE, theme.isDark ? 0.12 : 0.08),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <StravaMark size={14} />
        <Text variant="caption" color="text" style={{ flex: 1, fontWeight: '700' }}>
          Strava activity linked
        </Text>
        <ViewOnStrava url={link.url} />
      </View>
      {(details && active) || writable ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {details && active ? (
            <Button
              size="sm"
              variant={details.open ? 'secondary' : 'ghost'}
              icon={details.open ? 'chevron-up' : 'stats-chart-outline'}
              label={details.open ? 'Hide details' : 'Show details'}
              onPress={details.toggle}
            />
          ) : null}
          {writable && active ? (
            <Button
              size="sm"
              variant="ghost"
              icon="swap-horizontal"
              label="Change"
              onPress={() => openActivityPicker(workout)}
            />
          ) : null}
          {writable ? (
            <Button
              size="sm"
              variant="ghost"
              icon="unlink-outline"
              label="Unlink"
              busy={unlink.isPending}
              onPress={() => unlink.mutate()}
            />
          ) : null}
        </View>
      ) : null}
      {unlink.error ? <ErrorState message={unlink.error.message} /> : null}
    </View>
  );
}

/** In the log form without a connection: point to You rather than hide the option. */
export function StravaConnectHint() {
  const integrations = useIntegrations().data;
  if (!integrations?.strava.available || integrations.strava.connection) return null;
  return (
    <Pressable
      onPress={() => router.push('/you')}
      accessibilityRole="link"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
    >
      <StravaMark size={13} />
      <Text variant="caption" color="muted" style={{ flex: 1 }}>
        Recorded this on Strava?{' '}
        <Text variant="caption" style={{ color: STRAVA_ORANGE, fontWeight: '800' }}>
          Connect Strava
        </Text>{' '}
        to look it up while you log.
      </Text>
    </Pressable>
  );
}

// ---- Details panel -----------------------------------------------------------------------------

function detailStats(activity: ActivityDetail, units: Units, pool: PoolUnits) {
  const moving = activity.movingSeconds ?? activity.elapsedSeconds;
  const stats: { label: string; value: string }[] = [];
  const distance = distanceText(activity.sport, activity.distanceMetres, units, pool);
  if (distance) stats.push({ label: 'Distance', value: distance });
  stats.push({ label: 'Moving time', value: formatClock(moving) });
  if (activity.elapsedSeconds !== moving)
    stats.push({ label: 'Elapsed time', value: formatClock(activity.elapsedSeconds) });
  const pace = paceText(activity.sport, activity.distanceMetres, moving, units, pool);
  if (pace)
    stats.push({ label: ['run', 'swim'].includes(activity.sport) ? 'Pace' : 'Speed', value: pace });
  if (activity.elevationGainMetres)
    stats.push({
      label: 'Elevation',
      value:
        units === 'mi'
          ? `${Math.round(activity.elevationGainMetres * 3.28084)} ft`
          : `${Math.round(activity.elevationGainMetres)} m`,
    });
  if (activity.averageHeartrate)
    stats.push({ label: 'Avg heart rate', value: `${activity.averageHeartrate} bpm` });
  if (activity.maxHeartrate)
    stats.push({ label: 'Max heart rate', value: `${activity.maxHeartrate} bpm` });
  if (activity.averageWatts)
    stats.push({ label: 'Avg power', value: formatPower(activity.averageWatts) });
  if (activity.averageCadence)
    stats.push({
      label: 'Cadence',
      // Strava reports running cadence per leg; runners think in steps per minute.
      value:
        activity.sport === 'run'
          ? `${Math.round(activity.averageCadence * 2)} spm`
          : `${Math.round(activity.averageCadence)} rpm`,
    });
  if (activity.calories) stats.push({ label: 'Calories', value: `${activity.calories}` });
  return stats;
}

/**
 * The linked activity, fetched from Strava each time the panel opens, above the log form. The
 * athlete reads it and fills in their own review; nothing here is copied into the form.
 */
export function StravaActivityPanel({
  activityId,
  url,
  onClose,
}: {
  activityId: string;
  url: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const units = useUnits();
  const { pool } = useSportUnits();
  const activity = useStravaActivity(activityId);
  const data = activity.data;
  const cell = { color: theme.colors.textDim, fontSize: 12 } as const;
  return (
    <View
      accessibilityLabel="Strava activity details"
      style={{
        borderRadius: 20,
        borderWidth: 1,
        borderColor: alpha(STRAVA_ORANGE, 0.35),
        backgroundColor: theme.colors.surface,
        padding: 16,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <StravaMark size={14} />
        <Text variant="label" style={{ color: STRAVA_ORANGE, flex: 1 }}>
          From Strava
        </Text>
        <IconButton
          icon="close"
          size={18}
          accessibilityLabel="Hide Strava details"
          onPress={onClose}
        />
      </View>
      {activity.isPending ? <LoadingState label="Loading from Strava…" /> : null}
      {activity.error ? (
        <ErrorState message={activity.error.message} onRetry={() => void activity.refetch()} />
      ) : null}
      {data ? (
        <>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                backgroundColor: alpha(STRAVA_ORANGE, 0.14),
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={sportIcon(data.sport)} size={18} color={STRAVA_ORANGE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="subheading" numberOfLines={2}>
                {data.name || data.sportType}
              </Text>
              <Text variant="caption" color="muted">
                {formatLong(data.date)} · {data.startTime} · {data.sportType}
                {data.deviceName ? ` · ${data.deviceName}` : ''}
                {data.trainer ? ' · Indoor' : ''}
                {data.manual ? ' · Entered manually' : ''}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 }}>
            {detailStats(data, units, pool).map((stat) => (
              <View key={stat.label} style={{ width: '50%', paddingRight: 8 }}>
                <Text variant="label">{stat.label}</Text>
                <Text variant="subheading" numeric style={{ marginTop: 3, fontWeight: '800' }}>
                  {stat.value}
                </Text>
              </View>
            ))}
          </View>
          {data.description ? (
            <View
              style={{ borderLeftWidth: 3, borderLeftColor: theme.colors.border, paddingLeft: 12 }}
            >
              <Text variant="body" color="dim">
                {data.description}
              </Text>
            </View>
          ) : null}
          {data.laps.length > 1 ? (
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="repeat" size={13} color={theme.colors.textMuted} />
                <Text variant="label">Laps</Text>
              </View>
              <View style={{ flexDirection: 'row', paddingVertical: 4 }}>
                {[
                  'Lap',
                  'Distance',
                  'Time',
                  data.sport === 'run' || data.sport === 'swim' ? 'Pace' : 'Speed',
                  'HR',
                ].map((heading, index) => (
                  <Text
                    key={heading}
                    variant="label"
                    style={{ flex: index === 0 ? 0.6 : index === 4 ? 0.7 : 1.2 }}
                  >
                    {heading}
                  </Text>
                ))}
              </View>
              {data.laps.map((lap) => {
                const seconds = lap.movingSeconds || lap.elapsedSeconds;
                return (
                  <View
                    key={lap.index}
                    style={{
                      flexDirection: 'row',
                      paddingVertical: 6,
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: theme.colors.border,
                    }}
                  >
                    <Text numeric style={[cell, { flex: 0.6 }]}>
                      {lap.index}
                    </Text>
                    <Text numeric style={[cell, { flex: 1.2 }]}>
                      {distanceText(data.sport, lap.distanceMetres, units, pool) ?? '—'}
                    </Text>
                    <Text numeric style={[cell, { flex: 1.2 }]}>
                      {formatClock(lap.elapsedSeconds)}
                    </Text>
                    <Text numeric style={[cell, { flex: 1.2 }]}>
                      {paceText(data.sport, lap.distanceMetres, seconds, units, pool) ?? '—'}
                    </Text>
                    <Text numeric style={[cell, { flex: 0.7 }]}>
                      {lap.averageHeartrate ?? '—'}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </>
      ) : null}
      <View style={{ gap: 6 }}>
        <ViewOnStrava url={url} />
        <Text variant="caption" color="muted" style={{ fontSize: 12 }}>
          {STRAVA_NOTICE}
        </Text>
      </View>
    </View>
  );
}

// ---- You › Connections -------------------------------------------------------------------------

export function StravaConnection() {
  const theme = useTheme();
  const coach = useCoachWord();
  const integrations = useIntegrations();
  const connect = useConnectStrava();
  const disconnect = useDisconnectStrava();
  const [confirming, setConfirming] = useState(false);
  if (integrations.isPending)
    return <LoadingState label="Loading connections…" style={{ paddingHorizontal: 16 }} />;
  if (integrations.error)
    return (
      <View style={{ padding: 16 }}>
        <ErrorState
          message={integrations.error.message}
          onRetry={() => void integrations.refetch()}
        />
      </View>
    );
  const { available, connection } = integrations.data.strava;
  const error = connect.error ?? disconnect.error;
  const revoked = connection?.status === 'reauthorization_required';
  return (
    <View style={{ padding: 16, gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: STRAVA_ORANGE,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <StravaMark size={20} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="subheading">Strava</Text>
          <Text variant="caption" style={{ marginTop: 2 }}>
            {connection
              ? revoked
                ? 'Strava no longer accepts this connection. Reconnect to look up activities.'
                : connection.displayName
                  ? `Connected as ${connection.displayName}`
                  : 'Connected'
              : available
                ? 'Look up the activity you recorded while you log a workout.'
                : 'Not configured on this server.'}
          </Text>
        </View>
        {connection && !revoked ? (
          <View
            style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.locked }}
            accessibilityLabel="Connected"
          />
        ) : null}
      </View>
      {connection ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {revoked ? (
            <StravaButton
              label="Reconnect"
              busy={connect.isPending}
              onPress={() => connect.mutate()}
            />
          ) : null}
          <Button
            size="md"
            variant="ghost"
            label="Disconnect"
            onPress={() => setConfirming(true)}
          />
        </View>
      ) : available ? (
        <View style={{ flexDirection: 'row' }}>
          <StravaButton
            label="Connect with Strava"
            busy={connect.isPending}
            onPress={() => connect.mutate()}
          />
        </View>
      ) : null}
      {error ? <Notice tone="danger">{error.message}</Notice> : null}
      <Text variant="caption" color="muted">
        You choose which Strava activity belongs to each workout. Waddle keeps only that link;
        activity details are fetched from Strava when you open them, shown only to you, and never
        shared with your {coach}.
      </Text>
      <BottomSheet
        visible={confirming}
        onClose={() => (disconnect.isPending ? undefined : setConfirming(false))}
        title="Disconnect Strava?"
      >
        <Text variant="body" color="dim">
          Waddle revokes its access and deletes the links you made between workouts and Strava
          activities. Your workout logs stay.
        </Text>
        {disconnect.error ? (
          <ErrorState message={disconnect.error.message} style={{ marginTop: 14 }} />
        ) : null}
        <View style={{ gap: 10, marginTop: 20 }}>
          <Button
            label="Disconnect"
            variant="danger"
            busy={disconnect.isPending}
            onPress={() => disconnect.mutate(undefined, { onSuccess: () => setConfirming(false) })}
          />
          <Button label="Keep connected" variant="ghost" onPress={() => setConfirming(false)} />
        </View>
      </BottomSheet>
    </View>
  );
}
