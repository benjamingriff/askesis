import { randomUUID } from 'node:crypto';
import { execFileSync, fork } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readFile, writeFile, unlink, open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { parseAgentConfig } from '@askesis/agent/config';
import { COACHING_PROMPT, PROMPT_HASH, PROMPT_VERSION } from '@askesis/agent/prompt';
import type * as BenchmarkOperator from '@askesis/api/benchmark';
import type { BenchmarkSnapshot } from '@askesis/api/benchmark';
import {
  BenchDisplay,
  ProgressSchema,
  NoticeSchema,
  ResultSchema,
  bar,
  resultLines,
  type RunResult,
} from './progress.js';
import { Artifacts, reportMarkdown } from './artifacts.js';
import {
  checkPlan,
  hasExpectedCoverage,
  overallVerdict,
  CHECKS_VERSION,
  type Check,
} from './checks.js';
import {
  EvaluationModels,
  evaluatorModel,
  providerFailure,
  SIMULATOR_VERSION,
  REVIEW_VERSION,
  type Review,
  type Disclosure,
  type ModelUsage,
} from './models.js';
import {
  loadScenario,
  renderAthleteAction,
  scenarioIds,
  suiteScenarioIds,
  type AthleteAction,
  type Scenario,
} from './scenario.js';
import { EVALUATOR_PROMPTS, promptIdentity, sha256 } from './prompts.js';
import { voiceProblems } from './voice.js';
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
import { loadFixtures, scriptedCalibrationReview, type Split } from './fixtures.js';
import { fixtureHash, runCalibration } from './calibration.js';
import { readOpenAiKeyFromOnePassword } from './one-password.js';

const options = parseArgs({
  allowPositionals: true,
  options: {
    scenario: { type: 'string' },
    suite: { type: 'string' },
    voice: { type: 'string', default: 'persona' },
    'env-file': { type: 'string' },
    'keep-alive': { type: 'boolean', default: false },
    scripted: { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
    run: { type: 'string' },
    help: { type: 'boolean', default: false },
    repeat: { type: 'string', default: '1' },
    split: { type: 'string', default: 'development' },
    fixture: { type: 'string', multiple: true },
    list: { type: 'boolean', default: false },
    assert: { type: 'boolean', default: false },
    op: { type: 'boolean', default: false },
    'op-item': { type: 'string' },
    'op-vault': { type: 'string' },
    'op-field': { type: 'string' },
  },
});
const command = options.positionals[0] ?? 'run';

async function benchmarkCredentials(requireClerk = true) {
  const credentials = await loadCredentials(options.values['env-file'], requireClerk);
  if (options.values.op && (command === 'grade' || !options.values.scripted)) {
    console.log('Loading OpenAI key from 1Password.');
    credentials.values.OPENAI_API_KEY = await readOpenAiKeyFromOnePassword({
      ...(options.values['op-item'] ? { item: options.values['op-item'] } : {}),
      ...(options.values['op-vault'] ? { vault: options.values['op-vault'] } : {}),
      ...(options.values['op-field'] ? { field: options.values['op-field'] } : {}),
    });
  }
  return credentials;
}

/** Runs each suite case in its own process, one after another, so every run is isolated. */
async function runSuite(id: string) {
  const ids = await suiteScenarioIds(id).catch((error: unknown) => {
    throw new BenchmarkError(error instanceof Error ? error.message : 'Unknown suite.');
  });
  const values = options.values;
  const passthrough = [
    ...(values['env-file'] ? ['--env-file', values['env-file']] : []),
    ...(values.scripted ? ['--scripted'] : []),
    ...(values.verbose ? ['--verbose'] : []),
    '--voice',
    values.voice,
    ...(values.op ? ['--op'] : []),
    ...(values['op-item'] ? ['--op-item', values['op-item']] : []),
    ...(values['op-vault'] ? ['--op-vault', values['op-vault']] : []),
    ...(values['op-field'] ? ['--op-field', values['op-field']] : []),
  ];
  const results: { id: string; code: number; result: RunResult | undefined }[] = [];
  console.log(
    `Suite ${id}: ${ids.length} scenarios. Full conversations are saved in each report. Use --verbose for transcripts.`,
  );
  for (const scenario of ids) {
    const prefix = `Suite ${bar(results.length, ids.length, 6)} ${results.length}/${ids.length} | `;
    const display = new BenchDisplay(
      prefix,
      values.verbose
        ? { write: (s) => process.stdout.write(s), isTTY: false, columns: 120 }
        : process.stdout,
    );
    let result: RunResult | undefined;
    let interrupted = false;
    let code: number;
    try {
      code = await new Promise<number>((done) => {
        const child = fork(process.argv[1]!, ['run', '--scenario', scenario, ...passthrough], {
          stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
          execArgv: [],
        });
        const removeHandlers = installInterruptHandlers(() => {
          interrupted = true;
          child.kill('SIGINT');
        });
        child.on('message', (message: unknown) => {
          const notice = NoticeSchema.safeParse(message);
          if (notice.success) {
            display.finish();
            console.log(notice.data.message);
          }
          const progress = ProgressSchema.safeParse(message);
          if (progress.success) display.update(progress.data);
          const parsed = ResultSchema.safeParse(message);
          if (parsed.success) result = parsed.data;
        });
        child.once('error', () => {
          removeHandlers();
          done(1);
        });
        child.once('exit', (exitCode) => {
          removeHandlers();
          done(exitCode ?? 1);
        });
      });
    } finally {
      display.finish();
    }
    results.push({ id: scenario, code, result });
    console.log(
      result
        ? resultLines(result)
        : `${scenario}: Execution failed before a report was available (exit ${code}).`,
    );
    if (interrupted || code === 130 || result?.stopReason === 'INTERRUPTED') break;
  }
  console.log(
    `\nSuite results ${bar(results.length, ids.length)} ${results.length}/${ids.length}:`,
  );
  for (const item of results) {
    console.log(
      item.result
        ? resultLines(item.result)
        : `${item.id}: Execution failed; assessment unavailable (exit ${item.code}).`,
    );
    if (
      item.result &&
      item.code !== 0 &&
      item.result.stopReason === 'completed' &&
      item.result.reviewCompleted
    )
      console.log(`  Process/cleanup failed (exit ${item.code}); saved evaluation completed.`);
  }
  if (results.some((result) => result.code !== 0) || results.length < ids.length)
    process.exitCode = 1;
}

async function run() {
  if (options.values.suite) {
    if (options.values.scenario) throw new BenchmarkError('Use --scenario or --suite, not both.');
    return runSuite(options.values.suite);
  }
  if (!options.values.scenario)
    throw new BenchmarkError(
      `Choose --scenario <id> or --suite pilot-v1. Scenarios: ${(await scenarioIds()).join(', ')}.`,
    );
  const scenario = await loadScenario(options.values.scenario, options.values.voice).catch(
    (error: unknown) => {
      throw new BenchmarkError(error instanceof Error ? error.message : 'Unknown scenario.');
    },
  );
  const credentials = await benchmarkCredentials();
  if (!options.values.scripted && !credentials.values.OPENAI_API_KEY)
    throw new BenchmarkError(
      'Set OPENAI_API_KEY in .env.bench.local, your shell, or --env-file before running a live scenario.',
    );
  if (
    !options.values.scripted &&
    credentials.values.AGENT_PROVIDER === 'anthropic' &&
    !credentials.values.ANTHROPIC_API_KEY
  )
    throw new BenchmarkError(
      'Set ANTHROPIC_API_KEY in .env.bench.local, your shell, or --env-file to run a Claude coach.',
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
  let releaseArtifacts: (() => Promise<void>) | undefined;
  let databaseStarted = false;
  let outputLog: Awaited<ReturnType<typeof open>> | undefined;
  let interaction = 0;
  let toolCount = 0;
  let toolStage = '';
  const display = process.send
    ? undefined
    : new BenchDisplay(
        '',
        options.values.verbose
          ? { write: (s) => process.stdout.write(s), isTTY: false, columns: 120 }
          : process.stdout,
      );
  const progress = (name: string) => {
    const value = {
      type: 'progress' as const,
      scenario: scenario.id,
      stage: name,
      interaction,
      maxMessages: scenario.limits.maxAthleteMessages,
      maxMinutes: scenario.limits.maxElapsedMinutes,
      tools: toolCount,
    };
    if (process.send) process.send(value);
    else display?.update(value);
  };
  const announce = (message: string) => {
    if (process.send) process.send({ type: 'notice', message });
    else {
      display?.finish();
      console.log(message);
    }
  };
  const transcript = (message: string) => {
    if (options.values.verbose) console.log(message);
  };
  const stage = async (name: string, executionPhase = phase) => {
    phase = executionPhase;
    progress(name);
    await artifacts.event({ stage: name });
    await artifacts.json('state.json', { runId, stage: name, owner, conversationId, activeRun });
  };
  try {
    await artifacts.init();
    outputLog = await open(resolve(artifacts.directory, 'execution.log'), 'a', 0o600);
    releaseArtifacts = await acquireLock(artifacts.directory);
    await writeFile(resolve(artifacts.directory, 'tool-trace.jsonl'), '', { mode: 0o600 });
    await writeFile(resolve(artifacts.directory, 'athlete-actions.jsonl'), '', { mode: 0o600 });
    await artifacts.json('scenario.json', scenario);
    // The opening request discloses its own facts before any simulator action.
    disclosed.push({ sequence: 1, factIds: scenario.openingFactIds });
    await artifacts.json('disclosures.json', disclosed);
    await artifacts.text('prompts/coach.md', COACHING_PROMPT);
    for (const [role, prompt] of Object.entries(EVALUATOR_PROMPTS))
      await artifacts.text(`prompts/${role}.md`, prompt.text);
    const manifest = {
      runId,
      startedAt: new Date().toISOString(),
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      workingTreeDirty:
        execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
          .length > 0,
      checksVersion: CHECKS_VERSION,
      scenarioEdition: scenario.edition,
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      scenarioHash: sha256(JSON.stringify(scenario)),
      personaId: scenario.persona.id,
      personaVersion: scenario.persona.version,
      voice: scenario.voice
        ? { id: scenario.voice.id, version: scenario.voice.version, label: scenario.voice.label }
        : null,
      prompts: {
        coach: { name: PROMPT_VERSION, hash: PROMPT_HASH, toolsHash: null as string | null },
        simulator: promptIdentity(EVALUATOR_PROMPTS.simulator),
        voice: scenario.voice ? promptIdentity(EVALUATOR_PROMPTS.voice) : null,
        reviewer: promptIdentity(EVALUATOR_PROMPTS.reviewer),
      },
      // Flat fields kept for earlier dashboard readers.
      promptVersion: PROMPT_VERSION,
      promptHash: PROMPT_HASH,
      simulatorVersion: SIMULATOR_VERSION,
      reviewerVersion: REVIEW_VERSION,
      scripted: options.values.scripted,
      environment,
      dates: scenario.dates,
      limits: scenario.limits,
    };
    await artifacts.json('manifest.json', manifest);
    timeout = setTimeout(
      () => abort.abort('TIME_LIMIT'),
      scenario.limits.maxElapsedMinutes * 60000,
    );
    transcript(`Run: ${runId}\nArtifacts: ${artifacts.directory}`);
    announce(
      `${scenario.id}: athlete message limit ${scenario.limits.maxAthleteMessages} (opening included); scenario time limit ${scenario.limits.maxElapsedMinutes} minutes.`,
    );
    await stage('Preparing isolated environment');
    await assertApiPortFree(environment.apiPort);
    databaseStarted = true;
    await compose(
      environment,
      ['up', '-d', '--wait', 'postgres'],
      abort.signal,
      options.values.verbose ? undefined : outputLog.fd,
    );
    await compose(
      environment,
      ['run', '--rm', 'migrate'],
      abort.signal,
      options.values.verbose ? undefined : outputLog.fd,
    );
    configureApi(environment, credentials.secret, credentials.publishable);
    operator = await import('@askesis/api/benchmark');
    // The coach's behaviour depends on its tool definitions as much as its prompt text.
    const tools = operator.benchmarkToolDefinitions();
    await artifacts.json('prompts/tools.json', tools);
    manifest.prompts.coach.toolsHash = sha256(JSON.stringify(tools));
    await artifacts.json('manifest.json', manifest);
    stopApi = await operator.startBenchmarkApi();
    const apiUrl = `http://127.0.0.1:${environment.apiPort}`;
    if (!(await fetch(`${apiUrl}/api/ready`, { signal: abort.signal })).ok)
      throw new BenchmarkError('The benchmark API is not ready.');
    const config = parseAgentConfig({
      ...credentials.values,
      AGENT_BOOTSTRAP_TOKEN: process.env.AGENT_BOOTSTRAP_TOKEN,
      AGENT_API_URL: apiUrl,
      // Generated development .env files deliberately leave provider keys empty.
      OPENAI_API_KEY: credentials.values.OPENAI_API_KEY || 'scripted-no-provider-request',
      ANTHROPIC_API_KEY: credentials.values.ANTHROPIC_API_KEY || 'scripted-no-provider-request',
    });
    const simulatorModel = evaluatorModel(
      credentials.values,
      credentials.values.BENCH_SIMULATOR_MODEL,
    );
    const reviewerModel = evaluatorModel(credentials.values, credentials.values.BENCH_REVIEW_MODEL);
    const evaluatorKey = credentials.values.OPENAI_API_KEY || 'scripted-no-provider-request';
    await artifacts.json('configuration.json', {
      coach: {
        provider: config.AGENT_PROVIDER,
        model: config.AGENT_MODEL,
        reasoning: config.AGENT_REASONING,
        maxTurns: config.AGENT_MAX_TURNS,
        maxOutputTokens: config.AGENT_MAX_OUTPUT_TOKENS,
      },
      simulatorModel,
      voiceModel: scenario.voice ? simulatorModel : null,
      reviewerModel,
    });
    announce(
      `Coach limits: ${config.AGENT_MAX_TURNS} model turns per reply, 200 tool operations, 15 minutes per run; ${config.AGENT_MAX_OUTPUT_TOKENS} output tokens per model response.`,
    );
    await stage('Starting coach');
    worker = startWorker(config, artifacts.directory, options.values.scripted ? scenario : null, {
      output: options.values.verbose ? undefined : outputLog.fd,
      onTool(name, status) {
        if (status === 'started') toolCount++;
        toolStage = `${name} ${status}`;
        progress(`Coach reply ${interaction}: ${toolStage}`);
      },
    });
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
    transcript(`Athlete: ${scenario.openingMessage}`);
    const simulator = new EvaluationModels(evaluatorKey, simulatorModel);
    const reviewer = new EvaluationModels(evaluatorKey, reviewerModel);
    stopReason = 'message_limit';
    for (let turn = 0; turn < scenario.limits.maxAthleteMessages; turn++) {
      interaction = turn + 1;
      toolStage = 'waiting for model';
      await stage(`Coach reply ${interaction}: ${toolStage}`, 'coach');
      let status = await operator.benchmarkRun(owner, activeRun);
      while (['queued', 'running', 'cancelling'].includes(status.status)) {
        await delay(500, undefined, { signal: abort.signal });
        status = await operator.benchmarkRun(owner, activeRun);
      }
      activeRun = undefined;
      snapshot = await operator.benchmarkSnapshot(owner, conversationId);
      await artifacts.snapshot(snapshot);
      const last = snapshot.messages.at(-1);
      if (last?.role === 'assistant') transcript(`Coach: ${last.content}`);
      if (status.status !== 'completed') {
        stopReason = status.failureCode ?? status.status;
        break;
      }
      if (hasExpectedCoverage(snapshot, scenario)) {
        stopReason = 'completed';
        break;
      }
      if (turn + 1 === scenario.limits.maxAthleteMessages) break;
      await stage('Athlete response', 'athlete');
      const response = await athleteResponse(
        scenario,
        snapshot,
        disclosed,
        simulator,
        usage,
        abort.signal,
      );
      transcript(`Athlete: ${response.content}`);
      const accepted = await operator.sendBenchmarkMessage(owner, conversationId, response.content);
      disclosed.push({ sequence: accepted.message.sequence, factIds: response.factIds });
      await artifacts.json('disclosures.json', disclosed);
      await artifacts.line('athlete-actions.jsonl', {
        at: new Date().toISOString(),
        sequence: accepted.message.sequence,
        ...response.record,
      });
      activeRun = accepted.run.id;
    }
    checks = checkPlan(
      snapshot!,
      scenario,
      disclosed.flatMap((item) => item.factIds),
    );
    await artifacts.json('checks.json', checks);
    await stage('Review running', 'review');
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
          scenario,
          disclosed.flatMap((item) => item.factIds),
        );
      }
      await artifacts.json('checks.json', checks);
      const verdict = overallVerdict(checks, review, stopReason);
      await artifacts.json('assessment.json', {
        verdict,
        checksVersion: CHECKS_VERSION,
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
      const result: RunResult = {
        type: 'result',
        scenario: scenario.id,
        stopReason,
        verdict,
        reviewCompleted: review !== null,
        messages: snapshot?.messages.filter((m) => m.role === 'user').length ?? interaction,
        maxMessages: scenario.limits.maxAthleteMessages,
        maxMinutes: scenario.limits.maxElapsedMinutes,
        report: resolve(artifacts.directory, 'report.md'),
        failedChecks: checks.filter((c) => c.status === 'fail').map((c) => c.id),
      };
      await artifacts.json('result.json', result);
      if (process.send) process.send(result);
      else {
        display?.finish();
        console.log(resultLines(result));
      }
      // Allow regrading completed evidence while --keep-alive retains only the API.
      await releaseArtifacts?.();
      releaseArtifacts = undefined;
      transcript(`Report: ${resolve(artifacts.directory, 'report.md')}`);
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
        try {
          await releaseArtifacts?.();
        } finally {
          try {
            if (databaseStarted)
              await compose(
                environment,
                ['down', '--remove-orphans'],
                undefined,
                options.values.verbose ? undefined : outputLog?.fd,
              );
          } finally {
            try {
              await release();
            } finally {
              removeInterruptHandlers();
              display?.finish();
              await outputLog?.close();
            }
          }
        }
      }
    }
  }
}

/**
 * The simulator selects facts; the voice step, when enabled, rewords exactly those facts. A
 * voiced reply that changes a figure, date or weekday is retried once, then the authored text is
 * used, so the disclosure ledger always matches what the coach read.
 */
async function athleteResponse(
  scenario: Scenario,
  snapshot: BenchmarkSnapshot,
  disclosed: Disclosure[],
  simulator: EvaluationModels,
  usage: { role: string; usage: ModelUsage }[],
  signal: AbortSignal,
) {
  const started = Date.now();
  let action: AthleteAction;
  if (options.values.scripted)
    action = { factIds: Object.keys(scenario.facts), intent: 'generate' };
  else {
    const result = await simulator.athlete(scenario, snapshot.messages, disclosed, signal);
    usage.push({ role: 'simulator', usage: result.usage });
    action = result.action;
  }
  const authored = renderAthleteAction(scenario, action);
  const record = {
    factIds: authored.factIds,
    intent: action.intent,
    simulator: { ms: Date.now() - started, scripted: options.values.scripted },
    authored: authored.content,
    voice: null as null | {
      id: string;
      status: 'voiced' | 'fallback' | 'skipped';
      attempts: { message: string; problems: string[]; usage: ModelUsage }[];
    },
    content: authored.content,
  };
  if (!scenario.voice) return { ...authored, record };
  if (options.values.scripted) {
    record.voice = { id: scenario.voice.id, status: 'skipped', attempts: [] };
    return { ...authored, record };
  }
  const attempts: { message: string; problems: string[]; usage: ModelUsage }[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await simulator.voice(
      scenario.voice,
      authored.statements,
      snapshot.messages,
      signal,
      attempts.at(-1)?.problems ?? [],
    );
    usage.push({ role: 'voice', usage: result.usage });
    const problems = voiceProblems(result.message, authored.statements);
    attempts.push({ message: result.message, problems, usage: result.usage });
    if (!problems.length) {
      record.voice = { id: scenario.voice.id, status: 'voiced', attempts };
      record.content = result.message;
      return { ...authored, content: result.message, record };
    }
  }
  record.voice = { id: scenario.voice.id, status: 'fallback', attempts };
  return { ...authored, record };
}

async function loadResolvedScenario(directory: string) {
  // Dates are saved at creation; a retry/review must not move them to another day.
  const saved = JSON.parse(await readFile(resolve(directory, 'scenario.json'), 'utf8')) as
    Scenario | { edition?: undefined };
  if (saved.edition !== 'v1')
    throw new BenchmarkError(
      'This run used the retired running-poc scenario format and cannot be regraded.',
    );
  return saved;
}

async function grade() {
  const runId = options.values.run;
  if (!runId || !/^[a-zA-Z0-9][\w.-]*$/.test(runId))
    throw new BenchmarkError('Use bench grade --run <run-id>.');
  const directory = resolve(root, 'benchmark-results', runId);
  const abort = new AbortController();
  const removeInterruptHandlers = installInterruptHandlers(() => abort.abort('INTERRUPTED'));
  let releaseReview: (() => Promise<void>) | undefined;
  try {
    releaseReview = await acquireLock(directory, 'review');
    await gradeSavedRun(runId, directory, abort.signal);
  } finally {
    try {
      await releaseReview?.();
    } finally {
      removeInterruptHandlers();
    }
  }
}

async function gradeSavedRun(runId: string, directory: string, signal: AbortSignal) {
  const credentials = await benchmarkCredentials(false);
  signal.throwIfAborted();
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
  const scenario = await loadResolvedScenario(directory);
  const model = evaluatorModel(credentials.values, credentials.values.BENCH_REVIEW_MODEL);
  const result = await new EvaluationModels(credentials.values.OPENAI_API_KEY, model).review(
    snapshot,
    disclosures,
    signal,
  );
  const checks = checkPlan(
    snapshot,
    scenario,
    disclosures.flatMap((item) => item.factIds),
  );
  const verdict = overallVerdict(checks, result.review, assessment.stopReason);
  // Once publication starts, finish all files even if interrupted during a write.
  signal.throwIfAborted();
  const artifacts = new Artifacts(directory);
  await artifacts.json(`assessment-before-review-${Date.now()}.json`, assessment);
  await artifacts.json('assessment.json', {
    verdict,
    stopReason: assessment.stopReason,
    review: result.review,
    checks,
    scripted: assessment.scripted,
    checksVersion: CHECKS_VERSION,
    regradedAt: new Date().toISOString(),
    reviewerModel: model,
    reviewerVersion: REVIEW_VERSION,
    reviewerPromptHash: promptIdentity(EVALUATOR_PROMPTS.reviewer).hash,
  });
  await artifacts.json(`review-${Date.now()}.json`, {
    ...result,
    model,
    reviewerVersion: REVIEW_VERSION,
    reviewerPromptHash: promptIdentity(EVALUATOR_PROMPTS.reviewer).hash,
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
      'pnpm bench run --scenario ID | --suite pilot-v1 [--voice persona|none|ID] [--env-file PATH] [--op] [--keep-alive] [--scripted] [--verbose]\npnpm bench grade --run RUN_ID [--env-file PATH] [--op]\npnpm bench calibrate [--split development|holdout|all] [--fixture ID] [--repeat 1..5] [--env-file PATH] [--op] [--list] [--assert] [--scripted]\n1Password: --op loads askesis-bench; override with --op-item ITEM --op-vault VAULT --op-field FIELD\npnpm bench stop\npnpm bench reset',
    );
    return;
  }
  if (options.positionals.length > 1)
    throw new BenchmarkError('Expected one command: run, grade, calibrate, stop or reset.');
  if (
    !options.values.op &&
    ['op-item', 'op-vault', 'op-field'].some(
      (key) => options.values[key as 'op-item' | 'op-vault' | 'op-field'] !== undefined,
    )
  )
    throw new BenchmarkError('--op-item, --op-vault and --op-field require --op.');
  if (options.values.op && !['run', 'grade', 'calibrate'].includes(command))
    throw new BenchmarkError('--op is supported by run, grade and calibrate.');
  if (command === 'run') return run();
  if (command === 'grade') return grade();
  if (command === 'calibrate') return calibrate();
  if (command === 'stop' || command === 'reset') {
    const environment = await localEnvironment();
    const release = await acquireLock();
    try {
      await compose(
        environment,
        command === 'reset'
          ? ['down', '--volumes', '--remove-orphans']
          : ['down', '--remove-orphans'],
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

async function calibrate() {
  const split = options.values.split;
  if (!['development', 'holdout', 'all'].includes(split))
    throw new BenchmarkError('Calibration split must be development, holdout or all.');
  const repeat = Number(options.values.repeat);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5)
    throw new BenchmarkError('Calibration repeat must be an integer from 1 to 5.');
  const suite = await loadFixtures(split as Split, options.values.fixture ?? []).catch((error) => {
    throw new BenchmarkError(
      error instanceof Error ? error.message : 'Could not load calibration fixtures.',
    );
  });
  if (options.values.list) {
    console.log(`Suite v${suite.version}: ${suite.labelStatus}`);
    for (const fixture of suite.fixtures)
      console.log(`${fixture.id} (${fixture.split}) — ${fixture.description}`);
    return;
  }
  const scripted = options.values.scripted;
  const credentials = await benchmarkCredentials(false);
  const key = credentials.values.OPENAI_API_KEY;
  if (!scripted && (!key || key.startsWith('op://')))
    throw new BenchmarkError(
      'Configure a resolved OPENAI_API_KEY in your shell or --env-file; use op run for 1Password references.',
    );
  const model = evaluatorModel(credentials.values, credentials.values.BENCH_REVIEW_MODEL);
  const reviewer = scripted ? undefined : new EvaluationModels(key!, model);
  const runId = `calibration-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const directory = resolve(root, 'benchmark-results', runId);
  const artifacts = new Artifacts(directory);
  await artifacts.init();
  await artifacts.json('manifest.json', {
    runId,
    startedAt: new Date().toISOString(),
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTreeDirty:
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
        .length > 0,
    suiteVersion: suite.version,
    labelStatus: suite.labelStatus,
    split,
    repeat,
    scripted,
    reviewerModel: scripted ? null : model,
    reviewerVersion: REVIEW_VERSION,
    reviewerPromptHash: promptIdentity(EVALUATOR_PROMPTS.reviewer).hash,
    fixtures: suite.fixtures.map((f) => ({ id: f.id, split: f.split, hash: fixtureHash(f) })),
  });
  const abort = new AbortController();
  const removeInterruptHandlers = installInterruptHandlers(() => {
    console.log('Stopping calibration; retaining completed judgments.');
    abort.abort('INTERRUPTED');
  });
  const timeout = setTimeout(() => abort.abort('TIME_LIMIT'), 30 * 60000);
  console.log(
    `Calibration: ${runId}\nArtifacts: ${directory}\n${suite.fixtures.length * repeat} ${scripted ? 'scripted checks (no model quality measured)' : `reviewer calls using ${model}`}.`,
  );
  try {
    const result = await runCalibration({
      directory,
      fixtures: suite.fixtures,
      repeat,
      scripted,
      signal: abort.signal,
      onProgress: console.log,
      reviewer: async (evidence, disclosures, signal) =>
        scripted
          ? {
              review: scriptedCalibrationReview(evidence),
              usage: { inputTokens: 0, outputTokens: 0 },
            }
          : reviewer!.review(evidence, disclosures, signal),
    });
    console.log(
      `Completed ${result.summary.completed}/${result.summary.requested}; fixture agreement ${result.summary.fixtureMatches}/${result.summary.completed}. Missed defects: ${result.summary.missedDefects}; false alarms: ${result.summary.falseAlarms}.\nReport: ${resolve(directory, 'report.md')}`,
    );
    if (
      result.operationalFailure ||
      (options.values.assert && result.summary.fixtureMatches !== result.summary.requested)
    )
      process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    removeInterruptHandlers();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof BenchmarkError
      ? error.message
      : 'Benchmark command failed. Check local configuration and saved artifacts.',
  );
  process.exitCode = 1;
});
