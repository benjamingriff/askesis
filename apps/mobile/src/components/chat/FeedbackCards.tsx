import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import type { Message } from '../../data/chat';
import { CHECK_IN_LABELS, LOG_LABELS, REASON_LABELS, effortFlag } from '../../data/training-log';
import { formatDuration, formatLong } from '../../lib/format';
import { useTheme } from '../../state/settings';
import { LogChip } from '../TrainingLog';
import { Text } from '../ui';

// Ported from apps/web/src/components/chat/FeedbackCard.tsx.

const PREFERENCES = {
  easy: 'Easy sessions only',
  shorter: 'Shorter sessions',
  rest: 'Rest completely',
  coach: 'Let my coach decide',
} as const;

/** The saved log or check-in a message was sent with, as it was at the time. */
export function FeedbackCards({ references }: { references: Message['references'] }) {
  const theme = useTheme();
  if (!references?.length) return null;
  const card = {
    gap: 6,
    padding: 14,
    borderRadius: 18,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    alignSelf: 'stretch',
  } as const;
  return (
    <View style={{ gap: 8, alignSelf: 'stretch' }}>
      {references.map((ref, index) =>
        ref.type === 'workout_log' ? (
          <View key={index} style={card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="chatbox-ellipses-outline" size={16} color={theme.accentText} />
              <Text variant="caption" color="text" style={{ flex: 1, fontWeight: '800' }}>
                Workout feedback
              </Text>
              <LogChip log={ref.snapshot} />
            </View>
            <View>
              <Text variant="subheading">{ref.snapshot.title}</Text>
              <Text variant="caption" color="muted">
                {formatLong(ref.snapshot.performedOn)}
              </Text>
            </View>
            <Text variant="caption">
              {LOG_LABELS[ref.snapshot.status]}
              {ref.snapshot.actualDurationSeconds != null
                ? ` · ${formatDuration(ref.snapshot.actualDurationSeconds)}`
                : ''}
              {effortFlag(ref.snapshot) ? ` · ${effortFlag(ref.snapshot)}` : ''}
            </Text>
            {ref.snapshot.reasons.length ? (
              <Text variant="caption" color="text">
                {ref.snapshot.reasons.map((r) => REASON_LABELS[r]).join(' · ')}
              </Text>
            ) : null}
            <Text variant="caption" color="muted" style={{ fontSize: 11.5 }}>
              Saved feedback at the time of this message. Later corrections remain in your training
              log.
            </Text>
          </View>
        ) : (
          <View key={index} style={card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="pulse" size={16} color={theme.danger} />
              <Text variant="caption" color="text" style={{ fontWeight: '800' }}>
                Not feeling 100%
              </Text>
            </View>
            <View>
              <Text variant="subheading">{CHECK_IN_LABELS[ref.snapshot.kind]}</Text>
              <Text variant="caption" color="muted">
                {formatLong(ref.snapshot.startsOn)}
                {ref.snapshot.endsOn
                  ? ` to ${formatLong(ref.snapshot.endsOn)}`
                  : ' · duration uncertain'}
              </Text>
            </View>
            <Text variant="caption">
              {PREFERENCES[ref.snapshot.details.preference]} · Return{' '}
              {ref.snapshot.details.returnStyle}
            </Text>
            {ref.snapshot.details.note ? (
              <Text variant="caption" color="text">
                {ref.snapshot.details.note}
              </Text>
            ) : null}
          </View>
        ),
      )}
    </View>
  );
}
