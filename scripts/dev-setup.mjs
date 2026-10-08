import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });

async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () =>
      reject(new Error(`Port ${port} is occupied; choose another in .env.`)),
    );
    server.listen(port, '0.0.0.0', () => server.close(resolve));
  });
}

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
    const hash = createHash('sha256').update(root).digest('hex');
    // Keep Vite below 6000, which Chromium blocks as an unsafe browser port.
    const offset = 1 + (Number.parseInt(hash.slice(0, 6), 16) % 799);
    const apiPort = 3000 + offset;
    const webPort = 5173 + offset;
    const databasePort = 55000 + offset;
    await Promise.all([apiPort, webPort, databasePort].map(assertPortAvailable));
    const environment = {
      ...parseEnv(readFileSync(resolve(root, '.env.example'), 'utf8')),
      NODE_ENV: 'development',
      COMPOSE_PROJECT_NAME: `askesis-local-${hash.slice(0, 12)}`,
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
  // Validate before running any database jobs, including on repeat invocations.
  run('pnpm', ['--filter', '@askesis/api', 'verification:check']);
  run('docker', ['compose', 'up', '-d', 'postgres']);
  run('docker', ['compose', 'run', '--rm', 'migrate']);
  run('pnpm', ['--filter', '@askesis/api', 'verification:prepare']);
  console.log('Ready. Run pnpm dev:local, then pnpm dev:login in another terminal.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local setup failed.');
  process.exitCode = 1;
}
