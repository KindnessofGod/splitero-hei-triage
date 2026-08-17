/**
 * The audit record. One shape, discriminated payload.
 *
 * Design rationale in docs/design/PHASE1A_AUDIT_RETROFIT.md §2.1.
 * The store is append-only: corrections are new records with `supersedes` set.
 */

/** The case identifier. Generated at intake, threaded through everything. */
export type CorrelationId = string & { readonly __brand: 'CorrelationId' };
/** One pass through the pipeline. A case is evaluated many times. */
export type RunId = string & { readonly __brand: 'RunId' };
export type RecordId = string & { readonly __brand: 'RecordId' };
export type Sha256Hex = string & { readonly __brand: 'Sha256Hex' };

export type RecordKind =
  | 'STEP'
  | 'RULE_EVALUATION'
  | 'MODEL_CALL'
  | 'HUMAN_ACTION'
  | 'STATE_MUTATION'
  | 'VERDICT'
  | 'CORRECTION';

export type ActorType = 'SYSTEM' | 'HUMAN' | 'MODEL';
export type Outcome = 'OK' | 'FAIL' | 'SKIPPED' | 'ERROR';

/** Fields every record carries, whatever it is about. */
export interface AuditRecordBase {
  readonly recordId: RecordId;
  readonly correlationId: CorrelationId;
  readonly runId: RunId;
  readonly parentRecordId?: RecordId;
  /** Monotonic per correlationId. Replay orders by this, never by timestamp:
   *  timestamps collide and clocks move. */
  readonly sequence: number;
  readonly stepName: string;
  readonly stepVersion: string;
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly durationMs?: number;
  readonly outcome: Outcome;
  readonly inputDigest: Sha256Hex;
  readonly outputDigest?: Sha256Hex;
  readonly idempotencyKey?: string;
  readonly attempt: number;
  readonly supersedes?: RecordId;
}

/**
 * The payload that answers "why", not "what".
 *
 * `verdict: DECLINE` is useless. This is an audit trail:
 *   rule equity.max_cltv v2 (rules_version 2026-08-16)
 *     evaluated cltv 0.78 against threshold max_cltv 0.75 -> FAIL
 */
export interface RuleEvaluationPayload {
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly rulesVersion: string;
  readonly ruleSetHash: Sha256Hex;
  readonly predicate: string;
  /** The actual values the rule tested, named. */
  readonly tested: Readonly<Record<string, unknown>>;
  /** What they were tested against. */
  readonly threshold: Readonly<Record<string, unknown>>;
  readonly verdict: 'PASS' | 'FAIL' | 'NOT_EVALUATED';
  readonly disposition?: string;
  readonly reasonCode?: string;
  readonly terminal?: boolean;
  readonly factsRead: readonly FactRefLite[];
  readonly detectableAtStage?: number;
  readonly evaluatedAtStage?: number;
  /** Populated when verdict is NOT_EVALUATED — which fact keys were absent. */
  readonly missingFacts?: readonly string[];
}

export interface FactRefLite {
  readonly key: string;
  readonly documentId?: string;
  readonly runId?: string;
  readonly confidence?: number;
}

export interface ModelCallPayload {
  readonly modelId: string;
  readonly promptId: string;
  readonly promptHash: Sha256Hex;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly finishReason: string;
  /** The digest stays in the immutable chain forever. Where the raw payload itself
   *  lives is Fork A in docs/design/PHASE1A_AUDIT_RETROFIT.md — undecided. */
  readonly rawResponseDigest: Sha256Hex;
  readonly rawResponseRef?: string;
  readonly parsedOk: boolean;
  readonly schemaId?: string;
  readonly retryOf?: RecordId;
}

export interface HumanActionPayload {
  readonly decision: string;
  readonly reasonText?: string;
  /** What the reviewer actually saw. A decision is only defensible against the
   *  information that was in front of the person making it. */
  readonly presentedStateDigest: Sha256Hex;
  readonly presentedStateRef?: string;
}

export interface StateMutationPayload {
  readonly entity: string;
  readonly entityId: string;
  readonly priorValueDigest?: Sha256Hex;
  readonly newValueDigest: Sha256Hex;
  readonly priorRecordId?: RecordId;
}

export interface VerdictPayload {
  readonly decision: 'APPROVE' | 'DECLINE' | 'INCOMPLETE' | 'ESCALATE';
  readonly principalReasons: readonly string[];
  readonly rulesVersion: string;
  readonly ruleSetHash: Sha256Hex;
  readonly factSnapshotId: Sha256Hex;
  readonly evaluatedAtStage: number;
  readonly escalationKind?: 'POLICY' | 'INTEGRITY';
  readonly seal: Sha256Hex;
}

export interface StepPayload {
  readonly summary: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface CorrectionPayload {
  readonly reason: string;
  readonly correctedFields: readonly string[];
}

export type AuditRecord =
  | (AuditRecordBase & { readonly recordKind: 'RULE_EVALUATION'; readonly payload: RuleEvaluationPayload })
  | (AuditRecordBase & { readonly recordKind: 'MODEL_CALL'; readonly payload: ModelCallPayload })
  | (AuditRecordBase & { readonly recordKind: 'HUMAN_ACTION'; readonly payload: HumanActionPayload })
  | (AuditRecordBase & { readonly recordKind: 'STATE_MUTATION'; readonly payload: StateMutationPayload })
  | (AuditRecordBase & { readonly recordKind: 'VERDICT'; readonly payload: VerdictPayload })
  | (AuditRecordBase & { readonly recordKind: 'STEP'; readonly payload: StepPayload })
  | (AuditRecordBase & { readonly recordKind: 'CORRECTION'; readonly payload: CorrectionPayload });

/**
 * Append-only. There is no update and no delete, by design and by database grant.
 * A correction is a new record referencing the one it supersedes.
 */
export interface AuditSink {
  appendAll(records: readonly AuditRecord[]): Promise<void>;
}

export interface AuditReader {
  /** Ordered by `sequence` ascending. */
  read(correlationId: CorrelationId): Promise<readonly AuditRecord[]>;
}
