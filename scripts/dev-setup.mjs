import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';

import { LocalSession, assertPortAvailable, worktreeDefaults } from './lib/local-runtime.mjs';

const root = resolve(import.meta.dirname, '..');

try {
  if (!existsSync(resolve(root, '.env'))) {
    // Read only development Clerk keys from the main checkout; never copy provider credentials.
    const common = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    ).trim();
    const source = resolve(process.argv[2] ?? resolve(dirname(common), '.env'));
    if (!existsSync(source))
      throw new Error(
        'Create .env with Clerk development keys, or pass a source .env path to pnpm dev:setup.',
      );
    const sourceEnv = parseEnv(readFileSync(source, 'utf8'));
    const publicKey = sourceEnv.VITE_CLERK_PUBLISHABLE_KEY ?? sourceEnv.CLERK_PUBLISHABLE_KEY;
    const secretKey = sourceEnv.CLERK_SECRET_KEY;
    if (
      !publicKey?.startsWith('pk_test_') ||
      !secretKey?.startsWith('sk_test_') ||
      /replace_me/.test(publicKey + secretKey)
    )
      throw new Error(
        'Local verification requires real Clerk development keys (pk_test_/sk_test_).',
      );
    const defaults = worktreeDefaults();
    const apiPort = Number(defaults.API_PORT);
    const webPort = Number(defaults.WEB_PORT);
    const databasePort = Number(defaults.POSTGRES_PORT);
    await Promise.all(
      [apiPort, webPort, databasePort, defaults.MARKETING_PORT, defaults.EVALS_PORT].map(
        assertPortAvailable,
      ),
    );
    const environment = {
      ...parseEnv(readFileSync(resolve(root, '.env.example'), 'utf8')),
      ...defaults,
      NODE_ENV: 'development',
      AGENT_API_URL: `http://127.0.0.1:${apiPort}`,
      POSTGRES_PORT: String(databasePort),
      API_PORT: String(apiPort),
      PORT: String(apiPort),
      WEB_PORT: String(webPort),
      DATABASE_URL: `postgres://askesis:askesis@127.0.0.1:${databasePort}/askesis?sslmode=disable`,
      VITE_CLERK_PUBLISHABLE_KEY: publicKey,
      CLERK_SECRET_KEY: secretKey,
      CLERK_AUTHORIZED_PARTIES: `http://localhost:${webPort},http://127.0.0.1:${webPort}`,
      VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
      LOCAL_WEB_URL: `http://localhost:${webPort}`,
      CHAT_EXECUTION_MODE: 'test',
    };
    writeFileSync(
      resolve(root, '.env'),
      Object.entries(environment)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join('\n') + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    console.log('Created private .env with development Clerk keys and worktree-specific ports.');
  }
  const session = new LocalSession('setup');
  try {
    await session.run('pnpm', ['--filter', '@askesis/api', 'verification:check']);
    await session.database();
    await session.compose(['run', '--rm', '--no-deps', 'migrate']);
    await session.run('pnpm', ['--filter', '@askesis/api', 'verification:prepare']);
  } finally {
    await session.close();
  }
  console.log(
    'Ready. Setup containers stopped; database data retained. Run pnpm dev, then pnpm dev:login in another terminal.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local setup failed.');
  process.exitCode = 1;
}
