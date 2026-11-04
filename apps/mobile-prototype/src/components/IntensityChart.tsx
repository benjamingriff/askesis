import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import type { Step } from '../data/types';
import { flattenSegments, ZONE_INTENSITY } from '../lib/metrics';
import { useTheme } from '../state/settings';
import { KIND_COLORS, ZONE_COLORS } from '../theme/palette';

/**
 * Runna-style effort profile: bar width is time, bar height is intensity, colour is the pace zone.
 * Built from plain Views so it renders identically in Expo Go and on web.
 */
export function IntensityChart({
  steps,
  height = 64,
  gap = 2,
  animate = false,
  dimmed = false,
}: {
  steps: Step[];
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
    const flat = flattenSegments(steps);
    const total = flat.reduce((sum, s) => sum + s.seconds, 0) || 1;
    // Keep very short efforts (strides, sprints) visible next to hour-long easy blocks.
    const floor = total * 0.012;
    return flat.map((s) => ({ ...s, weight: Math.max(s.seconds, floor) }));
  }, [steps]);

  return (
    <View
      style={{
        height,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap,
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      {segments.map((s, i) => {
        const intensity = s.zone ? ZONE_INTENSITY[s.zone] : 0.5;
        const color = s.zone ? ZONE_COLORS[s.zone] : KIND_COLORS.strength;
        return (
          <Animated.View
            key={i}
            style={{
              flex: s.weight,
              minWidth: 2,
              height: Math.max(4, height * intensity),
              borderTopLeftRadius: Math.min(5, height / 6),
              borderTopRightRadius: Math.min(5, height / 6),
              borderBottomLeftRadius: 1.5,
              borderBottomRightRadius: 1.5,
              backgroundColor: color,
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
