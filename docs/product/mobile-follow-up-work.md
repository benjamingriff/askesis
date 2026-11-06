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
- [x] Strava: connect and disconnect through the browser, then link activities to workouts (`/integrations/strava/*`). Native builds return through `waddle://<host>/connections/strava/callback`, which the API now accepts. Checked against the Strava simulator on Expo web; a real Strava account is untested.

## 4. Navigation (decided)

Decided 2026-11-05: keep the floating bottom tab bar on native. The web app moved its phone tabs to a slim top bar (PR #83) because they clashed with the iOS Safari address bar at the bottom of the screen. That problem doesn't exist in the native app. With the coach hidden there are three destinations (Today, Plan, You).

## 5. Release path

The app runs only against a local API today. To get it on a phone without a laptop nearby, it needs a deployed API and a signed build. `apps/mobile/eas.json` already has development, preview and production profiles.

- [x] Production environment in `eas.json`: the Railway web origin (`https://askesis.up.railway.app`, whose nginx forwards `/api`), the publishable key of the Clerk instance that deployment uses (still the development instance), and the Strava callback host.
- [ ] Clerk production instance, when the deployment moves to one: allow native sign-in for bundle ID `app.waddle.mobile`, plus the redirect for Google sign-in.
- [ ] Strava: connect from a release build. `EXPO_PUBLIC_STRAVA_CALLBACK_HOST` is set to the web host, which must be the Strava app's callback domain and in `CLERK_AUTHORIZED_PARTIES`.
- [ ] App icon, splash and display name checked on a device.
- [x] Waddle identity: display name, bundle ID `app.waddle.mobile`, scheme `waddle://`, Expo slug `waddle`, the goose icon, and no export-compliance prompt (`usesNonExemptEncryption: false`).
- [x] Install the app with pnpm as a workspace package, so EAS installs it from the root lockfile. The build profiles pin Node 24.18.0 and pnpm 11.18.0, which the root `engines` require.
- [x] Over-the-air updates: EAS Update on the `production` channel with the `fingerprint` runtime policy (`pnpm release:update`). It reaches installed apps after the next build that includes `expo-updates`.
- [x] First TestFlight build and submit (2026-11-06). The process and the free plan's 15-builds-a-month budget are in [the mobile README](../../apps/mobile/README.md#testflight-builds-and-updates).
- [ ] Android is out of scope until decided otherwise; the config builds, but nothing has been checked.

## 6. Guardrails

Since the app joined the pnpm workspace, CI installs it and the root `pnpm typecheck` covers it. The root ESLint config still ignores it.

- [x] CI typecheck: the root `pnpm typecheck` runs the app's `tsc --noEmit` against the shared API schema, so it catches contract drift.
- [ ] Lint: `expo lint`, or extend the root config to cover `apps/mobile`.
- [ ] Unit tests for the pure code: `parseClock`, the date and pace helpers in `src/lib/format.ts`, step formatting in `StepList`, and `accountPortalUrl`.
- [ ] Optional later: a Maestro smoke flow (sign in, open Today, open a workout) run on Limrun before releases only.

## 7. Housekeeping

- [x] Delete `apps/mobile-prototype`. The real app has replaced it as the design reference, and it was still on SDK 57, so it no longer opened in Expo Go.
- [ ] Cheaper Limrun checks: build one reusable development app per native change (`expo-dev-client`), then reload JavaScript over the tunnel instead of rebuilding. Always stop the tunnel afterwards, because it keeps the paid simulator alive.
- [ ] A one-step `pnpm limrun` in `apps/mobile` that starts Expo on 8081, opens the tunnel and prints the stop command.
