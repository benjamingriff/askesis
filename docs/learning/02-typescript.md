# 2. Read this project's TypeScript

[Day checklist](./README.md) · Previous: [Orientation](./01-orientation.md) · Next: [Data model](./03-data-model.md)

**45 minutes:** 15 concepts, 20 source exercise, 10 checkpoint. Aim to read the code comfortably, not learn every TypeScript feature.

## Three kinds of contract

1. **SQL schema:** what PostgreSQL can store and enforce. Atlas migrations create it.
2. **TypeScript types:** what the compiler checks while developers write code. They are erased at runtime.
3. **Zod schemas:** executable parsers/validators for values arriving at runtime. Hono also uses public schemas to describe OpenAPI.

This resembles a typed dataframe declaration versus validating the actual input records versus enforcing warehouse constraints. A type annotation alone does not validate a network response or make a SQL write authorized.

```text
SQL migrations → applied database → kysely-codegen → database/generated.ts
Hono routes + Zod schemas → OpenAPI JSON → openapi-typescript → api-client/schema.ts
```

Generated files are committed so queries and consumers can be checked together. Edit their sources, then regenerate them. [`scripts/check-generated.sh`](../../scripts/check-generated.sh) detects drift in the public OpenAPI/client outputs; database type generation is a separate command. The two generation chains describe different contracts: database rows and public HTTP projections.

## Syntax you will meet · 15 minutes

| Syntax                                             | Meaning                                                 | Real place to look                                                                            |
| -------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `import type { … }`                                | Compiler-only dependency                                | [plan-data.ts](../../apps/web/src/plan-data.ts)                                               |
| `type Plan = paths['…']['get']['responses'][200]…` | Select a response type from a generated type map        | `Plan` in that file                                                                           |
| `Pick<T, 'id' \| 'editNumber'>`                    | Keep selected properties                                | `versionKey`                                                                                  |
| `Omit<T, 'steps'>`                                 | Remove properties to define an internal shape           | `TreeNode` in [workout repository](../../apps/api/src/modules/workouts/workout.repository.ts) |
| `T \| null`                                        | A value or an explicit absence                          | `planVersion`                                                                                 |
| `field?: T`                                        | The field can be omitted                                | Props on [WorkoutDialog](../../apps/web/src/components/Workout.tsx)                           |
| `value?.field` / `a ?? b`                          | Access if present / default for null or undefined       | `planVersion`                                                                                 |
| `value!`                                           | Tell the compiler it is present; adds no runtime check  | `version!.id` inside enabled queries                                                          |
| `as const`                                         | Preserve literal types/read-only tuple inference        | `versionKey`                                                                                  |
| `Promise<T>` / `async` / `await`                   | A future value; wait for it                             | `listWorkouts`                                                                                |
| `z.infer<typeof Schema>`                           | Derive a static type from a runtime schema              | [worker API client](../../apps/agent/src/api.ts)                                              |
| `Kysely<DB>` / `Selectable<Workouts>`              | Generic types bind SQL queries/rows to generated schema | [database client](../../apps/api/src/database/client.ts), workout repository                  |

`null`, `undefined`, zero and empty string mean different things. For example, a missing distance is `null`; it should not become a zero-distance workout accidentally. [`tsconfig.base.json`](../../tsconfig.base.json) enables strict checking, indexed-access checking and exact optional properties. Expect explicit handling of missing data.

### TS, TSX and the runtime

`.ts` contains TypeScript; `.tsx` permits JSX such as `<WorkoutCard workout={workout} />`. JSX describes a component tree, including data passed as props and callbacks. It is compiled JavaScript, not HTML served by the API.

API/worker [TypeScript config](../../apps/api/tsconfig.json) uses NodeNext and emits JavaScript into `dist`. A source import like `./config.js` refers to the compiled module path even though the source file is `config.ts`. `tsx watch` runs TypeScript during API development. Web [config](../../apps/web/tsconfig.json) uses bundler resolution and `noEmit`; Vite performs the browser build. The browser cannot import server modules with database credentials merely because both are TypeScript.

## Exercise: translate actual code · 20 minutes

- [ ] In [plan-data.ts](../../apps/web/src/plan-data.ts), find `Plan`, `planVersion`, `versionKey` and `useWorkouts`. Read only those symbols.
- [ ] Rewrite `useWorkouts` in plain English: “When a version exists, cache the workouts under this version ID and edit number, request its workout list, and unwrap the response.”
- [ ] In [workout.schemas.ts](../../apps/api/src/modules/workouts/workout.schemas.ts), find `WorkoutListQuerySchema` and `WorkoutStepSchema`. Locate required `planVersionId` and the recursive prescription shape.
- [ ] In [workout.routes.ts](../../apps/api/src/modules/workouts/workout.routes.ts), find `context.req.valid('query')`. Explain why parsed input is used instead of an unchecked query string.
- [ ] In [workout.repository.ts](../../apps/api/src/modules/workouts/workout.repository.ts), find `listWorkouts` and `toWorkoutSummary`. Identify snake_case SQL fields becoming camelCase JSON fields, and numeric conversion.
- [ ] In [client exports](../../packages/api-client/src/index.ts), follow `WorkoutSummary` back to generated `components`. Locate its definition in [schema.ts](../../packages/api-client/src/schema.ts); do not read the whole generated file.

Experiment without saving a code change: mentally remove the version query parameter from `api.GET('/api/v1/workouts', …)`. The typed public client should catch the missing required query at development time; runtime route validation also rejects an invalid request. These are complementary protections.

## Checkpoint · 10 minutes

Explain these four lines of responsibility:

- **Kysely types** check table/column usage; SQL constraints still enforce storage integrity.
- **OpenAPI types** check known routes and payload shapes; they do not validate arbitrary JSON at runtime.
- **Zod** parses/validates values where code invokes it; inspect the call site to know what is validated.
- **Authorization** is a runtime service/query decision; neither an interface nor a UUID makes access legal.

Write the two generation chains from memory and circle the files you would edit. Read the generation commands in [local development](../operations/local-development.md#generated-types), but do not regenerate just to explore: DB codegen must target the correct database, and it does not automatically load root `.env`.

Optional later: compare a [domain test](../../apps/api/src/modules/plans/plan.domain.test.ts), a [component test](../../apps/web/src/components/Workout.test.tsx) and a [database integration test](../../apps/api/test/db/workout.repository.test.ts).
