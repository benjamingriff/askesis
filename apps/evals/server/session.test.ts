import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { saveReview } from './results';
import { parseHighlights, parseReview } from './review';
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

  it('analyses tool payloads larger than the inspector clip', () => {
    const large = input();
    const call = (large.tools[0] as { input: { brief: Record<string, unknown> } }).input;
    call.brief.context = 'x'.repeat(18_000);
    const session = analyzeSession(large);
    const weekly = session.beliefs.find((belief) => belief.field === 'weeklyDistance');
    expect(weekly).toMatchObject({ status: 'match', recordedInTurn: 2 });
    expect(
      session.decisions.find((decision) => decision.tool === 'update_plan_brief')?.changes.length,
    ).toBeGreaterThan(0);
    // The browser copy is still clipped.
    expect(session.turns[1]?.tools[0]?.input).toMatchObject({ truncated: true });
  });

  it('attributes plan dates to the edit that set them', () => {
    const at = (seconds: number) => new Date(Date.UTC(2026, 9, 9, 14, 0, seconds)).toISOString();
    const dated = input({
      tools: [
        {
          at: at(2),
          runId: 'r1',
          operationId: 'd',
          name: 'create_plan_draft',
          status: 'started',
          input: { displayName: 'Plan', startDate: null, endDate: null },
        },
        {
          at: at(3),
          runId: 'r1',
          operationId: 'd',
          name: 'create_plan_draft',
          status: 'completed',
          result: { result: {} },
        },
        {
          at: at(10),
          runId: 'r2',
          operationId: 'e',
          name: 'update_plan_brief',
          status: 'started',
          input: { brief: brief({}), startDate: '2026-10-12', endDate: '2027-01-03' },
        },
        {
          at: at(11),
          runId: 'r2',
          operationId: 'e',
          name: 'update_plan_brief',
          status: 'completed',
          result: { result: { brief: { editNumber: 2 } } },
        },
      ],
    });
    const datesRow = analyzeSession(dated).beliefs.find((belief) => belief.field === 'dates');
    expect(datesRow).toMatchObject({ recordedInTurn: 2, disclosedAt: 3, status: 'match' });
  });

  it('does not raise discovery flags for an unfinished run', () => {
    const kinds = analyzeSession(input({ finished: false, plan: null })).flags.map(
      (flag) => flag.kind,
    );
    expect(
      kinds.some((kind) => kind.startsWith('undisclosed:') || kind.startsWith('missing:')),
    ).toBe(false);
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

describe('dataset belief comparisons', () => {
  const sports = [
    {
      sport: 'run',
      currentSessions: 3,
      desiredSessions: 3,
      weeklyDistanceMetres: 22000,
      longestDistanceMetres: 9000,
    },
    {
      sport: 'cycle',
      currentSessions: 3,
      desiredSessions: 3,
      weeklyDurationSeconds: 14400,
      longestDurationSeconds: 7200,
    },
    {
      sport: 'swim',
      currentSessions: 2,
      desiredSessions: 2,
      weeklyDistanceMetres: 2200,
      longestDistanceMetres: 1200,
    },
  ];
  const recorded = (sport: Record<string, unknown>) => ({
    sport: sport.sport,
    currentSessions: {
      status: sport.currentSessions === null ? 'unknown' : 'known',
      value: sport.currentSessions,
    },
    desiredSessions: sport.desiredSessions,
    ...Object.fromEntries(
      [
        ['weeklyDistance', 'weeklyDistanceMetres'],
        ['longestDistance', 'longestDistanceMetres'],
        ['weeklyDuration', 'weeklyDurationSeconds'],
        ['longestDuration', 'longestDurationSeconds'],
      ]
        .filter(([, key]) => key! in sport)
        .map(([field, key]) => [field, { status: 'known', value: sport[key!] }]),
    ),
  });
  const datasetInput = (own: Record<string, unknown>[]) => {
    const source = input();
    source.scenario = {
      ...scenario,
      edition: 'v1',
      persona: { sports: own, availability: [] },
      dates: { startDate: '2026-10-12', endDate: '2027-01-03' },
      prescriptionWeeks: 4,
      expectations: { requiredDiscovery: ['training', 'frequency'] },
      evidence: [],
    };
    const saved = { ...brief({}), sports: own.map(recorded) };
    source.plan = { ...source.plan, brief: { brief: saved } };
    source.tools[0]!.input = { brief: saved };
    return source;
  };
  it('compares every triathlon baseline and each measured performance system', () => {
    const source = datasetInput(sports);
    const evidence = [
      {
        system: 'run_pace',
        input: { method: 'race_result', distanceMetres: 5000, durationSeconds: 1500 },
        observedOn: '2026-09-25',
      },
      { system: 'cycle_power', input: { method: 'ftp', watts: 200 }, observedOn: '2026-09-26' },
      {
        system: 'swim_pace',
        input: { method: 'css_pace', secondsPer100Metres: 120 },
        observedOn: '2026-09-27',
      },
    ];
    source.scenario!.evidence = evidence;
    source.tools.push(
      ...evidence.flatMap((entry, index) =>
        ['started', 'completed'].map((status) => ({
          operationId: `fitness-${index}`,
          runId: 'r2',
          at: '2026-10-09T14:00:12Z',
          name: 'record_performance',
          status,
          input: { ...entry, provenance: 'user_supplied' },
        })),
      ),
    );
    const result = analyzeSession(source);
    expect(result.beliefs.find((row) => row.field === 'run.desiredSessions')).toMatchObject({
      expected: '3 sessions',
      recorded: '3 sessions',
    });
    expect(result.beliefs.find((row) => row.field === 'swim.currentSessions')).toMatchObject({
      expected: '2 sessions',
      recorded: '2 sessions',
    });
    expect(result.beliefs.find((row) => row.field === 'cycle.weeklyDuration')?.status).toBe(
      'match',
    );
    expect(
      result.beliefs.filter((row) => row.field.startsWith('fitness.')).map((row) => row.status),
    ).toEqual(['assumed', 'assumed', 'assumed']);
    expect(result.beliefs.some((row) => row.status === 'mismatch')).toBe(false);
    expect(
      result.decisions.flatMap((entry) => entry.changes).map((entry) => entry.field),
    ).toContain('swim current sessions/week');
    // A later wrong swim baseline must still produce a real, sport-specific mismatch.
    const saved = source.plan!.brief as { brief: { sports: Record<string, unknown>[] } };
    saved.brief.sports[2]!.currentSessions = { status: 'known', value: 3 };
    expect(
      analyzeSession(source).beliefs.find((row) => row.field === 'swim.currentSessions')?.status,
    ).toBe('mismatch');
  });
  it.each([0, null])('keeps strength sessions %s distinct from a running baseline', (sessions) => {
    const result = analyzeSession(
      datasetInput([{ sport: 'strength', currentSessions: sessions, desiredSessions: 2 }]),
    );
    expect(result.beliefs.find((row) => row.field === 'strength.currentSessions')).toMatchObject({
      status: 'match',
      expected: sessions === null ? 'unknown' : '0 sessions',
    });
    expect(
      result.beliefs.some(
        (row) => row.field.startsWith('fitness') || row.field.includes('Distance'),
      ),
    ).toBe(false);
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

describe('turn order and simulated athlete actions', () => {
  it('orders interim text and tool calls by when they happened', () => {
    const at = (seconds: number) => new Date(Date.UTC(2026, 9, 9, 14, 0, seconds)).toISOString();
    const base = input();
    const session = analyzeSession(
      input({
        snapshot: {
          ...base.snapshot,
          outputs: [
            {
              runId: 'r3',
              items: [
                { itemId: 'a', position: 0, content: 'Let me save that.', startedAt: at(30) },
                { itemId: 'b', position: 1, content: 'Checked it.', startedAt: at(45) },
                { itemId: 'c', position: 2, content: 'Weeks total 22 km, 23 km.', isFinal: true },
              ],
            },
          ],
        },
      }),
    );
    const turn = session.turns.find((entry) => entry.runId === 'r3')!;
    expect(turn.stepsOrdered).toBe(true);
    expect(
      turn.steps.map((step) => (step.kind === 'text' ? step.content : step.operationId)),
    ).toEqual(['Let me save that.', 'b', 'Checked it.']);
  });

  it('uses the recorded intent and voice instead of fixed phrases', () => {
    const session = analyzeSession(
      input({
        actions: [
          {
            sequence: 5,
            intent: 'generate',
            voice: { id: 'terse', status: 'voiced', attempts: [{}] },
            authored: 'Please go ahead and create the agreed first 4 weeks of my plan.',
          },
        ],
        messages: input().messages.map((message) =>
          message.sequence === 5 ? { ...message, content: 'Just build it.' } : message,
        ),
      }),
    );
    const disclosure = session.disclosures.find((entry) => entry.sequence === 5)!;
    expect(disclosure.kind).toBe('nudge');
    expect(disclosure.voice).toMatchObject({ id: 'terse', status: 'voiced', attempts: 1 });
    expect(session.stats?.nudges).toBe(1);
  });
});

describe('communication review', () => {
  it('keeps whole 1–5 ratings and valid phrase highlights only', () => {
    expect(
      parseReview({ communication: { tone: 4, clarity: 6, adaptation: 2.5 } })?.communication,
    ).toEqual({ tone: 4, clarity: null, adaptation: null });
    expect(
      parseHighlights([
        { sequence: 4, quote: '  Absolutely!  ', tag: 'Sycophantic' },
        { sequence: 'x', quote: 'no', tag: 'jargon' },
        { sequence: 6, quote: '', tag: 'unclear' },
      ])?.map(({ sequence, quote, tag }) => ({ sequence, quote, tag })),
    ).toEqual([{ sequence: 4, quote: 'Absolutely!', tag: 'sycophantic' }]);
    expect(parseHighlights({})).toBeNull();
  });
});
