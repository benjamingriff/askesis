import type { AgentConfig } from '@askesis/agent/config';
import type { Scenario } from './scenario.js';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, fork, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, open, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';

export class BenchmarkError extends Error {}
export const root = resolve(import.meta.dirname, '../../..');
const LocalSchema = z
  .object({
    project: z.string(),
    apiPort: z.number().int().min(1024).max(65535),
    databasePort: z.number().int().min(1024).max(65535),
  })
  .strict();
export type LocalEnvironment = z.infer<typeof LocalSchema>;
export const localDirectory = resolve(root, '.bench');

export function environmentFor(
  worktree: string,
  overrides: NodeJS.ProcessEnv = {},
): LocalEnvironment {
  const hash = createHash('sha256').update(worktree).digest('hex');
  const offset = Number.parseInt(hash.slice(0, 6), 16) % 1000;
  const environment = LocalSchema.parse({
    project: `askesis-bench-${hash.slice(0, 12)}`,
    apiPort: Number(overrides.BENCH_API_PORT ?? 41000 + offset),
    databasePort: Number(overrides.BENCH_DATABASE_PORT ?? 57000 + offset),
  });
  if (environment.apiPort === environment.databasePort)
    throw new BenchmarkError('Benchmark API and database ports must differ.');
  return environment;
}

export async function localEnvironment() {
  await mkdir(localDirectory, { recursive: true, mode: 0o700 });
  const path = resolve(localDirectory, 'environment.json');
  const expected = environmentFor(root, process.env);
  if (existsSync(path)) {
    const saved = LocalSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    if (saved.project !== expected.project)
      throw new BenchmarkError('Benchmark environment belongs to another worktree.');
    if (
      (process.env.BENCH_API_PORT && saved.apiPort !== expected.apiPort) ||
      (process.env.BENCH_DATABASE_PORT && saved.databasePort !== expected.databasePort)
    )
      throw new BenchmarkError(
        'Ports differ from the saved benchmark environment. Reset it before changing ports.',
      );
    return saved;
  }
  await writeFile(path, JSON.stringify(expected, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return expected;
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}
export async function acquireLock(directory = localDirectory) {
  const lockPath = resolve(directory, 'run.lock');
  let handle;
  try {
    handle = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    const lock = z
      .object({ pid: z.number().int().positive() })
      .parse(JSON.parse(await readFile(lockPath, 'utf8')));
    throw new BenchmarkError(
      alive(lock.pid)
        ? 'A benchmark is already running in this worktree. Stop it with Ctrl+C first.'
        : `A stale benchmark lock remains. Its process has exited; remove ${lockPath} and retry.`,
    );
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid }));
  } finally {
    await handle.close();
  }
  return () => unlink(lockPath);
}

export async function compose(environment: LocalEnvironment, args: string[], signal?: AbortSignal) {
  // An explicit file/project and empty dotenv prevent inheriting another stack's configuration.
  if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://'))
    throw new BenchmarkError('Local benchmarks require a local Docker daemon.');
  const endpoint = execFileSync(
    'docker',
    ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
    { encoding: 'utf8' },
  ).trim();
  if (!endpoint.startsWith('unix://'))
    throw new BenchmarkError('The selected Docker context is not local.');
  await new Promise<void>((done, reject) => {
    const child = spawn(
      'docker',
      [
        'compose',
        '--env-file',
        '/dev/null',
        '--project-name',
        environment.project,
        '-f',
        resolve(root, 'compose.bench.yaml'),
        ...args,
      ],
      {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, BENCH_DATABASE_PORT: String(environment.databasePort) },
        ...(signal ? { signal } : {}),
      },
    );
    child.once('error', () =>
      reject(new BenchmarkError('Docker could not start or was interrupted.')),
    );
    child.once('exit', (code) =>
      code === 0
        ? done()
        : reject(new BenchmarkError('Benchmark Docker command failed. Check the output above.')),
    );
  });
}

export async function assertApiPortFree(port: number) {
  await new Promise<void>((done, reject) => {
    const server = createServer();
    server.once('error', () =>
      reject(
        new BenchmarkError(
          `Port ${port} is occupied. Stop the existing benchmark or choose BENCH_API_PORT before first setup.`,
        ),
      ),
    );
    server.listen(port, '127.0.0.1', () => server.close(() => done()));
  });
}

export async function loadCredentials(file?: string, requireClerk = true) {
  let values: NodeJS.ProcessEnv = {};
  for (const path of file
    ? [resolve(root, file)]
    : [resolve(root, '.env'), resolve(root, '.env.bench.local')]) {
    if (existsSync(path)) values = { ...values, ...parseEnv(await readFile(path, 'utf8')) };
    else if (file) throw new BenchmarkError('The supplied environment file does not exist.');
  }
  values = { ...values, ...process.env };
  if (!requireClerk) return { values, secret: '', publishable: '' };
  // Like dev:setup, only development Clerk keys may fall back to the main checkout.
  if (
    !values.CLERK_SECRET_KEY ||
    !(values.CLERK_PUBLISHABLE_KEY ?? values.VITE_CLERK_PUBLISHABLE_KEY)
  ) {
    const common = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: root, encoding: 'utf8' },
    ).trim();
    const path = resolve(dirname(common), '.env');
    if (existsSync(path)) {
      const main = parseEnv(await readFile(path, 'utf8'));
      values.CLERK_SECRET_KEY ??= main.CLERK_SECRET_KEY;
      values.CLERK_PUBLISHABLE_KEY ??=
        main.CLERK_PUBLISHABLE_KEY ?? main.VITE_CLERK_PUBLISHABLE_KEY;
    }
  }
  const secret = values.CLERK_SECRET_KEY;
  const publishable = values.CLERK_PUBLISHABLE_KEY ?? values.VITE_CLERK_PUBLISHABLE_KEY;
  if (!secret?.startsWith('sk_test_') || !publishable?.startsWith('pk_test_'))
    throw new BenchmarkError(
      'Configure Clerk development keys in .env.bench.local or supply --env-file.',
    );
  return { values, secret, publishable };
}

export function configureApi(environment: LocalEnvironment, secret: string, publishable: string) {
  // Never take a database URL, bootstrap token, execution mode or telemetry from dotenv.
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    SENTRY_DSN: '',
    BENCH_LOCAL_ENABLED: '1',
    BENCH_DATABASE_PORT: String(environment.databasePort),
    DATABASE_URL: `postgres://askesis_bench:askesis_bench@127.0.0.1:${environment.databasePort}/askesis_bench?sslmode=disable`,
    PORT: String(environment.apiPort),
    CHAT_EXECUTION_MODE: 'agent',
    AGENT_BOOTSTRAP_TOKEN: randomBytes(32).toString('hex'),
    CLERK_SECRET_KEY: secret,
    CLERK_PUBLISHABLE_KEY: publishable,
  });
}

export function installInterruptHandlers(stop: () => void) {
  // Keep listeners installed throughout cleanup. SDK signal handlers check for another
  // listener asynchronously; once() would disappear early and let the SDK exit first.
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return () => {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  };
}

export function startWorker(
  config: AgentConfig,
  directory: string,
  scriptedScenario: Scenario | null,
) {
  const child = fork(new URL('./worker.js', import.meta.url), [], {
    cwd: root,
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
    execArgv: [],
    // Terminal signals go to the driver first, allowing normal run cancellation.
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new BenchmarkError('Benchmark worker exited unexpectedly.')),
    );
    child.send({ type: 'start', config, directory, scriptedScenario }, (error) => {
      if (error) reject(error);
    });
  });
  return {
    done,
    stop() {
      if (child.connected) child.send({ type: 'stop' }, () => {});
    },
  };
}
