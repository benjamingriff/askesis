# Mobile app: follow-up work

As of 2026-11-05. The first mobile PR brings the Expo app (`apps/mobile`, SDK 58) to parity with the web app as it was in early October. Since then, `main` has gained the in-app coach setting, plan and account deletion, the training log and Strava links. Each item below is its own PR, branched from `main`, in the order listed.

Verification: cheap checks happen in Expo web or Expo Go. Limrun, which is paid, confirms native behaviour once per PR (see [the mobile README](../../apps/mobile/README.md)).

## 1. Coach setting parity

When an account's `features.inAppCoach` is off, the app hides chat entirely and points athletes to their own agent, matching the web app ([proposal](./in-app-coach-flag-proposal.md), PR #100).

- [x] Read `features.inAppCoach` from the account query; default to on, as the web app does.
- [x] Hide the Coach tab, the Chat ↔ Plan pager and every chat entry point; old chat links land on Today.
- [x] Port **Ask your agent**: build the same prompt as `agentPrompt()` (plan name and `planId`), copy it to the clipboard and show it in a sheet so it can be pasted.
- [x] Swap "coach" for "agent" in copy wherever the web app uses `useCoachWord()` (lock review, plan changes, empty states).
- [x] New plans are created without a conversation while the coach is hidden, then open the plan rather than a chat.
- [x] Verify with the flag on and off on the verification account (Expo web, and native iOS on a Limrun simulator).

## 2. Plan and account deletion

This blocks TestFlight. Apple's App Review Guideline 5.1.1(v) requires any app that lets people create an account to also let them delete it from inside the app. The API already supports it ([deletion and retention](./data-deletion-and-retention.md)); the mobile app has no screens for it yet.

- [x] Plan deletion: show `GET /plans/{planId}/deletion-impact`, confirm, then `POST /plans/{planId}/delete`, with Undo and a 30-day `undelete` from the library.
- [x] Account deletion in You → Your data, as on the web: `POST /account/deletion` with the 7-day restore window. While it is pending the app shows only the deletion notice, with Keep my account (`DELETE /account/deletion`), Download my data and Sign out.
- [x] Data export (`GET /account/export`): save or share the file through the share sheet.
- [x] Copy matches the web app's retention wording.

## 3. Training log parity

Athletes can record what they did on mobile. See [workout logs and feedback](./training-log.md), [placeholder sessions](./placeholder-sessions.md) and [the mobile README](../../apps/mobile/README.md#training-log).

- [x] Log a workout and edit or remove the log (`PUT`/`DELETE /plans/{planId}/workouts/{lineageId}/log`), including feedback.
- [x] Training log view (`GET /training-log`) and coaching check-ins (`POST /check-ins`).
- [x] Placeholder sessions: show them in the schedule and let athletes log them.
- [x] Today hero: one rounded card holding the training log, without the View workout button.
- [x] Plan view tidy-ups from `main`: controls below the title, and no wellbeing check-in.
- [x] Strava: connect and disconnect through the browser, then link activities to workouts (`/integrations/strava/*`). Native builds return through `askesis://<host>/connections/strava/callback`, which the API now accepts. Checked against the Strava simulator on Expo web; a real Strava account is untested.

## 4. Navigation (decided)

Decided 2026-11-05: keep the floating bottom tab bar on native. The web app moved its phone tabs to a slim top bar (PR #83) because they clashed with the iOS Safari address bar at the bottom of the screen. That problem doesn't exist in the native app. With the coach hidden there are three destinations (Today, Plan, You).

## 5. Release path

The app runs only against a local API today. To get it on a phone without a laptop nearby, it needs a deployed API and a signed build. `apps/mobile/eas.json` already has development, preview and production profiles.

- [ ] Per-profile environment: `EXPO_PUBLIC_API_URL` for the deployed API and the matching Clerk publishable key (production keys for production).
- [ ] Clerk production instance: allow native sign-in for bundle ID `app.askesis.mobile`, plus the redirect for Google sign-in.
- [ ] Strava: set `EXPO_PUBLIC_STRAVA_CALLBACK_HOST` to the web host in the Strava app's callback domain (that host must also be in `CLERK_AUTHORIZED_PARTIES`), then connect from a release build.
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
