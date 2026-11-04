import { describe, expect, it } from 'vitest';
import { BriefSchema } from '../modules/plans/brief.schemas.js';
import { CALIBRATORS } from '../modules/performance/performance.calibrators.js';
import {
  BLUEPRINT_REVISIONS,
  EXAMPLE_KINDS,
  buildExample,
  exampleAnchor,
  shiftDay,
  type Step,
} from './blueprint.js';

const flatten = (steps: Step[]): Step[] =>
  steps.flatMap((step) => [step, ...flatten(step.steps ?? [])]);
const total = (plan: ReturnType<typeof buildExample>, week: number) =>
  plan.weeks[week]!.sessions.reduce((sum, { session }) => sum + session.minutes, 0);

describe('three-month example plans', () => {
  for (const kind of EXAMPLE_KINDS) {
    it(`${kind} spans twelve populated weeks with contiguous realistic blocks and valid prescriptions`, () => {
      const plan = buildExample(kind, '2026-09-28');
      expect(plan.endDate).toBe('2026-12-20');
      expect(plan.weeks).toHaveLength(12);
      expect(plan.blocks.map((b) => b.weekCount)).toEqual([4, 4, 3, 1]);
      expect(BriefSchema.safeParse(plan.brief).success).toBe(true);
      expect(plan.blocks[0]!.startDate).toBe(plan.anchor);
      expect(plan.blocks.at(-1)!.endDate).toBe(plan.endDate);
      for (const [index, block] of plan.blocks.entries()) {
        if (index) expect(block.startDate).toBe(shiftDay(plan.blocks[index - 1]!.endDate, 1));
        const weeks = plan.weeks.filter((w) => w.blockIndex === index);
        expect(weeks[0]!.startDate).toBe(block.startDate);
        expect(weeks.at(-1)!.endDate).toBe(block.endDate);
        expect(weeks.map((w) => w.position)).toEqual(weeks.map((_, i) => i + 1));
      }
      for (const week of plan.weeks) {
        expect(week.sessions.length).toBeGreaterThan(0);
        for (let day = 0; day < 7; day++) {
          const count = week.sessions.filter((s) => s.day === day).length;
          expect(count).toBeLessThanOrEqual(2);
          if (plan.brief.weekdays[day] === 'unavailable') expect(count).toBe(0);
        }
        for (const { session } of week.sessions) {
          for (const step of flatten(session.steps)) {
            if (step.kind) {
              expect(step.steps?.length).toBeGreaterThan(0);
              expect(step.completion).toBeUndefined();
            } else {
              expect(step.sport).toBeDefined();
              expect(step.completion).toBeDefined();
              if (step.completion?.numeric_value)
                expect(Number(step.completion.numeric_value)).toBeGreaterThan(0);
            }
            for (const target of step.targets ?? []) {
              if (target.target_type !== 'zone') continue;
              const calibrator = CALIBRATORS[target.zone_system as keyof typeof CALIBRATORS];
              expect(calibrator.discipline).toBe(step.sport);
              expect(calibrator.zoneKeys).toContain(target.zone_key);
            }
          }
        }
        for (const target of week.targets) {
          const matching = week.sessions.filter(
            ({ session }) => session.sport === target.discipline,
          );
          if (target.metric === 'duration')
            expect(target.target).toBe(
              matching.reduce((sum, { session }) => sum + session.minutes * 60, 0),
            );
          if (target.metric === 'distance')
            expect(target.target).toBe(
              matching.reduce((sum, { session }) => sum + (session.metres ?? 0), 0),
            );
          if (target.metric === 'strength_session_count')
            expect(target.target).toBe(matching.length);
        }
      }
      expect(plan.weeks.filter((w) => w.cutback).map((w) => w.index)).toEqual([3, 7]);
      expect(total(plan, 2)).toBeGreaterThan(total(plan, 0));
      expect(total(plan, 3)).toBeLessThan(total(plan, 2) * 0.8);
      expect(total(plan, 7)).toBeLessThan(total(plan, 6) * 0.8);
      expect(total(plan, 11)).toBeLessThan(total(plan, 10) * 0.85);
      expect(BLUEPRINT_REVISIONS[kind]).toMatch(new RegExp(`^${kind}-example-v1-[0-9a-f]{12}$`));
    });
  }
  it('keeps cycling focused and reduces supporting strength during specific preparation', () => {
    const plan = buildExample('cycling', '2026-09-28');
    expect(plan.brief.sports.map((s) => s.sport)).toEqual(['cycle', 'strength']);
    for (const week of plan.weeks) {
      expect(week.sessions.filter(({ session }) => session.sport === 'cycle')).toHaveLength(4);
      expect(week.sessions.filter(({ session }) => session.sport === 'strength')).toHaveLength(
        week.index < 8 ? 2 : 1,
      );
      expect(
        week.sessions.every(({ session }) => ['cycle', 'strength'].includes(session.sport)),
      ).toBe(true);
    }
  });
  it('balances triathlon disciplines, transitions and the final sprint event', () => {
    const plan = buildExample('triathlon', '2026-09-28');
    for (const week of plan.weeks.slice(0, 11)) {
      expect(week.sessions.filter(({ session }) => session.sport === 'swim')).toHaveLength(2);
      const brick = week.sessions.find(({ session }) => session.tags.includes('brick'))!.session;
      expect(flatten(brick.steps).map((s) => s.sport)).toEqual([
        'cycle',
        'cycle',
        'other',
        'run',
        'other',
      ]);
    }
    const last = plan.weeks.at(-1)!.sessions.at(-1)!;
    expect(last.day).toBe(6);
    expect(last.session.race).toBe('A');
    expect(
      last.session.steps
        .filter((s) => s.completion?.completion_type === 'distance')
        .map((s) => Number(s.completion!.numeric_value)),
    ).toEqual([750, 20000, 5000]);
    expect(plan.blocks.at(-1)!.phase).toBe('taper');
  });
  it('includes a broad gym spectrum without adding endurance sports to the brief', () => {
    const plan = buildExample('strength-hiit', '2026-09-28');
    expect(plan.brief.sports.map((s) => s.sport)).toEqual(['strength']);
    const tags = new Set(
      plan.weeks.flatMap((w) => w.sessions.flatMap(({ session }) => session.tags)),
    );
    expect(
      ['emom', 'amrap', 'for-time', 'aerobic', 'lower', 'upper', 'full'].every((tag) =>
        tags.has(tag),
      ),
    ).toBe(true);
    for (const week of plan.weeks) {
      expect(week.sessions.filter(({ session }) => session.sport === 'strength')).toHaveLength(3);
      expect(week.sessions.filter(({ session }) => session.sport === 'mixed')).toHaveLength(2);
    }
    expect(plan.blocks.at(-1)!.phase).toBe('recovery');
  });
  it('makes every gym format rule visible as an effort and budgets its full prescription', () => {
    const plan = buildExample('strength-hiit', '2026-09-28');
    for (const week of plan.weeks) {
      const aerobic = week.sessions.find(({ session }) =>
        session.tags.includes('aerobic'),
      )!.session;
      const timedSeconds = (steps: Step[]): number =>
        steps.reduce(
          (sum, step) =>
            sum +
            (step.kind
              ? (step.repeat ?? 1) * timedSeconds(step.steps ?? [])
              : step.completion?.completion_type === 'duration'
                ? Number(step.completion.numeric_value)
                : 0),
          0,
        );
      expect(aerobic.minutes * 60).toBe(timedSeconds(aerobic.steps) + 60);
      const hiit = week.sessions.find(({ session }) => session.tags.includes('hiit'))!.session;
      const briefing = hiit.steps.find((step) => step.label === 'Format briefing')!;
      expect(briefing.kind).toBeUndefined();
      expect(briefing.completion?.completion_type).toBe('open');
      const rules = briefing.targets!.find((t) => t.target_type === 'instruction')!.text_value;
      const minutes = hiit.tags.includes('emom')
        ? Number(/EMOM (\d+)/.exec(hiit.title)![1])
        : hiit.tags.includes('amrap')
          ? Number(/AMRAP (\d+)/.exec(hiit.title)![1])
          : Number(/(\d+)-minute cap/.exec(String(rules))![1]);
      expect(hiit.minutes).toBe(minutes + 11);
      if (hiit.tags.includes('amrap')) {
        expect(rules).toContain('Stop at the time cap');
        expect(
          hiit.steps.find((step) => step.label === 'Repeat circuit until time cap')?.kind,
        ).toBe('sequence');
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
