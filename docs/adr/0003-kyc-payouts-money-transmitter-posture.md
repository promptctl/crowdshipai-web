# ADR-0003: KYC, payouts, and the money-transmitter problem ride Stripe Connect

- Status: Accepted
- Date: 2026-06-22
- Supersedes: —
- Superseded-by: —

## Context

Builders cash out coins for real money. The moment real money leaves the platform to a
person, three regulated obligations attach: **identity verification (KYC)** on the
payee, **tax reporting** (1099 in the US, 1042-S for some international payees), and the
**money-transmitter / e-money** question of who is licensed to hold and move the funds.
`CLAUDE.md` lists "KYC, payout, and tax mechanics for builders cashing out" as an open
decision. The fork is whether CrowdShip builds and owns this compliance surface, or
adopts a vendor whose licenses already cover it.

The founding attitude is decisive here: **don't reinvent solved problems**, and the
integrity of value is something we *get* by moving money the most trustworthy proven way,
not something we prove by building it ourselves (`CLAUDE.md`). KYC, tax filing, and
transmitter licensing are the most thoroughly solved — and most dangerous to get wrong —
problems in the entire system.

## Decision

**Payouts ride Stripe Connect (Express), and KYC happens at cash-out, not at coin
purchase.**

- **The regulated holding and moving of funds happens under Stripe's licenses.** Routing
  payouts through Stripe Connect means Stripe is the money transmitter / e-money holder of
  record; CrowdShip is not itself the licensed transmitter
  (`docs/architecture-proposal.md`). This is the single structural reason the posture is
  affordable for a founding-stage product.
- **KYC is gated at the payout boundary, on the builder being paid** — the payee
  completes Stripe Connect Express onboarding (identity, bank details) before money can
  reach them. A backer **buying** coins is an ordinary card purchase (ADR-0004's on-ramp)
  and is *not* KYC-gated; verification attaches to *receiving* real money, which is where
  the obligation actually lands.
- **Tax filing (1099/1042-S) is delegated to Stripe Connect** as part of the same
  onboarding, rather than built in-house.

## Consequences

- The internal coin balance is never Stripe's balance — the wallet is ours, the ledger is
  ours (ADR-0001), and Stripe is the rail at the fiat edges only: on-ramp in, payout out.
  Money crosses the boundary at exactly two points, each a single enforcer
  [LAW:single-enforcer], never scattered through the domain.
- KYC is a *capability gate on payout*, not a property of a user account. A builder can
  stream, sell, and accrue coins with no KYC; the gate fires only when they try to cash
  out. This keeps identity (`@crowdship/identity`) free of payout-compliance concerns —
  the two are separate boundaries.
- This decision is scoped to the **payment/payout adapter**. Swapping Stripe Connect for a
  specialist (Trolley/Tipalti for heavy international tax volume) is an adapter change
  behind the payout seam, not a domain change.

## Revisit when

- International builders become a launch priority and Stripe Connect's 1099/1042-S coverage
  proves insufficient — the architecture proposal already flags this as an open tension to
  confirm against vendor SLAs before committing.
- Payout volume reaches a scale where owning more of the compliance surface (or a second
  vendor) changes the economics.
- Counsel revises the money-transmitter analysis in a way that changes who must be
  licensed; this ADR is then superseded by the corrected posture.
