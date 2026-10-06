# Web application

This directory contains the responsive Askesis training-plan and coaching interface. Phase 7 implementation is complete; the [closeout](../../docs/archive/phase-7/phase-7-closeout.md) records management changes, validation and remaining release checks.

## Responsibility

The web application:

- Displays plan context, schedules and workout prescriptions.
- Shows draft differences, prescribed coverage and date-appropriate pace guides.
- Provides human review and plan lifecycle controls.
- Renders persistent coaching conversations, streamed replies and saved agent activity.
- Sends all reads and mutations through the core platform API.

It does not access PostgreSQL directly or own training-plan business rules.

## Selected stack

The frontend uses:

```text
React
Vite
React Router
TanStack Query
Authenticated live event stream
```

TanStack Query owns API reads, mutation state and targeted live refresh. React Router owns navigation.

## Current vertical slice

The application follows the shared [web design system](../../docs/product/web-design-system.md), using the Expo prototype as its visual reference:

- `/today` shows the selected active plan's locked schedule for the current week.
- `/plan` shows active plans with remembered plan/source selection and week/calendar navigation.
- `/plans` and `/plans/archive` provide library and archive access, plan details, history and lifecycle controls.
- `/chat` and `/chat/archive` provide persistent conversations, live coaching, cancellation and retained interrupted replies. Plan-linked conversations include responsive Chat/Plan review.
- `/settings` provides Clerk account management, sign-out, appearance and display preferences.

Clerk protects the application routes, and the generated API client attaches the current session token to API requests.

Provide the public `VITE_CLERK_PUBLISHABLE_KEY` in ignored `apps/web/.env.local` or the shell environment; Vite does not automatically load root `.env`. Then run from the repository root:

```bash
pnpm dev:web
```

Vite listens on <http://localhost:5173> and proxies `/api/*` to the API on port 3000.

See [`../../docs/adr/0001-application-stack.md`](../../docs/adr/0001-application-stack.md) for the full decision.
