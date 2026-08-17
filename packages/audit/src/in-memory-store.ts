import type { AuditReader, AuditRecord, AuditSink, CorrelationId } from './record.js';

/**
 * Append-only in memory. The Postgres adapter enforces the same property with grants
 * and rewrite rules; this one enforces it by having no method that mutates.
 *
 * Used by tests and by `npm run replay` when no DATABASE_URL is set, so a stranger can
 * clone the repo and see a real replay without standing anything up.
 */
export class InMemoryAuditStore implements AuditSink, AuditReader {
  readonly #byCase = new Map<CorrelationId, AuditRecord[]>();

  constructor(seed: readonly AuditRecord[] = []) {
    if (seed.length > 0) void this.appendAll(seed);
  }

  async appendAll(records: readonly AuditRecord[]): Promise<void> {
    for (const r of records) {
      const existing = this.#byCase.get(r.correlationId) ?? [];
      if (existing.some((e) => e.recordId === r.recordId)) {
        throw new Error(`audit store is append-only: ${r.recordId} already exists`);
      }
      if (existing.some((e) => e.sequence === r.sequence)) {
        throw new Error(
          `duplicate sequence ${r.sequence} for ${r.correlationId}; sequence must be unique per case`,
        );
      }
      existing.push(r);
      this.#byCase.set(r.correlationId, existing);
    }
  }

  async read(correlationId: CorrelationId): Promise<readonly AuditRecord[]> {
    return [...(this.#byCase.get(correlationId) ?? [])].sort((a, b) => a.sequence - b.sequence);
  }
}
