/** Pure aggregate checks. Persisted entities already satisfy local SQL constraints. */
export type ValidationFinding = {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  path: string;
};

export type DatedEntity = { id: string; startDate: string; endDate: string; position?: number };
export type ValidationPlan = {
  startDate: string | null;
  endDate: string | null;
  blocks: DatedEntity[];
  weeks: (DatedEntity & { blockId: string; weekNumber?: number })[];
  workouts: { id: string; weekId: string; scheduledDate: string; position?: number }[];
  steps?: {
    id: string;
    workoutId: string;
    parentId: string | null;
    kind: string;
    position: number;
    hasCompletion: boolean;
    hasTargets: boolean;
  }[];
  unresolvedZones?: string[];
};

export const VALIDATOR_VERSION = 3;
const day = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

export function validatePlan(plan: ValidationPlan): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const add = (
    code: string,
    severity: ValidationFinding['severity'],
    message: string,
    path: string,
  ) => {
    findings.push({ code, severity, message, path });
  };
  const inside = (start: string, end: string, outer: DatedEntity) =>
    start >= outer.startDate && end <= outer.endDate;
  const range =
    plan.startDate !== null && plan.endDate !== null
      ? { id: 'plan', startDate: plan.startDate, endDate: plan.endDate }
      : null;

  if (plan.startDate === null)
    add('START_DATE_REQUIRED', 'error', 'Set a plan start date.', 'startDate');
  if (plan.endDate === null) add('END_DATE_REQUIRED', 'error', 'Set a plan end date.', 'endDate');
  if (range !== null && range.endDate < range.startDate) {
    add('INVALID_PLAN_RANGE', 'error', 'The plan end date precedes its start date.', 'endDate');
  }

  function checkRanges(items: DatedEntity[], kind: 'BLOCK' | 'WEEK') {
    const collection = kind === 'BLOCK' ? 'blocks' : 'weeks';
    const sorted = [...items].sort(
      (a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id),
    );
    let coveredUntil: string | null = null;
    for (const item of sorted) {
      if (range !== null && !inside(item.startDate, item.endDate, range)) {
        add(
          `${kind}_OUTSIDE_PLAN`,
          'error',
          `${kind === 'BLOCK' ? 'Block' : 'Week'} falls outside the plan dates.`,
          `${collection}/${item.id}`,
        );
      }
      if (coveredUntil !== null && item.startDate <= coveredUntil) {
        add(
          `${kind}_OVERLAP`,
          'error',
          `${kind === 'BLOCK' ? 'Blocks' : 'Weeks'} overlap.`,
          `${collection}/${item.id}`,
        );
      } else if (coveredUntil !== null && day(item.startDate) > day(coveredUntil) + 1) {
        add(
          `${kind}_GAP`,
          'warning',
          `There is a gap between ${collection}.`,
          `${collection}/${item.id}`,
        );
      }
      if (coveredUntil === null || item.endDate > coveredUntil) coveredUntil = item.endDate;
    }
    if (range !== null && range.endDate >= range.startDate) {
      let nextDay = day(range.startDate);
      for (const item of sorted) {
        if (day(item.startDate) > nextDay) break;
        nextDay = Math.max(nextDay, day(item.endDate) + 1);
      }
      if (nextDay <= day(range.endDate)) {
        add(
          `${kind}_COVERAGE_GAP`,
          'warning',
          `Some plan dates are not covered by ${collection}.`,
          collection,
        );
      }
    }
  }
  checkRanges(plan.blocks, 'BLOCK');
  checkRanges(plan.weeks, 'WEEK');
  function chronological(
    items: { id: string; startDate: string; position?: number }[],
    code: string,
  ) {
    const sorted = [...items]
      .filter((item) => item.position !== undefined)
      .sort((a, b) => a.position! - b.position!);
    for (let index = 1; index < sorted.length; index++) {
      if (sorted[index]!.startDate < sorted[index - 1]!.startDate)
        add(
          code,
          'error',
          'Structural ordering must follow chronological dates.',
          sorted[index]!.id,
        );
    }
  }
  chronological(plan.blocks, 'BLOCK_ORDER');
  for (const block of plan.blocks)
    chronological(
      plan.weeks.filter((week) => week.blockId === block.id),
      'WEEK_ORDER',
    );
  chronological(
    plan.weeks.map((week) => ({
      ...week,
      ...(week.weekNumber === undefined ? {} : { position: week.weekNumber }),
    })),
    'WEEK_NUMBER_ORDER',
  );
  const blocks = new Map(plan.blocks.map((block) => [block.id, block]));
  const weeks = new Map(plan.weeks.map((week) => [week.id, week]));
  const populatedWeeks = new Set(plan.workouts.map((workout) => workout.weekId));
  const populatedBlocks = new Set(
    plan.weeks.filter((week) => populatedWeeks.has(week.id)).map((week) => week.blockId),
  );

  for (const week of plan.weeks) {
    const block = blocks.get(week.blockId);
    if (block === undefined || !inside(week.startDate, week.endDate, block)) {
      add(
        'WEEK_OUTSIDE_BLOCK',
        'error',
        'Week must belong within a block in this version.',
        `weeks/${week.id}`,
      );
    }
    if (day(week.endDate) - day(week.startDate) !== 6) {
      add('PARTIAL_WEEK', 'warning', 'Week is not seven days long.', `weeks/${week.id}`);
    }
    if (!populatedWeeks.has(week.id))
      add('EMPTY_WEEK', 'warning', 'Week contains no workouts.', `weeks/${week.id}`);
  }
  for (const block of plan.blocks) {
    if (!populatedBlocks.has(block.id))
      add('EMPTY_BLOCK', 'warning', 'Block contains no workouts.', `blocks/${block.id}`);
  }
  for (const workout of plan.workouts) {
    const week = weeks.get(workout.weekId);
    if (week === undefined || !inside(workout.scheduledDate, workout.scheduledDate, week)) {
      add(
        'WORKOUT_OUTSIDE_WEEK',
        'error',
        'Workout must fall within its assigned week.',
        `workouts/${workout.id}/scheduledDate`,
      );
    }
    if (range !== null && !inside(workout.scheduledDate, workout.scheduledDate, range)) {
      add(
        'WORKOUT_OUTSIDE_PLAN',
        'error',
        'Workout falls outside the plan dates.',
        `workouts/${workout.id}/scheduledDate`,
      );
    }
  }
  if (plan.workouts.length === 0)
    add('EMPTY_SCHEDULE', 'warning', 'Plan contains no workouts.', 'workouts');

  for (const date of new Set(plan.workouts.map((workout) => workout.scheduledDate))) {
    const daily = plan.workouts
      .filter((workout) => workout.scheduledDate === date)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    if (
      daily.length > 1 &&
      daily.some(
        (workout, index) => workout.position !== undefined && workout.position !== index + 1,
      )
    )
      add(
        'WORKOUT_ORDER_GAP',
        'warning',
        'Multiple workouts on this day have nonconsecutive positions; review their intended order.',
        `workouts/${date}`,
      );
  }
  if (plan.steps !== undefined) {
    const nodes = new Map(plan.steps.map((step) => [step.id, step]));
    for (const workout of plan.workouts) {
      if (
        plan.steps.filter((step) => step.workoutId === workout.id && step.parentId === null)
          .length !== 1
      )
        add(
          'WORKOUT_ROOT',
          'error',
          'A workout needs exactly one prescription root.',
          `workouts/${workout.id}`,
        );
    }
    for (const step of plan.steps) {
      const children = plan.steps.filter((child) => child.parentId === step.id);
      if (
        step.kind === 'effort'
          ? children.length > 0 || !step.hasCompletion
          : children.length === 0 || step.hasCompletion || step.hasTargets
      )
        add(
          'STEP_SHAPE',
          'error',
          'Efforts need a completion and no children; containers need children and cannot carry completions or targets.',
          `steps/${step.id}`,
        );
      const visited = new Set<string>();
      let cursor: typeof step | undefined = step;
      while (cursor) {
        if (visited.has(cursor.id)) {
          add('STEP_CYCLE', 'error', 'Workout prescription contains a cycle.', `steps/${step.id}`);
          break;
        }
        visited.add(cursor.id);
        if (cursor.parentId === null) break;
        const parent = nodes.get(cursor.parentId);
        if (!parent || parent.workoutId !== step.workoutId) {
          add(
            'STEP_PARENT',
            'error',
            'Step parent must belong to the same workout.',
            `steps/${step.id}`,
          );
          break;
        }
        cursor = parent;
      }
    }
  }
  for (const target of plan.unresolvedZones ?? [])
    add(
      'ZONE_UNRESOLVED',
      'error',
      'Zone target needs a matching calibration zone effective on the workout date.',
      `targets/${target}`,
    );

  return findings.sort((a, b) => a.code.localeCompare(b.code) || a.path.localeCompare(b.path));
}
