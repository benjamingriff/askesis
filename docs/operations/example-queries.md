# Current PostgreSQL inspection queries

Verified against all migrations and the published synthetic fixture on 2026-10-06. These are operator inspection queries, not application authorization boundaries. Use a trusted local/administrative connection; never expose them as direct client SQL tools.

The fixed fixture plan is `00000000-0000-0000-0000-000000000010` and its version is `00000000-0000-0000-0000-000000000050`. Replace those UUIDs to inspect a different owned plan/version. The synthetic owner is separate from Clerk accounts.

## Plans and version pointers

```sql
SELECT p.id, p.display_name, p.owner_id, p.state_version,
       p.activated_at, p.archived_at,
       p.current_draft_version_id, p.current_locked_version_id
FROM plans p
ORDER BY p.created_at, p.id;

SELECT v.id, v.state, v.version_number, v.edit_number,
       v.start_date, v.end_date, v.based_on_version_id,
       v.supersedes_version_id, v.content_schema_version,
       v.content_hash_version, v.content_hash, v.locked_at
FROM plan_versions v
WHERE v.plan_id = '00000000-0000-0000-0000-000000000010'
ORDER BY v.created_at, v.id;
```

## Version-owned brief and weekdays

```sql
SELECT goal_text, context, timezone, distance_unit,
       weekly_distance_status, weekly_distance_metres,
       current_runs_status, current_runs_per_week,
       longest_run_status, longest_run_metres, desired_runs_per_week,
       confirmed_at, confirmed_hash, schedule_review_required
FROM plan_briefs
WHERE plan_version_id = '00000000-0000-0000-0000-000000000050';

SELECT weekday, availability
FROM plan_brief_weekdays
WHERE plan_version_id = '00000000-0000-0000-0000-000000000050'
ORDER BY weekday;
```

Stored confirmation metadata alone does not prove a current confirmation: API reads compare it with the current semantic brief hash. Baseline distances are metres irrespective of display unit.

## Schedule and derived totals

```sql
SELECT w.id, w.lineage_id, w.scheduled_date, w.title,
       w.primary_discipline, w.estimated_distance_metres,
       w.estimated_duration_seconds, tw.week_number, b.title AS block_title
FROM workouts w
JOIN training_weeks tw ON tw.id = w.week_id
JOIN training_blocks b ON b.id = tw.block_id
WHERE w.plan_version_id = '00000000-0000-0000-0000-000000000050'
ORDER BY w.scheduled_date, w.position, w.id;

SELECT week_number, workout_count,
       estimated_run_distance_metres / 1000 AS estimated_km,
       estimated_duration_seconds
FROM weekly_plan_summary
WHERE plan_version_id = '00000000-0000-0000-0000-000000000050'
ORDER BY week_number;

SELECT w.title, t.distance_metres, t.duration_seconds, t.repetitions
FROM workout_prescription_totals t
JOIN workouts w ON w.id = t.workout_id
WHERE t.plan_version_id = '00000000-0000-0000-0000-000000000050'
ORDER BY w.scheduled_date, w.position, w.id;
```

Weekly summary uses stored prescribed estimates; tree totals use explicit completions and nested repeat multipliers. Neither reports completed athlete performance or estimates distance from pace.

## Nested workout steps

```sql
WITH RECURSIVE tree AS (
  SELECT s.id, s.workout_id, s.parent_step_id, s.kind, s.label,
         s.position, s.repeat_count, ARRAY[s.position] AS sort_path, 0 AS depth
  FROM workout_steps s
  WHERE s.plan_version_id = '00000000-0000-0000-0000-000000000050'
    AND s.parent_step_id IS NULL
  UNION ALL
  SELECT c.id, c.workout_id, c.parent_step_id, c.kind, c.label,
         c.position, c.repeat_count, t.sort_path || c.position, t.depth + 1
  FROM workout_steps c
  JOIN tree t ON t.id = c.parent_step_id
)
SELECT w.title AS workout, t.depth, t.kind, t.label, t.repeat_count,
       c.completion_type, c.numeric_value, c.unit
FROM tree t
JOIN workouts w ON w.id = t.workout_id
LEFT JOIN step_completions c ON c.step_id = t.id
ORDER BY w.scheduled_date, w.position, w.id, t.sort_path;
```

Targets are separate ordered rows in `step_targets`; joining all targets to this result can multiply each completion row. Use the API's assembled tree for normal application reads.

## Effective calibration and symbolic zones

```sql
SELECT p.effective_from, p.effective_until, c.id AS profile_id,
       c.method, c.calculator_version, c.provenance, c.estimate_basis
FROM plan_calibration_periods p
JOIN calibration_profiles c ON c.id = p.profile_id
WHERE p.plan_version_id = '00000000-0000-0000-0000-000000000050'
ORDER BY p.effective_from;

SELECT w.title, w.scheduled_date, t.zone_key, z.unit,
       z.minimum_value, z.target_value, z.maximum_value,
       cp.id AS profile_id, cp.calculator_version
FROM workouts w
JOIN workout_steps s ON s.workout_id = w.id
JOIN step_targets t ON t.step_id = s.id AND t.target_type = 'zone'
LEFT JOIN plan_calibration_periods p
  ON p.plan_version_id = w.plan_version_id
 AND p.system = t.zone_system
 AND p.effective_from <= w.scheduled_date
 AND (p.effective_until IS NULL OR w.scheduled_date < p.effective_until)
LEFT JOIN calibration_profiles cp ON cp.id = p.profile_id
LEFT JOIN calibration_zones z
  ON z.profile_id = cp.id AND z.zone_key = t.zone_key
WHERE w.plan_version_id = '00000000-0000-0000-0000-000000000050'
ORDER BY w.scheduled_date, w.position, w.id, s.position, t.position;
```

Period ends are exclusive. Null joined calibration/zone columns expose unresolved targets instead of silently falling back to another profile. SQL values here are canonical seconds/km; the API's workout projection applies display-unit conversion.

## Runs and delivery metadata

```sql
SELECT id, conversation_id, status, failure_code,
       created_at, started_at, finished_at, lease_expires_at,
       provider, model, reasoning, prompt_version,
       input_tokens, output_tokens, tool_count,
       generation_start_date, generation_end_date, generation_prescribed_through
FROM agent_runs
ORDER BY created_at DESC, id;

SELECT owner_id, sequence, type, resource_id, metadata
FROM live_events
ORDER BY owner_id, sequence DESC
LIMIT 50;
```

Do not select credential digests, request/response payloads, prompts or message text merely to inspect status. Run settings are captured at claim; queued runs can have null model fields. No cost calculation or per-user spend limit is inferred from nullable cost columns. Journal data is disposable replay metadata; visible text is stored separately.
