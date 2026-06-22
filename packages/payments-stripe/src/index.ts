/**
 * The production Stripe binding for the `PaymentGateway` seam: the real PSP behind
 * the same interface the in-memory fake implements, so the on-ramp composes either
 * with no change [LAW:locality-or-seam]. This is an adapter — it binds a vendor SDK
 * to a core (`@crowdship/payments`) and depends on no other adapter or service
 * [LAW:one-way-deps]. The fiat charge is the one place real money is touched on the
 * way in; isolating Stripe here keeps the coin post — its pure ledger consequence —
 * free of any vendor SDK [LAW:effects-at-boundaries].
 */
export type { StripeChargeClient } from './stripe-gateway.js';
export { createStripePaymentGateway } from './stripe-gateway.js';
