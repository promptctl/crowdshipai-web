import { isMet } from '@crowdship/settlement';
import { describe, expect, it } from 'vitest';

import { createPoolFunder, type Contribution, type ContributionOutcome } from '../src/index.js';
import { BUILDER, coins, ffmpegPool, fundedWorld, key, POOL_ESCROW, reason, type FundedWorld } from './world.js';

/** Narrow a contribution outcome to its `contributed` arm or fail loudly — the suites below
 *  only reach this on the success path, so a different arm is a test-world bug, not a skip. */
const contributed = (outcome: ContributionOutcome): Extract<ContributionOutcome, { kind: 'contributed' }> => {
  if (outcome.kind !== 'contributed') throw new Error(`expected contributed, got ${outcome.kind}`);
  return outcome;
};

/** A contribution of `amount` coins from `backer`'s wallet into `pool`, with a per-call key. */
const contribution = (world: FundedWorld, pool: ReturnType<typeof ffmpegPool>, backer: string, amount: bigint, k: string): Contribution => ({
  pool,
  backer: world.wallet(backer),
  amount: coins(amount),
  idempotencyKey: key(k),
  reason: reason('pool-contribution'),
});

describe('many backers fund one shared escrow toward one target', () => {
  it('accumulates each contribution into the escrow, reaching the target on the one that tips it over', async () => {
    const pool = ffmpegPool(200n);
    const world = await fundedWorld(
      [
        { id: 'ami', funds: 100n },
        { id: 'ben', funds: 100n },
        { id: 'cleo', funds: 100n },
      ],
      pool,
    );
    const funder = createPoolFunder(world.ledger);

    const first = await funder.contribute(contribution(world, pool, 'ami', 50n, 'c-ami'));
    const second = await funder.contribute(contribution(world, pool, 'ben', 50n, 'c-ben'));
    const third = await funder.contribute(contribution(world, pool, 'cleo', 100n, 'c-cleo'));

    // The observed total is the running escrow balance — one source of truth, not a sum kept
    // aside — and readiness is the core's `isMet` over that observation, never a local compare.
    expect(contributed(first).observation).toEqual({ kind: 'pool-target-reached', target: 200n, pooled: 50n });
    expect(isMet(contributed(first).observation)).toBe(false);
    expect(contributed(second).observation.pooled).toBe(100n);
    expect(isMet(contributed(second).observation)).toBe(false);
    // The contribution that crosses the target observes the pool ready to ship.
    expect(contributed(third).observation.pooled).toBe(200n);
    expect(isMet(contributed(third).observation)).toBe(true);

    // Every backer's coins are in the one escrow; nothing has been released yet.
    expect(await world.ledger.balanceOf(POOL_ESCROW)).toBe(200n);
    expect(await world.ledger.balanceOf(BUILDER)).toBe(0n);
  });

  it('reports the pool reached the instant the escrow exactly equals the target', async () => {
    const pool = ffmpegPool(60n);
    const world = await fundedWorld([{ id: 'solo', funds: 60n }], pool);
    const funder = createPoolFunder(world.ledger);

    const outcome = await funder.contribute(contribution(world, pool, 'solo', 60n, 'c-solo'));

    // `isMet` over the observation is the settlement core's own judgment — reaching exactly the
    // target releases.
    expect(contributed(outcome).observation.pooled).toBe(60n);
    expect(isMet(contributed(outcome).observation)).toBe(true);
  });
});

describe('a contribution is idempotent by the ledger key alone — no double-funding', () => {
  it('replays a retried contribution without adding the coins twice', async () => {
    const pool = ffmpegPool(200n);
    const world = await fundedWorld([{ id: 'ami', funds: 100n }], pool);
    const funder = createPoolFunder(world.ledger);
    const retried = contribution(world, pool, 'ami', 50n, 'c-ami-retry');

    const first = await funder.contribute(retried);
    // The identical contribution under the same key: the ledger replays it, moving nothing more.
    const replay = await funder.contribute(retried);

    expect(contributed(first).observation.pooled).toBe(50n);
    expect(contributed(replay).observation.pooled).toBe(50n);
    // The escrow holds one contribution, not two — coins moved at most once.
    expect(await world.ledger.balanceOf(POOL_ESCROW)).toBe(50n);
  });
});

describe('a contribution that cannot be performed is surfaced loudly, never silent', () => {
  it('refuses a contribution the backer cannot cover, moving nothing', async () => {
    const pool = ffmpegPool(200n);
    const world = await fundedWorld([{ id: 'broke', funds: 10n }], pool);
    const funder = createPoolFunder(world.ledger);

    const outcome = await funder.contribute(contribution(world, pool, 'broke', 50n, 'c-broke'));

    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') throw new Error('unreachable');
    expect(outcome.error.kind).toBe('would-overdraft');
    // The escrow never received coins the backer did not have.
    expect(await world.ledger.balanceOf(POOL_ESCROW)).toBe(0n);
  });

  it('reports a backer funding the escrow they ARE as an invalid contribution', async () => {
    const pool = ffmpegPool(200n);
    const world = await fundedWorld([{ id: 'ami', funds: 100n }], pool);
    const funder = createPoolFunder(world.ledger);

    const outcome = await funder.contribute({
      pool,
      backer: POOL_ESCROW,
      amount: coins(50n),
      idempotencyKey: key('c-self'),
      reason: reason('pool-contribution'),
    });

    expect(outcome.kind).toBe('invalid-contribution');
    if (outcome.kind !== 'invalid-contribution') throw new Error('unreachable');
    expect(outcome.error.kind).toBe('same-account');
    expect(await world.ledger.balanceOf(POOL_ESCROW)).toBe(0n);
  });
});
