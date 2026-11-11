# Waddle mobile

The Expo / React Native client for Waddle. It signs in with Clerk and uses the same API as the
web app: Today, the Plan (weeks, calendar, blocks, zones), workout prescriptions, the coach with
live activity and Stop, review & lock, unlock, discard, activation, plan details, the brief
editor, version history and restore, draft inspection, the plan library with new plans,
Performance with recorded and withdrawn results, account management, plan and account
deletion, workout logs and feedback, check-ins, and Strava activity links. It is the design
reference for the web app's visual language.

## Run it in Expo Go

From the repository root, prepare and start the local API as for the web app
([local development](../../docs/operations/local-development.md)):

```bash
pnpm install --frozen-lockfile
pnpm dev:setup
pnpm dev:local          # API + web; leave it running
```

Then, in another terminal:

```bash
pnpm dev:mobile         # Expo on this network (pnpm dev:mobile:web for the browser)
# or, for a phone on another network:
pnpm --filter @waddle/mobile dev   # expo start --tunnel
```

Scan the QR code with Expo Go (iOS: Camera app; Android: Expo Go's scanner). Sign in with the
account you use on the web app (password, emailed code or Google), or create one with a password
and an emailed code.

Expo reads the Clerk publishable key and the API port from the root `.env` (`app.config.js`,
`metro.config.js`), so no extra environment is needed. The app calls `/api` on the Metro server
it was loaded from, and Metro proxies those requests to the local API, so the phone only needs to
reach Metro: the same network, or `--tunnel` when the network blocks that (tunnels use HTTPS).
Restart Expo after changing either config file. Everything used is bundled in Expo Go; no
development build is needed.

To point the app at a deployed API instead, set `EXPO_PUBLIC_API_URL` (and the matching
`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`) in `apps/mobile/.env.local` and run `npx expo start`.

This app is a package in the root pnpm workspace (`@waddle/mobile`), installed by the root
`pnpm install` with pnpm's default isolated `node_modules`, which Expo supports since SDK 54. Add
dependencies with `npx expo install <package>` from `apps/mobile` so versions match the SDK, and
check the result with `npx expo-doctor`. Only import packages the app lists in `package.json`:
with isolated installs, anything else fails to resolve.

### Run it on a Limrun cloud simulator

`npx lim run --ios-id <simulator id>` from `apps/mobile` builds the app remotely and launches it
on a Limrun iOS simulator. This hasn't been re-run since the app joined the pnpm workspace; if the
cloud build can't install dependencies from the app's folder alone, build from the repository root
with `lim xcode build . --expo-app-dir apps/mobile`. The cloud build sees only `apps/mobile`, so `apps/mobile/.env` (ignored)
holds `LIM_API_KEY` and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`; put the Limrun key in the main
checkout's `.env` and `pnpm dev:setup` writes both into new worktrees. The build has no Metro
behind it and calls `localhost:8081`, so to reach the local API run `npx expo start --port 8081`
and `npx lim ios tunnel --selector localhost:8081 --detach --id <simulator id>`.

### Signing in without a password (local verification)

```bash
pnpm --filter @waddle/mobile dev:login   # one-time sign-in links for the verification account
```

Open the `expoGo` link on the phone (or the `web` link in a browser after `npx expo start --web`)
to sign in as `askesis-verification+clerk_test@example.com`. Links last ten minutes and only work
with development keys. Treat them as credentials. Seed sample data with
`pnpm example:seed --email askesis-verification+clerk_test@example.com`. For the web build, add
`http://localhost:8081` to `CLERK_AUTHORIZED_PARTIES` in the root `.env`.

## Authentication

Clerk's custom-flow hooks (`@clerk/expo`) handle password, email-code, Google and sign-in-token
flows; the session token is cached in the device keychain (`expo-secure-store`). Native session
tokens carry no `azp` (authorized party) claim because native requests have no origin, so the
API verifies such tokens without its browser-origin allowlist (`apps/api/src/auth/middleware.ts`).
Tokens that name an origin must still match it.

## Layout

```
src/app/            Expo Router screens: (tabs)/ Today · Plan · Coach · You, workout/[id],
                    chat/[id] (Chat ↔ Plan pager), ask-agent, lock-review, plans/, plan-details, new-plan,
                    brief, plan-history, revision, draft-content, performance, record-result,
                    log-workout, check-in, training-log, find-activity,
                    connections/strava/callback, account, appearance, sign-in
src/components/     UI kit, form fields and date picker, plan view and widgets, workout rows,
                    effort chart, chat pieces
src/data/           React Query hooks over the API (plans, workouts, chat) and plan actions
src/lib/            API client and config, formatting, sports and workout presentation
                    (ported from apps/web/src/lib), request keys
src/state/          settings (persisted), live updates, plan selection, account query cache
src/theme/          themes, accents and effort colours, mirroring apps/web/src/theme
```

API types come from `packages/api-client/src/schema.ts` as type-only imports by relative path.
Babel removes them from the bundle, so the app has no runtime dependency on the workspace package. Live updates follow the same
event stream as the web (`/api/v1/live/events`) through `expo/fetch`, falling back to polling
while disconnected.

## In-app coach setting

The app reads `features.inAppCoach` from `GET /api/v1/account` before any signed-in screen renders,
as the web app does ([proposal](../../docs/product/in-app-coach-flag-proposal.md)). When the API
runs with `IN_APP_COACH=hidden`, the Coach tab and chat screens are removed (old chat links land on
Today). Every chat entry point opens **Ask your agent** (`src/app/ask-agent.tsx`) instead. That
screen builds the same prompt as the web app (`src/lib/coach.ts`), adds the athlete's question, and
copies or shares it to paste into their agent.
Copy says "your agent" (`useCoachWord()` in `src/data/account.ts`). To try it locally, start the
API with `IN_APP_COACH=hidden pnpm dev`.

## Plan and account deletion

The same flows as the web app, with the same wording ([deletion and retention](../../docs/operations/data-deletion.md)):

- **Delete plan…** in the plan options sheet lists what goes with the plan
  (`GET /plans/{planId}/deletion-impact`) before `POST /plans/{planId}/delete`. The app then opens
  All plans with an Undo notice. All plans → **Deleted** restores a plan to Archived
  (`POST /plans/{planId}/undelete`) for 30 days.
- You → **Your data**: **Download my data** fetches `GET /account/export` and offers the JSON file
  through the share sheet (`expo-sharing`; a download on Expo web). **Delete account…** asks for
  `DELETE` to be typed, then `POST /account/deletion` starts the 7-day window.
- While deletion is pending, `AccountGate` shows the notice instead of the app (the API refuses
  everything outside `/account`, and the live stream stays off). It offers Keep my account
  (`DELETE /account/deletion`), Download my data and Sign out.

## Training log

The same flows as the web app ([workout logs and feedback](../../docs/product/training-log.md)).
The web's feedback, check-in and history dialogs are screens here.

- **Today** marks logged days in the week strip. Today's workout card holds its log: **Done**,
  **Changed it** or **Skipped**, then the effort scale, **Edit**, **Undo** and **Add details**.
  This week's earlier sessions (and always the last three days) that still need a log are listed
  below it; one logged there stays with **Undo** until Today is reopened. **Not feeling
  100%?** opens the check-in (`check-in.tsx`, `POST /check-ins`). The week card counts done time
  and sessions from `GET /training-log`.
- Key sessions, tests, races, placeholders, changed or skipped workouts, and an effort far from the
  plan open the feedback form (`log-workout.tsx`, `PUT /plans/{planId}/workouts/{lineageId}/log`).
  **Save** never calls the model; **Save and talk it through** also sends the log to the plan's
  conversation, or hands a prompt to the athlete's agent when the in-app coach is hidden. Chat shows
  the saved feedback above the message.
- **Plan**: the controls sit below the title, with **Training log** (`training-log.tsx`, including
  logs from earlier versions). Schedule cards show the log, and past and today's workouts offer a quick log.
- **Placeholder sessions** show their expected effort band instead of a prescription and always
  open the form, which asks what the session turned out to be.

## Strava

You → **Connections** connects or disconnects Strava. **Find my activity** (on Today's card, the
workout screen and the log form) lists activities from the week either side; linking is manual.
The log form's **Show details** reads the linked activity from Strava, above the form. See
[activity connections](../../docs/operations/activity-connections.md) for the simulator.

Strava returns to `waddle://<host>/connections/strava/callback`, opened with
`WebBrowser.openAuthSessionAsync`; the web build returns to its own origin. The host is
`EXPO_PUBLIC_STRAVA_CALLBACK_HOST` (default `localhost`) and must match the Strava app's callback
domain and a host in the API's `CLERK_AUTHORIZED_PARTIES`. Expo Go opens only `exp://` links, so
connecting needs a development or release build; the web build and Expo Go can still show links.

## Not yet on mobile

The brief editor, version history and restore, recording a result on the Performance page (share
it with the coach instead), plan renaming and sign-up. Use the web app for these.

## Checks

```bash
pnpm typecheck          # from apps/mobile; the root `pnpm typecheck` in CI includes it
npx expo-doctor         # SDK version and config checks
```

## TestFlight builds and updates

Release builds are made by Expo's cloud build service (EAS Build) and installed through TestFlight.
Expo's free plan allows **15 iOS builds a month**, so only build when the owner asks for one.
Merging a PR doesn't call for a build. For changes that are only JavaScript, publish an update
instead (below).

### One-time setup (done 2026-11-06)

- Apple Developer Program (individual) and an Expo account (`ben-jamin-griff`).
- `npx eas-cli init` linked the Expo project `@ben-jamin-griff/waddle`; its ID is in `app.json`.
- The first build registered the bundle ID `app.waddle.mobile` and created the distribution
  certificate and App Store provisioning profile. Expo stores them;
  `npx eas-cli credentials` shows or replaces them.
- The first submit created the App Store Connect app and an App Store Connect API key, so later
  submits need no Apple sign-in.
- TestFlight: an internal testing group with automatic distribution, and Automatic Updates turned
  on in the TestFlight app, so each processed build installs on its own.

### Make a build

```bash
cd apps/mobile
pnpm release:build      # npx eas-cli build --platform ios --profile production --auto-submit
```

The build runs on Expo's macOS machines. It uploads the files git tracks, installs from the root
lockfile with the Node and pnpm versions pinned in `eas.json`, generates the Xcode project with
`expo prebuild`, signs it and uploads it to App Store Connect. The `production` profile in `eas.json` holds
the release settings: the Railway API URL, the Clerk publishable key, the Strava callback host and
the `production` update channel. Ignored files such as `.env` aren't uploaded. The build number
goes up automatically; `version` in `app.json` stays at `0.1.0` while the app is only on
TestFlight. Once Apple finishes processing (10–30 minutes), TestFlight installs it. Builds expire
after 90 days.

Follow a build at expo.dev, or with `npx eas-cli build:list`. If a submit fails, the finished
build can be sent again with `npx eas-cli submit -p ios --id <build id>`.

### Publish an update (no build)

Installed builds check for an update each time the app opens and apply it on the next launch.
Use updates for JavaScript, text and image changes:

```bash
cd apps/mobile
pnpm release:update "What changed"
```

`scripts/release-update.mjs` runs `eas update` on the `production` channel with the production
values from `eas.json`, which `eas update` doesn't read itself. Updates are free up to 1,000
monthly active users.

An update only reaches builds with the same **runtime version**. `runtimeVersion` uses the
`fingerprint` policy, a hash of the app's native dependencies and native config, so an update
never lands on a build whose native code doesn't match. Adding or upgrading a package with native
code, changing `app.json`'s native settings (icon, scheme, plugins, bundle ID) or upgrading the
Expo SDK changes the fingerprint. Those changes need a new build. To see whether a change still
fits the installed build, compare `npx expo-updates fingerprint:generate --platform ios` before
and after it.

Pull a bad update with `npx eas-cli update:republish` (republish an earlier one) or
`npx eas-cli update:roll-back-to-embedded`.
