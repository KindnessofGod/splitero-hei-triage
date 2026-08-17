/**
 * Hand-written audit chains for testing replay.
 *
 * These are written by hand rather than generated, because the point is to pin the
 * SHAPE of a trace before any pipeline exists to produce one. When the real pipeline
 * lands, its output is asserted against this shape.
 *
 * The DECLINE case is adversarial case 2 from HEI_DOMAIN §6.5: the application declares
 * one mortgage, Schedule B shows a deed of trust AND a HELOC, combined loan-to-value
 * lands at 0.78 against a verified maximum of 0.75.
 */
import type {
  AuditRecord,
  CorrelationId,
  RecordId,
  RuleEvaluationPayload,
  RunId,
  Sha256Hex,
  VerdictPayload,
} from '../record.js';
import { computeSeal, digestOf } from '../seal.js';

const CASE = 'HEI-0137' as CorrelationId;
const RUN = 'run-01' as RunId;
const RULES_VERSION = '2026-08-16';
const RULE_SET_HASH = digestOf({ rulesVersion: RULES_VERSION });

let seq = 0;
const id = (n: number) => `rec-${String(n).padStart(3, '0')}` as RecordId;

function rule(p: Omit<RuleEvaluationPayload, 'rulesVersion' | 'ruleSetHash'>): AuditRecord {
  const sequence = seq++;
  const payload: RuleEvaluationPayload = {
    ...p,
    rulesVersion: RULES_VERSION,
    ruleSetHash: RULE_SET_HASH,
  };
  return {
    recordId: id(sequence),
    correlationId: CASE,
    runId: RUN,
    sequence,
    recordKind: 'RULE_EVALUATION',
    stepName: 'rules.evaluate',
    stepVersion: 'rules-engine@0.1.0',
    actorType: 'SYSTEM',
    actorId: 'rules-engine',
    occurredAt: '2026-08-17T09:14:07.000Z',
    outcome: payload.verdict === 'NOT_EVALUATED' ? 'SKIPPED' : 'OK',
    inputDigest: digestOf(payload.tested),
    attempt: 1,
    payload,
  };
}

const ingest: AuditRecord = {
  recordId: id(seq),
  correlationId: CASE,
  runId: RUN,
  sequence: seq++,
  recordKind: 'STEP',
  stepName: 'ingest.receive',
  stepVersion: 'ingest@0.1.0',
  actorType: 'SYSTEM',
  actorId: 'n8n:webhook',
  occurredAt: '2026-08-17T09:14:02.000Z',
  durationMs: 12,
  outcome: 'OK',
  inputDigest: digestOf({ documents: 6 }),
  attempt: 1,
  payload: {
    summary:
      '6 documents received, 1 duplicate suppressed ' +
      '(same bytes as doc_04, declared filename "scan_003.pdf" vs "insurance.pdf")',
  },
};

const extract: AuditRecord = {
  recordId: id(seq),
  correlationId: CASE,
  runId: RUN,
  parentRecordId: ingest.recordId,
  sequence: seq++,
  recordKind: 'MODEL_CALL',
  stepName: 'extract.prelim_title',
  stepVersion: 'extractor@0.1.0',
  actorType: 'MODEL',
  actorId: 'claude-opus-5',
  occurredAt: '2026-08-17T09:14:05.000Z',
  durationMs: 2140,
  outcome: 'OK',
  inputDigest: digestOf({ documentId: 'doc_01' }),
  attempt: 1,
  payload: {
    modelId: 'claude-opus-5',
    promptId: 'extract.prelim_title.v3',
    promptHash: digestOf('extract.prelim_title.v3'),
    inputTokens: 8420,
    outputTokens: 512,
    costUsd: 0.0871,
    latencyMs: 2140,
    finishReason: 'end_turn',
    rawResponseDigest: digestOf({ raw: 'schedule-b-two-liens' }),
    parsedOk: true,
    schemaId: 'prelim_title.v3',
  },
};

const rules: AuditRecord[] = [
  rule({
    ruleId: 'geography.state_serviced',
    ruleVersion: '1',
    predicate: 'value_in_set',
    tested: { state: 'CA' },
    threshold: { set_size: 17 },
    verdict: 'PASS',
    disposition: 'POLICY_ESCALATE',
    reasonCode: 'STATE_ELIGIBLE_PENDING_AREA_CHECK',
    terminal: false,
    factsRead: [{ key: 'property.state', confidence: 1 }],
    detectableAtStage: 1,
    evaluatedAtStage: 3,
  }),
  rule({
    ruleId: 'credit.min_score',
    ruleVersion: '1',
    predicate: 'at_least',
    tested: { credit_score: 712 },
    threshold: { min_score: 500 },
    verdict: 'PASS',
    factsRead: [{ key: 'credit.score', confidence: 1 }],
    detectableAtStage: 3,
    evaluatedAtStage: 3,
  }),
  rule({
    ruleId: 'property.value_band',
    ruleVersion: '1',
    predicate: 'within_range',
    tested: { appraised_value_usd: 580000 },
    threshold: { min_usd: 200000, max_usd: 5000000 },
    verdict: 'PASS',
    factsRead: [{ key: 'valuation.appraised_value', documentId: 'doc_02', confidence: 0.99 }],
    detectableAtStage: 5,
    evaluatedAtStage: 3,
  }),
  rule({
    ruleId: 'equity.max_cltv',
    ruleVersion: '2',
    predicate: 'ratio_at_most',
    tested: { combined_lien_balance_usd: 452400, appraised_value_usd: 580000, cltv: 0.78 },
    threshold: { max_cltv: 0.75 },
    verdict: 'FAIL',
    disposition: 'DECLINE',
    reasonCode: 'CLTV_EXCEEDED',
    terminal: false,
    factsRead: [
      { key: 'title.lien_schedule', documentId: 'doc_01', runId: 'x1', confidence: 0.97 },
      { key: 'valuation.appraised_value', documentId: 'doc_02', runId: 'x2', confidence: 0.99 },
    ],
    detectableAtStage: 4,
    evaluatedAtStage: 3,
  }),
  rule({
    ruleId: 'insurance.coverage_a',
    ruleVersion: '1',
    predicate: 'at_least',
    tested: {},
    threshold: { min_ratio_of_value: 0.8 },
    verdict: 'NOT_EVALUATED',
    factsRead: [],
    missingFacts: ['insurance.coverage_a_usd'],
    detectableAtStage: 4,
    evaluatedAtStage: 3,
  }),
];

const verdictBody: Omit<VerdictPayload, 'seal'> = {
  decision: 'DECLINE',
  principalReasons: ['CLTV_EXCEEDED'],
  rulesVersion: RULES_VERSION,
  ruleSetHash: RULE_SET_HASH,
  factSnapshotId: digestOf({ snapshot: 'HEI-0137@stage3' }),
  evaluatedAtStage: 3,
};

const verdict: AuditRecord = {
  recordId: id(seq),
  correlationId: CASE,
  runId: RUN,
  sequence: seq++,
  recordKind: 'VERDICT',
  stepName: 'verdict.seal',
  stepVersion: 'sealer@1.0.0',
  actorType: 'SYSTEM',
  actorId: 'sealer',
  occurredAt: '2026-08-17T09:14:08.000Z',
  durationMs: 1,
  outcome: 'OK',
  inputDigest: digestOf(verdictBody),
  attempt: 1,
  payload: { ...verdictBody, seal: computeSeal(verdictBody) },
};

export const declineChain: readonly AuditRecord[] = [ingest, extract, ...rules, verdict];

/** Same chain with record 2 removed, leaving a hole in the sequence. */
export const sequenceGapChain: readonly AuditRecord[] = declineChain.filter(
  (r) => r.sequence !== 2,
);

/** A verdict whose stored decision was altered after sealing. */
export const tamperedSealChain: readonly AuditRecord[] = declineChain.map((r) =>
  r.recordKind === 'VERDICT'
    ? { ...r, payload: { ...r.payload, decision: 'APPROVE' as const } }
    : r,
);

export const FIXTURE_CASE_ID = CASE;
export const FIXTURE_RULE_SET_HASH: Sha256Hex = RULE_SET_HASH;
