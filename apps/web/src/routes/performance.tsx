import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, Gauge, MessagesSquare, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { CalibrationSource, PaceGuides } from '../components/PlanWidgets';
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
import {
  formatClock,
  formatDateTime,
  formatDistance,
  formatPace,
  formatShortYear,
} from '../lib/format';
import { result } from '../lib/result';
import { useRequestKey } from '../lib/use-request-key';
import { currentRunPace, isEstimate, usePerformance, type Calibration } from '../plan-data';
import { useUnits, type Units } from '../settings';

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

function evidence(entry: Calibration, units: Units) {
  return entry.input.method === 'threshold_pace'
    ? `Threshold ${formatPace(entry.input.secondsPerKilometre, units)}`
    : `${formatDistance(entry.input.distanceMetres, units)} in ${formatClock(entry.input.durationSeconds)}`;
}

/**
 * The athlete's fitness, shared by every plan. Recording a result changes pace guides from
 * today; earlier workouts keep the paces they had. The coach can record results from chat.
 */
export function PerformancePage() {
  const performance = usePerformance();
  const units = useUnits();
  return (
    <div className="page performance-page">
      <header className="page-header">
        <div className="page-heading">
          <span className="label">You</span>
          <h1>Performance</h1>
          <p className="muted">
            Your pace guides belong to you, not to a plan. Every plan uses them from the day they
            change; earlier workouts keep the paces they had.
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
      {performance.data ? (
        <div className="brief-layout">
          <div className="brief-main">
            <CurrentPaceCard
              current={currentRunPace(performance.data) ?? null}
              units={units}
              timezone={performance.data.timezone}
            />
            <RecordResultForm today={performance.data.today} units={units} />
          </div>
          <aside className="brief-side">
            <HistoryCard entries={performance.data.entries} units={units} />
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function CurrentPaceCard({
  current,
  units,
  timezone,
}: {
  current: Calibration | null;
  units: Units;
  timezone: string;
}) {
  return (
    <Card className="performance-current">
      <SectionHeader
        title="Running pace guides"
        action={
          <ButtonLink to="/chat/new" size="sm" icon={MessagesSquare}>
            Update with my coach
          </ButtonLink>
        }
      />
      {current ? (
        <>
          <CalibrationSource calibration={current} units={units} />
          <PaceGuides calibration={current} units={units} />
        </>
      ) : (
        <p className="muted">
          No running fitness yet. Add a recent race or an estimated threshold pace below, or tell
          your coach about a recent result.
        </p>
      )}
      <p className="muted performance-note">
        Dates follow this device’s timezone ({timezone}). Workouts are written as zones, so they
        update automatically.
      </p>
    </Card>
  );
}

function RecordResultForm({ today, units }: { today: string; units: Units }) {
  const client = useQueryClient();
  const requestKey = useRequestKey();
  const [method, setMethod] = useState<'race_result' | 'threshold_pace'>('race_result');
  const [distance, setDistance] = useState('5000');
  const [custom, setCustom] = useState('');
  const [duration, setDuration] = useState('');
  const [threshold, setThreshold] = useState('');
  const [observedOn, setObservedOn] = useState(today);
  const mutation = useMutation({
    mutationFn: async () => {
      const input =
        method === 'race_result'
          ? {
              method,
              distanceMetres:
                distance === 'custom'
                  ? Number(custom) * (units === 'mi' ? 1609.344 : 1000)
                  : Number(distance),
              durationSeconds: parseClock(duration),
            }
          : {
              method,
              secondsPerKilometre:
                parseClock(threshold) / (units === 'mi' ? KILOMETRES_PER_MILE : 1),
            };
      const body = {
        system: 'run_pace' as const,
        input,
        ...(method === 'race_result'
          ? { provenance: 'user_supplied' as const, observedOn }
          : {
              provenance: 'user_estimate' as const,
              estimateBasis: 'Threshold pace estimated by the athlete.',
            }),
      };
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
      setDuration('');
      setThreshold('');
      await client.invalidateQueries({ queryKey: ['plan-workouts'] });
    },
  });
  return (
    <form
      className="card"
      aria-label="Record a result"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <fieldset disabled={mutation.isPending} className="form-stack">
        <legend>Record a result</legend>
        <p className="muted">
          Use a result that represents your current fitness. New pace guides apply from today in
          every plan.
        </p>
        {mutation.error ? (
          <Notice tone="danger" role="alert">
            {mutation.error.message}
          </Notice>
        ) : null}
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
            <label className="field">
              <span>Race date</span>
              <input
                required
                type="date"
                max={today}
                value={observedOn}
                onChange={(e) => setObservedOn(e.target.value)}
              />
            </label>
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
        <div>
          <Button variant="primary" type="submit" icon={Gauge} busy={mutation.isPending}>
            Calculate and save pace guides
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

function HistoryCard({ entries, units }: { entries: Calibration[]; units: Units }) {
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
                <strong>{evidence(entry, units)}</strong>
                {entry.retractedAt ? (
                  <Pill>Withdrawn</Pill>
                ) : isEstimate(entry) ? (
                  <Pill tone="warning">Estimate</Pill>
                ) : null}
              </div>
              <small>
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
        description="Use this for a result that was entered by mistake. The previous pace guides apply again in every plan."
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
        {withdrawing ? <p>{evidence(withdrawing, units)}</p> : null}
      </Dialog>
    </Card>
  );
}
