import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { EVALUATOR_PROMPTS, promptIdentity } from './prompts.js';

it('pins each evaluator prompt name to exactly one text', async () => {
  const lock = JSON.parse(
    await readFile(new URL('../prompts.lock.json', import.meta.url), 'utf8'),
  ) as Record<string, string>;
  for (const prompt of Object.values(EVALUATOR_PROMPTS)) {
    const { name, hash } = promptIdentity(prompt);
    expect(
      lock[name],
      `${name} changed. Give it a new version name and add "${hash}" to apps/bench/prompts.lock.json.`,
    ).toBe(hash);
  }
  expect(new Set(Object.values(lock)).size).toBe(Object.keys(lock).length);
});
