import {
  developmentHelp,
  developmentDoctor,
  developmentInventory,
} from './lib/dev-diagnostics.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import {
  LocalSession,
  root,
  assertPortAvailable,
  localEnvironment,
  readEnvironment,
  stopSessions,
  sessionStatus,
  cleanDevelopment,
} from './lib/local-runtime.mjs';

const [app = 'local', ...input] = process.argv.slice(2);
const args = input[0] === '--' ? input.slice(1) : input;

async function main() {
  if (app === '--help' || app === '-h' || args.includes('--help') || args.includes('-h'))
    return developmentHelp(['--help', '-h'].includes(app) ? undefined : app);
  if (app === 'doctor') {
    if (args.length > 1) throw new Error('Usage: pnpm dev:doctor [app]');
    return developmentDoctor(args[0]);
  }
  if (app === 'list') {
    if (args.some((arg) => arg !== '--json')) throw new Error('Usage: pnpm dev:list [--json]');
    return developmentInventory(args.includes('--json'));
  }
  if (app === 'status') return sessionStatus();
  if (app === 'stop') {
    if (args.length > 1) throw new Error('Usage: pnpm dev:stop [app]');
    return stopSessions(args[0]);
  }
  if (app === 'clean') {
    if (args.some((arg) => arg !== '--data')) throw new Error('Usage: pnpm dev:clean [--data]');
    return cleanDevelopment(args.includes('--data'));
  }
  const environment = localEnvironment();
  if (app === 'exec' && !args.length) throw new Error('Usage: pnpm dev:exec -- COMMAND [ARGS]');
  const session = new LocalSession(app, environment);
  try {
    if (['local', 'api', 'exec'].includes(app)) {
      await session.database();
      await session.compose(['run', '--rm', '--no-deps', 'migrate']);
    }
    if (app === 'exec') {
      await session.run(args[0], args.slice(1));
      return;
    }
    const apps = app === 'local' ? ['api', 'web'] : [app];
    const tasks = [];
    for (const name of apps) {
      const port = {
        api: environment.PORT,
        web: environment.WEB_PORT,
        marketing: environment.MARKETING_PORT,
        evals: environment.EVALS_PORT,
        usage: environment.USAGE_PORT,
      }[name];
      if (port) {
        await assertPortAvailable(port);
        session.state.url = `http://localhost:${port}`;
        session.save();
      }
      let childEnvironment = environment;
      if (['marketing', 'evals', 'usage', 'mobile', 'agent'].includes(name)) {
        childEnvironment = { ...process.env };
        const keys =
          name === 'marketing'
            ? ['MARKETING_PORT', 'SITE_URL', 'APP_URL']
            : name === 'evals'
              ? ['EVALS_PORT', 'EVALS_RESULTS_DIR']
              : name === 'usage'
                ? ['USAGE_PORT']
                : [];
        for (const key of keys)
          if (environment[key] !== undefined) childEnvironment[key] = environment[key];
        if (name === 'agent')
          childEnvironment.AGENT_API_URL =
            process.env.AGENT_API_URL ??
            readEnvironment(resolve(root, 'apps/agent/.env')).AGENT_API_URL ??
            `http://127.0.0.1:${environment.PORT}`;
      }
      tasks.push(
        name === 'mobile'
          ? session.start('npm', ['--prefix', 'apps/mobile', 'run', 'start', '--', ...args], {
              env: childEnvironment,
            })
          : session.start(
              'pnpm',
              ['--filter', `@askesis/${name}`, '--fail-if-no-match', 'dev', ...args],
              { env: childEnvironment },
            ),
      );
    }
    if (app === 'local' || app === 'api') {
      const deadline = Date.now() + 60000;
      let ready = false;
      while (
        Date.now() < deadline &&
        !session.controller.signal.aborted &&
        tasks.every((task) => session.children.has(task))
      ) {
        try {
          ready = (
            await fetch(`http://127.0.0.1:${environment.PORT}/api/ready`, {
              signal: AbortSignal.timeout(1000),
            })
          ).ok;
          if (ready && app === 'local')
            ready = (
              await fetch(`http://127.0.0.1:${environment.WEB_PORT}/`, {
                signal: AbortSignal.timeout(1000),
              })
            ).ok;
        } catch {
          /* Processes are still starting. */
        }
        if (ready) break;
        await delay(200);
      }
      if (session.controller.signal.aborted) return;
      if (!ready)
        throw new Error('Local application did not become ready; check the server output above.');
      console.log(
        `Ready: ${session.state.url}. Ctrl+C (or pnpm dev:stop ${app}) stops owned processes/containers; data is retained.`,
      );
    }
    const result = await Promise.race(tasks.map((task) => task.exit));
    if (!session.controller.signal.aborted) process.exitCode = result.code ?? 1;
  } finally {
    await session.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
