import { createInMemoryPaymentGateway, type PaymentGateway } from '@crowdship/payments';
import { describe, expect, it } from 'vitest';

import { createCoinOnRamp } from '../src/index.js';
import { buyRequest, MINT, must, onRampLedger, WALLET } from './world.js';

describe('the on-ramp: fiat in, coins posted to the ledger', () => {
  it('charges the fiat and mints the coins to the wallet on a fresh buy', async () => {
    const ledger = await onRampLedger();
    const onRamp = createCoinOnRamp({ ledger, gateway: createInMemoryPaymentGateway(), mint: MINT });

    const outcome = await onRamp.buy(buyRequest(100n, 2500n, 'buy-1'));

    expect(outcome.kind).toBe('purchased');
    if (outcome.kind !== 'purchased') throw new Error('unreachable');
    expect(outcome.charge.amount).toBe(2500n); // the fiat actually taken
    // The coins really minted: the wallet holds 100, the mint is down 100 (coins in circulation).
    expect(await ledger.balanceOf(WALLET)).toBe(100n);
    expect(await ledger.balanceOf(MINT)).toBe(-100n);
    expect(outcome.receipt.balances.get(WALLET)).toBe(100n);
  });

  it('a faithful retry replays both receipts without charging or minting twice', async () => {
    // The idempotency tripwire: both movements are key-idempotent, so the WHOLE unit
    // is idempotent by construction — no completion log. A retry reproduces the first
    // result; the card is charged once and the mint moves once.
    const ledger = await onRampLedger();
    const onRamp = createCoinOnRamp({ ledger, gateway: createInMemoryPaymentGateway(), mint: MINT });

    const first = await onRamp.buy(buyRequest(100n, 2500n, 'same'));
    const retry = await onRamp.buy(buyRequest(100n, 2500n, 'same'));

    expect(first.kind).toBe('purchased');
    expect(retry.kind).toBe('purchased');
    if (first.kind !== 'purchased' || retry.kind !== 'purchased') throw new Error('unreachable');
    expect(retry.charge.reference).toEqual(first.charge.reference); // same charge, replayed
    expect(await ledger.balanceOf(WALLET)).toBe(100n); // minted once, not 200
    expect(await ledger.balanceOf(MINT)).toBe(-100n);
  });

  it('declines the buy and mints nothing when the PSP refuses the card', async () => {
    const ledger = await onRampLedger();
    const gateway = createInMemoryPaymentGateway(() => ({ kind: 'declined', reason: 'insufficient_funds' }));
    const onRamp = createCoinOnRamp({ ledger, gateway, mint: MINT });

    const outcome = await onRamp.buy(buyRequest(100n, 2500n, 'broke'));

    expect(outcome.kind).toBe('charge-declined');
    if (outcome.kind !== 'charge-declined') throw new Error('unreachable');
    expect(outcome.error).toEqual({ kind: 'declined', reason: 'insufficient_funds' });
    // No coins came from nowhere: the wallet is untouched and the mint never moved.
    expect(await ledger.balanceOf(WALLET)).toBe(0n);
    expect(await ledger.balanceOf(MINT)).toBe(0n);
  });

  it('surfaces a charged-but-uncredited buy as credit-refused carrying the charge to reconcile', async () => {
    // The loudest case: the fiat was taken but the coins would not post (here, the
    // wallet account was never opened). The money is IN — the outcome must carry the
    // charge receipt so a reconciler can refund or retry, never swallow it.
    const ledger = await onRampLedger(false); // wallet NOT opened
    const onRamp = createCoinOnRamp({ ledger, gateway: createInMemoryPaymentGateway(), mint: MINT });

    const outcome = await onRamp.buy(buyRequest(100n, 2500n, 'orphan'));

    expect(outcome.kind).toBe('credit-refused');
    if (outcome.kind !== 'credit-refused') throw new Error('unreachable');
    expect(outcome.error).toEqual({ kind: 'unknown-account', account: WALLET });
    expect(outcome.charge.amount).toBe(2500n); // the fiat really moved — that is why it must reconcile
    expect(await ledger.balanceOf(MINT)).toBe(0n); // no coins minted against the taken fiat
  });

  it('recovers a credit-refused buy under the SAME key once the wallet is opened — the card never doubles', async () => {
    // Reconciliation end to end, the on-ramp's realistic refusal: the wallet was not yet
    // opened, so the mint post is refused with unknown-account — which spends NO post key,
    // because no balance was ever touched. Recovery needs no fresh key: open the wallet and
    // retry the identical buy. The charge key is reused throughout, so the fiat is taken
    // exactly once across the whole arc. Fiat once, coins once.
    const ledger = await onRampLedger(false);
    const gateway = createInMemoryPaymentGateway();
    const onRamp = createCoinOnRamp({ ledger, gateway, mint: MINT });

    const refused = await onRamp.buy(buyRequest(100n, 2500n, 'recoverable'));
    expect(refused.kind).toBe('credit-refused');
    if (refused.kind !== 'credit-refused') throw new Error('unreachable');
    expect(refused.error.kind).toBe('unknown-account');

    // Retrying verbatim while the wallet is still missing is refused again — loudly, never a
    // silent success — but it does not poison the key for the eventual recovery.
    const stillMissing = await onRamp.buy(buyRequest(100n, 2500n, 'recoverable'));
    expect(stillMissing.kind).toBe('credit-refused');

    must(await ledger.openAccount({ id: WALLET, kind: 'user-wallet' })); // the wallet now exists
    const healed = await onRamp.buy(buyRequest(100n, 2500n, 'recoverable')); // SAME charge AND post key

    expect(healed.kind).toBe('purchased');
    if (healed.kind !== 'purchased') throw new Error('unreachable');
    expect(healed.charge.reference).toEqual(refused.charge.reference); // the same charge, replayed — no double charge
    expect(await ledger.balanceOf(WALLET)).toBe(100n); // minted once, on the recovery
    expect(await ledger.balanceOf(MINT)).toBe(-100n);
  });

  it('rejects mint-equals-wallet routing BEFORE any charge, so no fiat is taken', async () => {
    // A charge must never happen for a credit that can never be formed. The gateway
    // throws if consulted, so reaching the charge at all fails the test.
    const ledger = await onRampLedger();
    const neverCharge: PaymentGateway = {
      charge: () => {
        throw new Error('the gateway must not be charged for invalid routing');
      },
    };
    // Draw coins FROM the wallet INTO the wallet: an unformable same-account movement.
    const onRamp = createCoinOnRamp({ ledger, gateway: neverCharge, mint: WALLET });

    const outcome = await onRamp.buy(buyRequest(100n, 2500n, 'self'));

    expect(outcome.kind).toBe('invalid-routing');
    if (outcome.kind !== 'invalid-routing') throw new Error('unreachable');
    expect(outcome.error).toEqual({ kind: 'same-account', account: WALLET });
    expect(await ledger.balanceOf(WALLET)).toBe(0n); // nothing moved
  });

  it('lets a burst of concurrent same-key buys charge and mint exactly once — no log, no lock', async () => {
    // The architectural claim made concrete: because both seams are idempotent under
    // their own keys, 20 concurrent identical retries all settle to one charge and one
    // mint, with no serializer in the on-ramp at all [LAW:one-source-of-truth].
    const ledger = await onRampLedger();
    const onRamp = createCoinOnRamp({ ledger, gateway: createInMemoryPaymentGateway(), mint: MINT });

    const attempts = Array.from({ length: 20 }, () => onRamp.buy(buyRequest(100n, 2500n, 'one-key')));
    const outcomes = await Promise.all(attempts);

    expect(outcomes.every((o) => o.kind === 'purchased')).toBe(true);
    expect(await ledger.balanceOf(WALLET)).toBe(100n); // minted once across 20 attempts
    expect(await ledger.balanceOf(MINT)).toBe(-100n);
  });
});
