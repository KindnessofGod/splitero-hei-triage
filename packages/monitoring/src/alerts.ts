/**
 * Alerting.
 *
 * The premise: an error nobody is told about is not handled, it is buried. Every failure
 * mode below was already being RECORDED by the audit store — that work is done — but
 * recording is not noticing. This package is the part that notices.
 *
 * Everything here is a query over `audit_record`. No new instrumentation, no second
 * telemetry pipeline that can drift from the trace. That is the payoff of having built
 * the audit trail before the pipeline: monitoring is a read, not a rebuild.
 *
 * Thresholds live in YAML for the same reason rule thresholds do — they change, and
 * changing one should not require a deploy.
 */
import type { AuditRecord, CorrelationId } from '@hei/audit';

export type Severity = 'PAGE' | 'TICKET' | 'DIGEST';

export interface Alert {
  readonly alertId: string;
  readonly detector: string;
  readonly severity: Severity;
  readonly title: string;
  /** What happened, with numbers. Never "an error occurred". */
  readonly detail: string;
  /** Cases a human can open right now. */
  readonly correlationIds: readonly CorrelationId[];
  readonly observedAt: string;
  /** The concrete next action. An alert without one is noise. */
  readonly runbook: string;
}

/** Slack, email, PagerDuty — injected, never constructed here. */
export interface AlertSink {
  emit(alerts: readonly Alert[]): Promise<void>;
}

export interface AlertThresholds {
  /** Fraction of extraction calls whose output would not parse. */
  readonly parseFailureRate: number;
  /** Fraction of extracted facts below the confidence floor. */
  readonly lowConfidenceRate: number;
  /** Fraction of cases ending in ESCALATE. A spike means the world changed. */
  readonly escalationRate: number;
  /** Fraction of verdicts that are INCOMPLETE — usually a broken upstream feed. */
  readonly incompleteRate: number;
  /** Minimum cases before a rate is meaningful at all. */
  readonly minimumSample: number;
  /** A case with no verdict this long is stuck. */
  readonly stuckCaseMinutes: number;
  /** Model spend per case, in dollars. */
  readonly costPerCaseUsd: number;
  /** Model latency, p95, milliseconds. */
  readonly latencyP95Ms: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  parseFailureRate: 0.02,
  lowConfidenceRate: 0.15,
  escalationRate: 0.4,
  incompleteRate: 0.35,
  minimumSample: 20,
  stuckCaseMinutes: 60,
  costPerCaseUsd: 2.0,
  latencyP95Ms: 15_000,
};

export interface MonitorInput {
  readonly records: readonly AuditRecord[];
  readonly thresholds: AlertThresholds;
  /** Supplied, never read from a clock inside — same discipline as the rules engine. */
  readonly now: string;
  readonly confidenceFloor: number;
}
