import { describe, expect, it } from 'vitest';
import { detectAlerts } from './detectors.js';
import { DEFAULT_THRESHOLDS } from './alerts.js';
import type { AuditRecord, CorrelationId, RecordId, RunId, Sha256Hex } from '@hei/audit';
import { computeSeal, digestOf } from '@hei/audit';

const NOW = '2026-08-17T12:00:00.000Z';
const AGO = (minutes: number) => new Date(Date.parse(NOW) - minutes * 60_000).toISOString();

let counter = 0;
const base = (correlationId: string, sequence: number, occurredAt = AGO(5)) => ({
  recordId: `rec-${counter++}` as RecordId,
  correlationId: correlationId as CorrelationId,
  runId: 'run-1' as RunId,
  sequence,
  stepVersion: 'v1',
  occurredAt,
  inputDigest: digestOf({}) as Sha256Hex,
  attempt: 1,
});

const modelCall = (caseId: string, seq: number, over: Partial<Record<string, unknown>> = {}): AuditRecord => ({
  ...base(caseId, seq),
  recordKind: 'MODEL_CALL',
  stepName: 'extract.prelim_title',
  actorType: 'MODEL',
  actorId: 'test-model',
  outcome: 'OK',
  payload: {
    modelId: 'test-model',
    promptId: 'extract.prelim_title.v1',
    promptHash: digestOf('p') as Sha256Hex,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.01,
    latencyMs: 500,
    finishReason: 'end_turn',
    rawResponseDigest: digestOf('r') as Sha256Hex,
    parsedOk: true,
    ...over,
  },
});

const ruleEval = (caseId: string, seq: number, over: Partial<Record<string, unknown>> = {}): AuditRecord => ({
  ...base(caseId, seq),
  recordKind: 'RULE_EVALUATION',
  stepName: 'rules.evaluate',
  actorType: 'SYSTEM',
  actorId: 'rules-engine',
  outcome: 'OK',
  payload: {
    ruleId: 'credit.min_score',
    ruleVersion: '1',
    rulesVersion: '2026-08-16',
    ruleSetHash: digestOf('rs') as Sha256Hex,
    predicate: 'at_least',
    tested: {},
    threshold: {},
    verdict: 'PASS',
    disposition: 'PASS',
    factsRead: [],
    ...over,
  },
});

const verdict = (caseId: string, seq: number, decision: string): AuditRecord => {
  const body = {
    decision: decision as 'APPROVE',
    principalReasons: [],
    rulesVersion: '2026-08-16',
    ruleSetHash: digestOf('rs') as Sha256Hex,
    factSnapshotId: digestOf('f') as Sha256Hex,
    evaluatedAtStage: 6,
  };
  return {
    ...base(caseId, seq),
    recordKind: 'VERDICT',
    stepName: 'verdict.seal',
    actorType: 'SYSTEM',
    actorId: 'sealer',
    outcome: 'OK',
    payload: { ...body, seal: computeSeal(body) },
  };
};

const run = (records: AuditRecord[]) =>
  detectAlerts({ records, thresholds: DEFAULT_THRESHOLDS, now: NOW, confidenceFloor: 0.7 });

const find = (records: AuditRecord[], detector: string) =>
  run(records).find((a) => a.detector === detector);

describe('a healthy pipeline is silent', () => {
  it('emits nothing when everything is normal', () => {
    // A realistic mix: every rule fires on somebody, confidence is high, verdicts land.
    const records = Array.from({ length: 30 }, (_, i) => [
      modelCall(`c${i}`, 0),
      ruleEval(`c${i}`, 1, {
        ruleId: 'credit.min_score',
        disposition: i % 5 === 0 ? 'DECLINE' : 'PASS',
        verdict: i % 5 === 0 ? 'FAIL' : 'PASS',
        factsRead: [{ key: 'credit.score', confidence: 0.95 }],
      }),
      ruleEval(`c${i}`, 2, {
        ruleId: 'equity.max_cltv',
        disposition: i % 7 === 0 ? 'DECLINE' : 'PASS',
        verdict: i % 7 === 0 ? 'FAIL' : 'PASS',
        factsRead: [{ key: 'valuation.appraised_value', confidence: 0.97 }],
      }),
      verdict(`c${i}`, 3, i % 5 === 0 ? 'DECLINE' : 'APPROVE'),
    ]).flat();
    expect(run(records)).toEqual([]);
  });
});

describe('LOUD failures — the model errored or would not parse', () => {
  it('pages when extraction output stops parsing', () => {
    const records = Array.from({ length: 30 }, (_, i) =>
      modelCall(`c${i}`, 0, { parsedOk: i < 3 ? false : true }),
    );
    const alert = find(records, 'extraction.parse_failures')!;
    expect(alert.severity).toBe('PAGE');
    expect(alert.title).toContain('10.0%');
    expect(alert.correlationIds).toHaveLength(3);
    expect(alert.runbook).toBeTruthy();
  });

  it('stays quiet below the minimum sample — three cases is not a trend', () => {
    const records = [modelCall('c1', 0, { parsedOk: false })];
    expect(find(records, 'extraction.parse_failures')).toBeUndefined();
  });
});

describe('QUIET failures — nothing threw and the answers are wrong', () => {
  it('pages on a confidence collapse', () => {
    const records = Array.from({ length: 40 }, (_, i) =>
      ruleEval(`c${i}`, 0, {
        factsRead: [{ key: 'valuation.appraised_value', confidence: i < 12 ? 0.3 : 0.95 }],
      }),
    );
    const alert = find(records, 'extraction.confidence_collapse')!;
    expect(alert.severity).toBe('PAGE');
    expect(alert.detail).toContain('valuation.appraised_value');
    expect(alert.detail).toMatch(/hedging|below/i);
  });

  // The keyword floor is meant to be redundant. When it isn't, extraction regressed on
  // the exact field this project exists to read.
  it('raises a ticket when the keyword floor catches what the model missed', () => {
    const records = [
      ruleEval('c1', 0, { ruleId: 'condition.disclosed_conditions', disposition: 'PASS' }),
      ruleEval('c1', 1, { ruleId: 'condition.disclosed_damage_keywords', disposition: 'DECLINE' }),
    ];
    const alert = find(records, 'extraction.detector_disagreement')!;
    expect(alert.correlationIds).toEqual(['c1']);
    expect(alert.runbook).toContain('Do NOT fix by widening the keyword list');
  });

  it('does not fire when both detectors agree', () => {
    const records = [
      ruleEval('c1', 0, { ruleId: 'condition.disclosed_conditions', disposition: 'DECLINE' }),
      ruleEval('c1', 1, { ruleId: 'condition.disclosed_damage_keywords', disposition: 'DECLINE' }),
    ];
    expect(find(records, 'extraction.detector_disagreement')).toBeUndefined();
  });

  // The one that reaches a customer first: nothing failed, it is just sitting there.
  it('pages on cases that entered and never reached a verdict', () => {
    const records = [
      modelCall('stuck-1', 0, {}),
      { ...modelCall('stuck-1', 1, {}), occurredAt: AGO(90) },
      modelCall('fine-1', 0, {}),
      verdict('fine-1', 1, 'APPROVE'),
    ];
    const alert = find(records, 'pipeline.stuck_cases')!;
    expect(alert.severity).toBe('PAGE');
    expect(alert.correlationIds).toEqual(['stuck-1']);
    expect(alert.detail).toMatch(/will call before any dashboard turns red/);
  });

  it('flags rules that are evaluated but never produce an outcome', () => {
    const records = Array.from({ length: 25 }, (_, i) =>
      ruleEval(`c${i}`, 0, { ruleId: 'lien.superpriority', disposition: 'PASS' }),
    );
    expect(find(records, 'rules.dormant')!.detail).toContain('lien.superpriority');
  });
});

describe('security and integrity', () => {
  it('pages on instruction-like text in a submitted document', () => {
    const records = [ruleEval('c1', 0, { reasonCode: 'SUSPICIOUS_CONTENT', disposition: 'INTEGRITY_ESCALATE' })];
    const alert = find(records, 'security.suspicious_content')!;
    expect(alert.severity).toBe('PAGE');
    expect(alert.detail).toContain('nowhere for it to land');
  });

  it('pages on a broken audit chain, and ranks it first', () => {
    const records = [
      ruleEval('c1', 0),
      ruleEval('c1', 5), // gap
      verdict('c2', 0, 'APPROVE'), // verdict with no rules behind it
    ];
    const alerts = run(records);
    expect(alerts[0]!.detector).toBe('audit.integrity');
    expect(alerts[0]!.severity).toBe('PAGE');
    expect([...alerts[0]!.correlationIds].sort()).toEqual(['c1', 'c2']);
  });
});

describe('outcome mix', () => {
  it('pages when escalations spike — human review is the bottleneck', () => {
    const records = Array.from({ length: 30 }, (_, i) => [
      ruleEval(`c${i}`, 0),
      verdict(`c${i}`, 1, i < 20 ? 'ESCALATE' : 'APPROVE'),
    ]).flat();
    const alert = find(records, 'outcomes.escalation_spike')!;
    expect(alert.severity).toBe('PAGE');
    expect(alert.title).toContain('66.7%');
  });

  it('raises a ticket when model spend per case runs high', () => {
    const records = Array.from({ length: 25 }, (_, i) => modelCall(`c${i}`, 0, { costUsd: 3.5 }));
    expect(find(records, 'model.cost_per_case')!.runbook).toContain('retry loop');
  });
});

describe('every alert is actionable', () => {
  it('carries a title with numbers, a detail, and a runbook', () => {
    const records = Array.from({ length: 30 }, (_, i) => modelCall(`c${i}`, 0, { parsedOk: false }));
    for (const alert of run(records)) {
      expect(alert.title).toMatch(/\d/);
      expect(alert.detail.length).toBeGreaterThan(40);
      expect(alert.runbook.length).toBeGreaterThan(20);
      expect(alert.detail).not.toMatch(/an error occurred/i);
    }
  });
});
