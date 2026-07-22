# Web application

This directory will contain the Askesis training-plan interface.

## Responsibility

The web application will:

- Display plan intent, blocks, weeks, and workouts.
- Visualise workout prescription trees across endurance and strength disciplines.
- Show macro targets alongside derived or estimated plan metrics.
- Resolve and display the calibration behind semantic intensity targets.
- Send all reads and mutations through the core platform API.

It will not access PostgreSQL directly or own training-plan business rules. If the chosen framework provides server-side capabilities, they may act as a thin backend-for-frontend for sessions, rendering, response composition, and UI-specific caching.

## Selected stack

The initial frontend will use:

```text
React
Vite
React Router
Router loaders and actions
```

TanStack Query is intentionally deferred until cross-route caching, polling, optimistic updates, or complex invalidation justify it.

## Current vertical slice

The root route uses a React Router loader and the generated OpenAPI client to render scheduled workouts from the Hono API in chronological order. Each row can be expanded using a React Router fetcher to show its nested sequence, repeated steps, completions, targets, instructions, tags, and date-appropriate resolved zones.

Run it locally from the repository root:

```bash
npm run dev:web
```

Vite listens on <http://localhost:5173> and proxies `/api/*` to the API on port 3000.

See [`../../docs/adr/0001-application-stack.md`](../../docs/adr/0001-application-stack.md) for the full decision.
