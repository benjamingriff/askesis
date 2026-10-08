import { describe, expect, it } from 'vitest';
import { WORKOUT_DISCIPLINES, STEP_DISCIPLINES } from '../modules/plans/disciplines.js';
import { BLOCK_PHASES, RACE_PRIORITIES } from '../modules/plans/periodization.js';
import { CALIBRATORS } from '../modules/performance/performance.calibrators.js';
import {
  StepCompletionSchema,
  StepTargetSchema,
  WorkoutStepKindSchema,
} from '../modules/workouts/workout.schemas.js';
import {
  BLUEPRINT_REVISION,
  buildExample,
  exampleAnchor,
  exampleCoverage,
  shiftDay,
  type Step,
} from './blueprint.js';

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

  it('covers every phase in contiguous blocks of whole weeks, with build repeated', () => {
    const plan = buildExample('2026-09-28');
    expect(plan.blocks.map((b) => b.phase)).toEqual([
      'base',
      'build',
      'recovery',
      'build',
      'peak',
      'taper',
    ]);
    expect([...new Set(plan.blocks.map((b) => b.phase))].sort()).toEqual([...BLOCK_PHASES].sort());
    expect(plan.blocks[0]!.startDate).toBe(plan.anchor);
    expect(plan.blocks.at(-1)!.endDate).toBe(plan.endDate);
    for (const [index, block] of plan.blocks.entries()) {
      if (index) expect(block.startDate).toBe(shiftDay(plan.blocks[index - 1]!.endDate, 1));
      const weeks = plan.weeks.filter((w) => w.blockIndex === index);
      expect(weeks[0]!.startDate).toBe(block.startDate);
      expect(weeks.at(-1)!.endDate).toBe(block.endDate);
      expect(weeks.map((w) => w.position)).toEqual(weeks.map((_, i) => i + 1));
    }
  });

  it('races each priority once and lightens the cutback week inside its block', () => {
    const plan = buildExample('2026-09-28');
    expect(sorted(exampleCoverage.racePriorities)).toEqual(sorted(RACE_PRIORITIES));
    const races = plan.weeks.flatMap((week) =>
      week.sessions
        .filter(({ session }) => session.race)
        .map(({ session }) => [week.index, session.race]),
    );
    expect(races).toEqual([
      [3, 'B'],
      [5, 'C'],
      [7, 'A'],
    ]);
    // The A race is the plan's last training day, at the end of the taper.
    expect(plan.blocks[plan.weeks[7]!.blockIndex]!.phase).toBe('taper');
    expect(plan.weeks.filter((w) => w.cutback).map((w) => w.index)).toEqual([2]);
    const cutback = plan.weeks[2]!;
    expect(plan.blocks[cutback.blockIndex]!.phase).toBe('base');
    // The sessions themselves are lighter, so the weekly totals clients chart drop too.
    const total = (index: number, key: 'minutes' | 'metres') =>
      plan.weeks[index]!.sessions.reduce((sum, { session }) => sum + (session[key] ?? 0), 0);
    expect(total(2, 'minutes')).toBeLessThanOrEqual(total(1, 'minutes') * 0.8);
    expect(total(2, 'metres')).toBeLessThanOrEqual(total(1, 'metres') * 0.8);
    const longest = (index: number) =>
      Math.max(
        ...plan.weeks[index]!.sessions.flatMap(({ session }) =>
          flatten(session.steps).map((step) =>
            step.completion?.completion_type === 'duration'
              ? Number(step.completion.numeric_value)
              : 0,
          ),
        ),
      );
    expect(longest(2)).toBeLessThan(longest(1));
    // Recovery and taper weeks are lighter than the training weeks before them too.
    expect(total(4, 'minutes')).toBeLessThan(total(3, 'minutes') * 0.8);
    expect(total(7, 'minutes')).toBeLessThan(total(6, 'minutes') * 0.85);
  });

  it('keeps numbered tests and sets intact when lightening a week', () => {
    const plan = buildExample('2026-09-28');
    const light = plan.weeks.filter((week) => week.volume < 1);
    expect(light.map((week) => week.index)).toEqual([2, 4, 7]);
    for (const week of light)
      for (const { session } of week.sessions)
        for (const step of flatten(session.steps)) {
          // A label stating metres ('400 m controlled test') still prescribes that distance.
          const stated = /^(\d+) m\b/.exec(step.label)?.[1];
          if (stated && step.completion?.completion_type === 'distance')
            expect(Number(step.completion.numeric_value)).toBe(Number(stated));
        }
    const session = (index: number, title: string) =>
      plan.weeks[index]!.sessions.find(({ session }) => session.title === title)!.session;
    expect(session(2, 'Sweet spot 2 × 15')).toEqual(session(0, 'Sweet spot 2 × 15'));
    expect(session(2, '400/200 swim test rehearsal').steps).toEqual(
      session(1, '400/200 swim test rehearsal').steps,
    );
  });

  it('derives the publication revision from the blueprint content', () => {
    expect(BLUEPRINT_REVISION).toMatch(/^multisport-showcase-v3-[0-9a-f]{12}$/);
  });

  it('anchors by local calendar week through midnight and DST boundaries', () => {
    expect(exampleAnchor('Europe/London', new Date('2026-10-11T22:30:00Z'))).toBe('2026-09-28');
    expect(exampleAnchor('Europe/London', new Date('2026-10-11T23:30:00Z'))).toBe('2026-10-05');
    expect(exampleAnchor('Europe/London', new Date('2026-10-25T23:30:00Z'))).toBe('2026-10-12');
    expect(exampleAnchor('Europe/London', new Date('2026-10-26T00:30:00Z'))).toBe('2026-10-19');
  });
});
