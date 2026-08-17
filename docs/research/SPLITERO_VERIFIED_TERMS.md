# Splitero — verified terms

**Source: splitero.com, read directly, 16 August 2026. These supersede every number in `HEI_DOMAIN.md` §1.5.**


---

## THE BIG ONE — the payout model is TOTAL VALUE, confirmed

Their own FAQ, verbatim:

> **"Repurchase Amount = Split Percentage × your home's appraised value at repurchase (up to the Safety Cap)"**

and

> *"Splitero's share of your future home value is determined at origination. This is known as your Split Percentage. Once you're ready to repurchase, your home is appraised again. This is the value your option repurchase amount is based upon."*

**Total home value, not change in value.** On a $1M home appreciating to $1.23M with a 20% split: you owe **20% of $1,230,000 = $246,000**, not 20% of the $230,000 gain.

That was the single unresolved question and it's now settled. Getting it wrong would have made every settlement number in your system wrong by roughly five times.

Note also: *"If your home's appraised value is lower at repurchase, your repurchase amount reflects that lower value."* Downside is shared — model it.

---

## The constants — for your YAML rules file

```yaml
rules_version: "2026-08-16"
source: "splitero.com FAQ + eligibility, read 2026-08-16"

investment:
  min_amount_usd: 50000
  max_amount_usd: 600000          # was $500k in research — WRONG
  max_pct_of_home_value: 0.25

property:
  min_appraised_value_usd: 200000
  max_appraised_value_usd: 5000000  # $5M confirmed, not $6M

equity:
  min_equity_pct_before_funding: 0.25
  max_cltv_at_origination: 0.75   # was 0.65–0.70 in research — WRONG
  # verbatim: "the total of your new HEI Option plus your loan balance
  # may not exceed 75% of your home's value"

credit:
  min_score: 500
  report_valid_days: 120
  income_requirement: none
  employment_requirement: none
  dti_requirement: none
  age_requirement: none

pricing:
  origination_fee_pct: 0.0499
  origination_fee_min_usd: 1500
  safety_cap_annual_pct: 0.1799   # 17.99% — was 19.99% in research — WRONG
  appraisal_usd: [200, 700]
  title_usd: [200, 900]
  escrow_usd: [250, 550]
  repurchase_statement_usd: 30

term:
  model: "Maturity Match"
  rule: "matches senior mortgage maturity, or 10 years from origination, whichever is later"
  min_years: 10
  max_years: 30
  early_repurchase_penalty: none
  senior_mortgage_max_remaining_years: 30   # >30 = INELIGIBLE

timing:
  prequalification_days: [1, 2]
  application_to_funding_days_typical: 20
```

---

## States — 17, and **no Colorado**

> *"Arizona, California, Florida, Idaho, Missouri, Montana, Nevada, New Jersey, Ohio, Oregon, Pennsylvania, South Carolina, Tennessee, Utah, Virginia, Washington, and Wyoming"*

My research said 13–14 states and flagged Colorado as uncertain. **Colorado is not on the list.** And four states the research never had at all: **Idaho, Missouri, Montana, Wyoming.**

**One subtlety worth building for:** the wording is *"specific areas of"* those states. State-level matching is necessary but not sufficient — there's sub-state geography they don't disclose publicly. Your rules engine should return `STATE_ELIGIBLE_PENDING_AREA_CHECK` rather than a clean pass, and escalate. That nuance is exactly the kind of thing that shows you read carefully.

---

## Property eligibility — much richer than the research had

**Eligible:** single-family, condominiums, townhomes, 2–4 units. Held by individuals, **in trusts (subject to approval)**, and **by LLCs (subject to approval)**.

**Not eligible — this is a clean hard-gate list:**
5+ units · modular/mobile · manufactured/prefabricated · commercial or agricultural use · **log cabins** · **houseboats** · nontraditional design (geodesic, earth berm, shipping-container) · **properties on 5+ acres** · vacant land · timeshares, fractional or segmented ownership

---

## Rules the research completely missed

These are the best additions, because they're specific, checkable, and nobody else building a portfolio HEI project will have them.

**Seasoning periods:**
- Bankruptcy: **at least 4 years from most recent dismissal date**
- Foreclosure: **at least 7 years from completion date**

**Notice of Default / Notice of Sale:**
- Not more than **two NODs in the past 12 months**
- **No NOS in the past 12 months**
- Not more than **one NOS in the past 36 months**

**Senior mortgage:** if more than 30 years remain, ineligible.

**Existing encumbrances:** reverse mortgage or another shared-equity agreement must be paid off at or before closing. Splitero *may* originate behind a HELOC or home equity loan — case by case, so `ESCALATE`, not `DECLINE`.

**Spousal signature — a whole rules area on its own.** In many states a non-title spouse has homestead or marital-property rights and must sign. Their FAQ says this holds **during separation and pending divorce** until a final decree and property settlement are recorded. That is a genuinely hard, genuinely state-specific rule, and it's the kind of thing that surfaces at closing and kills a deal at week six. **Build it as an intake check.**

---

## An internal contradiction on their own site — use this

Two Splitero FAQ pages disagree about occupancy:

> *"Are second homes or investment properties eligible? **Yes.** In some cases, a second home or investment property may be eligible."*

> *"Your property must be **owner-occupied at the time of origination**, but you may rent out your home after receiving your investment."*

**Do not resolve this silently.** Encode it as `OCCUPANCY_AMBIGUOUS → ESCALATE` and write it up in your `docs/business/FAQ.md` as an open question you found in their published rules.

Finding a contradiction in a company's own eligibility documentation, and handling it as an escalation rather than guessing, is a better interview moment than any amount of extraction accuracy.

---

## Other corrections and useful facts

| Item | Research said | Actually |
|---|---|---|
| Time to fund | 10 days, or 14–30 | *"as little as **20 days**"* |
| Still paused after Oct 2023? | Unclear | **Actively accepting applications** — FAQ says so explicitly |
| Occupancy | Owner-occupied only | Ambiguous (above); renting **after** funding is allowed |
| Manufactured homes | Excluded | Confirmed excluded — but note **Hometap accepts them**, which is a real differentiator |

**Also worth knowing:**
- Servicer is **RoundPoint Mortgage Servicing LLC** — real detail for your servicing-workflow entries in the Opportunity Register
- **Splitero Funding, Inc. NMLS #2327455**
- Affiliated brokerage **Splitero Homes** handles exit-by-sale — a genuine vertical-integration angle
- Documents required at application: **government ID, recent mortgage statement, other lien statements**
- Soft pull at pre-qualification, **hard pull during Application Review**
- They monitor credit periodically **for the life of the HEI** via soft inquiry — that's a servicing signal you could build against
- A **"re-split"** exists: a new HEI to repurchase the original at end of term

---

## Their language rules — copy these exactly

Splitero is careful, deliberately, and your consumer-facing copy should mirror it:

- **"Repurchase," never "repayment."** Their FAQ explains why: *"it's an investment option rather than borrowed money."*
- **"Investment," not "loan."**
- **"Split Percentage"** is the proper noun for the share.
- **"Safety Cap"** and **"Maturity Match™"** are their branded terms.
- On the Safety Cap they say *"maximum equivalent annual rate"* — carefully avoiding "interest rate" while giving consumers a comparable number.

Using their exact vocabulary in your README and your generated explanations costs nothing and reads as though you already work there.
