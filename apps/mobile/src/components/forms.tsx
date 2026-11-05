import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation, usePreventRemove } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  formatLong,
  formatMonth,
  formatShortYear,
  localToday,
  monthGrid,
  shiftMonth,
  WEEKDAYS_SHORT,
} from '../lib/format';
import { useTheme } from '../state/settings';
import { BottomSheet } from './BottomSheet';
import { Button, IconButton, Text, useHaptics, type IconName } from './ui';

// ---- Screen chrome ------------------------------------------------------------------------------

/** Back to the previous screen, or to Today when the screen was opened directly (a link). */
export const leaveScreen = () => (router.canGoBack() ? router.back() : router.replace('/'));

/**
 * A modal form: Cancel on the left, the title, and Save on the right, as in iOS. With a `guard`
 * (see useLeaveGuard), leaving with unsaved changes (Cancel, the back button or a swipe) asks
 * first, and leaving is blocked while a save is in flight.
 */
export function FormScreen({
  title,
  subtitle,
  guard,
  cancelLabel = 'Cancel',
  saveLabel = 'Save',
  canSave = true,
  saving = false,
  onSave,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  guard?: LeaveGuard;
  /** The left button, which leaves the screen. */
  cancelLabel?: string;
  saveLabel?: string;
  canSave?: boolean;
  saving?: boolean;
  onSave?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const enabled = canSave && !saving;
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View
        style={{
          paddingTop: Platform.OS === 'ios' ? 14 : insets.top + 8,
          paddingBottom: 10,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <Pressable
          onPress={leaveScreen}
          disabled={saving}
          hitSlop={10}
          accessibilityRole="button"
          style={{ minWidth: 76, paddingHorizontal: 6, paddingVertical: 6 }}
        >
          <Text variant="subheading" color="dim" style={{ opacity: saving ? 0.4 : 1 }}>
            {cancelLabel}
          </Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="subheading" numberOfLines={1} style={{ fontWeight: '700' }}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="caption" color="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={{ minWidth: 76, alignItems: 'flex-end' }}>
          {onSave ? (
            <Pressable
              onPress={enabled ? onSave : undefined}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={saveLabel}
              accessibilityState={{ disabled: !enabled, busy: saving }}
              style={{ paddingHorizontal: 6, paddingVertical: 6 }}
            >
              {saving ? (
                <ActivityIndicator size="small" color={theme.accentText} />
              ) : (
                <Text
                  variant="subheading"
                  style={{
                    color: enabled ? theme.accentText : theme.colors.textMuted,
                    fontWeight: '800',
                  }}
                >
                  {saveLabel}
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: insets.bottom + 40 }}
        >
          {children}
        </ScrollView>
        {footer ? (
          <View
            style={{
              paddingHorizontal: 20,
              paddingTop: 12,
              paddingBottom: Math.max(insets.bottom, 12),
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
              backgroundColor: theme.colors.bg,
            }}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
      {guard?.sheet}
    </View>
  );
}

export type LeaveGuard = {
  /** The "Leave without saving?" sheet; render it once on the screen. */
  sheet: ReactNode;
  /** Leave on purpose (after a successful save): the guard steps aside for `navigate`. */
  exit: (navigate: () => void) => void;
};

/**
 * Keeps unsaved edits from vanishing: while `dirty`, leaving the screen asks first; while `busy`
 * (a save in flight) leaving is blocked, so a late success can't navigate away from the wrong
 * screen. The dismiss gesture is off in both cases.
 */
export function useLeaveGuard(
  dirty: boolean,
  { busy = false, what = 'changes' }: { busy?: boolean; what?: string } = {},
): LeaveGuard {
  const navigation = useNavigation();
  const [pending, setPending] = useState<(() => void) | null>(null);
  // Set once the screen is leaving on purpose (a save, or "Leave without saving").
  const [released, setReleased] = useState(false);
  const blocked = (dirty || busy) && !released;
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !blocked });
  }, [navigation, blocked]);
  const allow = usePreventRemove(blocked, ({ repeat }) => {
    if (!busy) setPending(() => repeat);
  });
  const exit = (navigate: () => void) => {
    setReleased(true);
    allow();
    navigate();
  };
  const sheet = (
    <BottomSheet visible={!!pending} onClose={() => setPending(null)} title="Leave without saving?">
      <Text variant="body" color="dim">
        Your unsaved {what} will be lost.
      </Text>
      <View style={{ gap: 10, marginTop: 20 }}>
        <Button
          label="Leave without saving"
          variant="danger"
          onPress={() => {
            const proceed = pending;
            setReleased(true);
            setPending(null);
            proceed?.();
          }}
        />
        <Button label="Keep editing" variant="ghost" onPress={() => setPending(null)} />
      </View>
    </BottomSheet>
  );
  return { sheet, exit };
}

// ---- Groups and fields --------------------------------------------------------------------------

/** A titled group of fields on a card, like a settings section. */
export function FormSection({
  title,
  description,
  children,
  right,
  style,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View style={style}>
      {title || right ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
            paddingHorizontal: 4,
          }}
        >
          {title ? <Text variant="label">{title}</Text> : <View />}
          {right}
        </View>
      ) : null}
      <View
        style={{
          borderRadius: 20,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: 16,
          gap: 16,
        }}
      >
        {description ? (
          <Text variant="caption" color="dim">
            {description}
          </Text>
        ) : null}
        {children}
      </View>
    </View>
  );
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <View style={{ gap: 2, marginBottom: 8 }}>
      <Text variant="caption" color="text" style={{ fontWeight: '700' }}>
        {label}
      </Text>
      {hint ? (
        <Text variant="caption" color="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function useFieldStyle(focused: boolean, disabled?: boolean) {
  const theme = useTheme();
  return {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: theme.colors.surfaceRaised,
    borderWidth: 1.5,
    borderColor: focused ? theme.accent : 'transparent',
    opacity: disabled ? 0.5 : 1,
  } satisfies ViewStyle;
}

/** A labelled text input. */
export function Field({
  label,
  hint,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  disabled,
  maxLength,
  suffix,
  autoFocus,
  secure,
  autoCapitalize,
  hideLabel,
  style,
}: {
  label: string;
  /** Keep the label for screen readers only, when a nearby heading already names the field. */
  hideLabel?: boolean;
  hint?: string;
  value: string;
  onChangeText: (value: string) => void;
  /** A password: hidden, never autocorrected. */
  secure?: boolean;
  /** Overrides the keyboard's capitalisation, for example to type a confirmation word. */
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  disabled?: boolean;
  maxLength?: number;
  suffix?: string;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const box = useFieldStyle(focused, disabled);
  return (
    <View style={style}>
      {hideLabel ? null : <FieldLabel label={label} hint={hint} />}
      <View
        style={[box, { flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center' }]}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          editable={!disabled}
          multiline={multiline}
          keyboardType={keyboardType}
          maxLength={maxLength}
          autoFocus={autoFocus}
          secureTextEntry={secure}
          autoCapitalize={autoCapitalize ?? (secure ? 'none' : undefined)}
          autoCorrect={secure || autoCapitalize ? false : undefined}
          accessibilityLabel={label}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          selectionColor={theme.accent}
          style={{
            flex: 1,
            // Lets a narrow field shrink below the web input's intrinsic width, keeping its suffix.
            minWidth: 0,
            color: theme.colors.text,
            fontSize: 16,
            paddingVertical: multiline ? 12 : 0,
            minHeight: multiline ? 96 : 46,
            textAlignVertical: multiline ? 'top' : 'center',
            // Web inputs draw their own focus ring.
            ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
          }}
        />
        {suffix ? (
          <Text variant="caption" color="muted" style={{ marginLeft: 8 }}>
            {suffix}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** A choice among a few options, as wrapping chips (a native-feeling `select`). */
export function ChoiceField<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  disabled,
}: {
  label?: string;
  hint?: string;
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const buzz = useHaptics();
  return (
    <View style={{ opacity: disabled ? 0.5 : 1 }}>
      {label ? <FieldLabel label={label} hint={hint} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              disabled={disabled}
              onPress={() => {
                buzz('select');
                onChange(option.value);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 14,
                minHeight: 38,
                borderRadius: 19,
                backgroundColor: selected ? theme.accentSoft : theme.colors.surfaceRaised,
                borderWidth: 1.5,
                borderColor: selected ? theme.accent : 'transparent',
              }}
            >
              {option.icon ? (
                <Ionicons
                  name={option.icon}
                  size={15}
                  color={selected ? theme.accentText : theme.colors.textDim}
                />
              ) : null}
              <Text
                variant="caption"
                style={{
                  color: selected ? theme.accentText : theme.colors.text,
                  fontWeight: selected ? '800' : '600',
                }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Wrapping chips that can be cleared: tap a chosen chip again to unselect it. `selected` decides
 * which are on, so the same group serves one optional answer or several.
 */
export function Chips<T extends string>({
  label,
  options,
  selected,
  onPress,
  disabled,
}: {
  /** For screen readers; a visible heading usually names the group. */
  label: string;
  options: readonly (readonly [T, string])[];
  selected: (value: T) => boolean;
  onPress: (value: T) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const buzz = useHaptics();
  return (
    <View
      accessibilityLabel={label}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, opacity: disabled ? 0.5 : 1 }}
    >
      {options.map(([value, text]) => {
        const on = selected(value);
        return (
          <Pressable
            key={value}
            disabled={disabled}
            onPress={() => {
              buzz('select');
              onPress(value);
            }}
            accessibilityRole="checkbox"
            accessibilityLabel={text}
            accessibilityState={{ checked: on, disabled }}
            style={{
              paddingHorizontal: 14,
              minHeight: 38,
              justifyContent: 'center',
              borderRadius: 19,
              backgroundColor: on ? theme.accentSoft : theme.colors.surfaceRaised,
              borderWidth: 1.5,
              borderColor: on ? theme.accent : 'transparent',
            }}
          >
            <Text
              variant="caption"
              style={{
                color: on ? theme.accentText : theme.colors.text,
                fontWeight: on ? '800' : '600',
              }}
            >
              {text}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A tappable checkbox row. */
export function CheckRow({
  checked,
  onToggle,
  label,
  sub,
  disabled,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  sub?: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const buzz = useHaptics();
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        buzz('select');
        onToggle();
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        borderRadius: 18,
        backgroundColor: theme.colors.surfaceRaised,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 9,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: checked ? theme.accent : 'transparent',
          borderWidth: 2,
          borderColor: checked ? theme.accent : theme.colors.textMuted,
        }}
      >
        {checked ? <Ionicons name="checkmark" size={16} color={theme.onAccent} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="subheading">{label}</Text>
        {sub ? <Text variant="caption">{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

// ---- Dates --------------------------------------------------------------------------------------

/** A date that opens a month calendar; the same on iOS, Android and the web build. */
export function DateField({
  label,
  value,
  onChange,
  min,
  max,
  placeholder = 'Select date',
  disabled,
  clearable,
  style,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const box = useFieldStyle(open, disabled);
  return (
    <View style={style}>
      <FieldLabel label={label} />
      <Pressable
        disabled={disabled}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? formatLong(value) : 'not set'}`}
        style={[box, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}
      >
        <Ionicons name="calendar-outline" size={17} color={theme.colors.textDim} />
        <Text
          variant="body"
          numeric
          numberOfLines={1}
          style={{ flex: 1, color: value ? theme.colors.text : theme.colors.textMuted }}
        >
          {value ? formatShortYear(value) : placeholder}
        </Text>
      </Pressable>
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
        <MonthPicker
          value={value || null}
          min={min}
          max={max}
          onPick={(date) => {
            onChange(date);
            setOpen(false);
          }}
        />
        {clearable && value ? (
          <Button
            label="Clear date"
            variant="ghost"
            size="md"
            style={{ marginTop: 12 }}
            onPress={() => {
              onChange('');
              setOpen(false);
            }}
          />
        ) : null}
      </BottomSheet>
    </View>
  );
}

function MonthPicker({
  value,
  min,
  max,
  onPick,
}: {
  value: string | null;
  min?: string;
  max?: string;
  onPick: (date: string) => void;
}) {
  const theme = useTheme();
  const buzz = useHaptics();
  const today = localToday();
  const [month, setMonth] = useState((value ?? today).slice(0, 7) + '-01');
  const grid = monthGrid(month);
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <Text variant="subheading" style={{ flex: 1, fontWeight: '700' }}>
          {formatMonth(month)}
        </Text>
        <IconButton
          icon="chevron-back"
          size={18}
          accessibilityLabel="Previous month"
          onPress={() => setMonth(shiftMonth(month, -1))}
        />
        <IconButton
          icon="chevron-forward"
          size={18}
          accessibilityLabel="Next month"
          onPress={() => setMonth(shiftMonth(month, 1))}
        />
      </View>
      <View style={{ flexDirection: 'row', marginBottom: 4 }}>
        {WEEKDAYS_SHORT.map((day) => (
          <Text key={day} variant="label" style={{ flex: 1, textAlign: 'center', fontSize: 10 }}>
            {day.slice(0, 1)}
          </Text>
        ))}
      </View>
      {grid.map((week) => (
        <View key={week[0]} style={{ flexDirection: 'row' }}>
          {week.map((date) => {
            const inMonth = date.slice(0, 7) === month.slice(0, 7);
            const blocked = (!!min && date < min) || (!!max && date > max);
            const selected = date === value;
            const isToday = date === today;
            return (
              <Pressable
                key={date}
                disabled={blocked}
                onPress={() => {
                  buzz('select');
                  onPick(date);
                }}
                accessibilityRole="button"
                accessibilityLabel={formatLong(date)}
                accessibilityState={{ selected, disabled: blocked }}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 3 }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: selected ? theme.accent : 'transparent',
                    borderWidth: isToday && !selected ? 1.5 : 0,
                    borderColor: theme.accentBorder,
                  }}
                >
                  <Text
                    variant="body"
                    numeric
                    style={{
                      fontWeight: selected || isToday ? '800' : '500',
                      color: selected
                        ? theme.onAccent
                        : blocked
                          ? theme.colors.border
                          : inMonth
                            ? theme.colors.text
                            : theme.colors.textMuted,
                    }}
                  >
                    {Number(date.slice(8))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
