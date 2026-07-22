import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../src/app.js';
import { closeDatabase } from '../src/database/client.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDirectory, '../../../packages/api-client/openapi.json');

const document = app.getOpenAPIDocument({
  openapi: '3.1.0',
  info: {
    title: 'Askesis API',
    version: '0.1.0',
    description: 'Domain API for structured training plans.',
  },
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
await closeDatabase();
console.log(`Wrote ${outputPath}`);
