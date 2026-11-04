import { describe, expect, it, vi } from 'vitest';
import { readOpenAiKeyFromOnePassword } from './one-password.js';

const value = 'example-value-for-unit-tests';
const item = (fields: unknown[]) => JSON.stringify({ fields, title: 'askesis-bench' });
describe('1Password benchmark key loading', () => {
  it('loads the default item and prioritizes an OpenAI-named field over other credentials', async () => {
    const execute = vi.fn().mockResolvedValue(
      item([
        { id: 'other', label: 'token', type: 'CONCEALED', value: 'unrelated' },
        { id: 'key', label: 'OPENAI_API_KEY', type: 'CONCEALED', value },
      ]),
    );
    expect(await readOpenAiKeyFromOnePassword({}, execute)).toBe(value);
    expect(execute).toHaveBeenCalledWith([
      'item',
      'get',
      'askesis-bench',
      '--format',
      'json',
      '--reveal',
    ]);
  });
  it('accepts the API Credential template field or a single concealed field', async () => {
    expect(
      await readOpenAiKeyFromOnePassword({}, async () =>
        item([
          { id: 'credential', label: 'credential', type: 'CONCEALED', value },
          { id: 'notesPlain', label: 'notes', type: 'STRING', value: 'ordinary notes' },
        ]),
      ),
    ).toBe(value);
    expect(
      await readOpenAiKeyFromOnePassword({}, async () =>
        item([{ id: 'password', label: 'password', type: 'CONCEALED', value }]),
      ),
    ).toBe(value);
  });
  it('uses explicit item, vault and field overrides and preserves them as separate arguments', async () => {
    const execute = vi.fn().mockResolvedValue(
      item([
        { id: 'one', label: 'token', value: 'unrelated' },
        { id: 'two', label: 'token', value },
      ]),
    );
    expect(
      await readOpenAiKeyFromOnePassword(
        { item: 'Other item', vault: 'Development vault', field: 'two' },
        execute,
      ),
    ).toBe(value);
    expect(execute).toHaveBeenCalledWith([
      'item',
      'get',
      'Other item',
      '--format',
      'json',
      '--reveal',
      '--vault',
      'Development vault',
    ]);
  });
  it('refuses ambiguous credentials or duplicate field labels rather than picking a key', async () => {
    const execute = async () =>
      item([
        { id: 'one', label: 'token', type: 'CONCEALED', value },
        { id: 'two', label: 'token', type: 'CONCEALED', value: 'other-example' },
      ]);
    await expect(readOpenAiKeyFromOnePassword({}, execute)).rejects.toThrow('--op-field');
    await expect(readOpenAiKeyFromOnePassword({ field: 'token' }, execute)).rejects.toThrow(
      '--op-field',
    );
  });
  it('does not replace an empty explicitly named OpenAI field with an unrelated secret', async () => {
    await expect(
      readOpenAiKeyFromOnePassword({}, async () =>
        item([
          { id: 'key', label: 'OPENAI_API_KEY', value: '' },
          { id: 'other', label: 'credential', type: 'CONCEALED', value },
        ]),
      ),
    ).rejects.toThrow('key itself');
  });
  it('rejects missing fields, masked values and unresolved references', async () => {
    await expect(readOpenAiKeyFromOnePassword({}, async () => item([]))).rejects.toThrow(
      'No matching key field',
    );
    for (const value of ['<concealed by 1Password>', 'op://Example/Item/field']) {
      await expect(
        readOpenAiKeyFromOnePassword({}, async () => item([{ label: 'token', value }])),
      ).rejects.toThrow('key itself');
    }
  });
  it('keeps secret-bearing command errors and malformed JSON out of diagnostics', async () => {
    const secretError = Object.assign(new Error(`Command failed: ${value}`), {
      stdout: value,
      stderr: value,
    });
    for (const execute of [
      async () => {
        throw secretError;
      },
      async () => value,
      async () => JSON.stringify({ fields: value }),
    ]) {
      const error = await readOpenAiKeyFromOnePassword({}, execute).catch((error) => error);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).not.toContain(value);
      expect(error.cause).toBeUndefined();
    }
  });
});
