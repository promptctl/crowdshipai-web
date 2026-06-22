import { createInMemoryLedger, type Ledger } from '@crowdship/ledger';
import {
  accountId,
  coinAmount,
  idempotencyKey,
  transactionReason,
  transfer,
  type Account,
  type AccountId,
  type CoinAmount,
  type IdempotencyKey,
  type Result,
  type TransactionReason,
} from '@crowdship/ledger-kernel';
import {
  dispatchingPerformer,
  effectKind,
  offerId,
  type Effect,
  type EffectHandler,
  type EffectKind,
  type EffectPerformer,
  type JsonValue,
  type PricedOffer,
} from '@crowdship/menu';
import { describe, expect, it } from 'vitest';

import { createInMemoryPurchaseLog, createPurchaser, type PurchaseRequest } from '../src/index.js';

/** Unwrap a successful result or fail loudly — never let a falsy value or an error
 *  slip past a truthiness check [LAW:no-silent-failure]. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const coins = (n: bigint): CoinAmount => must(coinAmount(n));
const acc = (s: string): AccountId => must(accountId(s));
const key = (s: string): IdempotencyKey => must(idempotencyKey(s));
const reason = (s: string): TransactionReason => must(transactionReason(s));
const account = (id: AccountId, kind: Account['kind']): Account => ({ id, kind });

const MINT = acc('mint');
const BACKER = acc('backer');
const BUILDER = acc('builder');

/** A funded world: mint, backer (holding `funded` coins), and builder, behind one
 *  in-memory ledger. The fixtures supply real coins so a purchase moves real value. */
const fundedLedger = async (funded: bigint): Promise<Ledger> => {
  const ledger = createInMemoryLedger();
  must(await ledger.openAccount(account(MINT, 'mint')));
  must(await ledger.openAccount(account(BACKER, 'user-wallet')));
  must(await ledger.openAccount(account(BUILDER, 'user-wallet')));
  must(await ledger.post({ transfers: [must(transfer(MINT, BACKER, coins(funded)))], reason: reason('mint'), idempotencyKey: key('mint-fund') }));
  return ledger;
};

/** A priced offer carrying an effect of `kind`, failing loudly on bad fixture input. */
const offer = (id: string, price: bigint, kind: string, params: JsonValue): PricedOffer => ({
  id: must(offerId(id)),
  price: coins(price),
  effect: { kind: must(effectKind(kind)), params },
});

/** A performer whose every handler records that it ran, so a test can prove an
 *  effect fired exactly once (or never) across retries and across instances. */
const countingPerformer = (
  kinds: readonly string[],
): { performer: EffectPerformer; fires: () => readonly Effect[] } => {
  const fired: Effect[] = [];
  const record: EffectHandler = async (e) => {
    fired.push(e);
    return { ok: true, value: { ack: e.kind } };
  };
  const handlers = new Map<EffectKind, EffectHandler>(kinds.map((k) => [must(effectKind(k)), record]));
  return { performer: dispatchingPerformer(handlers), fires: () => fired };
};

const buyRequest = (o: PricedOffer, k: string): PurchaseRequest => ({
  offer: o,
  payer: BACKER,
  payee: BUILDER,
  idempotencyKey: key(k),
  reason: reason(`buy:${o.id}`),
});

describe('purchase-to-fire: one path posts coins then fires the effect', () => {
  it('moves coins and fires the effect once on a fresh buy', async () => {
    const ledger = await fundedLedger(100n);
    const { performer, fires } = countingPerformer(['shoutout']);
    const purchaser = createPurchaser(ledger, performer, createInMemoryPurchaseLog());

    const o = offer('o-shout', 50n, 'shoutout', { message: 'gm builders' });
    const outcome = await purchaser.buy(buyRequest(o, 'buy-1'));

    expect(outcome.kind).toBe('fired');
    if (outcome.kind !== 'fired') throw new Error('unreachable');
    expect(outcome.effect).toEqual({ ack: 'shoutout' });
    // The coins actually moved: backer down 50, builder up 50.
    expect(await ledger.balanceOf(BACKER)).toBe(50n);
    expect(await ledger.balanceOf(BUILDER)).toBe(50n);
    // The effect fired exactly once, carrying the offer's own params to the edge.
    expect(fires()).toHaveLength(1);
    expect(fires()[0]?.params).toEqual({ message: 'gm builders' });
  });

  it('a faithful retry replays the recorded result without charging or firing twice', async () => {
    // The idempotency tripwire for the happy path: a completed purchase, retried under
    // its key, reproduces the first result — one charge, one effect.
    const ledger = await fundedLedger(100n);
    const { performer, fires } = countingPerformer(['shoutout']);
    const purchaser = createPurchaser(ledger, performer, createInMemoryPurchaseLog());

    const o = offer('o-shout', 50n, 'shoutout', { message: 'lfg' });
    const first = await purchaser.buy(buyRequest(o, 'same-key'));
    const retry = await purchaser.buy(buyRequest(o, 'same-key'));

    expect(first.kind).toBe('fired');
    expect(retry.kind).toBe('already-applied');
    if (retry.kind !== 'already-applied') throw new Error('unreachable');
    expect(retry.effect).toEqual({ ack: 'shoutout' }); // the original effect receipt, replayed
    // Charged once (not twice), and the effect fired once (not twice).
    expect(await ledger.balanceOf(BACKER)).toBe(50n);
    expect(await ledger.balanceOf(BUILDER)).toBe(50n);
    expect(fires()).toHaveLength(1);
  });

  it('replays a falsy effect receipt intact on already-applied — a null receipt is a real completion', async () => {
    // EffectReceipt is JsonValue, so null/0/false/'' are valid receipts. The completion
    // is the always-truthy record that *carries* the falsy receipt, so a retry must
    // return already-applied with the receipt intact — never misread null as "not done"
    // and re-fire a paid effect [LAW:no-silent-failure].
    const ledger = await fundedLedger(100n);
    const handlers = new Map<EffectKind, EffectHandler>([
      [must(effectKind('quiet')), async () => ({ ok: true, value: null })],
    ]);
    const purchaser = createPurchaser(ledger, dispatchingPerformer(handlers), createInMemoryPurchaseLog());

    const o = offer('o-quiet', 15n, 'quiet', null);
    const first = await purchaser.buy(buyRequest(o, 'quiet-key'));
    const retry = await purchaser.buy(buyRequest(o, 'quiet-key'));

    expect(first).toMatchObject({ kind: 'fired', effect: null });
    expect(retry.kind).toBe('already-applied');
    if (retry.kind !== 'already-applied') throw new Error('unreachable');
    expect(retry.effect).toBe(null); // the falsy receipt survived the replay
    expect(await ledger.balanceOf(BUILDER)).toBe(15n); // charged once
  });

  it('refuses the buy and fires nothing when the charge would overdraft', async () => {
    const ledger = await fundedLedger(10n); // backer holds 10, offer costs 50
    const { performer, fires } = countingPerformer(['shoutout']);
    const purchaser = createPurchaser(ledger, performer, createInMemoryPurchaseLog());

    const o = offer('o-shout', 50n, 'shoutout', { message: 'too rich for me' });
    const outcome = await purchaser.buy(buyRequest(o, 'broke'));

    expect(outcome.kind).toBe('charge-refused');
    if (outcome.kind !== 'charge-refused') throw new Error('unreachable');
    expect(outcome.error).toEqual({ kind: 'would-overdraft', account: BACKER });
    // No coins moved and, crucially, no effect fired for an unpaid offer.
    expect(await ledger.balanceOf(BACKER)).toBe(10n);
    expect(fires()).toHaveLength(0);
  });

  it('surfaces a paid-but-unfired buy as effect-failed carrying the receipt to reconcile', async () => {
    // The loudest case: the backer's coins moved but the effect never fired (here,
    // the kind has no handler). The money is OUT — the outcome must carry the receipt
    // so a reconciler can refund or retry, never swallow it.
    const ledger = await fundedLedger(100n);
    const { performer, fires } = countingPerformer([]); // no kind registered
    const purchaser = createPurchaser(ledger, performer, createInMemoryPurchaseLog());

    const o = offer('o-mystery', 30n, 'kind-with-no-handler', null);
    const outcome = await purchaser.buy(buyRequest(o, 'orphaned-effect'));

    expect(outcome.kind).toBe('effect-failed');
    if (outcome.kind !== 'effect-failed') throw new Error('unreachable');
    expect(outcome.error).toEqual({ kind: 'unknown-effect-kind', effectKind: 'kind-with-no-handler' });
    // The coins really moved — that is the whole reason this needs reconciling.
    expect(await ledger.balanceOf(BACKER)).toBe(70n);
    expect(await ledger.balanceOf(BUILDER)).toBe(30n);
    expect(outcome.receipt.balances.get(BUILDER)).toBe(30n);
    expect(fires()).toHaveLength(0);
  });

  it('re-fires a paid-but-unfired effect on retry once the edge recovers — the charge never doubles', async () => {
    // The reconciliation path end to end: the first buy charges the backer but the
    // overlay is down, so the effect fails (effect-failed, NOT recorded as complete).
    // The overlay recovers; a faithful retry under the same key replays the (single)
    // charge and fires the effect for the first time. Coins moved once; effect once.
    const ledger = await fundedLedger(100n);
    const log = createInMemoryPurchaseLog();
    const o = offer('o-shout', 40n, 'shoutout', { message: 'finally' });

    const down = createPurchaser(ledger, dispatchingPerformer(new Map()), log); // no handler
    const downOutcome = await down.buy(buyRequest(o, 'recoverable'));
    expect(downOutcome.kind).toBe('effect-failed');
    expect(await ledger.balanceOf(BACKER)).toBe(60n); // already charged

    const { performer, fires } = countingPerformer(['shoutout']); // overlay back online
    const up = createPurchaser(ledger, performer, log); // SAME ledger and SAME log
    const upOutcome = await up.buy(buyRequest(o, 'recoverable'));

    expect(upOutcome.kind).toBe('fired');
    expect(fires()).toHaveLength(1); // fired exactly once, on the recovery
    expect(await ledger.balanceOf(BACKER)).toBe(60n); // still charged exactly once, not 20 more
    expect(await ledger.balanceOf(BUILDER)).toBe(40n);
  });

  it("surfaces a handler that fails as effect-failed with the edge's own detail", async () => {
    const ledger = await fundedLedger(100n);
    const handlers = new Map<EffectKind, EffectHandler>([
      [must(effectKind('flaky')), async () => ({ ok: false, error: { reason: 'overlay-offline' } })],
    ]);
    const purchaser = createPurchaser(ledger, dispatchingPerformer(handlers), createInMemoryPurchaseLog());

    const o = offer('o-flaky', 20n, 'flaky', null);
    const outcome = await purchaser.buy(buyRequest(o, 'flaky-buy'));

    expect(outcome.kind).toBe('effect-failed');
    if (outcome.kind !== 'effect-failed') throw new Error('unreachable');
    expect(outcome.error).toEqual({
      kind: 'handler-error',
      effectKind: 'flaky',
      detail: { reason: 'overlay-offline' },
    });
    expect(await ledger.balanceOf(BUILDER)).toBe(20n); // money still moved
  });

  it('rejects a payer that is also the payee as an unformable charge', async () => {
    const ledger = await fundedLedger(100n);
    const { performer, fires } = countingPerformer(['shoutout']);
    const purchaser = createPurchaser(ledger, performer, createInMemoryPurchaseLog());

    const o = offer('o-self', 10n, 'shoutout', null);
    const outcome = await purchaser.buy({ ...buyRequest(o, 'self-pay'), payer: BACKER, payee: BACKER });

    expect(outcome.kind).toBe('invalid-charge');
    if (outcome.kind !== 'invalid-charge') throw new Error('unreachable');
    expect(outcome.error).toEqual({ kind: 'same-account', account: BACKER });
    expect(await ledger.balanceOf(BACKER)).toBe(100n); // nothing moved
    expect(fires()).toHaveLength(0);
  });

  it('lets exactly one of many concurrent same-key buys charge and fire', async () => {
    // The serializer's job: a burst of identical retries under one key must not both
    // read "not yet completed" and both fire. Exactly one charges and fires; the rest
    // see the recorded completion.
    const ledger = await fundedLedger(100n);
    const { performer, fires } = countingPerformer(['shoutout']);
    const purchaser = createPurchaser(ledger, performer, createInMemoryPurchaseLog());

    const o = offer('o-shout', 25n, 'shoutout', { message: 'storm' });
    const attempts = Array.from({ length: 20 }, () => purchaser.buy(buyRequest(o, 'one-key')));
    const outcomes = await Promise.all(attempts);

    expect(outcomes.filter((r) => r.kind === 'fired')).toHaveLength(1);
    expect(outcomes.filter((r) => r.kind === 'already-applied')).toHaveLength(19);
    expect(fires()).toHaveLength(1); // fired once across 20 concurrent attempts
    expect(await ledger.balanceOf(BACKER)).toBe(75n); // charged once, not 20×
    expect(await ledger.balanceOf(BUILDER)).toBe(25n);
  });

  it('fires a kind the platform never anticipated with no pipeline change — just a handler entry', async () => {
    // The anti-catalog tripwire, end to end: 'summon-a-dragon' is in no enum. It rides
    // the very same buy path as a shoutout, proving the variety is data, not branches.
    const ledger = await fundedLedger(9001n);
    const { performer, fires } = countingPerformer(['summon-a-dragon']);
    const purchaser = createPurchaser(ledger, performer, createInMemoryPurchaseLog());

    const o = offer('o-dragon', 9000n, 'summon-a-dragon', { color: 'green', hp: 9000 });
    const outcome = await purchaser.buy(buyRequest(o, 'here-be-dragons'));

    expect(outcome.kind).toBe('fired');
    expect(fires()).toHaveLength(1);
    expect(fires()[0]?.params).toEqual({ color: 'green', hp: 9000 });
    expect(await ledger.balanceOf(BUILDER)).toBe(9000n);
  });
});
