import type { Brand, BlankError, Result } from '@crowdship/std';
import { nonBlank } from '@crowdship/std';

import type { Currency, FiatAmount } from './money.js';

/**
 * An opaque reference to the backer's payment instrument — a tokenized card or
 * bank handle the PSP already holds (e.g. a Stripe `pm_…`), never raw card data,
 * which must never reach this system. Branded so a method token cannot be passed
 * where a currency code or any other opaque string is meant [LAW:types-are-the-program].
 */
export type PaymentMethod = Brand<string, 'PaymentMethod'>;

export const paymentMethod = (raw: string): Result<PaymentMethod, BlankError> =>
  nonBlank<'PaymentMethod'>('paymentMethod', raw);

/**
 * The idempotency key for one fiat charge: the PSP's at-most-once guarantee
 * hinges on it, exactly as the ledger's does on its own key. Charging twice
 * under the same key takes money once and replays the first result, so a retry
 * of a whole purchase can never double-charge a card [LAW:no-silent-failure].
 * Branded distinct from the ledger's `IdempotencyKey`: the charge and the coin
 * post are two movements on two engines, each with its own key, correlated by
 * the on-ramp that drives both — never silently shared.
 */
export type ChargeKey = Brand<string, 'ChargeKey'>;

export const chargeKey = (raw: string): Result<ChargeKey, BlankError> =>
  nonBlank<'ChargeKey'>('chargeKey', raw);

/** The PSP's own reference for a settled charge — its receipt id, stable across
 *  every idempotent replay of the same `ChargeKey`. Carried back so a charge can
 *  be reconciled against the PSP and, later, refunded. */
export type ChargeReference = Brand<string, 'ChargeReference'>;

export const chargeReference = (raw: string): Result<ChargeReference, BlankError> =>
  nonBlank<'ChargeReference'>('chargeReference', raw);

/**
 * What the on-ramp asks the PSP to do: take `amount` of `currency` from this
 * `method`, idempotently under `key`. Everything the charge needs is here — the
 * gateway is told *what to charge*, never *why* (that the fiat buys coins is the
 * on-ramp's knowledge, not the PSP's) [LAW:decomposition].
 */
export interface FiatCharge {
  readonly amount: FiatAmount;
  readonly currency: Currency;
  readonly method: PaymentMethod;
  readonly key: ChargeKey;
}

/** The proof the PSP took the money: its reference and the exact amount/currency
 *  charged. Identical across every replay of the same `ChargeKey` — the charge
 *  is not re-applied, its first result is reproduced. */
export interface ChargeReceipt {
  readonly reference: ChargeReference;
  readonly amount: FiatAmount;
  readonly currency: Currency;
}

/**
 * Every way a charge can fail to take the money, as one closed union the caller
 * destructures — never thrown [LAW:dataflow-not-control-flow]. The two arms drive
 * genuinely different next steps, which is why they are distinct rather than one
 * opaque error:
 *
 *  - `declined` — the instrument itself refused (insufficient funds, expired or
 *    blocked card). No money moved; the backer must fix or change payment, and
 *    retrying the *same* charge is futile. Carries the PSP's `reason` for display.
 *  - `gateway-unavailable` — the PSP could not be reached or errored on its side.
 *    No money is known to have moved; this is a transient, retryable failure, and
 *    a retry under the same `ChargeKey` is exactly the safe thing to do.
 */
export type ChargeDeclined =
  | { readonly kind: 'declined'; readonly reason: string }
  | { readonly kind: 'gateway-unavailable' };

/**
 * The payment-service-provider seam: the one fiat-charging effect the on-ramp
 * performs, behind a domain-terms interface so the production PSP (Stripe et al.)
 * and the in-memory fake are interchangeable instances of one type
 * [LAW:one-type-per-behavior]. The charge is the *only* place real money is
 * touched on the way in; isolating it here keeps the coin post — its pure
 * ledger consequence — free of any vendor SDK [LAW:effects-at-boundaries].
 *
 * The PSP is the single source of truth for whether a charge succeeded and the
 * single enforcer of charge-idempotency (via `ChargeKey`); this seam never
 * re-derives or second-guesses that [LAW:single-enforcer].
 */
export interface PaymentGateway {
  charge(charge: FiatCharge): Promise<Result<ChargeReceipt, ChargeDeclined>>;
}
