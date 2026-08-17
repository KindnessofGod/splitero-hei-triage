import { readFileSync } from 'node:fs';
import { compileRuleSet, type LoadedRuleSet } from './index.js';

/** Reads and compiles a rule set from disk. The only filesystem touch in the chain. */
export function loadRuleSetFile(path: string): LoadedRuleSet {
  return compileRuleSet(readFileSync(path, 'utf8'));
}
