/**
 * Facts — the seam between the fallible half of the system and the deterministic half.
 *
 * Everything to the left of this type is a guess made by a model reading a smudged
 * document. Everything to the right is arithmetic. A Fact carries where it came from
 * and how sure we are, so the right-hand side can decide what to do about uncertainty
 * with a rule instead of a vibe.
 */

export type FactKey = string;

export type Provenance =
  | { readonly source: 'APPLICANT_STATED'; readonly field: string }
  | {
      readonly source: 'DOCUMENT_EXTRACTED';
      readonly documentId: string;
      readonly runId: string;
      readonly page?: number;
    }
  | { readonly source: 'DERIVED'; readonly deriverId: string; readonly inputs: readonly FactKey[] }
  | { readonly source: 'HUMAN_ENTERED'; readonly actorId: string };

export interface Fact<T = unknown> {
  readonly key: FactKey;
  readonly value: T;
  /** 0..1. Model self-report for extractions, 1 for applicant-stated and human-entered. */
  readonly confidence: number;
  readonly provenance: Provenance;
  /** Effective date of the underlying artifact, not when we read it. */
  readonly observedAt: string;
}

export type Resolved<T> =
  | { readonly status: 'KNOWN'; readonly fact: Fact<T> }
  | { readonly status: 'CONFLICTED'; readonly candidates: readonly Fact<T>[] }
  | { readonly status: 'LOW_CONFIDENCE'; readonly fact: Fact<T> }
  | { readonly status: 'UNKNOWN' };

export interface FactSetOptions {
  /** Below this, resolve() reports LOW_CONFIDENCE. A rule then decides what that means.
   *  The threshold is a parameter; the model never decides it is unsure enough to matter. */
  readonly confidenceFloor?: number;
}

/**
 * Immutable. Deliberately allows MULTIPLE facts per key: cross-document contradiction is
 * the product, not an error to smooth over. A last-write-wins map would silently delete
 * adversarial case 18, where occupancy is contradicted across three documents.
 */
export class FactSet {
  readonly #byKey = new Map<FactKey, Fact[]>();
  readonly #floor: number;
  readonly integritySignals: readonly IntegritySignal[];

  constructor(
    facts: readonly Fact[] = [],
    integritySignals: readonly IntegritySignal[] = [],
    opts: FactSetOptions = {},
  ) {
    this.#floor = opts.confidenceFloor ?? 0.7;
    this.integritySignals = integritySignals;
    for (const f of facts) {
      const bucket = this.#byKey.get(f.key) ?? [];
      bucket.push(f);
      this.#byKey.set(f.key, bucket);
    }
  }

  get<T = unknown>(key: FactKey): readonly Fact<T>[] {
    return (this.#byKey.get(key) ?? []) as Fact<T>[];
  }

  keys(): readonly FactKey[] {
    return [...this.#byKey.keys()].sort();
  }

  /** Deterministic. Never throws — absence and disagreement are outcomes, not errors. */
  resolve<T = unknown>(key: FactKey): Resolved<T> {
    const candidates = this.get<T>(key);
    if (candidates.length === 0) return { status: 'UNKNOWN' };

    if (candidates.length > 1) {
      const distinct = new Set(candidates.map((c) => JSON.stringify(c.value)));
      if (distinct.size > 1) return { status: 'CONFLICTED', candidates };
    }

    // Highest confidence wins; ties broken by provenance rank then by key order, so the
    // same FactSet always resolves identically.
    const best = [...candidates].sort(
      (a, b) => b.confidence - a.confidence || rank(a) - rank(b),
    )[0]!;

    return best.confidence < this.#floor
      ? { status: 'LOW_CONFIDENCE', fact: best }
      : { status: 'KNOWN', fact: best };
  }

  /** Content hash of the whole snapshot — the replay key. */
  snapshotId(digest: (v: unknown) => string): string {
    const canonical = this.keys().map((k) => [
      k,
      this.get(k)
        .map((f) => ({ v: f.value, c: f.confidence, p: f.provenance, o: f.observedAt }))
        .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
    ]);
    return digest({ facts: canonical, signals: this.integritySignals });
  }
}

const PROVENANCE_RANK = {
  HUMAN_ENTERED: 0,
  DOCUMENT_EXTRACTED: 1,
  DERIVED: 2,
  APPLICANT_STATED: 3,
} as const;

function rank(f: Fact): number {
  return PROVENANCE_RANK[f.provenance.source];
}

export interface IntegritySignal {
  readonly documentId: string;
  readonly kind:
    | 'INSTRUCTION_LIKE_TEXT'
    | 'APN_MISMATCH'
    | 'ADDRESS_MISMATCH'
    | 'ILLEGIBLE_REGION'
    | 'CLASSIFICATION_AMBIGUOUS';
  readonly excerpt?: string;
  readonly severity: 'NOTE' | 'BLOCKING';
}
