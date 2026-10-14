import {
  CRITERIA,
  type CalibrationAttempt,
  type CalibrationFixture,
  type CalibrationJudgment,
  type CalibrationRun,
  type CriterionResult,
  type RunDetail,
  type RunSummary,
  type Verdict,
} from '../types';

// Synthetic comparison data so the charts can be judged before several coach
// models have actually been benchmarked. Every generated record is flagged
// `demo: true` and is rendered with a hollow marker and a banner.

const CHECK_IDS = [
  'plan_saved',
  'required_discovery',
  'plan_dates',
  'coverage',
  'structure',
  'running_only',
  'baseline',
  'available_days',
  'daily_limit',
  'weekly_frequency',
  'prescriptions',
  'calibration_evidence',
];

interface DemoBehaviour {
  /** Chance each required fact is discovered. */
  discovery: number;
  assumptionRate: number;
  nudgeRate: number;
  multiQuestionRate: number;
  turns: number;
}

interface DemoVariant {
  model: string;
  reasoning: string;
  prompt: string;
  promptHash: string;
  quality: number;
  tokens: number;
  minutes: number;
  trials: number;
  behaviour: DemoBehaviour;
}

const V3 = { prompt: 'multisport-coach-v3', promptHash: 'e3fd1d1' };
const V4 = { prompt: 'multisport-coach-v4-draft', promptHash: '9f2c1ab' };
const BASE: DemoBehaviour = {
  discovery: 0.94,
  assumptionRate: 0.45,
  nudgeRate: 0.2,
  multiQuestionRate: 0.25,
  turns: 6,
};

interface DemoModel {
  model: string;
  quality: number;
  tokens: number;
  minutes: number;
  levels: string[];
  behaviour?: Partial<DemoBehaviour>;
}

const MODELS: DemoModel[] = [
  {
    model: 'gpt-6.1-sol',
    quality: 0.86,
    tokens: 230_000,
    minutes: 5.5,
    levels: ['low', 'medium', 'high'],
  },
  {
    model: 'gpt-6-luna',
    quality: 0.7,
    tokens: 150_000,
    minutes: 3,
    levels: ['low', 'medium', 'high'],
    behaviour: { discovery: 0.82, nudgeRate: 0.4 },
  },
  {
    model: 'claude-opus-5-5',
    quality: 0.93,
    tokens: 290_000,
    minutes: 8,
    levels: ['low', 'medium', 'high'],
    behaviour: { assumptionRate: 0.25, turns: 7 },
  },
  {
    model: 'claude-sonnet-5-5',
    quality: 0.88,
    tokens: 220_000,
    minutes: 5,
    levels: ['low', 'medium', 'high'],
  },
  {
    model: 'claude-haiku-4-5',
    quality: 0.74,
    tokens: 170_000,
    minutes: 2.5,
    levels: ['medium'],
    behaviour: { multiQuestionRate: 0.5, turns: 4 },
  },
  {
    model: 'gemini-4-argon',
    quality: 0.82,
    tokens: 260_000,
    minutes: 6.5,
    levels: ['medium', 'high'],
  },
];

const LEVEL_EFFECT: Record<string, { quality: number; tokens: number; time: number }> = {
  low: { quality: -0.07, tokens: 0.65, time: 0.7 },
  medium: { quality: 0, tokens: 1, time: 1 },
  high: { quality: 0.05, tokens: 1.6, time: 1.55 },
};

const VARIANTS: DemoVariant[] = [
  ...MODELS.flatMap((model) =>
    model.levels.map((reasoning) => {
      const effect = LEVEL_EFFECT[reasoning] ?? { quality: 0, tokens: 1, time: 1 };
      return {
        model: model.model,
        reasoning,
        ...V3,
        quality: model.quality + effect.quality,
        tokens: model.tokens * effect.tokens,
        minutes: model.minutes * effect.time,
        trials: model.model === 'gpt-6.1-sol' && reasoning === 'medium' ? 8 : 4,
        behaviour: { ...BASE, ...model.behaviour },
      };
    }),
  ),
  // A candidate prompt for the current coach: asks one question at a time and
  // confirms the goal before recording it.
  {
    model: 'gpt-6.1-sol',
    reasoning: 'medium',
    ...V4,
    quality: 0.91,
    tokens: 210_000,
    minutes: 4.6,
    trials: 10,
    behaviour: {
      discovery: 0.98,
      assumptionRate: 0.08,
      nudgeRate: 0.05,
      multiQuestionRate: 0.05,
      turns: 6,
    },
  },
];

const FACTS = [
  'goal',
  'dates',
  'training',
  'frequency',
  'availability',
  'fitness',
  'constraints',
  'methodology',
  'horizon',
];
const REQUIRED = ['dates', 'training', 'frequency', 'availability', 'fitness'];

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function demoConversation(behaviour: DemoBehaviour, crashed: boolean, next: () => number) {
  const athleteTurns = crashed ? 2 : Math.max(3, behaviour.turns + Math.floor(next() * 3) - 1);
  const coachTurns = athleteTurns;
  const multi = !crashed && next() < behaviour.multiQuestionRate ? 1 + Math.floor(next() * 2) : 0;
  const disclosed = crashed
    ? ['dates']
    : FACTS.filter((fact) =>
        REQUIRED.includes(fact) ? next() < behaviour.discovery : next() < 0.45,
      );
  const assumptions = crashed ? 0 : next() < behaviour.assumptionRate ? (next() < 0.35 ? 2 : 1) : 0;
  const nudges = !crashed && next() < behaviour.nudgeRate ? 1 : 0;
  const unanswerable = !crashed && next() < 0.15 ? 1 : 0;
  const flags: RunSummary['flags'] = [];
  const add = (kind: string, kindLabel: string, severity: 'critical' | 'warning' | 'info') =>
    flags.push({
      id: kind,
      kind,
      kindLabel,
      severity,
      label: kindLabel,
      detail: 'Synthetic demo flag.',
      ref: null,
    });
  for (const fact of REQUIRED)
    if (!crashed && !disclosed.includes(fact))
      add(`undisclosed:${fact}`, `Never learned ${fact}`, 'critical');
  if (assumptions >= 1) add('assumed:goal', 'Goal assumed', 'warning');
  if (assumptions >= 2) add('assumed:unit', 'Distance unit assumed', 'info');
  if (nudges) add('nudge', 'Athlete had to ask for the plan', 'warning');
  if (multi) add('multi-question', 'Several questions in one message', 'info');
  if (unanswerable) add('unanswerable', 'Asked an unanswerable question', 'info');
  return {
    stats: {
      athleteTurns,
      coachTurns,
      questions: Math.max(0, coachTurns - 1) + multi,
      maxQuestionsPerTurn: multi ? 2 + Math.floor(next() * 2) : 1,
      multiQuestionTurns: multi,
      unanswerable,
      nudges,
      factsDisclosed: disclosed,
      factsAvailable: FACTS,
      requiredFacts: REQUIRED,
      repeatedFacts: next() < 0.1 ? 1 : 0,
      turnsToPlan: crashed ? null : athleteTurns,
      timeToPlanMs: crashed ? null : (90 + next() * 160) * 1000,
      briefEdits: crashed ? 0 : 3 + Math.floor(next() * 3),
      scheduleWrites: crashed ? 0 : 1,
      validations: crashed ? 0 : 1,
      lookups: crashed ? 0 : 2 + Math.floor(next() * 3),
      beliefMismatches: 0,
      assumptions,
      medianTurnMs: (7 + next() * 8) * 1000,
      maxTurnMs: (60 + next() * 80) * 1000,
      medianFirstVisibleMs: (5 + next() * 6) * 1000,
      coachWords: 350 + Math.floor(next() * 400),
    },
    flags,
  };
}

export function demoRuns(now = Date.parse('2026-10-10T12:00:00Z')): RunSummary[] {
  const next = random(20261010);
  const runs: RunSummary[] = [];
  let sequence = 0;
  for (const variant of VARIANTS) {
    for (let trial = 0; trial < variant.trials; trial += 1) {
      sequence += 1;
      const passRate = Math.min(0.995, variant.quality + (next() - 0.5) * 0.08);
      const crashed = next() < 0.06;
      const checks = CHECK_IDS.map((id, index) => ({
        id,
        status: crashed
          ? index === 0
            ? 'fail'
            : 'skipped'
          : next() < passRate + 0.06
            ? 'pass'
            : 'fail',
      }));
      const criteria = crashed
        ? []
        : CRITERIA.map((criterion) => {
            const roll = next();
            const result: CriterionResult =
              roll < passRate
                ? 'pass'
                : roll < passRate + (1 - passRate) * 0.7
                  ? 'fail'
                  : 'uncertain';
            return { criterion, result };
          });
      const scored = crashed ? 1 : checks.length + criteria.length;
      const passed =
        checks.filter((check) => check.status === 'pass').length +
        criteria.filter((criterion) => criterion.result === 'pass').length;
      const verdict: Verdict = crashed
        ? 'incomplete'
        : passed === scored
          ? 'acceptable'
          : 'needs_revision';
      const tokens = variant.tokens * (0.8 + next() * 0.45);
      const startedAt = new Date(now - (sequence * 37 + next() * 30) * 60_000 * 4).toISOString();
      const conversation = demoConversation(variant.behaviour, crashed, next);
      runs.push({
        id: `demo-${variant.model}-${variant.reasoning}-${variant.promptHash}-${trial + 1}`,
        startedAt,
        durationMs: variant.minutes * (0.75 + next() * 0.5) * 60_000,
        scenarioId: trial % 2 === 0 ? 'running-improver' : 'hybrid-improver',
        scenarioVersion: 1,
        promptVersion: variant.prompt,
        promptHash: variant.promptHash,
        personaId: trial % 2 === 0 ? 'running-improver' : 'hybrid-improver',
        voiceId: 'persona',
        scenarioLabel: null,
        revision: 'demo000',
        workingTreeDirty: false,
        scripted: false,
        demo: true,
        coachModel: variant.model,
        reasoning: variant.reasoning,
        simulatorModel: 'gpt-6.1-sol',
        reviewerModel: 'gpt-6.1-sol',
        reviewerVersion: 'running-plan-v1',
        verdict,
        reviewerVerdict: crashed
          ? null
          : criteria.every((criterion) => criterion.result === 'pass')
            ? 'acceptable'
            : 'needs_revision',
        stopReason: crashed ? 'PROVIDER_ERROR' : 'completed',
        stage: `Assessment: ${verdict}`,
        checks: crashed ? checks.slice(0, 1) : checks,
        criteria,
        score: crashed ? 0 : passed / scored,
        tokens: {
          coachInput: Math.round(tokens * 0.96),
          coachOutput: Math.round(tokens * 0.04),
          evaluationInput: Math.round(14_000 + next() * 4000),
          evaluationOutput: Math.round(900 + next() * 300),
        },
        coachTurns: conversation.stats.coachTurns,
        athleteMessages: conversation.stats.athleteTurns,
        toolCalls: crashed ? 1 : 6 + Math.floor(next() * 8),
        toolFailures: next() < 0.1 ? 1 : 0,
        workoutCount: crashed ? 0 : 12,
        planTitle: crashed ? null : 'First half marathon — January 2027',
        conversation: conversation.stats,
        flags: conversation.flags,
        review: null,
      });
    }
  }
  return runs;
}

export function demoRunDetail(summary: RunSummary): RunDetail {
  return {
    ...summary,
    reviewSummary:
      'Demo run: synthetic scores generated in the browser to preview comparisons. No transcript, tool calls or saved plan exist for it.',
    reviewVerdict: summary.verdict,
    judgments: summary.criteria.map((criterion) => ({
      ...criterion,
      explanation: 'Synthetic demo judgement.',
      evidence: [],
    })),
    checkDetails: summary.checks.map((check) => ({ ...check, explanation: '', evidence: [] })),
    messages: [],
    turns: [],
    disclosures: [],
    beliefs: [],
    decisions: [],
    fitness: null,
    load: null,
    claims: [],
    prompts: [],
    highlights: [],
    progress: [],
    workouts: [],
    blocks: [],
    planStart: null,
    planEnd: null,
    facts: {},
    dates: {},
  };
}

function judge(
  fixture: CalibrationFixture,
  criterion: string,
  next: () => number,
): CriterionResult {
  const expected = fixture.expectedCriteria[criterion];
  const truth: CriterionResult = expected?.includes('fail') ? 'fail' : 'pass';
  const roll = next();
  if (roll < 0.82) return truth;
  if (roll < 0.92) return 'uncertain';
  return truth === 'pass' ? 'fail' : 'pass';
}

export function demoCalibration(fixtures: CalibrationFixture[]): CalibrationRun | null {
  if (fixtures.length === 0) return null;
  const next = random(4242);
  const repeat = 3;
  const attempts: CalibrationAttempt[] = [];
  for (const fixture of fixtures) {
    for (let repetition = 1; repetition <= repeat; repetition += 1) {
      const criteria = CRITERIA.map((criterion) => ({
        criterion,
        result: judge(fixture, criterion, next),
        explanation: 'Synthetic demo judgement.',
        evidence: [],
      }));
      const verdict = criteria.every((criterion) => criterion.result === 'pass')
        ? 'acceptable'
        : fixture.expectedVerdicts.includes('incomplete')
          ? 'incomplete'
          : 'needs_revision';
      const judgments: CalibrationJudgment[] = Object.entries(fixture.expectedCriteria).map(
        ([criterion, expected]) => {
          const actual =
            criteria.find((item) => item.criterion === criterion)?.result ?? 'uncertain';
          const matched = expected.includes(actual);
          return {
            criterion,
            expected,
            actual,
            matched,
            missedDefect: expected.includes('fail') && actual === 'pass',
            falseAlarm:
              expected.includes('pass') && !expected.includes('fail') && actual !== 'pass',
          };
        },
      );
      attempts.push({
        fixtureId: fixture.id,
        repetition,
        status: 'completed',
        elapsedMs: 9000 + next() * 14000,
        verdict,
        summary: 'Synthetic demo review.',
        criteria,
        verdictMatched: fixture.expectedVerdicts.includes(verdict),
        badPlanAccepted:
          verdict === 'acceptable' && !fixture.expectedVerdicts.includes('acceptable'),
        judgments,
        inputTokens: Math.round(9000 + next() * 3000),
        outputTokens: Math.round(800 + next() * 400),
      });
    }
  }

  const all = attempts.flatMap((attempt) => attempt.judgments);
  const criterionResults = CRITERIA.map((criterion) => {
    const rows = all.filter((judgment) => judgment.criterion === criterion);
    return {
      criterion,
      labeled: rows.length,
      matched: rows.filter((row) => row.matched).length,
      missedDefects: rows.filter((row) => row.missedDefect).length,
      falseAlarms: rows.filter((row) => row.falseAlarm).length,
    };
  });
  const stability = fixtures.map((fixture) => {
    const signatures = attempts
      .filter((attempt) => attempt.fixtureId === fixture.id)
      .map((attempt) => `${attempt.verdict}:${attempt.criteria.map((c) => c.result).join(',')}`);
    return {
      fixtureId: fixture.id,
      consistency: new Set(signatures).size === 1 ? 'stable' : 'unstable',
    };
  });

  return {
    id: 'demo-calibration-live-reviewer',
    startedAt: '2026-10-10T09:00:00.000Z',
    scripted: false,
    demo: true,
    reviewerModel: 'gpt-6.1-sol',
    reviewerVersion: 'running-plan-v1',
    split: 'all',
    repeat,
    revision: 'demo000',
    workingTreeDirty: false,
    stage: 'completed',
    requested: attempts.length,
    attempted: attempts.length,
    completed: attempts.length,
    errors: 0,
    verdictMatches: attempts.filter((attempt) => attempt.verdictMatched).length,
    badPlansAccepted: attempts.filter((attempt) => attempt.badPlanAccepted).length,
    labeledJudgments: all.length,
    judgmentMatches: all.filter((judgment) => judgment.matched).length,
    missedDefects: all.filter((judgment) => judgment.missedDefect).length,
    falseAlarms: all.filter((judgment) => judgment.falseAlarm).length,
    criterionResults,
    stability,
    fixtures,
    attempts,
  };
}
