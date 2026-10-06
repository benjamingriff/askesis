# Storage architecture

## Decision

Use **PostgreSQL as the sole source of truth** for core plan and workout data.

Core domain data will be relational and normalised rather than stored as nested JSONB documents. The application will assemble nested workout trees for the API and frontend.

## Why PostgreSQL

The platform will need flexible and evolving queries, including:

- Find all threshold efforts in a block.
- Calculate prescribed distance and duration by week and discipline.
- Find workouts that refer to a zone system.
- Count hard or strength sessions.
- Compare week targets with realised prescriptions.
- Resolve calibrations by workout date.

PostgreSQL provides indexes, joins, constraints, transactions, and ad hoc queryability for these operations. The expected workload is read-heavy and does not require specialised key-value scaling.

## Why not DynamoDB

DynamoDB works best when access patterns are known in advance and data can be denormalised around partition-key queries. Our validation and agent queries will evolve as the product develops.

DynamoDB would not remove the hierarchical modelling problem. We would have to either:

1. Store each workout as a nested document, or
2. Store steps as manually related partition items.

It would also introduce a 400 KB item limit, application-managed integrity, more vendor-specific modelling, and awkward cross-plan analytics. These trade-offs are not justified by the current scale or workload.

## Why not a hybrid source of truth

Splitting authoritative plan data between PostgreSQL and a document or key-value database would introduce:

- Dual writes and failure recovery
- Cross-database consistency problems
- Ambiguous ownership
- More difficult backup and restoration
- More complex validation queries

Specialised secondary systems may be introduced later—for example Redis for caching, OpenSearch for search, or a warehouse for analytics—but they will not own core plan state.

## Proposed tables

### Macro plan

```text
athletes
plans
plan_goals
plan_constraints
training_blocks
training_weeks
week_targets
```

### Workout prescriptions

```text
workouts
workout_steps
step_completions
step_targets
movements
workout_tags
```

### Calibration

```text
calibration_profiles
calibration_zones
plan_calibration_periods
```

Decision, revision, and execution tables will be designed later.

## Relational outline

### `athletes`

```text
id
display_name
created_at
updated_at
```

### `plans`

```text
id
owner_id
title
description
start_date
end_date
status
schema_version
created_at
updated_at
```

### `plan_goals`

```text
id
plan_id
type
priority
event_name
event_date
discipline
distance_value
distance_unit
target_duration_seconds
description
```

### `plan_constraints`

```text
id
plan_id
type
severity
discipline
numeric_value
unit
day_of_week
description
```

Constraint types are controlled domain values rather than arbitrary key/value metadata.

### `training_blocks`

```text
id
plan_id
position
title
description
start_date
end_date
```

### `training_weeks`

```text
id
plan_id
block_id
week_number
position
title
description
start_date
end_date
```

Retaining `plan_id` on a week makes common plan queries direct even though the block also identifies the plan. Integrity must ensure the block and week belong to the same plan.

### `week_targets`

```text
id
week_id
metric
discipline
minimum_value
target_value
maximum_value
unit
```

### `workouts`

```text
id
plan_id
week_id
scheduled_date
position
title
description
purpose
primary_discipline
priority
estimated_duration_seconds
estimated_distance_metres
created_at
updated_at
```

Workout-level estimates support useful weekly projections when a time-based prescription has no exact pre-execution distance. They are explicitly estimates; the structured prescription remains authoritative.

### `workout_steps`

```text
id
workout_id
parent_step_id
position
kind
role
discipline
movement_id
repeat_count
label
instructions
```

`kind` is `sequence`, `repeat`, or `effort`. `parent_step_id` forms the tree and `position` orders siblings.

Useful indexes include:

```sql
CREATE INDEX workout_steps_workout_idx
    ON workout_steps (workout_id);

CREATE INDEX workout_steps_parent_position_idx
    ON workout_steps (parent_step_id, position);
```

All steps for one workout can be fetched with an indexed query and assembled in application memory. Typical workouts contain few enough nodes that this is inexpensive; no query-per-node or N+1 loading is required.

### `step_completions`

```text
step_id
completion_type
numeric_value
unit
condition_type
condition_value
```

An effort has one completion prescription. Check constraints should enforce valid column combinations for each completion type.

### `step_targets`

```text
id
step_id
position
target_type
minimum_value
target_value
maximum_value
unit
zone_system
zone_key
text_value
```

This is a controlled polymorphic table. Some nullable columns are accepted to avoid both JSONB and a large number of tiny target subtype tables. Check constraints should enforce valid combinations—for example, zone targets require a system and key, while power targets require numeric watt values.

### `movements`

```text
id
name
category
primary_discipline
instructions
```

Strength efforts can reference a movement while using the same completion and target structures as other efforts.

### `calibration_profiles`

```text
id
owner_id
discipline
system
method
fitness_value
source_description
created_at
```

Profiles are immutable.

### `calibration_zones`

```text
id
profile_id
zone_key
metric
minimum_value
target_value
maximum_value
unit
```

### `plan_calibration_periods`

```text
id
plan_id
profile_id
system
effective_from
effective_until
```

Effective periods should not overlap for the same plan and calibration system.

## Query and API shape

The storage model is not the API model. PostgreSQL stores normalised rows; a repository/domain layer returns nested objects such as:

```text
Workout
└── sequence
    ├── effort
    ├── repeat
    │   ├── effort
    │   └── effort
    └── effort
```

A workout can be loaded using a small fixed number of batched queries or joins:

1. Workout metadata
2. All steps
3. All completions and targets

The application then assembles the tree in linear time.

## Normalisation boundaries

The aim is practical normalisation, not maximal decomposition. In particular:

- Do not create a lookup table for every enum or unit.
- Do not create one table per target type unless real requirements demand it.
- Use database enums or check constraints for controlled vocabularies.
- Keep narrative fields as text.
- Avoid arbitrary metadata bags for core semantics.
- Add cached projections only after measuring a real need.
