import type { AuditRecord, CorrelationId } from '@hei/audit';
import type { Alert, MonitorInput, Severity } from './alerts.js';

/**
 * Nine detectors, in two families.
 *
 * LOUD failures — the model errored, the output would not parse, the audit append
 * failed. Easy to catch, and largely already visible.
 *
 * QUIET failures — the model returned confident nonsense, a rule stopped firing, cases
 * are piling up unreviewed. These are the ones that reach a customer first, because
 * nothing threw. Most of what follows targets these.
 */

type Detector = (input: MonitorInput) => Alert[];

const alertId = (detector: string, now: string) => `${detector}@${now}`;

function ratio(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

const modelCalls = (r: readonly AuditRecord[]) => r.filter((x) => x.recordKind === 'MODEL_CALL');
const verdicts = (r: readonly AuditRecord[]) => r.filter((x) => x.recordKind === 'VERDICT');
const ruleEvals = (r: readonly AuditRecord[]) => r.filter((x) => x.recordKind === 'RULE_EVALUATION');

/** LOUD — the model's output could not be parsed into facts. */
const extractionParseFailures: Detector = ({ records, thresholds, now }) => {
  const calls = modelCalls(records);
  if (calls.length < thresholds.minimumSample) return [];

  const failed = calls.filter((c) => !c.payload.parsedOk);
  const rate = ratio(failed.length, calls.length);
  if (rate <= thresholds.parseFailureRate) return [];

  return [{
    alertId: alertId('extraction.parse_failures', now),
    detector: 'extraction.parse_failures',
    severity: 'PAGE',
    title: `Extraction output unparseable on ${pct(rate)} of calls`,
    detail:
      `${failed.length} of ${calls.length} model calls returned output that did not parse ` +
      `against the response schema (threshold ${pct(thresholds.parseFailureRate)}). ` +
      `Affected prompts: ${[...new Set(failed.map((f) => f.payload.promptId))].join(', ')}. ` +
      `Those cases produced NO facts, so downstream rules reported INCOMPLETE rather than ` +
      `deciding — applicants are stalled, not misjudged.`,
    correlationIds: unique(failed.map((f) => f.correlationId)),
    observedAt: now,
    runbook:
      'Check whether the model or prompt version changed. The raw response is on each ' +
      'MODEL_CALL record — read one before theorising.',
  }];
};

/**
 * QUIET — the most dangerous one. The model is answering, nothing is throwing, and the
 * answers are increasingly hedged. A confidence collapse means facts are landing below
 * the floor, which silently converts decisions into escalations, which buries a queue.
 */
const confidenceCollapse: Detector = ({ records, thresholds, now, confidenceFloor }) => {
  const facts = ruleEvals(records).flatMap((r) => r.payload.factsRead);
  if (facts.length < thresholds.minimumSample) return [];

  const low = facts.filter((f) => f.confidence !== undefined && f.confidence < confidenceFloor);
  const rate = ratio(low.length, facts.length);
  if (rate <= thresholds.lowConfidenceRate) return [];

  const byKey = countBy(low.map((f) => f.key));
  return [{
    alertId: alertId('extraction.confidence_collapse', now),
    detector: 'extraction.confidence_collapse',
    severity: 'PAGE',
    title: `${pct(rate)} of extracted facts are below the confidence floor`,
    detail:
      `${low.length} of ${facts.length} facts scored under ${confidenceFloor} ` +
      `(threshold ${pct(thresholds.lowConfidenceRate)}). Worst fields: ` +
      `${topN(byKey, 3)}. Nothing has errored — the model is answering and hedging. ` +
      `Every affected case escalates instead of deciding.`,
    correlationIds: unique(ruleEvals(records).map((r) => r.correlationId)).slice(0, 20),
    observedAt: now,
    runbook:
      'Compare against the eval baseline for the same fields. A document-format change ' +
      'upstream is the usual cause; a prompt or model change is the next.',
  }];
};

/**
 * QUIET — two independent detectors are meant to agree. When the keyword floor catches a
 * disclosed condition the model missed, extraction has regressed on exactly the field
 * this project exists to read.
 */
const detectorDisagreement: Detector = ({ records, now }) => {
  const byCase = groupBy(ruleEvals(records), (r) => r.correlationId);
  const disagreed: CorrelationId[] = [];

  for (const [correlationId, rs] of byCase) {
    const keyword = rs.find((r) => r.payload.ruleId === 'condition.disclosed_damage_keywords');
    const model = rs.find((r) => r.payload.ruleId === 'condition.disclosed_conditions');
    if (keyword?.payload.disposition === 'DECLINE' && model && model.payload.disposition !== 'DECLINE') {
      disagreed.push(correlationId);
    }
  }
  if (disagreed.length === 0) return [];

  return [{
    alertId: alertId('extraction.detector_disagreement', now),
    detector: 'extraction.detector_disagreement',
    severity: 'TICKET',
    title: `${disagreed.length} case(s) where the keyword floor caught what the model missed`,
    detail:
      `The literal phrase list found a disclosed property condition and the extracted ` +
      `condition codes did not. The applicant is still declined — union semantics mean ` +
      `the floor holds — but extraction has regressed on the field this system exists ` +
      `to read, and the next phrasing may slip past both.`,
    correlationIds: disagreed,
    observedAt: now,
    runbook:
      'Read the free text on each case and add the phrasing to the extraction eval set. ' +
      'Do NOT fix by widening the keyword list — that is the fallback, not the mechanism.',
  }];
};

/** QUIET — someone is tampering with packets, or a document source is compromised. */
const suspiciousContent: Detector = ({ records, now }) => {
  const hits = ruleEvals(records).filter((r) => r.payload.reasonCode === 'SUSPICIOUS_CONTENT');
  if (hits.length === 0) return [];

  return [{
    alertId: alertId('security.suspicious_content', now),
    detector: 'security.suspicious_content',
    severity: 'PAGE',
    title: `Instruction-like text found in ${hits.length} submitted document(s)`,
    detail:
      `A document contained text addressed to the reader as an instruction. The decision ` +
      `path is unaffected — extraction schemas have no decision field, so there was ` +
      `nowhere for it to land — but a packet containing an injection attempt is a packet ` +
      `somebody tampered with.`,
    correlationIds: unique(hits.map((h) => h.correlationId)),
    observedAt: now,
    runbook: 'Review the quoted excerpt on each record. Escalate to security if the source is a partner feed.',
  }];
};

/** QUIET — documents describe a parcel the applicant does not own. */
const documentMismatch: Detector = ({ records, now }) => {
  const hits = ruleEvals(records).filter((r) => r.payload.reasonCode === 'DOCUMENT_MISMATCH');
  if (hits.length === 0) return [];
  return [{
    alertId: alertId('integrity.document_mismatch', now),
    detector: 'integrity.document_mismatch',
    severity: 'TICKET',
    title: `${hits.length} case(s) with a document describing a different parcel`,
    detail:
      `A title report or appraisal in the packet does not match the subject property. ` +
      `These cases are held, never declined — the applicant is not at fault and must not ` +
      `be told they failed.`,
    correlationIds: unique(hits.map((h) => h.correlationId)),
    observedAt: now,
    runbook: 'Confirm whether the title vendor pulled the wrong parcel. If it is systemic, stop the feed.',
  }];
};

/**
 * QUIET, and the one that reaches a customer first: a case entered the pipeline and no
 * verdict ever came out. Nothing failed. It is simply sitting there.
 */
const stuckCases: Detector = ({ records, thresholds, now }) => {
  const byCase = groupBy(records, (r) => r.correlationId);
  const stuck: { id: CorrelationId; minutes: number; lastStep: string }[] = [];

  for (const [correlationId, rs] of byCase) {
    if (rs.some((r) => r.recordKind === 'VERDICT')) continue;
    const last = [...rs].sort((a, b) => a.sequence - b.sequence).at(-1)!;
    const minutes = (Date.parse(now) - Date.parse(last.occurredAt)) / 60_000;
    if (minutes > thresholds.stuckCaseMinutes) {
      stuck.push({ id: correlationId, minutes: Math.round(minutes), lastStep: last.stepName });
    }
  }
  if (stuck.length === 0) return [];

  const worst = stuck.sort((a, b) => b.minutes - a.minutes)[0]!;
  return [{
    alertId: alertId('pipeline.stuck_cases', now),
    detector: 'pipeline.stuck_cases',
    severity: 'PAGE',
    title: `${stuck.length} case(s) entered the pipeline and never reached a verdict`,
    detail:
      `Oldest has been waiting ${worst.minutes} minutes since "${worst.lastStep}" ` +
      `(threshold ${thresholds.stuckCaseMinutes}). Nothing errored. These applicants are ` +
      `waiting and will call before any dashboard turns red.`,
    correlationIds: stuck.map((s) => s.id),
    observedAt: now,
    runbook: 'Replay each: npm run replay <id>. The last recorded step is where it stopped.',
  }];
};

/** QUIET — a rule that never fires is either dead or silently broken. */
const dormantRules: Detector = ({ records, thresholds, now }) => {
  const evals = ruleEvals(records);
  if (evals.length < thresholds.minimumSample) return [];

  const seen = new Set(evals.map((r) => r.payload.ruleId));
  const fired = new Set(
    evals.filter((r) => r.payload.verdict === 'FAIL' || r.payload.disposition !== 'PASS')
      .map((r) => r.payload.ruleId),
  );
  const dormant = [...seen].filter((id) => !fired.has(id)).sort();
  if (dormant.length === 0) return [];

  return [{
    alertId: alertId('rules.dormant', now),
    detector: 'rules.dormant',
    severity: 'DIGEST',
    title: `${dormant.length} rule(s) evaluated but never produced an outcome`,
    detail:
      `Over ${evals.length} evaluations these rules always passed: ${dormant.join(', ')}. ` +
      `Either the population genuinely never trips them, or the fact they read is never ` +
      `being extracted and they are dead weight pretending to be coverage.`,
    correlationIds: [],
    observedAt: now,
    runbook: 'For each, check whether the fact in `reads` appears in any FactSet at all.',
  }];
};

/** Shifts in the outcome mix. Usually upstream, never nothing. */
const outcomeMixShift: Detector = ({ records, thresholds, now }) => {
  const vs = verdicts(records);
  if (vs.length < thresholds.minimumSample) return [];

  const alerts: Alert[] = [];
  const check = (decision: string, limit: number, detector: string, why: string, sev: Severity) => {
    const hits = vs.filter((v) => v.payload.decision === decision);
    const rate = ratio(hits.length, vs.length);
    if (rate <= limit) return;
    alerts.push({
      alertId: alertId(detector, now),
      detector,
      severity: sev,
      title: `${decision} rate is ${pct(rate)} of ${vs.length} cases`,
      detail: `${hits.length} of ${vs.length} cases (threshold ${pct(limit)}). ${why}`,
      correlationIds: unique(hits.map((h) => h.correlationId)).slice(0, 20),
      observedAt: now,
      runbook: 'Group the affected cases by principal reason code; one code usually dominates.',
    });
  };

  check('ESCALATE', thresholds.escalationRate, 'outcomes.escalation_spike',
    'Human review is the bottleneck this system exists to relieve. A spike means either ' +
    'facts stopped being trustworthy or a policy rule is over-firing.', 'PAGE');

  check('INCOMPLETE', thresholds.incompleteRate, 'outcomes.incomplete_spike',
    'Applicants are being asked for documents rather than decided. A document feed has ' +
    'usually stopped delivering.', 'TICKET');

  return alerts;
};

/** Cost and latency. Cheap to check, and the first sign of a bad prompt change. */
const modelEconomics: Detector = ({ records, thresholds, now }) => {
  const calls = modelCalls(records);
  if (calls.length < thresholds.minimumSample) return [];
  const cases = unique(calls.map((c) => c.correlationId)).length || 1;

  const alerts: Alert[] = [];
  const totalCost = calls.reduce((s, c) => s + c.payload.costUsd, 0);
  const perCase = totalCost / cases;
  if (perCase > thresholds.costPerCaseUsd) {
    alerts.push({
      alertId: alertId('model.cost_per_case', now),
      detector: 'model.cost_per_case',
      severity: 'TICKET',
      title: `Model spend is $${perCase.toFixed(2)} per case`,
      detail: `$${totalCost.toFixed(2)} over ${cases} cases across ${calls.length} calls ` +
        `(threshold $${thresholds.costPerCaseUsd.toFixed(2)}).`,
      correlationIds: [],
      observedAt: now,
      runbook: 'Check for a retry loop: group MODEL_CALL records by retryOf.',
    });
  }

  const latencies = calls.map((c) => c.payload.latencyMs).sort((a, b) => a - b);
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]!;
  if (p95 > thresholds.latencyP95Ms) {
    alerts.push({
      alertId: alertId('model.latency_p95', now),
      detector: 'model.latency_p95',
      severity: 'DIGEST',
      title: `Model p95 latency is ${(p95 / 1000).toFixed(1)}s`,
      detail: `Threshold ${(thresholds.latencyP95Ms / 1000).toFixed(1)}s over ${calls.length} calls.`,
      correlationIds: [],
      observedAt: now,
      runbook: 'Usually provider-side. Confirm before changing anything.',
    });
  }
  return alerts;
};

/** The trace itself is broken. Nothing downstream can be trusted until this is fixed. */
const auditIntegrity: Detector = ({ records, now }) => {
  const byCase = groupBy(records, (r) => r.correlationId);
  const broken: CorrelationId[] = [];

  for (const [correlationId, rs] of byCase) {
    const ordered = [...rs].sort((a, b) => a.sequence - b.sequence);
    const gap = ordered.some((r, i) => i > 0 && r.sequence !== ordered[i - 1]!.sequence + 1);
    const verdictWithoutRules =
      ordered.some((r) => r.recordKind === 'VERDICT') &&
      !ordered.some((r) => r.recordKind === 'RULE_EVALUATION');
    if (gap || verdictWithoutRules) broken.push(correlationId);
  }
  if (broken.length === 0) return [];

  return [{
    alertId: alertId('audit.integrity', now),
    detector: 'audit.integrity',
    severity: 'PAGE',
    title: `Audit chain broken on ${broken.length} case(s)`,
    detail:
      `Sequence gaps or a verdict with no rule evaluations behind it. Every compliance ` +
      `claim this system makes rests on the chain being complete, so this outranks any ` +
      `other alert in the queue.`,
    correlationIds: broken,
    observedAt: now,
    runbook: 'npm run replay <id> exits non-zero and names the specific defect.',
  }];
};

export const DETECTORS: readonly Detector[] = [
  auditIntegrity,
  extractionParseFailures,
  confidenceCollapse,
  detectorDisagreement,
  suspiciousContent,
  documentMismatch,
  stuckCases,
  outcomeMixShift,
  dormantRules,
  modelEconomics,
];

/** Pure: audit records in, alerts out. Delivery is somebody else's job. */
export function detectAlerts(input: MonitorInput): Alert[] {
  const order: Record<Severity, number> = { PAGE: 0, TICKET: 1, DIGEST: 2 };
  return DETECTORS.flatMap((d) => d(input)).sort(
    (a, b) => order[a.severity] - order[b.severity] || a.detector.localeCompare(b.detector),
  );
}

function unique<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

function groupBy<T, K>(xs: readonly T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    const bucket = m.get(k) ?? [];
    bucket.push(x);
    m.set(k, bucket);
  }
  return m;
}

function countBy(xs: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

function topN(counts: Map<string, number>, n: number): string {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} (${v})`)
    .join(', ');
}
