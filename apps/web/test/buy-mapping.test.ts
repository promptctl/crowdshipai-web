import { accountId, coinAmount, transactionReason, type AccountId } from '@crowdship/ledger-kernel';
import type { OnRampOutcome } from '@crowdship/on-ramp';
import type { PurchaseOutcome } from '@crowdship/purchase';
import type { SettlementEvent } from '@crowdship/settlement-feed';
import { timestamp } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  coinPurchaseAmount,
  toFundResult,
  toSettlementView,
  toSpendResult,
  type SettlementPartyLabels,
} from '../src/server/buy-mapping';

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

// Real branded values, not casts: the mapper's contract includes projecting brands and
// bigints to plain primitives, so the test feeds it exactly what the projection emits.
const must = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};
const account = (raw: string): AccountId => must(accountId(raw));
const settlementEvent = (
  e: Partial<SettlementEvent> & { kind: SettlementEvent['kind'] },
): SettlementEvent =>
  ({
    amount: must(coinAmount(20n)),
    pooledAfter: 20n,
    reason: must(transactionReason('pool-contribution')),
    at: must(timestamp(1_700_000_000_000)),
    ...e,
  }) as SettlementEvent;

const labels: SettlementPartyLabels = {
  backer: (a) => `label-of:${String(a)}`,
  builder: 'ffmpeg-witch',
  platform: 'CrowdShip',
};

describe('toSettlementView — a projected settlement event crossed to the surface', () => {
  it('maps a contribution with the backer’s public label and the live pooled-after ticker', () => {
    const view = toSettlementView(
      { poolTitle: 'add HDR', event: settlementEvent({ kind: 'contribution', backer: account('wallet:ami') }) },
      labels,
    );
    expect(view).toEqual({
      kind: 'contribution',
      party: 'label-of:wallet:ami',
      amountCoins: 20,
      pooledAfterCoins: 20,
      poolTitle: 'add HDR',
      atMs: 1_700_000_000_000,
    });
  });

  it('maps a release to the builder and a cut to the platform under their fixed labels', () => {
    const release = toSettlementView(
      {
        poolTitle: 'add HDR',
        event: settlementEvent({ kind: 'release', builder: account('builder:ffmpeg-witch'), pooledAfter: 6n }),
      },
      labels,
    );
    expect(release).toMatchObject({ kind: 'release', party: 'ffmpeg-witch', pooledAfterCoins: 6 });

    const cut = toSettlementView(
      {
        poolTitle: 'add HDR',
        event: settlementEvent({ kind: 'cut', platform: account('platform-revenue'), pooledAfter: 0n }),
      },
      labels,
    );
    expect(cut).toMatchObject({ kind: 'cut', party: 'CrowdShip', pooledAfterCoins: 0 });
  });

  it('maps a refund back to the backer’s public label — the failure mode shown as plainly as the success', () => {
    const view = toSettlementView(
      { poolTitle: 'add HDR', event: settlementEvent({ kind: 'refund', backer: account('wallet:ben'), pooledAfter: 0n }) },
      labels,
    );
    expect(view).toMatchObject({ kind: 'refund', party: 'label-of:wallet:ben', pooledAfterCoins: 0 });
  });
});
