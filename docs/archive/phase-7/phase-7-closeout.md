# Phase 7 refinement and closeout

## Current-code reconciliation — 2026-10-06

- G1/G3/G4/G5 behavior is present in current web components/routes and tests. G2 is a recorded external Clerk development-policy check, not an application-enforced deletion restriction.
- Phase 7 was subsequently merged; “local”, “no deployment” and test totals below describe the closeout checkpoint. This audit did not verify the current hosted web deployment or repeat the account-policy read.
- The final native-next recommendation is superseded: continue responsive web development and bring selected prototype features across in separate threads. Native integration is deferred.

The remaining content is the original historical record. Current procedures/contracts are indexed in [the documentation index](../../README.md).

> Historical delivery record. Status, pending checks and next-step recommendations describe the original checkpoint; see the [current handoff](../../current-handoff.md) for present priorities.

Refined on 2026-10-06 following the [gap investigation](./phase-7-gap-investigation.md) and the owner's decision to finish a bounded Phase 7 before connecting the native app.

## Completion scope

Phase 7 completes the existing management experience; it does not build another plan lifecycle or coaching backend. Its remaining scope is G1–G5 from the investigation:

- **Reviewed confirmations:** discard, unlock, archive and unarchive use the plan state shown when the confirmation opened. A background refresh cannot authorize newer content. Discard retries retain their concurrency values and idempotency key after an uncertain response. Cancel and reopen deliberately reviews the newer state. Lock and restore continue to use their existing reviewed previews.
- **Private-alpha account policy:** Clerk identity management and sign-out remain available, while end-user account deletion is disabled at the permission level. Verify the instance setting and existing users; hiding a control alone is insufficient. This restriction is temporary: before an App Store release with account creation, implement full account/data deletion initiated from the app, as required by [Apple](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion).
- **Library presentation:** library details retain the weekly chart, week navigation, workout list and prescription detail. They do not offer a calendar. The active Plan area and embedded chat review remain calendar-capable. Historical-version and draft-inspection routes use weekly lists. A saved calendar preference remains available in the active Plan area.
- **Plan vocabulary:** lifecycle is Draft (initial draft), Locked, Unlocked (locked version plus draft), or Archived. Active/Inactive is a separate fact. The displayed draft or locked version is labelled separately, so selecting locked content does not claim an unlocked plan is locked. A restored draft must not claim ancestry from the current locked version when its source is older.
- **Archive navigation:** archived conversation details use `/chat/archive/:conversationId`, retain the archive list and return there on narrow screens. Legacy direct links follow the saved archive state. Archive/restore updates move the conversation to the corresponding collection. Plan-archived chats stay read-only and require restoring their plan first.

## Decisions resolved

- Retain account-scoped active-plan/source preferences. When no valid preference exists or switching plans, start with the stable locked source. Explicitly unlocking selects the draft. Today continues to follow locked content.
- Retain both creation paths: library creation collects a name and dates and atomically creates its first conversation; standalone chat can discuss assumptions before creating a plan with incomplete dates. Neither path requires new onboarding in this phase.
- Existing saved historical summaries, exact immutable version content and guarded restore previews satisfy Phase 7's history requirement. Arbitrary pairwise comparisons and expanded difference presentation (F1) remain optional follow-ups.
- Preserve the existing explicit deferral of retaining unsaved details when a remotely deactivated/archived plan leaves the active collection (F2). Ordinary refetch and save-conflict protection remain required and tested.
- Markdown export remains removed from the product, including future scope.

## Account configuration and verification

Used the [Clerk CLI skill](/home/benjamingriff/.agents/skills/clerk-cli/SKILL.md) and CLI 3.4.0, explicitly targeting Askesis's development application and instance. The host-execution check passes and Platform API login is authenticated. The browser could not reach the local OAuth callback, so the supplied callback was delivered to the waiting local CLI; `whoami` confirmed authentication. No authorization code, token or secret key was saved in the repository.

Retrieved the live configuration and schema through the CLI. The exposed `user_model` schema contains only first-name and last-name settings; the self-deletion default is not exposed by this configuration API. The owner disabled **Allow users to delete their accounts** in the [Askesis development dashboard](https://dashboard.clerk.com/apps/app_3GrarJsKsEYkbOPmwtHU64A9pO4/instances/ins_3GrarL7bZvbt2kAciciIBhuzLIf). A fresh public Frontend API read confirmed `user_settings.actions.delete_self=false`.

The default change left both existing users' individual permissions enabled. Read those users, previewed targeted updates with `--dry-run`, and set only `delete_self_enabled=false` on both accounts through the CLI. Fresh Backend API reads confirmed two accounts with zero self-deletion permissions enabled; a subsequent Frontend API read confirmed the instance default remained false. No identity details, account records or Askesis data were deleted, and no other authentication options were changed.

Reloaded the hosted signed-in Clerk user and verified `deleteSelfEnabled=false`. Manage account retained profile, email and connected-account controls, password management and active devices; Delete account was absent from Profile and Security. Sign-out remained available. This completes G2 for the current development instance. Repeat the policy and verification when provisioning the private-alpha production instance.

The permission is documented by [Clerk's user update reference](https://clerk.com/docs/reference/backend/user/update-user); the default is described under [User model](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options#user-model).

## Verification and delivery status

**Status: Phase 7 implementation complete; local checks and development account policy verified.** The branch incorporates main's shared request-key and draft-change-effects fixes; the validation counts below record the combined branch before PR publication. Deployment and a desktop/narrow-screen walkthrough of the new web screens remain release verification steps, as described below.

| Check                                                                                   | Result                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_CLERK_PUBLISHABLE_KEY=pk_test_fixture pnpm check`                                 | Passed: formatting, lint, type checks, 215 tests (156 web, 39 API, 20 worker), builds, generated-contract comparison, migration checks and the production audit's high-severity threshold. The fixture key was used only for build validation.                                                                                       |
| New web regressions                                                                     | 23 cases cover reviewed confirmation races/retries, library versus active schedule presentation, lifecycle/source/activation labels, restored-draft ancestry and chat archive navigation/restoration.                                                                                                                                |
| `COMPOSE_PROJECT_NAME=askesis-phase7-pr-9ddbdf95 TEST_DATABASE_PORT=55436 pnpm test:db` | Passed: 76 PostgreSQL tests plus SQL version invariants. Used a disposable Compose project, then removed its residual network and volume.                                                                                                                                                                                            |
| Signed-in hosted account                                                                | Fresh API reads confirm the future-account default is disabled and both existing accounts are restricted. Reloaded the signed-in user and confirmed the deletion control is absent while profile/security controls and sign-out remain available. No destructive test was performed.                                                 |
| Browser checks of new web screens                                                       | A temporary local fixture server served successfully, but the collaborative browser could not navigate to it using direct or environment-port targets. Removed the fixture files and stopped the server. The new UI has component/router coverage; a deployed desktop/narrow-screen walkthrough remains a release verification step. |

G1–G5 are complete within the refined scope; application changes are local and the development account policy is live. No native application, database schema, generated API contract, dependency, agent model or prompt changes are part of this phase. No application deployment has been performed.

The next substantial product increment is a live native client: authenticate the existing account, display its real plan/workouts, then connect durable coaching and human review. Plan phases will extend the existing training-block model after that connection works.
