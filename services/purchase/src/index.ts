/**
 * Purchase-to-fire: the dataflow spine that binds the menu substrate to the coin
 * ledger. A backer buys a `PricedOffer`; coins move through the `Ledger` seam and
 * the offer's effect fires through the `EffectPerformer` seam, as one idempotent
 * unit — completed purchases replay their recorded result, a paid-but-unfired effect
 * is surfaced loudly and re-fired on retry, and neither the charge nor the effect can
 * happen twice. The "did the effect already fire?" fact has its own authority, the
 * `PurchaseLog`, never the ledger's charge-replay flag [LAW:one-source-of-truth].
 *
 * This is a service: it composes a core (`@crowdship/menu`) and an adapter
 * (`@crowdship/ledger`) that may not depend on each other, and the product surface
 * drives it [LAW:one-way-deps].
 */
export type { Purchaser, PurchaseOutcome, PurchaseRequest } from './purchase.js';
export { createPurchaser } from './purchase.js';

export type { CompletedPurchase, PurchaseLog } from './purchase-log.js';
export { createInMemoryPurchaseLog } from './purchase-log.js';
