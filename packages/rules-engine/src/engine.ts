import type { Fact, FactSet } from './facts.js';
import { PREDICATES, PredicateError } from './predicates.js';
import type {
  Disposition,
  EvaluationInput,
  EvaluationResult,
  FactRef,
  Finding,
  Rule,
  RuleOutcomeSpec,
  RuleSet,
  RulesEngine,
  Verdict,
} from './types.js';

export const ENGINE_VERSION = 'rules-engine@0.2.0';

/**
 * Pure. Synchronous. Total.
 *
 * Synchronous is not a style choice — it is the enforcement mechanism. A synchronous
 * function cannot await a network call, so this package has an empty dependency closure
 * and "a model cannot make a decision" stops being a rule people follow.
 *
 * Total: missing, contradictory and malformed facts are domain outcomes, not exceptions.
 * An unhandled exception in an underwriting path is an unhandled applicant.
 */
export class DeterministicRulesEngine implements RulesEngine {
  constructor(
    private readonly ruleSet: RuleSet,
    private readonly digest: (v: unknown) => string,
  ) {}

  describe(): { rulesVersion: string; ruleIds: readonly string[] } {
    return {
      rulesVersion: this.ruleSet.rulesVersion,
      ruleIds: this.ruleSet.rules.map((r) => r.id),
    };
  }

  evaluate(input: EvaluationInput): EvaluationResult {
    const active = this.ruleSet.rules
      .filter((r) => isEffective(r, input.asOf))
      .filter((r) => r.minimumStage <= input.stage)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const findings = active
      .map((rule) => this.#evaluateRule(rule, input))
      .filter((f): f is Finding => f !== null);

    // Integrity signals from extraction become findings too — this is how a document
    // containing "ignore previous instructions" reaches the resolution order.
    for (const signal of input.facts.integritySignals) {
      findings.push({
        ruleId: 'integrity.document_signal',
        ruleVersion: '1',
        disposition: 'INTEGRITY_ESCALATE',
        reasonCode: signal.kind === 'INSTRUCTION_LIKE_TEXT' ? 'SUSPICIOUS_CONTENT' : 'DOCUMENT_MISMATCH',
        severity: 100,
        predicate: 'always',
        factsRead: [],
        tested: { document_id: signal.documentId, signal: signal.kind },
        threshold: {},
        detectableAtStage: 4,
        terminal: false,
      });
    }

    const verdict = this.#resolve(findings, input);
    return { verdict, findings };
  }

  #evaluateRule(rule: Rule, input: EvaluationInput): Finding | null {
    const base = {
      ruleId: rule.id,
      ruleVersion: rule.version,
      predicate: rule.predicate,
      detectableAtStage: rule.detectableAtStage,
    } as const;

    // Gate: does this rule apply to this case at all?
    if (rule.appliesWhen) {
      const gate = input.facts.resolve(rule.appliesWhen.key);
      const gateValue = gate.status === 'KNOWN' || gate.status === 'LOW_CONFIDENCE' ? gate.fact.value : undefined;
      if (!rule.appliesWhen.valueIn.includes(gateValue)) return null;
    }

    // Gather exactly what the rule declared it reads. Nothing else is visible to it.
    const values: Record<string, unknown> = {};
    const factsRead: FactRef[] = [];
    const missing: string[] = [];
    const conflicted: string[] = [];
    const lowConfidence: string[] = [];

    for (const key of rule.reads) {
      const r = input.facts.resolve(key);
      switch (r.status) {
        case 'KNOWN':
          values[key] = r.fact.value;
          factsRead.push(refOf(r.fact));
          break;
        case 'LOW_CONFIDENCE':
          lowConfidence.push(key);
          factsRead.push(refOf(r.fact));
          break;
        case 'CONFLICTED':
          conflicted.push(key);
          for (const c of r.candidates) factsRead.push(refOf(c));
          break;
        case 'UNKNOWN':
          missing.push(key);
          break;
      }
    }

    // Untrustworthy facts are never decided on. This is the case-9 lesson: a wrong-parcel
    // title report must not produce a decline, because it isn't about this applicant.
    if (conflicted.length > 0 || lowConfidence.length > 0) {
      return {
        ...base,
        disposition: 'INTEGRITY_ESCALATE',
        reasonCode: conflicted.length > 0 ? 'CONFLICTING_FACTS' : 'LOW_EXTRACTION_CONFIDENCE',
        severity: 95,
        factsRead,
        tested: { conflicted, low_confidence: lowConfidence },
        threshold: { confidence_floor: this.ruleSet.confidenceFloor },
        terminal: false,
      };
    }

    if (missing.length > 0) {
      if (rule.onMissingFacts === 'SKIP') {
        return {
          ...base,
          disposition: 'PASS',
          severity: 0,
          factsRead,
          tested: {},
          threshold: {},
          terminal: false,
          missingFacts: missing,
        };
      }
      return {
        ...base,
        disposition: rule.onMissingFacts,
        reasonCode: rule.onMissingFacts === 'INCOMPLETE' ? 'DOCUMENT_MISSING' : 'ESCALATE_MISSING_FACTS',
        severity: 40,
        factsRead,
        tested: {},
        threshold: {},
        terminal: false,
        missingFacts: missing,
      };
    }

    let result;
    try {
      result = PREDICATES[rule.predicate]({ values, params: rule.params, asOf: input.asOf });
    } catch (err) {
      // Total: a malformed fact escalates, it does not throw into the caller's face.
      return {
        ...base,
        disposition: 'INTEGRITY_ESCALATE',
        reasonCode: 'CONFLICTING_FACTS',
        severity: 95,
        factsRead,
        tested: { error: err instanceof PredicateError ? err.message : String(err) },
        threshold: {},
        terminal: false,
      };
    }

    const spec: RuleOutcomeSpec | undefined = result.pass ? rule.onPass : rule.onFail;
    return {
      ...base,
      disposition: spec?.disposition ?? (result.pass ? 'PASS' : 'DECLINE'),
      ...(spec?.reasonCode !== undefined ? { reasonCode: spec.reasonCode } : {}),
      severity: spec?.severity ?? (result.pass ? 0 : 50),
      factsRead,
      tested: result.tested,
      threshold: result.threshold,
      terminal: spec?.terminal ?? false,
      ...(spec?.blocksApproval ? { blocksApproval: true } : {}),
    };
  }

  /**
   * Resolution order. Deterministic, total, and unit-testable apart from the rules.
   *
   *   1. INTEGRITY_ESCALATE  — facts untrusted; deciding on them is the case-9 failure
   *   2. terminal DECLINE    — unappealable; escalating a Texas property wastes a human
   *   3. POLICY_ESCALATE     — outranks non-terminal DECLINE, so the escalation
   *                            false-negative rate is ZERO BY CONSTRUCTION, not by
   *                            measurement (confirmed decision, log entry 010)
   *   4. DECLINE
   *   5. INCOMPLETE          — Reg B: not an adverse action
   *   6. APPROVE
   */
  #resolve(findings: readonly Finding[], input: EvaluationInput): Verdict {
    const of = (d: Disposition) => findings.filter((f) => f.disposition === d);

    const integrity = of('INTEGRITY_ESCALATE');
    const terminalDeclines = of('DECLINE').filter((f) => f.terminal);
    const policy = of('POLICY_ESCALATE');
    const declines = of('DECLINE').filter((f) => !f.terminal);
    const incomplete = of('INCOMPLETE');

    let winners: readonly Finding[];
    let decision: Verdict['decision'];
    let escalationKind: 'POLICY' | 'INTEGRITY' | undefined;

    if (integrity.length > 0) {
      [winners, decision, escalationKind] = [integrity, 'ESCALATE', 'INTEGRITY'];
    } else if (terminalDeclines.length > 0) {
      [winners, decision] = [terminalDeclines, 'DECLINE'];
    } else if (policy.length > 0) {
      [winners, decision, escalationKind] = [policy, 'ESCALATE', 'POLICY'];
    } else if (declines.length > 0) {
      [winners, decision] = [declines, 'DECLINE'];
    } else if (incomplete.length > 0) {
      [winners, decision] = [incomplete, 'INCOMPLETE'];
    } else {
      // Nothing objected. But a "necessary but not sufficient" check that never got
      // confirmed must not become a clean approval — see RuleOutcomeSpec.blocksApproval.
      const blockers = findings.filter((f) => f.blocksApproval);
      if (blockers.length > 0) {
        [winners, decision, escalationKind] = [blockers, 'ESCALATE', 'POLICY'];
      } else {
        [winners, decision] = [[], 'APPROVE'];
      }
    }

    const principalReasons = [...winners]
      .sort((a, b) => b.severity - a.severity || (a.ruleId < b.ruleId ? -1 : 1))
      .map((f) => f.reasonCode)
      .filter((c): c is string => c !== undefined)
      .filter((c, i, arr) => arr.indexOf(c) === i)
      .slice(0, 4); // Reg B: more than four reasons is "not likely to be helpful"

    return {
      decision,
      principalReasons,
      findings,
      rulesVersion: this.ruleSet.rulesVersion,
      ruleSetHash: this.ruleSet.hash,
      factSnapshotId: input.facts.snapshotId(this.digest),
      evaluatedAsOf: input.asOf,
      evaluatedAtStage: input.stage,
      engineVersion: ENGINE_VERSION,
      ...(escalationKind
        ? {
            escalation: {
              kind: escalationKind,
              question: questionFor(escalationKind, winners),
            },
          }
        : {}),
    };
  }
}

function refOf(f: Fact): FactRef {
  const p = f.provenance;
  return {
    key: f.key,
    confidence: f.confidence,
    ...(p.source === 'DOCUMENT_EXTRACTED' ? { documentId: p.documentId, runId: p.runId } : {}),
  };
}

/** Templated from the rule, never generated. */
function questionFor(kind: 'POLICY' | 'INTEGRITY', winners: readonly Finding[]): string {
  const codes = [...new Set(winners.map((w) => w.reasonCode).filter(Boolean))].join(', ');
  return kind === 'INTEGRITY'
    ? `The facts in this packet are not trustworthy (${codes}). Establish which document is wrong before any decision is made.`
    : `Policy judgement required (${codes}). The facts are established; the published rules do not settle the outcome.`;
}

function isEffective(rule: Rule, asOf: string): boolean {
  if (rule.effectiveFrom > asOf) return false;
  return rule.effectiveTo === undefined || rule.effectiveTo > asOf;
}

export type { FactSet };
