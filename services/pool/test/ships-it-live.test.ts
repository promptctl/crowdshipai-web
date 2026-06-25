import { createCustodialRail, createReleaseEngine, type CutPolicy, type ObligationFacts } from '@crowdship/release';
import { describe, expect, it } from 'vitest';

import { asEscrowedPledge, createPoolFunder, type Contribution } from '../src/index.js';
import { AT, BUILDER, coins, ffmpegPool, fundedWorld, key, PLATFORM, POOL_ESCROW, reason } from './world.js';

/**
 * The whole point of a pooled obligation, end to end: many backers fund one pool, and the
 * instant it reaches its target the auto-release engine ships the WHOLE pool to the builder,
 * the platform's cut skimmed. This exercises the real `@crowdship/release` engine (a test-only
 * dependency — the pool service never imports a sibling service [LAW:one-way-deps]) over a pool
 * the funder filled, proving the two services compose through the structural `PoolTerms` bridge
 * with no runtime coupling.
 */

/** A pool release never observes a deliverable or a goal — its single authority is the escrow
 *  balance. Facts that throw if consulted prove the pool path never touches that seam. */
const poolNeverUsesFacts: ObligationFacts = {
  accepted: () => {
    throw new Error('a pool release must not consult deliverable facts');
  },
  resolved: () => {
    throw new Error('a pool release must not consult goal facts');
  },
};

/** The default knob: 10% to the platform, the rest to the builder. */
const tenPercentCut: CutPolicy = (gross) => ({
  platformCut: coins(gross / 10n),
  builderShare: coins(gross - gross / 10n),
});

describe('many backers, one target, one builder — the pool ships it live', () => {
  it('drains the whole funded pool to the builder minus the cut once the target is reached', async () => {
    const pool = ffmpegPool(60n);
    const world = await fundedWorld(
      [
        { id: 'ami', funds: 50n },
        { id: 'ben', funds: 50n },
        { id: 'cleo', funds: 50n },
      ],
      pool,
    );
    const funder = createPoolFunder(world.ledger);
    const contribute = (backer: string, amount: bigint, k: string): Promise<unknown> => {
      const c: Contribution = {
        pool,
        backer: world.wallet(backer),
        amount: coins(amount),
        idempotencyKey: key(k),
        reason: reason('pool-contribution'),
      };
      return funder.contribute(c);
    };

    // Ten dollars each, three backers — the founding doc's micro-contracting bet in miniature.
    await contribute('ami', 20n, 'c-ami');
    await contribute('ben', 20n, 'c-ben');
    const last = await contribute('cleo', 20n, 'c-cleo');
    expect(last).toMatchObject({ kind: 'contributed', observation: { pooled: 60n } });

    // The product surface hands the funded pool to the release engine — fund here, release there.
    const engine = createReleaseEngine({
      ledger: world.ledger,
      facts: poolNeverUsesFacts,
      platformAccount: PLATFORM,
      cut: tenPercentCut,
      reason: reason('pool-release'),
      rail: createCustodialRail(world.ledger),
    });

    const outcome = await engine.tryRelease(asEscrowedPledge(pool, AT));

    expect(outcome.kind).toBe('released');
    if (outcome.kind !== 'released') throw new Error('unreachable');
    // The builder takes the whole pool minus the 10% cut; the escrow drains to zero.
    expect(await world.ledger.balanceOf(BUILDER)).toBe(54n);
    expect(await world.ledger.balanceOf(PLATFORM)).toBe(6n);
    expect(await world.ledger.balanceOf(POOL_ESCROW)).toBe(0n);
    // The pool's identity rides through to the released pledge — what the stream's feed names.
    expect(outcome.pledge.terms.poolId).toBe(pool.id);
    expect(outcome.pledge.releasedAt).toBe(AT);
  });

  it('leaves an under-funded pool pending — the engine ships nothing until the target is met', async () => {
    const pool = ffmpegPool(60n);
    const world = await fundedWorld([{ id: 'ami', funds: 50n }], pool);
    const funder = createPoolFunder(world.ledger);

    const partial = await funder.contribute({
      pool,
      backer: world.wallet('ami'),
      amount: coins(20n),
      idempotencyKey: key('c-ami'),
      reason: reason('pool-contribution'),
    });
    expect(partial).toMatchObject({ kind: 'contributed', observation: { pooled: 20n } });

    const engine = createReleaseEngine({
      ledger: world.ledger,
      facts: poolNeverUsesFacts,
      platformAccount: PLATFORM,
      cut: tenPercentCut,
      reason: reason('pool-release'),
      rail: createCustodialRail(world.ledger),
    });

    const outcome = await engine.tryRelease(asEscrowedPledge(pool, AT));

    expect(outcome.kind).toBe('pending');
    if (outcome.kind !== 'pending') throw new Error('unreachable');
    expect(outcome.observation).toEqual({ kind: 'pool-target-reached', target: 60n, pooled: 20n });
    // Nothing shipped: the backers' coins stay pooled until the target is met.
    expect(await world.ledger.balanceOf(POOL_ESCROW)).toBe(20n);
    expect(await world.ledger.balanceOf(BUILDER)).toBe(0n);
  });
});
