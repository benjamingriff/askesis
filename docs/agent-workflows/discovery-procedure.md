# Shared discovery procedure

All discovery categories use this procedure to create comparable, resumable backlog items. The category skill supplies the evidence standard; this document supplies scope, deduplication, and publication mechanics.

## Scope and authority

Resolve the checkout root and repository using read-only git/`gh` commands. Read applicable `AGENTS.md`/`CLAUDE.md`, current implementation/configuration, and the discovery/backlog/approval-policy sections of [the workflow plan](../agent-workflows.md).

Use the requested base, otherwise inspect the current checkout and record its SHA. Search broadly, then examine promising behaviors/callers in depth. Honour a requested focus or budget and report coverage limitations. Default to at most three new tickets per discovery run; no useful findings is a valid outcome.

A report-only audit or preview invocation returns local drafts. A request to populate the backlog or an explicit category invocation to publish tickets authorises issue creation and appropriate labels/comments. Resolve publication authority from that request and existing session instructions; automatic skill selection alone does not grant permission to publish. Discovery does not implement, start workers, install tools, change repository settings, or test production services.

## Deduplication and selection

Read open issues and PRs, then search relevant closed/rejected tickets. Paginate or refine queries; one limited page is not the full backlog. Match underlying problems across categories rather than titles. Prefer updating/referencing an existing ticket over creating overlapping testing/reliability/interface tasks.

Existing PRs or feature branches may already solve a problem. Honour owner-set priorities and recorded rejection reasons. Material new evidence can justify reconsideration, but record why it differs. Do not silently reopen rejected work.

Rank by expected impact, evidence confidence, and effort. Use `priority:high`, `priority:normal`, or `priority:low` relative to this backlog, with a rationale. Prefer small independently deliverable tasks. Record dependencies on unmerged work instead of treating an imagined future base as current code.

## Ticket and publication

Use [the ticket template](./ticket-template.md). Include repository/commit-scoped evidence, expected benefit, observable acceptance criteria, exclusions, category, priority rationale, effort, dependencies, approval policy, and discovery provenance. Distinguish observed facts from hypotheses. Ready work has bounded scope and sufficient evidence; ambiguous requirements/behavior or missing evidence stays in inbox.

For authorised publication:

1. Verify the selected category, priority, state, and approval labels exist. Missing vocabulary means local drafts and a setup handoff, not silent repository reconfiguration.
2. Choose a stable underlying-problem key and discovery marker. Recheck for a matching issue immediately before publication.
3. Write the exact body to a temporary Markdown file. Use `gh issue create --repo OWNER/REPO --title TITLE --body-file PATH` with the verified labels, safely quoting arguments.
4. If publication times out, search for the marker/problem to recover the existing issue before retrying. Do not publish duplicates because the command response was lost.
5. Update existing issue discussion/labels only within the requested publication scope; preserve its ownership, state, priorities, and established decisions.

The first category skills use `kind:testing`, `kind:interface`, and `kind:reliability`. When a task crosses categories, select the primary desired outcome and reference related evidence rather than issuing duplicate tickets. Mark human approval when solving the task would define/change a contract requiring an owner decision.

## Handoff

Return the repository/SHA, inspected scope, ranked issue links or local draft paths, reused/skipped problems and reasons, and diagnostic limitations. Be clear about publication status. Leave implementation and its proposal review to `work-ticket`.
