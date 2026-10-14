# ADR 0007: Configurable coaching provider with a Claude runtime

- **Status:** Accepted; extends [ADR 0003](./0003-coaching-worker.md).
- **Decision checkpoint:** 2026-10-13.
- **Recorded:** 2026-10-13.

## Context

ADR 0003 placed the coaching loop in a private worker using the OpenAI Agents SDK and accepted only `AGENT_PROVIDER=openai`. The owner wants Claude available as the coaching model. Later, users will choose a model and reasoning level, so switching providers should need configuration only, not code changes. The two providers must behave the same in every respect the API and the user can observe: serial tool execution, draft-version tracking, streamed and durable progress, cancellation, limits and failure codes.

## Decision

The worker selects its runtime from `AGENT_PROVIDER` (`openai` or `anthropic`). A provider-neutral core (`apps/agent/src/runtime/core.ts`) owns the run lifecycle, tool execution, progress, final-reply handling and failure codes. Each provider adapter only translates the conversation and drives its model loop. A `ModelProfile` (provider, model, reasoning, output limit) describes what a run executes with; the worker builds it from its environment today, and a run can carry a user-selected profile later.

The Claude adapter uses the Anthropic TypeScript SDK (`@anthropic-ai/sdk`) and the Messages API with its own streaming tool loop:

- Configured effort maps directly to `output_config.effort`; thinking is adaptive.
- `disable_parallel_tool_use` keeps tool calls serial. Each response's tool results return together in one message.
- Assistant turns, including thinking blocks, are appended unchanged, so history stays append-only.
- The `thinking-display-updates-2026-08-18` beta returns the model's short notes between tool calls as text. These are saved as progress, like OpenAI's text before a tool, while reasoning stays hidden.
- The system prompt, tools and conversation carry prompt-cache markers.
- Configuration accepts only Claude models verified with this request shape (`claude-opus-5-5` by default, `claude-sonnet-5-5`, `claude-fable-5-1`). Output limits are higher because thinking counts toward them.

A refusal (`stop_reason: refusal`) fails the run with `MODEL_REFUSAL`, and the web tells the user the model declined. Refusals never fall back to another model, so the configured model is the only one that answers.

A shared contract suite runs every behavioural case against both runtimes from one neutral script (`apps/agent/src/testing.ts`). Provider-specific request shapes have their own tests. The disposable smoke runs once per provider in CI.

## Alternatives considered

The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) packages the Claude Code harness: a CLI subprocess with built-in file, shell and web tools, sessions and permissions. Custom tools would be exposed through MCP and built-in tools disabled, and it has no deterministic scripted-model seam. ADR 0003 already excluded coding-agent runtimes for this domain-tool worker for the same reasons.

The Anthropic SDK's beta tool runner would own the loop. The runtime needs per-call timing, serialized execution through the shared tool executor, turn limits and stop-reason handling, so a short explicit loop is clearer.

## Consequences

Switching provider is a worker configuration change. Each worker registers its provider and model, and every run records the provider that claimed it. The `agent_workers.provider` constraint accepts both providers. One worker serves one profile; per-run selection will need workers to register the providers they hold keys for, and the claim to match a run's requested provider.

The coaching prompt and its version are shared. Prompt or quality differences between providers should be measured with the benchmark, whose simulator and reviewer stay on fixed OpenAI models. The contract suite caught that OpenAI tool rejections were wrapped by the SDK and reported as `PROVIDER_ERROR`; both runtimes now report the API's own code, such as `STALE_CONTEXT`.

## Evidence

See the [runtime implementation](../../apps/agent/src/runtime/), [contract suite](../../apps/agent/src/runtime/contract.test.ts) and [worker operations](../operations/phase-5-runtime.md).
