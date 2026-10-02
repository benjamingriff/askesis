import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { paths } from '@askesis/api-client';
type State =
  paths['/api/v1/plans/{planId}/draft/brief']['get']['responses'][200]['content']['application/json'];
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const following = (date: string, delta: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);
export function CoverageSummary({ state }: { state: State }) {
  const gaps: { start: string; end: string }[] = [];
  if (state.startDate && state.endDate && state.coverage.length) {
    let next = state.startDate;
    for (const range of state.coverage) {
      if (range.startDate > next) gaps.push({ start: next, end: following(range.startDate, -1) });
      if (range.endDate >= next) next = following(range.endDate, 1);
    }
    if (next <= state.endDate) gaps.push({ start: next, end: state.endDate });
  }
  return (
    <section aria-label="Prescribed coverage">
      <h3>Prescribed schedule</h3>
      {!!state.generations?.length && (
        <ul aria-label="Generation attempts">
          {state.generations.map((generation) => (
            <li key={generation.runId}>
              Intended horizon: {generation.startDate} – {generation.endDate}.{' '}
              {generation.status === 'completed'
                ? 'Generation completed.'
                : generation.status === 'in_progress'
                  ? 'Generation in progress.'
                  : 'Generation stopped before the intended horizon was complete.'}{' '}
              {generation.prescribedThrough
                ? `Fully prescribed through ${generation.prescribedThrough}.`
                : 'No complete coverage was recorded for this attempt.'}
            </li>
          ))}
        </ul>
      )}
      {state.coverage.length ? (
        <>
          <ul>
            {state.coverage.map((range) => (
              <li key={range.startDate}>
                {range.startDate} – {range.endDate}
                {!range.current ? ' · Planning inputs changed; review this range.' : ''}
              </li>
            ))}
          </ul>
          {!!gaps.length && (
            <>
              <p>Still unplanned:</p>
              <ul>
                {gaps.map((gap) => (
                  <li key={gap.start}>
                    {gap.start} – {gap.end}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p>
          Prescribed coverage has not been recorded. Existing workouts may be present; their dates
          do not establish a complete planning horizon.
        </p>
      )}
      <p>You can lock an initial horizon and extend the plan in a later revision.</p>
    </section>
  );
}
export function PlanningReview({ state }: { state: State }) {
  const distance = (value: number | null) =>
    value === null
      ? 'Unknown'
      : `${Number((value / (state.brief.unit === 'miles' ? 1609.344 : 1000)).toFixed(2))} ${state.brief.unit}`;
  const answer = (a: State['brief']['weeklyDistance']) =>
    a.status === 'known'
      ? distance(a.value)
      : a.status === 'unanswered'
        ? 'Not answered'
        : 'Unknown';
  const pace = state.calibrations.at(-1);
  const formatPace = (seconds: number) => {
    const rounded = Math.round(seconds * (state.brief.unit === 'miles' ? 1.609344 : 1));
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}/${state.brief.unit === 'miles' ? 'mi' : 'km'}`;
  };
  return (
    <section aria-label="Planning assumptions">
      <h3>Planning assumptions</h3>
      <p>{state.brief.goal}</p>
      <p>
        {state.startDate} – {state.endDate} · {state.brief.timezone}
      </p>
      <p>
        Current weekly distance: {answer(state.brief.weeklyDistance)}. Longest recent run:{' '}
        {answer(state.brief.longestRun)}.
      </p>
      <p>
        Current runs per week:{' '}
        {state.brief.currentRuns.status === 'known'
          ? state.brief.currentRuns.value
          : state.brief.currentRuns.status}
        . Desired runs per week: {state.brief.desiredRuns ?? 'Not answered'}.
      </p>
      <p>{state.brief.weekdays.map((value, i) => `${days[i]}: ${value}`).join(' · ')}</p>
      {!!state.brief.context && <p>{state.brief.context}</p>}
      {pace && (
        <>
          <p>
            {pace.provenance === 'agent_estimate'
              ? 'Coach-estimated pace guides'
              : pace.provenance === 'user_estimate' || pace.method === 'threshold_pace'
                ? 'Estimated pace guides'
                : 'Pace guides calculated from your race result'}
            .
          </p>
          <p>
            {pace.method === 'threshold_pace'
              ? `Estimated threshold: ${formatPace(pace.secondsPerKilometre!)}`
              : `Race evidence: ${distance(pace.distanceMetres)} in ${Math.floor(pace.durationSeconds! / 60)}:${String(pace.durationSeconds! % 60).padStart(2, '0')}`}
          </p>
          <table className="pace-guides">
            <thead>
              <tr>
                <th>Guide</th>
                <th>Target</th>
                <th>Range</th>
              </tr>
            </thead>
            <tbody>
              {pace.zones.map((zone) => (
                <tr key={zone.key}>
                  <td>{zone.key}</td>
                  <td>{formatPace(zone.target)}</td>
                  <td>
                    {formatPace(zone.fast)}–{formatPace(zone.slow)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pace.estimateBasis && <p>{pace.estimateBasis}</p>}
          {(pace.provenance !== 'user_supplied' || pace.method === 'threshold_pace') && (
            <p>These are estimates. Update the paces and plan after a few runs.</p>
          )}
        </>
      )}
      <CoverageSummary state={state} />
    </section>
  );
}

export function CurrentCoverage({
  planId,
  versionId,
  draft,
}: {
  planId: string;
  versionId: string;
  draft: boolean;
}) {
  const query = useQuery({
    queryKey: ['plans', planId, 'coverage', versionId],
    queryFn: async () => {
      const response = draft
        ? await api.GET('/api/v1/plans/{planId}/draft/brief', { params: { path: { planId } } })
        : await api.GET('/api/v1/plans/{planId}/revisions/{revisionId}/brief', {
            params: { path: { planId, revisionId: versionId } },
          });
      if (!response.data)
        throw new Error(response.error?.error.message ?? 'Could not load planning coverage.');
      return response.data;
    },
  });
  return (
    <>
      {query.data?.coverage && <CoverageSummary state={query.data} />}{' '}
      {query.error && <p role="alert">{query.error.message}</p>}
    </>
  );
}
