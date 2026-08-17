import { createHash } from 'node:crypto';
import type { Sha256Hex, VerdictPayload } from './record.js';

/** Deterministic JSON: keys sorted at every depth, so the digest is stable. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sha256(input: string): Sha256Hex {
  return createHash('sha256').update(input, 'utf8').digest('hex') as Sha256Hex;
}

export function digestOf(value: unknown): Sha256Hex {
  return sha256(canonicalJson(value));
}

/**
 * The seal covers every field of the verdict except the seal itself. Recomputed on
 * read; a mismatch means the stored decision was altered after the fact.
 */
export function computeSeal(payload: Omit<VerdictPayload, 'seal'>): Sha256Hex {
  return digestOf(payload);
}

export function verifySeal(payload: VerdictPayload): boolean {
  const { seal, ...rest } = payload;
  return computeSeal(rest) === seal;
}
