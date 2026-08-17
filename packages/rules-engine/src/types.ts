import type { FactKey, FactSet } from './facts.js';

export type Stage = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export type Disposition =
  | 'PASS'
  | 'INFO'
  /** Reg B notice-of-incompleteness path. NOT an adverse action — different notice
   *  contents, different 30-day clock. */
  | 'INCOMPLETE'
  /** Facts are trusted; policy needs a human. */
  | 'POLICY_ESCALATE'
  /** Facts are NOT trusted. We cannot decide at all. */
  | 'INTEGRITY_ESCALATE'
  | 'DECLINE';

export type Decision = 'APPROVE' | 'DECLINE' | 'INCOMPLETE' | 'ESCALATE';

export interface FactRef {
  readonly key: FactKey;
  readonly documentId?: string;
  readonly runId?: string;
  readonly confidence?: number;
}

/** One rule's answer to its own narrow question. NOT a decision. */
export interface Finding {
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly disposition: Disposition;
  readonly reasonCode?: string;
  readonly severity: number;
  readonly predicate: string;
  /** Exactly the facts this rule read — the renderer sees only these. */
  readonly factsRead: readonly FactRef[];
  readonly tested: Readonly<Record<string, unknown>>;
  readonly threshold: Readonly<Record<string, unknown>>;
  readonly detectableAtStage: Stage;
  /** True when no human review could change the outcome (e.g. STATE_NOT_SERVICED). */
  readonly terminal: boolean;
  readonly missingFacts?: readonly FactKey[];
}

export interface Verdict {
  readonly decision: Decision;
  /** Ordered, most material first. Reg B: more than 4 is "not likely to be helpful". */
  readonly principalReasons: readonly string[];
  /** ALL findings, including passes and skips. */
  readonly findings: readonly Finding[];
  readonly rulesVersion: string;
  readonly ruleSetHash: string;
  readonly factSnapshotId: string;
  readonly evaluatedAsOf: string;
  readonly evaluatedAtStage: Stage;
  readonly engineVersion: string;
  readonly escalation?: { readonly kind: 'POLICY' | 'INTEGRITY'; readonly question: string };
}

export interface EvaluationInput {
  readonly caseId: string;
  readonly facts: FactSet;
  /** REQUIRED. No now() inside the engine, so replay is not opt-in. */
  readonly asOf: string;
  readonly stage: Stage;
}

/**
 * The engine cannot write to a store — it has no dependencies and cannot await. So it
 * RETURNS its audit material, and an AuditedRulesEngine adapter persists it. If that
 * append fails, no verdict is returned: a decision that was not recorded did not happen.
 */
export interface EvaluationResult {
  readonly verdict: Verdict;
  /** One entry per rule CONSIDERED — passes and skips included. */
  readonly findings: readonly Finding[];
}

export type PredicateId =
  | 'value_in_set'
  | 'value_not_in_set'
  | 'at_least'
  | 'at_most'
  | 'within_range'
  | 'ratio_at_most'
  | 'date_within_days'
  | 'always';

export interface RuleOutcomeSpec {
  readonly disposition: Disposition;
  readonly reasonCode?: string;
  readonly severity?: number;
  readonly terminal?: boolean;
  readonly note?: string;
}

export interface Rule {
  readonly id: string;
  readonly version: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly predicate: PredicateId;
  /** Declarative. Reading outside this list is a bug the engine detects. */
  readonly reads: readonly FactKey[];
  readonly minimumStage: Stage;
  readonly detectableAtStage: Stage;
  readonly params: Readonly<Record<string, unknown>>;
  readonly onPass?: RuleOutcomeSpec;
  readonly onFail?: RuleOutcomeSpec;
  /** What to do when `reads` are not all resolvable. */
  readonly onMissingFacts: 'SKIP' | 'INCOMPLETE' | 'POLICY_ESCALATE';
  /** When present, the rule only applies if this holds. */
  readonly appliesWhen?: { readonly key: FactKey; readonly valueIn: readonly unknown[] };
}

export interface RuleSet {
  readonly rulesVersion: string;
  readonly hash: string;
  readonly source: string;
  readonly rules: readonly Rule[];
  readonly confidenceFloor: number;
}

export interface RulesEngine {
  evaluate(input: EvaluationInput): EvaluationResult;
  describe(): { readonly rulesVersion: string; readonly ruleIds: readonly string[] };
}
