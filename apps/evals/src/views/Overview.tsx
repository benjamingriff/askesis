import { useMemo, useState, type ReactNode } from 'react';
import { GroupedBars, type BarGroup } from '../charts/GroupedBars';
import { Heatmap, type HeatRow } from '../charts/Heatmap';
import { Scatter, type ScatterGroup, type ScatterRun } from '../charts/Scatter';
import { StackedBars, type StackRow } from '../charts/StackedBars';
import {
  formatDuration,
  formatPercent,
  formatTokens,
  humanize,
  VERDICT_GLYPH,
  VERDICT_LABEL,
  VERDICT_ORDER,
} from '../lib/format';
import { coachTokens, medianOf, variants, type Variant } from '../lib/filters';
import { modelName, reasoningShort } from '../lib/models';
import { href } from '../lib/route';
import { CRITERIA, type RunSummary } from '../types';

interface OverviewProps {
  runs: RunSummary[];
  colors: Map<string, string>;
  highlighted: string | null;
  onHighlight: (model: string | null) => void;
  demoAvailable: boolean;
  onEnableDemo: () => void;
}

function ChartSection({
  id,
  title,
  description,
  controls,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="chart-section" id={id} aria-label={title}>
      <div className="chart-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {controls && <div className="chart-controls">{controls}</div>}
      </div>
      {children}
    </section>
  );
}

function ScaleControls({
  pareto,
  log,
  onPareto,
  onLog,
}: {
  pareto: boolean;
  log: boolean;
  onPareto: (value: boolean) => void;
  onLog: (value: boolean) => void;
}) {
  return (
    <>
      <button
        className="pareto-toggle"
        aria-pressed={pareto}
        title="Connect variants that no other visible variant beats on both score and cost."
        onClick={() => onPareto(!pareto)}
      >
        <span className={`selection${pareto ? ' checked' : ''}`} />
        Pareto line
      </button>
      <div className="chart-scale" role="group" aria-label="Axis scale">
        <button aria-pressed={!log} onClick={() => onLog(false)}>
          Linear
        </button>
        <button aria-pressed={log} onClick={() => onLog(true)}>
          Log
        </button>
      </div>
    </>
  );
}

function scatterData(
  list: Variant[],
  colors: Map<string, string>,
  pick: (run: RunSummary) => number | null,
): { runs: ScatterRun[]; groups: ScatterGroup[] } {
  const runs: ScatterRun[] = [];
  const groups: ScatterGroup[] = [];
  for (const variant of list) {
    const color = colors.get(variant.model) ?? 'var(--fg-3)';
    // Operational failures (provider errors, interruptions) say nothing about plan
    // quality, so the quality scatters only plot runs that ran to completion.
    const usable = variant.runs.filter(
      (run) => run.stopReason === 'completed' && run.score !== null && (pick(run) ?? 0) > 0,
    );
    if (usable.length === 0) continue;
    for (const run of usable) {
      runs.push({
        id: run.id,
        x: pick(run) ?? 0,
        y: run.score ?? 0,
        model: run.coachModel,
        reasoning: run.reasoning,
        color,
        demo: run.demo,
        label: `${modelName(run.coachModel)} · ${run.reasoning}`,
      });
    }
    groups.push({
      key: variant.key,
      model: variant.model,
      modelLabel: modelName(variant.model),
      reasoning: variant.reasoning,
      color,
      x: medianOf(usable, pick) ?? 0,
      y: medianOf(usable, (run) => run.score) ?? 0,
      runs: usable.length,
      acceptable: usable.filter((run) => run.verdict === 'acceptable').length,
      demo: variant.demo,
    });
  }
  return { runs, groups };
}

export function Overview(props: OverviewProps) {
  const { runs, colors, highlighted, onHighlight } = props;
  const [paretoTokens, setParetoTokens] = useState(true);
  const [logTokens, setLogTokens] = useState(true);
  const [paretoTime, setParetoTime] = useState(false);
  const [logTime, setLogTime] = useState(true);

  const list = useMemo(() => variants(runs), [runs]);
  const models = useMemo(() => [...new Set(runs.map((run) => run.coachModel))].sort(), [runs]);
  const tokenData = useMemo(
    () => scatterData(list, colors, (run) => coachTokens(run) || null),
    [list, colors],
  );
  const timeData = useMemo(
    () => scatterData(list, colors, (run) => run.durationMs),
    [list, colors],
  );
  const select = (id: string) => {
    window.location.hash = href('conversations', id);
  };

  const verdictRows: StackRow[] = models.map((model) => {
    const own = runs.filter((run) => run.coachModel === model);
    return {
      key: model,
      label: modelName(model),
      color: colors.get(model) ?? 'var(--fg-3)',
      segments: VERDICT_ORDER.map((verdict) => ({
        key: verdict,
        label: VERDICT_LABEL[verdict],
        glyph: VERDICT_GLYPH[verdict],
        value: own.filter((run) => run.verdict === verdict).length,
        className: `seg-${verdict}`,
      })),
    };
  });

  const columns = [...CRITERIA.map(humanize), 'Exact checks'];
  const heatRows: HeatRow[] = list.map((variant) => {
    const assessed = variant.runs;
    const cells = CRITERIA.map((criterion) => {
      const results = assessed.flatMap((run) =>
        run.criteria.filter((item) => item.criterion === criterion),
      );
      return results.length === 0
        ? null
        : {
            passed: results.filter((item) => item.result === 'pass').length,
            total: results.length,
          };
    });
    const checks = assessed.flatMap((run) => run.checks);
    return {
      key: variant.key,
      label: `${modelName(variant.model)} · ${reasoningShort(variant.reasoning)}`,
      color: colors.get(variant.model) ?? 'var(--fg-3)',
      cells: [
        ...cells,
        checks.length === 0
          ? null
          : {
              passed: checks.filter((check) => check.status === 'pass').length,
              total: checks.length,
            },
      ],
    };
  });

  const barGroups: BarGroup[] = models
    .map((model) => ({
      key: model,
      label: modelName(model),
      color: colors.get(model) ?? 'var(--fg-3)',
      bars: list
        .filter((variant) => variant.model === model)
        .map((variant) => ({
          key: variant.key,
          short: reasoningShort(variant.reasoning),
          label: variant.reasoning,
          value: medianOf(variant.runs, (run) => coachTokens(run) || null) ?? 0,
          runs: variant.runs.length,
          demo: variant.demo,
        }))
        .filter((bar) => bar.value > 0),
    }))
    .filter((group) => group.bars.length > 0);

  const scored = runs.filter((run) => run.score !== null);
  const stoppedEarly = runs.filter((run) => run.stopReason !== 'completed').length;
  const excluded =
    stoppedEarly > 0
      ? ` ${stoppedEarly} run${stoppedEarly === 1 ? '' : 's'} that stopped early ${stoppedEarly === 1 ? 'is' : 'are'} not plotted.`
      : '';
  const acceptable = runs.filter((run) => run.verdict === 'acceptable').length;

  if (runs.length === 0) {
    return (
      <div className="empty-state">
        <h2>No runs match</h2>
        <p>
          Adjust the filters, include scripted runs, or start a benchmark with{' '}
          <code>pnpm bench run</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="chart-feed">
      <div className="stat-strip">
        <Stat label="Runs" value={String(runs.length)} />
        <Stat
          label="Acceptable"
          value={formatPercent(acceptable / runs.length)}
          sub={`${acceptable} of ${runs.length}`}
        />
        <Stat label="Median score" value={formatPercent(medianOf(scored, (run) => run.score))} />
        <Stat
          label="Median coach tokens"
          value={formatTokens(medianOf(runs, (run) => coachTokens(run) || null) ?? 0)}
        />
        <Stat
          label="Median wall time"
          value={formatDuration(medianOf(runs, (run) => run.durationMs))}
        />
        <Stat label="Coach models" value={String(models.length)} />
      </div>

      {models.length < 2 && props.demoAvailable && (
        <div className="callout">
          <span>
            Only <strong>{modelName(models[0] ?? '')}</strong> has been benchmarked. Comparisons get
            interesting with more coach models.
          </span>
          <button onClick={props.onEnableDemo}>Preview with demo models</button>
        </div>
      )}

      <ChartSection
        id="quality-tokens"
        title="Quality vs coach tokens"
        description={`Each line is a coach model; points step through reasoning effort. Faint dots are individual runs.${excluded}`}
        controls={
          <ScaleControls
            pareto={paretoTokens}
            log={logTokens}
            onPareto={setParetoTokens}
            onLog={setLogTokens}
          />
        }
      >
        <Scatter
          {...tokenData}
          log={logTokens}
          pareto={paretoTokens}
          xTitle="Coach tokens per run"
          yTitle="Quality score (checks + reviewer criteria passed)"
          formatX={formatTokens}
          formatY={(value) => formatPercent(value)}
          highlighted={highlighted}
          onHighlight={onHighlight}
          onSelectRun={select}
        />
      </ChartSection>

      <ChartSection
        id="quality-time"
        title="Quality vs wall time"
        description={`Elapsed time from environment ready to assessment, including simulated athlete turns.${excluded}`}
        controls={
          <ScaleControls
            pareto={paretoTime}
            log={logTime}
            onPareto={setParetoTime}
            onLog={setLogTime}
          />
        }
      >
        <Scatter
          {...timeData}
          log={logTime}
          pareto={paretoTime}
          xTitle="Wall time per run"
          yTitle="Quality score"
          formatX={(value) => formatDuration(value)}
          formatY={(value) => formatPercent(value)}
          highlighted={highlighted}
          onHighlight={onHighlight}
          onSelectRun={select}
        />
      </ChartSection>

      <ChartSection
        id="verdicts"
        title="Verdicts"
        description="Overall assessment per run. Incomplete covers provider errors, interruptions and missing coverage."
      >
        <StackedBars rows={verdictRows} unit="runs" />
      </ChartSection>

      <ChartSection
        id="criteria"
        title="Criteria pass rate"
        description="Share of runs where the reviewer passed each criterion, by model and reasoning effort."
      >
        <Heatmap columns={columns} rows={heatRows} />
      </ChartSection>

      <ChartSection
        id="tokens"
        title="Coach tokens per run"
        description="Median input + output tokens across coaching turns. Monetary cost is not yet recorded."
      >
        {barGroups.length > 0 ? (
          <GroupedBars groups={barGroups} title="coach tokens, median" format={formatTokens} />
        ) : (
          <p className="muted">No token usage recorded for the visible runs.</p>
        )}
      </ChartSection>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | undefined;
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}
