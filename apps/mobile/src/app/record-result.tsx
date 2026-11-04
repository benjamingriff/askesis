import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  CheckRow,
  ChoiceField,
  DateField,
  Field,
  FormScreen,
  FormSection,
  useLeaveGuard,
} from '../components/forms';
import { ErrorState, Text } from '../components/ui';
import { usePerformance } from '../data/plan-data';
import type { components } from '../lib/api-types';
import { api } from '../lib/api';
import { localToday, METRES_PER_MILE, METRES_PER_YARD } from '../lib/format';
import { useRequestKey } from '../lib/request-key';
import { result } from '../lib/result';
import { SYSTEM_META, type System } from '../lib/sports';
import { useSportUnits, useUnits } from '../state/settings';

type RecordCalibration = components['schemas']['RecordCalibration'];

const KILOMETRES_PER_MILE = 1.609344;

/** "mm:ss" or "hh:mm:ss" → seconds. */
export function parseClock(value: string): number {
  if (!/^\d+:\d{2}(?::\d{2})?$/.test(value.trim()))
    throw new Error('Enter a time as mm:ss or hh:mm:ss.');
  const parts = value.trim().split(':').map(Number);
  if (parts.slice(1).some((part) => part >= 60))
    throw new Error('Seconds and minutes within a time must be below 60.');
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/**
 * Record a result for one system. New zones apply from today in every plan; earlier workouts keep
 * the zones they had.
 */
export default function RecordResultScreen() {
  const { system = 'run_pace' } = useLocalSearchParams<{ system?: System }>();
  const client = useQueryClient();
  const requestKey = useRequestKey();
  const performance = usePerformance();
  const today = performance.data?.today ?? localToday();
  const mutation = useMutation({
    // Inputs are parsed inside the mutation so a malformed time shows as a form error.
    mutationFn: async (build: () => RecordCalibration) => {
      const body = build();
      const state = result(
        await api.POST('/api/v1/performance/calibrations', {
          body: { ...body, idempotencyKey: requestKey(body) },
        }),
      );
      // The same result may be recorded again later (after a different one, or a withdrawal).
      requestKey.settle(body);
      return state;
    },
    onSuccess: async (state) => {
      client.setQueryData(['performance'], state);
      await client.invalidateQueries({ queryKey: ['plan-workouts'] });
    },
  });
  const props = { today, mutation };
  return system === 'cycle_power' ? (
    <PowerForm {...props} />
  ) : system === 'swim_pace' ? (
    <SwimForm {...props} />
  ) : (
    <RunForm {...props} />
  );
}

type FormProps = {
  today: string;
  mutation: ReturnType<typeof useMutation<unknown, Error, () => RecordCalibration>>;
};

function Shell({
  system,
  description,
  dirty,
  canSave,
  mutation,
  onSave,
  children,
}: {
  system: System;
  description: string;
  dirty: boolean;
  canSave: boolean;
  mutation: FormProps['mutation'];
  /** Starts the save; call `done` once it succeeds. */
  onSave: (done: () => void) => void;
  children: React.ReactNode;
}) {
  const guard = useLeaveGuard(dirty, { busy: mutation.isPending });
  return (
    <FormScreen
      title="Record a result"
      subtitle={SYSTEM_META[system].title}
      guard={guard}
      saveLabel="Save"
      canSave={canSave}
      saving={mutation.isPending}
      onSave={() => onSave(() => guard.exit(() => router.back()))}
    >
      <Text variant="body" color="dim">
        {description}
      </Text>
      {mutation.error ? <ErrorState message={mutation.error.message} /> : null}
      <FormSection>{children}</FormSection>
      <Text variant="caption" color="muted">
        Workouts are written as zones, so they update automatically.
      </Text>
    </FormScreen>
  );
}

const RACE_DISTANCES = [
  { value: '5000', label: '5K' },
  { value: '10000', label: '10K' },
  { value: '21097.5', label: 'Half' },
  { value: '42195', label: 'Marathon' },
  { value: 'custom', label: 'Other' },
];

function RunForm({ today, mutation }: FormProps) {
  const units = useUnits();
  const [method, setMethod] = useState<'race_result' | 'threshold_pace'>('race_result');
  const [distance, setDistance] = useState('5000');
  const [custom, setCustom] = useState('');
  const [duration, setDuration] = useState('');
  const [threshold, setThreshold] = useState('');
  const [observedOn, setObservedOn] = useState(today);
  const race = method === 'race_result';
  // Some keyboards type a decimal comma.
  const customDistance = Number(custom.trim().replace(',', '.'));
  const canSave = race
    ? !!duration.trim() && (distance !== 'custom' || customDistance > 0) && !!observedOn
    : !!threshold.trim();
  const save = (done: () => void) =>
    mutation.mutate(
      (): RecordCalibration =>
        race
          ? {
              system: 'run_pace',
              input: {
                method,
                distanceMetres:
                  distance === 'custom'
                    ? Number(custom.replace(',', '.')) * (units === 'mi' ? METRES_PER_MILE : 1000)
                    : Number(distance),
                durationSeconds: parseClock(duration),
              },
              provenance: 'user_supplied',
              observedOn,
            }
          : {
              system: 'run_pace',
              input: {
                method,
                secondsPerKilometre:
                  parseClock(threshold) / (units === 'mi' ? KILOMETRES_PER_MILE : 1),
              },
              provenance: 'user_estimate',
              estimateBasis: 'Threshold pace estimated by the athlete.',
            },
      { onSuccess: done },
    );
  return (
    <Shell
      system="run_pace"
      description="Use a result that represents your current fitness. New pace guides apply from today in every plan."
      dirty={!!(duration || threshold || custom)}
      canSave={canSave}
      mutation={mutation}
      onSave={save}
    >
      <ChoiceField
        label="Fitness input"
        value={method}
        onChange={setMethod}
        options={[
          { value: 'race_result', label: 'Recent race or time trial' },
          { value: 'threshold_pace', label: 'Estimated threshold pace' },
        ]}
      />
      {race ? (
        <>
          <ChoiceField
            label="Distance"
            value={distance}
            onChange={setDistance}
            options={RACE_DISTANCES}
          />
          {distance === 'custom' ? (
            <Field
              label={`Distance in ${units}`}
              value={custom}
              onChangeText={setCustom}
              keyboardType="decimal-pad"
              suffix={units}
            />
          ) : null}
          <Field
            label="Finish time"
            hint="mm:ss or hh:mm:ss"
            value={duration}
            onChangeText={setDuration}
            placeholder="25:00"
            keyboardType="numbers-and-punctuation"
          />
          <DateField label="Race date" value={observedOn} onChange={setObservedOn} max={today} />
        </>
      ) : (
        <Field
          label="Threshold pace"
          hint={`min/${units}, as mm:ss`}
          value={threshold}
          onChangeText={setThreshold}
          placeholder="4:30"
          keyboardType="numbers-and-punctuation"
          suffix={`/${units}`}
        />
      )}
    </Shell>
  );
}

function PowerForm({ today, mutation }: FormProps) {
  const [method, setMethod] = useState<'ftp' | 'twenty_minute_test' | 'ramp_test'>('ftp');
  const [watts, setWatts] = useState('');
  const [estimate, setEstimate] = useState(false);
  const [observedOn, setObservedOn] = useState(today);
  const value = Number(watts);
  const test = method !== 'ftp';
  const input =
    method === 'ftp'
      ? { method, watts: value }
      : method === 'twenty_minute_test'
        ? { method, averageWatts: value }
        : { method, bestMinuteWatts: value };
  return (
    <Shell
      system="cycle_power"
      description="Power zones are percentages of your FTP. A 20-minute test uses 95% of its average; a ramp test uses 75% of your best minute."
      dirty={!!watts}
      canSave={Number.isInteger(value) && value > 0 && (!test || !!observedOn)}
      mutation={mutation}
      onSave={(done) =>
        mutation.mutate(
          (): RecordCalibration => ({
            system: 'cycle_power',
            input,
            ...(estimate && !test
              ? {
                  provenance: 'user_estimate' as const,
                  estimateBasis: 'FTP estimated by the athlete.',
                }
              : { provenance: 'user_supplied' as const, ...(test ? { observedOn } : {}) }),
          }),
          { onSuccess: done },
        )
      }
    >
      <ChoiceField
        label="Power input"
        value={method}
        onChange={setMethod}
        options={[
          { value: 'ftp', label: 'FTP I already know' },
          { value: 'twenty_minute_test', label: '20-minute test' },
          { value: 'ramp_test', label: 'Ramp test' },
        ]}
      />
      <Field
        label={
          method === 'ftp'
            ? 'FTP'
            : method === 'twenty_minute_test'
              ? 'Average power for 20 minutes'
              : 'Best one-minute power'
        }
        value={watts}
        onChangeText={(next) => setWatts(next.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        suffix="W"
      />
      {test ? (
        <DateField label="Test date" value={observedOn} onChange={setObservedOn} max={today} />
      ) : (
        <CheckRow
          checked={estimate}
          onToggle={() => setEstimate(!estimate)}
          label="This is an estimate"
          sub="Flagged until you replace it with a test."
        />
      )}
    </Shell>
  );
}

function SwimForm({ today, mutation }: FormProps) {
  const { pool } = useSportUnits();
  const [method, setMethod] = useState<'css_test' | 'css_pace'>('css_test');
  const [t400, setT400] = useState('');
  const [t200, setT200] = useState('');
  const [pace, setPace] = useState('');
  const [observedOn, setObservedOn] = useState(today);
  const factor = pool === 'yd' ? METRES_PER_YARD : 1;
  const test = method === 'css_test';
  // Yard-pool times cover fewer metres; convert to the 400 m / 200 m the calculator expects.
  const build = (): RecordCalibration =>
    test
      ? {
          system: 'swim_pace',
          input: {
            method,
            t400Seconds: parseClock(t400) / factor,
            t200Seconds: parseClock(t200) / factor,
          },
          provenance: 'user_supplied',
          observedOn,
        }
      : {
          system: 'swim_pace',
          input: { method, secondsPer100Metres: parseClock(pace) / factor },
          provenance: 'user_estimate',
          estimateBasis: 'CSS pace estimated by the athlete.',
        };
  return (
    <Shell
      system="swim_pace"
      description="Critical swim speed comes from an all-out 400 and 200 with full recovery between them. Swim paces apply from today in every plan."
      dirty={!!(t400 || t200 || pace)}
      canSave={test ? !!t400.trim() && !!t200.trim() && !!observedOn : !!pace.trim()}
      mutation={mutation}
      onSave={(done) => mutation.mutate(build, { onSuccess: done })}
    >
      <ChoiceField
        label="Swim input"
        value={method}
        onChange={setMethod}
        options={[
          { value: 'css_test', label: '400/200 CSS test' },
          { value: 'css_pace', label: 'CSS pace I already know' },
        ]}
      />
      {test ? (
        <>
          <Field
            label={`400 ${pool} time`}
            hint="mm:ss"
            value={t400}
            onChangeText={setT400}
            placeholder="6:20"
            keyboardType="numbers-and-punctuation"
          />
          <Field
            label={`200 ${pool} time`}
            hint="mm:ss"
            value={t200}
            onChangeText={setT200}
            placeholder="2:50"
            keyboardType="numbers-and-punctuation"
          />
          <DateField label="Test date" value={observedOn} onChange={setObservedOn} max={today} />
        </>
      ) : (
        <Field
          label="CSS pace"
          hint={`min/100${pool}, as mm:ss`}
          value={pace}
          onChangeText={setPace}
          placeholder="1:45"
          keyboardType="numbers-and-punctuation"
          suffix={`/100${pool}`}
        />
      )}
    </Shell>
  );
}
