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
