import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { worktreeDefaults } from './lib/local-runtime.mjs';

const repository = resolve(import.meta.dirname, '..');
const fake = `#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
const name = require('node:path').basename(process.argv[1]);
const args = process.argv.slice(2);
const path = process.env.DEV_TEST_LOG;
const statePath = process.env.DEV_TEST_DATABASE;
const record = (event, extra = {}) => fs.appendFileSync(path, JSON.stringify({name,args,event,...extra})+'\\n');
const read = () => fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath,'utf8')) : {};
const save = (state) => fs.writeFileSync(statePath, JSON.stringify(state));
record('start', {host:process.env.DOCKER_HOST,context:process.env.DOCKER_CONTEXT});
if (name === 'docker') {
  if (args[0] === 'context') console.log(process.env.DEV_TEST_ENDPOINT || 'unix:///fake/docker.sock');
  else if (args[0] === 'ps') {
    const state = read();
    if (process.env.DEV_TEST_INVENTORY && args.includes('-aq')) console.log('inventory-db');
    else if (args.includes('-aq')) {
      const owner = args.find(arg=>arg.startsWith('label=askesis.owner='))?.slice('label=askesis.owner='.length);
      if (state.owner && owner === state.owner) console.log('owned-db');
    } else if (state.running || process.env.DEV_TEST_REUSE) console.log('existing-db');
  } else if (args[0] === 'inspect') {
    if (process.env.DEV_TEST_INVENTORY) console.log(JSON.stringify([{Name:'/askesis-inventory', State:{Status:'running'}, Config:{Labels:{'askesis.worktree':process.cwd(),'com.docker.compose.project':'askesis-inventory'}},NetworkSettings:{Ports:{'5432/tcp':[{HostPort:'55432'}]}}}]));
    else console.log(JSON.stringify({Running:!process.env.DEV_TEST_HEALTH_FAIL,Health:{Status:'healthy'}}));
  } else if (args[0] === 'compose' && args.includes('run') && args.at(-1) === 'postgres') {
    const owner=args.find(arg=>arg.startsWith('askesis.owner='))?.slice('askesis.owner='.length);
    save({running:true,owner,network:true}); console.log('owned-db');
  } else if (args[0] === 'compose' && process.env.DEV_TEST_COMPOSE_FAIL && args.includes('up')) process.exit(2);
  else if (args[0] === 'stop') { save({...read(),running:false,owner:null}); }
  else if (args[0] === 'network' && args[1] === 'ls') { if(read().network) console.log('owned-net'); }
  else if (args[0] === 'network' && args[1] === 'inspect') console.log('0');
  else if (args[0] === 'network' && args[1] === 'rm') save({...read(),network:false});
  else if (args[0] === 'volume' && args[1] === 'inspect') console.log('[]');
  else if (args[0] === 'volume' && args[1] === 'ls') console.log('owned-volume');
  process.exit(0);
}
if (args.includes('verification:prepare') && process.env.DEV_TEST_PREPARE_FAIL) process.exit(2);
if (args.includes('--version')) {console.log('11.18.0');process.exit(0);}
if (!args.includes('dev')) process.exit(0);
const app = args[args.indexOf('--filter')+1].split('/')[1];
record('app', {app, agentUrl:process.env.AGENT_API_URL,rootSecret:!!process.env.CLERK_SECRET_KEY,rootProvider:!!process.env.OPENAI_API_KEY});
if (app === process.env.DEV_TEST_APP_FAIL) process.exit(2);
const port = {api:process.env.PORT,web:process.env.WEB_PORT,marketing:process.env.MARKETING_PORT,evals:process.env.EVALS_PORT}[app];
if (port) {
 const server=http.createServer((request,response)=>{response.end('ready');});
 server.listen(Number(port),'127.0.0.1',()=>record('listening',{app}));
 process.on('SIGTERM',()=>server.close(()=>{record('stopped',{app});process.exit(0);}));
} else {
 setInterval(()=>{},1000);
 process.on('SIGTERM',()=>{record('stopped',{app});process.exit(0);});
}
`;

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), 'askesis-local-test-'));
  await cp(resolve(repository, 'scripts'), resolve(directory, 'scripts'), { recursive: true });
  await cp(resolve(repository, 'database'), resolve(directory, 'database'), { recursive: true });
  await writeFile(resolve(directory, 'compose.yaml'), 'services: {}\n');
  await mkdir(resolve(directory, 'bin'));
  for (const name of ['docker', 'pnpm'])
    await writeFile(resolve(directory, 'bin', name), fake, { mode: 0o755 });
  const ports = await Promise.all(Array.from({ length: 5 }, freePort));
  const configuration = {
    PORT: ports[0],
    API_PORT: ports[0],
    WEB_PORT: ports[1],
    POSTGRES_PORT: ports[2],
    MARKETING_PORT: ports[3],
    EVALS_PORT: ports[4],
    COMPOSE_PROJECT_NAME: worktreeDefaults(directory).COMPOSE_PROJECT_NAME,
    DATABASE_URL: `postgres://askesis:askesis@127.0.0.1:${ports[2]}/askesis`,
    CLERK_SECRET_KEY: 'root-test-secret',
    OPENAI_API_KEY: 'root-test-provider',
  };
  await writeFile(
    resolve(directory, '.env'),
    Object.entries(configuration)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
  );
  const environment = {
    ...process.env,
    ...overrides,
    PATH: `${directory}/bin:${process.env.PATH}`,
    DEV_TEST_LOG: resolve(directory, 'log'),
    DEV_TEST_DATABASE: resolve(directory, 'database-state'),
  };
  // Host overrides must not redirect disposable fixtures to another database/app port.
  for (const key of [...Object.keys(configuration), 'DOCKER_HOST', 'DOCKER_CONTEXT'])
    delete environment[key];
  const running = new Set();
  function start(file = 'scripts/dev-local.mjs', args = []) {
    const child = spawn(file.endsWith('.sh') ? 'sh' : process.execPath, [file, ...args], {
      cwd: directory,
      env: environment,
    });
    child.output = '';
    child.stdout.on('data', (data) => {
      child.output += data;
    });
    child.stderr.on('data', (data) => {
      child.output += data;
    });
    child.completion = new Promise((done) =>
      child.once('exit', (code, signal) => {
        running.delete(child);
        done({ code, signal });
      }),
    );
    running.add(child);
    return child;
  }
  async function records() {
    try {
      return (await readFile(environment.DEV_TEST_LOG, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  async function wait(predicate) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await predicate(await records())) return;
      await delay(25);
    }
    assert.fail(
      'Timed out waiting for fixture; ' + (await readFile(environment.DEV_TEST_LOG, 'utf8')),
    );
  }
  t.after(async () => {
    for (const child of running) child.kill('SIGTERM');
    await Promise.all([...running].map((child) => child.completion));
    // Recover any children of the deliberate SIGKILL case using the real stop command.
    const cleanup = start('scripts/dev-local.mjs', ['stop']);
    await cleanup.completion;
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, configuration, start, records, wait };
}

for (const signal of ['SIGINT', 'SIGTERM'])
  test(
    `${signal} stops app processes and the owned --rm database, preserving data`,
    { timeout: 15000 },
    async (t) => {
      const f = await fixture(t);
      const child = f.start();
      await f.wait((records) => records.filter((item) => item.event === 'listening').length === 2);
      child.kill(signal);
      assert.equal((await child.completion).code, 0, child.output);
      const records = await f.records();
      assert.equal(records.filter((item) => item.event === 'stopped').length, 2);
      assert.ok(
        records.some(
          (item) =>
            item.name === 'docker' && item.args.includes('--rm') && item.args.at(-1) === 'postgres',
        ),
      );
      assert.ok(records.some((item) => item.name === 'docker' && item.args[0] === 'stop'));
      assert.ok(!records.some((item) => item.args[0] === 'volume'));
    },
  );

test(
  'startup failure cleans its database and the sibling process',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t, { DEV_TEST_APP_FAIL: 'web' });
    const child = f.start();
    assert.notEqual((await child.completion).code, 0);
    const records = await f.records();
    assert.ok(records.some((item) => item.args[0] === 'stop'));
    const server = createServer();
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(f.configuration.PORT, '127.0.0.1', done);
    });
    await new Promise((done) => server.close(done));
  },
);

test('a reused database is preserved on cancellation', { timeout: 15000 }, async (t) => {
  const f = await fixture(t, { DEV_TEST_REUSE: '1' });
  const child = f.start();
  await f.wait((records) => records.filter((item) => item.event === 'listening').length === 2);
  child.kill('SIGTERM');
  await child.completion;
  assert.ok(
    !(await f.records()).some(
      (item) => item.name === 'docker' && ['stop', 'rm'].includes(item.args[0]),
    ),
  );
});

for (const failed of [false, true])
  test(
    `setup ${failed ? 'failure' : 'success'} cleans its temporary database`,
    { timeout: 15000 },
    async (t) => {
      const f = await fixture(t, failed ? { DEV_TEST_PREPARE_FAIL: '1' } : {});
      const child = f.start('scripts/dev-setup.mjs');
      assert.equal((await child.completion).code, failed ? 1 : 0, child.output);
      assert.ok(
        (await f.records()).some((item) => item.name === 'docker' && item.args[0] === 'stop'),
      );
    },
  );

test('marketing uses pnpm only and receives no root credentials', { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  const child = f.start('scripts/dev-local.mjs', ['marketing']);
  await f.wait((records) => records.some((item) => item.event === 'listening'));
  child.kill('SIGTERM');
  await child.completion;
  const records = await f.records();
  assert.ok(!records.some((item) => item.name === 'docker'));
  assert.ok(records.some((item) => item.event === 'app' && !item.rootSecret && !item.rootProvider));
});

test(
  'worker URL follows the worktree API without inheriting root credentials',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const child = f.start('scripts/dev-local.mjs', ['agent']);
    await f.wait((records) => records.some((item) => item.event === 'app'));
    child.kill('SIGTERM');
    await child.completion;
    const app = (await f.records()).find((item) => item.event === 'app');
    assert.equal(app.agentUrl, `http://127.0.0.1:${f.configuration.PORT}`);
    assert.equal(app.rootSecret, false);
    assert.equal(app.rootProvider, false);
  },
);

test(
  'dev:stop recovers children and the owned database after a supervisor is killed',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const child = f.start();
    await f.wait((records) => records.filter((item) => item.event === 'listening').length === 2);
    child.kill('SIGKILL');
    await child.completion;
    const stop = f.start('scripts/dev-local.mjs', ['stop']);
    assert.equal((await stop.completion).code, 0, stop.output);
    assert.equal((await f.records()).filter((item) => item.event === 'stopped').length, 2);
    assert.ok((await f.records()).some((item) => item.args[0] === 'stop'));
  },
);

test(
  'duplicate sessions are rejected without stopping the existing app',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const child = f.start('scripts/dev-local.mjs', ['marketing']);
    await f.wait((records) => records.some((item) => item.event === 'listening'));
    const duplicate = f.start('scripts/dev-local.mjs', ['marketing']);
    assert.equal((await duplicate.completion).code, 1);
    assert.match(duplicate.output, /already has a session/);
    assert.ok(!(await f.records()).some((item) => item.event === 'stopped'));
    child.kill('SIGTERM');
    await child.completion;
  },
);

for (const failed of [false, true])
  test(
    `upgrade ${failed ? 'startup failure' : 'success'} tears down its unique project`,
    { timeout: 15000 },
    async (t) => {
      const f = await fixture(t, failed ? { DEV_TEST_COMPOSE_FAIL: '1' } : {});
      const child = f.start('scripts/test-live-upgrade.sh');
      assert.equal((await child.completion).code, failed ? 2 : 0, child.output);
      const docker = (await f.records()).filter((item) => item.name === 'docker');
      const startup = docker.find((item) => item.args.includes('up'));
      const teardown = docker.find((item) => item.args.includes('down'));
      assert.ok(teardown.args.includes('--volumes'));
      assert.ok(teardown.args.includes('--profile') && teardown.args.includes('test'));
      assert.ok(docker.some((item) => item.args[0] === 'ps' && item.args.includes('-aq')));
      const project = (args) => args[args.indexOf('--project-name') + 1];
      assert.equal(project(startup.args), project(teardown.args));
      assert.notEqual(project(startup.args), f.configuration.COMPOSE_PROJECT_NAME);
      assert.ok(startup.args.includes('/dev/null'));
    },
  );

test(
  'database health failure removes its owned container before starting apps',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t, { DEV_TEST_HEALTH_FAIL: '1' });
    const child = f.start();
    assert.notEqual((await child.completion).code, 0);
    const records = await f.records();
    assert.ok(records.some((item) => item.name === 'docker' && item.args[0] === 'stop'));
    assert.ok(!records.some((item) => item.event === 'app'));
  },
);

test(
  'data cleanup requires explicit --data and is scoped to the generated project',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const safe = f.start('scripts/dev-local.mjs', ['clean']);
    assert.equal((await safe.completion).code, 0, safe.output);
    assert.ok(
      !(await f.records()).some((item) => item.args[0] === 'volume' && item.args[1] === 'rm'),
    );
    const destructive = f.start('scripts/dev-local.mjs', ['clean', '--data']);
    assert.equal((await destructive.completion).code, 0, destructive.output);
    const records = await f.records();
    const lookup = records.find((item) => item.args[0] === 'volume' && item.args[1] === 'ls');
    assert.ok(
      lookup.args.includes(
        'label=com.docker.compose.project=' + f.configuration.COMPOSE_PROJECT_NAME,
      ),
    );
    assert.ok(records.some((item) => item.args[0] === 'volume' && item.args[1] === 'rm'));
  },
);

for (const [label, launcher] of [
  ['launcher exits leaving a stubborn descendant', true],
  ['cancellation while a one-off command ignores SIGTERM', false],
])
  test(label, { timeout: 10000 }, async (t) => {
    const f = await fixture(t);
    const ready = resolve(f.directory, 'ready');
    const toy = `import {writeFileSync} from 'node:fs'; process.on('SIGTERM',()=>{}); writeFileSync(${JSON.stringify(ready)},String(process.pid)); setInterval(()=>{},1000);`;
    await writeFile(resolve(f.directory, 'toy.mjs'), toy);
    await writeFile(
      resolve(f.directory, 'launcher.mjs'),
      `import {spawn} from 'node:child_process'; import {existsSync} from 'node:fs'; spawn(process.execPath,['toy.mjs'],{stdio:'inherit'}); const timer=setInterval(()=>{if(existsSync(${JSON.stringify(ready)})){clearInterval(timer);process.exit(0)}},10);`,
    );
    await writeFile(
      resolve(f.directory, 'supervisor.mjs'),
      `import {LocalSession,localEnvironment} from './scripts/lib/local-runtime.mjs'; const session=new LocalSession('exec',localEnvironment(),{shutdownMilliseconds:500}); try { await session.run(process.execPath,[${JSON.stringify(launcher ? 'launcher.mjs' : 'toy.mjs')}]); } catch {process.exitCode=1} finally {await session.close()}`,
    );
    const unrelated = createServer();
    await new Promise((done) => unrelated.listen(0, '127.0.0.1', done));
    t.after(() => new Promise((done) => unrelated.close(done)));
    const child = f.start('supervisor.mjs');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        await readFile(ready);
        break;
      } catch {
        await delay(10);
      }
    }
    const pid = Number(await readFile(ready, 'utf8'));
    t.after(() => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* Already stopped. */
      }
    });
    const began = Date.now();
    if (!launcher) child.kill('SIGTERM');
    const result = await child.completion;
    assert.equal(result.code, launcher ? 0 : 1, child.output);
    assert.ok(Date.now() - began < 3000, 'shutdown deadline must apply while awaiting run()');
    let alive = false;
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      alive = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
    } catch {
      /* Reaped child. */
    }
    assert.equal(alive, false, 'descendant must not survive command completion');
    assert.equal(unrelated.listening, true, 'another session must be preserved');
  });

test('clean pins the root environment Docker socket for all operations', async (t) => {
  const f = await fixture(t);
  await writeFile(resolve(f.directory, '.env'), '\nDOCKER_HOST=unix:///configured/docker.sock\n', {
    flag: 'a',
  });
  const child = f.start('scripts/dev-local.mjs', ['clean', '--data']);
  assert.equal((await child.completion).code, 0, child.output);
  const records = (await f.records()).filter((item) => item.name === 'docker');
  assert.ok(records.length > 0);
  assert.ok(
    records.every((item) => item.host === 'unix:///configured/docker.sock' && !item.context),
  );
});

test('clean refuses a remote Docker context before mutating anything', async (t) => {
  const f = await fixture(t, { DEV_TEST_ENDPOINT: 'tcp://remote.example:2375' });
  await writeFile(resolve(f.directory, '.env'), '\nDOCKER_CONTEXT=remote\n', { flag: 'a' });
  const child = f.start('scripts/dev-local.mjs', ['clean', '--data']);
  assert.equal((await child.completion).code, 1);
  assert.match(child.output, /remote Docker/);
  assert.ok((await f.records()).every((item) => item.args[0] === 'context'));
});

test('help works with invalid configuration and starts no services', async (t) => {
  const f = await fixture(t);
  await writeFile(resolve(f.directory, '.env'), '\nPORT=invalid\n', { flag: 'a' });
  for (const args of [['--help'], ['marketing', '--help']]) {
    const child = f.start('scripts/dev-local.mjs', args);
    assert.equal((await child.completion).code, 0, child.output);
    assert.match(child.output, /Ctrl\+C/);
  }
  assert.deepEqual(await f.records(), []);
  await assert.rejects(readFile(resolve(f.directory, '.dev/marketing.json')), { code: 'ENOENT' });
});

test('worktree inventory is read-only and returns ports without secrets', async (t) => {
  const f = await fixture(t, { DEV_TEST_INVENTORY: '1' });
  await writeFile(
    resolve(f.directory, 'bin/git'),
    `#!/bin/sh\nprintf 'worktree %s\n\nworktree %s\n' "$PWD" "$PWD/missing"\n`,
    { mode: 0o755 },
  );
  const child = f.start('scripts/dev-local.mjs', ['list', '--json']);
  assert.equal((await child.completion).code, 0, child.output);
  const report = JSON.parse(child.output);
  assert.equal(report.worktrees.length, 2);
  assert.equal(report.worktrees[1].exists, false);
  assert.equal(report.containers[0].ownership, 'registered');
  assert.equal(report.containers[0].ports['5432/tcp'][0].HostPort, '55432');
  assert.ok(!child.output.includes('root-test-secret'));
  assert.ok(!child.output.includes('root-test-provider'));
  assert.ok(
    (await f.records()).every(
      (item) =>
        ['context', 'ps', 'inspect', 'volume', 'network'].includes(item.args[0]) &&
        !['rm', 'stop', 'run', 'up', 'down'].some((arg) => item.args.includes(arg)),
    ),
  );
});

test('a configured Docker context takes precedence and pins the resolved socket', async (t) => {
  const f = await fixture(t);
  await writeFile(
    resolve(f.directory, '.env'),
    '\nDOCKER_HOST=unix:///ignored.sock\nDOCKER_CONTEXT=worktree-local\n',
    { flag: 'a' },
  );
  const child = f.start('scripts/dev-local.mjs', ['clean']);
  assert.equal((await child.completion).code, 0, child.output);
  const records = await f.records();
  assert.ok(records[0].args.includes('worktree-local'));
  assert.ok(
    records
      .filter((item) => item.args[0] !== 'context')
      .every((item) => item.host === 'unix:///fake/docker.sock' && !item.context),
  );
});

test('doctor for marketing uses no Docker/auth services and prints no credentials', async (t) => {
  const f = await fixture(t);
  await mkdir(resolve(f.directory, 'node_modules'));
  const child = f.start('scripts/dev-local.mjs', ['doctor', 'marketing']);
  assert.equal((await child.completion).code, 0, child.output);
  assert.match(child.output, /Read-only diagnostics complete/);
  assert.ok(!(await f.records()).some((item) => item.name === 'docker'));
  assert.ok(!child.output.includes('root-test-secret'));
  assert.ok(!(await f.records()).some((item) => item.event === 'app'));
});
