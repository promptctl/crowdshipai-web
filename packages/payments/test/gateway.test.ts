import type { Result } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  chargeKey,
  createInMemoryPaymentGateway,
  currency,
  fiatAmount,
  paymentMethod,
  type ChargeDeclined,
  type FiatCharge,
} from '../src/index.js';

/** Unwrap a successful result or fail loudly — never let an error slip past a
 *  truthiness check [LAW:no-silent-failure]. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

/** A USD charge of `amount` minor units on a test card, keyed by `k`. */
const usd = (amount: bigint, k: string): FiatCharge => ({
  amount: must(fiatAmount(amount)),
  currency: must(currency('USD')),
  method: must(paymentMethod('pm_test_card')),
  key: must(chargeKey(k)),
});

describe('fiat money primitives reject the meaningless at the boundary', () => {
  it('rejects a zero or negative charge — you cannot take nothing', () => {
    expect(fiatAmount(0n)).toEqual({ ok: false, error: { kind: 'not-positive', value: 0n } });
    expect(fiatAmount(-100n)).toEqual({ ok: false, error: { kind: 'not-positive', value: -100n } });
    expect(must(fiatAmount(2500n))).toBe(2500n);
  });

  it('rejects a blank currency, method, or key, naming which field was blank', () => {
    expect(currency('   ')).toEqual({ ok: false, error: { kind: 'blank', label: 'currency' } });
    expect(paymentMethod('')).toEqual({ ok: false, error: { kind: 'blank', label: 'paymentMethod' } });
    expect(chargeKey(' ')).toEqual({ ok: false, error: { kind: 'blank', label: 'chargeKey' } });
  });
});

describe('the in-memory gateway takes money idempotently per charge key', () => {
  it('charges a fresh key and returns the exact amount and currency it took', async () => {
    const gateway = createInMemoryPaymentGateway();
    const charged = await gateway.charge(usd(2500n, 'buy-1'));

    expect(charged.ok).toBe(true);
    if (!charged.ok) throw new Error('unreachable');
    expect(charged.value.amount).toBe(2500n);
    expect(String(charged.value.currency)).toBe('USD');
    expect(String(charged.value.reference)).toBe('psp-ref:buy-1');
  });

  it('replays the first receipt under the same key — the card is charged once, never twice', async () => {
    // The idempotency tripwire: a repeated charge under one key reproduces the first
    // result and takes no more money. Proven hard by flipping the gateway to decline
    // EVERYTHING on the retry — the replayed success must win, because the charge
    // already happened and is not re-decided [LAW:one-source-of-truth].
    let declineEverything = false;
    const gateway = createInMemoryPaymentGateway(() =>
      declineEverything ? { kind: 'declined', reason: 'should never be consulted on replay' } : undefined,
    );

    const first = await gateway.charge(usd(2500n, 'same-key'));
    declineEverything = true;
    const retry = await gateway.charge(usd(2500n, 'same-key'));

    expect(retry).toEqual(first); // the identical receipt, replayed verbatim
  });

  it('declines per policy and never records a receipt for money it did not take', async () => {
    const declined: ChargeDeclined = { kind: 'declined', reason: 'insufficient_funds' };
    const gateway = createInMemoryPaymentGateway(() => declined);

    const charged = await gateway.charge(usd(2500n, 'broke'));
    expect(charged).toEqual({ ok: false, error: declined });
  });

  it('surfaces an unreachable gateway as the retryable arm, replayed under the same key', async () => {
    const gateway = createInMemoryPaymentGateway(() => ({ kind: 'gateway-unavailable' }));

    const first = await gateway.charge(usd(2500n, 'flaky'));
    const retry = await gateway.charge(usd(2500n, 'flaky'));

    expect(first).toEqual({ ok: false, error: { kind: 'gateway-unavailable' } });
    expect(retry).toEqual(first);
  });

  it('lets exactly one of many concurrent same-key charges take the money', async () => {
    // The fake records by key synchronously, so a burst of identical retries all
    // resolve to one stored outcome — no concurrent double-charge, no lock needed.
    const gateway = createInMemoryPaymentGateway();
    const attempts = Array.from({ length: 20 }, () => gateway.charge(usd(2500n, 'one-key')));
    const outcomes = await Promise.all(attempts);

    const first = outcomes[0];
    expect(first?.ok).toBe(true);
    for (const o of outcomes) expect(o).toEqual(first); // all identical, one charge
  });
});
