# Mobile app: follow-up work

As of 2026-11-04. The first mobile PR brings the Expo app (`apps/mobile`, SDK 58) to parity with the web app as it was in early October. Since then, `main` has gained the in-app coach setting, plan and account deletion, the training log and Strava links. Each item below is its own PR, branched from `main`, in the order listed.

Verification: cheap checks happen in Expo web or Expo Go. Limrun, which is paid, confirms native behaviour once per PR (see [the mobile README](../../apps/mobile/README.md)).

## 1. Coach setting parity

When an account's `features.inAppCoach` is off, the app hides chat entirely and points athletes to their own agent, matching the web app ([proposal](./in-app-coach-flag-proposal.md), PR #100).

- [x] Read `features.inAppCoach` from the account query; default to on, as the web app does.
- [x] Hide the Coach tab, the Chat ↔ Plan pager and every chat entry point; old chat links land on Today.
- [x] Port **Ask your agent**: build the same prompt as `agentPrompt()` (plan name and `planId`), copy it to the clipboard and show it in a sheet so it can be pasted.
- [x] Swap "coach" for "agent" in copy wherever the web app uses `useCoachWord()` (lock review, plan changes, empty states).
- [x] New plans are created without a conversation while the coach is hidden, then open the plan rather than a chat.
- [x] Verify with the flag on and off on the verification account (Expo web; native not yet checked on Limrun).

## 2. Plan and account deletion

This blocks TestFlight. Apple's App Review Guideline 5.1.1(v) requires any app that lets people create an account to also let them delete it from inside the app. The API already supports it ([deletion and retention](./data-deletion-and-retention.md)); the mobile app has no screens for it yet.

- [ ] Plan deletion: show `GET /plans/{planId}/deletion-impact`, confirm, then `POST /plans/{planId}/delete`, with Undo and a 30-day `undelete` from the library.
- [ ] Account deletion in Account: `POST /account/deletion` with the 7-day restore window and cancel (`DELETE /account/deletion`), then sign out.
- [ ] Data export (`GET /account/export`): save or share the file through the share sheet.
- [ ] Copy matches the web app's retention wording.

## 3. Training log parity

The biggest gap in day-to-day use: athletes can't record what they did on mobile. This could be two PRs, logging first and Strava second. See [workout logs and feedback](./training-log.md) and [placeholder sessions](./placeholder-sessions.md).

- [ ] Log a workout and edit or remove the log (`PUT`/`DELETE /plans/{planId}/workouts/{lineageId}/log`), including feedback.
- [ ] Training log view (`GET /training-log`) and coaching check-ins (`POST /check-ins`).
- [ ] Placeholder sessions: show them in the schedule and let athletes log them.
- [ ] Today hero: one rounded card holding the training log, without the View workout button.
- [ ] Plan view tidy-ups from `main`: controls below the title, and no wellbeing check-in.
- [ ] Strava: connect and disconnect through the browser, then link activities to workouts (`/integrations/strava/*`). Needs an OAuth redirect back into the app (`askesis://`).

## 4. Navigation (open decision)

Recommendation: keep the floating bottom tab bar on native. On `main` the web app's phone layout swapped its bottom tabs for a slim top bar (initials open You; Today, Plan and Coach are text tabs) that scrolls away, with sideways swipes between tabs (PR #83).

| Option                    | For                                                                | Against                                                                                         |
| ------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Keep bottom tabs (native) | iOS convention, reachable with one thumb, native gestures for free | Differs from the web app's phone layout                                                         |
| Port the top bar          | Same layout on both                                                | Fights iOS conventions; the swipe has to share space with the iOS back-swipe at the screen edge |

Whichever you choose, with the coach hidden there are only three destinations (Today, Plan, You).

## 5. Release path

The app runs only against a local API today. To get it on a phone without a laptop nearby, it needs a deployed API and a signed build. `apps/mobile/eas.json` already has development, preview and production profiles.

- [ ] Per-profile environment: `EXPO_PUBLIC_API_URL` for the deployed API and the matching Clerk publishable key (production keys for production).
- [ ] Clerk production instance: allow native sign-in for bundle ID `app.askesis.mobile`, plus the redirect for Google sign-in.
- [ ] App icon, splash and display name checked on a device; App Store Connect record; then TestFlight.
- [ ] Decide on over-the-air updates (EAS Update), so text-only fixes skip App Review.
- [ ] Android is out of scope until decided otherwise; the config builds, but nothing has been checked.

## 6. Guardrails

Nothing in CI checks the mobile app yet: `.github/workflows/ci.yml` never installs `apps/mobile`, and the root ESLint config ignores it. So an API change can break the app without anyone noticing.

- [ ] CI job: `npm ci` in `apps/mobile`, then `npm run typecheck` (it type-checks against the shared API schema, so it catches contract drift).
- [ ] Lint: `expo lint`, or extend the root config to cover `apps/mobile`.
- [ ] Unit tests for the pure code: `parseClock`, the date and pace helpers in `src/lib/format.ts`, step formatting in `StepList`, and `accountPortalUrl`.
- [ ] Optional later: a Maestro smoke flow (sign in, open Today, open a workout) run on Limrun before releases only.

## 7. Housekeeping

- [ ] Delete `apps/mobile-prototype`. The real app has replaced it as the design reference, and it is still on SDK 57, so it no longer opens in Expo Go.
- [ ] Cheaper Limrun checks: build one reusable development app per native change (`expo-dev-client`), then reload JavaScript over the tunnel instead of rebuilding. Always stop the tunnel afterwards, because it keeps the paid simulator alive.
- [ ] A one-step `npm run limrun` in `apps/mobile` that starts Expo on 8081, opens the tunnel and prints the stop command.
