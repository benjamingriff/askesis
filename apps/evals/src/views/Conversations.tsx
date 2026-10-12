import { useMemo, useState } from 'react';
import { DotStrip, type StripPoint } from '../charts/DotStrip';
import { Tag, VerdictBadge } from '../components/Badges';
import { Section } from '../components/Section';
import { cohortKey, cohortLabel, promptKey, type Dimension } from '../lib/cohorts';
import { coachTokens, isFinished } from '../lib/filters';
import {
  formatDateTime,
  formatDuration,
  formatPercent,
  formatTokens,
  humanize,
  median,
} from '../lib/format';
import { countModes, modesOf, SOURCE_LABEL } from '../lib/modes';
import { modelName, reasoningShort } from '../lib/models';
import { href } from '../lib/route';
import { passHatK } from '../lib/stats';
import type { RunSummary } from '../types';
import { Stat } from './Overview';

const open = (id: string) => {
  window.location.hash = href('conversations', id);
};

const VERDICT_TONE: Record<string, string> = {
  acceptable: 'good',
  needs_revision: 'warn',
  incomplete: 'bad',
  assessment_unavailable: 'neutral',
  running: 'neutral',
};

function strip(
  runs: RunSummary[],
  pick: (run: RunSummary) => number | null,
): { points: StripPoint[]; median: number | null } {
  const points = runs.flatMap((run) => {
    const value = pick(run);
    return value === null
      ? []
      : [
          {
            id: run.id,
            value,
            tone: VERDICT_TONE[run.verdict] ?? 'neutral',
            label: `${modelName(run.coachModel)} · ${formatDateTime(run.startedAt)}`,
            hollow: run.demo,
          },
        ];
  });
  return { points, median: median(points.map((point) => point.value)) };
}

export function Conversations({
  runs,
  colors,
}: {
  runs: RunSummary[];
  colors: Map<string, string>;
}) {
  const [mode, setMode] = useState<string | null>(null);
  const [reliabilityBy, setReliabilityBy] = useState<Dimension>('prompt');
  // Aggregates describe finished conversations; the list below shows every run.
  const finished = useMemo(() => runs.filter(isFinished), [runs]);
  const withConversation = finished.filter((run) => run.conversation !== null);
  const modes = useMemo(() => countModes(finished), [finished]);
  const rows = mode ? runs.filter((run) => modesOf(run).some((entry) => entry.key === mode)) : runs;
  const activeMode = modes.find((entry) => entry.key === mode);

  if (runs.length === 0) {
    return (
      <div className="empty-state">
        <h2>No conversations match</h2>
        <p>Adjust the filters or include scripted runs from the sidebar.</p>
      </div>
    );
  }

  const stats = withConversation.map((run) => run.conversation).filter((entry) => entry !== null);
  const requiredRate =
    stats.length === 0
      ? null
      : stats.reduce(
          (sum, entry) =>
            sum +
            entry.requiredFacts.filter((fact) => entry.factsDisclosed.includes(fact)).length /
              Math.max(1, entry.requiredFacts.length),
          0,
        ) / stats.length;
  const reviewed = runs.filter((run) => run.review !== null).length;
  const facts = [...new Set(stats.flatMap((entry) => entry.factsAvailable))];
  const required = new Set(stats.flatMap((entry) => entry.requiredFacts));

  return (
    <div className="chart-feed">
      <div className="stat-strip">
        <Stat
          label="Conversations"
          value={String(runs.length)}
          sub={`${reviewed} reviewed by you`}
        />
        <Stat
          label="Required facts learned"
          value={formatPercent(requiredRate)}
          sub="mean per conversation"
        />
        <Stat
          label="Median athlete turns"
          value={String(median(stats.map((entry) => entry.athleteTurns)) ?? '—')}
        />
        <Stat
          label="Questions per coach turn"
          value={
            stats.length
              ? (
                  stats.reduce((sum, entry) => sum + entry.questions, 0) /
                  Math.max(
                    1,
                    stats.reduce((sum, entry) => sum + entry.coachTurns, 0),
                  )
                ).toFixed(2)
              : '—'
          }
        />
        <Stat
          label="Runs with assumptions"
          value={formatPercent(
            stats.length
              ? stats.filter((entry) => entry.assumptions > 0).length / stats.length
              : null,
          )}
        />
        <Stat
          label="Median time to plan"
          value={formatDuration(
            median(
              stats
                .map((entry) => entry.timeToPlanMs)
                .filter((value): value is number => value !== null),
            ),
          )}
        />
      </div>

      <Section
        id="failure-modes"
        title="What goes wrong"
        description="Each problem counted once per conversation, from exact checks, the reviewer, transcript flags and your reviews. Click one to filter the list."
      >
        {modes.length === 0 ? (
          <p className="muted">Nothing flagged in the visible conversations.</p>
        ) : (
          <ul className="mode-list">
            {modes.slice(0, 14).map((entry) => {
              const share = entry.runs.length / finished.length;
              return (
                <li key={entry.key}>
                  <button
                    type="button"
                    className={`mode-row${mode === entry.key ? ' active' : ''}`}
                    onClick={() => setMode(mode === entry.key ? null : entry.key)}
                  >
                    <span className={`flag-glyph flag-${entry.severity}`}>
                      {entry.severity === 'critical'
                        ? '✕'
                        : entry.severity === 'warning'
                          ? '!'
                          : 'i'}
                    </span>
                    <span className="mode-label">{entry.label}</span>
                    <span className="mode-source">{SOURCE_LABEL[entry.source]}</span>
                    <span className="mode-track">
                      <span
                        className={`mode-fill sev-${entry.severity}`}
                        style={{ width: `${share * 100}%` }}
                      />
                    </span>
                    <span className="mode-count">
                      {entry.runs.length}/{finished.length}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        id="discovery-funnel"
        title="Discovery funnel"
        description="How often each scenario fact was disclosed, and how many athlete turns it took. Undisclosed required facts fail the discovery check."
      >
        {facts.length === 0 ? (
          <p className="muted">No disclosure data.</p>
        ) : (
          <ul className="funnel">
            {facts.map((fact) => {
              const disclosed = stats.filter((entry) => entry.factsDisclosed.includes(fact)).length;
              const share = disclosed / Math.max(1, stats.length);
              return (
                <li key={fact}>
                  <span className="funnel-label">
                    {humanize(fact)}
                    {required.has(fact) && <span className="required">required</span>}
                  </span>
                  <span className="mode-track">
                    <span className="mode-fill sev-accent" style={{ width: `${share * 100}%` }} />
                  </span>
                  <span className={`mode-count${required.has(fact) && share < 1 ? ' short' : ''}`}>
                    {formatPercent(share)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        id="behaviour"
        title="Behaviour"
        description="One dot per conversation, coloured by verdict; the line marks the median. Click a dot to open it."
      >
        <div className="behaviour-grid">
          {[
            {
              label: 'Athlete turns',
              ...strip(withConversation, (run) => run.conversation?.athleteTurns ?? null),
              format: (value: number) => String(Math.round(value)),
            },
            {
              label: 'Questions asked',
              ...strip(withConversation, (run) => run.conversation?.questions ?? null),
              format: (value: number) => String(Math.round(value)),
            },
            {
              label: 'Assumed fields',
              ...strip(withConversation, (run) => run.conversation?.assumptions ?? null),
              format: (value: number) => String(Math.round(value)),
            },
            {
              label: 'Time to first plan save',
              ...strip(withConversation, (run) => run.conversation?.timeToPlanMs ?? null),
              format: (value: number) => formatDuration(value),
            },
            {
              label: 'Coach tokens',
              ...strip(finished, (run) => coachTokens(run) || null),
              format: formatTokens,
            },
            {
              label: 'Brief edits',
              ...strip(withConversation, (run) => run.conversation?.briefEdits ?? null),
              format: (value: number) => String(Math.round(value)),
            },
          ].map((panel) => (
            <div key={panel.label} className="behaviour-panel">
              <div className="behaviour-head">
                <span>{panel.label}</span>
                <strong>{panel.median === null ? '—' : panel.format(panel.median)}</strong>
              </div>
              <DotStrip
                points={panel.points}
                median={panel.median}
                format={panel.format}
                onSelect={open}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="reliability"
        title="Reliability"
        description="pass@1 is the share of runs judged acceptable. pass^k (τ-bench) estimates the chance that k repeat runs of the same scenario all succeed. Consistency matters as much as the average."
        aside={
          <div className="chart-scale" role="group" aria-label="Group reliability by">
            {(['prompt', 'variant', 'model'] as Dimension[]).map((dimension) => (
              <button
                key={dimension}
                aria-pressed={reliabilityBy === dimension}
                onClick={() => setReliabilityBy(dimension)}
              >
                {dimension === 'variant' ? 'Model + reasoning' : humanize(dimension)}
              </button>
            ))}
          </div>
        }
      >
        <ReliabilityTable runs={finished} dimension={reliabilityBy} />
      </Section>

      <Section
        id="conversation-list"
        title="Conversations"
        description="Newest first. Open one to step through the transcript, decisions and plan."
        aside={
          activeMode && (
            <button type="button" className="filter-chip" onClick={() => setMode(null)}>
              {activeMode.label} ×
            </button>
          )
        }
      >
        <div className="table-wrap">
          <table className="runs-table conversation-table">
            <thead>
              <tr>
                <th>Verdict</th>
                <th>Started</th>
                <th>Coach · prompt</th>
                <th className="numeric">Turns</th>
                <th className="numeric">Questions</th>
                <th>Facts</th>
                <th className="numeric">Assumed</th>
                <th>Flags</th>
                <th className="numeric">To plan</th>
                <th>You</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((run) => {
                const c = run.conversation;
                const requiredFound = c
                  ? c.requiredFacts.filter((fact) => c.factsDisclosed.includes(fact)).length
                  : 0;
                const severity = (level: string) =>
                  run.flags.filter((flag) => flag.severity === level).length;
                return (
                  <tr key={run.id} onClick={() => open(run.id)}>
                    <td>
                      <a
                        href={href('conversations', run.id)}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <VerdictBadge verdict={run.verdict} />
                      </a>
                    </td>
                    <td className="muted nowrap">{formatDateTime(run.startedAt)}</td>
                    <td className="nowrap">
                      <i className="model-dot" style={{ background: colors.get(run.coachModel) }} />
                      {modelName(run.coachModel)}
                      <span className="effort">{reasoningShort(run.reasoning)}</span>
                      <span className="prompt-label">{promptKey(run)}</span>
                    </td>
                    <td className="numeric">{c ? c.athleteTurns : '—'}</td>
                    <td className="numeric">
                      {c ? c.questions : '—'}
                      {c && c.maxQuestionsPerTurn > 1 && (
                        <span className="muted"> (max {c.maxQuestionsPerTurn})</span>
                      )}
                    </td>
                    <td>
                      {c ? (
                        <span
                          className="fact-pips"
                          title={`Disclosed: ${c.factsDisclosed.join(', ') || 'none'}`}
                        >
                          {c.factsAvailable.map((fact) => (
                            <i
                              key={fact}
                              className={`fact-pip${c.factsDisclosed.includes(fact) ? ' on' : ''}${c.requiredFacts.includes(fact) ? ' required' : ''}`}
                            />
                          ))}
                          <span className="muted">
                            {requiredFound}/{c.requiredFacts.length}
                          </span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="numeric">{c ? c.assumptions : '—'}</td>
                    <td>
                      <span className="flag-counts">
                        {severity('critical') > 0 && (
                          <span className="flag-count flag-critical">{severity('critical')}</span>
                        )}
                        {severity('warning') > 0 && (
                          <span className="flag-count flag-warning">{severity('warning')}</span>
                        )}
                        {severity('info') > 0 && (
                          <span className="flag-count flag-info">{severity('info')}</span>
                        )}
                        {run.flags.length === 0 && <span className="muted">—</span>}
                      </span>
                    </td>
                    <td className="numeric">{c?.turnsToPlan ?? '—'}</td>
                    <td>
                      {run.review?.verdict ? (
                        <span className={`human-verdict human-${run.review.verdict}`}>
                          {humanize(run.review.verdict)}
                        </span>
                      ) : run.demo ? (
                        <Tag tone="accent">demo</Tag>
                      ) : run.scripted ? (
                        <Tag>scripted</Tag>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function ReliabilityTable({ runs, dimension }: { runs: RunSummary[]; dimension: Dimension }) {
  const groups = new Map<string, RunSummary[]>();
  for (const run of runs) {
    const key = `${run.scenarioId}::${cohortKey(run, dimension)}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  const rows = [...groups.entries()]
    .map(([key, list]) => {
      const [scenario, cohort] = key.split('::');
      const successes = list.filter((run) => run.verdict === 'acceptable').length;
      return {
        key,
        scenario: scenario ?? '',
        cohort: cohort ?? '',
        n: list.length,
        successes,
        demo: list.every((run) => run.demo),
      };
    })
    .sort((a, b) => a.scenario.localeCompare(b.scenario) || b.n - a.n);
  return (
    <div className="table-wrap">
      <table className="runs-table reliability-table">
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Cohort</th>
            <th className="numeric">Runs</th>
            <th className="numeric">pass@1</th>
            <th className="numeric">pass^3</th>
            <th className="numeric">pass^5</th>
            <th>Outcomes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const list = groups.get(row.key) ?? [];
            const k3 = passHatK(row.successes, row.n, 3);
            const k5 = passHatK(row.successes, row.n, 5);
            return (
              <tr key={row.key}>
                <td className="mono">{row.scenario}</td>
                <td>
                  {cohortLabel(row.cohort, dimension)} {row.demo && <Tag tone="accent">demo</Tag>}
                </td>
                <td className="numeric">{row.n}</td>
                <td className="numeric">{formatPercent(row.successes / row.n)}</td>
                <td className="numeric">
                  {k3 === null ? <span className="muted">n&lt;3</span> : formatPercent(k3)}
                </td>
                <td className="numeric">
                  {k5 === null ? <span className="muted">n&lt;5</span> : formatPercent(k5)}
                </td>
                <td>
                  <span className="outcome-squares">
                    {list
                      .slice()
                      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
                      .map((run) => (
                        <a
                          key={run.id}
                          href={href('conversations', run.id)}
                          className={`square square-${VERDICT_TONE[run.verdict] === 'good' ? 'pass' : VERDICT_TONE[run.verdict] === 'warn' ? 'uncertain' : VERDICT_TONE[run.verdict] === 'bad' ? 'fail' : 'error'}`}
                          title={`${run.verdict} · ${formatDateTime(run.startedAt)}`}
                        />
                      ))}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
