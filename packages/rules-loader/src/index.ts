/**
 * Loads a YAML rule set and compiles it into the shape the engine consumes.
 *
 * This package exists because parsing YAML requires a dependency and the rules engine is
 * not allowed one (ADR 0001, mechanism 1). Keeping the parser out here is what lets the
 * decision path keep an empty dependency closure.
 *
 * Validation is strict and loud: an unknown predicate, a missing threshold or a
 * misspelled disposition fails at load, not at decision time. A rule set that parses is
 * a rule set the engine can evaluate.
 */
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import type { Disposition, PredicateId, Rule, RuleSet, Stage } from '@hei/rules-engine';

const PREDICATE_IDS = new Set<string>([
  'value_in_set', 'value_not_in_set', 'at_least', 'at_most', 'within_range',
  'ratio_at_most', 'ratio_at_least', 'date_within_days', 'date_at_least_days_ago', 'date_at_least_days_ahead',
  'set_intersects', 'count_at_most', 'text_matches_any', 'always',
]);

const DISPOSITIONS = new Set<string>([
  'PASS', 'INFO', 'INCOMPLETE', 'POLICY_ESCALATE', 'INTEGRITY_ESCALATE', 'DECLINE',
]);

const MISSING_FACT_POLICIES = new Set<string>(['SKIP', 'INCOMPLETE', 'POLICY_ESCALATE']);

export class RuleSetError extends Error {
  constructor(message: string) {
    super(`Invalid rule set: ${message}`);
    this.name = 'RuleSetError';
  }
}

export interface RuleSetConstants {
  readonly [group: string]: Readonly<Record<string, unknown>>;
}

export interface LoadedRuleSet {
  readonly ruleSet: RuleSet;
  readonly constants: RuleSetConstants;
}

interface RawOutcome {
  disposition?: unknown;
  reason_code?: unknown;
  severity?: unknown;
  terminal?: unknown;
  blocks_approval?: unknown;
  note?: unknown;
}

interface RawRule {
  id?: unknown;
  version?: unknown;
  effective_from?: unknown;
  effective_to?: unknown;
  predicate?: unknown;
  reads?: unknown;
  minimum_stage?: unknown;
  detectable_at_stage?: unknown;
  on_missing_facts?: unknown;
  params?: unknown;
  on_pass?: RawOutcome;
  on_fail?: RawOutcome;
  applies_when?: { key?: unknown; value_in?: unknown };
}

export function compileRuleSet(yamlText: string): LoadedRuleSet {
  const doc = parse(yamlText) as Record<string, unknown> | null;
  if (!doc || typeof doc !== 'object') throw new RuleSetError('document is not a mapping');

  const rulesVersion = req(doc, 'rules_version', 'string');
  const source = req(doc, 'source', 'string');
  const confidenceFloor = typeof doc['confidence_floor'] === 'number' ? doc['confidence_floor'] : 0.7;

  const rawRules = doc['rules'];
  if (!Array.isArray(rawRules) || rawRules.length === 0) {
    throw new RuleSetError('`rules` must be a non-empty list');
  }

  const seen = new Set<string>();
  const rules = rawRules.map((raw, i) => compileRule(raw as RawRule, i, seen));

  // The hash covers the compiled rules, not the YAML text, so a comment edit does not
  // invalidate historical verdicts while a threshold change does.
  const hash = createHash('sha256').update(JSON.stringify(rules)).digest('hex');

  return {
    ruleSet: { rulesVersion, hash, source, rules, confidenceFloor },
    constants: (doc['constants'] as RuleSetConstants) ?? {},
  };
}

function compileRule(raw: RawRule, index: number, seen: Set<string>): Rule {
  const where = `rule[${index}]`;
  const id = str(raw.id, `${where}.id`);
  if (seen.has(id)) throw new RuleSetError(`duplicate rule id "${id}"`);
  seen.add(id);

  const predicate = str(raw.predicate, `${id}.predicate`);
  if (!PREDICATE_IDS.has(predicate)) {
    throw new RuleSetError(
      `${id}: unknown predicate "${predicate}". Known: ${[...PREDICATE_IDS].sort().join(', ')}`,
    );
  }

  const reads = raw.reads;
  if (!Array.isArray(reads) || reads.some((r) => typeof r !== 'string')) {
    throw new RuleSetError(`${id}.reads must be a list of fact keys`);
  }

  const onMissing = str(raw.on_missing_facts, `${id}.on_missing_facts`);
  if (!MISSING_FACT_POLICIES.has(onMissing)) {
    throw new RuleSetError(
      `${id}.on_missing_facts must be one of ${[...MISSING_FACT_POLICIES].join(', ')}`,
    );
  }

  // A rule that can neither pass nor fail into an outcome is dead weight, and dead rules
  // in an eligibility corpus are how you end up with silent coverage gaps.
  if (!raw.on_pass && !raw.on_fail) {
    throw new RuleSetError(`${id}: needs at least one of on_pass / on_fail`);
  }

  return {
    id,
    version: str(raw.version, `${id}.version`),
    effectiveFrom: str(raw.effective_from, `${id}.effective_from`),
    ...(raw.effective_to !== undefined
      ? { effectiveTo: str(raw.effective_to, `${id}.effective_to`) }
      : {}),
    predicate: predicate as PredicateId,
    reads: reads as string[],
    minimumStage: stage(raw.minimum_stage, `${id}.minimum_stage`),
    detectableAtStage: stage(raw.detectable_at_stage, `${id}.detectable_at_stage`),
    params: (raw.params as Record<string, unknown>) ?? {},
    onMissingFacts: onMissing as Rule['onMissingFacts'],
    ...(raw.on_pass ? { onPass: outcome(raw.on_pass, `${id}.on_pass`) } : {}),
    ...(raw.on_fail ? { onFail: outcome(raw.on_fail, `${id}.on_fail`) } : {}),
    ...(raw.applies_when
      ? {
          appliesWhen: {
            key: str(raw.applies_when.key, `${id}.applies_when.key`),
            valueIn: arr(raw.applies_when.value_in, `${id}.applies_when.value_in`),
          },
        }
      : {}),
  };
}

function outcome(raw: RawOutcome, where: string): NonNullable<Rule['onPass']> {
  const disposition = str(raw.disposition, `${where}.disposition`);
  if (!DISPOSITIONS.has(disposition)) {
    throw new RuleSetError(`${where}.disposition "${disposition}" is not a known disposition`);
  }
  // A non-PASS outcome without a reason code cannot produce a compliant notice.
  if (disposition !== 'PASS' && disposition !== 'INFO' && raw.reason_code === undefined) {
    throw new RuleSetError(`${where}: disposition ${disposition} requires a reason_code`);
  }
  return {
    disposition: disposition as Disposition,
    ...(raw.reason_code !== undefined
      ? { reasonCode: str(raw.reason_code, `${where}.reason_code`) }
      : {}),
    ...(raw.severity !== undefined ? { severity: numOf(raw.severity, `${where}.severity`) } : {}),
    ...(raw.terminal !== undefined ? { terminal: Boolean(raw.terminal) } : {}),
    ...(raw.blocks_approval !== undefined ? { blocksApproval: Boolean(raw.blocks_approval) } : {}),
    ...(raw.note !== undefined ? { note: str(raw.note, `${where}.note`) } : {}),
  };
}

function req(doc: Record<string, unknown>, key: string, kind: 'string'): string {
  const v = doc[key];
  if (typeof v !== kind) throw new RuleSetError(`\`${key}\` is required and must be a ${kind}`);
  return v as string;
}

function str(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new RuleSetError(`${where} must be a string`);
  return v;
}

function numOf(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new RuleSetError(`${where} must be a number`);
  }
  return v;
}

function arr(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) throw new RuleSetError(`${where} must be a list`);
  return v;
}

function stage(v: unknown, where: string): Stage {
  const n = numOf(v, where);
  if (!Number.isInteger(n) || n < 1 || n > 11) {
    throw new RuleSetError(`${where} must be an integer stage 1-11, got ${n}`);
  }
  return n as Stage;
}

export * from './audited-engine.js';
export { loadRuleSetFile } from './load-file.js';
