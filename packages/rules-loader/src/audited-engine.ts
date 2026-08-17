/**
 * The adapter that reconciles two requirements that appear to conflict:
 *
 *   - the rules engine must be pure with no dependencies, so it cannot reach a model
 *   - every step must emit an audit record
 *
 * A pure function cannot write to a store. So the engine RETURNS its audit material and
 * this wrapper persists it. If the append fails, no verdict is returned — a decision
 * that was not recorded did not happen.
 *
 * This is the only rules-engine constructor exposed at the composition root, so the
 * unaudited path is not reachable from production wiring.
 */
import type {
  AuditRecord,
  AuditSink,
  CorrelationId,
  RecordId,
  RuleEvaluationPayload,
  RunId,
  Sha256Hex,
  VerdictPayload,
} from '@hei/audit';
import { computeSeal, digestOf } from '@hei/audit';
import type { EvaluationInput, Finding, RulesEngine, Verdict } from '@hei/rules-engine';

export interface Clock {
  now(): string;
}

export interface IdGen {
  next(): string;
}

export interface TraceContext {
  readonly correlationId: CorrelationId;
  readonly runId: RunId;
  /** Next free sequence number for this case. Replay orders by it. */
  readonly startSequence: number;
  readonly parentRecordId?: RecordId;
}

export class AuditAppendFailed extends Error {
  constructor(cause: unknown) {
    super(`Verdict withheld: the audit append failed (${String(cause)}). A decision that ` +
      `was not recorded did not happen.`);
    this.name = 'AuditAppendFailed';
  }
}

export class AuditedRulesEngine {
  constructor(
    private readonly inner: RulesEngine,
    private readonly sink: AuditSink,
    private readonly clock: Clock,
    private readonly ids: IdGen,
  ) {}

  async evaluate(input: EvaluationInput, ctx: TraceContext): Promise<Verdict> {
    const startedAt = this.clock.now();
    // Still pure, still synchronous. Nothing can await inside here.
    const { verdict, findings } = this.inner.evaluate(input);
    const finishedAt = this.clock.now();

    let sequence = ctx.startSequence;
    const records: AuditRecord[] = [];

    // One record per rule CONSIDERED — passes and skips included. This is what makes a
    // DECLINE replay show every check that ran, not only the one that failed.
    for (const f of findings) {
      records.push({
        recordId: this.ids.next() as RecordId,
        correlationId: ctx.correlationId,
        runId: ctx.runId,
        ...(ctx.parentRecordId ? { parentRecordId: ctx.parentRecordId } : {}),
        sequence: sequence++,
        recordKind: 'RULE_EVALUATION',
        stepName: 'rules.evaluate',
        stepVersion: verdict.engineVersion,
        actorType: 'SYSTEM',
        actorId: 'rules-engine',
        occurredAt: startedAt,
        outcome: outcomeOf(f),
        inputDigest: digestOf(f.tested),
        attempt: 1,
        payload: payloadOf(f, verdict),
      });
    }

    const verdictBody: Omit<VerdictPayload, 'seal'> = {
      decision: verdict.decision,
      principalReasons: verdict.principalReasons,
      rulesVersion: verdict.rulesVersion,
      ruleSetHash: verdict.ruleSetHash as Sha256Hex,
      factSnapshotId: verdict.factSnapshotId as Sha256Hex,
      evaluatedAtStage: verdict.evaluatedAtStage,
      ...(verdict.escalation ? { escalationKind: verdict.escalation.kind } : {}),
    };

    records.push({
      recordId: this.ids.next() as RecordId,
      correlationId: ctx.correlationId,
      runId: ctx.runId,
      sequence: sequence++,
      recordKind: 'VERDICT',
      stepName: 'verdict.seal',
      stepVersion: 'sealer@1.0.0',
      actorType: 'SYSTEM',
      actorId: 'sealer',
      occurredAt: finishedAt,
      outcome: 'OK',
      inputDigest: digestOf(verdictBody),
      attempt: 1,
      payload: { ...verdictBody, seal: computeSeal(verdictBody) },
    });

    try {
      await this.sink.appendAll(records);
    } catch (cause) {
      throw new AuditAppendFailed(cause);
    }

    return verdict;
  }
}

function outcomeOf(f: Finding): 'OK' | 'FAIL' | 'SKIPPED' {
  if (f.missingFacts && f.missingFacts.length > 0) return 'SKIPPED';
  return f.disposition === 'PASS' || f.disposition === 'INFO' ? 'OK' : 'FAIL';
}

function payloadOf(f: Finding, v: Verdict): RuleEvaluationPayload {
  return {
    ruleId: f.ruleId,
    ruleVersion: f.ruleVersion,
    rulesVersion: v.rulesVersion,
    ruleSetHash: v.ruleSetHash as Sha256Hex,
    predicate: f.predicate,
    tested: f.tested,
    threshold: f.threshold,
    verdict:
      f.missingFacts && f.missingFacts.length > 0
        ? 'NOT_EVALUATED'
        : f.disposition === 'PASS' || f.disposition === 'INFO'
          ? 'PASS'
          : 'FAIL',
    disposition: f.disposition,
    ...(f.reasonCode !== undefined ? { reasonCode: f.reasonCode } : {}),
    terminal: f.terminal,
    factsRead: f.factsRead.map((r) => ({
      key: r.key,
      ...(r.documentId !== undefined ? { documentId: r.documentId } : {}),
      ...(r.runId !== undefined ? { runId: r.runId } : {}),
      ...(r.confidence !== undefined ? { confidence: r.confidence } : {}),
    })),
    detectableAtStage: f.detectableAtStage,
    evaluatedAtStage: v.evaluatedAtStage,
    ...(f.missingFacts ? { missingFacts: f.missingFacts } : {}),
  };
}
