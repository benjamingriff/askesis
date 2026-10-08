import { describe, expect, it } from 'vitest';
import { WORKOUT_DISCIPLINES, STEP_DISCIPLINES } from '../modules/plans/disciplines.js';
import { CALIBRATORS } from '../modules/performance/performance.calibrators.js';
import {
  StepCompletionSchema,
  StepTargetSchema,
  WorkoutStepKindSchema,
} from '../modules/workouts/workout.schemas.js';
import { buildExample, exampleAnchor, exampleCoverage, type Step } from './blueprint.js';

const flatten = (steps: Step[]): Step[] =>
  steps.flatMap((step) => [step, ...flatten(step.steps ?? [])]);
const sorted = (items: Iterable<unknown>) => [...new Set(items)].sort();

describe('complete multisport blueprint', () => {
  it('covers the storage vocabulary with valid trees and sport-specific zones', () => {
    expect(sorted(exampleCoverage.completionTypes)).toEqual(
      sorted(StepCompletionSchema.shape.type.options),
    );
    expect(sorted(exampleCoverage.targetTypes)).toEqual(
      sorted(StepTargetSchema.shape.type.options),
    );
    const plan = buildExample('2026-09-28');
    const sessions = plan.weeks.flatMap((week) => week.sessions.map((s) => s.session));
    const steps = sessions.flatMap((session) => flatten(session.steps));
    expect(sorted(steps.map((s) => s.kind ?? 'effort'))).toEqual(
      sorted(WorkoutStepKindSchema.options),
    );
    expect(sorted(sessions.map((s) => s.sport))).toEqual(sorted(WORKOUT_DISCIPLINES));
    expect(sorted(steps.flatMap((s) => (s.sport ? [s.sport] : [])))).toEqual(
      sorted(STEP_DISCIPLINES),
    );
    expect(sorted(steps.flatMap((s) => (s.role ? [s.role] : [])))).toEqual(
      sorted(exampleCoverage.stepRoles),
    );
    expect(
      sorted(steps.flatMap((s) => (s.completion ? [s.completion.completion_type] : []))),
    ).toEqual(sorted(exampleCoverage.completionTypes));
    expect(sorted(steps.flatMap((s) => (s.targets ?? []).map((t) => t.target_type)))).toEqual(
      sorted(exampleCoverage.targetTypes),
    );
    for (const step of steps) {
      if (step.kind) {
        expect(step.steps?.length).toBeGreaterThan(0);
        expect(step.completion).toBeUndefined();
        expect(step.targets).toBeUndefined();
      } else {
        expect(step.completion).toBeDefined();
        expect(step.sport).toBeDefined();
      }
      for (const target of step.targets ?? []) {
        if (target.target_type !== 'zone') continue;
        const calibrator = CALIBRATORS[target.zone_system as keyof typeof CALIBRATORS];
        expect(calibrator.discipline).toBe(step.sport);
        expect(calibrator.zoneKeys).toContain(target.zone_key);
      }
    }
  });

  it('fills eight complete weeks with rest days and no more than two daily sessions', () => {
    const plan = buildExample('2026-09-28');
    expect(plan.endDate).toBe('2026-11-22');
    expect(plan.blocks).toHaveLength(4);
    expect(plan.weeks).toHaveLength(8);
    for (const week of plan.weeks) {
      expect(week.sessions).toHaveLength(8);
      for (let day = 0; day < 7; day++) {
        const count = week.sessions.filter((s) => s.day === day).length;
        expect(count).toBeLessThanOrEqual(2);
        expect(count === 0).toBe(day === 4);
      }
    }
  });

  it('anchors by local calendar week through midnight and DST boundaries', () => {
    expect(exampleAnchor('Europe/London', new Date('2026-10-11T22:30:00Z'))).toBe('2026-09-28');
    expect(exampleAnchor('Europe/London', new Date('2026-10-11T23:30:00Z'))).toBe('2026-10-05');
    expect(exampleAnchor('Europe/London', new Date('2026-10-25T23:30:00Z'))).toBe('2026-10-12');
    expect(exampleAnchor('Europe/London', new Date('2026-10-26T00:30:00Z'))).toBe('2026-10-19');
  });
});
