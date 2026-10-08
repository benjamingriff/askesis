import { createHash } from 'node:crypto';

export type SemanticValue =
  null | boolean | string | number | SemanticValue[] | { [key: string]: SemanticValue };
export const CONTENT_HASH_VERSION = 5;

/** The aggregate assembler supplies semantic fields only, with ordered arrays. */
export function canonicalJson(value: SemanticValue): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical content requires finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(',')}}`;
}

export function contentHash(value: SemanticValue): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** Preserve PostgreSQL numeric precision without converting through a JS number. */
export function canonicalDecimal(value: string): string {
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(value)) throw new Error('Expected a PostgreSQL decimal value.');
  const negative = value.startsWith('-');
  const [integer = '0', fraction = ''] = value.replace(/^[+-]/, '').split('.');
  const whole = integer.replace(/^0+(?=\d)/, '');
  const fractional = fraction.replace(/0+$/, '');
  const magnitude = fractional.length === 0 ? whole : `${whole}.${fractional}`;
  return negative && magnitude !== '0' ? `-${magnitude}` : magnitude;
}
