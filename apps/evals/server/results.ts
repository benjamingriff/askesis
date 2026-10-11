import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CalibrationAttempt,
  CalibrationFixture,
  CalibrationJudgment,
  CalibrationRun,
  CheckOutcome,
  CriterionAgreement,
  CriterionJudgment,
  CriterionResult,
  PlanBlock,
  PlannedWorkout,
  ResultsIndex,
  RunDetail,
  RunSummary,
  Verdict,
} from '../src/types';
import {
  asArray,
  asNumber,
  asString,
  asStrings,
  isObject,
  readJson,
  readJsonLines,
  type Json,
} from './json';
import { parseReview, REVIEW_FILE } from './review';
import { analyzeSession, type Session } from './session';

// Artifacts are private local files written by `pnpm bench`. Everything is read
// defensively: older or interrupted runs omit files, and nothing here should
// throw because one directory is incomplete.

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const VERDICTS = new Set<Verdict>([
  'acceptable',
  'needs_revision',
  'incomplete',
  'assessment_unavailable',
]);

function toVerdict(value: unknown): Verdict {
  return typeof value === 'string' && VERDICTS.has(value as Verdict)
    ? (value as Verdict)
    : 'running';
}

function toResult(value: unknown): CriterionResult {
  return value === 'pass' || value === 'fail' ? value : 'uncertain';
}

function toJudgments(value: unknown): CriterionJudgment[] {
  return asArray(value)
    .filter(isObject)
    .map((item) => ({
      criterion: asString(item.criterion) ?? 'unknown',
      result: toResult(item.result),
      explanation: asString(item.explanation) ?? '',
      evidence: asStrings(item.evidence),
    }));
}

function toChecks(value: unknown): CheckOutcome[] {
  return asArray(value)
    .filter(isObject)
    .map((item) => ({
      id: asString(item.id) ?? 'unknown',
      status: asString(item.status) ?? 'unknown',
      explanation: asString(item.explanation) ?? '',
      evidence: asStrings(item.evidence),
    }));
}

function sumUsage(entries: unknown[], key: 'inputTokens' | 'outputTokens'): number {
  let total = 0;
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const usage = isObject(entry.usage) ? entry.usage : entry;
    total += asNumber(usage[key]) ?? 0;
  }
  return total;
}

function shortHash(value: unknown): string | null {
  const text = asString(value);
  return text === null ? null : text.slice(0, 7);
}

export function resolveId(root: string, id: string): string | null {
  if (!RUN_ID.test(id)) return null;
  const resolved = path.resolve(root, id);
  return path.dirname(resolved) === path.resolve(root) ? resolved : null;
}

async function listDirectories(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && RUN_ID.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

interface RunFiles {
  manifest: Json;
  configuration: Json;
  assessment: Json | null;
  state: Json | null;
  metrics: Json | null;
  conversation: Json[];
  progress: Json[];
  tools: Json[];
  plan: Json | null;
  scenario: Json | null;
  snapshot: Json | null;
  disclosures: Json[];
  review: unknown;
}

async function readRunFiles(directory: string): Promise<RunFiles | null> {
  const manifest = await readJson(path.join(directory, 'manifest.json'));
  if (!isObject(manifest)) return null;
  const [
    configuration,
    assessment,
    state,
    metrics,
    conversation,
    progress,
    tools,
    plan,
    scenario,
    snapshot,
    disclosures,
    review,
  ] = await Promise.all([
    readJson(path.join(directory, 'configuration.json')),
    readJson(path.join(directory, 'assessment.json')),
    readJson(path.join(directory, 'state.json')),
    readJson(path.join(directory, 'metrics.json')),
    readJson(path.join(directory, 'conversation.json')),
    readJsonLines(path.join(directory, 'progress.jsonl')),
    readJsonLines(path.join(directory, 'tool-trace.jsonl')),
    readJson(path.join(directory, 'plan.json')),
    readJson(path.join(directory, 'scenario.json')),
    readJson(path.join(directory, 'snapshot.json')),
    readJson(path.join(directory, 'disclosures.json')),
    readJson(path.join(directory, REVIEW_FILE)),
  ]);
  return {
    manifest,
    configuration: isObject(configuration) ? configuration : {},
    assessment: isObject(assessment) ? assessment : null,
    state: isObject(state) ? state : null,
    metrics: isObject(metrics) ? metrics : null,
    conversation: asArray(conversation).filter(isObject),
    progress,
    tools,
    plan: isObject(plan) ? plan : null,
    scenario: isObject(scenario) ? scenario : null,
    snapshot: isObject(snapshot) ? snapshot : null,
    disclosures: asArray(disclosures).filter(isObject),
    review,
  };
}

function sessionOf(files: RunFiles): Session {
  const fromSnapshot = asArray(files.snapshot?.messages).filter(isObject);
  return analyzeSession({
    messages: files.conversation.length > 0 ? files.conversation : fromSnapshot,
    tools: files.tools,
    snapshot: files.snapshot,
    disclosures: files.disclosures,
    plan: files.plan,
    scenario: files.scenario,
    metrics: files.metrics,
    stopReason: asString(files.assessment?.stopReason),
    finished: files.assessment !== null,
  });
}

function durationOf(progress: Json[]): number | null {
  const times = progress
    .map((row) => Date.parse(asString(row.at) ?? ''))
    .filter((time) => Number.isFinite(time));
  if (times.length < 2) return null;
  return Math.max(...times) - Math.min(...times);
}

function summarizeRun(id: string, files: RunFiles, session: Session): RunSummary {
  const { manifest, configuration, assessment, state, metrics } = files;
  const coach = isObject(configuration.coach) ? configuration.coach : {};
  const review = assessment && isObject(assessment.review) ? assessment.review : null;
  const checks = toChecks(assessment?.checks);
  const criteria = toJudgments(review?.criteria);
  const scored = checks.length + criteria.length;
  const passed =
    checks.filter((check) => check.status === 'pass').length +
    criteria.filter((criterion) => criterion.result === 'pass').length;
  const coachUsage = asArray(metrics?.coachUsage);
  const evaluationUsage = asArray(metrics?.evaluationUsage);
  const completedTools = files.tools.filter((row) => row.status === 'completed').length;
  const failedTools = files.tools.filter((row) => row.status === 'failed').length;
  const header = files.plan && isObject(files.plan.header) ? files.plan.header : null;

  return {
    id,
    startedAt: asString(manifest.startedAt) ?? '',
    durationMs: durationOf(files.progress),
    scenarioId: asString(manifest.scenarioId) ?? 'unknown',
    scenarioVersion: asNumber(manifest.scenarioVersion),
    promptVersion: asString(manifest.promptVersion),
    promptHash: shortHash(manifest.promptHash),
    revision: shortHash(manifest.revision),
    workingTreeDirty: manifest.workingTreeDirty === true,
    scripted: manifest.scripted === true,
    demo: false,
    coachModel: asString(coach.model) ?? 'unknown',
    reasoning: asString(coach.reasoning) ?? 'default',
    simulatorModel: asString(configuration.simulatorModel),
    reviewerModel: asString(configuration.reviewerModel),
    reviewerVersion: asString(manifest.reviewerVersion),
    verdict: toVerdict(assessment?.verdict),
    reviewerVerdict: asString(review?.verdict),
    stopReason: asString(assessment?.stopReason),
    stage: asString(state?.stage),
    checks: checks.map(({ id: checkId, status }) => ({ id: checkId, status })),
    criteria: criteria.map(({ criterion, result }) => ({ criterion, result })),
    score: assessment && scored > 0 ? passed / scored : null,
    tokens: {
      coachInput: sumUsage(coachUsage, 'inputTokens'),
      coachOutput: sumUsage(coachUsage, 'outputTokens'),
      evaluationInput: sumUsage(evaluationUsage, 'inputTokens'),
      evaluationOutput: sumUsage(evaluationUsage, 'outputTokens'),
    },
    coachTurns: coachUsage.length,
    athleteMessages: files.conversation.filter((message) => message.role === 'user').length,
    toolCalls: completedTools + failedTools,
    toolFailures: failedTools,
    workoutCount: asArray(files.plan?.workouts).length,
    planTitle: asString(header?.displayName),
    conversation: session.stats,
    flags: session.flags,
    review: files.review === null ? null : parseReview(files.review),
  };
}

function planWorkouts(plan: Json | null): PlannedWorkout[] {
  return asArray(plan?.workouts)
    .filter(isObject)
    .map((entry) => {
      const workout = isObject(entry.workout) ? entry.workout : {};
      const prescription = isObject(entry.prescription) ? entry.prescription : {};
      return {
        id: asString(workout.id) ?? '',
        date: asString(workout.scheduledDate) ?? '',
        weekNumber: asNumber(workout.weekNumber),
        title: asString(workout.title) ?? 'Workout',
        discipline: asString(workout.discipline) ?? 'run',
        distanceMetres: asNumber(workout.estimatedDistanceMetres),
        durationSeconds: asNumber(workout.estimatedDurationSeconds),
        instructions: asString(prescription.instructions),
      };
    })
    .filter((workout) => workout.date !== '')
    .sort((a, b) => a.date.localeCompare(b.date));
}

function planBlocks(plan: Json | null): PlanBlock[] {
  return asArray(plan?.blocks)
    .filter(isObject)
    .map((block) => ({
      title: asString(block.title) ?? 'Block',
      phase: asString(block.phase),
      startDate: asString(block.startDate) ?? '',
      endDate: asString(block.endDate) ?? '',
      description: asString(block.description),
    }));
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

export async function loadRunDetail(root: string, id: string): Promise<RunDetail | null> {
  const directory = resolveId(root, id);
  if (directory === null || id.startsWith('calibration-')) return null;
  const files = await readRunFiles(directory);
  if (files === null) return null;
  const session = sessionOf(files);
  const summary = summarizeRun(id, files, session);
  const review =
    files.assessment && isObject(files.assessment.review) ? files.assessment.review : null;
  const header = files.plan && isObject(files.plan.header) ? files.plan.header : null;
  const draft = header && isObject(header.draft) ? header.draft : null;

  return {
    ...summary,
    reviewSummary: asString(review?.summary),
    reviewVerdict: asString(review?.verdict),
    judgments: toJudgments(review?.criteria),
    checkDetails: toChecks(files.assessment?.checks),
    messages: session.messages,
    turns: session.turns,
    disclosures: session.disclosures,
    beliefs: session.beliefs,
    decisions: session.decisions,
    fitness: session.fitness,
    claims: session.claims,
    progress: files.progress.map((row) => ({
      at: asString(row.at) ?? '',
      stage: asString(row.stage) ?? '',
    })),
    workouts: planWorkouts(files.plan),
    blocks: planBlocks(files.plan),
    planStart: asString(draft?.startDate),
    planEnd: asString(draft?.endDate),
    facts: stringRecord(files.scenario?.facts),
    dates: stringRecord(files.manifest.dates),
  };
}

/** Writes a human review beside the run's artifacts. */
export async function saveReview(
  root: string,
  id: string,
  payload: unknown,
): Promise<RunSummary['review'] | 'not_found' | 'invalid'> {
  const directory = resolveId(root, id);
  if (directory === null || id.startsWith('calibration-')) return 'not_found';
  if (!isObject(await readJson(path.join(directory, 'manifest.json')))) return 'not_found';
  const review = parseReview(isObject(payload) ? { ...payload, updatedAt: undefined } : payload);
  if (review === null) return 'invalid';
  await writeFile(path.join(directory, REVIEW_FILE), `${JSON.stringify(review, null, 2)}\n`, {
    mode: 0o600,
  });
  summaryCache.delete(directory);
  return review;
}

function toCalibrationJudgments(value: unknown): CalibrationJudgment[] {
  return asArray(value)
    .filter(isObject)
    .map((item) => ({
      criterion: asString(item.criterion) ?? 'unknown',
      expected: asStrings(item.expected),
      actual: asString(item.actual) ?? 'unknown',
      matched: item.matched === true,
      missedDefect: item.missedDefect === true,
      falseAlarm: item.falseAlarm === true,
    }));
}

function toAttempt(value: Json): CalibrationAttempt {
  const review = isObject(value.review) ? value.review : null;
  const score = isObject(value.score) ? value.score : null;
  const usage = isObject(value.usage) ? value.usage : {};
  return {
    fixtureId: asString(value.fixtureId) ?? 'unknown',
    repetition: asNumber(value.repetition) ?? 1,
    status: asString(value.status) ?? 'unknown',
    elapsedMs: asNumber(value.elapsedMs),
    verdict: asString(review?.verdict),
    summary: asString(review?.summary),
    criteria: toJudgments(review?.criteria),
    verdictMatched: typeof score?.verdictMatched === 'boolean' ? score.verdictMatched : null,
    badPlanAccepted: score?.badPlanAccepted === true,
    judgments: toCalibrationJudgments(score?.judgments),
    inputTokens: asNumber(usage.inputTokens) ?? 0,
    outputTokens: asNumber(usage.outputTokens) ?? 0,
  };
}

async function loadFixture(directory: string, entry: Json): Promise<CalibrationFixture> {
  const id = asString(entry.id) ?? 'unknown';
  const expected = RUN_ID.test(id)
    ? await readJson(path.join(directory, id, 'expected.json'))
    : null;
  const source = isObject(expected) ? expected : entry;
  const criteria = isObject(source.expectedCriteria) ? source.expectedCriteria : {};
  return {
    id,
    split: asString(source.split) ?? asString(entry.split) ?? 'development',
    description: asString(source.description) ?? '',
    expectedVerdicts: asStrings(source.expectedVerdicts),
    expectedCriteria: Object.fromEntries(
      Object.entries(criteria).map(([criterion, values]) => [criterion, asStrings(values)]),
    ),
  };
}

async function loadCalibration(root: string, id: string): Promise<CalibrationRun | null> {
  const directory = resolveId(root, id);
  if (directory === null) return null;
  const [manifest, results, state] = await Promise.all([
    readJson(path.join(directory, 'manifest.json')),
    readJson(path.join(directory, 'results.json')),
    readJson(path.join(directory, 'state.json')),
  ]);
  if (!isObject(manifest)) return null;
  const summary = isObject(results) && isObject(results.summary) ? results.summary : {};
  const fixtures = await Promise.all(
    asArray(manifest.fixtures)
      .filter(isObject)
      .map((entry) => loadFixture(directory, entry)),
  );
  const count = (key: string) => asNumber(summary[key]) ?? 0;
  const criterionResults: CriterionAgreement[] = asArray(summary.criterionResults)
    .filter(isObject)
    .map((item) => ({
      criterion: asString(item.criterion) ?? 'unknown',
      labeled: asNumber(item.labeled) ?? 0,
      matched: asNumber(item.matched) ?? 0,
      missedDefects: asNumber(item.missedDefects) ?? 0,
      falseAlarms: asNumber(item.falseAlarms) ?? 0,
    }));

  return {
    id,
    startedAt: asString(manifest.startedAt) ?? '',
    scripted: manifest.scripted === true,
    demo: false,
    reviewerModel: asString(manifest.reviewerModel),
    reviewerVersion: asString(manifest.reviewerVersion),
    split: asString(manifest.split) ?? 'development',
    repeat: asNumber(manifest.repeat) ?? 1,
    revision: shortHash(manifest.revision),
    workingTreeDirty: manifest.workingTreeDirty === true,
    stage: isObject(state) ? asString(state.stage) : null,
    requested: count('requested'),
    attempted: count('attempted'),
    completed: count('completed'),
    errors: count('errors'),
    verdictMatches: count('verdictMatches'),
    badPlansAccepted: count('badPlansAccepted'),
    labeledJudgments: count('labeledJudgments'),
    judgmentMatches: count('judgmentMatches'),
    missedDefects: count('missedDefects'),
    falseAlarms: count('falseAlarms'),
    criterionResults,
    stability: asArray(summary.stability)
      .filter(isObject)
      .map((item) => ({
        fixtureId: asString(item.fixtureId) ?? 'unknown',
        consistency: asString(item.consistency) ?? 'unknown',
      })),
    fixtures,
    attempts: isObject(results) ? asArray(results.attempts).filter(isObject).map(toAttempt) : [],
  };
}

// Summaries are recomputed only when a run's files change, so polling stays
// cheap as the results directory grows.
const summaryCache = new Map<string, { key: string; summary: RunSummary }>();

async function cacheKey(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const stamps = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const info = await stat(path.join(directory, entry.name)).catch(() => null);
        return `${entry.name}:${info?.mtimeMs ?? 0}:${info?.size ?? 0}`;
      }),
  );
  return stamps.sort().join('|');
}

async function cachedSummary(id: string, directory: string): Promise<RunSummary | null> {
  const key = await cacheKey(directory);
  const cached = summaryCache.get(directory);
  if (cached?.key === key) return cached.summary;
  const files = await readRunFiles(directory);
  if (files === null) return null;
  const summary = summarizeRun(id, files, sessionOf(files));
  summaryCache.set(directory, { key, summary });
  return summary;
}

export async function loadIndex(root: string): Promise<ResultsIndex> {
  const names = await listDirectories(root);
  const runs: RunSummary[] = [];
  const calibrations: CalibrationRun[] = [];
  const skipped: ResultsIndex['skipped'] = [];

  await Promise.all(
    names.map(async (name) => {
      if (name.startsWith('calibration-')) {
        const calibration = await loadCalibration(root, name);
        if (calibration) calibrations.push(calibration);
        else skipped.push({ id: name, reason: 'missing manifest.json' });
        return;
      }
      const directory = resolveId(root, name);
      const summary = directory === null ? null : await cachedSummary(name, directory);
      if (summary) runs.push(summary);
      else skipped.push({ id: name, reason: 'missing manifest.json' });
    }),
  );

  const newestFirst = (a: { startedAt: string }, b: { startedAt: string }) =>
    b.startedAt.localeCompare(a.startedAt);
  return {
    root,
    generatedAt: new Date().toISOString(),
    runs: runs.sort(newestFirst),
    calibrations: calibrations.sort(newestFirst),
    skipped,
  };
}

export async function resultsRootExists(root: string): Promise<boolean> {
  try {
    return (await stat(root)).isDirectory();
  } catch {
    return false;
  }
}
