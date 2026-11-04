import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet } from '../components/BottomSheet';
import { CheckRow, ChoiceField, Field, FormSection, useLeaveGuard } from '../components/forms';
import { CoverageSummary, ZoneCards, zonesTitle } from '../components/PlanWidgets';
import {
  Badge,
  Button,
  ErrorState,
  LoadingState,
  Notice,
  Screen,
  ScreenHeader,
  SectionHeader,
  Text,
  useHaptics,
} from '../components/ui';
import type { BriefState } from '../data/plan-data';
import { api } from '../lib/api';
import { formatShortYear, METRES_PER_YARD, WEEKDAYS_LONG } from '../lib/format';
import { useRequestKey } from '../lib/request-key';
import { result } from '../lib/result';
import { BRIEF_SPORTS, SPORT_META, type BriefSport } from '../lib/sports';
import { useSportUnits, useTheme, useUnits } from '../state/settings';

type Brief = BriefState['brief'];
type Availability = Brief['weekdays'][number];
type Baseline = Brief['sports'][number];
type Answer = Baseline['currentSessions'];

const unanswered = { status: 'unanswered', value: null } as const;
/** A sport's baseline before any question is answered, matching the API's empty baseline. */
function emptyBaseline(sport: BriefSport): Baseline {
  const common = { currentSessions: unanswered, desiredSessions: null };
  if (sport === 'strength') return { sport, ...common };
  if (sport === 'cycle')
    return { sport, ...common, weeklyDuration: unanswered, longestDuration: unanswered };
  return { sport, ...common, weeklyDistance: unanswered, longestDistance: unanswered };
}
const SPORT_HEADINGS: Record<BriefSport, string> = {
  run: 'Running background',
  cycle: 'Cycling background',
  swim: 'Swimming background',
  strength: 'Strength background',
};
const NEXT_AVAILABILITY: Record<Availability, Availability> = {
  available: 'preferred',
  preferred: 'unavailable',
  unavailable: 'available',
};

/** The planning brief: the draft's editable inputs, or a locked version's, read-only. */
export default function BriefScreen() {
  const { planId = '', revisionId } = useLocalSearchParams<{
    planId: string;
    revisionId?: string;
  }>();
  const query = useQuery({
    queryKey: ['plans', planId, 'brief', revisionId],
    refetchOnWindowFocus: false,
    queryFn: async () =>
      revisionId
        ? result(
            await api.GET('/api/v1/plans/{planId}/revisions/{revisionId}/brief', {
              params: { path: { planId, revisionId } },
            }),
          )
        : result(
            await api.GET('/api/v1/plans/{planId}/draft/brief', { params: { path: { planId } } }),
          ),
  });
  if (!query.data)
    return (
      <Screen>
        <ScreenHeader title="Plan brief" onBack={() => router.back()} />
        <View style={{ padding: 20 }}>
          {query.error ? (
            <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
          ) : (
            <LoadingState label="Loading brief…" />
          )}
        </View>
      </Screen>
    );
  return (
    <BriefEditor
      key={`${query.data.versionId}:${query.data.editNumber}:${query.data.confirmed}`}
      state={query.data}
      planId={planId}
    />
  );
}

function BriefEditor({ state, planId }: { state: BriefState; planId: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const client = useQueryClient();
  const [brief, setBrief] = useState<Brief>(state.brief);
  const [editing, setEditing] = useState(!state.confirmed);
  const [review, setReview] = useState(false);
  const [ack, setAck] = useState<string[]>([]);
  const command = { expectedDraftId: state.versionId, expectedEditNumber: state.editNumber };
  const params = { path: { planId } };
  const dirty = JSON.stringify(brief) !== JSON.stringify(state.brief);
  const requestKey = useRequestKey();
  const units = useUnits(state.brief.unit);
  const { pool } = useSportUnits();
  const mutation = useMutation({
    mutationFn: async (action: 'save' | 'confirm') => {
      const idempotencyKey = requestKey([action, command, brief, ack]);
      const request = { ...command, idempotencyKey };
      if (action === 'save')
        return result(
          await api.PUT('/api/v1/plans/{planId}/draft/brief', {
            params,
            body: { ...request, brief },
          }),
        );
      return result(
        await api.POST('/api/v1/plans/{planId}/draft/brief/confirm', {
          params,
          body: { ...request, expectedHash: state.hash, acknowledgedWarningCodes: ack },
        }),
      );
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['plans'] });
      await client.invalidateQueries({ queryKey: ['plan-workouts'] });
    },
    onError: (_error, action) => {
      if (action === 'confirm') setReview(false);
    },
  });
  const leave = useLeaveGuard(dirty, { busy: mutation.isPending, what: 'brief changes' });
  const disabled = state.readOnly || !editing || mutation.isPending;
  const patch = <K extends keyof Brief>(key: K, value: Brief[K]) =>
    setBrief({ ...brief, [key]: value });
  const setSport = (sport: BriefSport, baseline: Baseline | null) => {
    const others = brief.sports.filter((current) => current.sport !== sport);
    const sports = baseline ? [...others, baseline] : others;
    patch(
      'sports',
      BRIEF_SPORTS.flatMap((key) => sports.filter((current) => current.sport === key)),
    );
  };
  const errors = state.findings.filter((f) => f.severity === 'error');
  const warnings = state.findings.filter((f) => f.severity === 'warning');
  const sports = brief.sports.map((baseline) => baseline.sport);

  const sportFields = (baseline: Baseline) => {
    const noun = SPORT_META[baseline.sport].noun;
    const update = (changes: Partial<Baseline>) =>
      setSport(baseline.sport, { ...baseline, ...changes } as Baseline);
    const distance =
      baseline.sport === 'swim'
        ? { unit: pool === 'yd' ? 'yd' : 'm', factor: pool === 'yd' ? METRES_PER_YARD : 1 }
        : {
            unit: brief.unit === 'miles' ? 'mi' : 'km',
            factor: brief.unit === 'miles' ? 1609.344 : 1000,
          };
    const hours = { unit: 'h', factor: 3600 };
    return (
      <FormSection key={baseline.sport} title={SPORT_HEADINGS[baseline.sport]}>
        <AnswerField
          label={`Current ${noun} sessions per week`}
          answer={baseline.currentSessions}
          onChange={(currentSessions) => update({ currentSessions })}
          disabled={disabled}
          whole
        />
        {baseline.sport === 'cycle' ? (
          <>
            <AnswerField
              label="Typical weekly riding time"
              answer={baseline.weeklyDuration}
              onChange={(weeklyDuration) => update({ weeklyDuration })}
              disabled={disabled}
              {...hours}
            />
            <AnswerField
              label="Longest recent ride"
              answer={baseline.longestDuration}
              onChange={(longestDuration) => update({ longestDuration })}
              disabled={disabled}
              {...hours}
            />
          </>
        ) : baseline.sport !== 'strength' ? (
          <>
            <AnswerField
              label={`Typical weekly ${noun} distance`}
              answer={baseline.weeklyDistance}
              onChange={(weeklyDistance) => update({ weeklyDistance })}
              disabled={disabled}
              {...distance}
            />
            <AnswerField
              label={baseline.sport === 'run' ? 'Longest recent run' : 'Longest recent swim'}
              answer={baseline.longestDistance}
              onChange={(longestDistance) => update({ longestDistance })}
              disabled={disabled}
              {...distance}
            />
          </>
        ) : null}
        <NumberField
          label={`Desired ${noun} sessions per week`}
          value={baseline.desiredSessions}
          onChange={(desiredSessions) => update({ desiredSessions })}
          disabled={disabled}
          whole
        />
      </FormSection>
    );
  };

  return (
    <Screen>
      <ScreenHeader
        title="Plan brief"
        subtitle={
          state.readOnly ? 'Locked version · read-only' : state.confirmed ? 'Confirmed' : 'Draft'
        }
        onBack={() => router.back()}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: insets.bottom + 40 }}
        >
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {state.readOnly ? (
                <Badge
                  label="Read-only version"
                  icon="lock-closed"
                  color={theme.locked}
                  background={theme.lockedSoft}
                />
              ) : null}
              {state.confirmed ? (
                <Badge
                  label="Brief confirmed"
                  icon="checkmark-circle"
                  color={theme.locked}
                  background={theme.lockedSoft}
                />
              ) : (
                <Badge
                  label="Brief needs confirmation"
                  icon="warning"
                  color={theme.warning}
                  background={theme.warningSoft}
                />
              )}
            </View>
            <Text variant="caption" numeric>
              {state.startDate ? formatShortYear(state.startDate) : 'No start date'} –{' '}
              {state.endDate ? formatShortYear(state.endDate) : 'no end date'}
              {!state.startDate || !state.endDate ? ' · set dates in plan details' : ''}
            </Text>
            {state.confirmed && !state.readOnly && !editing ? (
              <Button
                label="Edit brief"
                icon="create-outline"
                variant="secondary"
                size="md"
                onPress={() => setEditing(true)}
              />
            ) : null}
          </View>
          {state.scheduleReviewRequired ? (
            <Notice tone="warning">
              Planning inputs changed. Review the existing schedule before locking.
            </Notice>
          ) : null}
          {mutation.error ? (
            <Notice
              tone="danger"
              action={mutation.variables === 'confirm' ? 'Refresh latest brief' : undefined}
              onAction={() =>
                void client.invalidateQueries({ queryKey: ['plans', planId, 'brief'] })
              }
            >
              {mutation.error.message}
            </Notice>
          ) : null}

          <FormSection title="Goal">
            <Field
              label="Goal"
              value={brief.goal}
              onChangeText={(goal) => patch('goal', goal)}
              placeholder="What would you like this plan to help you achieve?"
              multiline
              disabled={disabled}
            />
            <ChoiceField
              label="Units"
              value={brief.unit}
              onChange={(unit) => patch('unit', unit)}
              disabled={disabled}
              options={[
                { value: 'kilometres', label: 'Kilometres · min/km' },
                { value: 'miles', label: 'Miles · min/mile' },
              ]}
            />
          </FormSection>

          <FormSection title="Sports" description="Choose every sport this plan trains.">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {BRIEF_SPORTS.map((sport) => {
                const selected = brief.sports.some((current) => current.sport === sport);
                return (
                  <ToggleChip
                    key={sport}
                    label={SPORT_META[sport].label}
                    icon={SPORT_META[sport].icon}
                    selected={selected}
                    disabled={disabled}
                    onPress={() => setSport(sport, selected ? null : emptyBaseline(sport))}
                  />
                );
              })}
            </View>
          </FormSection>

          {brief.sports.map(sportFields)}

          <FormSection
            title="Weekly availability"
            description="Tap a day to cycle between available, preferred and unavailable. Up to two sessions can be scheduled on each allowed day."
          >
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {WEEKDAYS_LONG.map((day, i) => (
                <WeekdayChip
                  key={day}
                  day={day}
                  value={brief.weekdays[i]!}
                  disabled={disabled}
                  onPress={() =>
                    patch(
                      'weekdays',
                      brief.weekdays.map((current, j) =>
                        i === j ? NEXT_AVAILABILITY[current] : current,
                      ),
                    )
                  }
                />
              ))}
            </View>
          </FormSection>

          <FormSection title="Constraints and context">
            <Field
              label="Anything else the planner should consider"
              value={brief.context}
              onChangeText={(context) => patch('context', context)}
              placeholder="Other activities, preferences or limitations"
              multiline
              disabled={disabled}
            />
          </FormSection>

          <View style={{ marginHorizontal: -20, marginTop: -24 }}>
            <SectionHeader
              title={zonesTitle(sports)}
              action="Update"
              onAction={() => router.push('/performance')}
            />
            <ZoneCards sports={sports} units={units} showSource />
            <Text variant="caption" color="muted" style={{ marginTop: 10, marginHorizontal: 20 }}>
              Zones belong to you and apply to every plan, so they are not part of this brief.
            </Text>
          </View>

          <FormSection title="Brief readiness">
            {state.findings.length === 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="checkmark-circle" size={17} color={theme.locked} />
                <Text variant="caption" color="text">
                  All required information is complete.
                </Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {[...errors, ...warnings].map((finding) => (
                  <View key={finding.code} style={{ flexDirection: 'row', gap: 8 }}>
                    <Ionicons
                      name={finding.severity === 'error' ? 'alert-circle' : 'warning'}
                      size={16}
                      color={finding.severity === 'error' ? theme.danger : theme.warning}
                      style={{ marginTop: 1 }}
                    />
                    <Text variant="caption" color="text" style={{ flex: 1 }}>
                      {finding.severity === 'error' ? 'Required: ' : 'Review: '}
                      {finding.message}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            {!state.readOnly && !state.confirmed ? (
              <Button
                label="Review brief for confirmation"
                icon="clipboard-outline"
                size="md"
                disabled={dirty || mutation.isPending || errors.length > 0}
                onPress={() => setReview(true)}
              />
            ) : null}
            {dirty && !state.confirmed ? (
              <Text variant="caption" color="muted">
                Save your changes before confirming.
              </Text>
            ) : null}
          </FormSection>

          <FormSection title="Prescribed schedule">
            <CoverageSummary state={state} />
          </FormSection>
        </ScrollView>

        {!disabled || (dirty && mutation.isPending) ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingHorizontal: 20,
              paddingTop: 12,
              paddingBottom: Math.max(insets.bottom, 12),
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
            }}
          >
            <Text variant="caption" color={dirty ? 'text' : 'muted'} style={{ flex: 1 }}>
              {dirty ? 'Unsaved changes' : 'All changes saved'}
            </Text>
            <Button
              label="Save changes"
              icon="save-outline"
              size="md"
              disabled={!dirty}
              busy={mutation.isPending && mutation.variables === 'save'}
              onPress={() => mutation.mutate('save')}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <BottomSheet
        visible={review}
        onClose={() => !mutation.isPending && setReview(false)}
        title="Confirm your planning inputs"
      >
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10 }}>
          <Text variant="body" color="dim">
            Review the goal, availability and training background. These are the inputs your plan
            will use. Only you can confirm them.
          </Text>
          {warnings.length ? (
            warnings.map((finding) => (
              <CheckRow
                key={finding.code}
                checked={ack.includes(finding.code)}
                onToggle={() =>
                  setAck(
                    ack.includes(finding.code)
                      ? ack.filter((code) => code !== finding.code)
                      : [...ack, finding.code],
                  )
                }
                label={finding.message}
              />
            ))
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="checkmark-circle" size={17} color={theme.locked} />
              <Text variant="caption" color="text">
                No warnings to acknowledge.
              </Text>
            </View>
          )}
        </ScrollView>
        <View style={{ gap: 10, marginTop: 18 }}>
          <Button
            label="Confirm brief"
            icon="checkmark-done"
            busy={mutation.isPending}
            disabled={dirty || warnings.some((f) => !ack.includes(f.code))}
            onPress={() => mutation.mutate('confirm', { onSuccess: () => setReview(false) })}
          />
          <Button
            label="Keep editing"
            variant="ghost"
            disabled={mutation.isPending}
            onPress={() => setReview(false)}
          />
        </View>
      </BottomSheet>
      {leave.sheet}
    </Screen>
  );
}

// ---- Inputs -------------------------------------------------------------------------------------

/** A number typed as text: the text is kept while typing, the number is sent upward. */
function NumberField({
  label,
  value,
  onChange,
  disabled,
  whole,
  suffix,
  hideLabel,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  whole?: boolean;
  suffix?: string;
  hideLabel?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  return (
    <Field
      label={label}
      hideLabel={hideLabel}
      value={text}
      suffix={suffix}
      disabled={disabled}
      keyboardType={whole ? 'number-pad' : 'decimal-pad'}
      onChangeText={(next) => {
        const cleaned = next.replace(',', '.');
        setText(cleaned);
        if (cleaned.trim() === '') onChange(null);
        else if (!Number.isNaN(Number(cleaned))) onChange(Number(cleaned));
      }}
    />
  );
}

/** One baseline answer: known with a value in display units, unknown, or not answered. */
function AnswerField({
  label,
  answer,
  onChange,
  disabled,
  unit,
  factor = 1,
  whole,
}: {
  label: string;
  answer: Answer;
  onChange: (answer: Answer) => void;
  disabled: boolean;
  unit?: string;
  factor?: number;
  whole?: boolean;
}) {
  return (
    <View style={{ gap: 10 }}>
      <ChoiceField<Answer['status']>
        label={label}
        value={answer.status}
        disabled={disabled}
        onChange={(status) =>
          onChange(
            status === 'known'
              ? { status: 'known', value: answer.status === 'known' ? answer.value : 0 }
              : { status, value: null },
          )
        }
        options={[
          { value: 'known', label: 'Known' },
          { value: 'unknown', label: 'Unknown' },
          { value: 'unanswered', label: 'Not answered' },
        ]}
      />
      {answer.status === 'known' ? (
        <NumberField
          // Changing units converts the stored value, so the typed text starts again from it.
          key={`${unit}:${factor}`}
          label={`${label}${unit ? ` (${unit})` : ''}`}
          hideLabel
          value={Number((answer.value / factor).toFixed(6))}
          onChange={(value) => onChange({ status: 'known', value: (value ?? 0) * factor })}
          disabled={disabled}
          whole={whole}
          suffix={unit}
        />
      ) : null}
    </View>
  );
}

function ToggleChip({
  label,
  icon,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const buzz = useHaptics();
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        buzz('select');
        onPress();
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        minHeight: 42,
        borderRadius: 21,
        opacity: disabled ? 0.5 : 1,
        backgroundColor: selected ? theme.accentSoft : theme.colors.surfaceRaised,
        borderWidth: 1.5,
        borderColor: selected ? theme.accent : 'transparent',
      }}
    >
      <Ionicons name={icon} size={16} color={selected ? theme.accentText : theme.colors.textDim} />
      <Text
        variant="caption"
        style={{
          color: selected ? theme.accentText : theme.colors.text,
          fontWeight: selected ? '800' : '600',
        }}
      >
        {label}
      </Text>
      {selected ? <Ionicons name="checkmark" size={14} color={theme.accentText} /> : null}
    </Pressable>
  );
}

function WeekdayChip({
  day,
  value,
  disabled,
  onPress,
}: {
  day: string;
  value: Availability;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const buzz = useHaptics();
  const look = {
    preferred: { bg: theme.accent, fg: theme.onAccent, border: theme.accent, mark: '★' },
    available: {
      bg: theme.colors.surfaceRaised,
      fg: theme.colors.text,
      border: 'transparent',
      mark: '',
    },
    unavailable: {
      bg: 'transparent',
      fg: theme.colors.textMuted,
      border: theme.colors.border,
      mark: '–',
    },
  }[value];
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        buzz('select');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${day}: ${value}`}
      style={{
        flex: 1,
        alignItems: 'center',
        paddingVertical: 10,
        borderRadius: 14,
        gap: 2,
        backgroundColor: look.bg,
        borderWidth: 1.5,
        borderColor: look.border,
        borderStyle: value === 'unavailable' ? 'dashed' : 'solid',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Text variant="caption" style={{ color: look.fg, fontWeight: '800' }}>
        {day.slice(0, 1)}
      </Text>
      <Text variant="label" style={{ color: look.fg, fontSize: 9, letterSpacing: 0.3 }}>
        {value === 'preferred' ? 'Pref' : value === 'available' ? 'Yes' : 'No'}
      </Text>
    </Pressable>
  );
}
