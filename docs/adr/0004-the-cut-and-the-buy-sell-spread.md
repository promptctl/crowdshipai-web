# ADR-0004: The cut is skimmed inside the ledger posting; the spread magnitude is an operational knob

- Status: Accepted
- Date: 2026-06-22
- Supersedes: —
- Superseded-by: —

## Context

CrowdShip's business is taking "a small cut of the coins moving through the middle"
(`CLAUDE.md`, "The three-sided idea"), plus a **spread**: the price a backer pays for a
coin and the value a builder cashes one out for need not be the same number — *"the
spread is the business model"* (`CLAUDE.md`, "Coins"). The open fork the parent epic owns
is *"the buy/sell spread and exactly how the cut is taken."*

This fork has two separable parts that have been conflated, and separating them is the
whole decision:

1. **The mechanism** — *how* the cut and spread are taken. This is an architecture
   question with a correct answer the laws dictate.
2. **The magnitude** — *the actual rates* (the cut percentage, the buy price, the sell
   price). This is a pricing/business decision, and `CLAUDE.md` is explicit that "the
   exact rate is a knob, not a principle" and "the buy and sell rates are a knob."

A magnitude is not an architecture decision and must not be frozen into the architecture.
An ADR that invents "the cut is 20%" would be fabricating a founder-held business fact and
then ossifying it in code. So this record decides the mechanism and **deliberately leaves
the magnitude unset**, as a configured value with a documented framework for setting it.

## Decision

**Mechanism (decided):**

- **The cut is skimmed inside the ledger posting**, as part of the same atomic transfer
  that moves coins from backer to builder — never a separate, skippable step. Taken inside
  the posting it "cannot be bypassed or forgotten" [LAW:single-enforcer]
  (`docs/architecture-proposal.md`). There is exactly one place the platform's share is
  computed and moved.
- **The spread is realized at the two fiat edges**, not in the middle. The buy rate prices
  the on-ramp (fiat → coins); the sell rate prices the payout (coins → fiat). The coin's
  internal value stays pegged and flat (ADR-0002); the spread is the difference between the
  two edge rates, not a floating coin price.
- **Both rates and the cut are configuration**, sourced at the composition root, never
  hard-coded in the domain and never read ambiently. Changing a rate is a config change,
  not a code change [LAW:no-shared-mutable-globals].

**Magnitude (deliberately deferred — an operational knob, not an architecture decision):**

- The cut percentage, the buy price per coin, and the sell price per coin are **not set by
  this ADR.** They are knobs to be tuned against real usage, per the founding document's
  own framing. The decision recorded here is that they are *knobs*, owned operationally and
  set with data — not constants the architecture commits to.
- Framework for setting them when the time comes: the buy rate anchors near "a coin is a
  cent"; the sell rate sits below it by the spread; the spread plus the per-offer cut must
  cover payment-processor fees (Stripe's on-ramp and Connect payout fees, ADR-0003) before
  it is platform margin. A spread that doesn't clear vendor fees is a loss, not a business
  model.

## Consequences

- The domain carries a `CoinAmount` and computes the cut from a configured rate; it never
  contains a magic number. The architecture is **complete and correct without the
  magnitude** — the magnitude flows in as a value [LAW:dataflow-not-control-flow], so
  setting or changing it later moves no domain code.
- Because the cut is one enforced posting, "our cut" and "the integrity of value" share a
  single source of truth: you cannot move coins backer→builder without the skim, and you
  cannot skim without a recorded movement.
- The spread living at the fiat edges keeps the middle (the priced-offer fire path,
  settlement) ignorant of pricing — an offer firing moves coins, and how those coins were
  priced in fiat is not its concern.

## Revisit when

- The founder sets initial rates — at which point the *values* are recorded (in config and,
  if useful, a short follow-up note), but this ADR's mechanism stands; setting a knob does
  not supersede the decision that it is a knob.
- Real usage shows the flat per-offer cut is the wrong shape (e.g. tiered rates, or a cut
  that differs for pooled bounties vs. tips) — a structural change to the mechanism, which
  would supersede this ADR rather than just re-tune a number.
