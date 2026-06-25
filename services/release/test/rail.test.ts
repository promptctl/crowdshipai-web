import type { Ledger, MovementCommit } from '@crowdship/ledger';
import { idempotencyKey, transactionReason, type TransactionReason } from '@crowdship/ledger-kernel';
import { describe, expect, it } from 'vitest';

import { createCustodialRail, type SettlementRail } from '@crowdship/settlement-rail';
import { createReleaseEngine, type ReleaseEngine } from '../src/index.js';
import {
  AT,
  BUILDER,
  ESCROW,
  escrowedPledge,
  facts,
  ledgerWithEscrow,
  must,
  PLATFORM,
  poolTarget,
  tenPercentCut,
} from './world.js';

/**
 * The settlement rail is the seam the founding doc's "custodial now, on-chain later" turns
 * on: the release engine must drive ANY rail that honours the contract with no change to
 * itself [LAW:locality-or-seam]. These tests prove exactly that — first that the same pledge
 * lifecycle settles identically through two different rail instances, then that the custodial
 * rail closes the crash window the old split-record path left open.
 */

const RELEASE_REASON: TransactionReason = must(transactionReason('obligation-release'));

const engineOn = (ledger: Ledger, rail: SettlementRail): ReleaseEngine =>
  createReleaseEngine({
    ledger,
    facts: facts({}),
    platformAccount: PLATFORM,
    cut: tenPercentCut,
    reason: RELEASE_REASON,
    rail,
  });

/**
 * A second `SettlementRail` instance whose authority for "has this settled?" is its OWN
 * in-process record, NOT the ledger commit — a stand-in for a rail (an on-chain one, say)
 * that tracks settlement in its own store. It moves coins through the injected ledger under
 * its own key so its movements never collide with the custodial rail's. It exists only to
 * prove the engine is rail-agnostic; it deliberately does not close the crash window (that is
 * the custodial rail's property of reading the money itself), so it is never a production rail.
 */
const recordingRail = (ledger: Ledger): SettlementRail => {
  const settled = new Map<string, MovementCommit>();
  return {
    settlementOf: (purpose, pledge) => Promise.resolve(settled.get(`${purpose}:${pledge}`)),
    settle: async ({ purpose, pledge, transfers, reason }) => {
      const posted = await ledger.post({
        transfers,
        reason,
        idempotencyKey: must(idempotencyKey(`alt-${purpose}:${pledge}`)),
      });
      if (posted.ok) {
        settled.set(`${purpose}:${pledge}`, {
          transactionId: posted.value.transactionId,
          occurredAt: posted.value.occurredAt,
        });
      }
      return posted;
    },
  };
};

/**
 * The lifecycle contract every rail must satisfy, asserted against whatever rail `railOf`
 * builds over a ledger — the same shape the {@link ledgerContract} uses for the two ledgers
 * [LAW:behavior-not-structure]. If the engine's outcomes are identical across two unrelated
 * rails, then swapping the rail costs the settlement domain nothing.
 */
const railContract = (label: string, railOf: (ledger: Ledger) => SettlementRail): void => {
  describe(`the engine drives any rail through the same lifecycle — ${label}`, () => {
    it('ships a met pool through the rail: coins move, the pledge reaches terminal released', async () => {
      const ledger = await ledgerWithEscrow(500n);
      const engine = engineOn(ledger, railOf(ledger));

      const outcome = await engine.tryRelease(escrowedPledge('pl-pool', 500n, poolTarget(500n)));

      expect(outcome.kind).toBe('released');
      if (outcome.kind !== 'released') throw new Error('unreachable');
      expect(await ledger.balanceOf(BUILDER)).toBe(450n);
      expect(await ledger.balanceOf(PLATFORM)).toBe(50n);
      expect(await ledger.balanceOf(ESCROW)).toBe(0n);
      expect(outcome.pledge.releasedAt).toBe(AT);
    });

    it('replays a settled pledge as already-released, moving no coins a second time', async () => {
      const ledger = await ledgerWithEscrow(500n);
      const engine = engineOn(ledger, railOf(ledger));
      const pledge = escrowedPledge('pl-pool', 500n, poolTarget(500n));

      const first = await engine.tryRelease(pledge);
      const second = await engine.tryRelease(pledge);

      expect(first.kind).toBe('released');
      expect(second.kind).toBe('already-released');
      // The coins moved exactly once, not twice.
      expect(await ledger.balanceOf(BUILDER)).toBe(450n);
      expect(await ledger.balanceOf(ESCROW)).toBe(0n);
    });

    it('leaves a below-target pool pending through the rail, moving nothing', async () => {
      const ledger = await ledgerWithEscrow(300n);
      const engine = engineOn(ledger, railOf(ledger));

      const outcome = await engine.tryRelease(escrowedPledge('pl-pool', 500n, poolTarget(500n)));

      expect(outcome.kind).toBe('pending');
      expect(await ledger.balanceOf(ESCROW)).toBe(300n);
    });
  });
};

railContract('custodial rail (settled-status from the ledger)', createCustodialRail);
railContract('recording rail (settled-status from its own store)', recordingRail);

describe('the custodial rail closes the crash window: settlement survives a lost process', () => {
  it('a fresh engine over the same ledger replays already-released instead of re-observing a drained pool', async () => {
    const ledger = await ledgerWithEscrow(500n);
    const pledge = escrowedPledge('pl-pool', 500n, poolTarget(500n));

    // First engine settles the pool. The release drains the escrow to zero.
    const before = engineOn(ledger, createCustodialRail(ledger));
    expect((await before.tryRelease(pledge)).kind).toBe('released');
    expect(await ledger.balanceOf(ESCROW)).toBe(0n);

    // A brand-new engine and rail — a process that crashed right after the coins moved and
    // kept NO in-memory record of having released. The old split path would re-observe the
    // drained escrow (0 < 500) and wrongly report `pending`, silently re-judging a paid pool
    // unpaid [LAW:no-silent-failure]. Because the custodial rail derives "settled?" from the
    // money itself, the fresh engine recovers the verdict from the ledger and replays it.
    const afterRestart = engineOn(ledger, createCustodialRail(ledger));
    const recovered = await afterRestart.tryRelease(pledge);

    expect(recovered.kind).toBe('already-released');
    if (recovered.kind !== 'already-released') throw new Error('unreachable');
    expect(recovered.pledge.releasedAt).toBe(AT);
    // And no second movement: the recovery moved nothing, the split stands exactly once.
    expect(await ledger.balanceOf(BUILDER)).toBe(450n);
    expect(await ledger.balanceOf(PLATFORM)).toBe(50n);
    expect(await ledger.balanceOf(ESCROW)).toBe(0n);
  });
});
