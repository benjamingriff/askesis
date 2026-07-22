# Training plan data model

## Scope

The first product is a place to store and display a structured, adaptable training plan. Completed workout tracking, wearable imports, decision logs, and agent execution are deliberately deferred.

The initial model consists of:

```text
Plan
├── Goals and constraints
├── Calibration timeline
├── Training blocks
│   └── Training weeks
│       └── Scheduled workouts
└── Workout prescriptions
    └── Ordered step trees
```

A day is not a separate entity. A workout has a scheduled date, from which its day is derived.

## Plan intent

Top-down intent describes what the realised plan should achieve. It is distinct from the workouts themselves.

### Goals

A goal can describe an event, performance target, or other outcome. Relevant fields include:

- Type and priority
- Discipline
- Event name and date
- Distance
- Target duration
- Description

### Constraints

Constraints describe boundaries and preferences such as:

- Maximum weekly duration or distance
- Maximum number of hard sessions
- Preferred or required rest days
- Maximum long-workout duration
- Recovery-week frequency

Each constraint has a severity:

- `hard` — must not be violated
- `soft` — should be followed where practical
- `target` — a desired outcome or range

### Blocks and weeks

Blocks and weeks carry coaching meaning, not just calendar grouping. They contain titles, descriptions, objectives, dates, and ordering.

A week can have macro targets such as:

```text
Run distance:       min 55, target 60, max 64 km
Training duration:  target 8 h
Hard sessions:      target 2, max 2
Strength sessions:  target 2
```

These values express intent. The realised totals are derived from the scheduled workouts and compared with the targets.

## Workout prescriptions

A universal `set / rep / rest` model is too restrictive for endurance, strength, swimming, mixed sessions, circuits, and open-ended efforts. Instead, a workout is an ordered recursive tree with three node kinds.

### `sequence`

An ordered container of steps. A workout normally has a sequence as its root.

### `repeat`

Repeats its ordered child steps a specified number of times.

### `effort`

An activity or movement performed until a completion condition is met. An effort has a discipline, role, completion prescription, and zero or more targets.

Example:

```text
sequence
├── effort: 15-minute easy run (warm-up)
├── repeat × 6
│   ├── effort: run 800 m at threshold
│   └── effort: jog for 90 seconds (recovery)
└── effort: 10-minute easy run (cool-down)
```

Recovery is an effort with the role `recovery`, rather than a special scalar attached to a repetition. This supports timed rest, easy jogging, walk-back recovery, active swimming recovery, and condition-based recovery.

## Completion prescriptions

Completion answers: **when does this effort finish?**

Initial completion types:

- `duration`
- `distance`
- `repetitions`
- `energy`
- `until_lap`
- `until_condition`
- `open`

Examples include 15 minutes, 800 metres, five repetitions, or until returning to the start of a hill.

## Effort targets

Targets answer: **how should this effort be performed?**

Initial target types:

- `zone`
- `pace`
- `speed`
- `heart_rate`
- `power`
- `cadence`
- `rpe`
- `load`
- `percentage_1rm`
- `rir`
- `tempo`
- `instruction`

An effort can have multiple targets, such as a power range, cadence range, and maximum RPE. Numeric targets support minimum, target, and maximum values.

Targets use typed numeric values and units. Display strings such as `3:45/km` are presentation concerns rather than authoritative stored values.

## Strength and mixed workouts

Strength and endurance share the workout tree but retain sport-specific meaning.

A strength effort references a movement and can prescribe repetitions, load, percentage of 1RM, RIR, and tempo. A superset is a repeated sequence of multiple efforts.

A mixed workout can freely compose disciplines:

```text
sequence
├── effort: 10-minute run
├── repeat × 5
│   ├── effort: 500 m row
│   ├── effort: 10 kettlebell swings
│   └── effort: 60-second recovery
└── effort: 10-minute cycle
```

## Calibration profiles

Fitness assumptions and zones are versioned separately from workouts. A workout normally refers to a semantic zone:

```text
type: zone
system: run_pace
zone: threshold
```

The plan has a calibration timeline mapping a zone system to an immutable profile over an effective date range. When a test updates running fitness, a new profile is added and becomes effective from a specified date.

This means:

- Earlier workouts retain their original fitness context.
- Future workouts resolve against the updated profile.
- Semantic prescriptions do not need to be rewritten.
- Absolute targets remain available when a pace, power, or load must be fixed.

## Derived values

Weekly distance, duration, intensity distribution, load, and similar metrics should be derived from workout prescriptions. Macro targets are stored because they describe intent; calculated totals are not manually authoritative.

Derived values may eventually be cached for performance, but any cache must record its calculation method/version and remain reproducible from source prescriptions.

## Deferred concerns

The initial model does not yet cover:

- Completed workout records
- Wearable data
- Decision and audit logs
- Plan revision history
- Agent operations
- Detailed load-model selection
- Nutrition or injury prediction

The model should leave room for these without implementing them prematurely.
