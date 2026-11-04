# Askesis mobile

The Expo / React Native client for Askesis. It signs in with Clerk and uses the same API as the
web app: Today, the Plan (weeks, calendar, blocks, zones), workout prescriptions, the coach with
live activity and Stop, review & lock, unlock, discard, activation, plan details, the brief
editor, version history and restore, draft inspection, the plan library with new plans,
Performance with recorded and withdrawn results, and account management. The design comes from the [mobile prototype](../mobile-prototype/README.md), which
stays as the visual reference with its scripted data.

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
cd apps/mobile
npm install
npm run dev             # expo start --tunnel (npm run dev:lan for the same network)
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

> This app is installed with **npm**, not pnpm, and is excluded from the root pnpm workspace
> (`!apps/mobile` in `pnpm-workspace.yaml`). Metro works best with a flat `node_modules`.

### Run it on a Limrun cloud simulator

`npx lim run --ios-id <simulator id>` from `apps/mobile` builds the app remotely and launches it
on a Limrun iOS simulator. The cloud build sees only `apps/mobile`, so `apps/mobile/.env` (ignored)
holds `LIM_API_KEY` and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`; put the Limrun key in the main
checkout's `.env` and `pnpm dev:setup` writes both into new worktrees. The build has no Metro
behind it and calls `localhost:8081`, so to reach the local API run `npx expo start --port 8081`
and `npx lim ios tunnel --selector localhost:8081 --detach --id <simulator id>`.

### Signing in without a password (local verification)

```bash
npm run dev:login       # prints one-time sign-in links for the verification account
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
                    account, appearance, sign-in
src/components/     UI kit, form fields and date picker, plan view and widgets, workout rows,
                    effort chart, chat pieces
src/data/           React Query hooks over the API (plans, workouts, chat) and plan actions
src/lib/            API client and config, formatting, sports and workout presentation
                    (ported from apps/web/src/lib), request keys
src/state/          settings (persisted), live updates, plan selection, account query cache
src/theme/          themes, accents and effort colours, mirroring apps/web/src/theme
```

API types come from `packages/api-client/src/schema.ts` as type-only imports, so the generated
contract is shared without adding the pnpm package to this npm app. Live updates follow the same
event stream as the web (`/api/v1/live/events`) through `expo/fetch`, falling back to polling
while disconnected.

## In-app coach setting

The app reads `features.inAppCoach` from `GET /api/v1/account` before any signed-in screen renders,
as the web app does ([proposal](../../docs/product/in-app-coach-flag-proposal.md)). When the API
runs with `IN_APP_COACH=hidden`, the Coach tab and chat screens are removed (old chat links land on
Today). Every chat entry point opens **Ask your agent** (`src/app/ask-agent.tsx`) instead. That
screen copies the same prompt as the web app (`src/lib/coach.ts`) and shows it so it can be pasted.
Copy says "your agent" (`useCoachWord()` in `src/data/account.ts`). To try it locally, start the
API with `IN_APP_COACH=hidden pnpm dev`.

## Not yet on mobile

The brief editor, version history and restore, recording a result on the Performance page (share
it with the coach instead), plan renaming and sign-up. Use the web app for these.

## Checks

```bash
npx tsc --noEmit
```

## Preview builds

```bash
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest build --profile preview --platform android
```

Builds need `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` set for the build
profile. Profiles live in `eas.json`.
