import './instrument.js';
import { serve } from '@hono/node-server';
import { app } from './app.js';
import { getApiConfig } from './config.js';
import { closeDatabase } from './database/client.js';
import { logger } from './logger.js';

const config = getApiConfig();
const server = serve(
  {
    fetch: app.fetch,
    hostname: '0.0.0.0',
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
