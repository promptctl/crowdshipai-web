import { accountId, DEFAULT_ROLES, type Principal } from '@crowdship/identity';
import { authorOffer, type PricedOffer } from '@crowdship/menu';
import type { Result } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import {
  backerPrincipalIdOf,
  channelSettlementFeed,
  coinBalanceOf,
  creditCoins,
  listFeaturePools,
  openFeaturePool,
  pledgeToFeaturePool,
  settlementFeedOfPool,
  spendOnOffer,
  type FeaturePoolView,
} from '../src/server/market';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

// The market is a process singleton, so each test names its OWN backer so its
// balance is independent of every other test's [LAW:no-ambient-temporal-coupling].
const backer = (id: string): Principal => ({ id: must(accountId(id)), roles: DEFAULT_ROLES });

const offer = (id: string, price: bigint): PricedOffer =>
  must(authorOffer({ id, price, effect: { kind: 'shoutout', params: 'your name, live' } }));

const SLUG = 'ffmpeg-witch';

describe('the coin economy, end to end through the market', () => {
  it('starts a fresh backer at a zero balance, not an unknown account', async () => {
    expect(await coinBalanceOf(backer('m-fresh'))).toBe(0n);
  });

  it('credits coins through the on-ramp and the balance reflects it', async () => {
    const p = backer('m-credit');
    const outcome = await creditCoins(p, 1000n, 'credit-1');
    expect(outcome.kind).toBe('purchased');
    expect(await coinBalanceOf(p)).toBe(1000n);
  });

  it('refuses a spend the wallet cannot cover — no coins move', async () => {
    const p = backer('m-broke');
    const outcome = await spendOnOffer(p, SLUG, offer('o-broke', 100n), 'spend-broke');
    expect(outcome.kind).toBe('charge-refused');
    if (outcome.kind === 'charge-refused') expect(outcome.error.kind).toBe('would-overdraft');
    expect(await coinBalanceOf(p)).toBe(0n);
  });

  it('fires a funded spend and debits exactly the offer price', async () => {
    const p = backer('m-spend');
    await creditCoins(p, 1000n, 'credit-spend');
    const outcome = await spendOnOffer(p, SLUG, offer('o-spend', 100n), 'spend-1');
    expect(outcome.kind).toBe('fired');
    expect(await coinBalanceOf(p)).toBe(900n);
  });

  it('replays an identical spend as a no-op — no second charge, no second fire', async () => {
    const p = backer('m-idem');
    await creditCoins(p, 1000n, 'credit-idem');
    const first = await spendOnOffer(p, SLUG, offer('o-idem', 100n), 'spend-idem');
    expect(first.kind).toBe('fired');
    const replay = await spendOnOffer(p, SLUG, offer('o-idem', 100n), 'spend-idem');
    expect(replay.kind).toBe('already-applied');
    // The coins moved exactly once across both calls.
    expect(await coinBalanceOf(p)).toBe(900n);
  });

  it('credits the same top-up once when its attempt is retried', async () => {
    const p = backer('m-credit-idem');
    expect((await creditCoins(p, 500n, 'credit-retry')).kind).toBe('purchased');
    expect((await creditCoins(p, 500n, 'credit-retry')).kind).toBe('purchased');
    expect(await coinBalanceOf(p)).toBe(500n);
  });
});

// A backer funded with coins ready to pledge. Each pool test names its OWN builder slug so its
// pool — and the escrow whose balance IS the pooled total — is independent of every other test's.
const fundedBacker = async (id: string, coins: bigint): Promise<Principal> => {
  const p = backer(id);
  await creditCoins(p, coins, `fund-${id}`);
  return p;
};

describe('pooled obligations that pay themselves out, end to end through the market', () => {
  it('ships the whole pool to the builder the instant the target is reached', async () => {
    const pool = await openFeaturePool('pool-ship', 'add HDR to the encoder', 60n);
    expect(pool).toMatchObject({ pooled: 0n, target: 60n, released: false });

    const ami = await fundedBacker('pool-ami', 100n);
    const ben = await fundedBacker('pool-ben', 100n);
    const cleo = await fundedBacker('pool-cleo', 100n);

    // Two pledges leave the pool short of its target: nothing ships, the engine answers pending.
    const first = await pledgeToFeaturePool(ami, pool.id, 20n, 'p-ami');
    expect(first.contribution).toMatchObject({ kind: 'contributed', observation: { pooled: 20n } });
    expect(first.release.kind).toBe('pending');
    expect(first.pool).toMatchObject({ pooled: 20n, released: false });

    const second = await pledgeToFeaturePool(ben, pool.id, 20n, 'p-ben');
    expect(second.release.kind).toBe('pending');
    expect(second.pool.pooled).toBe(40n);

    // The pledge that tips the target over is the one that watches the pool ship — released on
    // THIS call, the escrow drained to zero, the backers' coins now the builder's (minus the cut).
    const third = await pledgeToFeaturePool(cleo, pool.id, 20n, 'p-cleo');
    expect(third.release.kind).toBe('released');
    expect(third.pool).toMatchObject({ pooled: 0n, released: true });

    // The backers spent exactly their pledge; the pool, not their wallets, holds the rest.
    expect(await coinBalanceOf(ami)).toBe(80n);
    expect(await coinBalanceOf(cleo)).toBe(80n);
  });

  it('leaves an under-funded pool pending — the backers’ coins stay pooled until the target is met', async () => {
    const pool = await openFeaturePool('pool-wait', 'port the UI to wgpu', 100n);
    const ami = await fundedBacker('pool-wait-ami', 100n);

    const pledge = await pledgeToFeaturePool(ami, pool.id, 20n, 'pw-ami');
    expect(pledge.release.kind).toBe('pending');
    expect(pledge.pool).toMatchObject({ pooled: 20n, released: false });
    // Nothing shipped: the coins are in escrow, gone from the backer, not yet the builder's.
    expect(await coinBalanceOf(ami)).toBe(80n);
  });

  it('replays an identical pledge as a no-op — the ledger key makes a contribution at-most-once', async () => {
    const pool = await openFeaturePool('pool-idem', 'fix the seek bug', 100n);
    const ami = await fundedBacker('pool-idem-ami', 100n);

    const first = await pledgeToFeaturePool(ami, pool.id, 30n, 'pi-ami');
    expect(first.contribution.kind).toBe('contributed');
    const replay = await pledgeToFeaturePool(ami, pool.id, 30n, 'pi-ami');
    expect(replay.contribution.kind).toBe('contributed');

    // The coins moved exactly once across both calls: pooled is 30, not 60.
    expect(replay.pool.pooled).toBe(30n);
    expect(await coinBalanceOf(ami)).toBe(70n);
  });

  it('lists a builder’s open pools with their live pooled totals', async () => {
    const pool = await openFeaturePool('pool-list', 'add subtitles', 50n);
    const ami = await fundedBacker('pool-list-ami', 100n);
    await pledgeToFeaturePool(ami, pool.id, 15n, 'pl-ami');

    const pools: readonly FeaturePoolView[] = await listFeaturePools('pool-list');
    expect(pools).toHaveLength(1);
    expect(pools[0]).toMatchObject({ title: 'add subtitles', target: 50n, pooled: 15n, released: false });
  });
});

describe('the transparent settlement feed, projected from the ledger through the market', () => {
  it('tells a shipped pool’s whole money story: contributions filling, the release, and the cut in plain view', async () => {
    const pool = await openFeaturePool('feed-ship', 'wire up the overlay', 60n);
    const ami = await fundedBacker('feed-ami', 100n);
    const ben = await fundedBacker('feed-ben', 100n);
    await pledgeToFeaturePool(ami, pool.id, 20n, 'sf-ami');
    const tipping = await pledgeToFeaturePool(ben, pool.id, 40n, 'sf-ben');
    expect(tipping.release.kind).toBe('released');

    const feed = await settlementFeedOfPool(pool.id);

    // The story in the order the ledger recorded it: two contributions carrying the
    // live pooled-after ticker, then the split of the shipped gross — 10% cut, the
    // rest to the builder — draining the escrow to zero.
    expect(feed.map((e) => e.kind)).toEqual(['contribution', 'contribution', 'release', 'cut']);
    expect(feed[0]).toMatchObject({ kind: 'contribution', amount: 20n, pooledAfter: 20n });
    expect(feed[1]).toMatchObject({ kind: 'contribution', amount: 40n, pooledAfter: 60n });
    expect(feed[2]).toMatchObject({ kind: 'release', amount: 54n });
    expect(feed[3]).toMatchObject({ kind: 'cut', amount: 6n });
    // Whatever order the engine posted the split's legs, the story ends with the escrow empty.
    expect(feed[feed.length - 1]?.pooledAfter).toBe(0n);
    // Conservation, read from the story itself: what left the escrow is exactly what filled it.
    expect(54n + 6n).toBe(20n + 40n);
  });

  it('is an idempotent projection — re-reading the same history yields the identical feed', async () => {
    const pool = await openFeaturePool('feed-idem', 'add a replay buffer', 100n);
    const ami = await fundedBacker('feed-idem-ami', 100n);
    await pledgeToFeaturePool(ami, pool.id, 25n, 'sfi-ami');

    const first = await settlementFeedOfPool(pool.id);
    const second = await settlementFeedOfPool(pool.id);
    expect(second).toEqual(first);
  });

  it('merges a builder’s pools into one channel timeline, tagged by pool title, oldest first', async () => {
    const alpha = await openFeaturePool('feed-merge', 'pool alpha', 100n);
    const beta = await openFeaturePool('feed-merge', 'pool beta', 100n);
    const ami = await fundedBacker('feed-merge-ami', 100n);
    await pledgeToFeaturePool(ami, alpha.id, 10n, 'sfm-a');
    await pledgeToFeaturePool(ami, beta.id, 15n, 'sfm-b');

    const timeline = await channelSettlementFeed('feed-merge');
    expect(timeline).toHaveLength(2);
    expect(timeline.map((t) => t.poolTitle).toSorted()).toEqual(['pool alpha', 'pool beta']);
    expect(timeline.map((t) => t.event.amount).toSorted()).toEqual([10n, 15n]);
    // Oldest first across pools — the instants the engine recorded, never re-derived.
    const instants = timeline.map((t) => Number(t.event.at));
    expect(instants).toEqual([...instants].sort((a, b) => a - b));
  });

  it('recovers the principal inside a wallet account, and refuses a non-wallet loudly', async () => {
    const ami = await fundedBacker('feed-party', 50n);
    const pool = await openFeaturePool('feed-party', 'name the backer', 100n);
    await pledgeToFeaturePool(ami, pool.id, 10n, 'sfp-ami');

    const feed = await settlementFeedOfPool(pool.id);
    const contribution = feed[0];
    if (contribution?.kind !== 'contribution') throw new Error('expected a contribution');
    expect(String(backerPrincipalIdOf(contribution.backer))).toBe('feed-party');

    expect(() => backerPrincipalIdOf(contribution.backer.toString().replace('wallet:', 'builder:') as typeof contribution.backer)).toThrow(
      /not a wallet account/,
    );
  });
});
