import { accountId, DEFAULT_ROLES, type Principal } from '@crowdship/identity';
import { authorOffer, type PricedOffer } from '@crowdship/menu';
import type { Result } from '@crowdship/std';
import { describe, expect, it } from 'vitest';

import { coinBalanceOf, creditCoins, spendOnOffer } from '../src/server/market';

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
