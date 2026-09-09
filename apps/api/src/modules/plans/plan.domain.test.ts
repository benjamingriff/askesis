import { describe, expect, it } from 'vitest';
import { canonicalDecimal, contentHash } from './plan.canonical.js';
import { validatePlan, type ValidationPlan } from './plan.validation.js';

const empty: ValidationPlan = {
  startDate: '2026-09-01',
  endDate: '2026-09-30',
  blocks: [],
  weeks: [],
  workouts: [],
};

describe('canonical content', () => {
  it('ignores object property order but preserves prescription order', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash(['warmup', 'work'])).not.toBe(contentHash(['work', 'warmup']));
  });
  it('normalizes equivalent decimals without losing precision', () => {
    expect(canonicalDecimal('000123.45000')).toBe('123.45');
    expect(canonicalDecimal('-0.000')).toBe('0');
    expect(canonicalDecimal('9007199254740993.0010')).toBe('9007199254740993.001');
    expect(() => canonicalDecimal('NaN')).toThrow();
    expect(() => contentHash(Infinity)).toThrow();
  });
});

describe('plan validation', () => {
  it('blocks reversed structural chronology and detects malformed prescription trees', () => {
    const plan: ValidationPlan = {
      ...empty,
      blocks: [
        { id: 'late', startDate: '2026-09-15', endDate: '2026-09-30', position: 1 },
        { id: 'early', startDate: '2026-09-01', endDate: '2026-09-14', position: 2 },
      ],
      workouts: [{ id: 'run', weekId: 'week', scheduledDate: '2026-09-01' }],
      steps: [
        {
          id: 'cycle',
          workoutId: 'run',
          parentId: 'cycle',
          kind: 'effort',
          position: 1,
          hasCompletion: false,
          hasTargets: false,
        },
      ],
    };
    expect(validatePlan(plan).map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['BLOCK_ORDER', 'WORKOUT_ROOT', 'STEP_CYCLE', 'STEP_SHAPE']),
    );
  });
  it('warns about unusual same-day ordering but accepts a well-formed single effort', () => {
    const findings = validatePlan({
      ...empty,
      workouts: [
        { id: 'a', weekId: 'w', scheduledDate: '2026-09-01', position: 1 },
        { id: 'b', weekId: 'w', scheduledDate: '2026-09-01', position: 3 },
      ],
      steps: ['a', 'b'].map((id) => ({
        id,
        workoutId: id,
        parentId: null,
        kind: 'effort',
        position: 1,
        hasCompletion: true,
        hasTargets: false,
      })),
    });
    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'WORKOUT_ORDER_GAP', severity: 'warning' }),
    );
    expect(
      findings.some(
        (finding) => finding.code.startsWith('STEP_') || finding.code === 'WORKOUT_ROOT',
      ),
    ).toBe(false);
  });
  it('allows bounded empty plans with warnings, but requires dates', () => {
    const result = validatePlan(empty);
    expect(result.some((finding) => finding.severity === 'error')).toBe(false);
    expect(result.some((finding) => finding.code === 'EMPTY_SCHEDULE')).toBe(true);
    expect(
      validatePlan({ ...empty, startDate: null }).some(
        (finding) => finding.code === 'START_DATE_REQUIRED',
      ),
    ).toBe(true);
  });
  it('detects nested overlap using the furthest covered date', () => {
    const blocks = [
      { id: 'a', startDate: '2026-09-01', endDate: '2026-09-30' },
      { id: 'b', startDate: '2026-09-02', endDate: '2026-09-03' },
      { id: 'c', startDate: '2026-09-10', endDate: '2026-09-12' },
    ];
    expect(
      validatePlan({ ...empty, blocks }).filter((finding) => finding.code === 'BLOCK_OVERLAP'),
    ).toHaveLength(2);
  });
  it('rejects a moved workout outside its week and does not mutate input', () => {
    const plan: ValidationPlan = {
      ...empty,
      blocks: [{ id: 'b', startDate: '2026-09-01', endDate: '2026-09-30' }],
      weeks: [{ id: 'w', blockId: 'b', startDate: '2026-09-01', endDate: '2026-09-07' }],
      workouts: [{ id: 'run', weekId: 'w', scheduledDate: '2026-09-08' }],
    };
    const before = structuredClone(plan);
    expect(validatePlan(plan).some((finding) => finding.code === 'WORKOUT_OUTSIDE_WEEK')).toBe(
      true,
    );
    expect(plan).toEqual(before);
  });
});
