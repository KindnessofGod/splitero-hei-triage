# ADR 0001 — A deterministic rules engine makes every decision

- **Status:** Accepted — decision is binding; **the enforcement mechanisms below are designed but not yet implemented**
- **Date:** 2026-08-17
- **Applies to:** the whole system, permanently. Superseding this ADR means rebuilding the decision path.
- **Amended by:** [`docs/design/PHASE1A_AUDIT_RETROFIT.md`](../design/PHASE1A_AUDIT_RETROFIT.md) §C-1 — the pure engine *returns* its audit records and an `AuditedRulesEngine` adapter persists them, so the empty-dependency-closure property survives the auditability requirement.

## Context

This system triages Home Equity Investment applications and issues a decision:
approve, decline, incomplete, or escalate to a human.

Three forces constrain how that decision may be produced.

**Legal.** If HEIs are credit — an unresolved question, argued both ways
(`docs/research/HEI_DOMAIN.md` §4.1, §4.3) — then Regulation B, 12 CFR § 1002.9,
governs the decline path. It requires the *specific principal reasons* for an adverse
action and explicitly forbids generic grounds such as "internal standards or policies."
A decision produced by a language model has no principal reason, only a plausible
post-hoc narrative. Providers behave as if these rules apply regardless of how the
classification question resolves, and Maine's LD 1901 already mandates disclosure
directly. The decline path is a compliance surface, not a UX surface.

**Evidential.** The research names the requirement outright (§4.6): "every LLM-drafted
explanation must be grounded in a deterministic rule evaluation, never free-generated."
Separately, the eval design (§6.3) scores extraction and decision accuracy as distinct
metrics. That separation is only meaningful if extraction errors and logic errors
have different causes. If a model both extracts and decides, a wrong decision is
unattributable — we cannot tell whether the field was misread or the logic was wrong,
and therefore cannot fix either.

**Operational.** Rules change. Splitero's state list, maximum combined loan-to-value,
credit floor and fee schedule have all moved; four figures in the research brief were
already wrong when checked against the company's own site. Decisions must be replayable
under the rules that applied at the time, which requires the rule set to be versioned
data with effective dates rather than weights inside a model.

## Decision

**A deterministic rules engine makes every decision. The language model has exactly two
jobs: extract fields from documents, and render a human explanation from rule output.
There is no code path in which a model output becomes a decision.**

Concretely:

1. `RulesEngine.evaluate(input): Verdict` is **pure and synchronous**. It performs no
   I/O and cannot await. Its package declares zero runtime dependencies.
2. Its input is a `FactSet` — typed, provenance-carrying values — not a `Case`, not raw
   text, and not model prose.
3. Model uncertainty is surfaced as data, not judgement. Each `Fact` carries a
   confidence. A confidence below a threshold *stored in YAML* resolves to
   `LOW_CONFIDENCE`, and a deterministic rule converts that into an escalation. The
   threshold is a rule parameter; the model never decides that it is unsure enough
   to matter.
4. Extraction output schemas contain no decision-shaped field. A document instructing
   the system to approve (adversarial case 20) has nowhere to write; the extractor's
   only correct response is to emit an integrity signal, which a rule turns into
   `SUSPICIOUS_CONTENT → ESCALATE`.
5. `Verdict` is sealed with a content hash **before** rendering. The renderer receives
   the sealed verdict plus only the facts each rule declared it read. Its output type,
   `Explanation`, is a leaf: no function anywhere accepts an `Explanation` and returns
   a decision, verdict, or fact.
6. Every `Verdict` records `rulesVersion`, `ruleSetHash`, `factSnapshotId`, `asOf` and
   `stage`, so any historical decision can be re-evaluated under its original rules.

### How this is enforced structurally

Convention and code review were considered insufficient. Five independent mechanisms:

| # | Mechanism | Defeats |
|---|---|---|
| 1 | Rules-engine package has an empty dependency closure, asserted in CI | importing a model client at all |
| 2 | `dependency-cruiser` forbids the deterministic packages from importing any HTTP or model SDK module | reaching a model transitively |
| 3 | `evaluate` is synchronous — an async model call is not expressible in its body | awaiting a model mid-rule |
| 4 | Seal-then-render; `Explanation` never appears in a non-presentation parameter position | prose feeding back into a decision |
| 5 | `VerdictLedger.read()` recomputes the seal and fails on mismatch | post-hoc tampering with a stored decision |

And one behavioural check that makes the property visible rather than merely true: an
eval run with an adversarial extractor — one that injects approval-shaped text into
every free-text field — must produce a verdict distribution byte-identical to the clean
run across all 200 cases.

## Alternative rejected

**A language model decides, with a rules engine as a guardrail or post-hoc validator.**

This is the common shape: prompt a model with the packet and a policy summary, let it
produce a decision plus reasoning, then check the decision against hard gates and
override where they disagree.

It is attractive. It handles cases nobody wrote a rule for, it degrades gracefully on
messy packets, and it ships faster.

Rejected for four reasons:

- **The reason given is not the reason acted on.** Regulation B requires the specific
  principal reason. A model's stated reasoning is a plausible narrative generated
  alongside the decision, not its cause. Even when the decision is right, the notice
  is defective — which is the exact defect alleged in the Hometap complaint of
  2025-05-20, where no official declination document was provided.
- **Guardrails only catch the errors you anticipated.** A hard gate on state or
  loan-to-value catches those two mistakes. It cannot catch a model that approves a
  leasehold property because no one thought to write that gate, and the failure is
  silent.
- **Errors become unattributable.** With one model doing both jobs, a wrong verdict
  cannot be traced to a misread field versus faulty logic. The eval design's separation
  of extraction accuracy from decision accuracy collapses, and with it our ability to
  improve either.
- **Replay becomes impossible.** Re-deciding a 2026 case in 2028 requires the 2026
  model, the 2026 prompt, and the 2026 sampling behaviour. Versioned YAML plus a pure
  function gives exact replay; a model endpoint does not, even at temperature zero.

A narrower variant — model decides only where no rule applies — was also rejected. It
sounds bounded and is not: "no rule applies" is precisely the population where a human
should look, and it is the population most likely to matter.

## Consequences

**Accepted costs.**

- Novel situations produce `ESCALATE`, not a clever answer. Coverage grows by writing
  rules, which is deliberate friction on the decision path.
- Someone must author and maintain the rule corpus, and each rule needs tests.
- Recall is bounded by what is encoded. A disqualifier with no rule will not be caught,
  and the eval harness must report rule coverage so those gaps are visible rather than
  assumed away.
- Escalation volume is higher than a model-decides design would produce. That is the
  intended trade: the escalation false-negative rate — cases needing a human that get
  auto-decided — should be zero, and we should be able to say so from the eval, not
  from optimism.

**Gained.**

- Every decision is explainable by construction, and explainable in the way the
  regulation asks for.
- Extraction quality and decision quality are measured independently.
- Any historical decision replays exactly.
- The prompt-injection case is structurally uninteresting: there is no field to inject
  into.
- The deepest module in the system has no dependencies and is trivially testable.

## What would change our mind

This ADR should be revisited if any of the following becomes true. None currently is.

1. **A regulator or court holds that model-generated adverse-action reasoning satisfies
   the specific-reasons requirement.** The classification question resolving in the
   industry's favour is *not* sufficient — Regulation B is only one of the three forces
   above, and it is the weakest.
2. **Escalation volume makes the system unusable, and eval shows escalations concentrate
   in a population where a model demonstrably outperforms a rule.** The response would
   still be to encode more rules first; only if rule-writing provably cannot converge
   does the alternative reopen.
3. **A model becomes exactly replayable** — identical output from identical input,
   guaranteed across versions and time, with the decision function auditable. This
   removes the replay objection but not the principal-reason or attribution objections.
4. **The eval demonstrates the rules engine is systematically wrong in a way a model is
   not** — for instance, a false-decline rate with fair-lending exposure that rules
   cannot reduce. That is a strong signal and would warrant reopening the whole design.

What would explicitly **not** change our mind: extraction accuracy improving, model
benchmark scores rising, or a decline in the perceived likelihood of enforcement. None
of those touch the reasons above.
