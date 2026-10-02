import { CoverageSummary } from '../components/PlanningReview';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, useCallback } from 'react';
import { Link, useParams, useBeforeUnload, useBlocker } from 'react-router';
import type { paths } from '@askesis/api-client';
import { api } from '../api';

type State =
  paths['/api/v1/plans/{planId}/draft/brief']['get']['responses'][200]['content']['application/json'];
type Brief = State['brief'];
const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const descriptions: Record<string, string> = {
  easy: 'E · Easy — relaxed aerobic running, warm-ups, cool-downs and recovery.',
  marathon: 'M · Marathon — sustained running guided by current marathon fitness.',
  threshold: 'T · Threshold — comfortably hard, controlled tempos and cruise intervals.',
  interval: 'I · Interval — hard aerobic repetitions with recovery between efforts.',
  repetition: 'R · Repetition — short, fast, relaxed efforts with generous recovery.',
};
function result<T>(response: { data?: T; error?: { error?: { message?: string } } }): T {
  if (!response.data)
    throw new Error(response.error?.error?.message ?? 'Request failed. Please try again.');
  return response.data;
}
export function formatPace(seconds: number, unit: Brief['unit']) {
  const rounded = Math.round(seconds * (unit === 'miles' ? 1.609344 : 1));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}/${unit === 'miles' ? 'mi' : 'km'}`;
}
export function PlanBriefPage() {
  const { planId = '', revisionId } = useParams();
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
  return (
    <main className="plan-lifecycle">
      <Link to={`/plans/${planId}`}>← Plan details</Link>
      <h1>Plan brief and pace guides</h1>
      {query.isPending && <p role="status">Loading brief…</p>}
      {query.error && (
        <p role="alert">
          {query.error.message} <button onClick={() => void query.refetch()}>Retry</button>
        </p>
      )}
      {query.data && (
        <BriefEditor
          key={`${query.data.versionId}:${query.data.editNumber}:${query.data.confirmed}`}
          state={query.data}
          planId={planId}
        />
      )}
    </main>
  );
}
function BriefEditor({ state, planId }: { state: State; planId: string }) {
  const client = useQueryClient();
  const [brief, setBrief] = useState<Brief>(() =>
    state.brief.goal || state.calibrations.length
      ? state.brief
      : {
          ...state.brief,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
  );
  const [editing, setEditing] = useState(!state.confirmed);
  const [review, setReview] = useState(false);
  const [ack, setAck] = useState<string[]>([]);
  const [method, setMethod] = useState<'race_result' | 'threshold_pace'>('race_result');
  const [distance, setDistance] = useState('5000');
  const [custom, setCustom] = useState('');
  const [duration, setDuration] = useState('');
  const [threshold, setThreshold] = useState('');
  const command = { expectedDraftId: state.versionId, expectedEditNumber: state.editNumber };
  const params = { path: { planId } };
  const dirty = JSON.stringify(brief) !== JSON.stringify(state.brief);
  const keys = useRef(new Map<string, string>());
  const blocker = useBlocker(dirty);
  useBeforeUnload(
    useCallback(
      (event: BeforeUnloadEvent) => {
        if (dirty) {
          event.preventDefault();
          event.returnValue = '';
        }
      },
      [dirty],
    ),
  );
  const mutation = useMutation({
    mutationFn: async (action: 'save' | 'confirm' | 'calibrate' | `reuse:${string}`) => {
      const signature = JSON.stringify([
        action,
        command,
        brief,
        method,
        distance,
        custom,
        duration,
        threshold,
        ack,
      ]);
      if (!keys.current.has(signature)) keys.current.set(signature, crypto.randomUUID());
      const request = { ...command, idempotencyKey: keys.current.get(signature)! };
      if (action === 'save')
        return result(
          await api.PUT('/api/v1/plans/{planId}/draft/brief', {
            params,
            body: { ...request, brief },
          }),
        );
      if (action === 'confirm')
        return result(
          await api.POST('/api/v1/plans/{planId}/draft/brief/confirm', {
            params,
            body: { ...request, expectedHash: state.hash, acknowledgedWarningCodes: ack },
          }),
        );
      if (action.startsWith('reuse:'))
        return result(
          await api.POST('/api/v1/plans/{planId}/draft/calibrations/{calibrationId}/use-again', {
            params: { path: { planId, calibrationId: action.slice(6) } },
            body: request,
          }),
        );
      const parseTime = (value: string) => {
        if (!/^\d+:\d{2}(?::\d{2})?$/.test(value))
          throw new Error('Enter a time as mm:ss or hh:mm:ss.');
        const parts = value.split(':').map(Number);
        if (parts.slice(1).some((part) => part >= 60))
          throw new Error('Seconds and minutes within a time must be below 60.');
        return parts.reduce((total, part) => total * 60 + part, 0);
      };
      const input =
        method === 'race_result'
          ? {
              method,
              distanceMetres:
                distance === 'custom'
                  ? Number(custom) * (brief.unit === 'miles' ? 1609.344 : 1000)
                  : Number(distance),
              durationSeconds: parseTime(duration),
            }
          : {
              method,
              secondsPerKilometre: parseTime(threshold) / (brief.unit === 'miles' ? 1.609344 : 1),
            };
      return result(
        await api.POST('/api/v1/plans/{planId}/draft/calibrations', {
          params,
          body: {
            ...request,
            input,
            provenance: method === 'threshold_pace' ? 'user_estimate' : 'user_supplied',
            ...(method === 'threshold_pace'
              ? { estimateBasis: 'Threshold pace estimated by the user.' }
              : {}),
          },
        }),
      );
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['plans'] });
      await client.invalidateQueries({ queryKey: ['plan-workouts'] });
    },
  });
  const disabled = state.readOnly || !editing || mutation.isPending;
  const patch = <K extends keyof Brief>(key: K, value: Brief[K]) =>
    setBrief({ ...brief, [key]: value });
  const baseline = (key: 'weeklyDistance' | 'currentRuns' | 'longestRun', label: string) => {
    const answer = brief[key];
    const factor = key === 'currentRuns' ? 1 : brief.unit === 'miles' ? 1609.344 : 1000;
    return (
      <label key={key}>
        {label}
        {key !== 'currentRuns' && ` (${brief.unit})`}
        <select
          aria-label={`${label} answer`}
          value={answer.status}
          onChange={(e) =>
            patch(
              key,
              e.target.value === 'known'
                ? { status: 'known', value: 0 }
                : { status: e.target.value as 'unknown' | 'unanswered', value: null },
            )
          }
        >
          <option value="unanswered">Not answered</option>
          <option value="known">Enter a value</option>
          <option value="unknown">Unknown</option>
        </select>
        {answer.status === 'known' && (
          <input
            aria-label={label}
            type="number"
            min="0"
            step={key === 'currentRuns' ? '1' : 'any'}
            value={Number((answer.value / factor).toFixed(6))}
            onChange={(e) =>
              patch(key, { status: 'known', value: Number(e.target.value) * factor })
            }
          />
        )}
      </label>
    );
  };
  const calibration = (c: State['calibrations'][number]) => (
    <>
      <p>
        {c.method === 'race_result'
          ? `${c.distanceMetres! / (brief.unit === 'miles' ? 1609.344 : 1000)} ${brief.unit} in ${Math.floor(c.durationSeconds! / 60)}:${String(c.durationSeconds! % 60).padStart(2, '0')}`
          : `Estimated threshold ${formatPace(c.secondsPerKilometre!, brief.unit)}`}
      </p>
      {c.estimateBasis && (
        <p>
          {c.provenance === 'agent_estimate' ? 'Coach estimate: ' : 'Pace evidence: '}
          {c.estimateBasis}
        </p>
      )}
      {(c.provenance === 'agent_estimate' ||
        c.provenance === 'user_estimate' ||
        c.method === 'threshold_pace') && (
        <p>These paces are estimates. Update the paces and plan after a few runs.</p>
      )}
      <table className="pace-guides">
        <thead>
          <tr>
            <th>Guide</th>
            <th>Target</th>
            <th>Range</th>
          </tr>
        </thead>
        <tbody>
          {['easy', 'marathon', 'threshold', 'interval', 'repetition'].map((key) => {
            const zone = c.zones.find((z) => z.key === key);
            return (
              zone && (
                <tr key={key}>
                  <td>{descriptions[key]}</td>
                  <td>{formatPace(zone.target, brief.unit)}</td>
                  <td>
                    {formatPace(zone.fast, brief.unit)}–{formatPace(zone.slow, brief.unit)}
                  </td>
                </tr>
              )
            );
          })}
        </tbody>
      </table>
    </>
  );
  return (
    <>
      {blocker.state === 'blocked' && (
        <section role="alertdialog" className="plan-panel">
          <p>Leave without saving your brief changes?</p>
          <button onClick={() => blocker.reset()}>Keep editing</button>
          <button onClick={() => blocker.proceed()}>Leave without saving</button>
        </section>
      )}
      <p>
        {state.startDate ?? 'Set a start date in plan details'} –{' '}
        {state.endDate ?? 'Set an end date in plan details'}
      </p>
      <CoverageSummary state={state} />
      <p role="status">
        {state.confirmed ? 'Brief confirmed' : 'Brief needs confirmation'}
        {state.readOnly ? ' · Read-only version' : ''}
      </p>
      {state.scheduleReviewRequired && (
        <p className="plan-panel">
          Planning inputs changed. Review the existing schedule before locking.
        </p>
      )}
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
      {state.confirmed && !state.readOnly && !editing && (
        <button onClick={() => setEditing(true)}>Edit brief</button>
      )}
      <form
        className="plan-panel"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate('save');
        }}
      >
        <fieldset disabled={disabled}>
          <legend>Running context</legend>
          <label>
            Goal
            <textarea
              value={brief.goal}
              onChange={(e) => patch('goal', e.target.value)}
              placeholder="What would you like this plan to help you achieve?"
            />
          </label>
          <label>
            Units
            <select
              value={brief.unit}
              onChange={(e) => patch('unit', e.target.value as Brief['unit'])}
            >
              <option value="kilometres">Kilometres and min/km</option>
              <option value="miles">Miles and min/mile</option>
            </select>
          </label>
          <label>
            Plan timezone
            <input
              value={brief.timezone}
              onChange={(e) => patch('timezone', e.target.value)}
              list="timezones"
            />
            <datalist id="timezones">
              {[
                'UTC',
                'Europe/London',
                'Europe/Paris',
                'America/New_York',
                'America/Los_Angeles',
                'Australia/Sydney',
              ].map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </label>
          {baseline('weeklyDistance', 'Typical weekly running distance')}
          {baseline('currentRuns', 'Current runs per week')}
          {baseline('longestRun', 'Longest recent run')}
          <label>
            Desired runs per week
            <input
              type="number"
              min="1"
              max="14"
              value={brief.desiredRuns ?? ''}
              onChange={(e) =>
                patch('desiredRuns', e.target.value === '' ? null : Number(e.target.value))
              }
            />
          </label>
          <p>Up to two runs can be scheduled on each allowed day.</p>
          <div className="brief-weekdays">
            {days.map((day, i) => (
              <label key={day}>
                {day}
                <select
                  value={brief.weekdays[i]}
                  onChange={(e) =>
                    patch(
                      'weekdays',
                      brief.weekdays.map((value, j) =>
                        i === j ? (e.target.value as Brief['weekdays'][number]) : value,
                      ),
                    )
                  }
                >
                  <option value="available">Available</option>
                  <option value="preferred">Preferred</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </label>
            ))}
          </div>
          <label>
            Constraints and context
            <textarea
              value={brief.context}
              onChange={(e) => patch('context', e.target.value)}
              placeholder="Other activities, preferences or limitations the planner should consider"
            />
          </label>
          <button className="primary-button" disabled={!dirty}>
            Save changes
          </button>
        </fieldset>
      </form>
      {!state.readOnly && editing && (
        <form
          className="plan-panel"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate('calibrate');
          }}
        >
          <fieldset disabled={mutation.isPending || dirty}>
            <legend>Update fitness</legend>
            <p>
              Use a result that represents your current fitness. Updates apply from today in your
              plan timezone.
            </p>
            {dirty && <p>Save your brief changes before updating fitness.</p>}
            <label>
              Fitness input
              <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option value="race_result">Recent race result</option>
                <option value="threshold_pace">Estimated threshold pace</option>
              </select>
            </label>
            {method === 'race_result' ? (
              <>
                <label>
                  Race distance
                  <select value={distance} onChange={(e) => setDistance(e.target.value)}>
                    <option value="5000">5K</option>
                    <option value="10000">10K</option>
                    <option value="21097.5">Half marathon</option>
                    <option value="42195">Marathon</option>
                    <option value="custom">Custom distance</option>
                  </select>
                </label>
                {distance === 'custom' && (
                  <label>
                    Distance in {brief.unit}
                    <input
                      required
                      type="number"
                      step="any"
                      min="0"
                      value={custom}
                      onChange={(e) => setCustom(e.target.value)}
                    />
                  </label>
                )}
                <label>
                  Finish time (mm:ss or hh:mm:ss)
                  <input
                    required
                    value={duration}
                    placeholder="25:00"
                    onChange={(e) => setDuration(e.target.value)}
                  />
                </label>
              </>
            ) : (
              <label>
                Threshold pace (min/{brief.unit === 'miles' ? 'mi' : 'km'})
                <input
                  required
                  value={threshold}
                  placeholder="4:30"
                  onChange={(e) => setThreshold(e.target.value)}
                />
              </label>
            )}
            <button className="primary-button">Calculate and save pace guides</button>
          </fieldset>
        </form>
      )}
      <section className="plan-panel">
        <h2>Pace guides</h2>
        <p>These are starting guides. Your training experience can inform later updates.</p>
        {state.calibrations.length ? (
          calibration(state.calibrations.at(-1)!)
        ) : (
          <p>No fitness input saved yet.</p>
        )}
      </section>
      <section className="plan-panel">
        <h2>Brief readiness</h2>
        {state.findings.length === 0 ? (
          <p>All required information is complete.</p>
        ) : (
          <ul>
            {state.findings.map((f) => (
              <li key={f.code}>
                {f.severity === 'error' ? 'Required: ' : 'Review: '}
                {f.message}
              </li>
            ))}
          </ul>
        )}
        {!state.readOnly && !state.confirmed && (
          <button
            disabled={
              dirty || mutation.isPending || state.findings.some((f) => f.severity === 'error')
            }
            onClick={() => setReview(true)}
          >
            Review brief for confirmation
          </button>
        )}
        {review && (
          <div>
            <h3>Confirm your planning inputs</h3>
            <p>
              Review the goal, availability, training background and pace guides above. These are
              the inputs your plan will use.
            </p>
            {state.findings
              .filter((f) => f.severity === 'warning')
              .map((f) => (
                <label key={f.code}>
                  <input
                    type="checkbox"
                    checked={ack.includes(f.code)}
                    onChange={(e) =>
                      setAck(
                        e.target.checked ? [...ack, f.code] : ack.filter((code) => code !== f.code),
                      )
                    }
                  />
                  {f.message}
                </label>
              ))}
            <button
              className="primary-button"
              disabled={
                dirty ||
                mutation.isPending ||
                state.findings.some((f) => f.severity === 'warning' && !ack.includes(f.code))
              }
              onClick={() => mutation.mutate('confirm')}
            >
              Confirm brief
            </button>
            <button onClick={() => setReview(false)}>Keep editing</button>
          </div>
        )}
      </section>
      <section className="plan-panel">
        <h2>Calibration history</h2>
        {state.calibrations.map((c) => (
          <details key={`${c.id}:${c.effectiveFrom}`}>
            <summary>
              {c.effectiveFrom} – {c.effectiveUntil ?? 'onward'} · {c.method.replaceAll('_', ' ')}
            </summary>
            {calibration(c)}
            {!state.readOnly && c.id !== state.calibrations.at(-1)?.id && (
              <button
                disabled={mutation.isPending || dirty}
                onClick={() => mutation.mutate(`reuse:${c.id}`)}
              >
                Use again from today
              </button>
            )}
          </details>
        ))}
      </section>
    </>
  );
}
