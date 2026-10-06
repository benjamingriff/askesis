# Web design system

## Status

**Current implementation reviewed 2026-10-06, including Phase 7.** The web UI now follows the Expo mobile prototype (`apps/mobile`), which is the agreed visual reference. That prototype draws on T3 Code for chat and agent-activity patterns and on Runna for training-plan presentation.

## Principles

- **One visual language across clients.** `apps/web/src/theme/palette.ts` mirrors `apps/mobile/src/theme/palette.ts`. These are separate source files, not a shared package. Consistency is design guidance; selected mobile features may be adapted independently for web.
- **State and action are separate.** Labels distinguish lifecycle (Draft/Locked/Unlocked/Archived), source (Draft or locked/history version) and activation independently. Toolbar buttons carry the actions (`Unlock`, `Review & lock`). An icon never means both "is locked" and "lock it".
- **Human-only decisions stay explicit.** Confirming assumptions, locking, unlocking, discarding, archiving and restoring always go through a dialog. The coach can edit drafts but never performs these actions.
- **Truthful progress.** Prescribed coverage, unplanned weeks and interrupted generation are always visible. Past workouts are dimmed, not marked complete, because completion is not recorded yet.

## Tokens

`apps/web/src/settings.tsx` builds the active theme from user settings stored in `localStorage` (`askesis.settings.v1`). It writes CSS custom properties on `<html>`: `--bg`, `--surface`, `--surface-raised`, `--border`, `--text`, `--text-dim`, `--text-muted`, `--accent`, `--on-accent`, `--accent-text`, `--accent-soft`, `--accent-border` and the `--locked`, `--warning` and `--danger` families. Theme-aware styles use these tokens. Accent text uses `readableOn` against the page background; this is not a full accessibility audit.

The defaults are dark mode, the Midnight theme and the Volt accent. Users can choose system, dark or light mode, six themes, eight accents or a custom hex, and display units (plan default, km or mi).

Type scale: title 30/800, heading 20/700, subheading 16/600, body 15, caption 13/500, label 11/700 uppercase. Radii: 28 (hero and dialogs), 24 (cards), 18–20 (rows), 14 (controls).

## Structure

| Area                                                                                                                    | Location                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Primitives (Button, IconButton, Pill, Card, Segmented, Dialog, Menu, CheckRow, Notice, empty, loading and error states) | `src/components/ui.tsx`                                           |
| Plan view, toolbar and lifecycle dialogs                                                                                | `src/components/PlanView.tsx`, `src/components/PlanLifecycle.tsx` |
| Schedule (weeks and calendar), workout cards and detail                                                                 | `src/components/Schedule.tsx`, `src/components/Workout.tsx`       |
| Status pill, coverage, weekly volume, pace guides                                                                       | `src/components/PlanWidgets.tsx`                                  |
| Change badges and the draft change summary                                                                              | `src/components/PlanChanges.tsx`                                  |
| Chat workspace: list, transcript, coaching turns, composer, plan panel                                                  | `src/components/chat/`, `src/routes/chat.tsx`                     |
| Formatting, units, weeks and kind inference                                                                             | `src/lib/`                                                        |
| Styles by area                                                                                                          | `src/styles/*.css`                                                |

## Navigation

- **Desktop:** a T3 Code-style sidebar with New chat, Today, Plan, Coach, All plans and recent chats.
- **At 900 px and below:** the mobile floating tab bar (Today, Plan, Coach, You). On these screens the Coach list and the conversation are separate screens, and `/chat/new` opens a new conversation.

## Known gaps

- The API does not classify workouts, so `inferKind` derives the kind (easy, long, tempo, intervals, test) from titles for colour and iconography only. Adding an explicit workout type to the schedule tools and API is a follow-up.
- Schedule weeks are Monday-start calendar weeks. They can differ from the API's training `weekNumber` when a plan starts mid-week.
- If another session deactivates or archives the plan shown on the Plan tab while its details dialog is open, the next refresh moves the tab to another plan and the dialog closes, so unsaved details are lost. This is deferred as a low-impact edge case (the coach cannot change activation). The plan detail page (`/plans/:id`) keeps the plan mounted and preserves edits.

## Coaching chat (Phase 6)

- **One assistant block per turn,** as in the prototype's message parts: the activity card, any intermediate text, the reply, then a "Plan draft updated" card. The card lists up to three workouts with change badges and "+N more", and opens plan review.
- **Change badges** (Added, Changed, Moved, Removed) are small accent label chips beside the workout kind. Changed workouts are not otherwise tinted, so kind colours stay readable. Calendar dots for changed workouts get an accent ring.
- **Chat and plan together.** From 1,450 px the plan sits beside the chat and can be hidden (remembered locally). Below that, Chat/Plan tabs sit under the conversation header, with the pending-change count on Plan, matching the prototype's pager tabs. The embedded plan uses a compact heading, puts the change summary first and keeps lifecycle actions in a sticky footer.

## Data freshness conventions

- Version-scoped reads (brief, workouts, workout detail) are keyed with `versionKey(version)` (`id` plus `editNumber`), so any draft edit refetches them. The brief key also includes the version state, because locking keeps the same `id` and `editNumber` but reads from a different endpoint.
- Live notifications refresh only what changed (see the [Phase 6 runtime](../operations/phase-6-runtime.md)): text and tool activity refresh their turn, run transitions refresh the chat and generation coverage, and only plan or version writes refresh plan reads. `usePlan` and `useDraftChanges` in `plan-data.ts` own those keys.
- Plan metadata refetches on focus. Forms that edit it, such as the details dialog, save against the baseline they loaded and only adopt newer data when the user chooses Refresh latest plan, so a background refresh never silently overwrites another session's change.
- Selections that default to "now" (Today's date, the current week, the calendar date) use `useFollowingState`, so they keep following the clock until the user picks something else.
- Coverage goes through `knownCoverage(brief)`: `null` means unknown (legacy plans, where empty days show as rest), while an empty list after a generation attempt means nothing is fully prescribed yet. Schedule weeks extend beyond the plan dates when saved workouts fall outside them, so sessions that block locking stay visible.

## Appearance and display settings

`src/settings.tsx` persists browser preferences under `askesis.settings.v1`: system/light/dark mode, palette, preset/custom accent, unit display override and activity visibility. These preferences are browser-local, not an account profile or synchronized server setting. Account-scoped plan/source selections are separate.

CSS variables drive component surfaces/text/accent/overlays; palette code also supplies workout/zone colours. Token use is a design convention, not a claim that every style avoids literal colours or that a full accessibility audit has passed. Custom accent foreground selection uses a readability calculation.

Further improvements to the web experience are chosen in separate feature threads. The Expo app remains a reference; native API integration is deferred.
