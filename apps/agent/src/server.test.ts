import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it.each(['SIGTERM', 'SIGINT'] as const)(
  '%s completes worker cleanup and logs shutdown before the SDK can exit',
  async (signal) => {
    const readiness: boolean[] = [];
    const api = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      res.setHeader('content-type', 'application/json');
      if (req.url === '/internal/agent/register') {
        readiness.push(JSON.parse(body).ready);
        res.end(JSON.stringify({ registered: true }));
      } else res.end(JSON.stringify({ claim: null }));
    });
    api.listen(0, '127.0.0.1');
    await once(api, 'listening');
    const address = api.address();
    if (!address || typeof address === 'string') throw new Error('Missing test API port');
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        NODE_ENV: 'test',
        AGENT_API_URL: `http://127.0.0.1:${address.port}`,
        AGENT_BOOTSTRAP_TOKEN: 'test-process-bootstrap-token-32-characters',
        OPENAI_API_KEY: 'test-unused-provider-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const closed = once(child, 'close');
    const records: { code: string }[] = [];
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      const record = JSON.parse(line);
      records.push(record);
      if (record.code === 'WORKER_READY') child.kill(signal);
    });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 8000);
    try {
      expect(await closed, stderr).toEqual([0, null]);
      expect(readiness).toEqual([true, false]);
      expect(records.map(({ code }) => code)).toEqual([
        'WORKER_STARTING',
        'WORKER_READY',
        'WORKER_STOPPED',
      ]);
    } finally {
      clearTimeout(timeout);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
      lines.close();
      await new Promise<void>((resolve, reject) =>
        api.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
  10000,
);
