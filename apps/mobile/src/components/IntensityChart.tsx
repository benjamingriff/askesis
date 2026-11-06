import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import type { WorkoutStep } from '../lib/api-types';
import { intensitySegments } from '../lib/workouts';
import { useTheme } from '../state/settings';

/**
 * Runna-style effort profile: bar width is time, bar height is intensity, colour is effort.
 * Built from plain Views so it renders identically in Expo Go and on web.
 */
export function IntensityChart({
  prescription,
  height = 64,
  gap = 2,
  animate = false,
  dimmed = false,
}: {
  prescription: WorkoutStep;
  height?: number;
  gap?: number;
  animate?: boolean;
  dimmed?: boolean;
}) {
  const theme = useTheme();
  const rise = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    Animated.timing(rise, {
      toValue: 1,
      duration: 650,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [animate, rise]);

  const segments = useMemo(() => {
    // Back-to-back efforts at the same level read as one block (a jog between two easy steps).
    const flat = intensitySegments(prescription).reduce<ReturnType<typeof intensitySegments>>(
      (merged, s) => {
        const last = merged.at(-1);
        if (last && last.effort === s.effort && last.level === s.level) last.seconds += s.seconds;
        else merged.push({ ...s });
        return merged;
      },
      [],
    );
    const total = flat.reduce((sum, s) => sum + s.seconds, 0) || 1;
    // Short efforts (strides, sets, hill reps) stay readable as blocks beside long easy running:
    // none narrower than about half an even share.
    const floor = Math.max(total * 0.012, (total / flat.length) * 0.55);
    return flat.map((s) => ({ ...s, weight: Math.max(s.seconds, floor) }));
  }, [prescription]);
  const barGap = segments.length > 24 ? Math.min(gap, 1.5) : gap;
  const radius = Math.min(segments.length > 24 ? 3 : 5, height / 6);

  return (
    <View
      style={{
        height,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: barGap,
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      {segments.map((s, i) => {
        // Same scale as the web chart: easy efforts are low blocks, not slivers.
        const intensity = Math.min(1, 0.22 + s.level * 0.156);
        return (
          <Animated.View
            key={i}
            style={{
              flex: s.weight,
              minWidth: 2,
              height: Math.max(4, height * intensity),
              borderTopLeftRadius: radius,
              borderTopRightRadius: radius,
              borderBottomLeftRadius: 1.5,
              borderBottomRightRadius: 1.5,
              backgroundColor: theme.efforts[s.effort],
              transform: [
                { scaleY: rise },
                {
                  translateY: rise.interpolate({
                    inputRange: [0, 1],
                    outputRange: [height * intensity * 0.5, 0],
                  }),
                },
              ],
            }}
          />
        );
      })}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 1,
          backgroundColor: theme.colors.border,
        }}
      />
    </View>
  );
}
