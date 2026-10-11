import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { saveReview } from './results';
import { parseReview } from './review';
import { analyzeSession, countQuestions, parseDayLimits, type SessionInput } from './session';

const scenario = {
  facts: {
    goal: 'Finish comfortably.',
    dates: 'Start 2026-10-12.',
    training: 'Three runs, 22 km.',
    frequency: 'Three runs.',
    availability:
      'I have up to 60 minutes on Tuesdays and Thursdays and up to 100 minutes on Sundays.',
    fitness: '5 km in 28:00.',
    constraints: 'I prefer distances in kilometres.',
  },
  expectations: {
    sessionsPerWeek: 3,
    weeklyDistanceMetres: 22000,
    longestDistanceMetres: 9000,
    availableWeekdays: [2, 4, 7],
    raceDistanceMetres: 5000,
    raceDurationSeconds: 1680,
  },
  dates: { startDate: '2026-10-12', eventDate: '2027-01-03', observedOn: '2026-09-25' },
};

const brief = (overrides: { weekly?: number; unit?: string; goal?: string }) => ({
  goal: overrides.goal ?? 'Half marathon on 2027-01-03.',
  unit: overrides.unit ?? 'kilometres',
  sports: [
    {
      sport: 'run',
      currentSessions: { status: 'known', value: 3 },
      desiredSessions: 3,
      weeklyDistance: { status: 'known', value: overrides.weekly ?? 22000 },
      longestDistance: { status: 'known', value: 9000 },
    },
  ],
  weekdays: [
    'unavailable',
    'available',
    'unavailable',
    'available',
    'unavailable',
    'unavailable',
    'preferred',
  ],
});

function input(overrides: Partial<SessionInput> = {}): SessionInput {
  const at = (seconds: number) => new Date(Date.UTC(2026, 9, 9, 14, 0, seconds)).toISOString();
  return {
    messages: [
      { sequence: 1, role: 'user', content: 'Plan please.', createdAt: at(0) },
      {
        sequence: 2,
        role: 'assistant',
        content: 'When is the race? And how much do you run?',
        producingRunId: 'r1',
        createdAt: at(5),
      },
      {
        sequence: 3,
        role: 'user',
        content: 'Start 2026-10-12. Three runs, 22 km.',
        createdAt: at(8),
      },
      {
        sequence: 4,
        role: 'assistant',
        content: 'Saved. Which days?',
        producingRunId: 'r2',
        createdAt: at(20),
      },
      {
        sequence: 5,
        role: 'user',
        content: 'Please go ahead and create the agreed first four weeks of my plan.',
        createdAt: at(25),
      },
      {
        sequence: 6,
        role: 'assistant',
        content: 'Weeks total 22 km, 23 km.',
        producingRunId: 'r3',
        createdAt: at(60),
      },
    ],
    disclosures: [
      { sequence: 3, factIds: ['dates', 'training'] },
      { sequence: 5, factIds: [] },
    ],
    tools: [
      {
        at: at(10),
        runId: 'r2',
        operationId: 'a',
        name: 'update_plan_brief',
        status: 'started',
        input: { brief: brief({ unit: 'kilometres' }) },
      },
      {
        at: at(11),
        runId: 'r2',
        operationId: 'a',
        name: 'update_plan_brief',
        status: 'completed',
        elapsedMs: 20,
        result: { result: { brief: { editNumber: 2 } } },
      },
      {
        at: at(40),
        runId: 'r3',
        operationId: 'b',
        name: 'apply_schedule_changes',
        status: 'started',
        input: { blocks: [{}], weeks: [{}, {}], workouts: [{}, {}] },
      },
      {
        at: at(41),
        runId: 'r3',
        operationId: 'b',
        name: 'apply_schedule_changes',
        status: 'completed',
        elapsedMs: 50,
        result: { result: { findings: [] } },
      },
    ],
    snapshot: {
      runs: [
        {
          id: 'r1',
          status: 'completed',
          created_at: at(0),
          started_at: at(1),
          finished_at: at(5),
          input_tokens: 100,
          output_tokens: 10,
        },
        {
          id: 'r2',
          status: 'completed',
          created_at: at(8),
          started_at: at(9),
          finished_at: at(20),
          input_tokens: 200,
          output_tokens: 20,
        },
        {
          id: 'r3',
          status: 'completed',
          created_at: at(25),
          started_at: at(26),
          finished_at: at(60),
          input_tokens: 300,
          output_tokens: 30,
        },
      ],
      outputs: [],
    },
    plan: {
      header: { draft: { startDate: '2026-10-12', endDate: '2027-01-03' } },
      brief: { brief: brief({ unit: 'kilometres' }) },
      workouts: [
        {
          workout: {
            id: 'w1',
            scheduledDate: '2026-10-13',
            estimatedDistanceMetres: 6000,
            estimatedDurationSeconds: 2400,
          },
        },
        {
          workout: {
            id: 'w2',
            scheduledDate: '2026-10-14',
            estimatedDistanceMetres: 7000,
            estimatedDurationSeconds: 2700,
          },
        },
        {
          workout: {
            id: 'w3',
            scheduledDate: '2026-10-18',
            estimatedDistanceMetres: 9000,
            estimatedDurationSeconds: 6600,
          },
        },
      ],
      findings: [],
    },
    scenario,
    metrics: null,
    ...overrides,
  };
}

describe('analyzeSession', () => {
  it('joins coach turns to their trigger, reply and tools', () => {
    const session = analyzeSession(input());
    expect(
      session.turns.map((turn) => [
        turn.index,
        turn.triggerSequence,
        turn.replySequence,
        turn.tools.length,
      ]),
    ).toEqual([
      [1, 1, 2, 0],
      [2, 3, 4, 1],
      [3, 5, 6, 1],
    ]);
    expect(session.turns[0]?.questions).toBe(2);
    expect(session.stats).toMatchObject({
      athleteTurns: 3,
      questions: 3,
      multiQuestionTurns: 1,
      nudges: 1,
      turnsToPlan: 3,
      briefEdits: 1,
    });
  });

  it('classifies what the coach recorded against what the athlete said', () => {
    const session = analyzeSession(input());
    const status = Object.fromEntries(
      session.beliefs.map((belief) => [belief.field, belief.status]),
    );
    expect(status).toMatchObject({
      weeklyDistance: 'match',
      // Recorded in turn 2 but the athlete never stated a unit or availability.
      unit: 'assumed',
      weekdays: 'assumed',
      fitness: 'missing',
      goal: 'review',
    });
  });

  it('flags wrong values, nudges, workouts on unavailable days and time-limit breaches', () => {
    const wrong = input();
    const plan = wrong.plan as { brief: { brief: unknown } };
    plan.brief.brief = brief({ weekly: 30000 });
    const kinds = analyzeSession(wrong).flags.map((flag) => flag.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'mismatch:weeklyDistance',
        'nudge',
        'multi-question',
        'unavailable-day',
        'over-limit',
        'undisclosed:fitness',
      ]),
    );
  });

  it('reports an early stop without cascading discovery flags', () => {
    const kinds = analyzeSession(input({ stopReason: 'PROVIDER_ERROR', plan: null })).flags.map(
      (flag) => flag.kind,
    );
    expect(
      kinds.some((kind) => kind.startsWith('undisclosed:') || kind.startsWith('missing:')),
    ).toBe(false);
  });

  it('copes with an interrupted run that has no snapshot or plan', () => {
    const session = analyzeSession(
      input({
        snapshot: null,
        plan: null,
        tools: [],
        metrics: { coachUsage: [{ runId: 'r1', inputTokens: 5, outputTokens: 1 }] },
      }),
    );
    expect(session.turns).toHaveLength(1);
    expect(session.fitness).toBeNull();
    expect(session.stats?.turnsToPlan).toBeNull();
  });
});

describe('helpers', () => {
  it('counts questions that end sentences or bold spans', () => {
    expect(countQuestions('**What is the date?** Also, how far?')).toBe(2);
    expect(countQuestions('See https://example.com/?q=1 for details.')).toBe(0);
  });

  it('parses per-weekday time limits from availability text', () => {
    expect(parseDayLimits(scenario.facts.availability)).toEqual({ '2': 60, '4': 60, '7': 100 });
    expect(parseDayLimits('Any day works.')).toEqual({});
  });
});

describe('human reviews', () => {
  it('keeps only known verdicts, criteria and bounded tags', () => {
    const review = parseReview({
      verdict: 'great',
      criteria: { progression: 'disagree', bogus: 'agree' },
      tags: [' a ', 'a', 3],
      notes: 'ok',
    });
    expect(review).toMatchObject({
      verdict: null,
      criteria: { progression: 'disagree' },
      tags: ['a'],
      notes: 'ok',
    });
    expect(parseReview('nope')).toBeNull();
  });

  it('writes beside the run and refuses unknown runs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'evals-review-'));
    try {
      const run = path.join(root, 'run-1');
      await mkdir(run);
      await writeFile(
        path.join(run, 'manifest.json'),
        JSON.stringify({ startedAt: '2026-10-09T00:00:00Z' }),
      );
      const saved = await saveReview(root, 'run-1', { verdict: 'fit', tags: ['exemplary'] });
      expect(saved).toMatchObject({ verdict: 'fit', tags: ['exemplary'] });
      expect(JSON.parse(await readFile(path.join(run, 'human-review.json'), 'utf8'))).toMatchObject(
        { verdict: 'fit' },
      );
      expect(await saveReview(root, 'missing', { verdict: 'fit' })).toBe('not_found');
      expect(await saveReview(root, '../escape', { verdict: 'fit' })).toBe('not_found');
      expect(await saveReview(root, 'run-1', 'not an object')).toBe('invalid');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
