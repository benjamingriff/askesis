import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { parseAgentConfig, PROMPT_VERSION } from '@askesis/agent/config';
import { COACHING_PROMPT } from '@askesis/agent/prompt';
import type * as BenchmarkOperator from '@askesis/api/benchmark';
import type { BenchmarkSnapshot } from '@askesis/api/benchmark';
import { Artifacts, reportMarkdown } from './artifacts.js';
import { checkPlan, hasExpectedCoverage, overallVerdict, type Check } from './checks.js';
import {
  EvaluationModels,
  providerFailure,
  SIMULATOR_VERSION,
  REVIEW_VERSION,
  type Review,
  type Disclosure,
  type ModelUsage,
} from './models.js';
import { loadScenario, renderAthleteAction } from './scenario.js';
import { scriptedReview } from './scripted.js';
import {
  root,
  BenchmarkError,
  localEnvironment,
  acquireLock,
  compose,
  assertApiPortFree,
  loadCredentials,
  configureApi,
  installInterruptHandlers,
  startWorker,
} from './local.js';

const options = parseArgs({
  allowPositionals: true,
  options: {
    scenario: { type: 'string', default: 'running-poc' },
    'env-file': { type: 'string' },
    'keep-alive': { type: 'boolean', default: false },
    scripted: { type: 'boolean', default: false },
    run: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});
const command = options.positionals[0] ?? 'run';

async function run() {
  if (options.values.scenario !== 'running-poc')
    throw new BenchmarkError('Available scenario: running-poc.');
  const credentials = await loadCredentials(options.values['env-file']);
  if (!options.values.scripted && !credentials.values.OPENAI_API_KEY)
    throw new BenchmarkError(
      'Set OPENAI_API_KEY in .env.bench.local, your shell, or --env-file before running a live scenario.',
    );
  const environment = await localEnvironment();
  const release = await acquireLock();
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const artifacts = new Artifacts(resolve(root, 'benchmark-results', runId));
  const abort = new AbortController();
  const stop = () => {
    if (!abort.signal.aborted) {
      console.log('Stopping benchmark; retaining saved evidence.');
      abort.abort('INTERRUPTED');
    }
  };
  const removeInterruptHandlers = installInterruptHandlers(stop);
  let stopApi: (() => Promise<void>) | undefined;
  let worker: ReturnType<typeof startWorker> | undefined;
  let workerTask: Promise<void> | undefined;
  let operator: typeof BenchmarkOperator | undefined;
  let owner: string | undefined;
  let conversationId: string | undefined;
  let activeRun: string | undefined;
  let snapshot: BenchmarkSnapshot | null = null;
  let checks: Check[] = [];
  let review: Review | null = null;
  let stopReason = 'setup_failed';
  let phase = 'setup';
  const disclosed: Disclosure[] = [];
  const usage: { role: string; usage: ModelUsage }[] = [];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const stage = async (name: string) => {
    phase = name;
    console.log(name);
    await artifacts.event({ stage: name });
    await artifacts.json('state.json', { runId, stage: name, owner, conversationId, activeRun });
  };
  try {
    await artifacts.init();
    await artifacts.json('disclosures.json', []);
    await writeFile(resolve(artifacts.directory, 'tool-trace.jsonl'), '', { mode: 0o600 });
    const scenario = await loadScenario();
    await artifacts.json('scenario.json', scenario);
    await artifacts.json('manifest.json', {
      runId,
      startedAt: new Date().toISOString(),
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      workingTreeDirty:
        execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
          .length > 0,
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      scenarioHash: createHash('sha256').update(JSON.stringify(scenario)).digest('hex'),
      promptVersion: PROMPT_VERSION,
      promptHash: createHash('sha256').update(COACHING_PROMPT).digest('hex'),
      simulatorVersion: SIMULATOR_VERSION,
      reviewerVersion: REVIEW_VERSION,
      scripted: options.values.scripted,
      environment,
      dates: scenario.dates,
      limits: scenario.limits,
    });
    timeout = setTimeout(
      () => abort.abort('TIME_LIMIT'),
      scenario.limits.maxElapsedMinutes * 60000,
    );
    console.log(`Run: ${runId}\nArtifacts: ${artifacts.directory}`);
    await assertApiPortFree(environment.apiPort);
    await compose(environment, ['up', '-d', '--wait', 'postgres'], abort.signal);
    await compose(environment, ['run', '--rm', 'migrate'], abort.signal);
    configureApi(environment, credentials.secret, credentials.publishable);
    operator = await import('@askesis/api/benchmark');
    stopApi = await operator.startBenchmarkApi();
    const apiUrl = `http://127.0.0.1:${environment.apiPort}`;
    if (!(await fetch(`${apiUrl}/api/ready`, { signal: abort.signal })).ok)
      throw new BenchmarkError('The benchmark API is not ready.');
    const config = parseAgentConfig({
      ...credentials.values,
      AGENT_BOOTSTRAP_TOKEN: process.env.AGENT_BOOTSTRAP_TOKEN,
      AGENT_API_URL: apiUrl,
      OPENAI_API_KEY: credentials.values.OPENAI_API_KEY ?? 'scripted-no-provider-request',
    });
    await artifacts.json('configuration.json', {
      coach: {
        model: config.AGENT_MODEL,
        reasoning: config.AGENT_REASONING,
        maxTurns: config.AGENT_MAX_TURNS,
        maxOutputTokens: config.AGENT_MAX_OUTPUT_TOKENS,
      },
      simulatorModel: credentials.values.BENCH_SIMULATOR_MODEL ?? config.AGENT_MODEL,
      reviewerModel: credentials.values.BENCH_REVIEW_MODEL ?? config.AGENT_MODEL,
    });
    worker = startWorker(config, artifacts.directory, options.values.scripted ? scenario : null);
    let workerFailure = false;
    workerTask = worker.done.catch(() => {
      workerFailure = true;
      abort.abort('WORKER_FAILED');
    });
    const readinessDeadline = Date.now() + 10000;
    while (!(await operator.benchmarkWorkerReady())) {
      if (Date.now() > readinessDeadline || workerFailure)
        throw new BenchmarkError('The benchmark worker did not become ready.');
      await delay(100, undefined, { signal: abort.signal });
    }
    await stage(`Environment ready — API ${apiUrl}`);
    owner = await operator.createBenchmarkAthlete(scenario.timezone);
    const created = await operator.startBenchmarkConversation(owner, scenario.openingMessage);
    conversationId = created.conversation.id;
    activeRun = created.accepted!.run.id;
    console.log(`Athlete: ${scenario.openingMessage}`);
    const simulator = new EvaluationModels(
      config.OPENAI_API_KEY,
      credentials.values.BENCH_SIMULATOR_MODEL ?? config.AGENT_MODEL,
    );
    const reviewer = new EvaluationModels(
      config.OPENAI_API_KEY,
      credentials.values.BENCH_REVIEW_MODEL ?? config.AGENT_MODEL,
    );
    stopReason = 'message_limit';
    for (let turn = 0; turn < scenario.limits.maxAthleteMessages; turn++) {
      await stage(`Coach turn ${turn + 1}`);
      let status = await operator.benchmarkRun(owner, activeRun);
      while (['queued', 'running', 'cancelling'].includes(status.status)) {
        await delay(500, undefined, { signal: abort.signal });
        status = await operator.benchmarkRun(owner, activeRun);
      }
      activeRun = undefined;
      snapshot = await operator.benchmarkSnapshot(owner, conversationId);
      await artifacts.snapshot(snapshot);
      const last = snapshot.messages.at(-1);
      if (last?.role === 'assistant') console.log(`Coach: ${last.content}`);
      if (status.status !== 'completed') {
        stopReason = status.failureCode ?? status.status;
        break;
      }
      if (hasExpectedCoverage(snapshot, scenario)) {
        stopReason = 'completed';
        break;
      }
      if (turn + 1 === scenario.limits.maxAthleteMessages) break;
      await stage('Athlete response');
      const action = options.values.scripted
        ? { factIds: Object.keys(scenario.facts), intent: 'generate' as const }
        : await simulator
            .athlete(scenario, snapshot.messages, disclosed, abort.signal)
            .then((result) => {
              usage.push({ role: 'simulator', usage: result.usage });
              return result.action;
            });
      const response = renderAthleteAction(scenario, action);
      console.log(`Athlete: ${response.content}`);
      const accepted = await operator.sendBenchmarkMessage(owner, conversationId, response.content);
      disclosed.push({ sequence: accepted.message.sequence, factIds: response.factIds });
      await artifacts.json('disclosures.json', disclosed);
      activeRun = accepted.run.id;
    }
    checks = checkPlan(
      snapshot!,
      scenario,
      disclosed.flatMap((item) => item.factIds),
    );
    await artifacts.json('checks.json', checks);
    await stage('Review running');
    if (options.values.scripted) review = scriptedReview(snapshot!);
    else {
      try {
        const result = await reviewer.review(snapshot!, disclosed, abort.signal);
        review = result.review;
        usage.push({ role: 'reviewer', usage: result.usage });
      } catch (error) {
        await artifacts.event({
          stage: 'review_failed',
          ...providerFailure(error),
          reason: abort.signal.aborted
            ? String(abort.signal.reason)
            : 'PROVIDER_OR_REVIEW_VALIDATION_ERROR',
        });
        console.error(
          'Review could not complete. Saved plan and checks remain available; use bench grade to retry only the review.',
        );
      }
    }
  } catch (error) {
    stopReason = abort.signal.aborted ? String(abort.signal.reason) : `${phase}_failed`;
    console.error(
      error instanceof BenchmarkError
        ? error.message
        : `Benchmark failed during ${phase}. Provider errors and credentials are not printed.`,
    );
    await artifacts
      .event({ stage: 'execution_failed', stopReason, ...providerFailure(error) })
      .catch(() => {});
    process.exitCode = 1;
  } finally {
    try {
      if (timeout) clearTimeout(timeout);
      if (operator && owner && activeRun) {
        await operator.cancelBenchmarkRun(owner, activeRun).catch(() => {});
        // Allow the existing worker cancellation path to persist accepted partial output.
        const deadline = Date.now() + 18000;
        while (Date.now() < deadline) {
          const status = await operator.benchmarkRun(owner, activeRun).catch(() => null);
          if (!status || !['queued', 'running', 'cancelling'].includes(status.status)) break;
          await delay(250);
        }
      }
      worker?.stop();
      await workerTask;
      if (operator && owner && conversationId)
        snapshot = await operator.benchmarkSnapshot(owner, conversationId).catch(() => snapshot);
      if (snapshot) {
        await artifacts.snapshot(snapshot);
        checks = checkPlan(
          snapshot,
          await loadResolvedScenario(artifacts.directory),
          disclosed.flatMap((item) => item.factIds),
        );
      }
      await artifacts.json('checks.json', checks);
      const verdict = overallVerdict(checks, review, stopReason);
      await artifacts.json('assessment.json', {
        verdict,
        stopReason,
        review,
        checks,
        scripted: options.values.scripted,
      });
      await artifacts.json('metrics.json', {
        evaluationUsage: usage,
        coachUsage:
          snapshot?.runs.map((run) => ({
            runId: run.id,
            inputTokens: run.input_tokens,
            outputTokens: run.output_tokens,
          })) ?? [],
        monetaryCost: null,
      });
      await writeFile(
        resolve(artifacts.directory, 'report.md'),
        reportMarkdown(
          runId,
          verdict,
          stopReason,
          snapshot,
          checks,
          review,
          options.values.scripted,
        ),
        { mode: 0o600 },
      );
      await stage(`Assessment: ${verdict}`);
      console.log(`Report: ${resolve(artifacts.directory, 'report.md')}`);
      if (stopReason !== 'completed' || !review) process.exitCode = 1;
      if (options.values['keep-alive'] && stopApi && !abort.signal.aborted) {
        console.log(
          `API remains available on http://127.0.0.1:${environment.apiPort}. Ctrl+C stops it; data and reports are retained.`,
        );
        await new Promise<void>((done) =>
          abort.signal.addEventListener('abort', () => done(), { once: true }),
        );
      }
    } finally {
      try {
        worker?.stop();
        await workerTask;
        await stopApi?.();
      } finally {
        await release();
        removeInterruptHandlers();
      }
    }
  }
}

async function loadResolvedScenario(directory: string) {
  // Dates are saved at creation; a retry/review must not move them to another day.
  return JSON.parse(await readFile(resolve(directory, 'scenario.json'), 'utf8')) as Awaited<
    ReturnType<typeof loadScenario>
  >;
}

async function grade() {
  const runId = options.values.run;
  if (!runId || !/^[a-zA-Z0-9][\w.-]*$/.test(runId))
    throw new BenchmarkError('Use bench grade --run <run-id>.');
  const directory = resolve(root, 'benchmark-results', runId);
  const credentials = await loadCredentials(options.values['env-file'], false);
  if (!credentials.values.OPENAI_API_KEY)
    throw new BenchmarkError('OPENAI_API_KEY is required to review saved outputs.');
  const snapshot = JSON.parse(
    await readFile(resolve(directory, 'snapshot.json'), 'utf8'),
  ) as BenchmarkSnapshot;
  const disclosures = JSON.parse(
    await readFile(resolve(directory, 'disclosures.json'), 'utf8'),
  ) as Disclosure[];
  const assessment = JSON.parse(await readFile(resolve(directory, 'assessment.json'), 'utf8')) as {
    stopReason: string;
    scripted: boolean;
  };
  const model =
    credentials.values.BENCH_REVIEW_MODEL ?? credentials.values.AGENT_MODEL ?? 'gpt-6.1-sol';
  const result = await new EvaluationModels(credentials.values.OPENAI_API_KEY, model).review(
    snapshot,
    disclosures,
    new AbortController().signal,
  );
  const checks = checkPlan(
    snapshot,
    await loadResolvedScenario(directory),
    disclosures.flatMap((item) => item.factIds),
  );
  const verdict = overallVerdict(checks, result.review, assessment.stopReason);
  const artifacts = new Artifacts(directory);
  await artifacts.json(`assessment-before-review-${Date.now()}.json`, assessment);
  await artifacts.json('assessment.json', {
    verdict,
    stopReason: assessment.stopReason,
    review: result.review,
    checks,
    scripted: assessment.scripted,
    regradedAt: new Date().toISOString(),
    reviewerModel: model,
    reviewerVersion: REVIEW_VERSION,
  });
  await artifacts.json(`review-${Date.now()}.json`, {
    ...result,
    model,
    reviewerVersion: REVIEW_VERSION,
  });
  await writeFile(
    resolve(directory, 'report.md'),
    reportMarkdown(
      runId,
      verdict,
      assessment.stopReason,
      snapshot,
      checks,
      result.review,
      assessment.scripted,
    ),
    { mode: 0o600 },
  );
  console.log(`Assessment: ${verdict}\nReport: ${resolve(directory, 'report.md')}`);
}

async function main() {
  if (options.values.help) {
    console.log(
      'pnpm bench run [--scenario running-poc] [--env-file PATH] [--keep-alive] [--scripted]\npnpm bench grade --run RUN_ID [--env-file PATH]\npnpm bench stop\npnpm bench reset',
    );
    return;
  }
  if (options.positionals.length > 1)
    throw new BenchmarkError('Expected one command: run, grade, stop or reset.');
  if (command === 'run') return run();
  if (command === 'grade') return grade();
  if (command === 'stop' || command === 'reset') {
    const environment = await localEnvironment();
    const release = await acquireLock();
    try {
      await compose(
        environment,
        command === 'reset' ? ['down', '--volumes', '--remove-orphans'] : ['stop'],
      );
      if (command === 'reset') await unlink(resolve(root, '.bench', 'environment.json'));
      console.log(
        command === 'reset'
          ? 'Only this worktree benchmark database was removed. Exported reports remain.'
          : 'Benchmark database stopped. Data and reports remain.',
      );
    } finally {
      await release();
    }
    return;
  }
  throw new BenchmarkError('Unknown command. Use pnpm bench --help.');
}

main().catch((error: unknown) => {
  console.error(
    error instanceof BenchmarkError
      ? error.message
      : 'Benchmark command failed. Check local configuration and saved artifacts.',
  );
  process.exitCode = 1;
});
