import {
  chargeKey,
  currency,
  fiatAmount,
  paymentMethod,
  type FiatCharge,
} from '@crowdship/payments';
import type { Result } from '@crowdship/std';
import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import { createStripePaymentGateway, type StripeChargeClient } from '../src/index.js';

/** Unwrap a constructor result or fail loudly — a blank/zero test input is a broken
 *  test, never a silent skip [LAW:no-silent-failure]. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

/** A USD charge of `amount` minor units on a tokenized card, idempotent under `k`. */
const usdCharge = (amount: bigint, k: string): FiatCharge => ({
  amount: must(fiatAmount(amount)),
  currency: must(currency('USD')),
  method: must(paymentMethod('pm_test_card')),
  key: must(chargeKey(k)),
});

/**
 * A minimal Stripe PaymentIntent for the stub to return. The binding reads only a
 * handful of fields; the rest of Stripe's large shape is irrelevant to this
 * translation, so it is filled by the cast rather than spelled out — scaffolding,
 * confined to the test, never the production path.
 */
const intent = (over: Partial<Stripe.PaymentIntent>): Stripe.Response<Stripe.PaymentIntent> =>
  ({ object: 'payment_intent', last_payment_error: null, ...over }) as unknown as Stripe.Response<Stripe.PaymentIntent>;

interface Recorded {
  readonly params: Stripe.PaymentIntentCreateParams;
  readonly options: Stripe.RequestOptions | undefined;
}

/** A stub Stripe client that records every create call and answers via `respond`,
 *  so a test can both assert what the binding SENT and control what Stripe RETURNS. */
const stubClient = (
  respond: (params: Stripe.PaymentIntentCreateParams) => Promise<Stripe.Response<Stripe.PaymentIntent>>,
): { client: StripeChargeClient; calls: Recorded[] } => {
  const calls: Recorded[] = [];
  const client: StripeChargeClient = {
    paymentIntents: {
      create: (params, options) => {
        calls.push({ params, options });
        return respond(params);
      },
    },
  };
  return { client, calls };
};

describe('the Stripe payment gateway binding', () => {
  it('charges a confirmed payment intent and reports what Stripe ACTUALLY captured', async () => {
    // amount_received differs from the requested amount on purpose: the receipt must
    // carry what Stripe captured, never an echo of the request [LAW:one-source-of-truth].
    const { client, calls } = stubClient(() =>
      Promise.resolve(intent({ id: 'pi_123', amount: 2500, amount_received: 2400, currency: 'usd', status: 'succeeded' })),
    );
    const gateway = createStripePaymentGateway(client);

    const result = await gateway.charge(usdCharge(2500n, 'chg-1'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.reference).toBe('pi_123');
    expect(result.value.amount).toBe(2400n); // the captured figure, not the requested 2500
    expect(result.value.currency).toBe('usd');

    // The wiring the whole on-ramp's idempotency rests on: the ChargeKey is Stripe's
    // idempotency key, the amount is the requested minor units, currency lowercased.
    const call = calls[0];
    if (call === undefined) throw new Error('the gateway never called Stripe');
    expect(call.options?.idempotencyKey).toBe('chg-1');
    expect(call.params.amount).toBe(2500);
    expect(call.params.currency).toBe('usd');
    expect(call.params.payment_method).toBe('pm_test_card');
    expect(call.params.confirm).toBe(true);
  });

  it('reports a refused card settled into the intent as declined, with Stripe’s reason', async () => {
    const { client } = stubClient(() =>
      Promise.resolve(
        intent({
          id: 'pi_dead',
          status: 'requires_payment_method',
          last_payment_error: { decline_code: 'insufficient_funds' } as Stripe.PaymentIntent.LastPaymentError,
        }),
      ),
    );
    const gateway = createStripePaymentGateway(client);

    const result = await gateway.charge(usdCharge(2500n, 'chg-broke'));

    expect(result).toEqual({ ok: false, error: { kind: 'declined', reason: 'insufficient_funds' } });
  });

  it('maps a thrown card error to declined, carrying its decline code', async () => {
    const { client } = stubClient(() =>
      Promise.reject(
        new Stripe.errors.StripeCardError({
          type: 'card_error',
          message: 'Your card was declined.',
          code: 'card_declined',
          decline_code: 'do_not_honor',
        }),
      ),
    );
    const gateway = createStripePaymentGateway(client);

    const result = await gateway.charge(usdCharge(2500n, 'chg-thrown-decline'));

    expect(result).toEqual({ ok: false, error: { kind: 'declined', reason: 'do_not_honor' } });
  });

  it('always carries a displayable decline reason, even when Stripe populates none', async () => {
    // Both decline paths uphold one invariant — a refusal is never shown blank — so a
    // card error stripped of every reason field still resolves to a stable code.
    const { client } = stubClient(() =>
      Promise.reject(new Stripe.errors.StripeCardError({ type: 'card_error', message: '' })),
    );
    const gateway = createStripePaymentGateway(client);

    const result = await gateway.charge(usdCharge(2500n, 'chg-blank-reason'));

    expect(result).toEqual({ ok: false, error: { kind: 'declined', reason: 'card_declined' } });
  });

  it('maps an unreachable or server-erroring Stripe to the retryable gateway-unavailable arm', async () => {
    const transient: Stripe.errors.StripeError[] = [
      new Stripe.errors.StripeConnectionError({ message: 'network down' }),
      new Stripe.errors.StripeAPIError({ type: 'api_error', message: 'stripe 500' }),
      new Stripe.errors.StripeRateLimitError({ type: 'rate_limit_error', message: 'slow down' }),
    ];

    for (const error of transient) {
      const { client } = stubClient(() => Promise.reject(error));
      const gateway = createStripePaymentGateway(client);

      const result = await gateway.charge(usdCharge(2500n, 'chg-transient'));

      expect(result).toEqual({ ok: false, error: { kind: 'gateway-unavailable' } });
    }
  });

  it('rethrows a bug-class Stripe error rather than disguising it as a charge failure', async () => {
    // A bad request or a misused idempotency key is the binding’s or caller’s fault,
    // not the card’s — swallowing it as a decline would send a reconciler down the
    // wrong path [LAW:no-silent-failure].
    const bugs: Stripe.errors.StripeError[] = [
      new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', message: 'no such payment_method' }),
      new Stripe.errors.StripeAuthenticationError({ type: 'authentication_error', message: 'bad api key' }),
      new Stripe.errors.StripeIdempotencyError({ type: 'idempotency_error', message: 'key reused with different params' }),
    ];

    for (const bug of bugs) {
      const { client } = stubClient(() => Promise.reject(bug));
      const gateway = createStripePaymentGateway(client);

      await expect(gateway.charge(usdCharge(2500n, 'chg-bug'))).rejects.toThrow();
    }
  });

  it('halts loudly on a payment-intent status it does not model rather than guess an outcome for money', async () => {
    // requires_action (an interactive SCA step) is neither settled nor a clean refusal;
    // the v1 binding does not model it, so it must surface, never be coerced.
    const { client } = stubClient(() =>
      Promise.resolve(intent({ id: 'pi_sca', status: 'requires_action' })),
    );
    const gateway = createStripePaymentGateway(client);

    await expect(gateway.charge(usdCharge(2500n, 'chg-sca'))).rejects.toThrow(/requires_action/);
  });

  it('refuses to charge an amount past Stripe’s safe-integer ceiling rather than lose precision silently', async () => {
    const { client, calls } = stubClient(() =>
      Promise.resolve(intent({ id: 'pi_big', amount_received: 1, currency: 'usd', status: 'succeeded' })),
    );
    const gateway = createStripePaymentGateway(client);
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + 1n;

    await expect(gateway.charge(usdCharge(huge, 'chg-huge'))).rejects.toThrow(/safe-integer/);
    expect(calls).toHaveLength(0); // never reached Stripe — no money risked on a bad number
  });
});
