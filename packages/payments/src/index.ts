/**
 * Payments — where real money meets the coin ledger. This core owns the *fiat*
 * vocabulary and the one seam through which money is taken: the `PaymentGateway`
 * (the PSP). Real money is touched only behind that seam, so everything above it
 * — the coin post that a charge buys — stays a pure ledger consequence
 * [LAW:effects-at-boundaries]. The interior is vendor-free and depends only on
 * foundation; the Stripe binding is an instance of the seam, not a dependency of
 * it [LAW:one-way-deps].
 *
 * What lives here is the money side that the whole payments epic stands on — the
 * on-ramp charges through this gateway, the off-ramp and reconciliation will too.
 * What deliberately does NOT live here is the *rate*: how many coins a charge
 * buys, the buy/sell spread, and the platform cut are policy with their own
 * ticket, kept out of these primitives exactly as the coin/fiat split keeps it
 * out of the money types [LAW:one-source-of-truth].
 */
export type { FiatAmount, FiatAmountError, Currency } from './money.js';
export { fiatAmount, currency } from './money.js';

export type {
  ChargeDeclined,
  ChargeKey,
  ChargeReceipt,
  ChargeReference,
  FiatCharge,
  PaymentGateway,
  PaymentMethod,
} from './gateway.js';
export { chargeKey, chargeReference, paymentMethod } from './gateway.js';

export type { DeclinePolicy } from './in-memory-gateway.js';
export { createInMemoryPaymentGateway } from './in-memory-gateway.js';
