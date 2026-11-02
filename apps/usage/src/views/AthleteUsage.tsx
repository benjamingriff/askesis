import { useMemo, useState } from 'react';
import { Legend, TimeColumns } from '../charts/TimeColumns';
import { Section } from '../components/Section';
import { formatPercent, formatTokens } from '../lib/format';
import { modelName } from '../lib/models';
import { href } from '../lib/route';
import {
  cacheHitRate,
  formatAxisUsd,
  formatUsd,
  groupBy,
  KIND_LABEL,
  summarize,
  TOKEN_CLASS_COLOR,
  TOKEN_CLASS_LABEL,
  TOKEN_CLASSES,
  type UsageDataset,
  type UsageSlice,
} from '../lib/usage';
import { Stat } from '../components/Stat';
import { delta, RunTable } from './Usage';

export function AthleteUsage({
  dataset,
  athleteId,
  slice,
  population,
  colors,
  range,
}: {
  dataset: UsageDataset;
  athleteId: string;
  slice: UsageSlice;
  /** Every athlete's runs in the same range, for rank and median comparisons. */
  population: UsageSlice;
  colors: Map<string, string>;
  range: number;
}) {
  const athlete = dataset.athletes.find((item) => item.id === athleteId);
  const athletes = useMemo(
    () => new Map(dataset.athletes.map((item) => [item.id, item])),
    [dataset],
  );
  const { runs, days, previous } = slice;
  const summary = useMemo(() => summarize(runs), [runs]);
  const prior = previous ? summarize(previous) : null;
  const byDay = useMemo(() => groupBy(runs, (run) => run.day), [runs]);
  const [showAll, setShowAll] = useState(false);

  const ranking = useMemo(() => {
    const spend = [...groupBy(population.runs, (run) => run.athleteId).entries()]
      .map(([id, own]) => ({ id, usd: summarize(own).usd }))
      .sort((a, b) => b.usd - a.usd);
    const rank = spend.findIndex((item) => item.id === athleteId) + 1;
    const middle = spend[Math.floor(spend.length / 2)]?.usd ?? null;
    return { rank, of: spend.length, median: middle };
  }, [population.runs, athleteId]);

  if (!athlete) {
    return (
      <div className="empty-state">
        <h2>Unknown athlete</h2>
        <p>
          <a href={href()}>Back to all customers</a>
        </p>
      </div>
    );
  }

  const hit = cacheHitRate(runs);
  const sorted = [...runs].sort((a, b) => b.createdAt - a.createdAt);
  const shown = showAll ? sorted : sorted.slice(0, 25);
  const models = [...new Set(runs.map((run) => run.model))];

  return (
    <div className="chart-feed">
      <div className="athlete-head">
        <a href={href()} className="back-link">
          ← All customers
        </a>
        <h1>{athlete.name}</h1>
        <p>
          <span className="mono">{athlete.id}</span> · joined {athlete.joinedDay} ·{' '}
          {athlete.timezone} · {models.map(modelName).join(', ') || 'no runs'}
        </p>
      </div>
      <div className="stat-strip">
        <Stat
          label={`Est. spend · ${range}d`}
          value={formatUsd(summary.usd)}
          sub={delta(summary.usd, prior?.usd, range)}
        />
        <Stat
          label="Rank by spend"
          value={ranking.rank ? `#${ranking.rank}` : '—'}
          sub={`of ${ranking.of} active athletes`}
        />
        <Stat
          label="vs median athlete"
          value={ranking.median ? `${(summary.usd / ranking.median).toFixed(1)}×` : '—'}
          sub={`median ${formatUsd(ranking.median)}`}
        />
        <Stat
          label="Coach runs"
          value={String(summary.runs)}
          sub={`${runs.filter((run) => run.kind === 'generation').length} plan generations`}
        />
        <Stat
          label="Spend per run"
          value={formatUsd(
            summary.runs - summary.unpriced
              ? summary.usd / (summary.runs - summary.unpriced)
              : null,
            true,
          )}
          sub={`${formatTokens(summary.tokens.input / Math.max(1, summary.requests))} input / request`}
        />
        <Stat
          label="Cache hit rate"
          value={formatPercent(hit, 1)}
          sub={`saved ${formatUsd(summary.uncachedUsd - summary.usd)}`}
        />
      </div>

      <Section
        id="athlete-spend"
        title="Spend per day"
        description="Estimated cost of this athlete's coach runs, by token type."
      >
        <Legend
          items={TOKEN_CLASSES.map((key) => ({
            key,
            label: TOKEN_CLASS_LABEL[key],
            color: TOKEN_CLASS_COLOR[key],
          }))}
        />
        <TimeColumns
          days={days}
          series={TOKEN_CLASSES.map((key) => ({
            key,
            label: TOKEN_CLASS_LABEL[key],
            color: TOKEN_CLASS_COLOR[key],
          }))}
          value={(day, key) =>
            (byDay.get(day) ?? []).reduce(
              (sum, run) =>
                sum + (run.usd === null ? 0 : run.cost[key as (typeof TOKEN_CLASSES)[number]]),
              0,
            )
          }
          format={(value) => formatUsd(value, true)}
          formatAxis={formatAxisUsd}
          markers={dataset.annotations}
          title="Spend per day"
          footer={(day) => {
            const own = byDay.get(day) ?? [];
            if (own.length === 0) return null;
            const kinds = groupBy(own, (run) => run.kind);
            return [...kinds.entries()]
              .map(
                ([kind, list]) =>
                  `${list.length} ${KIND_LABEL[kind as 'chat' | 'generation'].toLowerCase()}`,
              )
              .join(' · ');
          }}
        />
      </Section>

      <Section
        id="athlete-runs"
        title="Runs"
        description="Newest first. Expand a run to see each model request: cached and uncached input, cache writes, output, reasoning and cost."
      >
        <RunTable runs={shown} athletes={athletes} colors={colors} expandable />
        {sorted.length > 25 && (
          <button className="text-button table-more" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show newest 25' : `Show all ${sorted.length} runs`}
          </button>
        )}
      </Section>
    </div>
  );
}
