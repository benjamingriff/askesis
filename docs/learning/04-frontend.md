# 4. Trace the frontend and its requests

[Day checklist](./README.md) · Previous: [Data model](./03-data-model.md) · Next: [Backend](./05-backend.md)

**65 minutes:** 15 React/state, 20 source trace, 20 browser trace, 10 checkpoint. Your output is one workout's database-to-screen path.

## Just enough React · 15 minutes

A component is a function that describes UI for its current inputs. **Props** are values/callbacks from its parent. **State** is local memory whose changes cause a render. A **hook** is a function such as `useState`, `useQuery` or a project's `useWorkouts` that lets components use stateful behavior. Hooks are called consistently at the top level; React uses that call order to associate state with a component.

Rendering a component is not saving its data. The returned JSX describes what to show; an event callback or query/mutation performs an effect. `useEffect` manages effects and cleanup such as live connections or window listeners. Rendering can happen repeatedly, so do not think of a component as a script that runs once. Web wraps the root in `StrictMode`; this is a development aid, not an extra backend service.

Three different state stores matter here:

| State               | Example                                              | Owner and persistence                                    |
| ------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| Server state        | Plans, workouts, conversations, fitness              | PostgreSQL; browser TanStack Query cache is a projection |
| Interaction state   | Open dialog, selected workout, form text before save | React state in components/hooks                          |
| Browser preferences | Theme/units, selected plan                           | Settings/local storage; not authoritative plan content   |

[`query-provider.tsx`](../../apps/web/src/query-provider.tsx) creates the QueryClient per account. [`main.tsx`](../../apps/web/src/main.tsx) remounts it by Clerk user ID, and cleanup clears old cached data. Query keys identify what a cached result represents; invalidating a key makes relevant reads refetch. A key is neither a SQL primary key nor permission to fetch something.

## Source trace · 20 minutes

Open these in order; read only the named path:

1. [main.tsx](../../apps/web/src/main.tsx): `AuthenticatedRouter` installs Clerk's token provider and account-scoped query context.
2. [router.tsx](../../apps/web/src/router.tsx): `/plan` renders `ActivePlansPage` under `RequireAuthentication` and `AppShell`.
3. [active-plans.tsx](../../apps/web/src/routes/active-plans.tsx): `useActivePlans` fetches the active collection; preferences and local state select the plan/view.
4. [PlanView.tsx](../../apps/web/src/components/PlanView.tsx): chooses draft or locked version, loads brief/workouts/blocks and passes them into `Schedule`.
5. [plan-data.ts](../../apps/web/src/plan-data.ts): `useWorkouts`, `useBlocks` and `useWorkoutDetail` wrap HTTP reads in queries. Version ID and `editNumber` in keys prevent an old draft projection from masquerading as a new one.
6. [api.ts](../../apps/web/src/api.ts): `createAuthenticatedApiClient` attaches `Authorization: Bearer …` and `X-Askesis-Timezone`; relative calls use the current web origin unless a base URL is configured.
7. [api-client/index.ts](../../packages/api-client/src/index.ts): `createAskesisClient` creates an `openapi-fetch` client bound to generated `paths`.
8. [workout.routes.ts](../../apps/api/src/modules/workouts/workout.routes.ts): validated inputs and the authenticated athlete are passed to reads.
9. [workout.repository.ts](../../apps/api/src/modules/workouts/workout.repository.ts): `listWorkouts` builds summaries; `getWorkoutDetail` assembles steps/targets/tags and resolves zones.
10. [Schedule.tsx](../../apps/web/src/components/Schedule.tsx) and [Workout.tsx](../../apps/web/src/components/Workout.tsx): schedule/card interactions open `WorkoutDialog`; `StepList`/`StepItem` render the recursive prescription and format targets.

The card uses summary data. Opening it triggers a **separate detail request** for the tree. This is why a title can be visible before the prescription finishes loading. The API assembles relational rows into nested JSON; React recursively renders that JSON.

```text
workouts + steps/completions/targets + athlete calibration
  → owner-scoped Kysely queries → WorkoutDetail JSON
  → openapi-fetch response → TanStack Query cache
  → WorkoutDialog → StepList → formatting → visible prescription
```

Read `result` in [lib/result.ts](../../apps/web/src/lib/result.ts). `openapi-fetch` exposes data/error/response separately; this helper returns data or throws a safe error that Query can expose to the component. In `WorkoutDialog`, find pending, error/retry and loaded-content branches.

## Exercise: observe actual HTTP · 20 minutes

In the local app, open browser developer tools → Network, filter to `/api/`, and reload `/plan`. Record routes, status codes and a few nonsecret response fields. Do not export a HAR or copy authorization headers.

- [ ] Find `GET /api/v1/plans?collection=active`. Match its logical plan ID to chapter 3.
- [ ] Find `GET /api/v1/workouts?planVersionId=…` and `GET /api/v1/blocks?planVersionId=…`. Match the version to the selected view.
- [ ] Open your chosen workout. Find `GET /api/v1/workouts/{workoutId}`; inspect `workout`, `prescription`, `steps`, `completion` and `targets`.
- [ ] Compare a stored `zoneKey` and a returned `resolvedZone` to the SQL results. Note the returned unit; running pace can already be converted to seconds/mile according to the version brief.
- [ ] Trace the returned `resolvedZone` through `formatTarget`/`formatValue` to visible text. Browser display preferences may also convert pool/load units.
- [ ] Close and reopen the dialog. A fresh cache may avoid an immediate network request (`staleTime` is 60 seconds for details); explain the behavior from the hook.
- [ ] Reload the page, select the same plan/version again if necessary, and reopen that workout. Confirm durable data comes back without relying on the earlier React state.

The app's UI URLs use `/versions/:revisionId`; public API revision endpoints use `/revisions/{revisionId}`. These are different routing layers, so copying the page pathname into an API request is not a reliable shortcut.

Locally, [Vite config](../../apps/web/vite.config.ts) proxies `/api` to the API host/port. In production, [nginx.conf](../../apps/web/nginx.conf) forwards it. The browser sees same-origin requests; nginx/Vite are intermediaries, not where the domain data lives. Clerk route protection improves navigation, while the API independently validates sessions and ownership.

Reading fallback: use `WorkoutDialog`, `getWorkoutDetail` and [workout component tests](../../apps/web/src/components/Workout.test.tsx) to trace the same shapes. Mark network/reload verification as pending if the app is unavailable.

## Checkpoint · 10 minutes

Write five lines in your notes:

1. **Route:** `/plan` → `ActivePlansPage`.
2. **Query:** `PlanView` → `useWorkouts`/`useWorkoutDetail`, with keys identifying saved content.
3. **Request:** authenticated generated client → local/production proxy → Hono.
4. **Projection:** owner-filtered SQL → assembled tree and resolved zones.
5. **Presentation:** `WorkoutDialog`/`StepList` → formatters/CSS.

Now explain why changing a component prop, invalidating a query and updating a database row are three different actions. Name the source of a card's distance estimate versus a prescription's actual distance completion.

Optional later: [web design system](../product/web-design-system.md), [theme palette](../../apps/web/src/theme/palette.ts), [workout selection hook](../../apps/web/src/lib/use-workout-selection.ts), [intensity chart](../../apps/web/src/components/IntensityChart.tsx).
