import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Button, Card, IconButton, Pill, Screen, Text } from '../components/ui';
import {
  formatPace,
  formatPaceRange,
  PACE_GUIDES,
  ZONE_INTENSITY,
  ZONE_ORDER,
} from '../lib/metrics';
import { useSettings, useTheme } from '../state/settings';
import { ZONE_COLORS } from '../theme/palette';

export default function PaceGuidesScreen() {
  const theme = useTheme();
  const { settings } = useSettings();
  return (
    <Screen>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 6,
          gap: 4,
        }}
      >
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <Text variant="heading" style={{ flex: 1 }}>
          Pace guides
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        <Card>
          <Pill label="Estimated" icon="alert-circle" color="#FBBF24" />
          <Text variant="heading" style={{ marginTop: 12 }}>
            Threshold {formatPace(290, settings.units)}
          </Text>
          <Text variant="body" color="dim" style={{ marginTop: 6 }}>
            Estimated from a 48:30 10K and your conversation with the coach. Workouts are written as
            zones, so they update automatically when this changes.
          </Text>
          <Text variant="caption" color="muted" style={{ marginTop: 10 }}>
            Effective from week 3 · v2
          </Text>
        </Card>

        {ZONE_ORDER.map((z) => (
          <View
            key={z}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              padding: 16,
              borderRadius: 22,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <View
              style={{
                width: 6,
                alignSelf: 'stretch',
                borderRadius: 3,
                backgroundColor: ZONE_COLORS[z],
              }}
            />
            <View style={{ flex: 1 }}>
              <Text variant="subheading">{PACE_GUIDES[z].label}</Text>
              <Text variant="caption" style={{ marginTop: 2 }}>
                {PACE_GUIDES[z].feel}
              </Text>
              <View
                style={{
                  marginTop: 10,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: theme.colors.surfaceRaised,
                }}
              >
                <View
                  style={{
                    width: `${ZONE_INTENSITY[z] * 100}%`,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: ZONE_COLORS[z],
                  }}
                />
              </View>
            </View>
            <Text variant="heading" numeric style={{ fontSize: 17 }}>
              {formatPaceRange(z, settings.units)}
            </Text>
          </View>
        ))}

        <Card style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
          <Ionicons name="information-circle" size={20} color={theme.colors.textDim} />
          <Text variant="caption" style={{ flex: 1 }}>
            After your 10K tune-up, tell your coach the result. A measured race replaces this
            estimate for future workouts, and earlier ones keep the paces they were run at.
          </Text>
        </Card>
        <Button
          label="Update with my coach"
          icon="chatbubble-ellipses"
          variant="secondary"
          onPress={() => router.push('/chat/c-tempo')}
        />
      </ScrollView>
    </Screen>
  );
}
