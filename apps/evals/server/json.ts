import { readFile } from 'node:fs/promises';

export type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asStrings(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string');
}

export function objects(value: unknown): Json[] {
  return asArray(value).filter(isObject);
}

export async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

export async function readJsonLines(file: string): Promise<Json[]> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  const rows: Json[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const row = JSON.parse(line) as unknown;
      if (isObject(row)) rows.push(row);
    } catch {
      // A partially written final line is expected while a run is in progress.
    }
  }
  return rows;
}
