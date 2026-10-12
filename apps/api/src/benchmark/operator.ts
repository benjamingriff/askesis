/** Local operator entry point. No benchmark routes or authentication bypass are registered. */
import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { app } from '../app.js';
import { getApiConfig } from '../config.js';
import { getDatabase, closeDatabase } from '../database/client.js';
import { startAgentSweeper } from '../modules/agent/agent.sweeper.js';
import { workerReady } from '../modules/agent/agent.service.js';
import {
  createConversation,
  sendMessage,
  getConversation,
  getRun,
  cancelRun,
  listMessages,
} from '../modules/chat/chat.service.js';
import { getOutput } from '../modules/live/live.service.js';
import { getPlan } from '../modules/plans/plan.service.js';
import { getBrief } from '../modules/plans/brief.service.js';
import { readAggregate } from '../modules/plans/plan.aggregate.js';
import { validatePlan } from '../modules/plans/plan.validation.js';
import { getPerformance } from '../modules/performance/performance.service.js';
import {
  listBlocks,
  listWorkouts,
  getWorkoutDetail,
} from '../modules/workouts/workout.repository.js';

export function assertBenchmarkDatabase() {
  const config = getApiConfig();
  const expected = `postgres://askesis_bench:askesis_bench@127.0.0.1:${process.env.BENCH_DATABASE_PORT}/askesis_bench?sslmode=disable`;
  if (
    process.env.BENCH_LOCAL_ENABLED !== '1' ||
    config.NODE_ENV === 'production' ||
    config.DATABASE_URL !== expected
  )
    throw new Error('Benchmark operators require the dedicated local benchmark database.');
}

export async function startBenchmarkApi() {
  assertBenchmarkDatabase();
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: getApiConfig().PORT });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const stopSweeper = startAgentSweeper();
  return async () => {
    await stopSweeper();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await closeDatabase();
  };
}

export async function benchmarkWorkerReady() {
  assertBenchmarkDatabase();
  return workerReady();
}

export async function createBenchmarkAthlete(timezone: string) {
  assertBenchmarkDatabase();
  const id = randomUUID();
  await getDatabase()
    .insertInto('athletes')
    .values({ id, display_name: 'Benchmark runner', timezone })
    .execute();
  return id;
}

export async function startBenchmarkConversation(owner: string, content: string) {
  assertBenchmarkDatabase();
  return createConversation(owner, { initialMessage: { content, target: null } }, randomUUID());
}

export async function sendBenchmarkMessage(owner: string, conversationId: string, content: string) {
  assertBenchmarkDatabase();
  const conversation = await getConversation(owner, conversationId);
  const target = conversation.context
    ? { versionId: conversation.context.versionId, editNumber: conversation.context.editNumber }
    : null;
  return sendMessage(owner, conversationId, { content, target }, randomUUID());
}

export async function benchmarkRun(owner: string, runId: string) {
  assertBenchmarkDatabase();
  return getRun(owner, runId);
}

export async function cancelBenchmarkRun(owner: string, runId: string) {
  assertBenchmarkDatabase();
  return cancelRun(owner, runId);
}

export async function benchmarkSnapshot(owner: string, conversationId: string) {
  assertBenchmarkDatabase();
  const conversation = await getConversation(owner, conversationId);
  const { messages } = await listMessages(owner, conversationId, undefined, 100);
  const db = getDatabase();
  const runs = await db
    .selectFrom('agent_runs')
    .select([
      'id',
      'status',
      'failure_code',
      'provider',
      'model',
      'reasoning',
      'prompt_version',
      'input_tokens',
      'output_tokens',
      'created_at',
      'started_at',
      'finished_at',
    ])
    .where('owner_id', '=', owner)
    .where('conversation_id', '=', conversationId)
    .orderBy('created_at')
    .execute();
  const outputs = await Promise.all(runs.map((run) => getOutput(owner, run.id)));
  const receipts = runs.length
    ? await db
        .selectFrom('agent_tool_receipts')
        .select(['run_id', 'operation_id', 'tool_name', 'response', 'created_at'])
        .where(
          'run_id',
          'in',
          runs.map((run) => run.id),
        )
        .orderBy('created_at')
        .execute()
    : [];
  const performance = await getPerformance(owner);
  if (!conversation.planId)
    return { conversation, messages, runs, outputs, receipts, performance, plan: null };
  const header = await getPlan(owner, conversation.planId);
  const version = header.draft ?? header.locked;
  if (!version) return { conversation, messages, runs, outputs, receipts, performance, plan: null };
  const [brief, blocks, summaries, aggregate] = await Promise.all([
    getBrief(owner, header.id),
    listBlocks(owner, version.id),
    listWorkouts(owner, version.id),
    readAggregate(db, version.id),
  ]);
  const workouts = await Promise.all(
    summaries.map((workout) => getWorkoutDetail(owner, workout.id)),
  );
  return {
    conversation,
    messages,
    runs,
    outputs,
    receipts,
    performance,
    plan: {
      header,
      brief,
      blocks,
      workouts: workouts.filter((workout) => workout !== null),
      semantic: aggregate.semantic,
      findings: validatePlan(aggregate.validation),
    },
  };
}

export type BenchmarkSnapshot = Awaited<ReturnType<typeof benchmarkSnapshot>>;
