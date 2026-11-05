import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { FormScreen, leaveScreen } from '../components/forms';
import { STRAVA_NOTICE, STRAVA_ORANGE, sportIcon, summaryLine } from '../components/Strava';
import { Badge, Button, ErrorState, LoadingState, PressableScale, Text } from '../components/ui';
import {
  useActivityLinks,
  useLinkActivity,
  useStravaActivities,
  type ActivitySummary,
} from '../data/activities';
import { daysBetween, formatLong } from '../lib/format';
import { useSportUnits, useTheme, useUnits } from '../state/settings';
import { alpha } from '../theme/palette';

// The web app's activity picker (ActivityPicker in apps/web/src/components/Strava.tsx).

function dayLabel(date: string, planned: string) {
  const offset = daysBetween(planned, date);
  const relative =
    offset === 0
      ? 'Planned day'
      : `${Math.abs(offset)} ${Math.abs(offset) === 1 ? 'day' : 'days'} ${offset < 0 ? 'before' : 'after'}`;
  return { title: formatLong(date), relative, planned: offset === 0 };
}

/** Choose which recorded activity was this workout, from the week either side of its date. */
export default function FindActivityScreen() {
  const params = useLocalSearchParams<{
    planId: string;
    lineageId: string;
    date: string;
    title?: string;
  }>();
  const theme = useTheme();
  const units = useUnits();
  const { pool } = useSportUnits();
  const list = useStravaActivities(params.date);
  const links = useActivityLinks(params.planId).data?.links ?? [];
  const current = links.find((l) => l.lineageId === params.lineageId);
  const { link } = useLinkActivity(params.planId, params.lineageId);
  const [chosen, setChosen] = useState<string | null>(null);
  const days = new Map<string, ActivitySummary[]>();
  for (const activity of list.data?.activities ?? [])
    days.set(activity.date, [...(days.get(activity.date) ?? []), activity]);

  return (
    <FormScreen
      title="Find my activity"
      subtitle={`${params.title ? `${params.title} · ` : ''}${formatLong(params.date)}`}
      footer={
        <View style={{ gap: 10 }}>
          <Button
            size="md"
            variant="ghost"
            icon="refresh"
            label="Refresh"
            busy={list.isFetching && !list.isPending}
            onPress={() => void list.refetch()}
          />
          <Text variant="caption" color="muted" style={{ fontSize: 12, textAlign: 'center' }}>
            Showing your Strava activities from the week either side. {STRAVA_NOTICE}
          </Text>
        </View>
      }
    >
      {list.isPending ? <LoadingState label="Loading your Strava activities…" /> : null}
      {list.error ? (
        <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
      ) : null}
      {link.error ? <ErrorState message={link.error.message} /> : null}
      {list.data && !list.data.activities.length ? (
        <Text variant="body" color="dim">
          No Strava activities between {formatLong(list.data.from)} and {formatLong(list.data.to)}.
          If you’ve just finished, give Strava a minute to process the upload, then refresh.
        </Text>
      ) : null}
      {[...days].map(([date, activities]) => {
        const label = dayLabel(date, params.date);
        return (
          <View key={date} style={{ gap: 8 }} accessibilityLabel={label.title}>
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}
            >
              <Text variant="label" style={{ flex: 1 }}>
                {label.title}
              </Text>
              <Badge
                label={label.relative}
                size="sm"
                color={label.planned ? STRAVA_ORANGE : theme.colors.textDim}
                background={label.planned ? alpha(STRAVA_ORANGE, 0.14) : theme.colors.surfaceRaised}
              />
            </View>
            {activities.map((activity) => {
              const linkedHere = current?.activityId === activity.id;
              const elsewhere = !linkedHere && links.some((l) => l.activityId === activity.id);
              const linking = link.isPending && chosen === activity.id;
              return (
                <PressableScale
                  key={activity.id}
                  scaleTo={0.98}
                  disabled={link.isPending || linkedHere}
                  onPress={() => {
                    setChosen(activity.id);
                    link.mutate(activity.id, { onSuccess: () => leaveScreen() });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Link ${activity.name || activity.sportType}, ${label.title} ${activity.startTime}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    padding: 14,
                    borderRadius: 18,
                    backgroundColor: linkedHere ? alpha(STRAVA_ORANGE, 0.1) : theme.colors.surface,
                    borderWidth: linkedHere ? 1 : StyleSheet.hairlineWidth,
                    borderColor: linkedHere ? alpha(STRAVA_ORANGE, 0.4) : theme.colors.border,
                  }}
                >
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
                    <Ionicons name={sportIcon(activity.sport)} size={18} color={STRAVA_ORANGE} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="subheading" numberOfLines={1}>
                      {activity.name || activity.sportType}
                    </Text>
                    <Text variant="caption" numeric>
                      {activity.startTime} · {summaryLine(activity, units, pool)}
                    </Text>
                    {elsewhere ? (
                      <Text variant="caption" color="muted" style={{ fontSize: 12 }}>
                        Linked to another session; choosing it moves the link here.
                      </Text>
                    ) : null}
                  </View>
                  {linking ? (
                    <ActivityIndicator size="small" color={STRAVA_ORANGE} />
                  ) : (
                    <Text
                      variant="caption"
                      style={{
                        fontWeight: '800',
                        color: linkedHere ? theme.colors.textMuted : STRAVA_ORANGE,
                      }}
                    >
                      {linkedHere ? 'Linked' : 'Link'}
                    </Text>
                  )}
                </PressableScale>
              );
            })}
          </View>
        );
      })}
    </FormScreen>
  );
}
