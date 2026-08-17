# Decisions — running draft

Append-only working log. Decisions that harden get promoted to an ADR in `docs/adr/`.
Newest at the bottom.

Status key: **settled** · **proposed** (awaiting review) · **open** (needs input)

---

## D-001 — Deterministic rules engine makes every decision — **settled**
*2026-08-17*

Promoted to [ADR 0001](adr/0001-deterministic-rules-engine.md). Non-negotiable per the
brief. The model extracts fields and renders explanations; it never decides. Enforced by
five structural mechanisms (empty dependency closure, import lint, synchronous signature,
seal-then-render with `Explanation` as a leaf type, seal verification on read), plus an
adversarial-extractor eval that must leave the verdict distribution byte-identical.

---

## D-002 — Source-of-truth precedence — **settled**
*2026-08-17*

`docs/research/SPLITERO_VERIFIED_TERMS.md` (first-party, read from splitero.com
2026-08-16) outranks `docs/research/HEI_DOMAIN.md` on any conflict. Four values in
HEI_DOMAIN §1.5 are known wrong and are superseded:

| Value | HEI_DOMAIN §1.5 | Verified | Used |
|---|---|---|---|
| Max investment | $500,000 | $600,000 | $600,000 |
| Max combined LTV | 0.65–0.70 | 0.75 | 0.75 |
| Safety Cap | 19.99% | 17.99% | 17.99% |
| States | 13–14, Colorado uncertain | 17, **no Colorado** | 17 |

The YAML rule file carries `supersedes_note` so this is visible at the point of use.
Anything either document flags as unverified is treated as unverified and never used as
grounds for a decline. Splitero's payout model is **total home value**, confirmed
first-party — settled, not an open question.

---

## D-003 — `Fact` added as a fifth first-class entity — **proposed** (§6 question #5)
*2026-08-17*

Brief named Case, Document, Finding, Verdict. Adding `Fact`: a typed, provenance-carrying,
confidence-bearing value. It is the seam between the fallible half of the system and the
deterministic half, and naming it is what makes that seam enforceable rather than
aspirational. One abstraction pays for field-level eval scoring, renderer grounding,
uncertainty escalation, replay, and audit.

---

## D-004 — `FactSet` permits multiple facts per key — **settled**
*2026-08-17*

Cross-document contradiction is the product, not an error to smooth over. A
last-write-wins map would silently delete adversarial case 18 (occupancy contradicted
across application, tax record and insurance policy). `resolve()` returns one of four
states — `KNOWN`, `CONFLICTED`, `LOW_CONFIDENCE`, `UNKNOWN` — and `CONFLICTED` and
`LOW_CONFIDENCE` are distinct escalation triggers.

---

## D-005 — Escalation is split into POLICY and INTEGRITY — **settled**
*2026-08-17*

`INTEGRITY_ESCALATE` = the facts are not trustworthy (wrong-parcel title report,
instruction-like text in a document, extraction confidence below the YAML threshold).
`POLICY_ESCALATE` = facts are trusted, policy needs a human (trust vesting, occupancy
ambiguity, sub-state service area). Adversarial case 9 versus case 5 are different
failures and collapsing them loses the distinction that drives the resolution order.

---

## D-006 — Rules engine signature is pure, synchronous, total — **settled**
*2026-08-17*

`evaluate(input: EvaluationInput): Verdict`. Not async — an async signature is a licence
to do I/O, and once a rule can await, a rule can call a model. Not throwing — missing or
contradictory facts are domain outcomes, and an unhandled exception in an underwriting
path is an unhandled applicant. `asOf` is required, not defaulted to now, so replay is
not opt-in.

---

## D-007 — Engine input is `FactSet`, not `Case` — **settled**
*2026-08-17*

`Case` is the fastest-changing type in the system; the engine is the slowest. Coupling
the deepest module to the intake schema is backwards. The engine owns its input type,
so intake, document formats and orchestration can all be rebuilt without touching it.

---

## D-008 — Verdicts are append-only and sealed; `Case` holds no decision field — **settled**
*2026-08-17*

A mutable decision field on `Case` is a field something eventually assigns to. Current
decision is a derived read over the ledger. `seal` is a content hash computed before
rendering; `VerdictLedger.read()` recomputes and fails on mismatch.

---

## D-009 — Renderer sees only the facts the rules actually read — **settled**
*2026-08-17*

`ExplanationRenderer(sealedVerdict, factsNamedInFindingFactsRead)`. Hallucinated grounds
become unexpressible rather than merely penalised: the renderer cannot cite an appraised
value in a state-eligibility decline because that rule never read it. `Rule.reads` is
declarative and enforced at runtime, which also gives the eval harness a free rule-coverage
report.

---

## D-010 — INCOMPLETE and DECLINE are distinct dispositions — **settled**
*2026-08-17*

A legal boundary, not a UX nicety: different notification contents and different 30-day
clocks under Reg B (HEI_DOMAIN §4.5). Adversarial case 13 tests it directly.

---

## D-011 — Occupancy ambiguity is escalated, never resolved — **settled**
*2026-08-17*

Splitero's own FAQ contradicts itself: one page says second homes and investment
properties may be eligible, another requires owner-occupancy at origination. Encoded as
rule `occupancy.ambiguous_policy` → `OCCUPANCY_AMBIGUOUS` → `POLICY_ESCALATE`, carrying
both quotations into the reviewer's queue item. Documented as an open question in
[docs/business/FAQ.md](business/FAQ.md) §1. Resolving it silently would recreate the exact
harm the project exists to prevent.

---

## D-012 — State match is necessary but not sufficient — **settled**
*2026-08-17*

Splitero services *"specific areas of"* the seventeen states, and the areas are not
published. Outside the seventeen → terminal `DECLINE`. Inside → `POLICY_ESCALATE` with
`STATE_ELIGIBLE_PENDING_AREA_CHECK`, never a clean pass.

---

## D-013 — Rule expressiveness: parameterised predicates — **open** (§6 question #1)
*2026-08-17*

Proposed: thresholds, dates, state lists, reason codes and message templates in YAML;
predicates as ~12 tested TypeScript functions registered by id. Alternative: a full YAML
expression DSL, which lets ops author logic but requires building an interpreter, where
bugs are silent and systemic. Everything that has actually changed in this domain is a
parameter, not a new kind of check. **Awaiting decision.**

---

## D-014 — Resolution order: POLICY_ESCALATE outranks non-terminal DECLINE — **open** (§6 question #2)
*2026-08-17*

Order: INTEGRITY_ESCALATE → terminal DECLINE → POLICY_ESCALATE → DECLINE → INCOMPLETE →
APPROVE. Makes the escalation false-negative rate zero by construction, at the cost of a
lower headline shift-left number. Alternative — DECLINE ahead of POLICY_ESCALATE — improves
the headline metric by auto-deciding cases a human should see. Recommend keeping the
proposed order. **Awaiting decision.**

Note the `terminal` flag exists precisely so this stays defensible: escalating a Texas
property to a human wastes the human and delays the applicant, because no human judgement
changes `STATE_NOT_SERVICED`.

---

## D-015 — Eval-set fidelity — **open** (§6 question #3)
*2026-08-17*

(a) all 200 cases as structured JSON — fast, extraction metrics are fiction; (b) 200 JSON
plus the 20 adversarial cases rendered to PDF with scan degradation — honest extraction
signal exactly where the hard cases are; (c) all 200 rendered. Recommend (b), with (c)
open as a later pass. **Awaiting decision.**

---

## D-016 — `agent-ops-core` is stubbed behind local ports — **open** (§6 question #4)
*2026-08-17*

Not on npm (404) and not present on disk. Defining `Clock`, `IdGen`, `BlobStore`,
`LlmClient` and tracing as local interfaces and stubbing them, so adopting the real
library later is an adapter change rather than a refactor. **Confirm, or point at the
package.**

---

## D-017 — Node 22 rather than Node 20 — **settled**
*2026-08-17*

Brief says Node 20+. Sandbox has v22.22.2. Targeting Node 22 LTS; `engines` will say
`>=20.11` so nothing in the brief is contradicted.
