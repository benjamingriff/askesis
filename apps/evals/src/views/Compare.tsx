import { useMemo, useState } from 'react';
import { DotStrip } from '../charts/DotStrip';
import { Tag } from '../components/Badges';
import { Section } from '../components/Section';
import { cohortKey, cohortLabel, cohorts, DIMENSIONS, type Dimension } from '../lib/cohorts';
import { coachTokens, isFinished } from '../lib/filters';
import { formatDuration, formatPercent, formatTokens, humanize, median } from '../lib/format';
import { countModes, SOURCE_LABEL } from '../lib/modes';
import { href } from '../lib/route';
import { compare, mean, rate, type Comparison, type Estimate } from '../lib/stats';
import { CRITERIA, type RunSummary } from '../types';

interface Metric {
  id: string;
  group: string;
  label: string;
  kind: 'rate' | 'mean';
  /** null: a change is worth seeing but has no inherent direction. */
  higherIsBetter: boolean | null;
  format: (value: number) => string;
  estimate: (runs: RunSummary[]) => Estimate | null;
}

function share(runs: RunSummary[], include: (run: RunSummary) => boolean | null): Estimate | null {
  const eligible = runs.map(include).filter((value): value is boolean => value !== null);
  return rate(eligible.filter(Boolean).length, eligible.length);
}

function average(runs: RunSummary[], pick: (run: RunSummary) => number | null): Estimate | null {
  return mean(runs.map(pick).filter((value): value is number => value !== null));
}

const pct = (value: number) => formatPercent(value);
const count = (value: number) => value.toFixed(value >= 10 ? 0 : 1);

function metrics(checkIds: string[]): Metric[] {
  return [
    {
      id: 'acceptable',
      group: 'Outcome',
      label: 'Acceptable',
      kind: 'rate',
      higherIsBetter: true,
      format: pct,
      estimate: (runs) => share(runs, (run) => run.verdict === 'acceptable'),
    },
    {
      id: 'completed',
      group: 'Outcome',
      label: 'Ran to completion',
      kind: 'rate',
      higherIsBetter: true,
      format: pct,
      estimate: (runs) => share(runs, (run) => run.stopReason === 'completed'),
    },
    {
      id: 'score',
      group: 'Outcome',
      label: 'Quality score',
      kind: 'mean',
      higherIsBetter: true,
      format: pct,
      estimate: (runs) => average(runs, (run) => run.score),
    },
    ...CRITERIA.map((criterion): Metric => ({
      id: `criterion:${criterion}`,
      group: 'Reviewer criteria (pass rate)',
      label: humanize(criterion),
      kind: 'rate',
      higherIsBetter: true,
      format: pct,
      estimate: (runs) =>
        share(runs, (run) => {
          const result = run.criteria.find((item) => item.criterion === criterion)?.result;
          return result === undefined ? null : result === 'pass';
        }),
    })),
    ...checkIds.map((id): Metric => ({
      id: `check:${id}`,
      group: 'Exact checks (pass rate)',
      label: humanize(id),
      kind: 'rate',
      higherIsBetter: true,
      format: pct,
      estimate: (runs) =>
        share(runs, (run) => {
          const status = run.checks.find((check) => check.id === id)?.status;
          return status === undefined || status === 'skipped' ? null : status === 'pass';
        }),
    })),
    {
      id: 'required',
      group: 'Conversation',
      label: 'All required facts learned',
      kind: 'rate',
      higherIsBetter: true,
      format: pct,
      estimate: (runs) =>
        share(runs, (run) =>
          run.conversation
            ? run.conversation.requiredFacts.every((fact) =>
                run.conversation?.factsDisclosed.includes(fact),
              )
            : null,
        ),
    },
    {
      id: 'assumptions',
      group: 'Conversation',
      label: 'Fields assumed before told',
      kind: 'mean',
      higherIsBetter: false,
      format: count,
      estimate: (runs) => average(runs, (run) => run.conversation?.assumptions ?? null),
    },
    {
      id: 'nudges',
      group: 'Conversation',
      label: 'Athlete had to ask for the plan',
      kind: 'rate',
      higherIsBetter: false,
      format: pct,
      estimate: (runs) =>
        share(runs, (run) => (run.conversation ? run.conversation.nudges > 0 : null)),
    },
    {
      id: 'multi',
      group: 'Conversation',
      label: 'Asked several questions at once',
      kind: 'rate',
      higherIsBetter: false,
      format: pct,
      estimate: (runs) =>
        share(runs, (run) => (run.conversation ? run.conversation.multiQuestionTurns > 0 : null)),
    },
    {
      id: 'turns',
      group: 'Conversation',
      label: 'Athlete turns',
      kind: 'mean',
      higherIsBetter: null,
      format: count,
      estimate: (runs) => average(runs, (run) => run.conversation?.athleteTurns ?? null),
    },
    {
      id: 'questions',
      group: 'Conversation',
      label: 'Questions asked',
      kind: 'mean',
      higherIsBetter: null,
      format: count,
      estimate: (runs) => average(runs, (run) => run.conversation?.questions ?? null),
    },
    {
      id: 'toPlan',
      group: 'Conversation',
      label: 'Athlete turns to first plan',
      kind: 'mean',
      higherIsBetter: false,
      format: count,
      estimate: (runs) => average(runs, (run) => run.conversation?.turnsToPlan ?? null),
    },
    {
      id: 'tokens',
      group: 'Cost',
      label: 'Coach tokens',
      kind: 'mean',
      higherIsBetter: false,
      format: formatTokens,
      estimate: (runs) => average(runs, (run) => coachTokens(run) || null),
    },
    {
      id: 'time',
      group: 'Cost',
      label: 'Wall time',
      kind: 'mean',
      higherIsBetter: false,
      format: (value) => formatDuration(value),
      estimate: (runs) => average(runs, (run) => run.durationMs),
    },
    {
      id: 'fit',
      group: 'Your reviews',
      label: 'Judged fit for purpose',
      kind: 'rate',
      higherIsBetter: true,
      format: pct,
      estimate: (runs) =>
        share(runs, (run) => (run.review?.verdict ? run.review.verdict === 'fit' : null)),
    },
  ];
}

const VERDICT_TEXT: Record<Comparison | 'different', string> = {
  improvement: 'Better',
  regression: 'Worse',
  inconclusive: 'Inconclusive',
  tie: 'Same',
  insufficient: 'Too few runs',
  different: 'Changed',
};

function verdictOf(
  metric: Metric,
  baseline: Estimate | null,
  candidate: Estimate | null,
): Comparison | 'different' {
  const result = compare(baseline, candidate, metric.higherIsBetter ?? true);
  if (metric.higherIsBetter === null && (result === 'improvement' || result === 'regression'))
    return 'different';
  return result;
}

/** Baseline and candidate intervals on one axis, forest-plot style. */
function IntervalBar({
  baseline,
  candidate,
  domain,
}: {
  baseline: Estimate | null;
  candidate: Estimate | null;
  domain: [number, number];
}) {
  const width = 150;
  const span = domain[1] - domain[0] || 1;
  const x = (value: number) => 4 + ((value - domain[0]) / span) * (width - 8);
  return (
    <svg width={width} height={22} className="interval-bar" aria-hidden="true">
      <line x1={4} x2={width - 4} y1={11} y2={11} className="interval-axis" />
      {baseline && (
        <g className="interval-baseline">
          <line x1={x(baseline.low)} x2={x(baseline.high)} y1={7} y2={7} />
          <circle cx={x(baseline.value)} cy={7} r={3} />
        </g>
      )}
      {candidate && (
        <g className="interval-candidate">
          <line x1={x(candidate.low)} x2={x(candidate.high)} y1={15} y2={15} />
          <circle cx={x(candidate.value)} cy={15} r={3} />
        </g>
      )}
    </svg>
  );
}

function CohortPicker({
  label,
  value,
  options,
  onChange,
  dimension,
}: {
  label: string;
  value: string;
  options: { key: string; runs: RunSummary[] }[];
  onChange: (key: string) => void;
  dimension: Dimension;
}) {
  return (
    <label className="cohort-picker">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {cohortLabel(option.key, dimension)} ({option.runs.length} runs
            {option.runs.every((run) => run.demo) ? ', demo' : ''})
          </option>
        ))}
      </select>
    </label>
  );
}

export function Compare({
  runs,
  demoAvailable,
  onEnableDemo,
}: {
  runs: RunSummary[];
  demoAvailable: boolean;
  onEnableDemo: () => void;
}) {
  const [dimension, setDimension] = useState<Dimension>('prompt');
  const [picked, setPicked] = useState<{ baseline: string | null; candidate: string | null }>({
    baseline: null,
    candidate: null,
  });
  const [allChecks, setAllChecks] = useState(false);
  const [match, setMatch] = useState(true);
  const [stratumPick, setStratumPick] = useState<string | null>(null);
  // Outcomes only exist for finished runs; unfinished ones would count as failures.
  const finished = useMemo(() => runs.filter(isFinished), [runs]);
  const unfinished = runs.length - finished.length;
  const options = useMemo(() => cohorts(finished, dimension), [finished, dimension]);
  // Default to the established cohort (most runs) as baseline and the newest
  // other cohort as the candidate.
  const largest = [...options].sort((a, b) => b.runs.length - a.runs.length)[0]?.key ?? null;
  const baselineKey = options.some((option) => option.key === picked.baseline)
    ? picked.baseline
    : picked.candidate === largest
      ? (options.find((option) => option.key !== largest)?.key ?? null)
      : largest;
  const candidateKey = options.some(
    (option) => option.key === picked.candidate && option.key !== baselineKey,
  )
    ? picked.candidate
    : (options.find((option) => option.key !== baselineKey)?.key ?? null);
  const rawBaseline = options.find((option) => option.key === baselineKey)?.runs ?? [];
  const rawCandidate = options.find((option) => option.key === candidateKey)?.runs ?? [];

  // Hold the other main lever constant, otherwise a prompt comparison silently
  // includes model differences (and vice versa).
  const matchDimension: Dimension = ['model', 'reasoning', 'variant'].includes(dimension)
    ? 'prompt'
    : 'variant';
  // Compare within one shared stratum. Pooling several strata would let their
  // different proportions in each cohort masquerade as a prompt (or model) effect.
  const count = (list: RunSummary[], key: string) =>
    list.filter((run) => cohortKey(run, matchDimension) === key).length;
  const strata = [...new Set(rawBaseline.map((run) => cohortKey(run, matchDimension)))]
    .filter((key) => count(rawCandidate, key) > 0)
    .sort(
      (a, b) =>
        Math.min(count(rawBaseline, b), count(rawCandidate, b)) -
        Math.min(count(rawBaseline, a), count(rawCandidate, a)),
    );
  const stratum = strata.includes(stratumPick ?? '') ? stratumPick : (strata[0] ?? null);
  const matching = match && stratum !== null;
  const inStratum = (run: RunSummary) => cohortKey(run, matchDimension) === stratum;
  const baseline = matching ? rawBaseline.filter(inStratum) : rawBaseline;
  const candidate = matching ? rawCandidate.filter(inStratum) : rawCandidate;
  const excluded = rawBaseline.length - baseline.length + (rawCandidate.length - candidate.length);

  const checkIds = [...new Set(runs.flatMap((run) => run.checks.map((check) => check.id)))];
  const rows = metrics(checkIds).map((metric) => {
    const b = metric.estimate(baseline);
    const c = metric.estimate(candidate);
    return { metric, baseline: b, candidate: c, verdict: verdictOf(metric, b, c) };
  });
  const visibleRows = rows.filter((row) => {
    if (!row.metric.id.startsWith('check:') || allChecks)
      return row.baseline !== null || row.candidate !== null;
    // Hide checks that every run passes in both cohorts.
    return (
      (row.baseline !== null && row.baseline.value < 1) ||
      (row.candidate !== null && row.candidate.value < 1)
    );
  });
  const groups = [...new Set(visibleRows.map((row) => row.metric.group))];
  const tally = rows.reduce<Record<string, number>>(
    (acc, row) => ({ ...acc, [row.verdict]: (acc[row.verdict] ?? 0) + 1 }),
    {},
  );

  const dimensionPicker = (
    <div className="segmented compare-dimension" role="group" aria-label="Compare by">
      {DIMENSIONS.map((entry) => (
        <button
          key={entry.id}
          aria-pressed={dimension === entry.id}
          onClick={() => {
            setDimension(entry.id);
            setPicked({ baseline: null, candidate: null });
            setStratumPick(null);
          }}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );

  if (options.length < 2) {
    return (
      <div className="chart-feed">
        <div className="compare-controls">{dimensionPicker}</div>
        <div className="empty-state">
          <h2>
            Only one {DIMENSIONS.find((entry) => entry.id === dimension)?.label.toLowerCase()}{' '}
            cohort in view
          </h2>
          <p>
            Comparisons need at least two cohorts, for example the current prompt and a candidate.
            Every run records its prompt version and hash, so runs from a new prompt appear here
            automatically.
          </p>
          {demoAvailable && (
            <button className="callout-button" onClick={onEnableDemo}>
              Preview with demo data (v3 vs v4-draft prompt)
            </button>
          )}
        </div>
      </div>
    );
  }

  const lowN = baseline.length < 5 || candidate.length < 5;
  const modeRows = (() => {
    const base = countModes(baseline);
    const cand = countModes(candidate);
    const keys = [...new Set([...base, ...cand].map((mode) => mode.key))];
    return keys
      .map((key) => {
        const b = base.find((mode) => mode.key === key);
        const c = cand.find((mode) => mode.key === key);
        const info = b ?? c;
        const bRate = rate(b?.runs.length ?? 0, baseline.length);
        const cRate = rate(c?.runs.length ?? 0, candidate.length);
        return {
          key,
          label: info?.label ?? key,
          source: info?.source ?? 'flag',
          baseline: bRate,
          candidate: cRate,
          delta: (cRate?.value ?? 0) - (bRate?.value ?? 0),
          verdict: compare(bRate, cRate, false),
        };
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  })();

  return (
    <div className="chart-feed">
      <div className="compare-controls">
        {dimensionPicker}
        <div className="cohort-pickers">
          <CohortPicker
            label="Baseline"
            value={baselineKey ?? ''}
            options={options.filter((option) => option.key !== candidateKey)}
            onChange={(key) => setPicked({ ...picked, baseline: key })}
            dimension={dimension}
          />
          <button
            type="button"
            className="swap-button"
            aria-label="Swap baseline and candidate"
            onClick={() => setPicked({ baseline: candidateKey, candidate: baselineKey })}
          >
            ⇄
          </button>
          <CohortPicker
            label="Candidate"
            value={candidateKey ?? ''}
            options={options.filter((option) => option.key !== baselineKey)}
            onChange={(key) => setPicked({ ...picked, candidate: key })}
            dimension={dimension}
          />
        </div>
      </div>

      <div className="match-bar">
        <button
          type="button"
          className="pareto-toggle"
          aria-pressed={match}
          onClick={() => setMatch(!match)}
        >
          <span className={`selection${match ? ' checked' : ''}`} />
          Match on {matchDimension === 'prompt' ? 'prompt' : 'model + reasoning'}
        </button>
        {matching && strata.length > 1 && (
          <select
            className="stratum-select"
            value={stratum ?? ''}
            aria-label="Shared stratum to compare within"
            onChange={(event) => setStratumPick(event.target.value)}
          >
            {strata.map((key) => (
              <option key={key} value={key}>
                {cohortLabel(key, matchDimension)} ({count(rawBaseline, key)} vs{' '}
                {count(rawCandidate, key)})
              </option>
            ))}
          </select>
        )}
        <span className="muted">
          {matching
            ? `Comparing within ${cohortLabel(stratum ?? '', matchDimension)} only${excluded > 0 ? `; ${excluded} runs outside it excluded` : ''}.`
            : match
              ? 'No shared stratum to match on, so the cohorts differ in other ways too.'
              : 'Unmatched: differences may come from other variables as well.'}
          {unfinished > 0 && ` ${unfinished} unfinished runs are not counted.`}
        </span>
      </div>

      <div className="compare-summary">
        <div className="cohort-card baseline">
          <span>Baseline</span>
          <strong>{cohortLabel(baselineKey ?? '', dimension)}</strong>
          <small>{baseline.length} runs</small>
        </div>
        <div className="cohort-card candidate">
          <span>Candidate</span>
          <strong>{cohortLabel(candidateKey ?? '', dimension)}</strong>
          <small>{candidate.length} runs</small>
        </div>
        <div className="tally">
          <span className="verdict-chip v-improvement">{tally.improvement ?? 0} better</span>
          <span className="verdict-chip v-regression">{tally.regression ?? 0} worse</span>
          <span className="verdict-chip v-inconclusive">
            {(tally.inconclusive ?? 0) + (tally.different ?? 0)} inconclusive or changed
          </span>
        </div>
      </div>

      {lowN && (
        <div className="callout warn">
          <span>
            Fewer than five runs on one side. Intervals are wide, so most differences will read as
            inconclusive. Treat this as directional and run more trials before switching prompts.
          </span>
        </div>
      )}

      <Section
        id="metrics"
        title="Metrics"
        description="95% intervals: Wilson for rates, normal approximation for means. A difference is called better or worse only when the intervals do not overlap."
        aside={
          <button
            type="button"
            className="pareto-toggle"
            aria-pressed={allChecks}
            onClick={() => setAllChecks(!allChecks)}
          >
            <span className={`selection${allChecks ? ' checked' : ''}`} />
            Show checks that always pass
          </button>
        }
      >
        <div className="table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th className="numeric">Baseline</th>
                <th className="numeric">Candidate</th>
                <th className="numeric">Δ</th>
                <th>
                  <span className="interval-legend">
                    <i className="baseline" /> base <i className="candidate" /> cand
                  </span>
                </th>
                <th>Verdict</th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group}>
                <tr className="group-row">
                  <th colSpan={6}>{group}</th>
                </tr>
                {visibleRows
                  .filter((row) => row.metric.group === group)
                  .map(({ metric, baseline: b, candidate: c, verdict }) => {
                    const lows = [b?.low, c?.low].filter(
                      (value): value is number => value !== undefined,
                    );
                    const highs = [b?.high, c?.high].filter(
                      (value): value is number => value !== undefined,
                    );
                    const domain: [number, number] =
                      metric.kind === 'rate' || metric.id === 'score'
                        ? [0, 1]
                        : [Math.min(0, ...lows), Math.max(1, ...highs) * 1.05];
                    const delta = b && c ? c.value - b.value : null;
                    return (
                      <tr key={metric.id}>
                        <td>{metric.label}</td>
                        <td className="numeric">
                          {b ? metric.format(b.value) : '—'}
                          <small> n={b?.n ?? 0}</small>
                        </td>
                        <td className="numeric">
                          {c ? metric.format(c.value) : '—'}
                          <small> n={c?.n ?? 0}</small>
                        </td>
                        <td
                          className={`numeric delta ${verdict === 'improvement' ? 'up' : verdict === 'regression' ? 'down' : ''}`}
                        >
                          {delta === null
                            ? '—'
                            : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${metric.kind === 'rate' || metric.id === 'score' ? `${Math.abs(delta * 100).toFixed(0)} pt` : metric.format(Math.abs(delta))}`}
                        </td>
                        <td>
                          <IntervalBar baseline={b} candidate={c} domain={domain} />
                        </td>
                        <td>
                          <span className={`verdict-chip v-${verdict}`}>
                            {VERDICT_TEXT[verdict]}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            ))}
          </table>
        </div>
      </Section>

      <Section
        id="mode-diff"
        title="Failure modes"
        description="Share of runs showing each problem, biggest change first."
      >
        <div className="table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th>Problem</th>
                <th>Source</th>
                <th className="numeric">Baseline</th>
                <th className="numeric">Candidate</th>
                <th className="numeric">Δ</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {modeRows.slice(0, 16).map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td className="muted">{SOURCE_LABEL[row.source]}</td>
                  <td className="numeric">{formatPercent(row.baseline?.value ?? 0)}</td>
                  <td className="numeric">{formatPercent(row.candidate?.value ?? 0)}</td>
                  <td
                    className={`numeric delta ${row.delta < 0 ? 'up' : row.delta > 0 ? 'down' : ''}`}
                  >
                    {row.delta === 0
                      ? '0'
                      : `${row.delta > 0 ? '+' : '−'}${Math.abs(row.delta * 100).toFixed(0)} pt`}
                  </td>
                  <td>
                    <span className={`verdict-chip v-${row.verdict}`}>
                      {VERDICT_TEXT[row.verdict]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        id="distributions"
        title="Distributions"
        description="Every run on a shared axis, so outliers and spread stay visible. Click a dot to open the conversation."
      >
        <div className="distribution-grid">
          {[
            {
              label: 'Quality score',
              pick: (run: RunSummary) => run.score,
              format: (value: number) => formatPercent(value),
            },
            {
              label: 'Athlete turns',
              pick: (run: RunSummary) => run.conversation?.athleteTurns ?? null,
              format: (value: number) => String(Math.round(value)),
            },
            {
              label: 'Coach tokens',
              pick: (run: RunSummary) => coachTokens(run) || null,
              format: formatTokens,
            },
          ].map((panel) => {
            const values = [...baseline, ...candidate]
              .map(panel.pick)
              .filter((value): value is number => value !== null);
            const domain: [number, number] = [Math.min(...values), Math.max(...values)];
            const side = (list: RunSummary[], tone: string) => {
              const points = list.flatMap((run) => {
                const value = panel.pick(run);
                return value === null
                  ? []
                  : [{ id: run.id, value, tone, label: run.id, hollow: run.demo }];
              });
              return { points, median: median(points.map((point) => point.value)) };
            };
            const b = side(baseline, 'baseline');
            const c = side(candidate, 'candidate');
            return (
              <div key={panel.label} className="distribution-panel">
                <h3>{panel.label}</h3>
                <div className="distribution-row">
                  <span>Baseline</span>
                  <DotStrip
                    {...b}
                    format={panel.format}
                    domain={domain}
                    onSelect={(id) => (window.location.hash = href('conversations', id))}
                  />
                </div>
                <div className="distribution-row">
                  <span>Candidate</span>
                  <DotStrip
                    {...c}
                    format={panel.format}
                    domain={domain}
                    onSelect={(id) => (window.location.hash = href('conversations', id))}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {baseline.some((run) => run.demo) || candidate.some((run) => run.demo) ? (
        <p className="footnote compare-footnote">
          <Tag tone="accent">demo</Tag> Includes synthetic demo runs.
        </p>
      ) : null}
    </div>
  );
}
