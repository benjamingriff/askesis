import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
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
        overflow: 'hidden',
      }}
    >
      {tone === 'accent' ? <AccentFill /> : null}
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
  busy,
  style,
  size = 'lg',
}: {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  /** `tonal`: an accent tint and edge, for a main action that shouldn't be a solid lime slab. */
  variant?: 'primary' | 'secondary' | 'tonal' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const theme = useTheme();
  const bg =
    variant === 'primary'
      ? theme.accent
      : variant === 'secondary'
        ? theme.colors.surfaceRaised
        : variant === 'tonal'
          ? theme.accentSoft
          : 'transparent';
  const fg =
    variant === 'primary'
      ? theme.onAccent
      : variant === 'danger'
        ? theme.danger
        : variant === 'tonal' && theme.isDark
          ? theme.accentText
          : theme.colors.text;
  return (
    <PressableScale
      onPress={disabled || busy ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      style={[
        {
          height: size === 'lg' ? 54 : size === 'md' ? 44 : 34,
          borderRadius: size === 'lg' ? 18 : size === 'md' ? 14 : 11,
          backgroundColor: bg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingHorizontal: size === 'sm' ? 12 : 20,
          opacity: disabled ? 0.4 : 1,
          overflow: 'hidden',
        },
        variant === 'ghost' && {
          borderWidth: 1,
          borderColor: theme.isDark ? theme.colors.border : theme.colors.textMuted,
        },
        variant === 'tonal' && { borderWidth: 1, borderColor: theme.accentBorder },
        variant === 'secondary' && {
          borderWidth: theme.isDark ? StyleSheet.hairlineWidth : 1,
          borderColor: theme.colors.border,
        },
        variant === 'danger' && { borderWidth: 1, borderColor: alphaHex(theme.danger, 0.4) },
        style,
      ]}
    >
      {variant === 'primary' ? <AccentFill /> : null}
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Ionicons name={icon} size={size === 'sm' ? 15 : 18} color={fg} />
      ) : null}
      <Text
        variant={size === 'sm' ? 'caption' : 'subheading'}
        style={{ color: fg, fontWeight: '700' }}
      >
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

/**
 * A small rounded label. Height comes from padding around a tight line box rather than a fixed
 * height, and uppercase tracking is balanced on both sides, so the text sits centred
 * with the system font on every platform.
 */
export function Badge({
  label,
  icon,
  color,
  background,
  border,
  size = 'md',
  caps = false,
  style,
}: {
  label: string;
  icon?: IconName;
  /** Text and icon colour. */
  color: string;
  background: string;
  border?: string;
  size?: 'sm' | 'md' | 'lg';
  caps?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const fontSize = { sm: caps ? 9.5 : 11, md: caps ? 10.5 : 12, lg: 13 }[size];
  const padY = { sm: 3, md: 5, lg: 7 }[size];
  const tracking = caps ? 0.7 : 0;
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: size === 'sm' ? 4 : 5,
          paddingVertical: padY,
          paddingHorizontal: size === 'sm' ? 7 : size === 'md' ? 10 : 12,
          borderRadius: 999,
          backgroundColor: background,
          borderWidth: border ? StyleSheet.hairlineWidth : 0,
          borderColor: border,
        },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={fontSize + 1} color={color} /> : null}
      <RNText
        numberOfLines={1}
        style={{
          fontSize,
          lineHeight: Math.round(fontSize * 1.25),
          fontWeight: '700',
          color,
          letterSpacing: tracking,
          // Tracking also follows the last letter; matching it on the left keeps the label centred.
          paddingLeft: tracking,
          textTransform: caps ? 'uppercase' : 'none',
          includeFontPadding: false,
          textAlignVertical: 'center',
          flexShrink: 1,
        }}
      >
        {label}
      </RNText>
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
    <Badge
      label={label}
      icon={icon}
      color={filled ? theme.colors.bg : tint}
      background={filled ? tint : theme.colors.surfaceRaised}
      style={style}
    />
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
          backgroundColor: color ?? (theme.isDark ? theme.accent : theme.accentText),
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
          // The track's inner width: less its padding and its hairline border, so the thumb sits
          // evenly in the first and last slots.
          width: Animated.divide(
            Animated.subtract(widthAnim, 6 + 2 * StyleSheet.hairlineWidth),
            options.length,
          ),
          borderRadius: 11,
          backgroundColor: theme.colors.surfaceRaised,
          // An outline keeps the selected segment visible where surface and raised are close.
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.textMuted,
          transform: [
            {
              translateX: Animated.multiply(
                x,
                Animated.divide(
                  Animated.subtract(widthAnim, 6 + 2 * StyleSheet.hairlineWidth),
                  options.length,
                ),
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

function alphaHex(hex: string, a: number) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Fills its parent with the accent: a diagonal gradient for blends, a flat colour otherwise. */
export function AccentFill() {
  const theme = useTheme();
  if (theme.accentStops.length < 2)
    return (
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.accent }]}
      />
    );
  return (
    <LinearGradient
      pointerEvents="none"
      colors={theme.accentStops as [string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
}

// ---- Action lists -------------------------------------------------------------------------------

export type ListAction = {
  label: string;
  icon: IconName;
  onPress: () => void;
  tone?: 'default' | 'danger';
  /** A short value on the right, such as the current setting. */
  detail?: string;
  busy?: boolean;
};

/** A grouped list of actions, as in an iOS action sheet or settings page. */
export function ActionList({
  actions,
  style,
}: {
  actions: (ListAction | null | false | undefined)[];
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const buzz = useHaptics();
  const rows = actions.filter((action): action is ListAction => !!action);
  if (!rows.length) return null;
  return (
    <View
      style={[
        {
          borderRadius: 18,
          // The same surface as cards, so grouped lists and cards read as one family.
          backgroundColor: theme.colors.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {rows.map((action, i) => {
        const tint = action.tone === 'danger' ? theme.danger : theme.colors.text;
        return (
          <View key={action.label}>
            {i ? <Divider inset={58} /> : null}
            <Pressable
              onPress={() => {
                if (action.busy) return;
                buzz('light');
                action.onPress();
              }}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              accessibilityState={{ busy: !!action.busy }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                minHeight: 52,
                paddingHorizontal: 14,
                paddingVertical: 10,
                backgroundColor: pressed ? theme.colors.border : 'transparent',
              })}
            >
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.colors.surfaceRaised,
                }}
              >
                <Ionicons name={action.icon} size={16} color={tint} />
              </View>
              <Text variant="subheading" style={{ flex: 1, color: tint, fontWeight: '600' }}>
                {action.label}
              </Text>
              {action.busy ? (
                <ActivityIndicator size="small" color={theme.colors.textDim} />
              ) : action.detail ? (
                <Text variant="caption" color="muted">
                  {action.detail}
                </Text>
              ) : null}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

// ---- States ---------------------------------------------------------------------------------

export function LoadingState({ label, style }: { label: string; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 }, style]}
    >
      <ActivityIndicator size="small" color={theme.accentText} />
      <Text variant="caption">{label}</Text>
    </View>
  );
}

type Tone = 'neutral' | 'accent' | 'warning' | 'danger' | 'locked';

export function Notice({
  tone = 'neutral',
  icon,
  title,
  children,
  action,
  onAction,
  style,
}: {
  tone?: Tone;
  icon?: IconName;
  title?: string;
  children?: ReactNode;
  action?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const tint = {
    neutral: theme.colors.textDim,
    accent: theme.accentText,
    warning: theme.warning,
    danger: theme.danger,
    locked: theme.locked,
  }[tone];
  const bg = {
    neutral: theme.colors.surface,
    accent: theme.accentSoft,
    warning: theme.warningSoft,
    danger: theme.dangerSoft,
    locked: theme.lockedSoft,
  }[tone];
  const fallbackIcon: IconName =
    tone === 'danger' ? 'alert-circle' : tone === 'warning' ? 'warning' : 'information-circle';
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      style={[
        {
          flexDirection: 'row',
          gap: 12,
          padding: 14,
          borderRadius: 18,
          backgroundColor: bg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: tone === 'neutral' ? theme.colors.border : alphaHex(tint, 0.4),
        },
        style,
      ]}
    >
      <Ionicons name={icon ?? fallbackIcon} size={18} color={tint} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text variant="subheading">{title}</Text> : null}
        {typeof children === 'string' ? (
          <Text variant="caption" color={title ? 'dim' : 'text'}>
            {children}
          </Text>
        ) : (
          children
        )}
        {action ? (
          <Pressable onPress={onAction} hitSlop={8} style={{ marginTop: 6 }}>
            <Text variant="caption" style={{ color: tint, fontWeight: '800' }}>
              {action}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
  style,
}: {
  message: string;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Notice
      tone="danger"
      action={onRetry ? 'Try again' : undefined}
      onAction={onRetry}
      style={style}
    >
      {message}
    </Notice>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  dashed,
  style,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  dashed?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          alignItems: 'center',
          padding: 22,
          borderRadius: 24,
          backgroundColor: dashed ? 'transparent' : theme.colors.surface,
          borderWidth: dashed ? 1.5 : StyleSheet.hairlineWidth,
          borderStyle: dashed ? 'dashed' : 'solid',
          borderColor: theme.colors.border,
        },
        style,
      ]}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: theme.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={22} color={theme.accentText} />
      </View>
      <Text variant="heading" style={{ marginTop: 14, textAlign: 'center' }}>
        {title}
      </Text>
      {typeof children === 'string' ? (
        <Text variant="body" color="dim" style={{ textAlign: 'center', marginTop: 6 }}>
          {children}
        </Text>
      ) : (
        children
      )}
      {action ? (
        <View style={{ alignSelf: 'stretch', marginTop: 18, gap: 10 }}>{action}</View>
      ) : null}
    </View>
  );
}

/** A screen title row with a back button, for pushed screens. */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  right?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        // The back arrow is a bare icon, so it sits closer to the edge; filled actions on the
        // right line up with the page's 20pt gutter.
        paddingLeft: 12,
        paddingRight: 20,
        paddingVertical: 6,
        gap: 4,
        backgroundColor: theme.colors.bg,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
      }}
    >
      <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={onBack} />
      <View style={{ flex: 1 }}>
        <Text variant="heading" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/** A headline number with its label and unit. */
export function Stat({
  label,
  value,
  unit,
  size = 24,
}: {
  label: string;
  value: string;
  unit?: string;
  size?: number;
}) {
  return (
    <View>
      <Text variant="label">{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: 3 }}>
        <Text
          variant="heading"
          numeric
          style={{ fontSize: size, lineHeight: size + 4, fontWeight: '800', letterSpacing: -0.6 }}
        >
          {value}
        </Text>
        {unit ? (
          <Text variant="caption" numeric>
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
