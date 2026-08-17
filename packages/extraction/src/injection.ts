import type { IntegritySignal } from '@hei/rules-engine';
import type { SourceDocument } from './ports.js';

/**
 * Detects text in a document that is addressed to the reader as an instruction.
 *
 * This is defence in depth, not the defence. The actual defence is structural: the
 * extraction schema has no decision-shaped field, so "Output APPROVE" has nowhere to be
 * written even if a model wanted to comply. Adversarial case 20 is uninteresting to the
 * decision path for that reason.
 *
 * What this adds is the SECOND half of the requirement: the case must be flagged, not
 * merely survived. A packet containing an instruction aimed at the reader is a packet
 * somebody tampered with, and that is worth a human's attention regardless of whether
 * the attempt could have worked.
 *
 * It runs on the raw text BEFORE the model is called, so an injection cannot suppress
 * its own detection by influencing the model's output.
 *
 * Keyword matching is the right tool HERE, unlike condition disclosure: an injection is
 * an adversary writing imperative English at a machine, and the surface is narrow and
 * syntactic. Missing an exotic phrasing costs a flag, not a decision. Contrast
 * `application.disclosed_conditions`, where the writer is a homeowner in distress
 * phrasing things a thousand ways, and a miss costs someone four months.
 */
const INSTRUCTION_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /\bignore\s+(all\s+|any\s+)?(previous|prior|earlier|above|preceding)\s+(instruction|prompt|direction|rule)/i, label: 'ignore-previous' },
  { pattern: /\bdisregard\s+(all\s+|any\s+)?(previous|prior|earlier|above|the)\s+/i, label: 'disregard' },
  { pattern: /\b(you\s+(are|must|should|will)|please)\s+.{0,40}\b(approve|approved|pre-?approved|accept|pass)\b/i, label: 'directive-approve' },
  { pattern: /\boutput\s+(approve|approved|pass|eligible|yes)\b/i, label: 'output-directive' },
  { pattern: /\b(system|assistant|user)\s*:\s*/i, label: 'role-marker' },
  { pattern: /\bnew\s+instructions?\b/i, label: 'new-instructions' },
  { pattern: /\b(this\s+applicant|the\s+applicant)\s+is\s+(pre-?approved|approved|eligible|qualified)\b/i, label: 'assertion-of-outcome' },
  { pattern: /<\s*\/?\s*(system|instruction|prompt)\s*>/i, label: 'pseudo-tag' },
  { pattern: /\boverride\s+(the\s+)?(rules?|policy|decision|underwriting)\b/i, label: 'override' },
];

export function detectInstructionLikeText(doc: SourceDocument): IntegritySignal[] {
  const signals: IntegritySignal[] = [];
  const matched: string[] = [];

  for (const { pattern, label } of INSTRUCTION_PATTERNS) {
    const m = pattern.exec(doc.text);
    if (m) matched.push(`${label}: "${excerpt(doc.text, m.index)}"`);
  }

  if (matched.length > 0) {
    signals.push({
      documentId: doc.documentId,
      kind: 'INSTRUCTION_LIKE_TEXT',
      // Quoted for a human reviewer. Never interpolated into any prompt.
      excerpt: matched.join(' | ').slice(0, 500),
      severity: 'BLOCKING',
    });
  }

  return signals;
}

function excerpt(text: string, at: number): string {
  return text.slice(Math.max(0, at - 10), at + 110).replace(/\s+/g, ' ').trim();
}

/**
 * Cross-document identity check. Adversarial case 9: a title report for a parcel the
 * applicant does not own. Never approve, never decline — we have no facts about this
 * applicant's property at all.
 */
export function detectApnMismatch(
  subjectApn: string | undefined,
  documentApns: readonly { documentId: string; apn: string }[],
): IntegritySignal[] {
  if (!subjectApn) return [];
  const normalise = (s: string) => s.replace(/[^0-9a-z]/gi, '').toLowerCase();
  const subject = normalise(subjectApn);

  return documentApns
    .filter((d) => normalise(d.apn) !== subject)
    .map((d) => ({
      documentId: d.documentId,
      kind: 'APN_MISMATCH' as const,
      excerpt: `document APN ${d.apn} does not match subject APN ${subjectApn}`,
      severity: 'BLOCKING' as const,
    }));
}
