import { describe, expect, it } from 'vitest';
import { checkIntegrity, narrate } from './replay.js';
import { declineChain, tamperedSealChain, sequenceGapChain } from './fixtures/chains.js';

describe('replay integrity', () => {
  it('accepts a well-formed chain', () => {
    expect(checkIntegrity(declineChain)).toEqual({ ok: true, problems: [] });
  });

  it('detects a gap in the sequence', () => {
    const result = checkIntegrity(sequenceGapChain);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/sequence gap/i);
  });

  it('detects a verdict whose seal does not match its contents', () => {
    const result = checkIntegrity(tamperedSealChain);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/seal mismatch/i);
  });

  it('rejects a verdict with no rule evaluations preceding it', () => {
    const verdictOnly = declineChain.filter((r) => r.recordKind !== 'RULE_EVALUATION');
    const result = checkIntegrity(verdictOnly);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/no rule evaluations/i);
  });
});

describe('replay narrative', () => {
  const text = narrate(declineChain, { verbose: true });

  it('names the case and record count', () => {
    expect(text).toContain('HEI-0137');
    expect(text).toContain(`${declineChain.length} records`);
  });

  // The requirement: a DECLINE must show every check that ran, including the passes.
  it('shows rules that PASSED, not only the one that failed', () => {
    expect(text).toContain('geography.state_serviced');
    expect(text).toContain('credit.min_score');
  });

  it('shows rules that were skipped for missing facts', () => {
    expect(text).toContain('insurance.coverage_a');
    expect(text).toMatch(/SKIPPED/);
  });

  // "verdict: DECLINE" is useless. This is the shape that is not.
  it('states the rule, its version, the values tested and the threshold', () => {
    expect(text).toContain('equity.max_cltv');
    expect(text).toContain('2026-08-16');
    expect(text).toContain('0.78');
    expect(text).toContain('0.75');
    expect(text).toContain('FAIL');
  });

  it('reports the decision with its principal reasons', () => {
    expect(text).toContain('DECLINE');
    expect(text).toContain('CLTV_EXCEEDED');
  });

  it('reports integrity status in the header', () => {
    expect(text).toMatch(/integrity: OK/);
  });

  it('elides passing rules unless verbose', () => {
    const terse = narrate(declineChain, { verbose: false });
    expect(terse).toContain('equity.max_cltv');
    expect(terse).toMatch(/more \(--verbose/);
  });
});
