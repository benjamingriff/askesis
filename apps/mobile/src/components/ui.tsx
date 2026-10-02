import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings, useTheme } from '../state/settings';

export type IconName = keyof typeof Ionicons.glyphMap;

// ---- Haptics --------------------------------------------------------------------------------

export function useHaptics() {
  const { settings } = useSettings();
  return useCallback(
    (kind: 'light' | 'select' | 'success' | 'warning' = 'light') => {
      if (!settings.haptics || Platform.OS === 'web') return;
      if (kind === 'select') void Haptics.selectionAsync();
      else if (kind === 'success')
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      else if (kind === 'warning')
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [settings.haptics],
  );
}

// ---- Text -----------------------------------------------------------------------------------

type Variant = 'display' | 'title' | 'heading' | 'subheading' | 'body' | 'caption' | 'label';

const VARIANTS: Record<Variant, TextStyle> = {
  display: { fontSize: 42, lineHeight: 46, fontWeight: '800', letterSpacing: -1.6 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.9 },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.4 },
  subheading: { fontSize: 16, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
};

type TextColor = 'text' | 'dim' | 'muted' | 'accent' | 'onAccent' | (string & {});

export function Text({
  variant = 'body',
  color,
  style,
  numeric,
  ...rest
}: TextProps & { variant?: Variant; color?: TextColor; numeric?: boolean }) {
  const theme = useTheme();
  const defaultColor = variant === 'caption' ? 'dim' : variant === 'label' ? 'muted' : 'text';
  const key = color ?? defaultColor;
  const resolved =
    key === 'text'
      ? theme.colors.text
      : key === 'dim'
        ? theme.colors.textDim
        : key === 'muted'
          ? theme.colors.textMuted
          : key === 'accent'
            ? theme.accentText
            : key === 'onAccent'
              ? theme.onAccent
              : key;
  return (
    <RNText
      {...rest}
      style={[
        VARIANTS[variant],
        { color: resolved },
        numeric && { fontVariant: ['tabular-nums'] },
        style,
      ]}
    />
  );
}

// ---- Pressables -----------------------------------------------------------------------------

const OUTER_KEYS = [
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'alignSelf',
  'width',
  'minWidth',
  'maxWidth',
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginHorizontal',
  'marginVertical',
  'position',
  'top',
  'left',
  'right',
  'bottom',
] as const;

/** Layout props belong on the pressable itself; the animated child only paints and scales. */
function splitStyle(style: StyleProp<ViewStyle>): { outer: ViewStyle; inner: ViewStyle } {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if ((OUTER_KEYS as readonly string[]).includes(key)) outer[key] = value;
    else inner[key] = value;
  }
  return { outer: outer as ViewStyle, inner: inner as ViewStyle };
}

export function PressableScale({
  children,
  style,
  scaleTo = 0.97,
  haptic,
  onPress,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  haptic?: 'light' | 'select' | null;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const buzz = useHaptics();
  const { outer, inner } = splitStyle(style);
  const to = (value: number) =>
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: Platform.OS !== 'web',
      speed: 40,
      bounciness: 0,
    }).start();
  return (
    <Pressable
      {...rest}
      style={outer}
      onPressIn={() => to(scaleTo)}
      onPressOut={() => to(1)}
      onPress={(e) => {
        if (haptic !== null) buzz(haptic ?? 'light');
        onPress?.(e);
      }}
    >
      <Animated.View style={[inner, { alignSelf: 'stretch', transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  size = 22,
  tone = 'plain',
  badge,
  accessibilityLabel,
}: {
  icon: IconName;
  onPress?: () => void;
  size?: number;
  tone?: 'plain' | 'filled' | 'accent';
  badge?: boolean;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  const bg =
    tone === 'filled'
      ? theme.colors.surfaceRaised
      : tone === 'accent'
        ? theme.accent
        : 'transparent';
  const fg = tone === 'accent' ? theme.onAccent : theme.colors.text;
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={size} color={fg} />
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: 8,
            right: 9,
            width: 9,
            height: 9,
            borderRadius: 5,
            backgroundColor: theme.accent,
            borderWidth: 2,
            borderColor: theme.colors.bg,
          }}
        />
      ) : null}
    </PressableScale>
  );
}

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  style,
  size = 'lg',
}: {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  size?: 'md' | 'lg';
}) {
  const theme = useTheme();
  const bg =
    variant === 'primary'
      ? theme.accent
      : variant === 'secondary'
        ? theme.colors.surfaceRaised
        : 'transparent';
  const fg = variant === 'primary' ? theme.onAccent : theme.colors.text;
  return (
    <PressableScale
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={[
        {
          height: size === 'lg' ? 54 : 44,
          borderRadius: size === 'lg' ? 18 : 14,
          backgroundColor: bg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingHorizontal: 20,
          opacity: disabled ? 0.4 : 1,
        },
        variant === 'ghost' && { borderWidth: 1, borderColor: theme.colors.border },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text variant="subheading" style={{ color: fg, fontWeight: '700' }}>
        {label}
      </Text>
    </PressableScale>
  );
}

// ---- Layout ---------------------------------------------------------------------------------

export function Screen({
  children,
  style,
  top = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  top?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        { flex: 1, backgroundColor: theme.colors.bg, paddingTop: top ? insets.top : 0 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Card({
  children,
  style,
  raised,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  raised?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: raised ? theme.colors.surfaceRaised : theme.colors.surface,
          borderRadius: 24,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          padding: 16,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Pill({
  label,
  icon,
  color,
  filled,
  style,
}: {
  label: string;
  icon?: IconName;
  color?: string;
  filled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const tint = color ?? theme.accentText;
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          paddingHorizontal: 10,
          height: 26,
          borderRadius: 13,
          backgroundColor: filled ? tint : theme.colors.surfaceRaised,
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={12} color={filled ? theme.colors.bg : tint} /> : null}
      <Text
        variant="caption"
        style={{ color: filled ? theme.colors.bg : tint, fontWeight: '700', fontSize: 12 }}
      >
        {label}
      </Text>
    </View>
  );
}

export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        marginTop: 28,
        marginBottom: 12,
      }}
    >
      <Text variant="heading">{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={10}>
          <Text variant="caption" color="accent" style={{ fontWeight: '700' }}>
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ProgressBar({
  value,
  color,
  height = 8,
  track,
}: {
  value: number;
  color?: string;
  height?: number;
  track?: string;
}) {
  const theme = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: Math.max(0, Math.min(1, value)),
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [value, anim]);
  return (
    <View
      style={{
        height,
        borderRadius: height / 2,
        backgroundColor: track ?? theme.colors.surfaceRaised,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={{
          height,
          borderRadius: height / 2,
          backgroundColor: color ?? theme.accent,
          width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }}
      />
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { value: T; label: string; icon?: IconName }[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const buzz = useHaptics();
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const x = useRef(new Animated.Value(index)).current;
  const widthRef = useRef(0);
  const widthAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(x, {
      toValue: index,
      useNativeDriver: false,
      speed: 24,
      bounciness: 3,
    }).start();
  }, [index, x]);
  return (
    <View
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width;
        widthAnim.setValue(e.nativeEvent.layout.width);
      }}
      style={[
        {
          flexDirection: 'row',
          backgroundColor: theme.colors.surface,
          borderRadius: 14,
          padding: 3,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        style,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 3,
          bottom: 3,
          left: 3,
          width: Animated.divide(Animated.subtract(widthAnim, 6), options.length),
          borderRadius: 11,
          backgroundColor: theme.colors.surfaceRaised,
          transform: [
            {
              translateX: Animated.multiply(
                x,
                Animated.divide(Animated.subtract(widthAnim, 6), options.length),
              ),
            },
          ],
        }}
      />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              if (!active) buzz('select');
              onChange(o.value);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{
              flex: 1,
              height: 34,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 6,
            }}
          >
            {o.icon ? (
              <Ionicons
                name={o.icon}
                size={14}
                color={active ? theme.colors.text : theme.colors.textMuted}
              />
            ) : null}
            <Text
              variant="caption"
              style={{
                fontWeight: '700',
                color: active ? theme.colors.text : theme.colors.textMuted,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.border,
        marginLeft: inset,
      }}
    />
  );
}

export function KindIcon({
  icon,
  color,
  size = 36,
}: {
  icon: IconName;
  color: string;
  size?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.34,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: `${color}26`,
      }}
    >
      <Ionicons name={icon} size={size * 0.5} color={color} />
    </View>
  );
}
