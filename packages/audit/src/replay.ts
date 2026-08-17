import type { AuditRecord, RuleEvaluationPayload } from './record.js';
import { verifySeal } from './seal.js';

export interface IntegrityResult {
  readonly ok: boolean;
  readonly problems: readonly string[];
}

/**
 * A trace that cannot be checked is decorative. These are the ways a chain can lie.
 */
export function checkIntegrity(records: readonly AuditRecord[]): IntegrityResult {
  const problems: string[] = [];
  const ordered = [...records].sort((a, b) => a.sequence - b.sequence);

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!;
    const cur = ordered[i]!;
    if (cur.sequence !== prev.sequence + 1) {
      problems.push(
        `sequence gap between ${prev.sequence} and ${cur.sequence} (${prev.stepName} -> ${cur.stepName})`,
      );
    }
  }

  const ids = new Set(ordered.map((r) => r.recordId));
  for (const r of ordered) {
    if (r.parentRecordId && !ids.has(r.parentRecordId)) {
      problems.push(`broken parent link: ${r.recordId} -> ${r.parentRecordId}`);
    }
    if (r.supersedes && !ids.has(r.supersedes)) {
      problems.push(`correction ${r.recordId} supersedes an absent record ${r.supersedes}`);
    }
  }

  for (const r of ordered) {
    if (r.recordKind === 'VERDICT' && !verifySeal(r.payload)) {
      problems.push(`seal mismatch on verdict ${r.recordId} (${r.payload.decision})`);
    }
  }

  // A verdict with nothing behind it is the failure this whole system exists to prevent.
  const verdicts = ordered.filter((r) => r.recordKind === 'VERDICT');
  for (const v of verdicts) {
    const priorRules = ordered.filter(
      (r) => r.recordKind === 'RULE_EVALUATION' && r.runId === v.runId && r.sequence < v.sequence,
    );
    if (priorRules.length === 0) {
      problems.push(`verdict ${v.recordId} has no rule evaluations preceding it in run ${v.runId}`);
    }
  }

  return { ok: problems.length === 0, problems };
}

const GLYPH = { PASS: '✓', FAIL: '✗', NOT_EVALUATED: '⊘' } as const;

function money(n: unknown): string {
  return typeof n === 'number' ? `$${n.toLocaleString('en-US')}` : String(n);
}

function pairs(obj: Readonly<Record<string, unknown>>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${k} ${typeof v === 'number' && v > 1000 ? money(v) : String(v)}`)
    .join(', ');
}

function ruleLine(p: RuleEvaluationPayload): string {
  const glyph = GLYPH[p.verdict];
  const head = `  ${glyph} ${p.ruleId.padEnd(30)}`;
  if (p.verdict === 'NOT_EVALUATED') {
    return `${head}SKIPPED — ${(p.missingFacts ?? []).join(', ')} UNKNOWN`;
  }
  const outcome =
    p.disposition && p.reasonCode
      ? ` → ${p.verdict} → ${p.disposition}/${p.reasonCode}`
      : ` → ${p.verdict}`;
  return `${head}${pairs(p.tested)} vs ${pairs(p.threshold)}${outcome}`;
}

/**
 * Every rule CONSIDERED, including the ones that passed and the ones skipped for
 * missing facts. A DECLINE that only shows the failing rule is not an audit trail.
 */
function ruleBlock(records: readonly AuditRecord[], verbose: boolean): string[] {
  if (records.length === 0) return [];
  const payloads = records.map((r) => r.payload as RuleEvaluationPayload);
  const p0 = payloads[0]!;
  const first = records[0]!;

  const lines: string[] = [
    `[${first.sequence}] ${'rules.evaluate'.padEnd(26)} ${'SYSTEM'.padEnd(6)} ` +
      `${first.stepVersion.padEnd(22)} ${''.padStart(7)}  OK`,
    `      rules_version ${p0.rulesVersion} · set hash ${p0.ruleSetHash.slice(0, 12)}… ` +
      `· ${payloads.length} rules considered`,
  ];

  const notable = payloads.filter((p) => p.verdict !== 'PASS' || p.disposition);
  const shown = verbose ? payloads : notable.slice(0, 6);
  for (const p of shown) lines.push(ruleLine(p));
  const hidden = payloads.length - shown.length;
  if (hidden > 0) lines.push(`      … ${hidden} more (--verbose for all)`);
  return lines;
}

export interface NarrateOptions {
  readonly verbose?: boolean;
}

/**
 * The chain as a readable narrative. This is the demo: it proves the trace is real
 * rather than decorative, because you can read it and check it against the documents.
 */
export function narrate(records: readonly AuditRecord[], opts: NarrateOptions = {}): string {
  const verbose = opts.verbose ?? false;
  const ordered = [...records].sort((a, b) => a.sequence - b.sequence);
  if (ordered.length === 0) return 'No records found for that correlation id.\n';

  const first = ordered[0]!;
  const integrity = checkIntegrity(ordered);
  const runs = [...new Set(ordered.map((r) => r.runId))];
  const seals = ordered.filter((r) => r.recordKind === 'VERDICT').length;

  const out: string[] = [];
  out.push(
    `CASE ${first.correlationId} · opened ${first.occurredAt} · ` +
      `${ordered.length} records · ${runs.length} run${runs.length === 1 ? '' : 's'}`,
  );
  out.push(
    integrity.ok
      ? `integrity: OK (${ordered.length}/${ordered.length} linked, no gaps, ${seals} seal${seals === 1 ? '' : 's'} verified)`
      : `integrity: FAILED\n  ${integrity.problems.join('\n  ')}`,
  );

  for (const runId of runs) {
    const inRun = ordered.filter((r) => r.runId === runId);
    const stage = inRun.find((r) => r.recordKind === 'VERDICT')?.payload.evaluatedAtStage;
    out.push('');
    out.push(`── run ${runs.indexOf(runId) + 1}${stage ? ` · stage ${stage}` : ''} ` + '─'.repeat(40));

    const ruleRecords = inRun.filter((r) => r.recordKind === 'RULE_EVALUATION');
    let rulesEmitted = false;

    for (const r of inRun) {
      // Rule evaluations are emitted once, as a group, at the position of the first
      // one — so the chain reads in the order the reasoning actually happened.
      if (r.recordKind === 'RULE_EVALUATION') {
        if (rulesEmitted) continue;
        rulesEmitted = true;
        out.push(...ruleBlock(ruleRecords, verbose));
        continue;
      }

      const dur = r.durationMs === undefined ? '' : `${r.durationMs}ms`;
      out.push(
        `[${r.sequence}] ${r.stepName.padEnd(26)} ${r.actorType.padEnd(6)} ` +
          `${r.actorId.padEnd(22)} ${dur.padStart(7)}  ${r.outcome}`,
      );

      switch (r.recordKind) {
        case 'STEP':
          out.push(`      ${r.payload.summary}`);
          break;
        case 'MODEL_CALL':
          out.push(
            `      ${r.payload.inputTokens} in / ${r.payload.outputTokens} out · ` +
              `$${r.payload.costUsd.toFixed(4)} · prompt ${r.payload.promptId} ` +
              `· raw ${r.payload.rawResponseDigest.slice(0, 12)}…`,
          );
          break;
        case 'HUMAN_ACTION':
          out.push(`      saw: presented_state ${r.payload.presentedStateDigest.slice(0, 12)}…`);
          out.push(
            `      decided: ${r.payload.decision}` +
              (r.payload.reasonText ? ` · "${r.payload.reasonText}"` : ''),
          );
          break;
        case 'STATE_MUTATION':
          out.push(
            `      ${r.payload.entity}#${r.payload.entityId} · ` +
              `prior ${r.payload.priorValueDigest?.slice(0, 12) ?? 'none'} ` +
              `→ ${r.payload.newValueDigest.slice(0, 12)} · attempt ${r.attempt}`,
          );
          break;
        case 'VERDICT': {
          const p = r.payload;
          out.push(
            `      ${p.decision}${p.escalationKind ? `(${p.escalationKind})` : ''} · ` +
              `${p.principalReasons.join(', ')} · seal ${p.seal.slice(0, 12)}… ` +
              `${verifySeal(p) ? 'VERIFIED' : 'MISMATCH'}`,
          );
          break;
        }
        case 'CORRECTION':
          out.push(`      supersedes ${r.supersedes} · ${r.payload.reason}`);
          break;
        // RULE_EVALUATION is narrowed out above by the grouped-emission `continue`.
      }
    }
  }

  out.push('');
  return out.join('\n');
}
