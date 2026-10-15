import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BenchmarkSnapshot } from '@askesis/api/benchmark';
import {
  addDays,
  buildScenario,
  generateRequest,
  personaVoice,
  renderAthleteAction,
} from './scenario.js';
import { loadDataset } from './datasets.js';
import { hasExpectedCoverage, overallVerdict, checkPlan } from './checks.js';
import {
  criteria,
  evaluatorModel,
  validateReview,
  providerFailure,
  type Review,
} from './models.js';
import { Artifacts, redact } from './artifacts.js';
import { acquireLock, environmentFor } from './local.js';
const dataset = await loadDataset();
function datasetCase(id: string, now = new Date('2026-10-09T12:00:00Z')) {
  const scenario = dataset.scenarios.find((item) => item.id === id)!;
  const persona = dataset.personas.find((item) => item.id === scenario.persona.id)!;
  return buildScenario(persona, scenario, now, personaVoice(persona));
}
const scenario = datasetCase('running-improver');
function snapshot(coverage: { startDate: string; endDate: string; current: boolean }[]) {
  // These tests exercise coverage/reference checking independently of SQL export details.
  return {
    messages: [{ sequence: 1 }],
    plan: { brief: { coverage }, workouts: [{ workout: { id: 'run-1' } }], blocks: [] },
  } as unknown as BenchmarkSnapshot;
}
const complete = () =>
  snapshot([
    { startDate: scenario.dates.startDate, endDate: scenario.dates.coverageEndDate, current: true },
  ]);
const review = (): Review => ({
  verdict: 'acceptable',
  summary: 'Example review.',
  criteria: criteria.map((criterion) => ({
    criterion,
    result: 'pass',
    explanation: 'Evidence.',
    evidence: ['workout:run-1'],
  })),
});

describe('scenario and disclosure boundaries', () => {
  it('uses the London date and saves a four-week horizon within a twelve-week goal', () => {
    const london = datasetCase('running-improver', new Date('2026-07-05T23:30:00Z'));
    expect(london.dates.today).toBe('2026-07-06');
    expect(london.dates.startDate).toBe('2026-07-13');
    expect(london.dates.coverageEndDate).toBe('2026-08-09');
    expect(london.dates.endDate).toBe('2026-10-04');
    expect(london.evidence[0]!.observedOn).toBe('2026-06-22');
    expect(scenario.dates.startDate).toBe('2026-10-12');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
  });
  it('renders exact disclosed facts without accepting invented or inherited keys', () => {
    const action = renderAthleteAction(scenario, {
      factIds: ['fitness', 'fitness'],
      intent: 'answer',
    });
    expect(action.content).toBe(scenario.facts.fitness);
    expect(action.factIds).toEqual(['fitness']);
    expect(action.content).not.toContain(scenario.facts.training);
    for (const fact of ['invented', 'toString', '__proto__'])
      expect(() => renderAthleteAction(scenario, { factIds: [fact], intent: 'answer' })).toThrow(
        'unknown fact',
      );
  });
  it("words requests and unknowns from the scenario's horizon and the persona", () => {
    const annual = datasetCase('hybrid-improver-annual');
    expect(renderAthleteAction(annual, { factIds: [], intent: 'generate' }).statements).toEqual([
      generateRequest(annual),
    ]);
    expect(generateRequest(annual)).toContain(`first ${annual.prescriptionWeeks} weeks`);
    expect(renderAthleteAction(annual, { factIds: [], intent: 'unknown' }).content).toBe(
      annual.persona.communication.unknownResponse,
    );
  });
  it('resolves every pilot case with private facts that the coach never receives', () => {
    for (const ref of dataset.suites[0]!.scenarios) {
      const resolved = datasetCase(ref.id);
      expect(resolved.openingMessage).not.toContain('{{');
      for (const id of resolved.expectations.requiredDiscovery)
        expect(resolved.facts[id], `${ref.id}:${id}`).toBeTruthy();
    }
  });
});

describe('saved completion and assessment', () => {
  it('accepts contiguous saved ranges and intentional partial overall-plan coverage', () => {
    const value = snapshot([
      { startDate: '2026-10-26', endDate: '2026-11-08', current: true },
      { startDate: '2026-10-12', endDate: '2026-10-25', current: true },
    ]);
    expect(hasExpectedCoverage(value, scenario)).toBe(true);
  });
  it('rejects a missing rest day, stale coverage, and an empty schedule', () => {
    expect(
      hasExpectedCoverage(
        snapshot([
          { startDate: '2026-10-12', endDate: '2026-10-24', current: true },
          { startDate: '2026-10-26', endDate: '2026-11-08', current: true },
        ]),
        scenario,
      ),
    ).toBe(false);
    const value = complete();
    value.plan!.brief.coverage[0]!.current = false;
    expect(hasExpectedCoverage(value, scenario)).toBe(false);
    value.plan!.brief.coverage[0]!.current = true;
    value.plan!.workouts = [];
    expect(hasExpectedCoverage(value, scenario)).toBe(false);
  });
  it('cannot award a pass to missing output, failed execution, or failed exact checks', () => {
    const checks = checkPlan({ plan: null } as BenchmarkSnapshot, scenario, []);
    expect(checks.map((check) => check.id)).toEqual(['saved_plan']);
    expect(overallVerdict(checks, review(), 'completed')).toBe('incomplete');
    expect(overallVerdict([], review(), 'INTERRUPTED')).toBe('incomplete');
    expect(overallVerdict([], null, 'completed')).toBe('assessment_unavailable');
    expect(
      overallVerdict(
        [{ id: 'availability', status: 'fail', explanation: '', evidence: [] }],
        review(),
        'completed',
      ),
    ).toBe('needs_revision');
    expect(overallVerdict([], review(), 'completed')).toBe('acceptable');
  });
  it('identifies changed availability, baseline and unresolved prescription evidence', () => {
    const value = {
      ...complete(),
      performance: {
        current: [
          {
            system: 'run_pace',
            provenance: 'user_supplied',
            observedOn: scenario.evidence[0]!.observedOn,
            input: { method: 'race_result', distanceMetres: 5000, durationSeconds: 1680 },
          },
        ],
      },
      plan: {
        header: {
          draft: { startDate: scenario.dates.startDate, endDate: scenario.dates.endDate },
        },
        brief: {
          coverage: complete().plan!.brief.coverage,
          brief: {
            sports: [
              {
                sport: 'run',
                currentSessions: { status: 'known', value: 3 },
                desiredSessions: 3,
                weeklyDistance: { status: 'known', value: 22000 },
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
          },
        },
        findings: [],
        blocks: [],
        workouts: Array.from({ length: 4 }, (_, week) =>
          [1, 3, 6].map((day) => ({
            workout: {
              id: `run-${week}-${day}`,
              scheduledDate: addDays(scenario.dates.startDate, week * 7 + day),
              discipline: 'run',
              estimatedDurationSeconds: day === 6 ? 5400 : 3000,
            },
            prescription: {
              kind: 'effort',
              discipline: null,
              completion: { type: 'distance' },
              targets: [{ type: 'zone', zoneSystem: 'run_pace', resolvedZone: {} }],
            },
          })),
        ).flat(),
      },
    } as unknown as BenchmarkSnapshot;
    const disclosed = Object.keys(scenario.facts);
    expect(checkPlan(value, scenario, disclosed).every((item) => item.status === 'pass')).toBe(
      true,
    );
    value.plan!.workouts[0]!.workout.scheduledDate = scenario.dates.startDate;
    const baseline = value.plan!.brief.brief.sports[0]!;
    if (baseline.sport === 'run') baseline.weeklyDistance.value = 40000;
    value.plan!.workouts[1]!.prescription.targets[0]!.resolvedZone = null;
    const failures = checkPlan(value, scenario, disclosed)
      .filter((item) => item.status === 'fail')
      .map((item) => item.id);
    expect(failures).toEqual(expect.arrayContaining(['availability', 'baseline', 'prescriptions']));
    value.plan!.workouts[2]!.workout.estimatedDurationSeconds = 7200;
    expect(
      checkPlan(value, scenario, disclosed).find((item) => item.id === 'time_budgets')?.status,
    ).toBe('fail');
  });
  it('rejects fabricated evidence, missing criteria and contradictory judgments', () => {
    expect(() => validateReview(review(), complete())).not.toThrow();
    const invented = review();
    invented.criteria[0]!.evidence = ['workout:invented'];
    expect(() => validateReview(invented, complete())).toThrow('evidence');
    const omitted = review();
    omitted.criteria.pop();
    expect(() => validateReview(omitted, complete())).toThrow('every criterion');
    const contradiction = review();
    contradiction.criteria[0]!.result = 'uncertain';
    expect(() => validateReview(contradiction, complete())).toThrow('contradicts');
    const absent = { ...complete(), plan: null };
    const missing = review();
    missing.criteria.forEach((item) => {
      item.evidence = ['message:1'];
    });
    expect(() => validateReview(missing, absent)).toThrow('missing saved plan');
  });
  it('accepts timed strength rests but still requires an effort target for the lifts', () => {
    const strength = datasetCase('strength-beginner');
    strength.expectations.checks = ['prescriptions'];
    const lift = {
      kind: 'effort',
      role: 'main',
      discipline: 'strength',
      completion: { type: 'repetitions', value: 10 },
      targets: [{ type: 'rir', targetValue: 2 }],
    };
    const rest = {
      kind: 'effort',
      role: 'recovery',
      discipline: 'strength',
      completion: { type: 'duration', value: 60 },
      targets: [],
    };
    const value = {
      plan: {
        findings: [],
        workouts: [
          {
            workout: {
              id: 'lift',
              scheduledDate: strength.dates.startDate,
              discipline: 'strength',
            },
            prescription: { kind: 'repeat', steps: [lift, rest] },
          },
        ],
      },
    } as unknown as BenchmarkSnapshot;
    const result = () =>
      checkPlan(value, strength, []).find((check) => check.id === 'prescriptions')!.status;
    expect(result()).toBe('pass');
    lift.targets = [];
    expect(result()).toBe('fail');
  });
  it('distinguishes an explicitly unknown baseline from an unanswered one and from zero', () => {
    const strength = datasetCase('strength-beginner');
    strength.expectations.checks = ['baseline'];
    const expected = strength.persona.sports[0]!;
    expected.currentSessions = null;
    const saved = {
      sport: 'strength',
      desiredSessions: expected.desiredSessions,
      currentSessions: { status: 'unknown', value: null as number | null },
    };
    const value = {
      plan: { findings: [], workouts: [], brief: { brief: { sports: [saved] } } },
    } as unknown as BenchmarkSnapshot;
    const result = () =>
      checkPlan(value, strength, []).find((check) => check.id === 'baseline')!.status;
    expect(result()).toBe('pass');
    saved.currentSessions.status = 'unanswered';
    expect(result()).toBe('fail');
    expected.currentSessions = 0;
    expect(result()).toBe('fail');
    saved.currentSessions = { status: 'known', value: 0 };
    expect(result()).toBe('pass');
  });
});

describe('weekly sport frequency', () => {
  it('preserves every pilot sport frequency in the offline fixture, including limited pool slots', async () => {
    const { scriptedCoach } = await import('./scripted.js');
    for (const ref of dataset.suites[0]!.scenarios) {
      const scenario = datasetCase(ref.id);
      const call = scriptedCoach(scenario)
        .flatMap((turn) => (turn.type === 'tools' ? turn.calls : []))
        .find((call) => call.name === 'apply_schedule_changes')!;
      const workouts = call.input.workouts as { key: string; date: string; discipline: string }[];
      const value = {
        plan: {
          findings: [],
          workouts: workouts.map((workout) => ({
            workout: {
              id: workout.key,
              scheduledDate: workout.date,
              discipline: workout.discipline,
            },
            prescription: { kind: 'effort', discipline: workout.discipline },
          })),
        },
      } as unknown as BenchmarkSnapshot;
      expect(frequency(value, scenario), scenario.id).toMatchObject({ status: 'pass' });
    }
  });
  const schedule = (scenario: ReturnType<typeof datasetCase>, sessions: string[][]) =>
    ({
      plan: {
        findings: [],
        workouts: Array.from({ length: scenario.prescriptionWeeks }, (_, week) =>
          sessions.map((sports, index) => ({
            workout: {
              id: `${week}-${index}`,
              scheduledDate: addDays(scenario.dates.startDate, week * 7 + Math.min(index, 6)),
              discipline: sports.length === 1 ? sports[0] : 'mixed',
            },
            prescription: {
              kind: 'repeat',
              repeatCount: 3,
              steps: sports.map((sport) => ({ kind: 'effort', discipline: sport })),
            },
          })),
        ).flat(),
      },
    }) as unknown as BenchmarkSnapshot;
  const frequency = (value: BenchmarkSnapshot, scenario: ReturnType<typeof datasetCase>) => {
    scenario.expectations.checks = [];
    return checkPlan(value, scenario, Object.keys(scenario.facts)).find(
      (check) => check.id === 'weekly_frequency',
    )!;
  };
  it('requires the requested session count in each prescribed week, ignoring later weeks', () => {
    const running = datasetCase('running-improver');
    const good = schedule(running, [['run'], ['run'], ['run']]);
    good.plan!.workouts.push({
      ...good.plan!.workouts[0]!,
      workout: {
        ...good.plan!.workouts[0]!.workout,
        scheduledDate: addDays(running.dates.coverageEndDate, 1),
      },
    });
    expect(frequency(good, running).status).toBe('pass');
    expect(frequency(schedule(running, [['run']]), running).status).toBe('fail');
    expect(frequency(schedule(running, [['run'], ['run'], ['run'], ['run']]), running).status).toBe(
      'fail',
    );
  });
  it('counts each sport in a brick once regardless of repeated effort count', () => {
    const triathlon = datasetCase('triathlon-intermediate');
    const good = [['cycle', 'run'], ['cycle'], ['cycle'], ['run'], ['run'], ['swim'], ['swim']];
    expect(frequency(schedule(triathlon, good), triathlon).status).toBe('pass');
    expect(
      frequency(
        schedule(
          triathlon,
          good.filter((sports) => !sports.includes('swim')),
        ),
        triathlon,
      ).explanation,
    ).toContain('swim: 0, expected 2');
    triathlon.expectations.frequencyPolicy = 'workouts_per_sport';
    expect(frequency(schedule(triathlon, good), triathlon).status).toBe('fail');
  });
});

describe('local isolation and portable evidence', () => {
  it('keeps SDK shutdown from exiting before interrupt cleanup finishes', async () => {
    const sdk = import.meta.resolve('@openai/agents');
    const local = new URL('./local.ts', import.meta.url).href;
    const script = `
      import { setTracingDisabled } from ${JSON.stringify(sdk)};
      import { installInterruptHandlers } from ${JSON.stringify(local)};
      setTracingDisabled(true);
      const waiting = setTimeout(() => { console.log('handler-not-fired'); }, 1000);
      const remove = installInterruptHandlers(() => {
        clearTimeout(waiting);
        setTimeout(() => { console.log('cleanup-completed'); remove(); }, 100);
      });
      process.kill(process.pid, 'SIGINT');
    `;
    const result = await new Promise<{ code: number | null; output: string }>((done, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
      child.stderr.on('data', (data) => {
        output += data.toString();
      });
      child.once('error', reject);
      child.once('exit', (code) => done({ code, output }));
    });
    expect(result).toEqual({ code: 0, output: 'cleanup-completed\n' });
  });
  it('reports provider authentication failures without exposing provider messages', () => {
    expect(
      providerFailure({
        status: 401,
        message: 'Incorrect API key: confidential',
        headers: { authorization: 'secret' },
      }),
    ).toEqual({ category: 'provider_authentication', httpStatus: 401, errorType: 'UnknownError' });
  });
  it('finds a wrapped provider failure without exporting its credential-bearing fields', () => {
    const error = new Error('Wrapper includes confidential');
    error.cause = {
      name: 'AuthenticationError',
      status: 401,
      code: 'invalid_api_key',
      message: 'Incorrect API key: confidential',
      request_id: 'confidential',
      headers: { authorization: 'confidential' },
    };
    expect(providerFailure(error)).toMatchObject({
      category: 'provider_authentication',
      httpStatus: 401,
      errorCode: 'invalid_api_key',
      errorType: 'AuthenticationError',
    });
    expect(JSON.stringify(providerFailure(error))).not.toContain('confidential');
  });
  it('identifies SDK stream terminal failures and their source location', () => {
    const error = new Error(
      'OpenAI Responses request ended with unsuccessful terminal state "response.failed".',
    );
    error.name = 'ModelBehaviorError';
    error.stack = `${error.name}: ${error.message}\n    at createUnsuccessfulResponseError (/private/confidential/node_modules/sdk/openaiResponsesModel.mjs:865:19)`;
    expect(providerFailure(error)).toEqual({
      category: 'execution_or_review_error',
      httpStatus: null,
      errorType: 'ModelBehaviorError',
      terminalState: 'response.failed',
      failureLocation: 'openaiResponsesModel.mjs:865:19',
    });
  });
  it('bounds cyclic causes and ignores unrecognized diagnostic values', () => {
    const error: Record<string, unknown> = {
      name: 'confidential',
      code: 'confidential',
      status: 'confidential',
      stack: 'Error: confidential\n    at confidential (/private/confidential.mjs:1:2)',
    };
    error.cause = error;
    expect(providerFailure(error)).toEqual({
      category: 'execution_or_review_error',
      httpStatus: null,
      errorType: 'UnknownError',
    });
  });
  it('assigns separate project identities and refuses conflicting ports', () => {
    expect(environmentFor('/worktree/a').project).not.toBe(environmentFor('/worktree/b').project);
    expect(() =>
      environmentFor('/worktree/a', { BENCH_API_PORT: '42000', BENCH_DATABASE_PORT: '42000' }),
    ).toThrow('must differ');
  });
  it('keeps the active lock intact when another command attempts to acquire it', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'askesis-bench-test-'));
    try {
      const release = await acquireLock(directory);
      const saved = await readFile(resolve(directory, 'run.lock'), 'utf8');
      await expect(acquireLock(directory)).rejects.toThrow('already running');
      expect(await readFile(resolve(directory, 'run.lock'), 'utf8')).toBe(saved);
      await release();
      const next = await acquireLock(directory);
      await next();
      await writeFile(resolve(directory, 'run.lock'), JSON.stringify({ pid: 2147483647 }));
      await expect(acquireLock(directory)).rejects.toThrow('stale');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('isolates saved-run writer locks and releases them for retry', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'askesis-review-lock-'));
    const directories = [resolve(root, 'first'), resolve(root, 'second')];
    try {
      await Promise.all(directories.map((directory) => new Artifacts(directory).init()));
      const releaseFirst = await acquireLock(directories[0]!, 'review');
      const releaseSecond = await acquireLock(directories[1]!, 'review');
      await expect(acquireLock(directories[0]!, 'review')).rejects.toThrow(
        'writer is already running',
      );
      await releaseFirst();
      const retry = await acquireLock(directories[0]!, 'review');
      await retry();
      await releaseSecond();
      expect(await readdir(directories[0]!)).toEqual([]);
      expect(await readdir(directories[1]!)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('publishes concurrent JSON writes without sharing temporary files', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'askesis-artifacts-'));
    try {
      const values = Array.from({ length: 20 }, (_, id) => ({
        id,
        content: String(id).repeat(1000),
      }));
      await Promise.all(values.map((value) => new Artifacts(directory).json('result.json', value)));
      expect(values).toContainEqual(
        JSON.parse(await readFile(resolve(directory, 'result.json'), 'utf8')),
      );
      expect(await readdir(directory)).toEqual(['result.json']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('strips credentials recursively while preserving timestamps and usage', () => {
    expect(
      redact({
        token: 'secret',
        DATABASE_URL: 'secret',
        ANTHROPIC_API_KEY: 'secret',
        created_at: new Date('2026-10-09T12:00:00Z'),
        nested: [{ headers: { authorization: 'secret' }, inputTokens: 17 }],
      }),
    ).toEqual({ created_at: '2026-10-09T12:00:00.000Z', nested: [{ inputTokens: 17 }] });
  });
});

describe('coach provider selection', () => {
  it('keeps simulator and reviewer on OpenAI when the coach runs on Claude', () => {
    expect(
      evaluatorModel({ AGENT_PROVIDER: 'anthropic', AGENT_MODEL: 'claude-opus-5-5' }, undefined),
    ).toBe('gpt-6.1-sol');
    expect(evaluatorModel({ AGENT_MODEL: 'gpt-6.1-mini' }, undefined)).toBe('gpt-6.1-mini');
    expect(evaluatorModel({ AGENT_PROVIDER: 'anthropic' }, 'gpt-6.1-judge')).toBe('gpt-6.1-judge');
  });

  it.each(['openai', 'anthropic'] as const)(
    'replays the offline scripted coach through the %s runtime',
    async (provider) => {
      const { parseAgentConfig } = await import('@askesis/agent/config');
      const { createRuntime } = await import('@askesis/agent/runtime');
      const { scriptedOverrides } = await import('@askesis/agent/testing');
      const { AgentApi } = await import('@askesis/agent/api');
      const { scriptedCoach } = await import('./scripted.js');
      const config = parseAgentConfig({
        AGENT_PROVIDER: provider,
        OPENAI_API_KEY: 'scripted',
        ANTHROPIC_API_KEY: 'scripted',
        AGENT_BOOTSTRAP_TOKEN: 'test-bootstrap-token-32-characters',
      });
      const runtime = createRuntime(config, scriptedOverrides(provider, scriptedCoach(scenario)));
      const tools: string[] = [];
      class LocalApi extends AgentApi {
        override async tool(_claim: unknown, command: unknown) {
          tools.push((command as { name: string }).name);
          return { result: {}, versionId: null, editNumber: null, planId: null };
        }
        override async progress() {
          return { status: 'running' };
        }
      }
      const api = new LocalApi('http://127.0.0.1');
      const claim = {
        runId: '00000000-0000-4000-8000-000000000010',
        token: 'run-token',
        generation: 1,
        deadlineAt: new Date(Date.now() + 60000).toISOString(),
        versionId: null,
        editNumber: null,
      };
      const context = {
        messages: [{ role: 'user' as const, content: scenario.openingMessage, sequence: 1 }],
        historyTruncated: false,
        plan: null,
        brief: null,
        performance: null,
        trainingLog: null,
        versionId: null,
        editNumber: null,
        tools: [
          'create_plan_draft',
          'record_performance',
          'update_plan_brief',
          'apply_schedule_changes',
          'validate_plan',
        ].map((name) => ({
          name,
          description: name,
          parameters: { type: 'object', properties: {} },
        })),
      };
      const run = () =>
        runtime.execute(
          context,
          claim,
          api,
          new AbortController().signal,
          new AbortController().signal,
        );
      expect((await run()).content).toContain('Please share your goal');
      expect((await run()).content).toContain('offline scripted fixture');
      expect(tools).toEqual([
        'create_plan_draft',
        'record_performance',
        'update_plan_brief',
        'apply_schedule_changes',
        'validate_plan',
      ]);
    },
  );
});
