import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  root,
  developmentEnvironment,
  localEnvironment,
  worktreeDefaults,
  resolveLocalDockerHost,
  assertPortAvailable,
  applications,
} from './local-runtime.mjs';

const matrix = [
  ['local', 'pnpm dev', 'API + web + temporary PostgreSQL; root .env'],
  ['api', 'pnpm dev:api', 'API + temporary PostgreSQL; root .env'],
  ['web', 'pnpm dev:web', 'Web; running API required; root .env'],
  ['agent', 'pnpm dev:agent', 'Worker; running API/provider required; apps/agent/.env'],
  ['marketing', 'pnpm dev:marketing', 'Astro; no Docker or auth'],
  ['evals', 'pnpm dev:evals', 'Artifact viewer; no Docker or auth'],
  ['mobile', 'pnpm dev:mobile', 'Expo/npm; npm ci --prefix apps/mobile first'],
  ['exec', 'pnpm dev:exec -- COMMAND [ARGS]', 'One-off command + temporary PostgreSQL'],
];

export function developmentHelp(app) {
  const rows = matrix.filter(([name]) => !app || app === name);
  console.log('Foreground local development (Node 24, pnpm 11.18.0):');
  for (const [name, command, description] of rows)
    console.log(`  ${command}\n    ${description}. Stop: Ctrl+C or pnpm dev:stop ${name}.`);
  console.log(`\nInspect: pnpm dev:status | pnpm dev:doctor [app] | pnpm dev:list [--json]
Recover: pnpm dev:stop [app]
Clean:   pnpm dev:clean (retains data); --data deletes only the generated worktree DB
Help:    pnpm dev --help | pnpm dev:marketing --help (and other apps)
Docs:    docs/operations/local-development.md`);
}

function command(file, args, env = process.env) {
  return execFileSync(file, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function dockerEnvironment(environment) {
  return {
    ...environment,
    DOCKER_HOST: resolveLocalDockerHost(environment),
    DOCKER_CONTEXT: undefined,
  };
}

function sessions(path) {
  const directory = resolve(path, '.dev');
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => applications.some((app) => name === `${app}.json`))
    .map((name) => {
      try {
        const record = JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
        if (record.root !== path) return { app: name.slice(0, -5), status: 'invalid state' };
        let alive = false;
        try {
          if (process.platform === 'linux') {
            const stat = readFileSync(`/proc/${record.pid}/stat`, 'utf8');
            const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            alive = fields[0] !== 'Z' && fields[19] === record.identity;
          } else {
            alive = command('ps', ['-p', String(record.pid), '-o', 'lstart=']) === record.identity;
          }
        } catch {
          /* Stale owner. */
        }
        return { app: record.app, status: alive ? 'running' : 'stale' };
      } catch {
        return { app: name.slice(0, -5), status: 'invalid state' };
      }
    });
}

export async function developmentDoctor(app = 'local') {
  if (!matrix.some(([name]) => name === app)) throw new Error(`Unknown application: ${app}.`);
  let failures = 0;
  const check = (ok, message) => {
    console.log(`${ok ? 'OK' : 'CHECK'} ${message}`);
    if (!ok) failures++;
  };
  check(
    Number(process.versions.node.split('.')[0]) === 24,
    `Node ${process.versions.node}; requires 24.x`,
  );
  try {
    const version = command('pnpm', ['--version']);
    check(version === '11.18.0', `pnpm ${version}; pinned 11.18.0`);
  } catch {
    check(false, 'pnpm unavailable');
  }
  check(
    existsSync(resolve(root, app === 'mobile' ? 'apps/mobile/node_modules' : 'node_modules')),
    'Dependencies installed',
  );
  const environment = localEnvironment();
  if (['local', 'api', 'exec'].includes(app)) {
    check(
      existsSync(resolve(root, '.env')),
      'Root .env exists; run pnpm dev:setup for a fresh worktree',
    );
    check(
      environment.CLERK_SECRET_KEY?.startsWith('sk_test_') &&
        (environment.CLERK_PUBLISHABLE_KEY ?? environment.VITE_CLERK_PUBLISHABLE_KEY)?.startsWith(
          'pk_test_',
        ),
      'Clerk development keys configured (values withheld)',
    );
    const expected = new URL(
      `postgres://askesis:askesis@127.0.0.1:${environment.POSTGRES_PORT}/${environment.POSTGRES_DB ?? 'askesis'}`,
    );
    let matches = false;
    try {
      const url = new URL(environment.DATABASE_URL ?? expected);
      matches =
        ['postgres:', 'postgresql:'].includes(url.protocol) &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
        Number(url.port || 5432) === +environment.POSTGRES_PORT &&
        url.pathname === expected.pathname &&
        [...url.searchParams.keys()].every((key) => key === 'sslmode');
    } catch {
      /* Invalid URL. */
    }
    check(matches, 'Database URL matches this worktree’s loopback port/database');
    try {
      const env = dockerEnvironment(environment);
      const version = command('docker', ['version', '--format', '{{.Server.Version}}'], env);
      check(true, `Local Docker daemon reachable (${version})`);
      check(
        !!command('docker', ['compose', 'version', '--short'], env),
        'Docker Compose available',
      );
      const networks = command(
        'docker',
        ['network', 'ls', '--filter', 'driver=bridge', '--format', '{{.ID}}'],
        env,
      )
        .split('\n')
        .filter(Boolean);
      console.log(
        `INFO ${networks.length} bridge networks; exhausted address pools require owner inspection, never global pruning.`,
      );
    } catch {
      check(
        false,
        'Local Docker unavailable or selected context is remote; inspect DOCKER_HOST/DOCKER_CONTEXT and daemon',
      );
    }
  }
  if (['local', 'web'].includes(app)) {
    const web = `http://localhost:${environment.WEB_PORT}`;
    const api = `http://127.0.0.1:${environment.PORT}`;
    check(
      !environment.LOCAL_WEB_URL || environment.LOCAL_WEB_URL === web,
      'LOCAL_WEB_URL matches WEB_PORT',
    );
    let proxyMatches = false;
    try {
      const proxy = new URL(environment.VITE_API_PROXY_TARGET ?? api);
      proxyMatches =
        ['localhost', '127.0.0.1', '[::1]'].includes(proxy.hostname) &&
        +proxy.port === +environment.PORT &&
        proxy.protocol === 'http:' &&
        !proxy.username &&
        !proxy.password &&
        !proxy.search &&
        proxy.pathname === '/';
    } catch {
      /* Invalid URL. */
    }
    check(proxyMatches, 'Vite proxy matches this worktree API port');
    check(
      !environment.CLERK_AUTHORIZED_PARTIES ||
        environment.CLERK_AUTHORIZED_PARTIES.split(',')
          .map((x) => x.trim())
          .includes(web),
      'Clerk authorized origins include this web origin',
    );
  }
  const keys = {
    local: ['PORT', 'WEB_PORT', 'POSTGRES_PORT'],
    api: ['PORT', 'POSTGRES_PORT'],
    exec: ['POSTGRES_PORT'],
    web: ['WEB_PORT'],
    marketing: ['MARKETING_PORT'],
    evals: ['EVALS_PORT'],
    agent: [],
    mobile: [],
  }[app];
  const records = sessions(root);
  console.log(
    `INFO Managed sessions: ${records.map((record) => `${record.app} (${record.status})`).join(', ') || 'none'}`,
  );
  for (const key of keys) {
    try {
      await assertPortAvailable(environment[key]);
      console.log(`INFO ${key} ${environment[key]} available`);
    } catch {
      let owner = 'owner unavailable';
      try {
        owner =
          process.platform === 'linux'
            ? command('ss', ['-H', '-ltnp', `sport = :${environment[key]}`])
                .split('\n')
                .map((line) => line.match(/users:\(.+/)?.[0] ?? 'PID unavailable')
                .join('; ')
            : command('lsof', [
                '-nP',
                `-iTCP:${environment[key]}`,
                '-sTCP:LISTEN',
                '-Fpc',
              ]).replaceAll('\n', ' ');
      } catch {
        /* Process inspection may not be installed/permitted. */
      }
      console.log(
        `CHECK ${key} ${environment[key]} occupied (${owner}); inspect dev:status/dev:list before starting another listener`,
      );
    }
  }
  if (['local', 'api', 'web'].includes(app)) {
    try {
      check(
        (
          await fetch(`http://127.0.0.1:${environment.PORT}/api/ready`, {
            signal: AbortSignal.timeout(1000),
          })
        ).ok,
        'Running API ready',
      );
    } catch {
      console.log('INFO API stopped/unreachable (normal before pnpm dev)');
    }
  }
  console.log('Read-only diagnostics complete; no services started or stopped.');
  if (failures) process.exitCode = 1;
}

export function developmentInventory(json = false) {
  const paths = command('git', ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice(9));
  const worktrees = paths.map((path) => {
    const environment = developmentEnvironment(path);
    return {
      path,
      exists: existsSync(path),
      project: environment.COMPOSE_PROJECT_NAME,
      benchmarkProject: `askesis-bench-${worktreeDefaults(path).COMPOSE_PROJECT_NAME.slice(-12)}`,
      ports: Object.fromEntries(
        ['PORT', 'WEB_PORT', 'POSTGRES_PORT', 'MARKETING_PORT', 'EVALS_PORT'].map((key) => [
          key,
          environment[key],
        ]),
      ),
      sessions: sessions(path),
    };
  });
  const report = {
    worktrees,
    containers: [],
    volumes: [],
    networks: [],
    docker: 'unavailable or remote',
  };
  try {
    const env = dockerEnvironment(localEnvironment());
    const owner = (labels) => {
      const path = labels['askesis.worktree'] ?? labels['com.docker.compose.project.working_dir'];
      const project = labels['com.docker.compose.project'];
      const matches = worktrees.filter((w) =>
        path ? w.path === path : [w.project, w.benchmarkProject].includes(project),
      );
      return {
        path: path ?? (matches.length === 1 ? matches[0].path : undefined),
        ownership:
          matches.length === 1
            ? matches[0].exists
              ? 'registered'
              : 'missing worktree path'
            : matches.length > 1
              ? 'shared project (ambiguous)'
              : path
                ? 'unregistered worktree'
                : 'unknown; inspect manually',
        project,
      };
    };
    const inspect = (kind, ids) =>
      ids.length ? JSON.parse(command('docker', [kind, 'inspect', ...ids], env)) : [];
    const containerIds = command('docker', ['ps', '-aq'], env).split('\n').filter(Boolean);
    report.containers = (
      containerIds.length ? JSON.parse(command('docker', ['inspect', ...containerIds], env)) : []
    )
      .filter(
        (item) =>
          item.Name.includes('askesis') ||
          Object.keys(item.Config.Labels ?? {}).some((label) => label.startsWith('askesis.')) ||
          item.Config.Labels?.['com.docker.compose.project']?.startsWith('askesis'),
      )
      .map((item) => ({
        name: item.Name.slice(1),
        status: item.State.Status,
        ...owner(item.Config.Labels ?? {}),
        ports: item.NetworkSettings.Ports,
      }));
    for (const kind of ['volume', 'network']) {
      const ids = command('docker', [kind, 'ls', '-q'], env).split('\n').filter(Boolean);
      report[`${kind}s`] = inspect(kind, ids)
        .filter(
          (item) =>
            item.Name.startsWith('askesis') ||
            item.Labels?.['com.docker.compose.project']?.startsWith('askesis'),
        )
        .map((item) => ({
          name: item.Name,
          ...owner(item.Labels ?? {}),
          ...(kind === 'network'
            ? {
                subnets: item.IPAM?.Config?.map((config) => config.Subnet),
                containers: Object.keys(item.Containers ?? {}).length,
              }
            : {}),
        }));
    }
    report.docker = 'local; read-only inventory';
  } catch {
    /* Return Git inventory even when Docker is unavailable. */
  }
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Registered worktrees (${report.docker}):`);
    for (const w of worktrees)
      console.log(
        `  ${w.path}${w.exists ? '' : ' [missing]'}\n    ${w.project}; API ${w.ports.PORT}, web ${w.ports.WEB_PORT}, DB ${w.ports.POSTGRES_PORT}; sessions: ${w.sessions.map((s) => `${s.app}:${s.status}`).join(', ') || 'none'}`,
      );
    for (const kind of ['containers', 'volumes', 'networks']) {
      console.log(`\nAskesis ${kind}:`);
      for (const resource of report[kind])
        console.log(
          `  ${resource.name}: ${resource.status ?? resource.subnets?.join(', ') ?? 'retained data'} · ${resource.ownership}${resource.path ? ` · ${resource.path}` : ''}`,
        );
    }
    console.log(
      '\nNo resources changed. Unknown/unregistered volumes are retained data, not automatically disposable. Use --json for ports and full inventory metadata.',
    );
  }
  return report;
}
