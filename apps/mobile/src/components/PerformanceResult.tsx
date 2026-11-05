import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useCoachWord } from '../data/account';
import type { LogInput } from '../data/training-log';
import type { paths } from '../lib/api-types';
import { api } from '../lib/api';
import { parseClock } from '../lib/format';
import { useRequestKey } from '../lib/request-key';
import { result } from '../lib/result';
import { useTheme } from '../state/settings';
import { CheckRow, ChoiceField, Field } from './forms';
import { Button, ErrorState, Text } from './ui';

// Ported from apps/web/src/components/TrainingResult.tsx; keep the two in step.

type PreviewInput =
  paths['/api/v1/performance/calibrations/preview']['post']['requestBody']['content']['application/json'];
type Input = NonNullable<NonNullable<LogInput['answers']>['result']>;
type Method = Input['input']['method'];

function clock(seconds: number) {
  const hours = Math.floor(seconds / 3600),
    minutes = Math.floor((seconds % 3600) / 60),
    secs = Math.round(seconds % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

/** A result is attached only after successful API preview; recording fitness is a separate action. */
export function PerformanceResult({
  discipline,
  value,
  performedOn,
  onChange,
  onBusyChange,
}: {
  discipline: string;
  value: Input | undefined;
  performedOn: string;
  onChange: (value: Input | undefined) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const theme = useTheme();
  const coach = useCoachWord();
  const system =
    discipline === 'run'
      ? 'run_pace'
      : discipline === 'cycle'
        ? 'cycle_power'
        : discipline === 'swim'
          ? 'swim_pace'
          : null;
  const [method, setMethod] = useState<Method>(
    value?.input.method ??
      (system === 'run_pace'
        ? 'race_result'
        : system === 'cycle_power'
          ? 'twenty_minute_test'
          : 'css_test'),
  );
  const input = value?.input;
  const [first, setFirst] = useState(
    input && 'durationSeconds' in input
      ? clock(input.durationSeconds)
      : input && 'averageWatts' in input
        ? String(input.averageWatts)
        : input && 'watts' in input
          ? String(input.watts)
          : input && 'bestMinuteWatts' in input
            ? String(input.bestMinuteWatts)
            : input && 't400Seconds' in input
              ? clock(input.t400Seconds)
              : input && 'secondsPerKilometre' in input
                ? clock(input.secondsPerKilometre)
                : input && 'secondsPer100Metres' in input
                  ? clock(input.secondsPer100Metres)
                  : '',
  );
  const [second, setSecond] = useState(
    input && 't200Seconds' in input ? clock(input.t200Seconds) : '',
  );
  const [distance, setDistance] = useState(
    input && 'distanceMetres' in input ? String(input.distanceMetres) : '5000',
  );
  const [confirmed, setConfirmed] = useState(false),
    [recorded, setRecorded] = useState(false);
  const generation = useRef(0),
    mounted = useRef(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const key = useRequestKey(),
    client = useQueryClient();
  const build = (): Input => {
    if (system === 'run_pace')
      return method === 'race_result'
        ? {
            system,
            input: {
              method: 'race_result',
              distanceMetres: Number(distance),
              durationSeconds: parseClock(first),
            },
            observedOn: performedOn,
            provenance: 'user_supplied',
          }
        : {
            system,
            input: { method: 'threshold_pace', secondsPerKilometre: parseClock(first) },
            observedOn: performedOn,
            provenance: 'user_estimate',
            estimateBasis: 'Threshold pace entered in workout feedback.',
          };
    if (system === 'cycle_power')
      return {
        system,
        input:
          method === 'ftp'
            ? { method: 'ftp', watts: Number(first) }
            : method === 'ramp_test'
              ? { method: 'ramp_test', bestMinuteWatts: Number(first) }
              : { method: 'twenty_minute_test', averageWatts: Number(first) },
        observedOn: performedOn,
        provenance: 'user_supplied',
      };
    return {
      system: 'swim_pace',
      input:
        method === 'css_pace'
          ? { method: 'css_pace', secondsPer100Metres: parseClock(first) }
          : { method: 'css_test', t400Seconds: parseClock(first), t200Seconds: parseClock(second) },
      observedOn: performedOn,
      provenance: 'user_supplied',
    };
  };
  const preview = useMutation({
    mutationFn: async () => {
      const proposed = build();
      const requestRevision = generation.current;
      const data = result(
        await api.POST('/api/v1/performance/calibrations/preview', {
          body: { system: proposed.system, input: proposed.input } as PreviewInput,
        }),
      );
      if (mounted.current && requestRevision === generation.current) onChange(proposed);
      return { data, revision: requestRevision };
    },
  });
  const record = useMutation({
    mutationFn: async () => {
      if (!value || !confirmed)
        throw new Error('Confirm this result reflects your current fitness first.');
      const data = result(
        await api.POST('/api/v1/performance/calibrations', {
          body: { ...value, idempotencyKey: key(value) },
        }),
      );
      key.settle(value);
      return data;
    },
    onSuccess: () => {
      setRecorded(true);
      void client.invalidateQueries({ queryKey: ['performance'] });
      void client.invalidateQueries({ queryKey: ['plan-workouts'] });
      void client.invalidateQueries({ queryKey: ['plans'] });
    },
  });
  const busy = preview.isPending || record.isPending;
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const previewData = preview.data?.revision === revision ? preview.data.data : undefined;
  const changed = () => {
    generation.current++;
    setRevision(generation.current);
    onChange(undefined);
    if (!preview.isPending) preview.reset();
    setConfirmed(false);
    setRecorded(false);
  };
  if (!system)
    return (
      <Text variant="caption" color="muted">
        Tell your {coach} about this result in the note below.
      </Text>
    );
  const firstLabel =
    system === 'cycle_power'
      ? method === 'ramp_test'
        ? 'Best minute'
        : method === 'ftp'
          ? 'FTP'
          : 'Average power'
      : method === 'css_test'
        ? '400 m time'
        : method === 'threshold_pace'
          ? 'Threshold pace'
          : method === 'css_pace'
            ? 'CSS pace'
            : 'Finish time';
  const firstHint =
    system === 'cycle_power'
      ? undefined
      : method === 'threshold_pace'
        ? 'mm:ss per km'
        : method === 'css_pace'
          ? 'mm:ss per 100 m'
          : method === 'race_result'
            ? 'mm:ss or hh:mm:ss'
            : 'mm:ss';
  return (
    <View style={{ gap: 14 }}>
      <Text variant="caption" color="muted">
        Preview and attach a result for your {coach}. Saving the log alone never changes your
        fitness.
      </Text>
      <ChoiceField<Method>
        label="Result type"
        value={method}
        onChange={(next) => {
          setMethod(next);
          changed();
        }}
        options={
          system === 'run_pace'
            ? [
                { value: 'race_result', label: 'Race or time trial' },
                { value: 'threshold_pace', label: 'Threshold pace estimate' },
              ]
            : system === 'cycle_power'
              ? [
                  { value: 'twenty_minute_test', label: '20-minute test' },
                  { value: 'ramp_test', label: 'Ramp test' },
                  { value: 'ftp', label: 'Known FTP' },
                ]
              : [
                  { value: 'css_test', label: '400/200 CSS test' },
                  { value: 'css_pace', label: 'CSS pace' },
                ]
        }
      />
      {method === 'race_result' ? (
        <Field
          label="Result distance"
          value={distance}
          onChangeText={(next) => {
            setDistance(next);
            changed();
          }}
          keyboardType="decimal-pad"
          suffix="m"
        />
      ) : null}
      <Field
        label={firstLabel}
        hint={firstHint}
        value={first}
        onChangeText={(next) => {
          setFirst(next);
          changed();
        }}
        keyboardType={system === 'cycle_power' ? 'number-pad' : 'numbers-and-punctuation'}
        suffix={system === 'cycle_power' ? 'W' : undefined}
      />
      {method === 'css_test' ? (
        <Field
          label="200 m time"
          hint="mm:ss"
          value={second}
          onChangeText={(next) => {
            setSecond(next);
            changed();
          }}
          keyboardType="numbers-and-punctuation"
        />
      ) : null}
      <Button
        size="md"
        variant="secondary"
        icon="speedometer-outline"
        label="Preview and attach result"
        disabled={busy}
        busy={preview.isPending}
        onPress={() => preview.mutate()}
      />
      {preview.error || record.error ? (
        <ErrorState message={(preview.error ?? record.error)!.message} />
      ) : null}
      {previewData ? (
        <View
          style={{
            gap: 12,
            padding: 14,
            borderRadius: 16,
            backgroundColor: theme.colors.surfaceRaised,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="checkmark-circle" size={16} color={theme.locked} />
            <Text variant="caption" color="text" style={{ fontWeight: '700' }}>
              Result previewed and attached.
            </Text>
          </View>
          <Text variant="caption" color="muted">
            {previewData.current
              ? 'Compare the calculated guides with your current fitness before updating.'
              : 'No current guides for this sport.'}
          </Text>
          <View style={{ gap: 6 }}>
            {previewData.zones.map((zone) => (
              <View
                key={zone.key}
                style={{ flexDirection: 'row', justifyContent: 'space-between' }}
              >
                <Text variant="caption" style={{ textTransform: 'capitalize' }}>
                  {zone.key.replaceAll('_', ' ')}
                </Text>
                <Text variant="caption" color="text" numeric style={{ fontWeight: '700' }}>
                  {zone.target.toFixed(zone.unit === 'watts' ? 0 : 1)}{' '}
                  {zone.unit === 'watts'
                    ? 'W'
                    : zone.unit === 'seconds_per_100_metres'
                      ? 's / 100 m'
                      : 's / km'}
                </Text>
              </View>
            ))}
          </View>
          <CheckRow
            checked={confirmed}
            onToggle={() => setConfirmed(!confirmed)}
            label="This result reflects my current fitness"
            sub="For a slower result, consider illness, heat, terrain and whether it was an all-out effort."
          />
          <Button
            size="md"
            label={recorded ? 'Fitness guides updated' : 'Update my fitness guides'}
            icon={recorded ? 'checkmark' : undefined}
            disabled={!confirmed || record.isPending || recorded}
            busy={record.isPending}
            onPress={() => record.mutate()}
          />
        </View>
      ) : value ? (
        <Text variant="caption" color="muted">
          A result is already saved with this log. Preview it again to review or update fitness.
        </Text>
      ) : null}
    </View>
  );
}
