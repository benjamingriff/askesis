import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, View } from 'react-native';
import type { Message, MessagePart } from '../../data/types';
import { useSettings, useTheme } from '../../state/settings';
import { PressableScale, Text } from '../ui';
import { ChangeBadge } from '../WorkoutRow';
import { RichText } from './RichText';

function Dots() {
  const theme = useTheme();
  const anims = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const loops = anims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(a, {
            toValue: 1,
            duration: 320,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(a, {
            toValue: 0.3,
            duration: 320,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(280 - i * 140),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [anims]);
  return (
    <View style={{ flexDirection: 'row', gap: 5, height: 22, alignItems: 'center' }}>
      {anims.map((a, i) => (
        <Animated.View
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: theme.colors.textDim,
            opacity: a,
          }}
        />
      ))}
    </View>
  );
}

function ActivityLog({
  part,
  streaming,
}: {
  part: Extract<MessagePart, { type: 'activity' }>;
  streaming: boolean;
}) {
  const theme = useTheme();
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const running = part.calls.some((c) => c.status === 'running');
  const current = part.calls.find((c) => c.status === 'running');

  if (!settings.showActivity && !running) return null;

  const summary = running
    ? (current?.label ?? 'Working…')
    : `Worked for ${part.seconds ?? 1}s · ${part.calls.length} ${part.calls.length === 1 ? 'action' : 'actions'}`;

  return (
    <View
      style={{
        borderRadius: 16,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        overflow: 'hidden',
      }}
    >
      <PressableScale
        onPress={() => setOpen((o) => !o)}
        disabled={!settings.showActivity}
        scaleTo={0.99}
        haptic="select"
        accessibilityRole="button"
        accessibilityLabel={summary}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 12,
          height: 40,
        }}
      >
        {running && streaming ? (
          <ActivityIndicator size="small" color={theme.accent} />
        ) : (
          <Ionicons name="checkmark-circle" size={16} color="#34D399" />
        )}
        <Text variant="caption" numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>
          {summary}
        </Text>
        {settings.showActivity ? (
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={theme.colors.textMuted}
          />
        ) : null}
      </PressableScale>
      {open ? (
        <View
          style={{
            paddingHorizontal: 12,
            paddingBottom: 12,
            gap: 8,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
            paddingTop: 10,
          }}
        >
          {part.calls.map((c) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {c.status === 'running' ? (
                <ActivityIndicator
                  size="small"
                  color={theme.accent}
                  style={{ width: 14, height: 14 }}
                />
              ) : (
                <Ionicons name="checkmark" size={14} color={theme.colors.textMuted} />
              )}
              <Text variant="caption" style={{ flex: 1 }}>
                {c.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function PlanUpdateCard({
  part,
  onView,
}: {
  part: Extract<MessagePart, { type: 'planUpdate' }>;
  onView: () => void;
}) {
  const theme = useTheme();
  const shown = part.changes.slice(0, 3);
  const more = part.changes.length - shown.length;
  return (
    <PressableScale
      onPress={onView}
      scaleTo={0.985}
      accessibilityRole="button"
      accessibilityLabel="View plan changes"
      style={{
        borderRadius: 20,
        backgroundColor: theme.accentSoft,
        borderWidth: 1,
        borderColor: theme.accentBorder,
        padding: 14,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: theme.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="calendar" size={16} color={theme.onAccent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="subheading">Plan draft updated</Text>
          <Text variant="caption">{part.summary}</Text>
        </View>
        <Ionicons name="arrow-forward" size={18} color={theme.accentText} />
      </View>
      <View style={{ marginTop: 12, gap: 8 }}>
        {shown.map((c) => (
          <View key={c.workoutId} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ChangeBadge change={c.kind} />
            <Text variant="caption" color="text" numberOfLines={1} style={{ flex: 1 }}>
              {c.label}
            </Text>
          </View>
        ))}
        {more > 0 ? (
          <Text variant="caption" color="muted">
            + {more} more
          </Text>
        ) : null}
      </View>
      <Text variant="caption" color="accent" style={{ marginTop: 12, fontWeight: '800' }}>
        Swipe → or tap to review in Plan
      </Text>
    </PressableScale>
  );
}

export function MessageView({
  message,
  onViewPlan,
  onUnlock,
}: {
  message: Message;
  onViewPlan: () => void;
  onUnlock: (messageId: string) => void;
}) {
  const theme = useTheme();
  const streaming = message.status === 'streaming';

  if (message.role === 'user') {
    const text = message.parts.find((p) => p.type === 'text');
    return (
      <View style={{ alignItems: 'flex-end', paddingLeft: 48 }}>
        <View
          style={{
            backgroundColor: theme.colors.surfaceRaised,
            borderRadius: 22,
            borderBottomRightRadius: 6,
            paddingHorizontal: 16,
            paddingVertical: 11,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
          }}
        >
          <Text>{text?.type === 'text' ? text.text : ''}</Text>
        </View>
      </View>
    );
  }

  const lastTextIndex = message.parts.reduce((acc, p, i) => (p.type === 'text' ? i : acc), -1);
  const empty = message.parts.length === 0;

  return (
    <View style={{ gap: 10, paddingRight: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: theme.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="sparkles" size={12} color={theme.onAccent} />
        </View>
        <Text variant="caption" style={{ fontWeight: '800' }} color="text">
          Coach
        </Text>
      </View>
      {empty && streaming ? <Dots /> : null}
      {message.parts.map((part, i) => {
        switch (part.type) {
          case 'text':
            return part.text ? (
              <RichText key={i} text={part.text} cursor={streaming && i === lastTextIndex} />
            ) : (
              <Dots key={i} />
            );
          case 'activity':
            return <ActivityLog key={i} part={part} streaming={streaming} />;
          case 'planUpdate':
            return <PlanUpdateCard key={i} part={part} onView={onViewPlan} />;
          case 'action':
            return (
              <PressableScale
                key={i}
                disabled={part.done}
                onPress={() => onUnlock(message.id)}
                accessibilityRole="button"
                style={{
                  alignSelf: 'flex-start',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  height: 42,
                  paddingHorizontal: 16,
                  borderRadius: 21,
                  backgroundColor: part.done ? theme.colors.surfaceRaised : theme.accent,
                }}
              >
                <Ionicons
                  name={part.done ? 'checkmark' : 'lock-open'}
                  size={16}
                  color={part.done ? theme.colors.textDim : theme.onAccent}
                />
                <Text
                  variant="subheading"
                  style={{
                    color: part.done ? theme.colors.textDim : theme.onAccent,
                    fontWeight: '800',
                  }}
                >
                  {part.done ? 'Unlocked' : part.label}
                </Text>
              </PressableScale>
            );
        }
      })}
      {message.status === 'stopped' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="stop-circle-outline" size={14} color={theme.colors.textMuted} />
          <Text variant="caption" color="muted">
            Stopped. Anything already applied stays in the draft.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
