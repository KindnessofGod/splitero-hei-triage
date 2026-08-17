# Questions we cannot answer yet

> **Status: this describes how the system is designed to behave. It has not been built
> yet.** Every "what our system does" below is a commitment we are building toward, not a
> report of finished software. This banner comes off, section by section, as each
> behaviour ships and is tested. Nothing on this page is an estimate of results — it is a
> description of intended handling.

This page is for readers who are not engineers. There is no code on it, and every
term is explained where it first appears.

Everything here is a question the published rules do not settle. When our system meets
one of these, it does not guess. It routes the application to a person and says why.
That is a deliberate design choice: a wrong guess made quickly is worse for a homeowner
than an honest hand-off.

---

## 1. Can a second home or an investment property qualify? (unresolved)

**This is a contradiction inside Splitero's own published material, and we are not
resolving it.**

Splitero's frequently-asked-questions pages say two different things.

One page says:

> "Are second homes or investment properties eligible? **Yes.** In some cases, a second
> home or investment property may be eligible."

Another page says:

> "Your property must be **owner-occupied at the time of origination**, but you may rent
> out your home after receiving your investment."

*Owner-occupied* means the person who owns the home also lives in it as their main
residence. *At the time of origination* means on the day the agreement is signed and
funded.

Read together, the first statement says a property the owner does not live in may
sometimes qualify. The second says living there is required on day one. Both cannot be
the operating rule.

**What our system does.** When an applicant tells us the property is a second home or
an investment property, we do not approve and we do not decline. We record the outcome
`OCCUPANCY_AMBIGUOUS` and send the file to a human reviewer, along with both quotations
above and the note that the published guidance conflicts.

**Why we handle it this way.** The two readings lead to opposite answers for the same
applicant. Picking one silently would mean either declining people who may well be
eligible, or advancing people who will be declined later — after they have paid for an
appraisal and waited weeks. The whole point of this system is to stop that second
pattern. Inventing an answer here would recreate it.

**What would resolve it.** A single authoritative statement from Splitero — an
underwriting guideline, or a corrected public page — saying whether owner-occupancy is
required on the day of funding, and if there are exceptions, what they are. Once that
exists, this becomes an ordinary rule and the escalation disappears.

**One thing both pages agree on**, and which our system relies on: renting the home out
*after* funding is permitted. The disagreement is only about the day the agreement is
signed.

---

## 2. Which parts of the seventeen states are actually served? (unresolved)

Splitero lists seventeen states: Arizona, California, Florida, Idaho, Missouri, Montana,
Nevada, New Jersey, Ohio, Oregon, Pennsylvania, South Carolina, Tennessee, Utah,
Virginia, Washington, and Wyoming.

The wording is that they operate in *"specific areas of"* those states. Which areas is
not published.

**What our system does.** A property outside all seventeen states is declined
immediately — that is a firm answer we can give on day one, and giving it on day one is
better than giving it in month four. A property inside one of the seventeen is *not*
marked eligible; it is marked "state matches, service area unconfirmed" and reviewed by
a person.

**Why.** Telling someone in a served state that they are eligible, when their county may
be outside the service area, is the same broken promise we are trying to eliminate —
just a smaller version of it.

---

## 3. Is a Home Equity Investment legally a loan? (unresolved, and not ours to resolve)

A Home Equity Investment gives a homeowner a lump sum today in exchange for a share of
the home's value later. There are no monthly payments and no stated interest rate.

The industry's position is that this is an investment, not credit, so the rules
governing mortgages and other lending do not apply. The Consumer Financial Protection
Bureau — the federal agency overseeing consumer finance — argued the opposite in a
January 2025 court filing. Several state courts and state attorneys general have sided
with the second view. Others have not. The question is genuinely open.

**What our system does.** It assumes the stricter answer. Declines are written to meet
the standard that applies to credit decisions: a specific, accurate reason tied to
actual facts in the file, never a vague statement about internal criteria. If the
stricter rules turn out not to apply, we have simply been clearer than required. If they
do apply, we are already compliant.

We do not state a position on the legal question anywhere in this project, and neither
should any explanation the system produces.

---

## 4. Why does the system sometimes say "we need more information" instead of "no"?

These are different answers with different consequences, and the distinction is
deliberate.

- **Incomplete** means we cannot decide yet, and here is exactly what is missing. Example:
  a homeowner's insurance policy that expires in six days. Nothing about the application
  is disqualifying; the paperwork just needs refreshing.
- **Declined** means we have enough information and the answer is no.

Treating the first as the second would tell homeowners they had failed when they had
only submitted a document that needed updating. Under the rules that apply to credit
decisions, the two also carry different notification obligations and different deadlines.
Our system keeps them separate for both reasons.

---

## 5. What happens when documents in a file contradict each other?

They are not silently reconciled. Contradiction is treated as a finding in its own right.

Two examples of what this catches:

- An application states the home is the applicant's primary residence, the property tax
  record shows no homeowner's exemption (a tax break generally available only to people
  living in the home), and the insurance policy is a landlord policy. Each document alone
  looks unremarkable. Together they say something specific.
- A title report describes a different parcel than the one applied for — a different
  parcel number, a different legal description, an unfamiliar name on the deed. Here the
  correct response is neither approve nor decline: we do not have information about this
  applicant's property at all. A person is asked to sort out which document is wrong.

---

## 6. Can something in a submitted document tell the system what to decide?

No, and not because the system is instructed to ignore such attempts.

Decisions are made by a separate component that reads only a structured list of verified
facts — a home's appraised value, the balances on recorded debts, a policy expiry date.
It never reads document text. The component that does read documents can only produce
facts; it has no way to express a decision, so there is nothing for an instruction hidden
in a document to attach to.

When a document contains text that reads like an instruction, that fact is itself
recorded, and it sends the file to a person for review.

---

## 7. Where our figures come from

The eligibility figures used in this project were read directly from Splitero's own
website on 16 August 2026. An earlier research summary compiled from third-party review
sites was wrong in four places — the maximum investment amount, the maximum combined debt
allowed against the home, the annual cap on Splitero's return, and the list of states.
Where the two disagree, the company's own site wins, and the research summary is marked
as superseded.

Any figure we could not confirm from a first-party source is treated as unconfirmed and
is not used as the basis for a decline.
