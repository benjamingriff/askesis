import { serve } from '@hono/node-server';
import { app } from './app.js';
import { closeDatabase } from './database/client.js';

const port = Number(process.env.PORT ?? 3000);

const server = serve({
  fetch: app.fetch,
  hostname: '0.0.0.0',
  port,
}, (info) => {
  console.log(`Askesis API listening on http://localhost:${info.port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}; shutting down.`);
  server.close();
  await closeDatabase();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
