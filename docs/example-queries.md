# Example plan queries

Start an interactive session before running these queries:

```bash
docker compose exec postgres psql -U askesis -d askesis
```

Expanded output is useful for wider results:

```psql
\x auto
```

## Inspect the schema

```psql
\dt
\dv
\d workouts
\d workout_steps
```

## Plan overview

```sql
SELECT
    p.title,
    a.display_name AS athlete,
    p.start_date,
    p.end_date,
    p.status
FROM plans p
JOIN athletes a ON a.id = p.owner_id;
```

## Goals and constraints

```sql
SELECT
    priority,
    goal_type,
    event_name,
    event_date,
    distance_value,
    distance_unit,
    target_duration_seconds,
    description
FROM plan_goals
ORDER BY CASE priority
    WHEN 'primary' THEN 1
    WHEN 'secondary' THEN 2
    WHEN 'stretch' THEN 3
END;
```

```sql
SELECT constraint_type, severity, discipline, numeric_value, unit,
       day_of_week, description
FROM plan_constraints
ORDER BY severity, constraint_type;
```

## Blocks, weeks, and targets

```sql
SELECT
    tb.position AS block_position,
    tb.title AS block,
    tw.week_number,
    tw.title AS week,
    tw.start_date,
    tw.end_date
FROM training_blocks tb
JOIN training_weeks tw ON tw.block_id = tb.id
ORDER BY tb.position, tw.position;
```

```sql
SELECT
    tw.week_number,
    wt.metric,
    wt.discipline,
    wt.minimum_value,
    wt.target_value,
    wt.maximum_value,
    wt.unit
FROM training_weeks tw
JOIN week_targets wt ON wt.week_id = tw.id
ORDER BY tw.week_number, wt.metric;
```

## Weekly target versus estimated plan

The weekly target is intentional macro-level guidance. Workout-level estimates are convenient projections for time-based prescriptions whose distance cannot be calculated exactly before execution.

```sql
SELECT
    s.week_number,
    s.title,
    wt.minimum_value AS minimum_km,
    wt.target_value AS target_km,
    wt.maximum_value AS maximum_km,
    round(s.estimated_run_distance_metres / 1000, 1) AS estimated_km,
    CASE
        WHEN s.estimated_run_distance_metres / 1000
             BETWEEN wt.minimum_value AND wt.maximum_value
        THEN 'within target'
        ELSE 'outside target'
    END AS validation
FROM weekly_plan_summary s
JOIN week_targets wt
  ON wt.week_id = s.week_id
 AND wt.metric = 'distance'
 AND wt.discipline = 'run'
ORDER BY s.week_number;
```

## Workout calendar

```sql
SELECT
    tw.week_number,
    w.scheduled_date,
    to_char(w.scheduled_date, 'Dy') AS day,
    w.title,
    w.priority,
    round(w.estimated_distance_metres / 1000, 1) AS estimated_km,
    round(w.estimated_duration_seconds / 60.0) AS estimated_minutes
FROM workouts w
JOIN training_weeks tw ON tw.id = w.week_id
ORDER BY w.scheduled_date, w.position;
```

## Reconstruct a workout tree

This query displays the hierarchy for the hill workout. An application would fetch the same rows and assemble nested API objects in memory.

```sql
WITH RECURSIVE tree AS (
    SELECT
        ws.*,
        0 AS depth,
        ARRAY[ws.position] AS sort_path
    FROM workout_steps ws
    JOIN workouts w ON w.id = ws.workout_id
    WHERE w.title = 'Uphill repetitions'
      AND ws.parent_step_id IS NULL

    UNION ALL

    SELECT
        child.*,
        parent.depth + 1,
        parent.sort_path || child.position
    FROM tree parent
    JOIN workout_steps child ON child.parent_step_id = parent.id
)
SELECT
    repeat('  ', depth) || coalesce(label, kind) AS step,
    kind,
    role,
    discipline,
    repeat_count
FROM tree
ORDER BY sort_path;
```

## Show completion conditions and targets

```sql
SELECT
    w.title AS workout,
    ws.label AS step,
    ws.role,
    sc.completion_type,
    sc.numeric_value AS completion_value,
    sc.unit AS completion_unit,
    sc.condition_type,
    st.target_type,
    st.minimum_value AS target_min,
    st.target_value,
    st.maximum_value AS target_max,
    st.unit AS target_unit,
    st.zone_system,
    st.zone_key,
    st.text_value
FROM workouts w
JOIN workout_steps ws ON ws.workout_id = w.id
LEFT JOIN step_completions sc ON sc.step_id = ws.id
LEFT JOIN step_targets st ON st.step_id = ws.id
WHERE w.title = '10k time trial'
ORDER BY ws.position, st.position;
```

## Expand repeated prescription totals

`workout_prescription_totals` recursively applies repeat counts. For example, four 80 m strides contribute 320 m of explicitly prescribed distance.

```sql
SELECT
    w.title,
    t.discipline,
    t.duration_seconds,
    t.distance_metres,
    t.repetitions
FROM workout_prescription_totals t
JOIN workouts w ON w.id = t.workout_id
ORDER BY w.scheduled_date;
```

This view only totals explicit completion prescriptions. It does not pretend that a 35-minute easy run has an exact distance.

## Calibration history

```sql
SELECT
    p.system,
    p.effective_from,
    p.effective_until,
    cp.method,
    cp.fitness_value,
    cp.source_description
FROM plan_calibration_periods p
JOIN calibration_profiles cp ON cp.id = p.profile_id
ORDER BY p.system, p.effective_from;
```

## Resolve the zone profile effective for each workout

This demonstrates how future workouts switch calibration without rewriting their semantic `easy` or `threshold` targets.

```sql
SELECT DISTINCT
    w.scheduled_date,
    w.title AS workout,
    st.zone_key,
    cp.fitness_value AS vdot,
    cz.minimum_value AS pace_min_seconds_per_km,
    cz.maximum_value AS pace_max_seconds_per_km
FROM workouts w
JOIN workout_steps ws ON ws.workout_id = w.id
JOIN step_targets st
  ON st.step_id = ws.id
 AND st.target_type = 'zone'
JOIN plan_calibration_periods period
  ON period.plan_id = w.plan_id
 AND period.system = st.zone_system
 AND w.scheduled_date >= period.effective_from
 AND (period.effective_until IS NULL OR w.scheduled_date < period.effective_until)
JOIN calibration_profiles cp ON cp.id = period.profile_id
JOIN calibration_zones cz
  ON cz.profile_id = cp.id
 AND cz.zone_key = st.zone_key
 AND cz.metric = 'pace'
ORDER BY w.scheduled_date, w.title, st.zone_key;
```

## Find all quality workouts

```sql
SELECT w.scheduled_date, w.title, w.priority
FROM workouts w
JOIN workout_tags tag ON tag.workout_id = w.id
WHERE tag.tag = 'quality'
ORDER BY w.scheduled_date;
```

## Find all RPE-controlled efforts

```sql
SELECT
    w.scheduled_date,
    w.title AS workout,
    ws.label AS effort,
    st.minimum_value AS minimum_rpe,
    st.maximum_value AS maximum_rpe
FROM step_targets st
JOIN workout_steps ws ON ws.id = st.step_id
JOIN workouts w ON w.id = ws.workout_id
WHERE st.target_type = 'rpe'
ORDER BY w.scheduled_date, ws.position;
```
