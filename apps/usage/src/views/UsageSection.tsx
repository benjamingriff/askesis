import { useMemo } from 'react';
import { formatPercent } from '../lib/format';
import { modelColors, modelName } from '../lib/models';
import { href, type Route } from '../lib/route';

import {
  EMPTY_USAGE_FILTERS,
  isUsageFiltered,
  KIND_LABEL,
  toggle,
  sliceUsage,
  summarize,
  syntheticUsage,
  type RunKind,
  type RunStatus,
  type UsageFilters,
  type UsageRange,
} from '../lib/usage';
import { AthleteUsage } from './AthleteUsage';
import { customerRows, Usage } from './Usage';

interface UsageState {
  filters: UsageFilters;
  setFilters: (filters: UsageFilters) => void;
}

const STATUS_LABEL: Record<RunStatus, string> = {
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function UsageSection({
  route,
  state,
  menuOpen,
}: {
  route: Route;
  state: UsageState;
  menuOpen: boolean;
}) {
  const dataset = useMemo(() => syntheticUsage(), []);
  const colors = useMemo(() => modelColors(dataset.runs.map((run) => run.model)), [dataset]);
  const { filters, setFilters } = state;
  const population = useMemo(() => sliceUsage(dataset, filters), [dataset, filters]);
  const athleteSlice = useMemo(
    () => (route.athleteId ? sliceUsage(dataset, filters, route.athleteId) : null),
    [dataset, filters, route.athleteId],
  );

  return (
    <>
      <div className="demo-banner">
        Synthetic preview: a seeded population shaped like the <code>agent_runs.usage</code> ledger
        from #94, priced with <code>{dataset.pricingVersion}</code>. No production data is read yet.
      </div>
      <div className="body-layout">
        <main>
          {route.athleteId && athleteSlice ? (
            <AthleteUsage
              key={route.athleteId}
              dataset={dataset}
              athleteId={route.athleteId}
              slice={athleteSlice}
              population={population}
              colors={colors}
              range={filters.range}
            />
          ) : (
            <Usage dataset={dataset} slice={population} colors={colors} range={filters.range} />
          )}
          <footer>
            <span>
              {dataset.runs.length.toLocaleString('en-GB')} synthetic runs ·{' '}
              {dataset.athletes.length} athletes · {dataset.days.length} days
            </span>
            <span>Estimates use list prices and are not invoice reconciliation.</span>
          </footer>
        </main>
        <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
          <UsageSidebar
            state={state}
            dataset={dataset}
            colors={colors}
            selected={route.athleteId}
            onReset={() => setFilters({ ...EMPTY_USAGE_FILTERS, range: filters.range })}
          />
        </aside>
      </div>
    </>
  );
}

function UsageSidebar({
  state,
  dataset,
  colors,
  selected,
  onReset,
}: {
  state: UsageState;
  dataset: ReturnType<typeof syntheticUsage>;
  colors: Map<string, string>;
  selected: string | null;
  onReset: () => void;
}) {
  const { filters, setFilters } = state;
  // Counts reflect the date range but not the other filters, so hidden rows stay findable.
  const inRange = useMemo(
    () => sliceUsage(dataset, { ...EMPTY_USAGE_FILTERS, range: filters.range }).runs,
    [dataset, filters.range],
  );
  const visible = useMemo(() => sliceUsage(dataset, filters), [dataset, filters]);
  const count = <T extends string>(pick: (run: (typeof inRange)[number]) => T) => {
    const counts = new Map<T, number>();
    for (const run of inRange) counts.set(pick(run), (counts.get(pick(run)) ?? 0) + 1);
    return counts;
  };
  const models = count((run) => run.model);
  const kinds = count((run) => run.kind);
  const statuses = count((run) => run.status);
  const athletes = useMemo(() => {
    const map = new Map(dataset.athletes.map((athlete) => [athlete.id, athlete]));
    return customerRows(visible.runs, map, visible.days);
  }, [dataset, visible]);
  const total = summarize(visible.runs).usd;

  return (
    <>
      <div className="side-heading">
        <h2>
          Runs <span>{visible.runs.length}</span>
          <span className="slash">/</span>
          <span>{inRange.length}</span>
        </h2>
        {isUsageFiltered(filters) && (
          <button className="text-button" onClick={onReset}>
            Reset
          </button>
        )}
      </div>

      <div className="segmented" role="group" aria-label="Date range">
        {([7, 30, 90] as UsageRange[]).map((range) => (
          <button
            key={range}
            aria-pressed={filters.range === range}
            onClick={() => setFilters({ ...filters, range })}
          >
            {range}d
          </button>
        ))}
      </div>

      <div className="search">
        <SearchIcon />
        <input
          placeholder="Search athletes or plans"
          value={filters.search}
          onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          aria-label="Search athletes or plans"
        />
      </div>

      <section className="model-section">
        <div className="section-head">
          <h3>Models</h3>
        </div>
        {[...models.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([model, n]) => {
            const hidden = filters.hiddenModels.includes(model);
            return (
              <button
                key={model}
                className={`model-row${hidden ? ' hidden' : ''}`}
                aria-pressed={!hidden}
                onClick={() =>
                  setFilters({ ...filters, hiddenModels: toggle(filters.hiddenModels, model) })
                }
              >
                <i className="model-dot" style={{ background: colors.get(model) }} />
                <span>{modelName(model)}</span>
                <small>{n}</small>
              </button>
            );
          })}
      </section>

      <section className="model-section">
        <div className="section-head">
          <h3>Run type</h3>
        </div>
        {(['chat', 'generation'] as RunKind[]).map((kind) => {
          const hidden = filters.hiddenKinds.includes(kind);
          return (
            <button
              key={kind}
              className={`model-row${hidden ? ' hidden' : ''}`}
              aria-pressed={!hidden}
              onClick={() =>
                setFilters({ ...filters, hiddenKinds: toggle(filters.hiddenKinds, kind) })
              }
            >
              <i className={`selection${hidden ? '' : ' checked'}`} />
              <span>{KIND_LABEL[kind]}</span>
              <small>{kinds.get(kind) ?? 0}</small>
            </button>
          );
        })}
      </section>

      <section className="model-section">
        <div className="section-head">
          <h3>Status</h3>
        </div>
        {(['completed', 'failed', 'cancelled'] as RunStatus[]).map((status) => {
          const hidden = filters.hiddenStatuses.includes(status);
          return (
            <button
              key={status}
              className={`model-row${hidden ? ' hidden' : ''}`}
              aria-pressed={!hidden}
              onClick={() =>
                setFilters({
                  ...filters,
                  hiddenStatuses: toggle(filters.hiddenStatuses, status),
                })
              }
            >
              <i className={`selection${hidden ? '' : ' checked'}`} />
              <span>{STATUS_LABEL[status]}</span>
              <small>{statuses.get(status) ?? 0}</small>
            </button>
          );
        })}
      </section>

      <section className="model-section">
        <div className="section-head">
          <h3>Top customers</h3>
        </div>
        {athletes.slice(0, 12).map((row) => (
          <a
            key={row.athlete.id}
            href={href(row.athlete.id)}
            className={`suite-row${row.athlete.id === selected ? ' active' : ''}`}
          >
            <span className="suite-title">{row.athlete.name}</span>
            <span className="suite-meta">
              ${row.usd.toFixed(2)} · {formatPercent(total === 0 ? null : row.usd / total)} of spend
              · {row.runs} runs
            </span>
          </a>
        ))}
      </section>
    </>
  );
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
