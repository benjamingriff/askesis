import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { COACHING_PROMPT, PROMPT_HASH, PROMPT_VERSION, promptHash } from './prompt.js';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

it('pins each coaching prompt name to exactly one text', async () => {
  const lock = JSON.parse(await read('../prompts.lock.json')) as Record<string, string>;
  expect(PROMPT_HASH).toBe(promptHash(COACHING_PROMPT));
  expect(
    lock[PROMPT_VERSION],
    `The coaching prompt text changed. Give it a new PROMPT_VERSION and add its hash to apps/agent/prompts.lock.json.`,
  ).toBe(PROMPT_HASH);
  // Earlier names stay locked to their historical text.
  expect(new Set(Object.values(lock)).size).toBe(Object.keys(lock).length);
});

it('matches the prompt version the API accepts from workers', async () => {
  // The API cannot import the agent package, so it keeps its own copy of the name.
  const source = await read('../../api/src/modules/agent/agent.schemas.ts');
  expect(source.match(/export const PROMPT_VERSION = '([^']+)'/)?.[1]).toBe(PROMPT_VERSION);
});
