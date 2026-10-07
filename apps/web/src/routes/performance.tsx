import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, Gauge, MessagesSquare, Plus, Undo2 } from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { RecordCalibration } from '@askesis/api-client';
import { api } from '../api';
import { CalibrationSource, ZoneGuides } from '../components/PlanWidgets';
import {
  Button,
  ButtonLink,
  Card,
  Dialog,
  ErrorState,
  LoadingState,
  Notice,
  Pill,
  SectionHeader,
} from '../components/ui';
import { formatDateTime, formatShortYear, METRES_PER_YARD } from '../lib/format';
import { result } from '../lib/result';
import {
  currentEntry,
  describeEvidence,
  isEstimate,
  SPORT_META,
  SYSTEM_META,
  SYSTEMS,
  type System,
} from '../lib/sports';
import { useRequestKey } from '../lib/use-request-key';
import { usePerformance, type Calibration } from '../plan-data';
import { useSportUnits, useUnits, type Units } from '../settings';

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
 * The athlete's fitness, shared by every plan. A sport appears once it has a result or one of
 * the athlete's plans trains it; other sports can be added. Recording a result changes zones
 * from today; earlier workouts keep the zones they had. The coach can record results from chat.
 */
export function PerformancePage() {
  const performance = usePerformance();
  const units = useUnits();
  const [added, setAdded] = useState<System[]>([]);
  const data = performance.data;
  const shown = data
    ? SYSTEMS.filter(
        (system) =>
          currentEntry(data, system) || data.usedByPlans.includes(system) || added.includes(system),
      )
    : [];
  // A new athlete starts with running, the most common first plan.
  const visible = data && !shown.length ? (['run_pace'] as System[]) : shown;
  const hidden = SYSTEMS.filter((system) => !visible.includes(system));
  return (
    <div className="page performance-page">
      <header className="page-header">
        <div className="page-heading">
          <span className="label">You</span>
          <h1>Performance</h1>
          <p className="muted">
            Your training zones belong to you, not to a plan. Every plan uses them from the day they
            change; earlier workouts keep the zones they had.
          </p>
        </div>
      </header>
      {performance.isPending ? <LoadingState>Loading performance…</LoadingState> : null}
      {performance.error ? (
        <ErrorState
          message={performance.error.message}
          onRetry={() => void performance.refetch()}
        />
      ) : null}
      {data ? (
        <div className="brief-layout">
          <div className="brief-main">
            {visible.map((system) => (
              <SystemCard
                key={system}
                system={system}
                current={currentEntry(data, system) ?? null}
                today={data.today}
                units={units}
              />
            ))}
            {hidden.length ? (
              <Card className="add-sport">
                <h2 className="card-title">Add another sport</h2>
                <p className="muted">
                  Only needed for sports you train. Your coach asks for these when a plan includes
                  them.
                </p>
                <div className="sport-chips">
                  {hidden.map((system) => {
                    const sport = SPORT_META[SYSTEM_META[system].sport];
                    return (
                      <Button
                        key={system}
                        size="sm"
                        icon={Plus}
                        onClick={() => setAdded([...added, system])}
                      >
                        {sport.label === 'Ride'
                          ? 'Cycling'
                          : sport.label === 'Swim'
                            ? 'Swimming'
                            : 'Running'}
                      </Button>
                    );
                  })}
                </div>
              </Card>
            ) : null}
            <p className="muted performance-note">
              Dates follow this device’s timezone ({data.timezone}). Workouts are written as zones,
              so they update automatically.
            </p>
          </div>
          <aside className="brief-side">
            <HistoryCard entries={data.entries} units={units} />
          </aside>
        </div>
      ) : null}
    </div>
  );
}

const EMPTY: Record<System, string> = {
  run_pace:
    'No running fitness yet. Add a recent race or an estimated threshold pace below, or tell your coach about a recent result.',
  cycle_power:
    'No cycling power yet. Add your FTP or a recent test below, or ask your coach for an estimate.',
  swim_pace:
    'No swim paces yet. Add a 400/200 CSS test or an estimated CSS pace below, or ask your coach.',
};

function SystemCard({
  system,
  current,
  today,
  units,
}: {
  system: System;
  current: Calibration | null;
  today: string;
  units: Units;
}) {
  const meta = SYSTEM_META[system];
  const sport = SPORT_META[meta.sport];
  return (
    <Card className="performance-current" data-system={system}>
      <SectionHeader
        title={
          <span className="system-title" style={{ '--kind': sport.color } as CSSProperties}>
            <sport.icon size={18} aria-hidden="true" /> {meta.title}
          </span>
        }
        action={
          <ButtonLink to="/chat/new" size="sm" icon={MessagesSquare}>
            Update with my coach
          </ButtonLink>
        }
      />
      {current ? (
        <>
          <CalibrationSource calibration={current} units={units} />
          <ZoneGuides calibration={current} units={units} />
        </>
      ) : (
        <p className="muted">{EMPTY[system]}</p>
      )}
      {system === 'run_pace' ? <RunResultForm today={today} units={units} /> : null}
      {system === 'cycle_power' ? <PowerResultForm today={today} /> : null}
      {system === 'swim_pace' ? <SwimResultForm today={today} /> : null}
    </Card>
  );
}

/** Save a calibration, then refresh every view whose zones may have changed. */
function useRecord() {
  const client = useQueryClient();
  const requestKey = useRequestKey();
  return useMutation({
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
}

function ResultForm({
  label,
  description,
  submit,
  mutation,
  onSubmit,
  children,
}: {
  label: string;
  description: string;
  submit: string;
  mutation: ReturnType<typeof useRecord>;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <form
      className="result-form"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <fieldset disabled={mutation.isPending} className="form-stack">
        <legend>{label}</legend>
        <p className="muted">{description}</p>
        {mutation.error ? (
          <Notice tone="danger" role="alert">
            {mutation.error.message}
          </Notice>
        ) : null}
        {children}
        <div>
          <Button variant="primary" type="submit" icon={Gauge} busy={mutation.isPending}>
            {submit}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

function DateField({
  label,
  today,
  value,
  onChange,
}: {
  label: string;
  today: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        required
        type="date"
        max={today}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function RunResultForm({ today, units }: { today: string; units: Units }) {
  const mutation = useRecord();
  const [method, setMethod] = useState<'race_result' | 'threshold_pace'>('race_result');
  const [distance, setDistance] = useState('5000');
  const [custom, setCustom] = useState('');
  const [duration, setDuration] = useState('');
  const [threshold, setThreshold] = useState('');
  const [observedOn, setObservedOn] = useState(today);
  const save = () =>
    mutation.mutate(
      (): RecordCalibration =>
        method === 'race_result'
          ? {
              system: 'run_pace',
              input: {
                method,
                distanceMetres:
                  distance === 'custom'
                    ? Number(custom) * (units === 'mi' ? 1609.344 : 1000)
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
      {
        onSuccess: () => {
          setDuration('');
          setThreshold('');
        },
      },
    );
  return (
    <ResultForm
      label="Record a result"
      description="Use a result that represents your current fitness. New pace guides apply from today in every plan."
      submit="Calculate and save pace guides"
      mutation={mutation}
      onSubmit={save}
    >
      <label className="field">
        <span>Fitness input</span>
        <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          <option value="race_result">Recent race or time trial</option>
          <option value="threshold_pace">Estimated threshold pace</option>
        </select>
      </label>
      {method === 'race_result' ? (
        <div className="field-row">
          <label className="field">
            <span>Distance</span>
            <select value={distance} onChange={(e) => setDistance(e.target.value)}>
              <option value="5000">5K</option>
              <option value="10000">10K</option>
              <option value="21097.5">Half marathon</option>
              <option value="42195">Marathon</option>
              <option value="custom">Custom distance</option>
            </select>
          </label>
          {distance === 'custom' ? (
            <label className="field">
              <span>Distance in {units}</span>
              <input
                required
                type="number"
                step="any"
                min="0"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            </label>
          ) : null}
          <label className="field">
            <span>Finish time (mm:ss or hh:mm:ss)</span>
            <input
              required
              value={duration}
              placeholder="25:00"
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>
          <DateField label="Race date" today={today} value={observedOn} onChange={setObservedOn} />
        </div>
      ) : (
        <label className="field">
          <span>Threshold pace (min/{units})</span>
          <input
            required
            value={threshold}
            placeholder="4:30"
            onChange={(e) => setThreshold(e.target.value)}
          />
        </label>
      )}
    </ResultForm>
  );
}

function PowerResultForm({ today }: { today: string }) {
  const mutation = useRecord();
  const [method, setMethod] = useState<'ftp' | 'twenty_minute_test' | 'ramp_test'>('ftp');
  const [watts, setWatts] = useState('');
  const [estimate, setEstimate] = useState(false);
  const [observedOn, setObservedOn] = useState(today);
  const value = Number(watts);
  const input =
    method === 'ftp'
      ? { method, watts: value }
      : method === 'twenty_minute_test'
        ? { method, averageWatts: value }
        : { method, bestMinuteWatts: value };
  const test = method !== 'ftp';
  return (
    <ResultForm
      label="Record cycling power"
      description="Power zones are percentages of your FTP. A 20-minute test uses 95% of its average; a ramp test uses 75% of your best minute."
      submit="Calculate and save power zones"
      mutation={mutation}
      onSubmit={() =>
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
          { onSuccess: () => setWatts('') },
        )
      }
    >
      <label className="field">
        <span>Power input</span>
        <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          <option value="ftp">FTP I already know</option>
          <option value="twenty_minute_test">20-minute test</option>
          <option value="ramp_test">Ramp test</option>
        </select>
      </label>
      <div className="field-row">
        <label className="field">
          <span>
            {method === 'ftp'
              ? 'FTP (watts)'
              : method === 'twenty_minute_test'
                ? 'Average power for 20 minutes (watts)'
                : 'Best one-minute power (watts)'}
          </span>
          <input
            required
            type="number"
            min="1"
            step="1"
            value={watts}
            onChange={(e) => setWatts(e.target.value)}
          />
        </label>
        {test ? (
          <DateField label="Test date" today={today} value={observedOn} onChange={setObservedOn} />
        ) : (
          <label className="check-field">
            <input
              type="checkbox"
              checked={estimate}
              onChange={(e) => setEstimate(e.target.checked)}
            />
            <span>This is an estimate</span>
          </label>
        )}
      </div>
    </ResultForm>
  );
}

function SwimResultForm({ today }: { today: string }) {
  const mutation = useRecord();
  const { pool } = useSportUnits();
  const [method, setMethod] = useState<'css_test' | 'css_pace'>('css_test');
  const [t400, setT400] = useState('');
  const [t200, setT200] = useState('');
  const [pace, setPace] = useState('');
  const [observedOn, setObservedOn] = useState(today);
  const factor = pool === 'yd' ? METRES_PER_YARD : 1;
  const save = () => {
    // Yard-pool times cover fewer metres; convert to the 400 m / 200 m the calculator expects.
    const build = (): RecordCalibration =>
      method === 'css_test'
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
    mutation.mutate(build, {
      onSuccess: () => {
        setT400('');
        setT200('');
        setPace('');
      },
    });
  };
  return (
    <ResultForm
      label="Record a swim test"
      description="Critical swim speed comes from an all-out 400 and 200 with full recovery between them. Swim paces apply from today in every plan."
      submit="Calculate and save swim paces"
      mutation={mutation}
      onSubmit={save}
    >
      <label className="field">
        <span>Swim input</span>
        <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          <option value="css_test">400/200 CSS test</option>
          <option value="css_pace">CSS pace I already know</option>
        </select>
      </label>
      {method === 'css_test' ? (
        <div className="field-row">
          <label className="field">
            <span>400 {pool} time (mm:ss)</span>
            <input
              required
              value={t400}
              placeholder="6:20"
              onChange={(e) => setT400(e.target.value)}
            />
          </label>
          <label className="field">
            <span>200 {pool} time (mm:ss)</span>
            <input
              required
              value={t200}
              placeholder="2:50"
              onChange={(e) => setT200(e.target.value)}
            />
          </label>
          <DateField label="Test date" today={today} value={observedOn} onChange={setObservedOn} />
        </div>
      ) : (
        <label className="field">
          <span>CSS pace (min/100{pool})</span>
          <input
            required
            value={pace}
            placeholder="1:45"
            onChange={(e) => setPace(e.target.value)}
          />
        </label>
      )}
    </ResultForm>
  );
}

function HistoryCard({ entries, units }: { entries: Calibration[]; units: Units }) {
  const { pool } = useSportUnits();
  const evidence = (entry: Calibration) => describeEvidence(entry, { units, pool });
  const client = useQueryClient();
  const requestKey = useRequestKey();
  const [withdrawing, setWithdrawing] = useState<Calibration | null>(null);
  const retract = useMutation({
    mutationFn: async (entry: Calibration) => {
      const state = result(
        await api.POST('/api/v1/performance/calibrations/{calibrationId}/retract', {
          params: { path: { calibrationId: entry.id } },
          body: { idempotencyKey: requestKey(['retract', entry.id]) },
        }),
      );
      requestKey.settle(['retract', entry.id]);
      return state;
    },
    onSuccess: async (state) => {
      client.setQueryData(['performance'], state);
      setWithdrawing(null);
      await client.invalidateQueries({ queryKey: ['plan-workouts'] });
    },
  });
  return (
    <Card>
      <h2 className="card-title">History</h2>
      {entries.length ? (
        <ol className="performance-history">
          {entries.map((entry) => (
            <li key={entry.id} className={entry.retractedAt ? 'retracted' : undefined}>
              <div className="performance-history-head">
                <strong>{evidence(entry)}</strong>
                {entry.retractedAt ? (
                  <Pill>Withdrawn</Pill>
                ) : isEstimate(entry) ? (
                  <Pill tone="warning">Estimate</Pill>
                ) : null}
              </div>
              <small>
                {SYSTEM_META[entry.system].title} ·{' '}
                {entry.observedOn ? `${formatShortYear(entry.observedOn)} · ` : ''}
                applies from {formatShortYear(entry.effectiveFrom)}
              </small>
              <small className="performance-history-source">
                {entry.recordedBy === 'coach' ? (
                  <>
                    <Bot size={13} aria-hidden="true" />
                    {entry.conversationId ? (
                      <Link to={`/chat/${entry.conversationId}`}>Recorded by your coach</Link>
                    ) : (
                      'Recorded by your coach'
                    )}
                  </>
                ) : (
                  `Recorded ${formatDateTime(entry.recordedAt)}`
                )}
              </small>
              {entry.estimateBasis ? <p>{entry.estimateBasis}</p> : null}
              {!entry.retractedAt ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Undo2}
                  onClick={() => setWithdrawing(entry)}
                >
                  Withdraw
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Results you or your coach record appear here.</p>
      )}
      <Dialog
        open={!!withdrawing}
        size="sm"
        busy={retract.isPending}
        onClose={() => setWithdrawing(null)}
        title="Withdraw this result?"
        description="Use this for a result that was entered by mistake. The previous zones apply again in every plan."
        footer={
          <>
            <Button
              variant="ghost"
              disabled={retract.isPending}
              onClick={() => setWithdrawing(null)}
            >
              Keep it
            </Button>
            <Button
              variant="danger"
              busy={retract.isPending}
              onClick={() => withdrawing && retract.mutate(withdrawing)}
            >
              Withdraw
            </Button>
          </>
        }
      >
        {retract.error ? (
          <Notice tone="danger" role="alert">
            {retract.error.message}
          </Notice>
        ) : null}
        {withdrawing ? <p>{evidence(withdrawing)}</p> : null}
      </Dialog>
    </Card>
  );
}
