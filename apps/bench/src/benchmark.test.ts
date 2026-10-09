import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BenchmarkSnapshot } from '@askesis/api/benchmark';
import { addDays, renderAthleteAction, resolveScenario } from './scenario.js';
import { hasExpectedCoverage, overallVerdict, checkPlan } from './checks.js';
import { criteria, validateReview, providerFailure, type Review } from './models.js';
import { redact } from './artifacts.js';
import { acquireLock, environmentFor } from './local.js';
import raw from '../scenarios/running-poc.json' with { type: 'json' };

const scenario = resolveScenario(raw, new Date('2026-10-09T12:00:00Z'));
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
    const london = resolveScenario(raw, new Date('2026-07-05T23:30:00Z'));
    expect(london.dates.today).toBe('2026-07-06');
    expect(london.dates.startDate).toBe('2026-07-13');
    expect(london.dates.coverageEndDate).toBe('2026-08-09');
    expect(london.dates.eventDate).toBe('2026-10-04');
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
    expect(overallVerdict(checks, review(), 'completed')).toBe('incomplete');
    expect(overallVerdict([], review(), 'INTERRUPTED')).toBe('incomplete');
    expect(overallVerdict([], null, 'completed')).toBe('assessment_unavailable');
    expect(
      overallVerdict(
        [{ id: 'available_days', status: 'fail', explanation: '', evidence: [] }],
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
            observedOn: scenario.dates.observedOn,
            input: { method: 'race_result', distanceMetres: 5000, durationSeconds: 1680 },
          },
        ],
      },
      plan: {
        header: {
          draft: { startDate: scenario.dates.startDate, endDate: scenario.dates.eventDate },
        },
        brief: {
          coverage: complete().plan!.brief.coverage,
          brief: {
            sports: [
              {
                sport: 'run',
                currentSessions: { value: 3 },
                desiredSessions: 3,
                weeklyDistance: { value: 22000 },
                longestDistance: { value: 9000 },
              },
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
            },
            prescription: {
              kind: 'effort',
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
    expect(failures).toEqual(
      expect.arrayContaining(['available_days', 'baseline', 'prescriptions']),
    );
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
    ).toEqual({ category: 'provider_authentication', httpStatus: 401 });
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
  it('strips credentials recursively while preserving timestamps and usage', () => {
    expect(
      redact({
        token: 'secret',
        DATABASE_URL: 'secret',
        created_at: new Date('2026-10-09T12:00:00Z'),
        nested: [{ headers: { authorization: 'secret' }, inputTokens: 17 }],
      }),
    ).toEqual({ created_at: '2026-10-09T12:00:00.000Z', nested: [{ inputTokens: 17 }] });
  });
});
