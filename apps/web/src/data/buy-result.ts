import type { PoolView } from './types';

/**
 * What a backer's surface learns after a buy — the money outcome projected to the
 * one fact the UI must render, derived from the purchase/on-ramp pipelines' own
 * closed unions. These are deliberately NOT the rich domain receipts (maps of
 * balances, PSP references): a server action returns them across the network
 * boundary, so they carry only serializable primitives. Each arm preserves the
 * money truth its backend arm carries — *did coins move, and did the effect fire?*
 * — never collapsing a "no coins moved" outcome and a "coins moved, effect failed"
 * outcome into one, because that conflation is exactly the silent money lie the
 * whole pipeline exists to prevent [LAW:no-silent-failure].
 *
 * The `balance` on every settled arm is the backer's authoritative coin balance
 * re-read from the ledger after the attempt, so the surface shows truth, not an
 * optimistic guess [LAW:one-source-of-truth].
 */

/** The outcome of spending coins on an offer. */
export type SpendResult =
  /** Coins moved and the effect fired — the whole point, end to end. */
  | { readonly kind: 'fired'; readonly balance: number }
  /** A faithful retry of a purchase that already completed: no second charge, no second effect. */
  | { readonly kind: 'already-applied'; readonly balance: number }
  /** The ledger refused for want of coins — no coins moved; the backer must buy more. */
  | { readonly kind: 'insufficient-coins'; readonly balance: number }
  /** The ledger refused for another reason (a reused key) — no coins moved. */
  | { readonly kind: 'charge-refused'; readonly balance: number }
  /** Coins MOVED but the effect did not fire — the loud reconciliation case. */
  | { readonly kind: 'effect-failed'; readonly balance: number }
  /** Payer and payee resolved to the same account — no movement could form. */
  | { readonly kind: 'invalid-charge'; readonly balance: number }
  /** No live session — a viewer must be signed in to hold and spend coins. */
  | { readonly kind: 'must-authenticate' }
  /** No such offer on this channel — the chosen offer id names nothing. */
  | { readonly kind: 'no-such-offer' };

/** The outcome of buying coins through the on-ramp. */
export type FundResult =
  /** The requested amount was not a positive whole number — rejected at the action
   *  boundary before any charge, so no money moved. */
  | { readonly kind: 'invalid-amount' }
  /** Fiat charged and coins credited to the wallet. */
  | { readonly kind: 'purchased'; readonly balance: number }
  /** The PSP refused the fiat — no money moved, no coins minted. */
  | { readonly kind: 'charge-declined'; readonly balance: number }
  /** Fiat WAS charged but the ledger refused the mint — the loud reconciliation case. */
  | { readonly kind: 'credit-refused'; readonly balance: number }
  /** Mint and wallet resolved to the same account — caught before any charge. */
  | { readonly kind: 'invalid-routing'; readonly balance: number }
  /** No live session — a viewer must be signed in to buy coins. */
  | { readonly kind: 'must-authenticate' };

/**
 * The outcome of pledging coins to a builder's funding pool. Mirrors the shape of
 * {@link SpendResult}: every arm carries the authoritative wallet balance re-read from
 * the ledger so the surface shows truth, not a guess. The two `contributed-*` arms
 * preserve the distinction between "coins moved, pool still building" and "coins moved
 * AND pool tipped — it just shipped" — collapsing them would hide the release event that
 * is CrowdShip's core differentiator [LAW:no-silent-failure]. Each arm also carries the
 * updated `pool` view so the surface reflects the ledger's new escrow balance without a
 * second round-trip [LAW:one-source-of-truth].
 */
export type PledgeResult =
  /** Coins moved into the pool's escrow; the target is not yet reached. */
  | { readonly kind: 'contributed-pending'; readonly balance: number; readonly pool: PoolView }
  /** Coins moved AND this pledge tipped the target — the pool auto-released to the builder. */
  | { readonly kind: 'contributed-released'; readonly balance: number; readonly pool: PoolView }
  /** The ledger refused for want of coins — no coins moved. */
  | { readonly kind: 'insufficient-coins'; readonly balance: number }
  /** The ledger refused for another reason (key conflict, unknown account) — no coins moved. */
  | { readonly kind: 'pledge-refused'; readonly balance: number }
  /** The pledge could not be routed (backer and pool are the same account). */
  | { readonly kind: 'invalid-pledge' }
  /** No live session — a viewer must be signed in to pledge. */
  | { readonly kind: 'must-authenticate' }
  /** The builder cancelled this pool — no coins moved. The carried view lets a stale
   *  surface catch the pool up to how it now stands [LAW:one-source-of-truth]. */
  | { readonly kind: 'pool-cancelled'; readonly pool: PoolView }
  /** The pool id names no pool at all. */
  | { readonly kind: 'no-such-pool' };

/**
 * The outcome of a builder opening a new funding pool in the studio. `opened` is the
 * only success arm; the rest are the three ways a valid request can still be refused
 * before a single coin moves [LAW:no-silent-failure].
 */
export type PoolOpenResult =
  | { readonly kind: 'opened'; readonly pool: PoolView }
  | { readonly kind: 'must-authenticate' }
  /** The authenticated principal does not own a channel — can't route payouts yet. */
  | { readonly kind: 'no-channel' }
  /** The target amount is zero, negative, or not a safe integer. */
  | { readonly kind: 'invalid-target' };

/**
 * The outcome of a builder cancelling their funding pool from the studio — the surface
 * twin of the market's `CancelOutcome`, projected to serializable primitives
 * [LAW:effects-at-boundaries]. The two `cancelled-*` arms preserve the money truth a
 * builder must see plainly: coins went back to backers on this act, or there were none
 * pooled to return — never one blurred "cancelled" [LAW:no-silent-failure].
 */
export type PoolCancelResult =
  /** The pool closed and its escrow refunded — `refundedCoins` is the total of the
   *  ledger's recorded refund legs, read back from the settlement feed, never re-derived
   *  [LAW:one-source-of-truth]. */
  | { readonly kind: 'cancelled-refunded'; readonly pool: PoolView; readonly refundedCoins: number }
  /** The pool closed with an empty escrow — nothing was owed back. */
  | { readonly kind: 'cancelled-empty'; readonly pool: PoolView }
  /** A replay: the pool was already cancelled. Nothing changed. */
  | { readonly kind: 'already-cancelled'; readonly pool: PoolView }
  /** The pool already shipped — the builder is paid; there is nothing to cancel. */
  | { readonly kind: 'already-released'; readonly pool: PoolView }
  /** The rail refused the refund (a release raced this cancel) — the pool is NOT
   *  cancelled; the loud reconciliation case [LAW:no-silent-failure]. */
  | { readonly kind: 'cancel-refused' }
  /** The pool belongs to another builder's channel. */
  | { readonly kind: 'not-your-pool' }
  /** The pool id names no pool at all. */
  | { readonly kind: 'no-such-pool' }
  /** The authenticated principal does not own a channel. */
  | { readonly kind: 'no-channel' }
  /** No live session — only a signed-in builder can cancel a pool. */
  | { readonly kind: 'must-authenticate' };
