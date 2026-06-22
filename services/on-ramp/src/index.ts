/**
 * The coin purchase on-ramp: the dataflow spine that turns real money into coins.
 * A backer buys coins; fiat moves in through the `PaymentGateway` seam and coins
 * are posted out of the mint through the `Ledger` seam, as one idempotent unit —
 * fiat charged FIRST so coins are never minted from money that is not yet real,
 * a completed purchase replaying its receipts, a charged-but-uncredited purchase
 * surfaced loudly for reconciliation [LAW:no-silent-failure].
 *
 * This is a service: it composes a core (`@crowdship/payments`) and an adapter
 * (`@crowdship/ledger`) that may not depend on each other, and the product surface
 * drives it [LAW:one-way-deps]. It keeps no record of its own — both movements are
 * idempotent under their own keys, so the seams it composes are the single source
 * of truth for what happened [LAW:one-source-of-truth].
 */
export type {
  CoinOnRamp,
  OnRampDeps,
  OnRampOutcome,
  OnRampRequest,
} from './on-ramp.js';
export { createCoinOnRamp } from './on-ramp.js';
