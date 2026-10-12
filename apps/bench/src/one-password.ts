import { execFile } from 'node:child_process';
import { z } from 'zod';
import { BenchmarkError } from './local.js';

const ItemSchema = z.object({
  fields: z.array(
    z.object({
      id: z.string().optional(),
      label: z.string().optional(),
      type: z.string().optional(),
      value: z.string().optional(),
    }),
  ),
});
export type OnePasswordOptions = { item?: string; vault?: string; field?: string };
type OpCommand = (args: string[]) => Promise<string>;

/** Pipe secret-bearing output into memory only; never return subprocess errors or stderr. */
function runOp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'op',
      args,
      { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(
            new BenchmarkError(
              error.code === 'ENOENT'
                ? '1Password CLI is missing. Install op before using --op.'
                : 'Could not read the 1Password item. Check your op sign-in or desktop integration and item/vault access.',
            ),
          );
        } else resolve(stdout);
      },
    );
  });
}

export async function readOpenAiKeyFromOnePassword(
  options: OnePasswordOptions = {},
  execute: OpCommand = runOp,
) {
  const item = options.item ?? 'askesis-bench';
  if (!item.trim() || item.startsWith('-'))
    throw new BenchmarkError('Supply a 1Password item name or ID with --op-item.');
  const args = ['item', 'get', item, '--format', 'json', '--reveal'];
  if (options.vault) args.push('--vault', options.vault);
  let raw: string;
  try {
    raw = await execute(args);
  } catch (error) {
    // The command implementation already emits fixed diagnostics. Injected/raw errors are unsafe.
    if (error instanceof BenchmarkError) throw error;
    throw new BenchmarkError(
      'Could not read the 1Password item. Check op authentication and item/vault access.',
    );
  }
  const parsed = ItemSchema.safeParse(parseJson(raw));
  if (!parsed.success)
    throw new BenchmarkError(
      '1Password returned an unreadable item. Check op item get with --format json.',
    );
  const fields = parsed.data.fields;
  const normalize = (value: string | undefined) => value?.toLowerCase().replace(/[\s_-]+/g, '');
  const named = (names: string[]) =>
    fields.filter(
      (f) => names.includes(normalize(f.label) ?? '') || names.includes(normalize(f.id) ?? ''),
    );
  let candidates;
  if (options.field)
    candidates = fields.filter((f) => f.id === options.field || f.label === options.field);
  else {
    candidates = named(['openaiapikey', 'openaikey']);
    if (!candidates.length) candidates = named(['apikey', 'token', 'credential', 'credentials']);
    if (!candidates.length)
      candidates = fields.filter((f) => f.type === 'CONCEALED' && Boolean(f.value?.trim()));
  }
  if (candidates.length !== 1)
    throw new BenchmarkError(
      candidates.length
        ? 'Multiple possible key fields in the 1Password item. Choose one with --op-field FIELD_ID_OR_LABEL.'
        : 'No matching key field in the 1Password item. Use --op-field FIELD_ID_OR_LABEL, or name the field OPENAI_API_KEY.',
    );
  const key = candidates[0]!.value?.trim();
  if (!key || key.startsWith('op://') || /^<.*concealed.*>$/i.test(key))
    throw new BenchmarkError(
      'The selected 1Password field must contain the OpenAI API key itself.',
    );
  return key;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
