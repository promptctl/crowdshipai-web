# ADR-0001: Custodial settlement for v1; on-chain is a headline deferred, not rejected

- Status: Accepted
- Date: 2026-06-22
- Supersedes: —
- Superseded-by: —

## Context

CrowdShip's most powerful idea is the **self-settling obligation**: a backer's pledge
sits in escrow and the instant its condition is met — a deliverable accepted, a pool
hitting its target, a goal resolving — it releases to the builder, the cut is skimmed,
and everyone watching sees it happen, with no human in the loop (`CLAUDE.md`,
"Self-settling obligations"). The open fork is *where the obligation settles*: against
our own coin balances (**custodial**), or trustlessly **on-chain** so no platform ever
sits on the money asking to be trusted.

The two are not equal in cost-to-ship. Custodial settlement is an escrow state machine
(`escrowed → condition-met → released | refunded`) riding the ledger we already adopted
— TigerBeetle's native two-phase transfer is exactly this primitive
(`docs/architecture-proposal.md`). A trustless on-chain version drags in a freely-moving
token and everything that follows it: securities / money-transmitter scrutiny, price
volatility that breaks the "a coin is a cent" peg, on-chain UX friction, and custody
liability for keys. `CLAUDE.md` names every one of these as the reason on-chain waits.

The goal that governs every decision here is **ship the product** — a working CrowdShip
in front of real people as fast as possible — and **don't reinvent solved tech to prove
we can**. A double-entry ledger with two-phase escrow is solved; a trustless settlement
network is a foundational-infrastructure project, an explicit non-goal.

## Decision

**v1 settles custodially.** The obligation is an escrow held against our internal coin
balances in the adopted ledger; the condition resolving releases it through a two-phase
transfer, the cut is skimmed inside that same posting (see ADR-0004), and the movement is
visible to the room. There is **no on-chain token, no external chain, and no wallet keys**
in v1.

On-chain settlement is **deferred, not rejected.** It is reframed from "a thing that might
block launch" to "a headline feature for later" — the trustless version is a story we get
to tell once the custodial product is real and the regulatory/UX questions have owners.

## Consequences

- The integrity of value — *no coin created, destroyed, or moved silently; failures
  loud* (`CLAUDE.md`) — is a property we **get** from the adopted ledger's enforced
  invariants (no-overdraft, idempotency, double-entry), not one we prove by building
  settlement infrastructure ourselves.
- Settlement lives behind a seam keyed to the obligation lifecycle, not to "TigerBeetle"
  or "a chain." The custodial-vs-on-chain choice is therefore an *adapter* decision
  [LAW:locality-or-seam]: swapping the settlement backend later moves zero domain code,
  the same way the Mux/LiveKit video reversal moved none.
- We do **not** take on money-transmitter licensing for the act of settling — money that
  is regulated to hold and move rides the payment/payout vendors (ADR-0003), and the
  custodial coin is a pegged internal accounting unit, not a transmissible instrument
  (ADR-0002).

## Revisit when

- A concrete user demand for *trustless* settlement appears — backers who will not pledge
  into a custodial pool because they don't want to trust the platform with escrow. Until
  that demand is real, on-chain is solving a problem no user has voiced.
- Counsel or scale makes the custodial escrow float itself a licensing trigger, changing
  the cost balance that currently favors custodial.
- A later ADR supersedes this one with an on-chain settlement design; at that point this
  record flips to `Superseded` and names it.
