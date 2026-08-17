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

  /** numerator / denominator >= min. Insurance Coverage A against appraised value. */
  ratio_at_least: ({ values, params }) => {
    const numeratorKeys = params['numerator'] as readonly string[];
    const denominatorKey = params['denominator'] as string;
    const min = num(params['min']);

    let total = 0;
    const parts: Record<string, number> = {};
    for (const k of numeratorKeys) {
      parts[k] = sumNumeric(values[k]);
      total += parts[k]!;
    }
    const denominator = num(values[denominatorKey]);
    if (denominator === 0) throw new PredicateError('denominator is zero');

    const ratio = round(total / denominator, 4);
    return {
      pass: ratio >= min,
      tested: { ...parts, [denominatorKey]: denominator, ratio },
      threshold: { min },
    };
  },

  /** The date must be at least N days in the past. Seasoning periods. */
  date_at_least_days_ago: ({ values, params, asOf }) => {
    const [key, value] = only(values);
    const days = num(params['days']);
    const then = Date.parse(String(value));
    const now = Date.parse(asOf);
    if (Number.isNaN(then)) throw new PredicateError(`unparseable date ${JSON.stringify(value)}`);
    const ageDays = round((now - then) / 86_400_000, 1);
    return { pass: ageDays >= days, tested: { [key]: value, age_days: ageDays }, threshold: { days } };
  },

  /**
   * The date must be at least N days in the FUTURE. Insurance and policy expiry.
   *
   * Deliberately its own predicate rather than a negative `days` on the ago-variant:
   * the sign trick read fine and computed backwards, so the expiry rule silently never
   * fired. A predicate whose name states its direction cannot make that mistake.
   */
  date_at_least_days_ahead: ({ values, params, asOf }) => {
    const [key, value] = only(values);
    const days = num(params['days']);
    const then = Date.parse(String(value));
    const now = Date.parse(asOf);
    if (Number.isNaN(then)) throw new PredicateError(`unparseable date ${JSON.stringify(value)}`);
    const daysAhead = round((then - now) / 86_400_000, 1);
    return {
      pass: daysAhead >= days,
      tested: { [key]: value, days_ahead: daysAhead },
      threshold: { min_days_ahead: days },
    };
  },

  /** Any overlap between the fact's values and the parameter set. Lien and signal types. */
  set_intersects: ({ values, params }) => {
    const [key, value] = only(values);
    const set = params['set'] as readonly unknown[];
    const actual = Array.isArray(value) ? value : [value];
    const hits = actual.filter((v) => set.includes(v));
    return { pass: hits.length > 0, tested: { [key]: actual, matched: hits }, threshold: { set } };
  },

  count_at_most: ({ values, params }) => {
    const [key, value] = only(values);
    const max = num(params['max']);
    const count = Array.isArray(value) ? value.length : num(value);
    return { pass: count <= max, tested: { [key]: count }, threshold: { max } };
  },

  /**
   * Deterministic keyword matching over an applicant's free text. Case 8's intake trigger.
   *
   * Note what this is NOT: a model reading the text and forming an opinion. It is a
   * regular-expression list stored in YAML, so the same sentence always produces the same
   * finding and the matched phrase lands verbatim in the audit record.
   */
  text_matches_any: ({ values, params }) => {
    const [key, value] = only(values);
    const patterns = params['patterns'] as readonly string[];
    const text = String(value ?? '').toLowerCase();
    const matched = patterns.filter((p) => new RegExp(p, 'i').test(text));
    return {
      pass: matched.length > 0,
      tested: { [key]: String(value ?? '').slice(0, 200), matched_patterns: matched },
      threshold: { pattern_count: patterns.length },
    };
  },

  /** Always passes. For rules whose whole job is `appliesWhen`, or whose fact's mere
   *  presence is the finding — e.g. occupancy ambiguity, unmatched owner names. */
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
