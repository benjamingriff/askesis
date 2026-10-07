# Plan lifecycle and human review

Current behavior verified against plan services, lifecycle components and tests on 2026-10-06. The Phase 2 delivery sequence is [historical](../archive/phase-2/phase-2-implementation-plan.md); exact API/schema rules are in the [plan-version contract](../architecture/phase-2-schema-contract.md).

## Plans, versions and activation

A logical plan belongs to one account. Its display name and organization are separate from versioned content. User-facing lifecycle states are Draft (no lock yet), Locked (no draft), Unlocked (a lock plus unpublished draft) and Archived. Source labels identify Draft, current locked version or a historical version separately from lifecycle and Active/Inactive status.

A new plan starts with a draft. Lock validates and promotes that draft into an immutable numbered version. Unlock copies all versioned content into a draft; old locks remain immutable. Re-locking changed content creates the next version. Equal content does not create another version. Restoring supported history creates a draft for review rather than rewinding or rewriting history.

Only plans with locked content may activate; several may be active, with no primary-plan field. A plan may remain active while unlocked. Archive deactivates it, preserves its draft/versions and makes it read-only. Unarchive does not reactivate automatically.

## Plan view and library

The Plan tab is a calendar/workout view of active plans. It remembers account-scoped plan/source choices. With no valid preference, including a plan switch, it starts on locked content. Explicit unlock selects the draft; an existing explicit source selection remains stable through live refresh.

The library shows every non-archived plan, including inactive/draft-only plans. Library detail uses a workout/week list without a calendar. The separate archive shows archived plans. Today uses locked prescriptions for the selected active plan rather than unpublished coaching edits.

Chat is the primary content-editing interface. Human controls support display name, draft dates/description, structured brief, athlete pace guides (on the Performance page, shared by every plan), organization and lifecycle; there is no complete direct workout editor.

## Human confirmation

Lock review fetches current findings/hash/digest and captures the draft/edit/plan state being reviewed. Errors block lock; every warning needs acknowledgement. A current confirmed brief is required. The user may confirm separately or combine confirmation and lock in one transaction. Empty or intentionally partial schedules can lock with applicable warnings; full-plan coverage is not required.

Unlock, discard and restore have explicit confirmation dialogs. Discard requires an existing locked version, deletes only the unpublished draft and returns to current locked content. Initial drafts cannot be discarded as a removal shortcut. Restore previews supported older locked content and its summary before creating a new draft; arbitrary pairwise field-level history comparison is not implemented.

Background refresh preserves mounted form input and its original concurrency baseline; Refresh latest is explicit. Submitting a stale review reports a conflict rather than silently rebasing. Retry identities survive uncertain delivery for commands requiring idempotency keys.

## Archive, chats and ownership

Each plan can have multiple conversations. Archive makes all linked conversations effectively archived through their plan; unarchive removes inherited archive status without undoing an independently archived conversation. Archived conversations remain readable but cannot send. Inactive unarchived plans can still be discussed/edited.

Owner checks cover plan, version, brief and workout reads/commands. There is no sharing/membership permission model or user-facing permanent plan/chat deletion. Clerk account self-deletion is controlled externally by the instance/user policy, not by plan lifecycle code. Release policy and an operator data-removal procedure remain Phase 8 work.

Version/lineage identity keeps briefs, coverage, blocks/weeks, targets and complete workout trees together. Fitness calibration is athlete-owned and never part of a version. Chat/run provenance survives deletion of an unpublished draft; it is not included in the plan content hash.

## Limits and evidence

Active runs block incompatible human edits/lifecycle transitions. Agents cannot confirm the brief, lock, unlock, discard, restore, activate or archive. See [coaching tools](./phase-5-design.md).

The known Plan-tab edge case remains: another session deactivating/archiving its displayed plan can unmount a details form and lose unsaved input. The library detail route preserves the mounted plan/form. This is recorded as deferred, not a promise that every navigation preserves edits.

Evidence: [PlanLifecycle](../../apps/web/src/components/PlanLifecycle.tsx), [active plan route](../../apps/web/src/routes/active-plans.tsx), [library](../../apps/web/src/routes/plans.tsx), [service](../../apps/api/src/modules/plans/plan.service.ts) and [database tests](../../apps/api/test/db/plan.service.test.ts).
