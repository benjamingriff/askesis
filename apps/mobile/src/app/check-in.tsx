import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import {
  Chips,
  Field,
  FormScreen,
  FormSection,
  leaveScreen,
  useLeaveGuard,
} from '../components/forms';
import { Button, ErrorState, LoadingState, Notice, Screen, Text } from '../components/ui';
import { useAskIcon, useCoachWord, useInAppCoach } from '../data/account';
import { planVersion, usePlan, useWorkouts } from '../data/plan-data';
import {
  CHECK_IN_LABELS,
  openConversation,
  useCreateCheckIn,
  useDiscussFeedback,
  type CheckInInput,
} from '../data/training-log';
import { addDays, formatLong } from '../lib/format';
import { useLocalToday } from '../lib/use-local-today';
import { useTheme } from '../state/settings';

// The web app's check-in dialog (CheckInSheet in apps/web/src/components/TrainingLog.tsx).

type Details = CheckInInput['details'];

function Question({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 2 }}>
        <Text variant="subheading" style={{ fontWeight: '700' }}>
          {title}
        </Text>
        {hint ? (
          <Text variant="caption" color="muted">
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** One required answer among chips. */
function Pick<T extends string>({
  label,
  value,
  values,
  onChange,
  optional = false,
}: {
  label: string;
  value: T | undefined;
  values: readonly (readonly [T, string])[];
  onChange: (value: T | undefined) => void;
  optional?: boolean;
}) {
  return (
    <Chips
      label={label}
      options={values}
      selected={(v) => v === value}
      onPress={(v) => onChange(optional && v === value ? undefined : v)}
    />
  );
}

export default function CheckInScreen() {
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const plan = usePlan(planId ?? null);
  if (!plan.data)
    return (
      <Screen>
        <View style={{ padding: 20 }}>
          {plan.error ? (
            <ErrorState message={plan.error.message} onRetry={() => void plan.refetch()} />
          ) : (
            <LoadingState label="Loading plan…" />
          )}
        </View>
      </Screen>
    );
  return <CheckInForm plan={plan.data} />;
}

function CheckInForm({ plan }: { plan: NonNullable<ReturnType<typeof usePlan>['data']> }) {
  const theme = useTheme();
  const coach = useCoachWord();
  const askIcon = useAskIcon();
  const inAppCoach = useInAppCoach();
  const today = useLocalToday();
  const workouts = useWorkouts(planVersion(plan, 'locked')).data ?? [];
  const [kind, setKind] = useState<CheckInInput['kind']>('run_down');
  const [duration, setDuration] = useState<'3' | '7' | '14' | 'unsure'>('7');
  const [details, setDetails] = useState<Details>({ preference: 'coach', returnStyle: 'balanced' });
  const [saved, setSaved] = useState<{ id: string } | null>(null);
  const create = useCreateCheckIn();
  const discuss = useDiscussFeedback({ id: plan.id, name: plan.displayName });
  const busy = create.isPending || discuss.isPending;
  // Leaving is blocked while sending, so a late success can't navigate from another screen.
  const guard = useLeaveGuard(false, { busy });
  const amend = <K extends keyof Details>(name: K, value: Details[K]) => {
    setSaved(null);
    setDetails((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[name];
      else next[name] = value;
      return next;
    });
  };
  const until = duration === 'unsure' ? null : addDays(today, Number(duration) - 1);
  const affected = workouts.filter(
    (w) =>
      w.priority === 'high' && w.scheduledDate >= today && (!until || w.scheduledDate <= until),
  );
  const safety =
    details.symptoms === 'fever' ||
    details.symptoms === 'below_neck' ||
    details.symptoms === 'chest_pain' ||
    (kind === 'pain' && details.painSeverity && details.painSeverity !== 'mild');
  const send = async () => {
    try {
      const check =
        saved ??
        (await create.mutateAsync({
          planId: plan.id,
          kind,
          startsOn: today,
          endsOn: until,
          details,
        }));
      setSaved(check);
      const request = {
        content: `I’m not feeling 100%: ${kind.replaceAll('_', ' ')}. Please help me adjust upcoming training.${details.note ? ` ${details.note}` : ''}`,
        reference: { type: 'check_in' as const, checkInId: check.id },
      };
      // Without the in-app coach this shows the prompt for the athlete's own agent.
      if (!inAppCoach)
        return guard.exit(() => {
          leaveScreen();
          discuss.mutate(request);
        });
      const id = await discuss.mutateAsync(request);
      guard.exit(() => {
        leaveScreen();
        if (id) openConversation(id);
      });
    } catch {
      /* The error shows below; a saved check-in is reused on retry. */
    }
  };
  const error = create.error ?? discuss.error;

  return (
    <FormScreen
      title="Not feeling 100%"
      guard={guard}
      saving={busy}
      footer={
        <Button
          label={coach === 'coach' ? 'Ask your coach to adjust' : 'Prepare request for your agent'}
          icon={askIcon}
          busy={busy}
          onPress={() => void send()}
        />
      }
    >
      <Text variant="body" color="dim">
        {coach === 'coach'
          ? 'Tell your coach what’s going on. Your plan stays unchanged until you review an amendment.'
          : 'Say what’s going on and Waddle prepares a request to paste into your agent. Your plan stays unchanged until you review an amendment.'}
      </Text>
      {error ? (
        <ErrorState message={`${saved ? 'Your check-in is saved. ' : ''}${error.message}`} />
      ) : null}
      <FormSection>
        <Question title="What’s going on?">
          <Pick
            label="Check-in reason"
            value={kind}
            values={Object.entries(CHECK_IN_LABELS) as [CheckInInput['kind'], string][]}
            onChange={(v) => {
              if (!v) return;
              setKind(v);
              setSaved(null);
              setDetails((p) => ({
                preference: p.preference,
                returnStyle: p.returnStyle,
                ...(p.note ? { note: p.note } : {}),
              }));
            }}
          />
        </Question>
        {kind === 'ill' ? (
          <Question title="How are you feeling?">
            <Pick
              optional
              label="Illness symptoms"
              value={details.symptoms}
              values={[
                ['above_neck', 'Above the neck'],
                ['below_neck', 'Chest or below the neck'],
                ['fever', 'Fever'],
                ['chest_pain', 'Chest pain'],
              ]}
              onChange={(v) => amend('symptoms', v)}
            />
          </Question>
        ) : null}
        {kind === 'pain' ? (
          <>
            <Question title="Where is the pain?">
              <Pick
                optional
                label="Pain area"
                value={details.painArea}
                values={[
                  ['foot', 'Foot'],
                  ['ankle', 'Ankle'],
                  ['calf', 'Calf'],
                  ['knee', 'Knee'],
                  ['hip', 'Hip'],
                  ['back', 'Back'],
                  ['shoulder', 'Shoulder'],
                  ['other', 'Other'],
                ]}
                onChange={(v) => amend('painArea', v)}
              />
            </Question>
            <Question title="How bad?">
              <Pick
                optional
                label="Pain severity"
                value={details.painSeverity}
                values={[
                  ['mild', 'Mild · moved normally'],
                  ['changed_movement', 'Changed how I moved'],
                  ['stopped', 'Had to stop'],
                ]}
                onChange={(v) => amend('painSeverity', v)}
              />
            </Question>
          </>
        ) : null}
        {safety ? (
          <Notice tone="warning">
            Rest and seek professional advice for fever, chest symptoms or pain that changes
            movement. For chest pain or severe symptoms, seek urgent medical help.
          </Notice>
        ) : null}
      </FormSection>

      <FormSection>
        <Question title="Adjust training for">
          <Pick
            label="Check-in duration"
            value={duration}
            values={[
              ['3', '3 days'],
              ['7', '1 week'],
              ['14', '2 weeks'],
              ['unsure', 'Unsure'],
            ]}
            onChange={(v) => {
              if (!v) return;
              setDuration(v);
              setSaved(null);
            }}
          />
        </Question>
        <Question title="What would help?">
          <Pick
            label="Training preference"
            value={details.preference}
            values={[
              ['easy', 'Easy sessions only'],
              ['shorter', 'Shorter sessions'],
              ['rest', 'Rest completely'],
              ['coach', `Let my ${coach} decide`],
            ]}
            onChange={(v) => v && amend('preference', v)}
          />
        </Question>
        <Question title="Getting back to it" hint="How fast to build back to your normal training">
          <Pick
            label="Return style"
            value={details.returnStyle}
            values={[
              ['gently', 'Gently'],
              ['balanced', 'Balanced'],
              ['quickly', 'Quickly'],
            ]}
            onChange={(v) => v && amend('returnStyle', v)}
          />
        </Question>
      </FormSection>

      {affected.length ? (
        <FormSection title="Key sessions in this window">
          {affected.map((w) => (
            <View key={w.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <View
                style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.accentText }}
              />
              <Text variant="caption" color="text" style={{ flex: 1 }}>
                {formatLong(w.scheduledDate)} · {w.title}
              </Text>
            </View>
          ))}
        </FormSection>
      ) : null}

      <FormSection>
        <Question title="Anything else?" hint="Optional">
          <Field
            label="Anything else?"
            hideLabel
            placeholder="For example, a race you want to protect"
            value={details.note ?? ''}
            multiline
            maxLength={2000}
            onChangeText={(value) => amend('note', value || undefined)}
          />
        </Question>
      </FormSection>
    </FormScreen>
  );
}
