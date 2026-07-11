import { asEscrowedPledge } from '@crowdship/pool';
import { createRefundEngine } from '@crowdship/refund';
import { createReleaseEngine, type CutPolicy, type ObligationFacts } from '@crowdship/release';
import { refundReason } from '@crowdship/settlement';
import { createCustodialRail } from '@crowdship/settlement-rail';
import { describe, expect, it } from 'vitest';

import { settlementFeed, type SettlementRoles } from '../src/index.js';
import { plain } from './plain.js';
import { AT, BUILDER, coins, ffmpegPool, fundedWorld, must, PLATFORM, POOL_ESCROW, reason } from './world.js';

/**
 * The whole point of a transparent obligation, end to end: many backers fund one pool, the
 * auto-release engine ships it, and the feed shows the audience EXACTLY what the money did —
 * three contributions filling the bar, then the builder paid and the cut skimmed — every line
 * derived from the ledger's own recorded history, never a parallel tally. This exercises the
 * real pool funder and the real release engine (test-only dependencies — the feed service
 * imports neither [LAW:one-way-deps]) so the history the feed reads is the genuine record.
 */

const AT_MS = 1_700_000_000_000;

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

describe('the release happens in view of the stream', () => {
  it('shows the contributions filling the pool, then the builder paid and the cut skimmed', async () => {
    const pool = ffmpegPool(60n);
    const world = await fundedWorld(
      [
        { id: 'ami', funds: 50n },
        { id: 'ben', funds: 50n },
        { id: 'cleo', funds: 50n },
      ],
      pool,
    );

    // Ten dollars each, three backers — the founding doc's micro-contracting bet in miniature.
    await world.contribute('ami', 20n, 'c-ami');
    await world.contribute('ben', 20n, 'c-ben');
    await world.contribute('cleo', 20n, 'c-cleo');

    const engine = createReleaseEngine({
      ledger: world.ledger,
      query: world.ledger,
      facts: poolNeverUsesFacts,
      platformAccount: PLATFORM,
      cut: tenPercentCut,
      reason: reason('pool-release'),
      rail: createCustodialRail(world.ledger),
    });
    const released = await engine.tryRelease(asEscrowedPledge(pool, AT));
    expect(released.kind).toBe('released');

    const roles: SettlementRoles = { escrow: POOL_ESCROW, builder: BUILDER, platform: PLATFORM };
    const feed = (await settlementFeed(world.ledger, roles)).map(plain);

    // The contribution ticker: each backer's coins, with the running pooled total the bar shows.
    expect(feed.slice(0, 3)).toEqual([
      { kind: 'contribution', party: 'backer-ami', amount: 20n, pooledAfter: 20n, reason: 'pool-contribution', at: AT_MS },
      { kind: 'contribution', party: 'backer-ben', amount: 20n, pooledAfter: 40n, reason: 'pool-contribution', at: AT_MS },
      { kind: 'contribution', party: 'backer-cleo', amount: 20n, pooledAfter: 60n, reason: 'pool-contribution', at: AT_MS },
    ]);

    // The release moment: the builder takes the pool minus the cut, the platform skims it, the
    // escrow drains to zero — all in plain view, summing to exactly the 60 that was pooled.
    const settlement = feed.slice(3);
    expect(settlement).toContainEqual({ kind: 'release', party: 'builder', amount: 54n, pooledAfter: 6n, reason: 'pool-release', at: AT_MS });
    expect(settlement).toContainEqual({ kind: 'cut', party: 'platform-revenue', amount: 6n, pooledAfter: 0n, reason: 'pool-release', at: AT_MS });
    expect(settlement).toHaveLength(2);

    // Nothing invented: the coins that left escrow equal the coins that filled it.
    const inflow = feed.filter((e) => e.kind === 'contribution').reduce((sum, e) => sum + e.amount, 0n);
    const outflow = settlement.reduce((sum, e) => sum + e.amount, 0n);
    expect(outflow).toBe(inflow);
  });

  it('is the contribution ticker alone while the pool is still filling — no release line yet', async () => {
    const pool = ffmpegPool(60n);
    const world = await fundedWorld([{ id: 'ami', funds: 50n }], pool);
    await world.contribute('ami', 20n, 'c-ami');

    const roles: SettlementRoles = { escrow: POOL_ESCROW, builder: BUILDER, platform: PLATFORM };
    const feed = (await settlementFeed(world.ledger, roles)).map(plain);

    expect(feed).toEqual([
      { kind: 'contribution', party: 'backer-ami', amount: 20n, pooledAfter: 20n, reason: 'pool-contribution', at: AT_MS },
    ]);
  });

  it('shows the overshoot returning to the backers alongside the release and the cut', async () => {
    const pool = ffmpegPool(60n);
    const world = await fundedWorld(
      [
        { id: 'ami', funds: 80n },
        { id: 'ben', funds: 50n },
      ],
      pool,
    );

    // Ninety pooled against a sixty-coin target: the pool overshoots by thirty.
    await world.contribute('ami', 60n, 'c-ami');
    await world.contribute('ben', 30n, 'c-ben');

    const engine = createReleaseEngine({
      ledger: world.ledger,
      query: world.ledger,
      facts: poolNeverUsesFacts,
      platformAccount: PLATFORM,
      cut: tenPercentCut,
      reason: reason('pool-release'),
      rail: createCustodialRail(world.ledger),
    });
    const released = await engine.tryRelease(asEscrowedPledge(pool, AT));
    expect(released.kind).toBe('released');

    const roles: SettlementRoles = { escrow: POOL_ESCROW, builder: BUILDER, platform: PLATFORM };
    const feed = (await settlementFeed(world.ledger, roles)).map(plain);

    // One settlement, the whole story: the builder paid the TARGET's split, the cut skimmed,
    // and the thirty-coin overshoot back to the backers pro-rata (20 to ami's 60, 10 to ben's
    // 30) — the excess never ships to the builder as a windfall, and the audience sees it
    // return in the same feed that shows the release.
    const settlement = feed.slice(2);
    expect(settlement).toContainEqual({ kind: 'release', party: 'builder', amount: 54n, pooledAfter: 36n, reason: 'pool-release', at: AT_MS });
    expect(settlement).toContainEqual({ kind: 'cut', party: 'platform-revenue', amount: 6n, pooledAfter: 30n, reason: 'pool-release', at: AT_MS });
    expect(settlement).toContainEqual({ kind: 'refund', party: 'backer-ami', amount: 20n, pooledAfter: 10n, reason: 'pool-release', at: AT_MS });
    expect(settlement).toContainEqual({ kind: 'refund', party: 'backer-ben', amount: 10n, pooledAfter: 0n, reason: 'pool-release', at: AT_MS });
    expect(settlement).toHaveLength(4);

    // Nothing invented: everything that left escrow equals the ninety that filled it.
    const inflow = feed.filter((e) => e.kind === 'contribution').reduce((sum, e) => sum + e.amount, 0n);
    const outflow = settlement.reduce((sum, e) => sum + e.amount, 0n);
    expect(outflow).toBe(inflow);
  });
});

describe('the refund happens in view of the stream too', () => {
  it('shows the contributions filling the pool, then each backer made whole when it never ships', async () => {
    const pool = ffmpegPool(100n); // a target the contributions fall short of
    const world = await fundedWorld(
      [
        { id: 'ami', funds: 50n },
        { id: 'ben', funds: 50n },
      ],
      pool,
    );

    await world.contribute('ami', 20n, 'c-ami');
    await world.contribute('ben', 20n, 'c-ben');

    // Forty pooled against a hundred-coin target — it never ships, so the product surface
    // refunds it through the REAL refund engine (a test-only dependency [LAW:one-way-deps]).
    const engine = createRefundEngine({
      query: world.ledger,
      rail: createCustodialRail(world.ledger),
    });
    const refunded = await engine.tryRefund(asEscrowedPledge(pool, AT), must(refundReason('pool-expired')));
    expect(refunded.kind).toBe('refunded');

    const roles: SettlementRoles = { escrow: POOL_ESCROW, builder: BUILDER, platform: PLATFORM };
    const feed = (await settlementFeed(world.ledger, roles)).map(plain);

    // The whole story in plain view: the bar fills, then drains back to the backers — no release,
    // no cut, every coin that came in going back out to the one who put it in.
    expect(feed).toEqual([
      { kind: 'contribution', party: 'backer-ami', amount: 20n, pooledAfter: 20n, reason: 'pool-contribution', at: AT_MS },
      { kind: 'contribution', party: 'backer-ben', amount: 20n, pooledAfter: 40n, reason: 'pool-contribution', at: AT_MS },
      { kind: 'refund', party: 'backer-ami', amount: 20n, pooledAfter: 20n, reason: 'pool-expired', at: AT_MS },
      { kind: 'refund', party: 'backer-ben', amount: 20n, pooledAfter: 0n, reason: 'pool-expired', at: AT_MS },
    ]);

    // Nothing invented: the coins refunded equal the coins contributed.
    const inflow = feed.filter((e) => e.kind === 'contribution').reduce((sum, e) => sum + e.amount, 0n);
    const outflow = feed.filter((e) => e.kind === 'refund').reduce((sum, e) => sum + e.amount, 0n);
    expect(outflow).toBe(inflow);
  });
});
