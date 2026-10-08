import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  Lock,
  PencilLine,
  Save,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useBeforeUnload, useBlocker, useParams } from 'react-router';
import { api } from '../api';
import { PlanZones, zonesTitle } from '../components/PlanWidgets';
import { CoverageSummary } from '../components/PlanningReview';
import {
  Button,
  Card,
  CheckRow,
  Dialog,
  ErrorState,
  LoadingState,
  Notice,
  Pill,
  SectionHeader,
  Segmented,
  cx,
} from '../components/ui';
import { formatShortYear, METRES_PER_YARD, WEEKDAYS_LONG } from '../lib/format';
import { BRIEF_SPORTS, SPORT_META, type BriefSport } from '../lib/sports';
import { result } from '../lib/result';
import { useRequestKey } from '../lib/use-request-key';
import { type BriefState } from '../plan-data';
import { useSportUnits, useUnits } from '../settings';

type State = BriefState;
type Brief = State['brief'];
type Availability = Brief['weekdays'][number];
type Baseline = Brief['sports'][number];
type Answer = Baseline['currentSessions'];

const unanswered = { status: 'unanswered', value: null } as const;
/** A sport's baseline before any question is answered, matching the API's empty baseline. */
export function emptyBaseline(sport: BriefSport): Baseline {
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
    <div className="page brief-page">
      <Link
        to={revisionId ? `/plans/${planId}/versions/${revisionId}` : `/plans/${planId}`}
        className="back-link"
      >
        <ArrowLeft size={15} aria-hidden="true" /> {revisionId ? 'Version details' : 'Plan details'}
      </Link>
      {query.isPending ? <LoadingState>Loading brief…</LoadingState> : null}
      {query.error ? (
        <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : null}
      {query.data ? (
        <BriefEditor
          key={`${query.data.versionId}:${query.data.editNumber}:${query.data.confirmed}`}
          state={query.data}
          planId={planId}
        />
      ) : null}
    </div>
  );
}

function BriefEditor({ state, planId }: { state: State; planId: string }) {
  const client = useQueryClient();
  const [brief, setBrief] = useState<Brief>(state.brief);
  const [editing, setEditing] = useState(!state.confirmed);
  const [review, setReview] = useState(false);
  const [ack, setAck] = useState<string[]>([]);
  const command = { expectedDraftId: state.versionId, expectedEditNumber: state.editNumber };
  const params = { path: { planId } };
  const dirty = JSON.stringify(brief) !== JSON.stringify(state.brief);
  const requestKey = useRequestKey();
  const blocker = useBlocker(dirty);
  const units = useUnits(state.brief.unit);
  const { pool } = useSportUnits();
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
  /** One answer: known with a value in display units, unknown, or not answered. */
  const answerField = (
    label: string,
    answer: Answer,
    onChange: (answer: Answer) => void,
    { unit, factor = 1, whole = false }: { unit?: string; factor?: number; whole?: boolean } = {},
  ) => (
    <div className="field baseline" key={label}>
      <span>
        {label}
        {unit ? ` (${unit})` : ''}
      </span>
      <div className="baseline-row">
        <Segmented<Answer['status']>
          label={`${label} answer`}
          value={answer.status}
          onChange={(status) =>
            onChange(
              status === 'known'
                ? { status: 'known', value: answer.status === 'known' ? answer.value : 0 }
                : { status, value: null },
            )
          }
          options={[
            { value: 'known', label: 'Known', disabled },
            { value: 'unknown', label: 'Unknown', disabled },
            { value: 'unanswered', label: 'Not answered', disabled },
          ]}
        />
        {answer.status === 'known' ? (
          <input
            aria-label={label}
            type="number"
            min="0"
            disabled={disabled}
            step={whole ? '1' : 'any'}
            value={Number((answer.value / factor).toFixed(6))}
            onChange={(e) => onChange({ status: 'known', value: Number(e.target.value) * factor })}
          />
        ) : null}
      </div>
    </div>
  );
  const sportFields = (baseline: Baseline) => {
    const noun = SPORT_META[baseline.sport].noun;
    const update = (changes: Partial<Baseline>) =>
      setSport(baseline.sport, { ...baseline, ...changes } as Baseline);
    const distance =
      baseline.sport === 'swim'
        ? { unit: pool === 'yd' ? 'yards' : 'metres', factor: pool === 'yd' ? METRES_PER_YARD : 1 }
        : { unit: brief.unit, factor: brief.unit === 'miles' ? 1609.344 : 1000 };
    const hours = { unit: 'hours', factor: 3600 };
    return (
      <fieldset disabled={disabled} className="card" key={baseline.sport}>
        <legend>{SPORT_HEADINGS[baseline.sport]}</legend>
        {answerField(
          `Current ${noun} sessions per week`,
          baseline.currentSessions,
          (currentSessions) => update({ currentSessions }),
          { whole: true },
        )}
        {baseline.sport === 'cycle' ? (
          <>
            {answerField(
              'Typical weekly riding time',
              baseline.weeklyDuration,
              (weeklyDuration) => update({ weeklyDuration }),
              hours,
            )}
            {answerField(
              'Longest recent ride',
              baseline.longestDuration,
              (longestDuration) => update({ longestDuration }),
              hours,
            )}
          </>
        ) : baseline.sport !== 'strength' ? (
          <>
            {answerField(
              `Typical weekly ${noun} distance`,
              baseline.weeklyDistance,
              (weeklyDistance) => update({ weeklyDistance }),
              distance,
            )}
            {answerField(
              baseline.sport === 'run' ? 'Longest recent run' : 'Longest recent swim',
              baseline.longestDistance,
              (longestDistance) => update({ longestDistance }),
              distance,
            )}
          </>
        ) : null}
        <label className="field narrow">
          <span>Desired {noun} sessions per week</span>
          <input
            type="number"
            min="1"
            max="14"
            value={baseline.desiredSessions ?? ''}
            onChange={(e) =>
              update({ desiredSessions: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
        </label>
      </fieldset>
    );
  };
  const errors = state.findings.filter((f) => f.severity === 'error');
  const warnings = state.findings.filter((f) => f.severity === 'warning');
  return (
    <>
      <header className="page-header">
        <div className="page-heading">
          <span className="label">Plan brief</span>
          <h1>Plan brief</h1>
          <div className="plan-meta">
            {state.readOnly ? (
              <Pill tone="locked" icon={Lock}>
                Read-only version
              </Pill>
            ) : null}
            <span role="status">
              {state.confirmed ? (
                <Pill tone="locked" icon={CheckCircle2}>
                  Brief confirmed
                </Pill>
              ) : (
                <Pill tone="warning" icon={TriangleAlert}>
                  Brief needs confirmation
                </Pill>
              )}
            </span>
            <span className="muted">
              {state.startDate
                ? formatShortYear(state.startDate)
                : 'Set a start date in plan details'}{' '}
              – {state.endDate ? formatShortYear(state.endDate) : 'Set an end date in plan details'}
            </span>
          </div>
        </div>
        {state.confirmed && !state.readOnly && !editing ? (
          <Button icon={PencilLine} onClick={() => setEditing(true)}>
            Edit brief
          </Button>
        ) : null}
      </header>
      {state.scheduleReviewRequired ? (
        <Notice tone="warning" icon={TriangleAlert}>
          Planning inputs changed. Review the existing schedule before locking.
        </Notice>
      ) : null}
      {mutation.error ? (
        <Notice
          tone="danger"
          role="alert"
          action={
            mutation.variables === 'confirm' ? (
              <Button
                size="sm"
                onClick={() =>
                  void client.invalidateQueries({ queryKey: ['plans', planId, 'brief'] })
                }
              >
                Refresh latest brief
              </Button>
            ) : undefined
          }
        >
          {mutation.error.message}
        </Notice>
      ) : null}
      <div className="brief-layout">
        <div className="brief-main">
          <form
            className="brief-form"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate('save');
            }}
          >
            <fieldset disabled={disabled} className="card">
              <legend>Goal</legend>
              <label className="field">
                <span>Goal</span>
                <textarea
                  value={brief.goal}
                  rows={3}
                  onChange={(e) => patch('goal', e.target.value)}
                  placeholder="What would you like this plan to help you achieve?"
                />
              </label>
              <label className="field narrow">
                <span>Units</span>
                <select
                  value={brief.unit}
                  onChange={(e) => patch('unit', e.target.value as Brief['unit'])}
                >
                  <option value="kilometres">Kilometres and min/km</option>
                  <option value="miles">Miles and min/mile</option>
                </select>
              </label>
            </fieldset>
            <fieldset disabled={disabled} className="card">
              <legend>Sports</legend>
              <p className="muted">Choose every sport this plan trains.</p>
              <div className="sport-chips" role="group" aria-label="Sports in this plan">
                {BRIEF_SPORTS.map((sport) => {
                  const meta = SPORT_META[sport];
                  const selected = brief.sports.some((current) => current.sport === sport);
                  return (
                    <button
                      key={sport}
                      type="button"
                      className={cx('sport-chip', selected && 'selected')}
                      aria-pressed={selected}
                      onClick={() => setSport(sport, selected ? null : emptyBaseline(sport))}
                    >
                      <meta.icon size={16} aria-hidden="true" />
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            {brief.sports.map(sportFields)}
            <fieldset disabled={disabled} className="card">
              <legend>Weekly availability</legend>
              <p className="muted">
                Tap a day to cycle between available, preferred and unavailable. Up to two sessions
                can be scheduled on each allowed day.
              </p>
              <div className="weekday-chips">
                {WEEKDAYS_LONG.map((day, i) => {
                  const value = brief.weekdays[i]!;
                  return (
                    <button
                      key={day}
                      type="button"
                      className={cx('weekday-chip', value)}
                      aria-label={`${day}: ${value}`}
                      title={`${day}: ${value}`}
                      onClick={() =>
                        patch(
                          'weekdays',
                          brief.weekdays.map((current, j) =>
                            i === j ? NEXT_AVAILABILITY[current] : current,
                          ),
                        )
                      }
                    >
                      <strong>{day.slice(0, 3)}</strong>
                      <small>{value}</small>
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <fieldset disabled={disabled} className="card">
              <legend>Constraints and context</legend>
              <label className="field">
                <span className="sr-only">Constraints and context</span>
                <textarea
                  value={brief.context}
                  rows={4}
                  onChange={(e) => patch('context', e.target.value)}
                  placeholder="Other activities, preferences or limitations the planner should consider"
                />
              </label>
            </fieldset>
            {!disabled ? (
              <div className={cx('save-bar', dirty && 'dirty')}>
                <span className="muted">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
                <Button variant="primary" type="submit" icon={Save} disabled={!dirty}>
                  Save changes
                </Button>
              </div>
            ) : null}
          </form>
        </div>

        <aside className="brief-side">
          <Card>
            <SectionHeader
              title={zonesTitle(brief.sports.map((baseline) => baseline.sport))}
              action={
                <Link className="text-link" to="/performance">
                  Update
                </Link>
              }
            />
            <PlanZones
              sports={brief.sports.map((baseline) => baseline.sport)}
              units={units}
              compact
            />
            <p className="muted">
              Zones belong to you and apply to every plan, so they are not part of this brief.
            </p>
          </Card>
          <Card>
            <h2 className="card-title">Brief readiness</h2>
            {state.findings.length === 0 ? (
              <p className="confirmed">
                <CheckCircle2 size={16} aria-hidden="true" /> All required information is complete.
              </p>
            ) : (
              <ul className="finding-list">
                {errors.map((f) => (
                  <li key={f.code} className="error">
                    <CircleAlert size={16} aria-hidden="true" />
                    <span>Required: {f.message}</span>
                  </li>
                ))}
                {warnings.map((f) => (
                  <li key={f.code} className="warning">
                    <TriangleAlert size={16} aria-hidden="true" />
                    <span>Review: {f.message}</span>
                  </li>
                ))}
              </ul>
            )}
            {!state.readOnly && !state.confirmed ? (
              <Button
                variant="primary"
                icon={ClipboardCheck}
                disabled={dirty || mutation.isPending || errors.length > 0}
                onClick={() => setReview(true)}
              >
                Review brief for confirmation
              </Button>
            ) : null}
          </Card>
          <Card>
            <CoverageSummary state={state} />
          </Card>
        </aside>
      </div>

      <Dialog
        open={review}
        busy={mutation.isPending}
        onClose={() => setReview(false)}
        title="Confirm your planning inputs"
        description="Review the goal, availability and training background. These are the inputs your plan will use. Only you can confirm them."
        footer={
          <>
            <Button variant="ghost" disabled={mutation.isPending} onClick={() => setReview(false)}>
              Keep editing
            </Button>
            <Button
              variant="primary"
              icon={ClipboardCheck}
              busy={mutation.isPending}
              disabled={dirty || mutation.isPending || warnings.some((f) => !ack.includes(f.code))}
              onClick={() => mutation.mutate('confirm', { onSuccess: () => setReview(false) })}
            >
              Confirm brief
            </Button>
          </>
        }
      >
        {warnings.length ? (
          <div className="form-stack">
            {warnings.map((f) => (
              <CheckRow
                key={f.code}
                checked={ack.includes(f.code)}
                onChange={(checked) =>
                  setAck(checked ? [...ack, f.code] : ack.filter((code) => code !== f.code))
                }
                label={f.message}
              />
            ))}
          </div>
        ) : (
          <p className="confirmed">
            <CheckCircle2 size={16} aria-hidden="true" /> No warnings to acknowledge.
          </p>
        )}
      </Dialog>
      <Dialog
        open={blocker.state === 'blocked'}
        size="sm"
        onClose={() => blocker.reset?.()}
        title="Leave without saving?"
        footer={
          <>
            <Button variant="ghost" onClick={() => blocker.reset?.()}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              Leave without saving
            </Button>
          </>
        }
      >
        <p>Your unsaved brief changes will be lost.</p>
      </Dialog>
    </>
  );
}
