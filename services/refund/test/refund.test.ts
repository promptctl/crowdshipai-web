import { describe, expect, it } from 'vitest';

import {
  AT,
  backerWallet,
  BUILDER,
  ESCROW,
  engineOver,
  fundedEscrow,
  refundablePledge,
  releaseEscrowToBuilder,
  reason,
} from './world.js';

describe('the refund engine returns the escrow to its backers, read from the money itself', () => {
  it('refunds each backer exactly what they contributed, draining the escrow, in one movement', async () => {
    const ledger = await fundedEscrow([
      { id: 'ami', funds: 20n },
      { id: 'ben', funds: 20n },
      { id: 'cleo', funds: 20n },
    ]);
    const engine = engineOver(ledger);

    const outcome = await engine.tryRefund(refundablePledge('pl-pool'), reason('pool-expired'));

    expect(outcome.kind).toBe('refunded');
    if (outcome.kind !== 'refunded') throw new Error('unreachable');
    // Each backer is made whole — exactly their net contribution, no more, no less — and the
    // escrow drains to zero: the refunds sum to exactly what was pooled [LAW:one-source-of-truth].
    expect(await ledger.balanceOf(backerWallet('ami'))).toBe(20n);
    expect(await ledger.balanceOf(backerWallet('ben'))).toBe(20n);
    expect(await ledger.balanceOf(backerWallet('cleo'))).toBe(20n);
    expect(await ledger.balanceOf(ESCROW)).toBe(0n);
    // The pledge advanced to its terminal phase, carrying the policy's reason and the money's instant.
    expect(outcome.pledge.status).toBe('refunded');
    expect(outcome.pledge.refundedAt).toBe(AT);
    expect(String(outcome.pledge.reason)).toBe('pool-expired');
    expect(outcome.receipt.balances.get(ESCROW)).toBe(0n);
  });

  it('refunds backers of unequal size their own amounts, never an even split', async () => {
    const ledger = await fundedEscrow([
      { id: 'ami', funds: 10n },
      { id: 'ben', funds: 50n },
    ]);
    const engine = engineOver(ledger);

    const outcome = await engine.tryRefund(refundablePledge('pl-uneven'), reason('dispute-upheld'));

    expect(outcome.kind).toBe('refunded');
    // What each put in is what each gets back — the credit legs are the shares, not a division.
    expect(await ledger.balanceOf(backerWallet('ami'))).toBe(10n);
    expect(await ledger.balanceOf(backerWallet('ben'))).toBe(50n);
    expect(await ledger.balanceOf(ESCROW)).toBe(0n);
  });

  it('reports an empty escrow as nothing-to-refund, moving nothing', async () => {
    const ledger = await fundedEscrow([]);
    const engine = engineOver(ledger);

    const outcome = await engine.tryRefund(refundablePledge('pl-empty'), reason('pool-expired'));

    expect(outcome.kind).toBe('nothing-to-refund');
    if (outcome.kind !== 'nothing-to-refund') throw new Error('unreachable');
    expect(outcome.escrowAccount).toBe(ESCROW);
  });
});

describe('the refund is idempotent — coins move at most once', () => {
  it('replays an already-refunded pledge from the money, without re-reading the drained history', async () => {
    const ledger = await fundedEscrow([
      { id: 'ami', funds: 20n },
      { id: 'ben', funds: 20n },
    ]);
    const engine = engineOver(ledger);
    const pledge = refundablePledge('pl-pool');

    const first = await engine.tryRefund(pledge, reason('pool-expired'));
    // The refund drained the escrow; a naive re-run would fold every backer's net to zero and
    // wrongly report nothing-to-refund. The rail replays the verdict from the money instead.
    const second = await engine.tryRefund(pledge, reason('pool-expired'));

    expect(first.kind).toBe('refunded');
    expect(second.kind).toBe('already-refunded');
    if (second.kind !== 'already-refunded') throw new Error('unreachable');
    expect(second.pledge.refundedAt).toBe(AT);
    // No second movement: balances are exactly the single refund, not doubled.
    expect(await ledger.balanceOf(backerWallet('ami'))).toBe(20n);
    expect(await ledger.balanceOf(backerWallet('ben'))).toBe(20n);
    expect(await ledger.balanceOf(ESCROW)).toBe(0n);
  });

  it('under concurrent attempts the coins move exactly once — no serializer needed', async () => {
    const ledger = await fundedEscrow([
      { id: 'ami', funds: 20n },
      { id: 'ben', funds: 20n },
      { id: 'cleo', funds: 20n },
    ]);
    const engine = engineOver(ledger);
    const pledge = refundablePledge('pl-pool');

    const outcomes = await Promise.all([
      engine.tryRefund(pledge, reason('pool-expired')),
      engine.tryRefund(pledge, reason('pool-expired')),
      engine.tryRefund(pledge, reason('pool-expired')),
    ]);

    // The coin movement IS the entire act and the ledger's single-use key makes it at-most-once,
    // so every racer resolves to a settled outcome (none refused) and the coins move exactly once
    // — the same judgment the pool funder made for a contribution [LAW:no-ambient-temporal-coupling].
    for (const outcome of outcomes) {
      expect(['refunded', 'already-refunded']).toContain(outcome.kind);
    }
    expect(await ledger.balanceOf(backerWallet('ami'))).toBe(20n);
    expect(await ledger.balanceOf(backerWallet('ben'))).toBe(20n);
    expect(await ledger.balanceOf(backerWallet('cleo'))).toBe(20n);
    expect(await ledger.balanceOf(ESCROW)).toBe(0n);
  });
});

describe('a refund that cannot be performed is surfaced loudly, never silent', () => {
  it('refuses loudly when the escrow was already drained by a release — coins are never invented', async () => {
    // The adversarial money-path case: a release already paid the builder, then a refund is
    // attempted on the (now stale) escrowed pledge. The refund would return coins the escrow no
    // longer holds, so the ledger's no-overdraft rule — the single enforcer of conservation —
    // refuses it loudly rather than double-spending [LAW:single-enforcer] [LAW:no-silent-failure].
    const ledger = await fundedEscrow([
      { id: 'ami', funds: 30n },
      { id: 'ben', funds: 30n },
    ]);
    await releaseEscrowToBuilder(ledger, 60n);
    const engine = engineOver(ledger);

    const outcome = await engine.tryRefund(refundablePledge('pl-raced'), reason('dispute-upheld'));

    expect(outcome.kind).toBe('refund-refused');
    if (outcome.kind !== 'refund-refused') throw new Error('unreachable');
    expect(outcome.error.kind).toBe('would-overdraft');
    // Nothing moved on the refused refund: the released coins stand, the backers got nothing back.
    expect(await ledger.balanceOf(ESCROW)).toBe(0n);
    expect(await ledger.balanceOf(BUILDER)).toBe(60n);
    expect(await ledger.balanceOf(backerWallet('ami'))).toBe(0n);
    expect(await ledger.balanceOf(backerWallet('ben'))).toBe(0n);
  });
});
