import type { Ledger } from '@crowdship/ledger';
import { describe, expect, it } from 'vitest';

import type { CutPolicy } from '../src/index.js';
import {
  AT,
  BUILDER,
  coins,
  deliverableAccepted,
  engineOver,
  ESCROW,
  escrowedPledge,
  facts,
  goalResolved,
  ledgerMissingBuilder,
  ledgerWithEscrow,
  PLATFORM,
  poolTarget,
} from './world.js';

describe('the engine observes a condition and settles only once it is met', () => {
  it('releases a pool obligation the instant its escrow reaches the target, splitting the cut', async () => {
    const ledger = await ledgerWithEscrow(500n);
    const engine = engineOver(ledger, facts({}));
    const pledge = escrowedPledge('pl-pool', 500n, poolTarget(500n));

    const outcome = await engine.tryRelease(pledge);

    expect(outcome.kind).toBe('released');
    if (outcome.kind !== 'released') throw new Error('unreachable');
    // Coins moved: builder got the 90% share, the platform skimmed its 10% cut, escrow drained.
    expect(await ledger.balanceOf(BUILDER)).toBe(450n);
    expect(await ledger.balanceOf(PLATFORM)).toBe(50n);
    expect(await ledger.balanceOf(ESCROW)).toBe(0n);
    // The pledge advanced to its terminal phase, carrying the boundary's instant.
    expect(outcome.pledge.status).toBe('released');
    expect(outcome.pledge.metAt).toBe(AT);
    expect(outcome.pledge.releasedAt).toBe(AT);
    expect(outcome.receipt.balances.get(BUILDER)).toBe(450n);
  });

  it('leaves a below-target pool pending, moving nothing', async () => {
    const ledger = await ledgerWithEscrow(300n);
    const engine = engineOver(ledger, facts({}));

    const outcome = await engine.tryRelease(escrowedPledge('pl-pool', 500n, poolTarget(500n)));

    expect(outcome.kind).toBe('pending');
    if (outcome.kind !== 'pending') throw new Error('unreachable');
    expect(outcome.observation).toEqual({ kind: 'pool-target-reached', target: 500n, pooled: 300n });
    expect(await ledger.balanceOf(BUILDER)).toBe(0n);
    expect(await ledger.balanceOf(ESCROW)).toBe(300n);
  });

  it('releases on an accepted deliverable and stays pending on an unaccepted one', async () => {
    const accepted = engineOver(await ledgerWithEscrow(500n), facts({ accepted: true }));
    const pendingLedger = await ledgerWithEscrow(500n);
    const unaccepted = engineOver(pendingLedger, facts({ accepted: false }));
    const condition = deliverableAccepted('feat-dark-mode');

    expect((await accepted.tryRelease(escrowedPledge('pl-d1', 500n, condition))).kind).toBe('released');

    const stillPending = await unaccepted.tryRelease(escrowedPledge('pl-d2', 500n, condition));
    expect(stillPending.kind).toBe('pending');
    expect(await pendingLedger.balanceOf(BUILDER)).toBe(0n);
  });

  it('releases on a resolved goal and stays pending on an unresolved one', async () => {
    const resolved = engineOver(await ledgerWithEscrow(500n), facts({ resolved: true }));
    const unresolved = engineOver(await ledgerWithEscrow(500n), facts({ resolved: false }));
    const condition = goalResolved('hit-mrr');

    expect((await resolved.tryRelease(escrowedPledge('pl-g1', 500n, condition))).kind).toBe('released');
    expect((await unresolved.tryRelease(escrowedPledge('pl-g2', 500n, condition))).kind).toBe('pending');
  });
});

describe('settlement is idempotent — coins move at most once', () => {
  it('replays a released pool obligation without re-reading its now-drained balance', async () => {
    const ledger = await ledgerWithEscrow(500n);
    const engine = engineOver(ledger, facts({}));
    const pledge = escrowedPledge('pl-pool', 500n, poolTarget(500n));

    const first = await engine.tryRelease(pledge);
    // The release drained the pool to zero; a naive re-observe would see 0 < 500 and wrongly
    // report pending. The log replays the verdict instead.
    const second = await engine.tryRelease(pledge);

    expect(first.kind).toBe('released');
    expect(second.kind).toBe('already-released');
    if (second.kind !== 'already-released') throw new Error('unreachable');
    expect(second.pledge.releasedAt).toBe(AT);
    // No second movement: balances are exactly the single release, not doubled.
    expect(await ledger.balanceOf(BUILDER)).toBe(450n);
    expect(await ledger.balanceOf(PLATFORM)).toBe(50n);
    expect(await ledger.balanceOf(ESCROW)).toBe(0n);
  });

  it('under concurrent attempts, exactly one fires and the rest replay — coins move once', async () => {
    const ledger = await ledgerWithEscrow(500n);
    const engine = engineOver(ledger, facts({}));
    const pledge = escrowedPledge('pl-pool', 500n, poolTarget(500n));

    const outcomes = await Promise.all([
      engine.tryRelease(pledge),
      engine.tryRelease(pledge),
      engine.tryRelease(pledge),
    ]);

    // The caller-visible signal is exact under the race: one release, the rest replays — so a
    // listener acting on `released` (the stream's event feed) fires exactly once.
    expect(outcomes.filter((o) => o.kind === 'released')).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === 'already-released')).toHaveLength(2);
    // And the coins moved exactly once.
    expect(await ledger.balanceOf(BUILDER)).toBe(450n);
    expect(await ledger.balanceOf(PLATFORM)).toBe(50n);
    expect(await ledger.balanceOf(ESCROW)).toBe(0n);
  });
});

describe('a release that cannot be performed is surfaced loudly, never silent', () => {
  it('reports a met obligation over an empty escrow as nothing-to-settle, moving nothing', async () => {
    const ledger = await ledgerWithEscrow(0n); // the deliverable is accepted but no coins were escrowed
    const engine = engineOver(ledger, facts({ accepted: true }));

    const outcome = await engine.tryRelease(escrowedPledge('pl-empty', 500n, deliverableAccepted('feat')));

    expect(outcome.kind).toBe('nothing-to-settle');
    if (outcome.kind !== 'nothing-to-settle') throw new Error('unreachable');
    expect(outcome.escrowAccount).toBe(ESCROW);
    expect(await ledger.balanceOf(BUILDER)).toBe(0n);
    expect(await ledger.balanceOf(ESCROW)).toBe(0n);
  });

  it('refuses loudly when the ledger rejects the movement (payee account never opened)', async () => {
    const ledger = await ledgerMissingBuilder(500n);
    const engine = engineOver(ledger, facts({}));

    const outcome = await engine.tryRelease(escrowedPledge('pl-unknown', 500n, poolTarget(500n)));

    expect(outcome.kind).toBe('release-refused');
    if (outcome.kind !== 'release-refused') throw new Error('unreachable');
    expect(outcome.error.kind).toBe('unknown-account');
    // The post is atomic: nothing moved, the coins are still in escrow.
    expect(await ledger.balanceOf(ESCROW)).toBe(500n);
  });

  it('reports a misrouted obligation (escrow paying itself) as invalid-routing', async () => {
    const ledger = await ledgerWithEscrow(500n);
    const engine = engineOver(ledger, facts({}));
    const misrouted = escrowedPledge('pl-bad', 500n, poolTarget(500n), { builderAccount: ESCROW });

    const outcome = await engine.tryRelease(misrouted);

    expect(outcome.kind).toBe('invalid-routing');
    if (outcome.kind !== 'invalid-routing') throw new Error('unreachable');
    expect(outcome.error.kind).toBe('same-account');
    expect(await ledger.balanceOf(ESCROW)).toBe(500n);
  });

  it('halts loudly and moves nothing when the cut policy does not conserve value', async () => {
    const ledger = await ledgerWithEscrow(500n);
    // A cut whose shares do not sum to the gross would create coins from nowhere.
    const brokenCut: CutPolicy = (gross) => ({ builderShare: coins(gross), platformCut: coins(10n) });
    const engine = engineOver(ledger, facts({}), brokenCut);

    await expect(engine.tryRelease(escrowedPledge('pl-pool', 500n, poolTarget(500n)))).rejects.toThrow(
      /conserve/,
    );
    // Conservation is checked before any post, so the money never moved.
    expect(await ledger.balanceOf(ESCROW)).toBe(500n);
    expect(await ledger.balanceOf(BUILDER)).toBe(0n);
  });
});

describe('the platform cut is a knob, not a hardcoded rate', () => {
  it('splits the gross by whatever cut policy is supplied', async () => {
    const ledger: Ledger = await ledgerWithEscrow(500n);
    const twentyPercent: CutPolicy = (gross) => ({
      platformCut: coins(gross / 5n),
      builderShare: coins(gross - gross / 5n),
    });
    const engine = engineOver(ledger, facts({}), twentyPercent);

    const outcome = await engine.tryRelease(escrowedPledge('pl-pool', 500n, poolTarget(500n)));

    expect(outcome.kind).toBe('released');
    expect(await ledger.balanceOf(BUILDER)).toBe(400n);
    expect(await ledger.balanceOf(PLATFORM)).toBe(100n);
  });
});
