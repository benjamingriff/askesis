import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { Legend, TimeColumns } from '../charts/TimeColumns';
import { TimeLines } from '../charts/TimeLines';
import { TooltipRow } from '../charts/Tooltip';
import {
  ConcentrationCurve,
  DotPlot,
  PercentBars,
  ShareRows,
  Sparkline,
  type SequenceBar,
} from '../charts/UsageCharts';
import { Section } from '../components/Section';
import { formatDateTime, formatPercent, formatTokens } from '../lib/format';
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
  type Athlete,
  type UsageDataset,
  type UsageRun,
  type UsageSlice,
} from '../lib/usage';
import { Stat } from '../components/Stat';

type SpendBreakdown = 'class' | 'model' | 'kind';

const KIND_COLOR = { chat: '#9085e9', generation: '#c98500' };

export function Usage({
  dataset,
  slice,
  colors,
  range,
}: {
  dataset: UsageDataset;
  slice: UsageSlice;
  colors: Map<string, string>;
  range: number;
}) {
  const { runs, days, previous } = slice;
  const [breakdown, setBreakdown] = useState<SpendBreakdown>('class');
  const athletes = useMemo(
    () => new Map(dataset.athletes.map((athlete) => [athlete.id, athlete])),
    [dataset],
  );
  const summary = useMemo(() => summarize(runs), [runs]);
  const prior = useMemo(() => (previous ? summarize(previous) : null), [previous]);
  const byDay = useMemo(() => groupBy(runs, (run) => run.day), [runs]);
  const models = useMemo(() => [...new Set(runs.map((run) => run.model))].sort(), [runs]);
  const markers = dataset.annotations;

  const hit = cacheHitRate(runs);
  const priorHit = previous ? cacheHitRate(previous) : null;
  const savings = summary.uncachedUsd - summary.usd;
  const perAthlete = summary.athletes === 0 ? null : summary.usd / summary.athletes;
  const priorPerAthlete = prior && prior.athletes > 0 ? prior.usd / prior.athletes : null;

  const dayCost = useMemo(() => {
    const table = new Map<string, Map<string, number>>();
    for (const day of days) {
      const own = byDay.get(day) ?? [];
      const cell = new Map<string, number>();
      for (const run of own) {
        if (run.usd === null) continue;
        for (const key of TOKEN_CLASSES) cell.set(key, (cell.get(key) ?? 0) + run.cost[key]);
        cell.set(`model:${run.model}`, (cell.get(`model:${run.model}`) ?? 0) + run.usd);
        cell.set(`kind:${run.kind}`, (cell.get(`kind:${run.kind}`) ?? 0) + run.usd);
      }
      table.set(day, cell);
    }
    return table;
  }, [byDay, days]);

  const spendSeries =
    breakdown === 'class'
      ? TOKEN_CLASSES.map((key) => ({
          key,
          label: TOKEN_CLASS_LABEL[key],
          color: TOKEN_CLASS_COLOR[key],
        }))
      : breakdown === 'model'
        ? models.map((model) => ({
            key: `model:${model}`,
            label: modelName(model),
            color: colors.get(model) ?? 'var(--fg-3)',
          }))
        : (['chat', 'generation'] as const).map((kind) => ({
            key: `kind:${kind}`,
            label: KIND_LABEL[kind],
            color: KIND_COLOR[kind],
          }));

  const hitByDay = useMemo(() => {
    const table = new Map<string, { rate: number; runs: number }>();
    for (const day of days) {
      for (const model of models) {
        const own = (byDay.get(day) ?? []).filter((run) => run.model === model);
        const rate = cacheHitRate(own);
        if (rate !== null) table.set(`${day}|${model}`, { rate, runs: own.length });
      }
    }
    return table;
  }, [byDay, days, models]);

  const sequenceBars: SequenceBar[] = useMemo(() => {
    const buckets = ['1', '2', '3', '4', '5', '6–9', '10+'];
    const bucketOf = (sequence: number) =>
      sequence <= 5 ? String(sequence) : sequence < 10 ? '6–9' : '10+';
    const totals = new Map(buckets.map((key) => [key, { read: 0, input: 0, count: 0 }]));
    for (const run of runs) {
      for (const request of run.requests) {
        const bucket = totals.get(bucketOf(request.sequence));
        if (!bucket) continue;
        bucket.read += request.tokens.cacheRead;
        bucket.input += request.tokens.input;
        bucket.count += 1;
      }
    }
    return buckets.map((key) => {
      const bucket = totals.get(key)!;
      return {
        key,
        label: `Request ${key} within a run`,
        value: bucket.input === 0 ? null : bucket.read / bucket.input,
        count: bucket.count,
      };
    });
  }, [runs]);

  const customers = useMemo(() => customerRows(runs, athletes, days), [runs, athletes, days]);
  const expensive = useMemo(
    () =>
      runs
        .filter((run) => run.usd !== null)
        .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))
        .slice(0, 12),
    [runs],
  );

  if (runs.length === 0) {
    return (
      <div className="empty-state">
        <h2>No usage matches</h2>
        <p>Widen the date range or reset the filters.</p>
      </div>
    );
  }

  const open = (id: string) => {
    window.location.hash = href(id);
  };

  return (
    <div className="chart-feed">
      <div className="stat-strip">
        <Stat
          label={`Est. spend · ${range}d`}
          value={formatUsd(summary.usd)}
          sub={delta(summary.usd, prior?.usd, range)}
        />
        <Stat
          label="Cache hit rate"
          value={formatPercent(hit, 1)}
          sub={
            priorHit === null || hit === null
              ? 'cache read ÷ input'
              : `${hit >= priorHit ? '▲' : '▼'} ${Math.abs((hit - priorHit) * 100).toFixed(1)} pts vs prev ${range}d`
          }
        />
        <Stat
          label="Saved by caching"
          value={formatUsd(savings)}
          sub={`${formatPercent(summary.uncachedUsd === 0 ? null : savings / summary.uncachedUsd)} off uncached prices`}
        />
        <Stat
          label="Coach runs"
          value={summary.runs.toLocaleString('en-GB')}
          sub={`${summary.requests.toLocaleString('en-GB')} model requests`}
        />
        <Stat
          label="Active athletes"
          value={String(summary.athletes)}
          sub={delta(summary.athletes, prior?.athletes, range, false)}
        />
        <Stat
          label="Spend per athlete"
          value={formatUsd(perAthlete)}
          sub={delta(perAthlete ?? 0, priorPerAthlete, range)}
        />
      </div>

      {summary.unpriced > 0 && (
        <div className="callout warn">
          <span>
            <strong>{summary.unpriced}</strong> of {summary.runs} runs have no final usage ledger
            (old workers or partial reports) and are left out of spend.{' '}
            <a href="#coverage" onClick={scrollTo('coverage')}>
              See coverage
            </a>
          </span>
        </div>
      )}

      <Section
        id="spend"
        title="Estimated spend per day"
        description={`List-price estimate from each request's tokens (${dataset.pricingVersion}). Not invoice reconciliation.`}
        aside={
          <div className="chart-scale" role="group" aria-label="Break down by">
            {(
              [
                ['class', 'Token type'],
                ['model', 'Model'],
                ['kind', 'Run type'],
              ] as const
            ).map(([key, label]) => (
              <button key={key} aria-pressed={breakdown === key} onClick={() => setBreakdown(key)}>
                {label}
              </button>
            ))}
          </div>
        }
      >
        <Legend items={spendSeries} />
        <TimeColumns
          days={days}
          series={spendSeries}
          value={(day, key) => dayCost.get(day)?.get(key) ?? 0}
          format={(value) => formatUsd(value, true)}
          formatAxis={formatAxisUsd}
          markers={markers}
          title="Estimated spend per day"
          footer={(day) => {
            const own = byDay.get(day) ?? [];
            return own.length
              ? `${own.length} runs · ${new Set(own.map((run) => run.athleteId)).size} athletes`
              : null;
          }}
        />
      </Section>

      <Section
        id="cache"
        title="Cache hit rate"
        description="Cached input tokens as a share of all input tokens, per day and model. Prompt changes that move the stable prefix show up here first."
      >
        <TimeLines
          days={days}
          series={models.map((model) => ({
            key: model,
            label: modelName(model),
            color: colors.get(model) ?? 'var(--fg-3)',
          }))}
          value={(day, key) => hitByDay.get(`${day}|${key}`)?.rate ?? null}
          detail={(day, key) => {
            const cell = hitByDay.get(`${day}|${key}`);
            return cell ? `${cell.runs} runs` : null;
          }}
          format={(value) => `${Math.round(value * 100)}%`}
          domain={[0, 1]}
          markers={markers}
          title="Cache hit rate per day"
        />
        <div className="subchart">
          <h3>By request position</h3>
          <p>
            The first request of a run pays for its context; later requests should read it back. A
            low first bar is expected, a low second bar is a cache miss worth chasing.
          </p>
          <PercentBars
            bars={sequenceBars}
            title="Cache hit rate by request position"
            color={TOKEN_CLASS_COLOR.cacheRead}
            unit="Requests"
          />
        </div>
      </Section>

      <Section
        id="mix"
        title="Tokens vs spend"
        description="Where tokens go against where money goes. Cache reads dominate volume but cost a twentieth of uncached input; output is a sliver of tokens and a large share of spend."
      >
        <Legend
          items={TOKEN_CLASSES.map((key) => ({
            key,
            label: TOKEN_CLASS_LABEL[key],
            color: TOKEN_CLASS_COLOR[key],
          }))}
        />
        <ShareRows
          rows={models.flatMap((model) => {
            const own = summarize(runs.filter((run) => run.model === model));
            const label = (
              <span className="share-model">
                <i className="model-dot" style={{ background: colors.get(model) }} />
                {modelName(model)}
              </span>
            );
            return [
              {
                key: `${model}-tokens`,
                label,
                caption: `${formatTokens(own.tokens.input + own.tokens.output)} tokens`,
                segments: TOKEN_CLASSES.map((key) => ({
                  key,
                  label: TOKEN_CLASS_LABEL[key],
                  color: TOKEN_CLASS_COLOR[key],
                  value: own.tokens[key],
                  display: `${formatTokens(own.tokens[key])} tokens`,
                })),
              },
              {
                key: `${model}-usd`,
                label: <span className="share-model indent">spend</span>,
                caption: formatUsd(own.usd),
                segments: TOKEN_CLASSES.map((key) => ({
                  key,
                  label: TOKEN_CLASS_LABEL[key],
                  color: TOKEN_CLASS_COLOR[key],
                  value: own.cost[key],
                  display: formatUsd(own.cost[key], true),
                })),
              },
            ];
          })}
        />
      </Section>

      <Section
        id="customers"
        title="Customers"
        description="Every athlete with a coach run in the range. Select a row for their runs and request-level usage."
      >
        <CustomerTable rows={customers} total={summary.usd} onOpen={open} />
      </Section>

      <Section
        id="concentration"
        title="Spend concentration"
        description="How much of the bill a few athletes drive. A curve hugging the top-left means a handful of heavy users; the diagonal would be perfectly even."
      >
        <ConcentrationCurve
          values={customers.map((row) => ({ label: row.athlete.name, value: row.usd }))}
          marks={[0.1, 0.25]}
        />
      </Section>

      <Section
        id="outliers"
        title="Runs vs cost per run"
        description="Each dot is an athlete. Right means busy; up means expensive conversations (long histories, regenerations). Both axes are logarithmic."
      >
        <DotPlot
          dots={customers
            .filter((row) => row.priced > 0)
            .map((row) => ({
              key: row.athlete.id,
              label: row.athlete.name,
              x: row.runs,
              y: row.usd / row.priced,
              color: colors.get(row.topModel) ?? 'var(--fg-3)',
              detail: (
                <>
                  <TooltipRow label="Runs" value={row.runs} />
                  <TooltipRow label="Per run" value={formatUsd(row.usd / row.priced, true)} />
                  <TooltipRow label="Spend" value={formatUsd(row.usd)} />
                  <TooltipRow label="Cache hit" value={formatPercent(row.hit)} />
                </>
              ),
            }))}
          xTitle="Coach runs in range"
          yTitle="Mean spend per run"
          formatX={(value) => String(value)}
          formatY={formatAxisUsd}
          onSelect={open}
        />
        <Legend
          items={models.map((model) => ({
            key: model,
            label: `Mostly ${modelName(model)}`,
            color: colors.get(model) ?? 'var(--fg-3)',
          }))}
        />
      </Section>

      <Section
        id="expensive"
        title="Most expensive runs"
        description="The individual coach runs that cost the most, with their request count and cache behaviour."
      >
        <RunTable runs={expensive} athletes={athletes} colors={colors} showAthlete />
      </Section>

      <Section
        id="coverage"
        title="Data coverage"
        description="What the estimates rest on. A run is priced only when its worker sent a final provider usage report."
      >
        <Coverage runs={runs} />
      </Section>
    </div>
  );
}

function scrollTo(id: string) {
  return (event: MouseEvent) => {
    event.preventDefault();
    const element = document.getElementById(id);
    if (element) window.scrollTo({ top: element.offsetTop - 60, behavior: 'smooth' });
  };
}

export function delta(
  current: number,
  previous: number | null | undefined,
  range: number,
  percent = true,
): string | undefined {
  if (previous === null || previous === undefined) return `no prior ${range}d in the data`;
  if (!percent) {
    const diff = current - previous;
    return `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)} vs prev ${range}d`;
  }
  if (previous === 0) return undefined;
  const change = (current - previous) / previous;
  return `${change >= 0 ? '▲' : '▼'} ${Math.abs(change * 100).toFixed(0)}% vs prev ${range}d`;
}

export interface CustomerRow {
  athlete: Athlete;
  runs: number;
  priced: number;
  requests: number;
  tokens: number;
  usd: number;
  hit: number | null;
  last: number;
  daily: number[];
  topModel: string;
  plan: string;
  generations: number;
}

export function customerRows(
  runs: UsageRun[],
  athletes: Map<string, Athlete>,
  days: string[],
): CustomerRow[] {
  const index = new Map(days.map((day, position) => [day, position]));
  return [...groupBy(runs, (run) => run.athleteId).entries()]
    .flatMap(([id, own]) => {
      const athlete = athletes.get(id);
      if (!athlete) return [];
      const summary = summarize(own);
      const daily = days.map(() => 0);
      for (const run of own) {
        const position = index.get(run.day);
        if (position !== undefined && run.usd !== null) daily[position]! += run.usd;
      }
      const modelCounts = [...groupBy(own, (run) => run.model).entries()].sort(
        (a, b) => b[1].length - a[1].length,
      );
      return [
        {
          athlete,
          runs: own.length,
          priced: own.length - summary.unpriced,
          requests: summary.requests,
          tokens: summary.tokens.input + summary.tokens.output,
          usd: summary.usd,
          hit: cacheHitRate(own),
          last: Math.max(...own.map((run) => run.createdAt)),
          daily,
          topModel: modelCounts[0]?.[0] ?? '',
          plan: own[own.length - 1]?.planName ?? '',
          generations: own.filter((run) => run.kind === 'generation').length,
        },
      ];
    })
    .sort((a, b) => b.usd - a.usd);
}

type SortKey = 'usd' | 'runs' | 'tokens' | 'hit' | 'perRun' | 'last';

function CustomerTable({
  rows,
  total,
  onOpen,
}: {
  rows: CustomerRow[];
  total: number;
  onOpen: (id: string) => void;
}) {
  const [sort, setSort] = useState<SortKey>('usd');
  const [expanded, setExpanded] = useState(false);
  const value = (row: CustomerRow): number => {
    switch (sort) {
      case 'usd':
        return row.usd;
      case 'runs':
        return row.runs;
      case 'tokens':
        return row.tokens;
      case 'hit':
        return row.hit ?? -1;
      case 'perRun':
        return row.priced ? row.usd / row.priced : 0;
      case 'last':
        return row.last;
    }
  };
  const sorted = [...rows].sort((a, b) => value(b) - value(a));
  const shown = expanded ? sorted : sorted.slice(0, 15);
  const sparkMax = Math.max(...rows.flatMap((row) => row.daily), 0);
  const top = rows[0]?.usd ?? 0;
  const header = (key: SortKey, label: string) => (
    <th className="numeric">
      <button
        className={`sort-button${sort === key ? ' active' : ''}`}
        onClick={() => setSort(key)}
      >
        {label}
        {sort === key && ' ↓'}
      </button>
    </th>
  );
  return (
    <>
      <div className="table-wrap">
        <table className="runs-table usage-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Athlete</th>
              <th>Daily spend</th>
              {header('usd', 'Est. spend')}
              <th>Share</th>
              {header('runs', 'Runs')}
              {header('perRun', 'Per run')}
              {header('tokens', 'Tokens')}
              {header('hit', 'Cache hit')}
              {header('last', 'Last run')}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, position) => (
              <tr key={row.athlete.id} onClick={() => onOpen(row.athlete.id)}>
                <td className="muted">{position + 1}</td>
                <td>
                  <a
                    href={href(row.athlete.id)}
                    onClick={(event) => event.stopPropagation()}
                    className="athlete-cell"
                  >
                    <strong>{row.athlete.name}</strong>
                    <small>
                      {row.plan}
                      {row.generations > 1 && ` · ${row.generations} generations`}
                    </small>
                  </a>
                </td>
                <td>
                  <Sparkline values={row.daily} max={sparkMax} />
                </td>
                <td className="numeric">{formatUsd(row.usd)}</td>
                <td>
                  <span className="share-cell">
                    <span className="share-mini">
                      <span style={{ width: `${(row.usd / (top || 1)) * 100}%` }} />
                    </span>
                    <small>{formatPercent(total === 0 ? null : row.usd / total)}</small>
                  </span>
                </td>
                <td className="numeric">{row.runs}</td>
                <td className="numeric">
                  {row.priced ? formatUsd(row.usd / row.priced, true) : '—'}
                </td>
                <td className="numeric">{formatTokens(row.tokens)}</td>
                <td className="numeric">
                  <HitCell value={row.hit} />
                </td>
                <td className="numeric muted">
                  {formatDateTime(new Date(row.last).toISOString())}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 15 && (
        <button className="text-button table-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show top 15' : `Show all ${rows.length} athletes`}
        </button>
      )}
    </>
  );
}

export function HitCell({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">—</span>;
  const tone = value >= 0.7 ? 'good' : value >= 0.5 ? 'warn' : 'bad';
  return (
    <span className={`hit-cell hit-${tone}`}>
      <span className="hit-track">
        <span style={{ width: `${value * 100}%` }} />
      </span>
      {Math.round(value * 100)}%
    </span>
  );
}

export function RunTable({
  runs,
  athletes,
  colors,
  showAthlete = false,
  expandable = false,
}: {
  runs: UsageRun[];
  athletes: Map<string, Athlete>;
  colors: Map<string, string>;
  showAthlete?: boolean;
  expandable?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="table-wrap">
      <table className="runs-table usage-table">
        <thead>
          <tr>
            <th>Started</th>
            {showAthlete && <th>Athlete</th>}
            <th>Run</th>
            <th>Model · prompt</th>
            <th className="numeric">Requests</th>
            <th className="numeric">Input</th>
            <th className="numeric">Cache hit</th>
            <th className="numeric">Output</th>
            <th className="numeric">Est. cost</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const athlete = athletes.get(run.athleteId);
            const hit = cacheHitRate([run]);
            const rows: ReactNode[] = [
              <tr
                key={run.id}
                className={open === run.id ? 'expanded' : undefined}
                onClick={() =>
                  expandable
                    ? setOpen(open === run.id ? null : run.id)
                    : (window.location.hash = href(run.athleteId))
                }
              >
                <td className="nowrap">
                  {expandable && <span className="disclosure">{open === run.id ? '▾' : '▸'}</span>}
                  {formatDateTime(new Date(run.createdAt).toISOString())}
                </td>
                {showAthlete && <td>{athlete?.name ?? run.athleteId}</td>}
                <td>
                  <span className="mono muted">{run.id}</span>{' '}
                  <span className={`tag${run.kind === 'generation' ? ' tag-accent' : ''}`}>
                    {KIND_LABEL[run.kind]}
                  </span>
                </td>
                <td className="nowrap">
                  <i className="model-dot" style={{ background: colors.get(run.model) }} />
                  {modelName(run.model)} <span className="muted mono">{run.promptVersion}</span>
                </td>
                <td className="numeric">{run.requests.length || '—'}</td>
                <td className="numeric">{formatTokens(run.tokens.input)}</td>
                <td className="numeric">
                  <HitCell value={hit} />
                </td>
                <td className="numeric">{formatTokens(run.tokens.output)}</td>
                <td className="numeric">
                  {run.usd === null ? (
                    <span className="tag tag-warn" title="No final usage ledger">
                      {run.ledger === 'missing' ? 'no ledger' : 'partial'}
                    </span>
                  ) : (
                    formatUsd(run.usd, true)
                  )}
                </td>
                <td>
                  <StatusBadge run={run} />
                </td>
              </tr>,
            ];
            if (expandable && open === run.id) {
              rows.push(
                <tr key={`${run.id}-detail`} className="request-detail">
                  <td colSpan={showAthlete ? 10 : 9}>
                    <RequestTable run={run} />
                  </td>
                </tr>,
              );
            }
            return rows;
          })}
        </tbody>
      </table>
    </div>
  );
}

function RequestTable({ run }: { run: UsageRun }) {
  if (run.requests.length === 0) {
    return (
      <p className="muted request-empty">
        This run predates the usage ledger: only total input ({formatTokens(run.tokens.input)}) and
        output ({formatTokens(run.tokens.output)}) tokens were stored, so it cannot be priced.
      </p>
    );
  }
  return (
    <table className="request-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Tier</th>
          <th className="numeric">Uncached</th>
          <th className="numeric">Cache read</th>
          <th className="numeric">Cache write</th>
          <th className="numeric">Output</th>
          <th className="numeric">Reasoning</th>
          <th>Token mix</th>
          <th className="numeric">Cost</th>
        </tr>
      </thead>
      <tbody>
        {run.requests.map((request) => {
          const total = request.tokens.input + request.tokens.output;
          return (
            <tr key={request.sequence}>
              <td className="muted">{request.sequence}</td>
              <td className="mono muted">{request.tier}</td>
              <td className="numeric">{formatTokens(request.tokens.uncachedInput)}</td>
              <td className="numeric">{formatTokens(request.tokens.cacheRead)}</td>
              <td className="numeric">{formatTokens(request.tokens.cacheWrite)}</td>
              <td className="numeric">{formatTokens(request.tokens.output)}</td>
              <td className="numeric muted">{formatTokens(request.tokens.reasoning)}</td>
              <td>
                <span className="mix-bar">
                  {TOKEN_CLASSES.map((key) =>
                    request.tokens[key] > 0 ? (
                      <span
                        key={key}
                        title={`${TOKEN_CLASS_LABEL[key]} ${formatTokens(request.tokens[key])}`}
                        style={{
                          flexGrow: request.tokens[key] / total,
                          background: TOKEN_CLASS_COLOR[key],
                        }}
                      />
                    ) : null,
                  )}
                </span>
              </td>
              <td className="numeric">{formatUsd(request.usd, true)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function StatusBadge({ run }: { run: UsageRun }) {
  if (run.status === 'completed')
    return (
      <span className="result result-pass">
        <b>✓</b>Completed
      </span>
    );
  if (run.status === 'cancelled')
    return (
      <span className="result">
        <b>–</b>Cancelled
      </span>
    );
  return (
    <span className="result result-fail" title={run.failureCode ?? undefined}>
      <b>✕</b>
      {run.failureCode ?? 'Failed'}
    </span>
  );
}

function Coverage({ runs }: { runs: UsageRun[] }) {
  const counts = {
    final: runs.filter((run) => run.ledger === 'final').length,
    partial: runs.filter((run) => run.ledger === 'partial').length,
    missing: runs.filter((run) => run.ledger === 'missing').length,
  };
  const failed = runs.filter((run) => run.status !== 'completed');
  const failedUsd = failed.reduce((sum, run) => sum + (run.usd ?? 0), 0);
  return (
    <div className="coverage">
      <div className="coverage-strip">
        <div>
          <strong>{formatPercent(counts.final / runs.length, 1)}</strong>
          <span>priced from a final ledger</span>
          <small>{counts.final} runs</small>
        </div>
        <div>
          <strong>{counts.partial}</strong>
          <span>partial ledgers</span>
          <small>report arrived incomplete</small>
        </div>
        <div>
          <strong>{counts.missing}</strong>
          <span>no ledger</span>
          <small>old worker or pre-rollout; totals only</small>
        </div>
        <div>
          <strong>{formatUsd(failedUsd)}</strong>
          <span>spent on failed/cancelled runs</span>
          <small>{failed.length} runs that produced no reply</small>
        </div>
      </div>
      <table className="runs-table source-table">
        <thead>
          <tr>
            <th>Figure</th>
            <th>Source once wired to production</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Runs, athlete, status, model, prompt</td>
            <td className="mono">agent_runs.owner_id · status · model · prompt_version</td>
          </tr>
          <tr>
            <td>Token classes per request</td>
            <td className="mono">agent_runs.usage → requests[].tokens (ledger v1, #94)</td>
          </tr>
          <tr>
            <td>Run type</td>
            <td className="mono">agent_runs.generation_start_date is not null → generation</td>
          </tr>
          <tr>
            <td>Pre-ledger totals</td>
            <td className="mono">agent_runs.input_tokens · output_tokens</td>
          </tr>
          <tr>
            <td>Prices</td>
            <td className="mono">bench pricing table, pricing-2026-10-20 (list prices)</td>
          </tr>
          <tr>
            <td>Athlete names</td>
            <td className="mono">athletes.display_name</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
