# Phase 7 gap investigation

## Current-code reconciliation — 2026-10-06

- G1–G5 were subsequently resolved by Phase 7: confirmation baseline/retries, development account policy, library list presentation, independent labels and archive navigation. The implementation/tests and closeout support that completion.
- The original `delete_self=true` observation was superseded by the recorded development policy verification. Current Clerk instance/user policy still requires external checking, especially production setup.
- F1 historical summary-language improvements and F2 active-plan form unmount handling remain optional/deferred. Native-first prioritization is superseded by continued web development.

The remaining content is the original historical record. Current procedures/contracts are indexed in [the documentation index](../../README.md).

> Historical delivery record. Status, pending checks and next-step recommendations describe the original checkpoint; see the [current handoff](../../current-handoff.md) for present priorities.

## Status and scope

Investigated on 2026-10-06 against repository revision `d1d9972`, after the merge of Phase 6 and the subsequent web tab-bar and dependency fixes. This is an investigation and proposed completion scope, not an implementation or a claim that Phase 7 is complete.

The subsequent [Phase 7 refinement and closeout](./phase-7-closeout.md) resolves the decisions below and records implementation status. This investigation preserves the original findings and verification evidence.

The owner confirmed Phase 6 is fully complete and working. Markdown plan export has been removed as a possible feature, including from the alpha and future backlog. Native integration, generation-speed optimization and Phase 8 release operations remain separate work.

Phase 7 already has its core domain commands, persistence and most web controls. The remaining work is concentrated in five concrete gaps: discard confirmation concurrency, Clerk self-deletion configuration, library/calendar separation, explicit plan-state labels, and archive navigation. Historical difference presentation and retention of unsaved details when an active plan disappears are worthwhile follow-ups, with narrower status described below.

## Investigation method and limits

Traced the [accepted roadmap](../../product/v1-poc-development-plan.md#phase-7-product-management-controls) through web routes, shared components, generated API schemas, domain services, migrations and regression tests. Read the earlier lifecycle refinements and web design decisions to avoid treating accepted behavior as missing functionality.

Ran all existing web, API unit and worker tests, plus the PostgreSQL integration suite and version-invariant checks. Four temporary component probes reproduced the library calendar, missing state labels, discard concurrency and archived-chat collection behavior. Those probes asserted the observed current behavior; they are diagnostic evidence, not tests proving those behaviors are correct. Removed them after the investigation so the delivery changes documentation only.

The T3 collaborative preview successfully opened the hosted app at `https://askesis.up.railway.app/sign-in`. It was initially signed out. A signed-in session became available during the final pass; opened a separate background tab to inspect You → Manage account → Profile/Security. Read the public Clerk environment and the current user’s deletion-permission boolean; observed the Delete account button without clicking it. Did not create an account, impersonate anyone, change instance settings, edit identity, sign out, delete data or invoke a model. Production plan/chat mutation workflows were not exercised during this audit.

## Requirement inventory

| Phase 7 requirement                                    | Current implementation and evidence                                                                                                                                                                                                                                               | Assessment                                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Active plans in the Plan area                          | [`useActivePlans` and `ActivePlansPage`](../../../apps/web/src/routes/active-plans.tsx) explicitly request `collection=active`; API filters by owner, activation and archive state.                                                                                               | Implemented.                                                                                          |
| Switch among active plans and remember the last viewed | Active-plan selector plus [account-scoped local preferences](../../../apps/web/src/plan-selection.ts); [tests](../../../apps/web/src/routes/active-plans.test.tsx) cover switching, reload, invalid preferences and account isolation.                                            | Implemented; source defaults need documentation alignment, not a new selection system.                |
| Library contains all non-archived plans                | [`PlansPage`](../../../apps/web/src/routes/plans.tsx) requests `collection=library`; [`listPlans`](../../../apps/api/src/modules/plans/plan.service.ts) applies the correct owner/archive filter.                                                                                 | Implemented.                                                                                          |
| Library details and workout list without a calendar    | `PlanPage` uses the same `PlanView`/`Schedule` as `/plan`; `Schedule` always offers Weeks/Calendar.                                                                                                                                                                               | Gap G3.                                                                                               |
| Draft, Locked, Unlocked, Active and Inactive labels    | [`StatusPill`](../../../apps/web/src/components/PlanWidgets.tsx) shows Draft, Draft from a version, Locked or Archived. Cards and full plan headings render Active only when true.                                                                                                | Gap G4.                                                                                               |
| Create a plan and its first chat                       | [`NewPlanDialog`](../../../apps/web/src/routes/plans.tsx) sends `createConversation: true` and opens the returned chat. [`createPlan`](../../../apps/api/src/modules/plans/plan.service.ts) creates both atomically. A standalone coaching run can also create and bind one plan. | Implemented; creation paths differ in when they collect dates.                                        |
| Rename plans                                           | [`EditDetailsDialog`](../../../apps/web/src/components/EditDetailsDialog.tsx) separates display-name changes from draft edits; locked plans can be renamed. [Tests](../../../apps/web/src/routes/plans.test.tsx) cover conflicts and partial-save retries.                        | Implemented.                                                                                          |
| Activate/deactivate                                    | [`PlanToolbar`](../../../apps/web/src/components/PlanLifecycle.tsx) exposes both; API requires a locked version for activation. [Database tests](../../../apps/api/test/db/plan.service.test.ts) cover collection membership and immutable content.                               | Implemented.                                                                                          |
| Human lock/unlock                                      | Explicit dialogs, lock preview, brief confirmation, warning acknowledgement, hashes and concurrency values; worker tools cannot perform either transition.                                                                                                                        | Implemented and covered by web/database tests.                                                        |
| Discard an unpublished draft                           | Confirmation and API command exist. Initial drafts intentionally use Archive because no locked version exists to return to.                                                                                                                                                       | Implemented with confirmation defect G1.                                                              |
| View history and differences                           | [`PlanHistory` and `PlanRevisionPage`](../../../apps/web/src/routes/plan-history.tsx) show exact historical workouts/brief, ancestry, saved change summaries and lock-time findings. Phase 6 also supplies net draft differences against the current lock.                        | Implemented at summary level; presentation follow-up F1.                                              |
| Restore an older version as a draft                    | Preview and explicit confirmation use source hash, current-version identity, state version and idempotency. Existing drafts and archived plans block restoration.                                                                                                                 | Implemented; web and database tests cover the main guards and immutable ancestry.                     |
| Archive/unarchive plans                                | Explicit confirmation; automatic deactivation; draft/history retained; unarchive remains inactive. Plan archival overlays chat archival while preserving each chat's own archive state.                                                                                           | Implemented; preservation verified by database tests.                                                 |
| Create/rename chats                                    | Empty standalone view creates a durable conversation on first send. New plan-linked chats and rename are supported.                                                                                                                                                               | Implemented.                                                                                          |
| At most one logical plan per chat                      | Scalar plan association, ownership checks and atomic worker binding; [agent tests](../../../apps/api/test/db/agent.test.ts) exercise standalone creation and replay.                                                                                                              | Implemented. Attaching an existing plan to an arbitrary standalone chat is not an agreed requirement. |
| Archive/restore chats                                  | Commands, archive list, read-only enforcement and plan-archive dependency exist.                                                                                                                                                                                                  | Implemented with navigation gap G5.                                                                   |
| Show run status/working version; cancel                | Chat header, plan chip, per-turn output/activity and Stop; durable context and cancellation guards are tested.                                                                                                                                                                    | Implemented in Phases 4–6.                                                                            |
| Clerk account management and sign-out                  | [`SettingsPage`](../../../apps/web/src/routes/settings.tsx) opens Clerk UserProfile and calls sign-out; profile identity comes from Clerk.                                                                                                                                        | Profile and Security controls inspected while signed in; actual identity edits remain untested.       |
| Access archived plans/chats                            | Separate `/plans/archive` and `/chat/archive` routes and collection toggles. Settings links to All plans; Coach exposes its archive.                                                                                                                                              | Accessible; clearer direct links from You are optional.                                               |
| No user-facing permanent deletion                      | No Askesis plan/chat deletion routes or controls found. Hosted Clerk environment has `delete_self=true`.                                                                                                                                                                          | Gap G2; do not infer compliance solely from the absence of an Askesis Delete button.                  |

## Concrete completion gaps

### G1 — Freeze the draft reviewed by a discard confirmation

**Priority: first. Confirmed by a component probe.**

In [`PlanToolbar`](../../../apps/web/src/components/PlanLifecycle.tsx), opening Discard stores only the action in `confirm`. The mutation builds `expectedStateVersion`, `expectedDraftId` and `expectedEditNumber` from the current `plan` prop when Confirm is clicked. A live update or focus refetch can replace that prop while the dialog remains open.

Reproduced sequence:

1. Open Discard for draft edit 1, plan state 1.
2. Another session saves edit 2; refresh updates the mounted plan.
3. Click the existing Confirm discard button.
4. The request sends edit 2/state 2, although the confirmation opened against edit 1/state 1.

The [API](../../../apps/api/src/modules/plans/plan.service.ts) correctly checks the supplied concurrency values. The browser silently rebases them, allowing newly saved content to be discarded without a fresh confirmation. Lock already uses the reviewed preview values; restore also preserves its reviewed values.

**Bounded change:** capture the reviewed plan/draft identity when opening the dialog. If its state changes, disable that confirmation and require a deliberate review again, or submit the original baseline and handle the resulting conflict. Audit the other confirmation actions for the same baseline pattern without weakening their desired-state semantics.

**Acceptance:** another session's edit, draft replacement, lock or discard cannot make an existing confirmation authorize a newer draft. A failed or uncertain retry retains its original request identity. Tests must assert the original reviewed baseline or an explicit re-review, not merely the presence of a dialog.

### G2 — Bring Clerk self-deletion into the agreed account contract

**Priority: first. Hosted configuration, current-user permission and signed-in control confirmed.**

Read-only inspection of the hosted sign-in page returned:

```json
{ "userSettings": { "actions": { "delete_self": true } } }
```

[`SettingsPage`](../../../apps/web/src/routes/settings.tsx) opens the standard Clerk profile dialog, while [`ClerkProvider`](../../../apps/web/src/main.tsx) supplies appearance settings and no deletion restriction. The installed SDK exposes `deleteSelfEnabled`. Clerk documents that this permission controls whether a user can delete their account through the Frontend API. [Clerk user permissions](https://clerk.com/docs/reference/backend/user/update-user), [instance user-model settings](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options#user-model).

The final signed-in inspection confirmed `Clerk.user.deleteSelfEnabled=true` for the current user and a **Delete account** button in Manage account → Security. This establishes both the instance-configuration mismatch and an actual user-facing deletion flow. It does not establish that every existing user has the same permission. No deletion was attempted.

**Bounded change:** disable end-user self-deletion through the appropriate Clerk instance/user permissions and verify the existing-account behavior. Retain name, email, authentication-method and profile-image management. Hiding a UI element alone does not settle the underlying permission. Record the required setting so later production-instance setup preserves it.

**Acceptance:** signed-in account management supports the agreed identity controls and exposes no permanent-deletion flow; the relevant Clerk permission is disabled for alpha users. Test the restriction without deleting a real account.

This is distinct from Phase 8's production-key migration, invitation policy and complete operator-assisted data-removal procedure.

### G3 — Give library details a workout-list presentation

**Priority: core scope. Confirmed by a component probe.**

The roadmap explicitly distinguishes a calendar-based active Plan area from library details/workout lists without a calendar. [`PlanPage`](../../../apps/web/src/routes/plans.tsx) renders [`PlanView`](../../../apps/web/src/components/PlanView.tsx), which always renders [`Schedule`](../../../apps/web/src/components/Schedule.tsx). `Schedule` has no presentation constraint and always offers its Calendar toggle. Its saved mode is global, so a calendar preference can also carry into a library detail page.

The diagnostic opened `/plans/plan-1`, selected Calendar and rendered its month grid successfully.

**Bounded change:** give the shared plan/schedule components an explicit presentation mode. Keep the active Plan area calendar-capable; constrain library detail to the agreed workout-list presentation while reusing prescription detail, source selection, coverage and lifecycle controls. Do not duplicate the entire plan renderer. Decide whether the library list retains weekly navigation or shows a longer chronological list during refinement.

**Acceptance:** `/plan` still supports active-plan switching and calendar review; `/plans/:id` has details and workout navigation with no calendar toggle/grid, including when a calendar mode was previously saved. Historical and embedded-chat presentations must have explicit, deliberate defaults.

### G4 — Separate logical plan state from displayed content and activation

**Priority: core scope. Confirmed by a component probe.**

[`StatusPill`](../../../apps/web/src/components/PlanWidgets.tsx) uses the displayed source to choose its label. A plan with both a locked version and draft displays `Draft · from v1`, or `Locked v1` when the locked source is selected. Neither explicitly states that the logical plan is Unlocked. [`PlansPage`](../../../apps/web/src/routes/plans.tsx) and [`PlanView`](../../../apps/web/src/components/PlanView.tsx) show Active only when true; inactive plans get no corresponding label.

The diagnostic rendered an inactive plan with both versions and confirmed that Unlocked and Inactive labels were absent.

**Bounded change:** distinguish lifecycle state (Draft/Locked/Unlocked/Archived), viewed source (locked version/draft), and activation (Active/Inactive). Reuse the same vocabulary across library cards, plan headings and the conversation's plan review. A draft-only inactive plan should explain that locking is required for activation; archived plans should remain clearly read-only.

**Acceptance:** the labels remain truthful when switching locked/draft source. A user can identify an unlocked but active plan, a locked inactive plan and an initial draft without interpreting missing badges or menu actions.

### G5 — Preserve archive context when opening a conversation

**Priority: core archive usability. Confirmed by source tracing and a component probe.**

[`ConversationList`](../../../apps/web/src/components/chat/ConversationList.tsx) links every row to `/chat/:id`. The [router](../../../apps/web/src/router.tsx) renders that route with `ChatPage`'s default `archived=false`, even when the selected conversation came from the archive. The list switches to Open; its Archived selection and surrounding archived rows disappear. The conversation itself remains correctly archived/read-only. On narrow screens the Back link also points to `/chat`.

The diagnostic opened an archived conversation detail and confirmed that its surrounding collection was Open and no archive-list request was made.

**Bounded change:** preserve the originating collection through route/state/query context or a dedicated archived-detail route. Define a direct-link fallback for archived conversations. Return to the archive after inspecting archived content, and reconcile the collection deliberately after Restore.

**Acceptance:** open an archived chat on desktop and narrow screens, inspect its history, return to the archived collection, restore it and find it among open chats. A chat archived through its plan points to that plan's restoration controls. Plan-detail back navigation should likewise retain archive origin where appropriate.

## Existing capabilities with follow-ups

### F1 — Make historical differences easier to read

**Status: existing requirement substantially delivered; presentation refinement.**

Do not schedule a new version-history or diff engine. Current history already includes immutable content, aggregate change counts, affected workouts, previous dates, validation, ancestry and a guarded restore preview. [`ChangeSummary`](../../../apps/web/src/routes/plan-history.tsx) still exposes storage names such as `plan brief weekdays`, `calibration profiles` and `step targets`; changed dates are called `changed` rather than using the newer Moved vocabulary. The Phase 6 draft view has clearer assumption/pace-guide/date flags and move labels.

Recommended refinement: translate storage entities into training concepts and make the comparison baseline explicit. Preserve historical summaries as the changes recorded when that version was locked; distinguish those from the restore preview against the current lock. Reuse existing semantic comparison helpers where appropriate. Avoid inventing detailed history that was never stored.

Arbitrary pairwise comparison, a side-by-side field diff and version-to-chat provenance links are possible enhancements, not established missing Phase 7 blockers. Decide whether the existing summary-level review satisfies the intended experience before adding endpoints or schema.

### F2 — Retain unsaved details when an active plan leaves the collection

**Status: confirmed existing limitation; explicitly deferred in the web design document.**

The [web design system](../../product/web-design-system.md#known-gaps) records that remote archive/deactivation can remove the currently shown plan from the active collection, unmount `PlanView` and lose its open details form. [`ActivePlansPage`](../../../apps/web/src/routes/active-plans.tsx) falls back to another plan or the empty state; its child is keyed by plan ID. [`EditDetailsDialog`](../../../apps/web/src/components/EditDetailsDialog.tsx) preserves edits during ordinary refetches and protects navigation, but cannot retain local state after its parent unmounts.

Recommended bounded follow-up: hold the current editor long enough to show that the plan is no longer active, retaining its entered text and offering a deliberate transition to library details. Never automatically save or reactivate it. This closes a known daily-management edge case without reopening Phase 6's streaming scope.

## Decisions to settle before implementation

1. **Active-plan source defaults.** The original roadmap says an unlocked active plan shows its draft. The later [Phase 2 refinement](../../product/phase-2-plan-lifecycle-refinement.md#plans-versions-and-activation) supports both sources and remembers the choice; unlocking selects draft. Current `ActivePlansPage` defaults to locked when no valid preference exists and when switching plans, and its tests expressly cover that behavior. Recommend retaining explicit source choices and agreeing only the no-preference/switching default. Do not count deliberate locked-version selection as a synchronization defect. Today intentionally follows the locked schedule.
2. **Plan creation entry point.** Library New plan currently requires a name and both dates; standalone chat can collect context and create the plan later. The earlier minimal-create contract permits absent dates. Recommend keeping conversation-led creation as the primary path and deciding whether library creation should also accept incomplete dates. Existing atomic creation and chat binding do not need rebuilding. Broader first-use onboarding stays in Phase 8.
3. **Historical review depth.** Confirm whether understandable saved summaries and restore previews are sufficient, or whether before/after prescription detail is required. The latter adds scope beyond the current explicit controls list.

These are refinement questions, not approval requirements for this investigation. No provisional recommendation has been recorded as an accepted product decision.

## Proposed delivery sequence

| Increment                            | Concrete result                                                                                                                               | Validation                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1. Confirmation and account contract | G1 keeps the reviewed discard baseline; G2 restricts Clerk self-deletion and records the required configuration.                              | Focused race/retry tests; signed-in account verification without deletion.                                       |
| 2. Plan management presentation      | G3 separates calendar and library presentations; G4 gives logical state, source and activation clear labels; settle source/creation defaults. | Initial draft, locked, unlocked, inactive, active and archived cases; saved preferences; desktop/narrow screens. |
| 3. Archive navigation                | G5 preserves list/detail origin and sensible post-restore navigation.                                                                         | Individually archived chats, plan-archived chats, archived plans, direct links, restore and back navigation.     |
| 4. Review and editor refinements     | F1 improves difference language; decide whether to include F2 in this phase or retain its explicit deferral.                                  | Historical summary versus restore baseline; move/prescription/pace changes; remote archive with unsaved text.    |
| 5. Completion walkthrough            | Demonstrate all remaining Phase 7 controls across a complete user journey.                                                                    | Signed-in desktop and mobile-web acceptance plus appropriate automated checks.                                   |

Most changes should reuse the current API and database model. No new infrastructure, native API wiring or model tuning is justified by these gaps. A read-only historical-comparison endpoint would be needed only if a deeper comparison experience is explicitly selected.

## Completion walkthrough

Use a fresh account and an account with multiple plans and versions:

1. Create a plan through the agreed primary path and confirm its first chat exists.
2. Rename, review assumptions, lock with any warnings acknowledged, and activate.
3. Create a second active plan; switch and reload; verify account-scoped preferences.
4. Unlock, refine through chat, inspect pending changes, and verify logical state/source labels.
5. Open discard; change the draft in another session; confirm that the original dialog cannot discard the newer draft. Review again deliberately, then discard.
6. Inspect older versions and their saved differences; preview restore; restore as a draft; lock a new chronological version without rewriting old content.
7. Archive one chat independently, then archive its plan. Inspect retained draft/history/chats; unarchive the plan and verify its previous individual chat states and inactive status.
8. Enter chat and plan archives from the normal UI; verify detail/back/restore behavior on narrow screens.
9. Manage name, email, profile image and available authentication methods in Clerk; verify the account contract, then sign out and into another account.
10. Check stale-state, worker-unavailable and active-run restrictions produce useful recovery and do not lose accepted work.

Keep the partial-horizon locking contract. Archiving an initial draft remains the deliberate alternative to discarding it. Permanent deletion, export, multi-plan calendar merging and full manual workout editing are not added by this walkthrough.

## Verification recorded in this investigation

| Check                                                                                      | Actual result                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                           | Completed; lockfile unchanged.                                                                                                                                                                                       |
| Four temporary component probes                                                            | 4 passed, reproducing the observed gaps; temporary files removed.                                                                                                                                                    |
| `pnpm --filter @askesis/web test`                                                          | 19 files, 126 tests passed.                                                                                                                                                                                          |
| `pnpm --filter @askesis/api test`                                                          | 9 files, 39 tests passed.                                                                                                                                                                                            |
| `pnpm --filter @askesis/agent test`                                                        | 3 files, 20 tests passed.                                                                                                                                                                                            |
| `COMPOSE_PROJECT_NAME=askesis-phase7-audit-9ddbdf95 TEST_DATABASE_PORT=55436 pnpm test:db` | 8 files, 73 PostgreSQL tests and the SQL version-invariant checks passed.                                                                                                                                            |
| Documentation checks                                                                       | Prettier passed for all changed documentation; `git diff --check` passed.                                                                                                                                            |
| Hosted T3 preview                                                                          | Sign-in page loaded; public Clerk `delete_self=true` observed. Later signed-in Profile/Security inspection confirmed the current user’s permission and the Delete account button. No mutation or deletion attempted. |

The database suite used its own Compose project and disposable local database. Removed that project's residual network and volume afterward. No development or hosted database was migrated. Existing tests passing does not cover the newly reproduced gaps; add focused regression tests when implementing them.

No application, migration, generated-contract, mobile or dependency files were changed by the delivered investigation. No PR, deployment, provider call or external configuration change was made.
