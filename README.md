# Blocksmith — AI-Assisted Training Plan Prototype

A local-first prototype for storing and viewing structured training plans as files.

This repo currently contains a Cardiff Half Marathon 2026 plan imported from `training-plan.md` into agent-editable YAML files, plus a Vite/React frontend for browsing the plan.

## What this is

- Training plans are stored as plain files, not a database.
- Plan metadata, phases, weeks, and sessions are separated.
- Each session is a standalone file with intervals for warm-up, main set, strides, recoveries, and cool-down.
- Tags are the primary organisation mechanism.
- The frontend renders the plan as a training cockpit: overview, phases, weeks, sessions, intervals, zones, and guardrails.

## Stack

- Vite
- React
- TypeScript
- YAML
- Zod

## Run locally

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

Preview production build:

```bash
npm run preview
```

## File structure

```txt
plans/cardiff-half-2026/
  plan.yaml
  AGENT_GUIDE.md
  phases/
  weeks/
  sessions/

src/
  data/
    schema.ts
    loadPlan.ts
  main.tsx
  styles.css
```

## Current coverage

The first vertical slice has been implemented:

- Global plan metadata
- Five phase files
- Weeks 1–4
- 20 standalone session files

Weeks 5–21 still live in `training-plan.md` and can be imported next.

## Agent editing rules

See:

```txt
plans/cardiff-half-2026/AGENT_GUIDE.md
```
