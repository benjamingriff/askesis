import { LinearGradient } from 'expo-linear-gradient';
import type { Tabs } from 'expo-router';
import { useRef, type ComponentProps, type ReactNode } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../state/settings';
import { alpha } from '../theme/palette';
import { Text, useHaptics } from './ui';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

export const TAB_BAR_HEIGHT = 64;
const SIDE_MARGIN = 20;
const ITEM_RADIUS = 24;

function bottomOffset(inset: number) {
  return Math.max(inset - 8, 12);
}

/** Space tab screens should reserve at the bottom so content can scroll under the floating bar. */
export function useTabBarInset() {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + bottomOffset(insets.bottom) + 20;
}

export function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = bottomOffset(insets.bottom);

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
      {/* Soft fade so scrolling content doesn't collide with the pill */}
      <LinearGradient
        pointerEvents="none"
        colors={[alpha(theme.colors.bg, 0), alpha(theme.colors.bg, 0.92)]}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: TAB_BAR_HEIGHT + bottom + 28,
        }}
      />
      <View
        style={{
          marginHorizontal: SIDE_MARGIN,
          marginBottom: bottom,
          height: TAB_BAR_HEIGHT,
          borderRadius: TAB_BAR_HEIGHT / 2,
          padding: 5,
          flexDirection: 'row',
          backgroundColor: alpha(theme.colors.surface, 0.97),
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          shadowColor: '#000',
          shadowOpacity: theme.isDark ? 0.5 : 0.14,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 12,
        }}
      >
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const label = typeof options.title === 'string' ? options.title : route.name;
          const color = focused ? theme.accentText : theme.colors.textMuted;
          const badge = options.tabBarBadge;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };

          return (
            <TabItem
              key={route.key}
              focused={focused}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              label={label}
              color={color}
              badge={badge}
              icon={options.tabBarIcon?.({ focused, color, size: 24 })}
            />
          );
        })}
      </View>
    </View>
  );
}

function TabItem({
  focused,
  onPress,
  onLongPress,
  label,
  color,
  badge,
  icon,
}: {
  focused: boolean;
  onPress: () => void;
  onLongPress: () => void;
  label: string;
  color: string;
  badge?: string | number;
  icon: ReactNode;
}) {
  const theme = useTheme();
  const buzz = useHaptics();
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) =>
    Animated.spring(scale, {
      toValue: v,
      useNativeDriver: Platform.OS !== 'web',
      speed: 40,
      bounciness: 0,
    }).start();

  return (
    <Pressable
      onPress={() => {
        if (!focused) buzz('select');
        onPress();
      }}
      onLongPress={onLongPress}
      onPressIn={() => to(0.94)}
      onPressOut={() => to(1)}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
      style={{ flex: 1 }}
    >
      <Animated.View
        style={{
          flex: 1,
          borderRadius: ITEM_RADIUS + 3,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          backgroundColor: focused ? theme.colors.surfaceRaised : 'transparent',
          transform: [{ scale }],
        }}
      >
        <View>
          {icon}
          {badge !== undefined && badge !== '' ? (
            <View
              style={{
                position: 'absolute',
                top: -4,
                right: -10,
                minWidth: 16,
                height: 16,
                paddingHorizontal: 4,
                borderRadius: 8,
                backgroundColor: theme.accent,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                variant="label"
                numeric
                style={{ fontSize: 10, lineHeight: 12, color: theme.onAccent }}
              >
                {badge}
              </Text>
            </View>
          ) : null}
        </View>
        <Text variant="caption" style={{ fontSize: 11, lineHeight: 14, fontWeight: '700', color }}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}
