# HEI intake triage

Declines on day one what the industry declines in month four.

> **Status: slice 1 of the build.** The audit store and replay work end to end. The rules
> engine, extraction and the eval set are designed but not written. See
> [what isn't finished](#what-isnt-finished) before reading further.

## 90-second version

Home Equity Investment applicants get declined after months, for reasons that were
visible in their paperwork on day one. One documented case ran 4.5 months and ended in a
decline *after* the applicant had already borrowed money to replace his roof.

This system makes that decision at intake instead — and, critically, can prove why.

```
git clone https://github.com/KindnessofGod/splitero-hei-triage && cd splitero-hei-triage
npm ci
docker compose up -d
npm test
```

Then the thing worth looking at:

```
npm run replay HEI-0137
```

## One worked example

`npm run replay HEI-0137` prints the complete decision chain for a case:

```
CASE HEI-0137 · opened 2026-08-17T09:14:02.000Z · 8 records · 1 run
integrity: OK (8/8 linked, no gaps, 1 seal verified)

── run 1 · stage 3 ────────────────────────────────────────
[0] ingest.receive             SYSTEM n8n:webhook               12ms  OK
      6 documents received, 1 duplicate suppressed (same bytes as doc_04,
      declared filename "scan_003.pdf" vs "insurance.pdf")
[1] extract.prelim_title       MODEL  claude-opus-5           2140ms  OK
      8420 in / 512 out · $0.0871 · prompt extract.prelim_title.v3 · raw bd478ac5bf28…
[2] rules.evaluate             SYSTEM rules-engine@0.1.0              OK
      rules_version 2026-08-16 · set hash c52d2db6672c… · 5 rules considered
  ✓ geography.state_serviced   state CA vs set_size 17 → PASS → POLICY_ESCALATE/
                               STATE_ELIGIBLE_PENDING_AREA_CHECK
  ✗ equity.max_cltv            combined_lien_balance_usd $452,400,
                               appraised_value_usd $580,000, cltv 0.78
                               vs max_cltv 0.75 → FAIL → DECLINE/CLTV_EXCEEDED
  ⊘ insurance.coverage_a       SKIPPED — insurance.coverage_a_usd UNKNOWN
      … 2 more (--verbose for all)
[7] verdict.seal               SYSTEM sealer                     1ms  OK
      DECLINE · CLTV_EXCEEDED · seal 11de8258d59d… VERIFIED
```

Note what that is and isn't. It is not `verdict: DECLINE`. It names the rule, its
version, the values tested, the threshold they were tested against, and **every rule
that ran — including the ones that passed and the one skipped for a missing fact.**

Exits non-zero if the chain fails integrity: a gap in the sequence, a broken parent
link, a verdict whose seal no longer matches its contents, or a verdict with no rule
evaluations behind it.

## The architectural rule

**A deterministic rules engine makes every decision. The language model does two things
only: extract fields from documents, and render a human explanation from rule output.
There is no code path where a model output becomes a decision.**

This is enforced structurally, not by convention — see
[ADR 0001](docs/adr/0001-deterministic-rules-engine.md) for the five mechanisms, the
alternative that was rejected, and what would change our mind.

## What isn't finished

Honest inventory, because a README that reads as though everything works is worse than
no README.

| | Status |
|---|---|
| Audit record model, sealing, integrity checks | **done**, 15 tests passing |
| `npm run replay` | **done**, against a hand-written fixture chain |
| Hermetic test enforcement (3 layers) | **done** |
| Postgres schema + docker-compose | **done**; the Postgres *reader* is not wired — replay uses the in-memory fixture |
| Rules engine | designed, not written |
| `Fact` / `FactSet` / fact assembly | designed, not written |
| Document extraction | designed, not written |
| Explanation renderer | designed, not written |
| Golden eval set (200 cases) | designed, not written — blocked on a labelling decision |
| n8n orchestration | designed, not written |
| Track A / Track B documentation | deliberately unwritten — these get written *from the code*, and there isn't enough code yet |

## Documentation

**Design (pre-code, marked as such):**
[domain model and rules-engine interface](docs/design/PHASE1_DOMAIN_MODEL.md) ·
[auditability retrofit](docs/design/PHASE1A_AUDIT_RETROFIT.md) ·
[ADR 0001](docs/adr/0001-deterministic-rules-engine.md) ·
[the builder's log](docs/DECISIONS.draft.md)

**Domain research:**
[verified Splitero terms](docs/research/SPLITERO_VERIFIED_TERMS.md) (first-party, wins on
any conflict) · [HEI domain brief](docs/research/HEI_DOMAIN.md)

**Non-engineers:** [FAQ — the questions we can't answer yet](docs/business/FAQ.md)

## Tests are hermetic, structurally

Three layers, because dependency injection alone is a discipline about how you construct
objects and someone will eventually construct a real one in a test.

1. **Dependency injection.** No adapter self-instantiates.
2. **The network is removed from the test runtime.** `vitest.setup.ts` replaces `fetch`,
   `net.Socket#connect`, `net.createConnection`, `tls.connect` and `dns.lookup` with
   functions that throw.
3. **A test proves it.** `hermetic.test.ts` sets a plausible `ANTHROPIC_API_KEY`, tries
   to reach the network, and asserts the violation. Weaken layer 2 and it goes red.

No `SKIP_NETWORK` environment variable anywhere. An environment variable is a thing you
can set.
