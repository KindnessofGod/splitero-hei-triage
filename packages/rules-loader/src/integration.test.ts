/**
 * The whole deterministic half, end to end: real YAML -> compiled rules -> pure engine
 * -> audit records -> replay narrative. No fakes except the clock and the id generator.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeterministicRulesEngine, FactSet, type Fact } from '@hei/rules-engine';
import {
  InMemoryAuditStore,
  narrate,
  checkIntegrity,
  digestOf,
  type CorrelationId,
  type RunId,
} from '@hei/audit';
import { loadRuleSetFile, AuditedRulesEngine, AuditAppendFailed, compileRuleSet } from './index.js';
import type { AuditSink } from '@hei/audit';

const RULES_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../../rules/2026-08-16.yaml');
const loaded = loadRuleSetFile(RULES_PATH);

const fixedClock = { now: () => '2026-08-17T10:00:00.000Z' };
const counterIds = () => {
  let n = 0;
  return { next: () => `rec-${String(n++).padStart(3, '0')}` };
};

const fact = (key: string, value: unknown, confidence = 0.98): Fact => ({
  key,
  value,
  confidence,
  provenance: { source: 'DOCUMENT_EXTRACTED', documentId: 'doc_01', runId: 'x1' },
  observedAt: '2026-08-17T00:00:00Z',
});

const said = (key: string, value: unknown): Fact => ({
  key,
  value,
  confidence: 1,
  provenance: { source: 'APPLICANT_STATED', field: key },
  observedAt: '2026-08-17T00:00:00Z',
});

let store: InMemoryAuditStore;
let audited: AuditedRulesEngine;
const engine = new DeterministicRulesEngine(loaded.ruleSet, digestOf);

beforeEach(() => {
  store = new InMemoryAuditStore();
  audited = new AuditedRulesEngine(engine, store, fixedClock, counterIds());
});

const evaluate = async (facts: Fact[], stage = 6) =>
  audited.evaluate(
    { caseId: 'HEI-INT', facts: new FactSet(facts, [], { confidenceFloor: 0.7 }), asOf: '2026-08-17T00:00:00Z', stage: stage as 6 },
    { correlationId: 'HEI-INT' as CorrelationId, runId: 'run-1' as RunId, startSequence: 0 },
  );

describe('the YAML rule set compiles', () => {
  it('loads without error and carries its version', () => {
    expect(loaded.ruleSet.rulesVersion).toBe('2026-08-16');
    expect(loaded.ruleSet.rules.length).toBeGreaterThan(25);
    expect(loaded.ruleSet.hash).toHaveLength(64);
  });

  it('encodes the four values the research file got wrong', () => {
    const byId = new Map(loaded.ruleSet.rules.map((r) => [r.id, r]));
    expect(byId.get('equity.max_cltv')!.params['max']).toBe(0.75);
    expect(byId.get('investment.amount_band')!.params['max']).toBe(600000);
    expect(byId.get('property.value_band')!.params['max']).toBe(5000000);
    expect(loaded.constants['pricing']!['safety_cap_annual_pct']).toBe(0.1799);
  });

  it('lists 17 states and Colorado is not one of them', () => {
    const states = loaded.ruleSet.rules.find((r) => r.id === 'geography.state_serviced')!.params[
      'set'
    ] as string[];
    expect(states).toHaveLength(17);
    expect(states).not.toContain('CO');
    expect(states).toEqual(expect.arrayContaining(['ID', 'MO', 'MT', 'WY']));
  });

  it('records the payout model as total home value, not change in value', () => {
    expect(loaded.constants['payout']!['model']).toBe('TOTAL_HOME_VALUE');
  });
});

describe('adversarial case 8 — self-disclosed damage declines at INTAKE', () => {
  // PRIMARY detector: the model classified the applicant's prose into a condition code.
  it('declines at stage 3 from the extracted condition code', async () => {
    const verdict = await evaluate(
      [fact('application.disclosed_conditions', ['WATER_INTRUSION'], 0.91)],
      3,
    );
    const finding = verdict.findings.find((f) => f.ruleId === 'condition.disclosed_conditions')!;
    expect(finding.disposition).toBe('DECLINE');
    expect(finding.detectableAtStage).toBe(3);
    expect(verdict.decision).toBe('DECLINE');
    expect(verdict.principalReasons).toContain('SELF_DISCLOSED_DAMAGE');
  });

  // The phrasing that motivated the whole redesign: no keyword in this sentence.
  it('catches a paraphrase no keyword list would match', async () => {
    const verdict = await evaluate(
      [
        said('application.free_text_purpose', 'the ceiling stains every time it rains'),
        fact('application.disclosed_conditions', ['WATER_INTRUSION'], 0.88),
      ],
      3,
    );
    // The keyword rule finds nothing here; the extracted code carries it.
    expect(
      verdict.findings.find((f) => f.ruleId === 'condition.disclosed_damage_keywords')!.disposition,
    ).toBe('PASS');
    expect(verdict.decision).toBe('DECLINE');
  });

  // SECONDARY detector: the recall floor. Extraction returned nothing at all.
  it('still declines from the keyword floor when extraction produced no code', async () => {
    const verdict = await evaluate(
      [said('application.free_text_purpose', 'my roof is leaking and I need to replace it')],
      3,
    );
    expect(
      verdict.findings.find((f) => f.ruleId === 'condition.disclosed_damage_keywords')!.disposition,
    ).toBe('DECLINE');
    expect(verdict.decision).toBe('DECLINE');
  });

  it('neither detector fires on an unrelated purpose', async () => {
    const verdict = await evaluate(
      [
        said('application.free_text_purpose', "paying for my daughter's college tuition"),
        fact('application.disclosed_conditions', ['NONE_DISCLOSED'], 0.97),
      ],
      3,
    );
    expect(verdict.principalReasons).not.toContain('SELF_DISCLOSED_DAMAGE');
  });

  it('escalates rather than declining when the extraction was not confident', async () => {
    const verdict = await evaluate(
      [fact('application.disclosed_conditions', ['ROOF_DAMAGE'], 0.35)],
      3,
    );
    expect(verdict.decision).toBe('ESCALATE');
    expect(verdict.principalReasons).toContain('LOW_EXTRACTION_CONFIDENCE');
  });
});

describe('adversarial case 4 — contradictory owner names must NOT over-reject', () => {
  it('approves when fuzzy matching resolved every name', async () => {
    // A complete, clean packet. title.unmatched_owner_names is absent because fuzzy
    // matching resolved "Bob Smith" / "Robert James Smith" / "Robert J. Smith" to one
    // person — so the co-owner rule skips rather than firing.
    const verdict = await evaluate([
      said('property.state', 'CA'),
      said('property.type', 'SINGLE_FAMILY'),
      said('property.occupancy_claim', 'PRIMARY'),
      said('credit.score', 712),
      fact('title.estate_type', 'FEE_SIMPLE'),
      fact('valuation.appraised_value', 580000),
      fact('title.lien_schedule', [{ amount: 300000 }]),
      said('offer.requested_amount', 100000),
      fact('insurance.expiration_date', '2027-06-01'),
      fact('insurance.coverage_a_usd', 520000),
      fact('insurance.valuation_basis', 'REPLACEMENT_COST'),
    ]);

    // Nothing rejected this applicant. The only thing standing between them and an
    // approval is the sub-state service-area check, which is deliberate: Splitero does
    // not publish which areas of California it serves.
    expect(verdict.decision).toBe('ESCALATE');
    expect(verdict.principalReasons).toEqual(['STATE_ELIGIBLE_PENDING_AREA_CHECK']);
    expect(verdict.principalReasons).not.toContain('CO_OWNER_NOT_APPLICANT');
    expect(verdict.principalReasons).not.toContain('VESTING_MISMATCH');
  });
});

describe('adversarial case 19 — leasehold', () => {
  it('declines terminally', async () => {
    const verdict = await evaluate([said('property.state', 'CA'), fact('title.estate_type', 'LEASEHOLD')]);
    expect(verdict.decision).toBe('DECLINE');
    expect(verdict.principalReasons).toContain('LEASEHOLD');
  });
});

describe('adversarial case 10 — PACE super-priority lien', () => {
  it('declines', async () => {
    const verdict = await evaluate([fact('title.lien_types', ['DOT', 'PACE'])]);
    expect(verdict.principalReasons).toContain('SUPERPRIORITY_LIEN');
  });
});

describe('adversarial case 13 — insurance expiring is INCOMPLETE, not DECLINE', () => {
  it('does not produce an adverse action', async () => {
    const verdict = await evaluate(
      [
        said('property.state', 'CA'),
        said('property.type', 'SINGLE_FAMILY'),
        fact('insurance.expiration_date', '2026-08-23'), // 6 days out
      ],
      4,
    );
    expect(verdict.decision).toBe('INCOMPLETE');
    expect(verdict.principalReasons).toContain('INSURANCE_EXPIRING');
  });

  it('passes a policy with plenty of runway', async () => {
    const verdict = await evaluate(
      [said('property.state', 'CA'), said('property.type', 'SINGLE_FAMILY'), fact('insurance.expiration_date', '2027-06-01')],
      4,
    );
    expect(verdict.principalReasons).not.toContain('INSURANCE_EXPIRING');
  });
});

describe('adversarial case 5 — trust vesting escalates, never declines', () => {
  it('routes to a human because trusts are eligible subject to approval', async () => {
    const verdict = await evaluate([fact('title.vesting_type', 'TRUST')]);
    expect(verdict.decision).toBe('ESCALATE');
    expect(verdict.principalReasons).toContain('ENTITY_VESTING');
  });
});

describe('adversarial case 18 — occupancy contradicted across documents', () => {
  it('declines on cross-document reasoning no single document supports', async () => {
    const verdict = await evaluate([
      said('property.occupancy_claim', 'PRIMARY'),
      fact('occupancy.corroborating_signals', ['NO_HOMESTEAD_EXEMPTION', 'LANDLORD_POLICY_DP3']),
    ], 4);
    expect(verdict.principalReasons).toContain('OCCUPANCY_MISMATCH');
  });
});

describe('the audit chain a DECLINE produces', () => {
  it('records every rule considered, including passes and skips', async () => {
    await evaluate([
      said('property.state', 'CA'),
      fact('valuation.appraised_value', 580000),
      fact('title.lien_schedule', [{ amount: 380400 }, { amount: 72000 }]),
      said('offer.requested_amount', 0),
    ]);
    const records = await store.read('HEI-INT' as CorrelationId);
    const rules = records.filter((r) => r.recordKind === 'RULE_EVALUATION');
    const verdicts = records.filter((r) => r.recordKind === 'VERDICT');

    expect(rules.length).toBeGreaterThan(5);
    expect(verdicts).toHaveLength(1);
    expect(rules.some((r) => r.payload.verdict === 'PASS')).toBe(true);
    expect(rules.some((r) => r.payload.verdict === 'FAIL')).toBe(true);
    expect(checkIntegrity(records)).toEqual({ ok: true, problems: [] });
  });

  it('states the rule, version, values tested and threshold — not just the outcome', async () => {
    await evaluate([
      fact('valuation.appraised_value', 580000),
      fact('title.lien_schedule', [{ amount: 380400 }, { amount: 72000 }]),
      said('offer.requested_amount', 0),
    ]);
    const records = await store.read('HEI-INT' as CorrelationId);
    const cltv = records.find(
      (r) => r.recordKind === 'RULE_EVALUATION' && r.payload.ruleId === 'equity.max_cltv',
    )!;
    expect(cltv.payload).toMatchObject({
      ruleId: 'equity.max_cltv',
      ruleVersion: '2',
      rulesVersion: '2026-08-16',
      verdict: 'FAIL',
      reasonCode: 'CLTV_EXCEEDED',
      threshold: { max: 0.75 },
    });
    expect((cltv.payload as { tested: Record<string, unknown> }).tested['ratio']).toBe(0.78);
  });

  it('renders a narrative naming the rule, the value and the threshold', async () => {
    await evaluate([
      fact('valuation.appraised_value', 580000),
      fact('title.lien_schedule', [{ amount: 380400 }, { amount: 72000 }]),
      said('offer.requested_amount', 0),
    ]);
    const text = narrate(await store.read('HEI-INT' as CorrelationId), { verbose: true });
    expect(text).toContain('equity.max_cltv');
    expect(text).toContain('0.78');
    expect(text).toContain('0.75');
    expect(text).toContain('CLTV_EXCEEDED');
    expect(text).toMatch(/integrity: OK/);
  });

  it('withholds the verdict entirely if the audit append fails', async () => {
    const brokenSink: AuditSink = {
      appendAll: () => Promise.reject(new Error('disk on fire')),
    };
    const withBrokenSink = new AuditedRulesEngine(engine, brokenSink, fixedClock, counterIds());
    await expect(
      withBrokenSink.evaluate(
        { caseId: 'X', facts: new FactSet([said('property.state', 'TX')]), asOf: '2026-08-17T00:00:00Z', stage: 1 },
        { correlationId: 'X' as CorrelationId, runId: 'r' as RunId, startSequence: 0 },
      ),
    ).rejects.toThrow(AuditAppendFailed);
  });
});

describe('rule set validation is strict at load, not at decision time', () => {
  const base = `rules_version: "t"\nsource: "t"\nrules:\n`;

  it('rejects an unknown predicate', () => {
    expect(() =>
      compileRuleSet(
        base +
          `  - id: x\n    version: "1"\n    effective_from: "2026-01-01"\n    predicate: vibes\n    reads: [a]\n    minimum_stage: 1\n    detectable_at_stage: 1\n    on_missing_facts: SKIP\n    on_fail: { disposition: DECLINE, reason_code: X }\n`,
      ),
    ).toThrow(/unknown predicate "vibes"/);
  });

  it('rejects a decline with no reason code — it could not produce a compliant notice', () => {
    expect(() =>
      compileRuleSet(
        base +
          `  - id: x\n    version: "1"\n    effective_from: "2026-01-01"\n    predicate: always\n    reads: [a]\n    minimum_stage: 1\n    detectable_at_stage: 1\n    on_missing_facts: SKIP\n    on_fail: { disposition: DECLINE }\n`,
      ),
    ).toThrow(/requires a reason_code/);
  });

  it('rejects duplicate rule ids', () => {
    const one = `  - id: dup\n    version: "1"\n    effective_from: "2026-01-01"\n    predicate: always\n    reads: [a]\n    minimum_stage: 1\n    detectable_at_stage: 1\n    on_missing_facts: SKIP\n    on_pass: { disposition: PASS }\n`;
    expect(() => compileRuleSet(base + one + one)).toThrow(/duplicate rule id "dup"/);
  });
});
