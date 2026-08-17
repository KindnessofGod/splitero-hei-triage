# The builder's log

Append-only. Newest at the bottom. Entries that harden get promoted to an ADR in `docs/adr/`.

Each entry: **the question · what I proposed · what you decided · why, in your words · what
would change our mind · what the change cost.**

Tags — `[DECISION]` you decided · `[REJECTED]` an option we ruled out · `[CORRECTION]` I got
something wrong and it was fixed · `[LEARNED]` a fact from the domain that moved the design ·
`[PROPOSED]` awaiting you, not yet a decision.

> **Standing rule, added 2026-08-17 at your instruction:** no entry is written without your
> input, because it records *your* reasoning, not mine. Where a "why, in your words" field is
> empty, the entry is a `[PROPOSED]` and is not binding on anything.

---

## 001 · Who makes the decision — `[DECISION]`

**The question.** Does a language model decide eligibility, or does a deterministic engine?

**What I proposed.** Nothing — you specified this before I had an opinion.

**What you decided.** A deterministic rules engine makes every decision. The model does two
things only: extract fields from documents, and render a human explanation from rule output.
No code path where a model output becomes a decision. Enforced structurally.

**Why, in your words.** *"The architectural rule, and it is not negotiable… There must be no
code path where a model output becomes a decision. Enforce that structurally."*

**What would change our mind.** In [ADR 0001](adr/0001-deterministic-rules-engine.md) — four
conditions, none currently true. Explicitly *not* sufficient: better extraction accuracy,
higher benchmark scores, or a lower perceived chance of enforcement.

**Cost.** Novel situations escalate rather than resolve. Someone maintains the rule corpus.
Recall is bounded by what is encoded, so the eval must report rule coverage. Higher escalation
volume — accepted deliberately, see 014.

---

## 002 · Which source wins on a conflict — `[DECISION]`

**The question.** `HEI_DOMAIN.md` and `SPLITERO_VERIFIED_TERMS.md` disagree on four figures.

**What I proposed.** Nothing — you specified it.

**What you decided.** The verified-terms file outranks the research file, always.

**Why, in your words.** *"The verified-terms file was read directly from Splitero's own site
and outranks the research file on any conflict — the research file's §1.5 numbers are known to
be wrong in four places."*

| Value | Research §1.5 | Verified | In use |
|---|---|---|---|
| Max investment | $500,000 | $600,000 | $600,000 |
| Max combined LTV | 0.65–0.70 | 0.75 | 0.75 |
| Safety Cap | 19.99% | 17.99% | 17.99% |
| States | 13–14, Colorado unclear | 17, **no Colorado** | 17 |

**What would change our mind.** A first-party source newer than 2026-08-16. Third-party review
sites never outrank splitero.com regardless of how many agree.

**Cost.** None. The YAML carries `supersedes_note` so it is visible at the point of use.

---

## 003 · Occupancy contradiction — `[DECISION]`

**The question.** Splitero's own FAQ says second homes and investment properties may be
eligible on one page, and requires owner-occupancy at origination on another. Which is the rule?

**What I proposed.** Nothing — you pre-empted it.

**What you decided.** Do not resolve it. `OCCUPANCY_AMBIGUOUS → ESCALATE`, documented as an
open question in `docs/business/FAQ.md`.

**Why, in your words.** *"Do not resolve this. Encode it as OCCUPANCY_AMBIGUOUS → ESCALATE and
document it as an open question."*

**What would change our mind.** One authoritative Splitero statement — an underwriting guideline
or a corrected public page — saying whether owner-occupancy is required at funding, and what the
exceptions are.

**Cost.** Every second-home and investment-property applicant goes to a human. Under-counts the
headline shift-left metric, because these cases are neither approved nor declined at intake.

**Where I would push back.** Nowhere. Picking a reading silently would recreate the exact harm
the project exists to prevent — advancing someone who gets declined in month four.

---

## 004 · Auditability is a first-class requirement — `[DECISION]`

**The question.** Is the trace a logging concern layered on afterwards, or a design constraint?

**What I proposed.** Phase 1 had append-only sealed verdicts and provenance on every fact, but
no per-step trace and no replay command. Weaker than what you asked for.

**What you decided.** Every decision node traceable, not logged. One `correlation_id` per case
threaded through everything including n8n. Every step emits a record whether or not it changed
anything. Append-only, corrections as new records. `npm run replay <correlation_id>` prints the
chain as a narrative, and it is tested.

**Why, in your words.** *"Not logged — traceable. Someone must be able to take a single case and
reconstruct exactly what happened, in order, with the reasoning, months later."* And: *"A record
saying `verdict: DECLINE` is useless. A record carrying the rule, the version, the evidence and
the threshold is an audit trail."* And on n8n: *"A trace that stops at the boundary of the
orchestrator is not a trace."*

**What would change our mind.** Nothing identified. This constrains build order rather than
trading against anything — the audit store is slice 1, before any pipeline stage.

**Cost.** One record per rule *considered*, not per rule that fired. Roughly 40× write
amplification on evaluation. Accepted: your DECLINE-chain requirement needs the passes.

---

## 005 · The rules engine is pure, so it returns audit records rather than writing them — `[PROPOSED]`

**The question.** The engine has an empty dependency closure and a synchronous signature — that
is what makes "the model cannot decide" structural rather than conventional. It therefore cannot
write to a database. How does it satisfy "every step emits an audit record"?

**What I proposed.** `evaluate` returns `{verdict, audit[]}`. An `AuditedRulesEngine` wrapper in
the adapter package persists the records and is the only constructor exposed at the composition
root. If the append fails, no verdict is returned — a decision that was not recorded did not
happen.

**What you decided.** *(pending)*

**Why, in your words.** *(pending)*

**Cost if adopted.** One indirection between the caller and the engine. In exchange, purity
survives intact and emission is guaranteed by the wiring rather than by discipline.

---

## 006 · `correlation_id` and `case_id` are the same identifier — `[PROPOSED]`

**The question.** You specified `correlation_id` generated at intake; I designed `caseId`
generated at intake. One value, two names.

**What I proposed.** They are identical. `correlation_id` on the wire and in the audit store,
`CaseId` as the in-code type. Beneath it: `run_id` per pipeline pass, `record_id` per step,
`parent_record_id` for causality, and a monotonic `sequence` per correlation_id that provides
replay ordering — because timestamps collide and clocks move.

**What you decided.** *(pending)*

**Why, in your words.** *(pending)*

---

## 007 · Raw model responses vs. append-only and deletion rights — `[PROPOSED]` — **needs you**

**The question.** You require the raw model response before parsing, *and* append-only with no
deletes, *and* sensitive inputs hashed or redacted. A raw government-ID extraction is the least
redacted artifact in the system. Together these build a permanent undeletable store of applicant
identity data, in a state with statutory deletion rights.

**What I proposed.** Three options, laid out in
[`design/PHASE1A_AUDIT_RETROFIT.md`](design/PHASE1A_AUDIT_RETROFIT.md) Fork A. Recommending A2:
digest in the immutable chain forever, raw payload encrypted under a per-case key in a side
table, deletion implemented by destroying the key. Append-only holds — nothing is removed, one
key becomes unusable.

**What you decided.** *(pending)*

**Why, in your words.** *(pending)*

**Cost if A2 adopted.** A key-management story and roughly a day. Keeps your debugging
requirement fully intact.

---

## 008 · Who labels the 200 golden cases — `[PROPOSED]` — **needs you**

**The question.** You said "build the golden dataset" and later "labelled by me." Two hundred
cases is more than a review pass.

**What I proposed.** Fork B in the retrofit plan. Recommending B2: I generate cases with
proposed labels, you ratify or correct in one pass, and the file preserves every disagreement
between `proposed_label` and `human_label`.

**What you decided.** *(pending)*

**Why, in your words.** *(pending)*

**Note.** The twenty adversarial labels are already yours — HEI_DOMAIN §6.5 specifies each one
verbatim — and will record `labelled_by: human` under any option.

---

## 009 · I wrote seventeen log entries without you — `[CORRECTION]`

**What happened.** Before you set the standing rule, I wrote seventeen entries and tagged twelve
**settled**. Only three carried *your* reasoning. The other nine were my conclusions wearing
your label.

**Why it mattered.** A log where my inferences are indistinguishable from your decisions is
worse than no log — it manufactures agreement. Your framing: the entry records your reasoning,
not mine.

**Fixed.** File restructured to your schema. The nine are re-tagged `[PROPOSED]` with the "why,
in your words" field visibly empty. Nothing is binding until you speak.

**Learned.** Distinguish *I decided this because it follows from what you said* from *you
decided this*. The first is a proposal no matter how strongly it follows.

---

## 010 · Your escalation requirement appears to settle the resolution order — `[PROPOSED]`

**The question.** Does `POLICY_ESCALATE` outrank a non-terminal `DECLINE`? I had this open as a
genuine trade-off: escalation-first gives a zero escalation false-negative rate but a lower
headline shift-left number.

**What I proposed.** Escalation-first, and I flagged it as your call.

**What you appear to have decided.** *"That number should be zero and I should be able to say so
out loud."* Only escalation-first makes it zero **by construction**. The alternative makes it
zero only if the eval happens to find zero, which you could not say out loud in advance.

**Why, in your words.** *(pending — confirm you meant zero-as-guaranteed, not zero-as-measured)*

**Cost.** The headline "declined at intake" number is lower than the alternative would produce.
That is the trade you appear to have taken, and I think it is the right one.

---

## 011 · Branch name references the tool — `[PROPOSED]` — **blocked on you**

**The question.** Your standard: branches use `feat/`, `fix/`, `docs/`, `refactor/`, never the
tool name. The branch I am required to push to is `claude/hei-intake-triage-system-k898kc`.

**What I proposed.** Not renaming unilaterally — my operating constraints forbid pushing
elsewhere without your explicit permission. `feat/hei-intake-triage` on your word; the standard
applies to every branch after this one regardless.

**What you decided.** *(pending)*

---

## 012 · Node 22 rather than Node 20 — `[PROPOSED]`

**The question.** Brief says Node 20+; the sandbox has v22.22.2.

**What I proposed.** Target Node 22 LTS, declare `engines: ">=20.11"` so nothing in the brief is
contradicted.

**What you decided.** *(pending — low stakes, say nothing and I will proceed)*

---

## 013 · `agent-ops-core` is not obtainable — `[LEARNED]`

**What I found.** Not on npm — `npm view agent-ops-core` returns 404 — and not present anywhere
on this filesystem.

**What it changes.** I will define the ports we need — `Clock`, `IdGen`, `BlobStore`,
`LlmClient`, `AuditSink`, tracing — as local interfaces and stub them, so adopting the real
library later is an adapter swap rather than a refactor. Your brief anticipated this: *"Build
with the agent-ops-core library where it's ready; stub and swap otherwise."*

**Open.** If it lives in a private registry or another repository, point me at it.

---

## 014 · Design conclusions from Phase 1 that are mine, not yours — `[PROPOSED]`

Grouped, because none is individually contentious and all await the same nod. Full reasoning in
[`design/PHASE1_DOMAIN_MODEL.md`](design/PHASE1_DOMAIN_MODEL.md).

| # | Proposal | Why |
|---|---|---|
| a | Add `Fact` as a fifth entity alongside Case/Document/Finding/Verdict | It is the seam between the fallible half and the deterministic half; naming it makes the seam enforceable rather than aspirational |
| b | `FactSet` permits multiple facts per key | Cross-document contradiction is the product, not an error. A last-write-wins map silently deletes adversarial case 18 |
| c | Split escalation into `POLICY` and `INTEGRITY` | Case 9 (no trustworthy facts) and case 5 (excellent facts, ambiguous policy) are different failures |
| d | `evaluate` is pure, synchronous, total, with `asOf` required | Sync is the enforcement mechanism for 001. Total because an unhandled exception in underwriting is an unhandled applicant. Required `asOf` means replay is not opt-in |
| e | Engine input is `FactSet`, not `Case` | Never couple the slowest-changing module to the fastest-changing type |
| f | `Case` carries no decision field | A mutable decision field is a field something eventually assigns to |
| g | Renderer receives only the facts the firing rules declared they read | Makes hallucinated grounds unexpressible rather than merely penalised |
| h | `INCOMPLETE` and `DECLINE` are distinct dispositions | A legal boundary — different notice contents, different 30-day clocks |
| i | State match is necessary but not sufficient | Splitero services *"specific areas of"* 17 states and does not publish which |
| j | Rule parameters in YAML, predicates as ~12 tested TypeScript functions | Everything that has actually moved in this domain is a parameter, not a new kind of check. A YAML expression DSL means building an interpreter, where bugs are silent |
| k | One append-only store, not two | Phase 1's `VerdictLedger` becomes a typed view over `audit_record`. Two append-only stores is two sources of truth and an eventual divergence bug |

Item **j** is the one with a real alternative and I would like your view specifically. The rest
I will proceed on unless you say otherwise.

---

## 015 · Rule expressiveness — parameterised predicates — `[DECISION]`

**The question.** 014j: rule logic in a YAML expression language, or parameters in YAML with
predicates as tested TypeScript functions?

**What I proposed.** Parameters in YAML, predicates in TypeScript.

**What you decided.** Option 1 — parameters in YAML, predicates in TypeScript.

**Why, in your words.** *(you chose without stating a reason — say the word and I will record
yours here; until then this is a selection, not an argument)*

**What would change our mind.** An ops team needing to author genuinely new *kinds* of check
without an engineer, often enough that the cost of building and testing an expression
interpreter is repaid.

**Cost.** Adding a new kind of check needs a TypeScript change. Eight predicates written so far
(`value_in_set`, `value_not_in_set`, `at_least`, `at_most`, `within_range`, `ratio_at_most`,
`date_within_days`, `always`) cover every rule in the verified terms.

---

## 016 · Golden dataset labelling — I propose, you ratify — `[DECISION]`

**The question.** 200 cases is more than a review pass. Who labels?

**What I proposed.** B2 — I generate with proposed labels, you ratify or correct in one pass.

**What you decided.** B2.

**Why, in your words.** *(pending)*

**Cost.** One review pass from you. Every case carries `proposed_label`, `human_label`,
`labelled_by` and `reviewed_at`, and disagreements are preserved rather than overwritten —
where you change my label, that gap is itself evidence about where a plausible reading of the
rules was wrong.

---

## 017 · Escalation outranks non-terminal decline — `[DECISION]`

**The question.** Confirmed from 010: does POLICY_ESCALATE beat a non-terminal DECLINE?

**What I proposed.** Yes, so the escalation false-negative rate is zero by construction rather
than by measurement.

**What you decided.** Yes.

**Why, in your words.** *"That number should be zero and I should be able to say so out loud."*

**Cost.** The headline "declined at intake" figure will be lower than the alternative would
produce, because cases that could have been auto-declined go to a human instead. Accepted.

**Implemented.** `DeterministicRulesEngine.#resolve`, order: INTEGRITY_ESCALATE → terminal
DECLINE → POLICY_ESCALATE → DECLINE → INCOMPLETE → APPROVE. The `terminal` flag is what keeps
this defensible — a Texas property still declines rather than wasting a reviewer, because no
human judgement changes `STATE_NOT_SERVICED`.

---

## 018 · Branch renamed — `[DECISION]`

**The question.** The working branch referenced the tool, against your naming standard.

**What you decided.** Yes, rename.

**Now on** `feat/hei-intake-triage`. The old branch is left in place rather than deleted.

---

## 019 · "Why are we deleting AI responses?" — `[CORRECTION]`, and 007 is still open

**What you asked.** Why delete AI responses at all.

**Where I went wrong.** I framed Fork A as a deletion policy. It isn't. Nothing is deleted in
normal operation — every raw response is kept in full, forever. The mechanism exists for one
situation only: a homeowner exercising a statutory erasure right, where the alternatives are
refusing them or tearing a hole in the audit chain.

**Two figures I got wrong.** I said "roughly a day" — with the raw payload in its own table
from the start it is a couple of hours. And I did not say clearly enough that for *this*
project it is moot: the 200 cases are synthetic, so there is no real person to erase. It is a
design to point at, not one that will ever run.

**Still open.** A2 (encrypt, erase by destroying the key) versus A1 (plaintext forever, with
the limitation documented). Proceeding on A2 unless you say otherwise, because it is nearly
free now and an expensive retrofit later.

---

## 020 · Slice 2 shipped — what the code says that the plan did not — `[LEARNED]`

Written from the code, not the plan. Three things the design document did not anticipate:

**Integrity signals needed to become findings.** The plan had extraction emitting
`IntegritySignal` and hand-waved how it reached a decision. In the code the engine converts
each signal into a synthetic `integrity.document_signal` finding, so it flows through the same
resolution order as everything else rather than being a special case beside it.

**Low confidence and conflict short-circuit the predicate.** The plan implied a rule would run
and then be second-guessed. The code never runs the predicate at all when a fact it reads is
`CONFLICTED` or below the confidence floor — it returns `INTEGRITY_ESCALATE` immediately. This
is stronger: there is no computed-but-discarded decision anywhere in the trace.

**`onMissingFacts: 'SKIP'` still emits a finding.** The plan said "the rule is NOT_EVALUABLE."
In the code it returns a `PASS` finding carrying `missingFacts`, because your requirement is a
record for every step whether or not it changed anything — a silently absent rule is exactly
the gap a replay is supposed to expose.
