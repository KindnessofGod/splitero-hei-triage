/**
 * The predicates. Twelve-ish small, individually testable functions.
 *
 * The decision (log entry 014j): parameters live in YAML, logic lives here. Everything
 * that has actually moved in this domain — state lists, CLTV caps, credit floors, fee
 * percentages, seasoning windows — is a parameter. A YAML expression language would let
 * ops author new logic, at the cost of building an interpreter whose bugs are silent.
 */
import type { PredicateId } from './types.js';

export interface PredicateInput {
  /** Resolved fact values, keyed by the rule's `reads` entries. */
  readonly values: Readonly<Record<string, unknown>>;
  readonly params: Readonly<Record<string, unknown>>;
  /** For date predicates. Supplied by the caller — never `now()` inside the engine. */
  readonly asOf: string;
}

export interface PredicateOutput {
  readonly pass: boolean;
  /** Named values actually tested — these land verbatim in the audit record. */
  readonly tested: Readonly<Record<string, unknown>>;
  readonly threshold: Readonly<Record<string, unknown>>;
}

export type Predicate = (input: PredicateInput) => PredicateOutput;

const num = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new PredicateError(`expected a finite number, got ${JSON.stringify(v)}`);
  }
  return v;
};

export class PredicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PredicateError';
  }
}

const only = (values: Readonly<Record<string, unknown>>): [string, unknown] => {
  const entries = Object.entries(values);
  if (entries.length !== 1) {
    throw new PredicateError(`expected exactly 1 fact, got ${entries.length}`);
  }
  return entries[0]!;
};

export const PREDICATES: Readonly<Record<PredicateId, Predicate>> = {
  value_in_set: ({ values, params }) => {
    const [key, value] = only(values);
    const set = params['set'] as readonly unknown[];
    return {
      pass: set.includes(value),
      tested: { [key]: value },
      threshold: { set_size: set.length },
    };
  },

  value_not_in_set: ({ values, params }) => {
    const [key, value] = only(values);
    const set = params['set'] as readonly unknown[];
    return {
      pass: !set.includes(value),
      tested: { [key]: value },
      threshold: { excluded_count: set.length },
    };
  },

  at_least: ({ values, params }) => {
    const [key, value] = only(values);
    const min = num(params['min']);
    return { pass: num(value) >= min, tested: { [key]: value }, threshold: { min } };
  },

  at_most: ({ values, params }) => {
    const [key, value] = only(values);
    const max = num(params['max']);
    return { pass: num(value) <= max, tested: { [key]: value }, threshold: { max } };
  },

  within_range: ({ values, params }) => {
    const [key, value] = only(values);
    const min = num(params['min']);
    const max = num(params['max']);
    const v = num(value);
    return { pass: v >= min && v <= max, tested: { [key]: v }, threshold: { min, max } };
  },

  /**
   * numerator / denominator <= max. The CLTV rule.
   * Sums every numerator key, so an undisclosed second lien changes the answer rather
   * than being quietly ignored — adversarial case 2.
   */
  ratio_at_most: ({ values, params }) => {
    const numeratorKeys = params['numerator'] as readonly string[];
    const denominatorKey = params['denominator'] as string;
    const max = num(params['max']);

    const parts: Record<string, number> = {};
    let total = 0;
    for (const k of numeratorKeys) {
      const part = sumNumeric(values[k]);
      parts[k] = part;
      total += part;
    }
    const denominator = num(values[denominatorKey]);
    if (denominator === 0) throw new PredicateError('denominator is zero');

    const ratio = round(total / denominator, 4);
    return {
      pass: ratio <= max,
      tested: { ...parts, [denominatorKey]: denominator, ratio },
      threshold: { max },
    };
  },

  date_within_days: ({ values, params, asOf }) => {
    const [key, value] = only(values);
    const days = num(params['days']);
    const then = Date.parse(String(value));
    const now = Date.parse(asOf);
    if (Number.isNaN(then)) throw new PredicateError(`unparseable date ${JSON.stringify(value)}`);
    const ageDays = round((now - then) / 86_400_000, 1);
    return { pass: ageDays <= days, tested: { [key]: value, age_days: ageDays }, threshold: { days } };
  },

  /** Always passes. For rules whose whole job is `appliesWhen` — e.g. occupancy ambiguity. */
  always: ({ values }) => ({ pass: true, tested: { ...values }, threshold: {} }),
};

/** A lien schedule is an array; a plain balance is a number. Both are numerators. */
function sumNumeric(value: unknown): number {
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) {
    return value.reduce<number>((acc, item) => {
      if (typeof item === 'number') return acc + item;
      if (item && typeof item === 'object' && 'amount' in item) {
        return acc + num((item as { amount: unknown }).amount);
      }
      throw new PredicateError(`lien entry has no numeric amount: ${JSON.stringify(item)}`);
    }, 0);
  }
  throw new PredicateError(`cannot sum ${JSON.stringify(value)}`);
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
