# Askesis mobile (prototype)

An Expo / React Native prototype of the Askesis coaching app. It is a **UI/UX prototype**: all data is
hard-coded and the "coach" is a scripted simulation, so it runs with no API, database or accounts.

## Run it in Expo Go

```bash
cd apps/mobile
npm install
npx expo start
```

Scan the QR code with the Expo Go app (iOS: Camera app; Android: Expo Go's scanner). The phone and
computer must be on the same network; if that is awkward, use `npx expo start --tunnel`.

Everything uses libraries bundled in Expo Go, so no development build is needed. `npx expo start --web`
also works for a quick look in a browser.

> This app is installed with **npm**, not pnpm, and is excluded from the root pnpm workspace
> (`!apps/mobile` in `pnpm-workspace.yaml`). Metro works best with a flat `node_modules`.

## Preview builds

```bash
npx eas-cli@latest login
npx eas-cli@latest init          # links the project, writes the projectId into app.json
npx eas-cli@latest build --profile preview --platform android   # installable .apk
npx eas-cli@latest build --profile preview --platform ios       # needs an Apple developer account
```

Profiles live in `eas.json`.

## What to try

- **Today** — tap days in the week strip; open the hero workout.
- **Plan** — Weeks / Calendar toggle, tap a bar in the volume chart to jump weeks, tap a workout.
  Weeks 11–12 are intentionally unplanned (partial planning horizon).
- **Workout detail** — effort profile, nested repeats, pace targets from your pace guides, the
  swap icon moves the workout to another day (recorded as a draft change).
- **Coach** → open _Build the next block around my 10K_. **Swipe left** (or tap _Plan_) to flip between the
  conversation and the draft plan. Try the suggestion chips: _Plan the final two weeks_, _Make my next
  hard session easier_, _Swap in a full-body strength day_, _Make my next long run longer_. Press the
  stop button while the coach is working to cancel a run.
- **Review & lock** — from the Plan tab's _Draft_ pill, the draft banner, or the Plan page of a chat.
  Once locked, ask the coach for a change: it will ask you to unlock first (humans lock/unlock).
- **You → Appearance** — six themes, eight accent colours, custom hex, light/dark/system. Settings
  persist across launches. Units (km/mi) apply everywhere.

## Layout

```
src/app/            Expo Router screens ((tabs)/, workout/[id], chat/[id], lock-review, …)
src/components/     UI kit, intensity chart, chat message/composer, plan widgets
src/data/           types, plan generator (anchored to the current week), seeded conversations
src/lib/coach-sim.ts  scripted coach: intent → tool activity → streamed reply → plan edit
src/state/          settings (persisted), plan (draft/locked), chat
src/theme/          themes, accents, colour/contrast helpers
```

The plan is generated relative to today so the app always opens in week 5 of 12. Completed
workouts (anything before today) are derived, not recorded.

## Wiring up the real API later

`src/state/plan.tsx` and `src/state/chat.tsx` are the seams: they expose the same shapes the API
returns (plan weeks → workouts → step trees; conversations → runs) and are the only places that
read the seed data. `src/lib/metrics.ts` already derives distance/duration from step trees and
pace guides the way `docs/architecture/data-model.md` describes.
