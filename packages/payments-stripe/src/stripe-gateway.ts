import type { Result } from '@crowdship/std';
import { err, ok, show } from '@crowdship/std';
import type {
  ChargeDeclined,
  ChargeReceipt,
  FiatCharge,
  PaymentGateway,
} from '@crowdship/payments';
import { chargeReference, currency, fiatAmount } from '@crowdship/payments';
import Stripe from 'stripe';

/**
 * The slice of the Stripe SDK this binding actually calls — one method, named so
 * the seam to the vendor is exactly as wide as it needs to be and no wider
 * [LAW:decomposition]. A real `Stripe` instance satisfies this structurally, so
 * production passes one straight in; a test passes a stub with the same shape.
 * Typing it against the SDK's own `PaymentIntentCreateParams`/`RequestOptions`/
 * `PaymentIntent` means the compiler checks this translation against Stripe's real
 * API surface — a drift in what Stripe expects is a type error here, not a runtime
 * surprise in production [LAW:types-are-the-program].
 */
export interface StripeChargeClient {
  readonly paymentIntents: {
    create(
      params: Stripe.PaymentIntentCreateParams,
      options?: Stripe.RequestOptions,
    ): Promise<Stripe.Response<Stripe.PaymentIntent>>;
  };
}

// Stripe carries an amount as a JS `number` of minor units; our `FiatAmount` is a
// bigint so a fractional or float-rounded amount is unrepresentable. The bridge is
// safe for every real charge — but a value past the safe-integer ceiling would lose
// precision on the way to Stripe, so it halts loudly rather than charging a silently
// wrong number [LAW:no-silent-failure].
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const toStripeAmount = (amount: bigint): number => {
  if (amount > MAX_SAFE) throw new Error(`charge amount exceeds Stripe's safe-integer ceiling: ${amount}`);
  return Number(amount);
};

// Re-brand a value Stripe reports back through the payments vocabulary's own
// constructor — the single authority on these invariants [LAW:single-enforcer]. A
// value that fails to re-validate is not a charge outcome a caller handles; it is
// Stripe disagreeing with a guarantee its own `succeeded` status implies (a blank
// id, a non-positive captured amount), so it halts loudly [LAW:no-silent-failure].
const recover = <T>(result: Result<T, unknown>, what: string): T => {
  if (!result.ok) throw new Error(`stripe charge: ${what}: ${show(result.error)}`);
  return result.value;
};

// The receipt reports what Stripe ACTUALLY captured, never an echo of the request:
// `amount_received` and the intent's own `currency` are the source of truth a
// partial capture or currency normalization would diverge from [LAW:one-source-of-truth].
const receiptOf = (intent: Stripe.PaymentIntent): ChargeReceipt => ({
  reference: recover(chargeReference(intent.id), 'blank charge reference'),
  amount: recover(fiatAmount(BigInt(intent.amount_received)), 'non-positive captured amount'),
  currency: recover(currency(intent.currency), 'blank currency'),
});

// A decline read off a settled intent (the card refused without the SDK throwing):
// surface Stripe's own reason for display, falling back through the fields it may
// populate so the backer is never shown an empty refusal.
const declinedFrom = (error: Stripe.PaymentIntent.LastPaymentError | null): ChargeDeclined => ({
  kind: 'declined',
  reason: error?.decline_code ?? error?.code ?? error?.message ?? 'card_declined',
});

/**
 * The production payment gateway: a thin adapter over Stripe behind the
 * {@link PaymentGateway} seam [LAW:locality-or-seam]. It is to
 * `createInMemoryPaymentGateway` exactly what `TigerBeetleLedger` is to the
 * in-memory ledger — a different INSTANCE of one type, swapped in with no on-ramp
 * caller change [LAW:one-type-per-behavior]. It only translates the domain charge
 * into Stripe's vocabulary and Stripe's answer back; Stripe is the single source of
 * truth for whether money moved and the single enforcer of charge-idempotency, and
 * this adapter never re-derives or second-guesses either [LAW:single-enforcer].
 *
 * Idempotency is delegated, not reimplemented: the domain `ChargeKey` is passed as
 * Stripe's `Idempotency-Key`, so a retry under the same key charges the card at most
 * once and replays the first outcome — including a decline. That delegation is the
 * whole basis of the on-ramp's "no completion log" guarantee, so it is the one wiring
 * this binding must never get wrong.
 *
 * The request is deliberately constrained — confirm a tokenized instrument
 * synchronously — so Stripe's seven-value status space collapses to the two outcomes
 * the {@link PaymentGateway} models: `succeeded` becomes a receipt, a refused card
 * becomes `declined`. A `gateway-unavailable` covers Stripe being unreachable or
 * erroring on its side; both are retryable under the same key. Any status that is
 * neither settled nor a clean refusal — an interactive SCA step, async processing —
 * means a flow this v1 binding does not yet model was reached, so it halts loudly
 * rather than guessing an outcome for money [LAW:no-silent-failure]; supporting those
 * flows is a follow-up that grows the outcome type, not a branch that hides here.
 */
export const createStripePaymentGateway = (client: StripeChargeClient): PaymentGateway => {
  const charge = async (charge: FiatCharge): Promise<Result<ChargeReceipt, ChargeDeclined>> => {
    let intent: Stripe.PaymentIntent;
    try {
      intent = await client.paymentIntents.create(
        {
          amount: toStripeAmount(charge.amount),
          // Stripe denominates in lowercase ISO-4217; the domain currency is opaque,
          // so normalize case here at the vendor boundary [LAW:single-enforcer].
          currency: charge.currency.toLowerCase(),
          payment_method: charge.method,
          confirm: true,
        },
        // THE wiring the whole on-ramp's idempotency rests on: the domain charge key
        // becomes Stripe's idempotency key, one charge per key, first outcome replayed.
        { idempotencyKey: charge.key },
      );
    } catch (cause) {
      return mapThrown(cause);
    }

    if (intent.status === 'succeeded') return ok(receiptOf(intent));
    if (intent.status === 'requires_payment_method') return err(declinedFrom(intent.last_payment_error));
    // A status that confirming a tokenized instrument should never yield. Not a money
    // outcome — a flow the binding does not model — so it is surfaced, never swallowed.
    throw new Error(`stripe charge: unsupported payment-intent status '${intent.status}' for key ${charge.key}`);
  };

  return { charge };
};

// Stripe rejects the create call with a typed error. A card refusal is a `declined`
// outcome; an unreachable or server-erroring Stripe is `gateway-unavailable`, the
// retryable arm. Anything else — an invalid request, a bad key, a misused
// idempotency key — is this binding's or its caller's bug, not a charge outcome, so
// it is rethrown loudly rather than disguised as a payment failure [LAW:no-silent-failure].
const mapThrown = (cause: unknown): Result<ChargeReceipt, ChargeDeclined> => {
  if (cause instanceof Stripe.errors.StripeCardError) {
    return err({ kind: 'declined', reason: cause.decline_code || cause.code || cause.message || 'card_declined' });
  }
  if (
    cause instanceof Stripe.errors.StripeConnectionError ||
    cause instanceof Stripe.errors.StripeAPIError ||
    cause instanceof Stripe.errors.StripeRateLimitError
  ) {
    return err({ kind: 'gateway-unavailable' });
  }
  throw cause;
};
