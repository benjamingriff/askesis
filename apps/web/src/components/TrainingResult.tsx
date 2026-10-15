import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Gauge } from 'lucide-react';
import type { paths } from '@askesis/api-client';
import { api } from '../api';
import { result } from '../lib/result';
import { useRequestKey } from '../lib/use-request-key';
import type { LogInput } from '../training-log';
import { parseClock } from '../routes/performance';
import { Button, Notice, CheckRow } from './ui';

type PreviewInput =
  paths['/api/v1/performance/calibrations/preview']['post']['requestBody']['content']['application/json'];
type Input = NonNullable<NonNullable<LogInput['answers']>['result']>;
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
  const system =
    discipline === 'run'
      ? 'run_pace'
      : discipline === 'cycle'
        ? 'cycle_power'
        : discipline === 'swim'
          ? 'swim_pace'
          : null;
  const [method, setMethod] = useState(
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
    return <p className="fb-hint">Tell your coach about this result in the note below.</p>;
  return (
    <section className="fb-section">
      <h3>Your result (optional)</h3>
      <p className="fb-hint">
        Preview and attach a result for your coach. Saving the log alone never changes your fitness.
      </p>
      <label className="field">
        <span>Result type</span>
        <select
          value={method}
          onChange={(e) => {
            setMethod(e.target.value as typeof method);
            changed();
          }}
        >
          {system === 'run_pace' ? (
            <>
              <option value="race_result">Race or time trial</option>
              <option value="threshold_pace">Threshold pace estimate</option>
            </>
          ) : system === 'cycle_power' ? (
            <>
              <option value="twenty_minute_test">20-minute test</option>
              <option value="ramp_test">Ramp test</option>
              <option value="ftp">Known FTP</option>
            </>
          ) : (
            <>
              <option value="css_test">400/200 CSS test</option>
              <option value="css_pace">CSS pace</option>
            </>
          )}
        </select>
      </label>
      <div className="field-row">
        {method === 'race_result' ? (
          <label className="field">
            <span>Result distance (metres)</span>
            <input
              type="number"
              min="1609.344"
              max="42195"
              step="any"
              value={distance}
              onChange={(e) => {
                setDistance(e.target.value);
                changed();
              }}
            />
          </label>
        ) : null}
        <label className="field">
          <span>
            {system === 'cycle_power'
              ? method === 'ramp_test'
                ? 'Best minute (watts)'
                : method === 'ftp'
                  ? 'FTP (watts)'
                  : 'Average power (watts)'
              : method === 'css_test'
                ? '400 m time (mm:ss)'
                : method === 'threshold_pace'
                  ? 'Threshold pace (mm:ss/km)'
                  : method === 'css_pace'
                    ? 'CSS pace (mm:ss/100 m)'
                    : 'Finish time (mm:ss or hh:mm:ss)'}
          </span>
          <input
            value={first}
            type={system === 'cycle_power' ? 'number' : 'text'}
            onChange={(e) => {
              setFirst(e.target.value);
              changed();
            }}
          />
        </label>
        {method === 'css_test' ? (
          <label className="field">
            <span>200 m time (mm:ss)</span>
            <input
              value={second}
              onChange={(e) => {
                setSecond(e.target.value);
                changed();
              }}
            />
          </label>
        ) : null}
      </div>
      <Button
        size="sm"
        icon={Gauge}
        disabled={preview.isPending || record.isPending}
        busy={preview.isPending}
        onClick={() => preview.mutate()}
      >
        Preview and attach result
      </Button>
      {preview.error || record.error ? (
        <Notice tone="danger" role="alert">
          {preview.error?.message ?? record.error?.message}
        </Notice>
      ) : null}
      {previewData ? (
        <div className="result-preview">
          <p>
            <Check size={14} /> Result previewed and attached.
          </p>
          <p className="muted">
            {previewData.current
              ? 'Compare the calculated guides with your current fitness before updating.'
              : 'No current guides for this sport.'}
          </p>
          <dl className="result-zones">
            {previewData.zones.map((zone) => (
              <div key={zone.key}>
                <dt>{zone.key.replaceAll('_', ' ')}</dt>
                <dd>
                  {zone.target.toFixed(zone.unit === 'watts' ? 0 : 1)}{' '}
                  {zone.unit === 'watts'
                    ? 'W'
                    : zone.unit === 'seconds_per_100_metres'
                      ? 'seconds / 100 m'
                      : 'seconds / km'}
                </dd>
              </div>
            ))}
          </dl>
          <CheckRow
            checked={confirmed}
            onChange={setConfirmed}
            label="This result reflects my current fitness"
            hint="For a slower result, consider illness, heat, terrain and whether it was an all-out effort."
          />
          <Button
            size="sm"
            disabled={!confirmed || record.isPending || recorded}
            busy={record.isPending}
            onClick={() => record.mutate()}
          >
            {recorded ? 'Fitness guides updated' : 'Update my fitness guides'}
          </Button>
        </div>
      ) : value ? (
        <p className="fb-hint">
          A result is already saved with this log. Preview it again to review or update fitness.
        </p>
      ) : null}
    </section>
  );
}
function clock(seconds: number) {
  const hours = Math.floor(seconds / 3600),
    minutes = Math.floor((seconds % 3600) / 60),
    secs = Math.round(seconds % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}
