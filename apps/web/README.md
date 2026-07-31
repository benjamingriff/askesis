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

TanStack Query will be introduced with persistent chat and live agent mutations. React Router remains the router for the v1 prototype.

## Current vertical slice

The application uses a Grok-inspired persistent shell with three prototype areas:

- `/plan` renders a compact calendar and scheduled workouts from the Hono API. Each workout expands through a React Router fetcher to show its nested sequence, repeats, completions, targets, instructions, tags, and date-appropriate resolved zones.
- `/chat` provides a cosmetic coaching-chat interface with hardcoded conversation history and local mock replies. It does not call an agent or persist messages yet.
- `/settings` uses Clerk account data and provides profile management and sign-out controls.

Clerk protects the application routes, and the generated API client attaches the current session token to API requests.

Run it locally from the repository root:

```bash
pnpm dev:web
```

Vite listens on <http://localhost:5173> and proxies `/api/*` to the API on port 3000.

See [`../../docs/adr/0001-application-stack.md`](../../docs/adr/0001-application-stack.md) for the full decision.
