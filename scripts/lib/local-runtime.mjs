import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, fork } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

export const root = resolve(import.meta.dirname, '../..');
const stateDirectory = resolve(root, '.dev');
export const applications = [
  'local',
  'api',
  'web',
  'agent',
  'marketing',
  'evals',
  'usage',
  'mobile',
  'setup',
  'exec',
];

export function readEnvironment(path = resolve(root, '.env')) {
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
}

export function worktreeDefaults(path = root) {
  const hash = createHash('sha256').update(path).digest('hex');
  const offset = 1 + (Number.parseInt(hash.slice(0, 6), 16) % 799);
  return {
    COMPOSE_PROJECT_NAME: `askesis-local-${hash.slice(0, 12)}`,
    PORT: String(3000 + offset),
    API_PORT: String(3000 + offset),
    WEB_PORT: String(5173 + offset),
    POSTGRES_PORT: String(55000 + offset),
    // Stay below the browser-blocked SIP ports 5060/5061.
    MARKETING_PORT: String(4300 + (offset % 500)),
    EVALS_PORT: String(8100 + offset),
    USAGE_PORT: String(8900 + offset),
  };
}

export function developmentEnvironment(path = root, overrides = {}) {
  const file = readEnvironment(resolve(path, '.env'));
  const defaults = worktreeDefaults(path);
  if (existsSync(resolve(path, '.env'))) {
    // Existing configurations historically used compose.yaml's implicit project
    // and ports. Keep the same volume; fresh setup writes its isolated values.
    Object.assign(defaults, {
      COMPOSE_PROJECT_NAME: 'askesis',
      PORT: '3000',
      API_PORT: '3000',
      WEB_PORT: '8080',
      POSTGRES_PORT: '5432',
    });
  }
  const environment = { ...defaults, ...file, ...overrides };
  environment.COMPOSE_PROJECT_NAME =
    overrides.COMPOSE_PROJECT_NAME || file.COMPOSE_PROJECT_NAME || defaults.COMPOSE_PROJECT_NAME;
  environment.PORT = overrides.PORT ?? file.PORT ?? environment.API_PORT;
  return environment;
}

export function localEnvironment() {
  const environment = developmentEnvironment(root, process.env);
  if (!/^askesis[a-z0-9_-]*$/.test(environment.COMPOSE_PROJECT_NAME))
    throw new Error('Local Compose projects must have an askesis-prefixed name.');
  for (const key of [
    'PORT',
    'API_PORT',
    'WEB_PORT',
    'POSTGRES_PORT',
    'MARKETING_PORT',
    'EVALS_PORT',
    'USAGE_PORT',
  ]) {
    if (!/^\d+$/.test(environment[key]) || +environment[key] < 1024 || +environment[key] > 65535)
      throw new Error(`Invalid local port: ${key}.`);
  }
  return environment;
}

export async function assertPortAvailable(port) {
  await new Promise((done, reject) => {
    const server = createServer();
    server.once('error', () =>
      reject(new Error(`Port ${port} is occupied; stop its owner or configure another port.`)),
    );
    server.listen(Number(port), '0.0.0.0', () => server.close(done));
  });
}

function processIdentity(pid) {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return fields[0] === 'Z' ? undefined : fields[19];
    }
    return (
      execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

function isAlive(record) {
  return record?.identity !== undefined && processIdentity(record.pid) === record.identity;
}

function signalGroup(record, signal = 'SIGTERM') {
  if (!isAlive(record)) return;
  try {
    process.kill(process.platform === 'win32' ? record.pid : -record.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function statePath(app) {
  if (!applications.includes(app)) throw new Error(`Unknown app: ${app}.`);
  return resolve(stateDirectory, `${app}.json`);
}

function readState(app) {
  const path = statePath(app);
  if (!existsSync(path)) return undefined;
  const state = JSON.parse(readFileSync(path, 'utf8'));
  if (state.root !== root || state.app !== app || typeof state.owner !== 'string')
    throw new Error(`Invalid ${app} development state; inspect ${path}.`);
  return state;
}

function removeState(state) {
  if (readState(state.app)?.owner === state.owner) unlinkSync(statePath(state.app));
}

export class LocalSession {
  constructor(app, environment = localEnvironment(), { shutdownMilliseconds = 45000 } = {}) {
    this.environment = environment;
    this.controller = new AbortController();
    this.children = new Set();
    this.shutdownMilliseconds = shutdownMilliseconds;
    this.state = {
      root,
      app,
      owner: randomUUID(),
      pid: process.pid,
      identity: processIdentity(process.pid),
      project: environment.COMPOSE_PROJECT_NAME,
      children: [],
    };
    mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
    if (readState(app))
      throw new Error(
        `${app} already has a session. Use pnpm dev:status or pnpm dev:stop ${app} first.`,
      );
    writeFileSync(statePath(app), JSON.stringify(this.state), { flag: 'wx', mode: 0o600 });
    this.interrupt = () => {
      if (this.controller.signal.aborted) return;
      this.controller.abort();
      for (const child of this.children) signalGroup(child.record);
      // Start escalation here, including while run() is awaiting a stubborn job.
      this.escalation = setTimeout(() => {
        for (const child of this.children) signalGroup(child.record, 'SIGKILL');
      }, this.shutdownMilliseconds);
    };
    process.on('SIGINT', this.interrupt);
    process.on('SIGTERM', this.interrupt);
  }

  save() {
    const path = statePath(this.state.app);
    const temporary = `${path}.${this.state.owner}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state), { mode: 0o600 });
    renameSync(temporary, path);
  }

  start(command, args, { capture = false, env = this.environment, cwd = root } = {}) {
    if (this.controller.signal.aborted) throw new Error('Local session cancelled.');
    const child = fork(
      new URL('./process-runner.mjs', import.meta.url),
      [String(this.shutdownMilliseconds), command, ...args],
      {
        cwd,
        env,
        detached: process.platform !== 'win32',
        execArgv: [],
        stdio: capture
          ? ['ignore', 'pipe', 'inherit', 'ipc']
          : ['inherit', 'inherit', 'inherit', 'ipc'],
      },
    );
    const record = { pid: child.pid, identity: child.pid ? processIdentity(child.pid) : undefined };
    const task = { child, record, output: '' };
    child.on('message', (message) => {
      if (message.type === 'forced-stop') task.forcedResult = message.result;
    });
    if (capture)
      child.stdout.on('data', (data) => {
        task.output += data;
      });
    task.exit = new Promise((done) => {
      child.once('error', () => done({ code: 1 }));
      child.once('exit', (code, signal) => done(task.forcedResult ?? { code, signal }));
    }).then((result) => {
      this.children.delete(task);
      return result;
    });
    this.children.add(task);
    this.state.children.push(record);
    this.save();
    return task;
  }

  async run(command, args, options) {
    const task = this.start(command, args, options);
    const result = await task.exit;
    if (result.code !== 0 || this.controller.signal.aborted)
      throw new Error(
        this.controller.signal.aborted
          ? 'Local session cancelled.'
          : `${command} failed; check the output above.`,
      );
    return task.output.trim();
  }

  compose(args, options) {
    return this.run(
      'docker',
      [
        'compose',
        '--env-file',
        existsSync(resolve(root, '.env')) ? resolve(root, '.env') : '/dev/null',
        '--project-name',
        this.state.project,
        '-f',
        resolve(root, 'compose.yaml'),
        ...(this.state.networkFile ? ['-f', this.state.networkFile] : []),
        ...args,
      ],
      options,
    );
  }

  async database() {
    const environment = this.environment;
    const url = new URL(
      environment.DATABASE_URL ??
        `postgres://askesis:askesis@127.0.0.1:${environment.POSTGRES_PORT}/askesis`,
    );
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.pathname !== `/${environment.POSTGRES_DB ?? 'askesis'}` ||
      Number(url.port || 5432) !== Number(environment.POSTGRES_PORT) ||
      [...url.searchParams.keys()].some((key) => key !== 'sslmode')
    )
      throw new Error(
        'DATABASE_URL must match this worktree’s loopback PostgreSQL port/database. Run pnpm dev:setup or correct .env.',
      );
    environment.DATABASE_URL = url.href;
    this.state.dockerHost = resolveLocalDockerHost(environment);
    environment.DOCKER_HOST = this.state.dockerHost;
    delete environment.DOCKER_CONTEXT;
    this.save();
    const existing = await this.run(
      'docker',
      [
        'ps',
        '--filter',
        `label=com.docker.compose.project=${this.state.project}`,
        '--filter',
        'label=com.docker.compose.service=postgres',
        '--format',
        '{{.ID}}',
      ],
      { capture: true },
    );
    if (existing.includes('\n'))
      throw new Error(
        'Multiple PostgreSQL containers found for this worktree; inspect Docker before starting another.',
      );
    let container = existing;
    if (!container) {
      await assertPortAvailable(environment.POSTGRES_PORT);
      this.state.container = `${this.state.project}-dev-postgres`;
      this.save();
      if (environment.DEV_NETWORK_SUBNET) {
        const subnet = environment.DEV_NETWORK_SUBNET;
        if (
          !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}\/(?:[1-9]|[12][0-9]|30)$/.test(subnet) ||
          subnet
            .split('/')[0]
            .split('.')
            .some((value) => +value > 255)
        )
          throw new Error(
            'DEV_NETWORK_SUBNET must be an explicit IPv4 CIDR checked against LAN/VPN/Docker routes.',
          );
        this.state.networkFile = resolve(stateDirectory, `${this.state.owner}.network.json`);
        writeFileSync(
          this.state.networkFile,
          JSON.stringify({ networks: { default: { ipam: { config: [{ subnet }] } } } }),
          { mode: 0o600 },
        );
        this.save();
      }
      container = await this.compose(
        [
          'run',
          '--rm',
          '--no-deps',
          '--use-aliases',
          '--service-ports',
          '--detach',
          '--name',
          this.state.container,
          '--label',
          `askesis.worktree=${root}`,
          '--label',
          `askesis.owner=${this.state.owner}`,
          'postgres',
        ],
        { capture: true },
      );
    }
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const status = JSON.parse(
        await this.run('docker', ['inspect', '--format', '{{json .State}}', container], {
          capture: true,
        }),
      );
      if (status.Running && status.Health?.Status === 'healthy') return;
      if (!status.Running || status.Health?.Status === 'unhealthy')
        throw new Error('Local PostgreSQL failed its health check.');
      await delay(200);
    }
    throw new Error('Local PostgreSQL readiness timed out.');
  }

  async close() {
    this.interrupt();
    const tasks = [...this.children];
    for (const task of tasks) signalGroup(task.record);
    try {
      await Promise.all(tasks.map((task) => task.exit));
      await removeOwnedDatabase(this.state);
      removeState(this.state);
    } finally {
      clearTimeout(this.escalation);
      process.removeListener('SIGINT', this.interrupt);
      process.removeListener('SIGTERM', this.interrupt);
    }
  }
}

export function resolveLocalDockerHost(environment = localEnvironment()) {
  // Explicit contexts override hosts in Docker's CLI. Pin the resolved socket for
  // the entire session, including cleanup if the default context later changes.
  const endpoint =
    environment.DOCKER_CONTEXT || !environment.DOCKER_HOST
      ? execFileSync(
          'docker',
          [
            'context',
            'inspect',
            ...(environment.DOCKER_CONTEXT ? [environment.DOCKER_CONTEXT] : []),
            '--format',
            '{{.Endpoints.docker.Host}}',
          ],
          {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 10000,
            env: environment,
          },
        ).trim()
      : environment.DOCKER_HOST;
  if (!endpoint.startsWith('unix://'))
    throw new Error(
      'Local development requires a local Docker socket; remote Docker contexts/hosts are refused.',
    );
  return endpoint;
}

function docker(args, host) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60000,
    env: host ? { ...process.env, DOCKER_HOST: host, DOCKER_CONTEXT: undefined } : process.env,
  }).trim();
}

async function removeOwnedDatabase(state) {
  if (!state.container) return;
  const ids = docker(
    [
      'ps',
      '-aq',
      '--filter',
      `name=^/${state.container}$`,
      '--filter',
      `label=askesis.worktree=${root}`,
      '--filter',
      `label=askesis.owner=${state.owner}`,
    ],
    state.dockerHost,
  );
  if (ids) docker(['stop', '--time', '20', ...ids.split('\n')], state.dockerHost);
  removeEmptyNetwork(state.project, state.dockerHost);
  if (
    state.networkFile === resolve(stateDirectory, `${state.owner}.network.json`) &&
    existsSync(state.networkFile)
  )
    unlinkSync(state.networkFile);
}

function removeEmptyNetwork(project, host) {
  const networks = docker(
    [
      'network',
      'ls',
      '-q',
      '--filter',
      `label=com.docker.compose.project=${project}`,
      '--filter',
      'label=com.docker.compose.network=default',
    ],
    host,
  );
  for (const network of networks.split('\n').filter(Boolean)) {
    if (docker(['network', 'inspect', '--format', '{{len .Containers}}', network], host) === '0')
      docker(['network', 'rm', network], host);
  }
}

export async function stopSessions(app) {
  for (const name of app ? [app] : applications) {
    const state = readState(name);
    if (!state) continue;
    if (isAlive(state)) {
      process.kill(state.pid, 'SIGTERM');
      const deadline = Date.now() + 60000;
      while (isAlive(state) && Date.now() < deadline) await delay(100);
      if (isAlive(state))
        throw new Error(`${name} did not stop; inspect its terminal before retrying.`);
    }
    for (const child of state.children) signalGroup(child);
    const deadline = Date.now() + 45000;
    while (state.children.some(isAlive) && Date.now() < deadline) await delay(100);
    for (const child of state.children) signalGroup(child, 'SIGKILL');
    await removeOwnedDatabase(state);
    removeState(state);
    console.log(`Stopped ${name}; database data retained.`);
  }
}

export function sessionStatus() {
  const records = existsSync(stateDirectory)
    ? readdirSync(stateDirectory).filter((name) =>
        applications.some((app) => name === `${app}.json`),
      )
    : [];
  if (!records.length) console.log('No managed development sessions in this worktree.');
  for (const file of records) {
    const state = readState(file.slice(0, -5));
    console.log(
      `${state.app}: ${isAlive(state) ? 'running' : 'stale (recover with pnpm dev:stop)'}${state.url ? ` · ${state.url}` : ''}`,
    );
  }
}

export async function cleanDevelopment(deleteData) {
  const environment = localEnvironment();
  const project = environment.COMPOSE_PROJECT_NAME;
  const host = resolveLocalDockerHost(environment);
  if (deleteData && project !== worktreeDefaults().COMPOSE_PROJECT_NAME)
    throw new Error('Automatic data deletion requires this worktree’s generated Compose project.');
  await stopSessions();
  const running = docker(
    ['ps', '-q', '--filter', `label=com.docker.compose.project=${project}`],
    host,
  );
  if (running)
    throw new Error(
      'This worktree has unmanaged running containers; stop their owner before cleaning.',
    );
  removeEmptyNetwork(project, host);
  if (deleteData) {
    const volumes = docker(
      [
        'volume',
        'ls',
        '-q',
        '--filter',
        `label=com.docker.compose.project=${project}`,
        '--filter',
        'label=com.docker.compose.volume=postgres_data',
      ],
      host,
    );
    if (volumes) docker(['volume', 'rm', ...volumes.split('\n')], host);
    console.log('Removed only this worktree’s development database volume.');
  } else
    console.log(
      'Development sessions cleaned; database data retained. Use pnpm dev:clean --data to delete it.',
    );
}
