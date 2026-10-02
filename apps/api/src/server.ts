import { startAgentSweeper } from './modules/agent/agent.sweeper.js';
import './instrument.js';
import { serve } from '@hono/node-server';
import { app } from './app.js';
import { getApiConfig } from './config.js';
import { closeDatabase } from './database/client.js';
import { logger } from './logger.js';
import { startTestExecutor } from './modules/chat/chat.executor.js';

const config = getApiConfig();
const stopTestExecutor = startTestExecutor();
const stopAgentSweeper = startAgentSweeper();
const server = serve(
  {
    fetch: app.fetch,
    // Railway private networking is IPv6; Node's IPv6 wildcard also accepts IPv4 locally.
    hostname: '::',
    port: config.PORT,
  },
  (info) => {
    logger.info({ port: info.port }, 'Askesis API started');
  },
);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down Askesis API');

  const forcedExit = setTimeout(() => {
    logger.error({ signal }, 'Graceful shutdown timed out');
    process.exit(1);
  }, 10_000);
  forcedExit.unref();

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  await stopTestExecutor();
  await stopAgentSweeper();
  await closeDatabase();
  clearTimeout(forcedExit);
  logger.info({ signal }, 'Askesis API stopped');
}

function requestShutdown(signal: string): void {
  void shutdown(signal).catch((error: unknown) => {
    logger.fatal({ error, signal }, 'Askesis API shutdown failed');
    process.exit(1);
  });
}

process.once('SIGINT', () => requestShutdown('SIGINT'));
process.once('SIGTERM', () => requestShutdown('SIGTERM'));
