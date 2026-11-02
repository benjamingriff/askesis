# usagealytics

A prototype dashboard for model usage and cost: cache efficiency now, spend per customer next. It shares coachalytics' visual language (near-black canvas, hairline rules, DM Sans, tan accent, filter sidebar) but runs as its own app.

```sh
pnpm dev:usage
```

The root command selects a worktree-specific port (`USAGE_PORT` overrides it) and binds to `127.0.0.1`; direct app-level Vite defaults to 5189. Ctrl+C or `pnpm dev:stop usage` stops it.

## Data

Everything shown is synthetic: a seeded population of athletes and coach runs generated in `src/lib/usage.ts`. Each run carries the per-request ledger that `agent_runs.usage` records (uncached input, cache reads, cache writes by TTL, output, reasoning, usage completeness) and is priced with the same list-price table. Runs without a final ledger stay unpriced and are counted separately, as historical rows will be. The Coverage section maps each figure to the production column it will come from. Wiring real data means replacing `syntheticUsage()` with a loader that returns the same `UsageDataset`.

- **Overview**: spend, cache hit rate, caching savings, runs and spend per athlete against the previous period; daily spend by token type, model or run type; cache hit rate per model and by request position; token share against spend share.
- **Customers**: a sortable table with daily sparklines, spend concentration, and runs against mean cost per run.
- **Runs**: the most expensive runs and ledger coverage. Expanding a run shows each model request.
- **Athlete** (`#/athletes/<id>`): rank, multiple of the median athlete, daily spend and every run.
