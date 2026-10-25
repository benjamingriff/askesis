# Bring-your-own-agent MCP server

Recorded: 2026-10-25. Status: accepted direction; Phase 0 spike complete (findings below). Owner decisions: Claude clients first, ChatGPT best-effort; build it regardless of the coach's latency numbers; open source is a separate, later milestone.

## Idea

Expose Askesis as a remote [Model Context Protocol](https://modelcontextprotocol.io) server so athletes can plan with the agent they already use (Claude.ai, Claude Desktop, Claude Code and later ChatGPT). Plans, logs and fitness stay persisted in Askesis; the web app remains the place to review, lock and train. The athlete's own subscription pays for the model, so Askesis can release to friends without hosting or costing a coaching agent. The built-in coach continues as a separate track.

## Why the current system fits

- The coaching worker is already an external agent calling an authorized domain API. Its tools (`ToolSchemas` in `apps/api/src/modules/agent/agent.schemas.ts`) have Zod schemas, JSON Schema output and model-facing descriptions.
- Guardrails live in the API: schedule validation, versioned drafts, human-only brief confirmation, locking and unlocking, and deterministic zone calculators. An external agent receives the same protection.
- Plan, log and calibration writes emit owner-scoped live events from database triggers, so the web app refreshes when an external agent saves a change. Logs entered in the app are visible to the agent on its next read.
- `CHAT_EXECUTION_MODE=unavailable` already lets the product run without the coaching worker.

## What changes

1. **Tools without runs.** Today every tool call is authorized by a run token bound to one conversation, plan, draft version and edit number (`authorized` and `target` in `agent.service.ts`). External calls carry a signed-in athlete instead. Plan tools take an explicit `planId`; a `list_plans` tool lets the agent find them.
2. **Concurrency per call.** Reads return the draft's `editNumber`; writes send `expectedEditNumber` and fail with `STALE_CONTEXT` when another writer (the athlete, the coach or another agent) changed the draft. The run's generation horizon and run-scoped idempotency receipts need an external equivalent.
3. **Bounded reads.** A full `read_schedule` can reach 500 KB, which floods a chat client's context. External clients need a compact projection plus per-week detail.
4. **Authentication.** Claude.ai and ChatGPT connectors expect OAuth 2.1 under the MCP authorization specification. Clerk can be the authorization server (client ID metadata documents, or dynamic client registration where a client needs it). The API publishes protected-resource metadata, verifies Clerk OAuth access tokens and maps them to athletes through `athlete_identities`. Personal access tokens are a possible Claude Code fallback.
5. **Coaching guidance.** The coaching prompt holds the product's expertise. External agents receive an adapted guide as MCP server instructions and a prompt. Clients load these inconsistently, so actionable tool error messages carry more weight.
6. **Product.** A Settings page with the connector URL and connected clients, chat hidden behind a flag, and attribution of external edits in the review panel.
7. **Release readiness.** Per-user rate and size limits on the MCP endpoint, plus the existing Phase 8 checklist (invitations, backups, data removal).

## Known trade-offs

- **Latency.** An external agent writes the same workout trees through the same tools, so a plan is not necessarily faster to build; the athlete pays for and is used to their own client's pace.
- **ChatGPT.** Write access for custom MCP connectors may be limited to some plans and require developer mode. Claude clients are the dependable first target.
- **One direction.** MCP calls originate from the agent. Askesis cannot push a prompt to the athlete's agent; the agent sees new logs and check-ins when it reads.
- **Quality visibility.** The benchmark evaluates the built-in coach. External coaching is visible only through what gets saved.
- **Attribution.** Logs and calibrations recorded externally need their own provenance rather than appearing as athlete or coach entries.

## Plan

| Phase              | Work                                                                                                                                                                                              | Size     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 0. Spike           | Development-only `/mcp` endpoint with a local token. Reuse domain services, connect Claude Code and build a plan. Learn how a general agent copes with the tools and guidance.                    | 1–2 days |
| 1. Domain refactor | Extract tool operations from the run wrapper so one executor serves a run or a signed-in athlete. Per-call concurrency and idempotency; the worker's behaviour and contract tests stay unchanged. | 3–5 days |
| 2. MCP endpoint    | Streamable HTTP route in the Hono API (official TypeScript SDK, stateless), compact schedule reads, server instructions and a coaching prompt, per-user rate and size limits.                     | 2–3 days |
| 3. OAuth           | Clerk OAuth applications, default scopes, protected-resource metadata and token verification. End-to-end checks with Claude.ai, Claude Desktop and Claude Code; ChatGPT best-effort.              | 2–4 days |
| 4. Product         | Settings connection page, chat feature flag, review-panel attribution for external edits, documentation and an ADR.                                                                               | 2–3 days |
| 5. Release         | Phase 8 checks, invite friends and observe usage.                                                                                                                                                 | ongoing  |
| Later              | Open source: audit git history for secrets (an earlier checkpoint recorded an exposed Clerk development secret), choose a licence, document self-hosting.                                         | separate |

## Phase 0 spike

Scope: learn, not ship. The spike lives behind development-only configuration and never runs in production.

- `/mcp` on the API speaks stateless Streamable HTTP through `@modelcontextprotocol/server` (`apps/api/src/modules/mcp/`).
- A bearer token from `MCP_DEV_TOKEN` acts as the athlete whose Clerk user is `MCP_DEV_CLERK_USER_ID`. `pnpm dev:mcp` writes both to the worktree `.env` and prints the `claude mcp add` command. The API refuses this configuration when `NODE_ENV=production`.
- Tools mirror the coach's, with an explicit `planId` and a required `expectedEditNumber` on plan writes. There is no generation horizon and no idempotency receipt; external logs and calibrations are recorded without run attribution.
- Server instructions adapt the coaching prompt to an external agent. The coach's prompt and version are unchanged.

Questions the spike should answer:

1. Can Claude build a complete, valid multi-week plan from the tools and guidance alone?
2. Which errors or schemas confuse it, and what do the tool responses cost in context?
3. Does the web app reflect external edits live, and does the human review and lock flow still feel right?
4. What does the Phase 1 executor need that the spike had to work around?

### Try it locally

1. `pnpm dev:setup`, then `pnpm dev:mcp` (add `--email you@example.com` to act as your own Clerk development account instead of the verification account). It writes `MCP_DEV_TOKEN` and `MCP_DEV_CLERK_USER_ID` to the worktree `.env` and prints a `claude mcp add` command containing the token. Treat that token as a password.
2. `pnpm dev` (restart it if it was already running), then run the printed command and start `claude`. `/mcp` lists the Askesis server; the `coach` prompt is available as a slash command.
3. Watch the plan appear in the web app. Ctrl+C stops the servers; delete the two `MCP_DEV_*` lines from `.env` to turn the endpoint off.

## Spike findings

Recorded 2026-10-25 from two headless Claude Code runs (`claude -p`, default model Claude Opus 5.5) against the local endpoint, with only the Askesis tools allowed. The athlete was a single seeded development account; the scenario was a sub-50 10K on 7 March 2027 from a 52:30 best, four runs a week and a Thursday club track night.

**It works end to end.** In one message Claude listed plans, previewed and recorded the 10K result, created the plan, saved a full brief, wrote a 19-week phased structure (base, build, peak, taper) with weeks 1–4 fully prescribed, validated and explained what to review. That took 11 turns and about 6.5 minutes (about $1.92 of model usage, borne by the athlete's subscription). A follow-up turn in the same session read weeks 5–8, replaced them in full, kept weeks 1–4 untouched and revalidated: about 4.7 minutes and $3.52. Coverage, zones, validation findings and the human-only brief confirmation all behaved as for the in-app coach, and the agent explained the brief-confirmation and schedule-review requirements correctly.

**Errors it had to recover from** (each recovered on the next call):

- `SCHEDULE_INVALID: Steps need one root…` on the first 46 KB batch. The message does not name the workout, so the agent had to guess.
- `replace_schedule_range` twice: first it tried to update existing workouts in place, then it sent explicit deletions. The description should say plainly that a range replacement deletes everything in the range and accepts new workouts only.

**Coaching drift from the guidance.**

- Placeholders were used as "not yet written" stubs for future weeks (43 of 76 workouts), not for training decided elsewhere.
- The Thursday club night was prescribed as real workouts, even after the athlete explicitly asked for club sessions. The guidance and tool descriptions need a clearer contract for unfinished horizons (structure only, no workouts) and for club sessions (always placeholders). The in-app coach's prompt states the same rules, so the benchmark is the place to check whether it shares the drift.

**Context cost.** `read_schedule` for four weeks of placeholders returned 38 KB. Claude Code spilled it to a file and read it back with a shell `jq` call, which only worked because the client happened to allow it. Phase 2's compact schedule projection is necessary, not optional. Writes of 23–49 KB per batch were accepted without trouble.

**Concurrency and identity.** `expectedEditNumber` was threaded correctly through every write without prompting. `today` from `list_plans` was used correctly ("Askesis still shows today as 25 October"). The database test covers stale edits, locked drafts and foreign plans.

**Not verified.** The live web view of external edits was not checked in the browser. The Clerk development secret that worktrees import from the main checkout's `.env` is rejected by Clerk (`clerk_key_invalid`, apparently rotated), so neither `pnpm dev:login` nor `pnpm dev:mcp` could reach Clerk; the spike seeded a local athlete identity directly instead. Live events come from database triggers, so web refresh is expected to work, but it remains unconfirmed.

**Implications for Phase 1 and later.**

1. Phase 1 should merge the spike's executor (`mcp.service.ts`) with the coach's, rather than keep two copies of the brief and schedule logic.
2. Phase 2 needs a compact `read_schedule` and schedule errors that name the offending workout or step.
3. Rewrite the guidance and tool descriptions around unfinished horizons, placeholders and range replacement. Evaluate them with the benchmark's simulated athletes driving the MCP tools, which avoids paying for headless client runs.
4. External logs and calibrations currently appear as the athlete's own entries; give them their own provenance.
