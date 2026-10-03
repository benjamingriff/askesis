# Web design system

## Status

**Implemented on the web app, 2026-10-02.** This opens Phase 6. The web UI now follows the Expo mobile prototype (`apps/mobile`), which is the agreed visual reference. That prototype draws on T3 Code for chat and agent-activity patterns and on Runna for training-plan presentation.

## Principles

- **One visual language across clients.** `apps/web/src/theme/palette.ts` mirrors `apps/mobile/src/theme/palette.ts`. Keep themes, accents, workout-kind colours and pace-zone colours in step when either changes.
- **State and action are separate.** A status pill shows plan state (`Locked v3`, `Draft · from v3`, `Archived`). Toolbar buttons carry the actions (`Unlock`, `Review & lock`). An icon never means both "is locked" and "lock it".
- **Human-only decisions stay explicit.** Confirming assumptions, locking, unlocking, discarding, archiving and restoring always go through a dialog. The coach can edit drafts but never performs these actions.
- **Truthful progress.** Prescribed coverage, unplanned weeks and interrupted generation are always visible. Past workouts are dimmed, not marked complete, because completion is not recorded yet.

## Tokens

`apps/web/src/settings.tsx` builds the active theme from user settings stored in `localStorage` (`askesis.settings.v1`). It writes CSS custom properties on `<html>`: `--bg`, `--surface`, `--surface-raised`, `--border`, `--text`, `--text-dim`, `--text-muted`, `--accent`, `--on-accent`, `--accent-text`, `--accent-soft`, `--accent-border` and the `--locked`, `--warning` and `--danger` families. Stylesheets never hard-code theme colours. Accent text is adjusted automatically to meet WCAG AA contrast on the page background.

The defaults are dark mode, the Midnight theme and the Volt accent. Users can choose system, dark or light mode, six themes, eight accents or a custom hex, and display units (plan default, km or mi).

Type scale: title 30/800, heading 20/700, subheading 16/600, body 15, caption 13/500, label 11/700 uppercase. Radii: 28 (hero and dialogs), 24 (cards), 18–20 (rows), 14 (controls).

## Structure

| Area                                                                                                                    | Location                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Primitives (Button, IconButton, Pill, Card, Segmented, Dialog, Menu, CheckRow, Notice, empty, loading and error states) | `src/components/ui.tsx`                                           |
| Plan view, toolbar and lifecycle dialogs                                                                                | `src/components/PlanView.tsx`, `src/components/PlanLifecycle.tsx` |
| Schedule (weeks and calendar), workout cards and detail                                                                 | `src/components/Schedule.tsx`, `src/components/Workout.tsx`       |
| Status pill, coverage, weekly volume, pace guides                                                                       | `src/components/PlanWidgets.tsx`                                  |
| Formatting, units, weeks and kind inference                                                                             | `src/lib/`                                                        |
| Styles by area                                                                                                          | `src/styles/*.css`                                                |

## Navigation

- **Desktop:** a T3 Code-style sidebar with New chat, Today, Plan, Coach, All plans and recent chats.
- **Below 900 px:** the mobile floating tab bar (Today, Plan, Coach, You). On these screens the Coach list and the conversation are separate screens, and `/chat/new` opens a new conversation.

## Known gaps

- The API does not classify workouts, so `inferKind` derives the kind (easy, long, tempo, intervals, test) from titles for colour and iconography only. Adding an explicit workout type to the schedule tools and API is a follow-up.
- Schedule weeks are Monday-start calendar weeks. They can differ from the API's training `weekNumber` when a plan starts mid-week.
- Run activity is derived from polled run events. Live streaming of activity and replies is Phase 6 synchronization work.
- Per-workout draft badges (new or edited) and a chat-side plan panel, as in the mobile prototype, need a draft-diff read. Today the lock review lists the changes.
- If another session deactivates or archives the plan shown on the Plan tab while its details dialog is open, the next refresh moves the tab to another plan and the dialog closes, so unsaved details are lost. This is deferred as a low-impact edge case (the coach cannot change activation). The plan detail page (`/plans/:id`) keeps the plan mounted and preserves edits.

## Data freshness conventions

- Version-scoped reads (brief, workouts, workout detail) are keyed with `versionKey(version)` (`id` plus `editNumber`), so any draft edit refetches them. The brief key also includes the version state, because locking keeps the same `id` and `editNumber` but reads from a different endpoint.
- Plan metadata refetches on focus. Forms that edit it, such as the details dialog, save against the baseline they loaded and only adopt newer data when the user chooses Refresh latest plan, so a background refresh never silently overwrites another session's change.
- Selections that default to "now" (Today's date, the current week, the calendar date) use `useFollowingState`, so they keep following the clock until the user picks something else.
