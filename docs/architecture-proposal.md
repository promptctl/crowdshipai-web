# CrowdShip — Architecture Proposal

> **Status: research proposal, not a plan of record.** Produced June 2026 to answer
> "how do we ship the product by adopting solved infrastructure and building only the
> connective substrate." It changes no tickets and commits us to no vendor. Refine it,
> argue with it, or discard it. The backlog remains the source of truth for *what we
> build next*; `CLAUDE.md` remains the source of truth for *intent*.

## The thesis: CrowdShip is the seams, not the parts

Every hard, solved system is **adopted behind one interface we own**. Our proprietary
code is the **connective substrate** — the domain truth (coins, menu, settlement, the
cut, policy) plus the seams that bind the adopted parts into a single product. This is
not architectural taste; it is the founding requirement — *"swap things around without
rewriting the app"* — restated as `[LAW:locality-or-seam]`. The repo already proves the
pattern at small scale (`CrowdCatalog`, the `Ledger` seam); the proposal is to apply it
deliberately to every major piece.

The research behind this doc already paid the dividend that validates the approach: it
**reversed the video pick** (LiveKit → Mux, below) — and because video lives behind a
Media seam that says *"a builder's live stream,"* not *"a WebRTC track,"* that reversal
moves **zero domain code**. A vendor decision flipped and the app didn't feel it. That
is the entire bet, demonstrated before a line was written.

```
        +----------------------- apps/web (the surface) -----------------------+
        |   reads/writes ONLY through seam interfaces -- never a vendor SDK     |
        +----------------------------------------------------------------------+
                                     |  depends inward only -- [LAW:one-way-deps]
        +--------------------- DOMAIN CORE (ours, pure) -----------------------+
        |   Identity/Account   PricedOffer (the Menu)   Settlement   The Cut   |
        |   -- vendor-free, the part only CrowdShip can write                  |
        +----------------------------------------------------------------------+
            | Identity   | Realtime  | Ledger    | Payments  | Media   | Policy
            | seam       | seam      | seam      | seam      | seam    | seam
        +---+--------+---+------+----+------+----+------+----+-----+---+-------+
        | Auth.js    | Centrifugo| TigerBeetle| Stripe +  | Mux     |  (ours -- |
        | adapter    | adapter   | adapter    | Connect   | adapter |  single   |
        |            |           |            | adapter   |         | enforcer) |
        +------------+-----------+------------+-----------+---------+-----------+
            ADOPTED PARTS -- interchangeable details behind the seam
```

## What we ADOPT — verified June 2026

| Concern | Pick (v1) | Why this one | Reserve / swap |
|---|---|---|---|
| **Video** | **Mux** (managed LL-HLS, ~2–5s) | "Watch someone code" is one-to-many screen-share, not conferencing. LL-HLS gives CDN reach + text legibility on a screen-share; a tip landing 2–3s after a keystroke is fine. Best DX. | Cloudflare Stream (cheaper egress) · Owncast (true self-host) · LiveKit *only if* builders ever pair-program live |
| **Live chat / room events** | **Centrifugo** (OSS, self-host) | Simple pub/sub at thousands-per-room, low lock-in. Do NOT ride chat on video data channels — couples chat lifetime to the media session. | Ably (managed) · Stream Chat (chat+moderation off-the-shelf) |
| **Coin ledger** | **TigerBeetle** | Double-entry, native two-phase escrow (Settlement needs it), built-in idempotency, native no-overdraft via account flags. **Adopted** (ledger y38.5): a real TigerBeetle adapter sits behind the `Ledger` seam and the hand-rolled engine that duplicated it is deleted — the engine owns balances/idempotency/overdraft; an in-memory fake stands behind the same seam for tests. | Formance (MIT, Postgres) — same seam |
| **Fiat on-ramp** (buy coins) | **Stripe** (Checkout/Payments) | Consensus startup default; credit the *internal* ledger on `payment_intent.succeeded`. The wallet is ours, never Stripe's balance. | Adyen at $10M+ volume |
| **Payouts** (cash out coins) | **Stripe Connect — Express** | The one managed service that offloads KYC + 1099 filing + the money-transmitter problem at once, same vendor as the on-ramp. | Trolley/Tipalti for heavy international/1042-S tax volume |
| **Auth crypto** | **Auth.js (NextAuth v5)** | Password/session/CSRF/recovery is solved; self-host, no lock-in, native to the Next.js app. This is ticket bb2.1, behind an Identity seam. | Any provider behind the same seam |

**Two findings worth internalizing:**

- **The coin wallet is confirmed-custom.** There is no off-the-shelf "creator tipping /
  coin wallet" component — only crypto key-managers (irrelevant) and heavyweight
  white-label fintech platforms. The real-world pattern is exactly what we are doing:
  ledger + payment processor + bespoke coins/menu/settlement on top. So the **Build**
  column is not us refusing to adopt — it is that no part exists to adopt. That is the moat.
- **The regulatory win is structural.** Routing money through Stripe Connect means the
  regulated holding/moving of funds happens under *Stripe's* money-transmitter / e-money
  licenses — CrowdShip is not itself the licensed transmitter. Custodial + pegged ("a
  coin is a cent") also dodges the securities/MSB scrutiny a tradable token triggers.
  This is the founding doc's "custodial now, on-chain later" made concrete. (Counsel
  confirms specifics.)

## What we BUILD — the domain core (vendor-free, the part only we can write)

Depends *inward* on nothing but the seam interfaces (`[LAW:one-way-deps]`):

- **Identity / Account** — one `Account`; roles (builder/backer/recruiter) are
  **capability data on it**, not three user types (`[LAW:one-type-per-behavior]`, bb2.2).
  Auth.js sits behind the Identity seam.
- **PricedOffer — the Menu** — `price + an effect to fire`, where the effect kind is an
  **open label we carry but never branch on**. Already typed in the walking skeleton,
  already correct. The differentiator: the builder invents what to sell; we never own a
  dropdown of allowed actions.
- **Settlement** — the escrow state machine (`escrowed → condition-met → released |
  refunded`) riding TigerBeetle's two-phase transfer. "Obligations that pay themselves out."
- **The Cut** — the platform skim, taken *inside* the ledger posting so it cannot be
  bypassed or forgotten (`[LAW:single-enforcer]`).
- **The Policy boundary** — one enforcer for conduct / age-gating / NSFW-of-the-software-
  being-built (bb2.5 + moderation epic), sitting on the vendors' pre-publish interception hooks.

## The spine is dataflow, not a call-graph

The connective tissue is an **effect/event flow**. One offer firing fans out across fixed seams:

```
PricedOffer fired --> Ledger   : post coins (backer->builder), skim the cut
                  +-> Realtime : announce it to the room (the visible moment)
                  +-> Settlement: open/close an escrow, IF the effect is an obligation
```

A new thing a builder dreams up to sell is **new data through fixed seams, never a new
branch** (`[LAW:dataflow-not-control-flow]`, `[LAW:no-mode-explosion]`). That is the
"add it, hate it, delete it with minimal aux changes" property — *derived* from the
`PricedOffer` type, not bolted on.

## Sequencing — shortest path to a watchable, tippable stream in front of people

Each step is a thing real people can use:

1. **Identity (bb2.1)** behind the Identity seam — Auth.js. The trust boundary everything
   else assumes; unblocks payouts + ingest.
2. **Video seam → Mux** + **Chat seam → Centrifugo**: a real builder streams, an audience
   watches and talks. *Watchable.*
3. **Ledger adapter → TigerBeetle** behind the `Ledger` seam (done) + **on-ramp →
   Stripe**: backers buy coins. *The economy has fuel.*
4. **PricedOffer fire path** (the dataflow spine): an offer fires, coins move, the room
   sees it. *Tippable. The MVP moment.*
5. **Settlement** (pooled bounties that pay themselves out) + **Payouts → Stripe Connect**:
   the micro-contracting bet, and builders can cash out.
6. **Policy boundary** hardened across all of it (designed in from step 1, enforced as one
   gate by bb2.5).

Steps 1–4 are the smallest thing recognizably CrowdShip. 5 is the headline differentiator.
6 is non-negotiable but rides on hooks the vendors already give us.

## Open tensions

- **Payout tax coverage** — if international builders are a launch priority, confirm Stripe
  Connect's 1099/1042-S coverage or weigh a specialist (Trolley/Tipalti).
- **Realtime seam shape** — does it carry *only* chat, or *all* room events (offer-fired,
  settlement-released banners)? Argument for all of them through one seam: a fired offer
  and a chat line are the same kind of thing — *a thing that happened in the room* — which
  keeps them one type, not two parallel systems. Wants a deliberate decision.

## Sources

Two verified research passes (June 2026): payment/payout rails (Stripe, Stripe Connect
Express, Adyen, PayPal Payouts, Wise, Dwolla, Trolley/Tipalti; money-transmitter posture)
and video/chat/moderation (Mux, Cloudflare Stream, Amazon IVS, Owncast, LiveKit;
Centrifugo, Ably, Stream Chat; pre-publish interception + role-grant moderation). Pricing
and per-country specifics are directional snapshots — re-confirm against vendor SLAs before
budgeting or committing.
