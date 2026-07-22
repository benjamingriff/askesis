# Agent Guide — Cardiff Half 2026

This plan is file-backed and local-first.

## Rules

- Edit `plan.yaml` for goals, zones, VDOT, guardrails, or race-level assumptions.
- Edit `phases/*.yaml` for phase goals and date ranges.
- Edit `weeks/week-NN.yaml` for week theme, target volume, and session membership.
- Edit one file in `sessions/*.yaml` for a workout change.
- Keep warm-ups, strides, recoveries, and cool-downs as `intervals` inside the session.
- Preserve session IDs unless the date/day identity changes.
- Tags are the primary organisational layer. Directories are only storage.

## Current prototype coverage

- Plan metadata converted.
- Five phases stubbed.
- Weeks 1–4 fully converted into standalone session files.
- Weeks 5–21 still live in `training-plan.md` and should be imported next.
