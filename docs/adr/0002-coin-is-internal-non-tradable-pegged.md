# ADR-0002: The coin is internal, non-tradable, and pegged to a cent for v1

- Status: Accepted
- Date: 2026-06-22
- Supersedes: —
- Superseded-by: —

## Context

The coin is CrowdShip's unit of value: "roughly a cent — a stand-in for money"
(`CLAUDE.md`, "Coins"). The open fork is whether the coin is ever **externally
tradable** — bought and sold between users or on an open market, its value floating —
versus an **internal, pegged accounting unit** that only moves through the stream and is
redeemed back to fiat at cash-out.

Tradability is not a feature knob; it is a regulatory and product posture. A freely-traded
token invites securities and money-services-business scrutiny, introduces volatility that
directly contradicts "a coin is a cent," and pulls the product toward speculation. The
founding document is explicit about which way it leans: a non-goal is *"a coin that exists
to pump — the coin exists to move value through the stream"* (`CLAUDE.md`, "Non-goals"),
and the architecture research notes that custodial + pegged is precisely what dodges the
securities/MSB scrutiny a tradable token triggers (`docs/architecture-proposal.md`).

## Decision

**For v1 the coin is internal, non-tradable, and pegged.**

- **Internal** — coins exist only as balances in our ledger. There is no token contract,
  no order book, no peer-to-peer transfer outside the priced-offer / settlement flows.
  Coins enter via the fiat on-ramp and leave via payout; they do not circulate as a
  tradable asset.
- **Non-tradable** — there is no market on which a coin's price is discovered. A coin is
  not bought from another user; it is purchased from the platform and redeemed to the
  platform.
- **Pegged** — one coin is a fixed quantity of value ("roughly a cent"). The exact peg
  rate is a knob, not a principle (`CLAUDE.md`), but that it *is* pegged — that its value
  does not float — is the principle. The buy and sell prices a user faces may differ from
  each other (ADR-0004), but neither is set by a market.

## Consequences

- The "a coin is a cent" mental model holds because nothing makes it float. Backers reason
  about coins as money; the menu prices in coins as if pricing in cents.
- Pegged + non-tradable is half of why v1 avoids becoming a regulated money transmitter or
  securities issuer (custodial settlement, ADR-0001, is the other half). This is a
  *structural* posture, not a disclaimer.
- Coin amounts stay a plain quantity type (`CoinAmount` in `@crowdship/std`) — there is no
  per-coin price, no exchange-rate field threaded through the domain, because there is no
  market to source one from. Variability that a tradable coin would force into every value
  simply does not exist [LAW:types-are-the-program].

## Revisit when

- A deliberate, counsel-backed decision is made to let coins trade — at which point the
  volatility, custody, and securities questions each need an owner and this ADR is
  superseded by one that designs the tradable coin and its guardrails.
- The on-chain settlement fork (ADR-0001) reopens, since a chain-native coin and
  tradability tend to arrive together; resolve them as a pair, not piecemeal.
