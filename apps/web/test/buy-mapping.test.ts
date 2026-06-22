import type { OnRampOutcome } from '@crowdship/on-ramp';
import type { PurchaseOutcome } from '@crowdship/purchase';
import { describe, expect, it } from 'vitest';

import { coinPurchaseAmount, toFundResult, toSpendResult } from '../src/server/buy-mapping';

// The mappers read only the discriminant (and, for charge-refused, the ledger
// error kind); fabricating outcomes with just those fields keeps the test on the
// PROJECTION contract — which money truth each domain arm becomes — not on the
// shape of receipts the mapper never touches [LAW:behavior-not-structure].
const purchase = (o: Partial<PurchaseOutcome> & { kind: PurchaseOutcome['kind'] }): PurchaseOutcome =>
  o as unknown as PurchaseOutcome;
const onramp = (o: { kind: OnRampOutcome['kind'] }): OnRampOutcome => o as unknown as OnRampOutcome;

describe('toSpendResult — purchase outcome projected to the surface', () => {
  it('carries the balance through on a fired purchase', () => {
    expect(toSpendResult(purchase({ kind: 'fired' }), 900)).toEqual({ kind: 'fired', balance: 900 });
  });

  it('reports an idempotent replay as already-applied', () => {
    expect(toSpendResult(purchase({ kind: 'already-applied' }), 900)).toEqual({
      kind: 'already-applied',
      balance: 900,
    });
  });

  it('maps a would-overdraft refusal to the everyday insufficient-coins case', () => {
    const outcome = purchase({ kind: 'charge-refused', error: { kind: 'would-overdraft' } as never });
    expect(toSpendResult(outcome, 10)).toEqual({ kind: 'insufficient-coins', balance: 10 });
  });

  it('keeps a non-overdraft ledger refusal distinct — never dressed up as insufficient coins', () => {
    const outcome = purchase({ kind: 'charge-refused', error: { kind: 'idempotency-key-reused' } as never });
    expect(toSpendResult(outcome, 10)).toEqual({ kind: 'charge-refused', balance: 10 });
  });

  it('preserves effect-failed as its own loud arm — coins moved, effect did not fire', () => {
    expect(toSpendResult(purchase({ kind: 'effect-failed' }), 800)).toEqual({
      kind: 'effect-failed',
      balance: 800,
    });
  });

  it('carries an invalid-charge through', () => {
    expect(toSpendResult(purchase({ kind: 'invalid-charge' }), 900)).toEqual({
      kind: 'invalid-charge',
      balance: 900,
    });
  });
});

describe('coinPurchaseAmount — untrusted wire amount parsed at the boundary', () => {
  it('accepts a positive whole number as an exact coin count', () => {
    expect(coinPurchaseAmount(500)).toBe(500n);
  });

  it('rejects zero and negatives — no money can be bought with them', () => {
    expect(coinPurchaseAmount(0)).toBeNull();
    expect(coinPurchaseAmount(-5)).toBeNull();
  });

  it('rejects a fraction rather than letting BigInt throw', () => {
    expect(coinPurchaseAmount(1.5)).toBeNull();
  });

  it('rejects NaN, Infinity, and magnitudes past safe-integer precision', () => {
    expect(coinPurchaseAmount(Number.NaN)).toBeNull();
    expect(coinPurchaseAmount(Number.POSITIVE_INFINITY)).toBeNull();
    expect(coinPurchaseAmount(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });
});

describe('toFundResult — on-ramp outcome projected to the surface', () => {
  it('carries the balance through on a purchase', () => {
    expect(toFundResult(onramp({ kind: 'purchased' }), 1500)).toEqual({ kind: 'purchased', balance: 1500 });
  });

  it('reports a declined charge — no money moved', () => {
    expect(toFundResult(onramp({ kind: 'charge-declined' }), 0)).toEqual({ kind: 'charge-declined', balance: 0 });
  });

  it('keeps credit-refused distinct from a decline — money in, no coins (loud reconciliation)', () => {
    expect(toFundResult(onramp({ kind: 'credit-refused' }), 0)).toEqual({ kind: 'credit-refused', balance: 0 });
  });
});
