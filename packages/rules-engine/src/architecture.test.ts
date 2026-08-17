/**
 * ADR 0001, mechanisms 1-3, as executable checks rather than promises.
 *
 * The claim is that a model output cannot become a decision. These tests make that
 * claim falsifiable: if someone imports an HTTP client or a model SDK into the decision
 * path, or makes `evaluate` async, the build goes red.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeterministicRulesEngine } from './engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');

const FORBIDDEN = [
  'node:http', 'node:https', 'node:net', 'node:dgram', 'node:dns', 'node:tls',
  'undici', 'axios', 'got', 'node-fetch',
  'openai', '@anthropic-ai/sdk', '@google/genai',
  '@hei/llm', '@hei/audit', '@hei/adapters',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [p] : [];
  });
}

describe('ADR 0001 · the decision path cannot reach a model', () => {
  it('declares no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('imports nothing that could reach the network or a model SDK', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(pkgRoot, 'src'))) {
      const src = readFileSync(file, 'utf8');
      for (const mod of FORBIDDEN) {
        // Matches `from 'x'`, `from "x"`, and dynamic import('x').
        if (new RegExp(`['"\`]${mod.replace(/[/@-]/g, '\\$&')}(/[^'"\`]*)?['"\`]`).test(src)) {
          offenders.push(`${file.replace(pkgRoot, '')} imports ${mod}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('exposes evaluate as a synchronous function — an async signature is a licence to do I/O', () => {
    const evaluate = DeterministicRulesEngine.prototype.evaluate;
    expect(evaluate.constructor.name).toBe('Function');
    expect(evaluate.constructor.name).not.toBe('AsyncFunction');
  });

  // Regression guard. This defaulted to DECLINE, which meant every rule defining only
  // `on_pass` declined every applicant who did NOT trigger it — e.g. everyone without a
  // PACE lien was declined for not having a PACE lien. An adverse outcome has to be
  // written down; silence is never a decline.
  it('defaults an unspecified outcome branch to PASS, never to DECLINE', () => {
    const src = readFileSync(join(pkgRoot, 'src/engine.ts'), 'utf8');
    expect(src).toContain("disposition: spec?.disposition ?? 'PASS'");
    expect(src).not.toMatch(/disposition:\s*spec\?\.disposition\s*\?\?\s*\(result\.pass\s*\?/);
  });

  it('never calls Date.now() — asOf is required so replay is not opt-in', () => {
    const offenders = sourceFiles(join(pkgRoot, 'src')).filter((f) =>
      /Date\.now\(\)|new Date\(\s*\)/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
