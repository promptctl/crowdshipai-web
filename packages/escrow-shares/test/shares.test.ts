import { accountId, type AccountId } from '@crowdship/ledger-kernel';
import { describe, expect, it } from 'vitest';

import type { Result } from '@crowdship/std';

import { owedToBackers, proRataShares } from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

/**
 * The shape table for the pro-rata distribution, verbatim: every accept row is an exact
 * expected output, every reject row a loud halt. The distribution is the one function both
 * settlement directions return coins along, so its table IS the money-conservation contract
 * [LAW:verifiable-goals].
 */

const acc = (s: string): AccountId => must(accountId(s));

const nets = (entries: Record<string, bigint>): Map<AccountId, bigint> =>
  new Map(Object.entries(entries).map(([id, n]) => [acc(id), n]));

const shares = (net: Map<AccountId, bigint>, amount: bigint): Record<string, bigint> =>
  Object.fromEntries([...proRataShares(net, amount)].map(([id, n]) => [String(id), n]));

describe('proRataShares distributes an amount over backers, conserving it exactly', () => {
  it('distributes zero as no shares at all', () => {
    expect(shares(nets({ a: 100n }), 0n)).toEqual({});
  });

  it('at the whole-owed amount, hands each backer exactly their net — the full-refund fixed point', () => {
    const net = nets({ a: 137n, b: 1n, c: 862n });
    expect(shares(net, 1000n)).toEqual({ a: 137n, b: 1n, c: 862n });
  });

  it('splits an evenly-dividing amount pro-rata with no remainder', () => {
    expect(shares(nets({ a: 100n, b: 300n }), 200n)).toEqual({ a: 50n, b: 150n });
  });

  it('hands remainder coins to the largest discarded fractions', () => {
    // T=3: floors a=floor(4/3)=1 (frac 1/3), b=floor(2/3)=0 (frac 2/3); the 1 leftover goes to b.
    expect(shares(nets({ a: 2n, b: 1n }), 2n)).toEqual({ a: 1n, b: 1n });
  });

  it('breaks fraction ties by account id, and omits zero shares', () => {
    // Three equal stakes, 2 coins: all fractions tie at 2/3, so a and b (id-ascending) get one
    // each and c gets nothing — absent from the result, never a zero entry.
    expect(shares(nets({ c: 1n, a: 1n, b: 1n }), 2n)).toEqual({ a: 1n, b: 1n });
  });

  it('gives non-positive nets nothing and no weight', () => {
    // b already fully paid out, d overdrawn (a payout leg): only a and c carry stakes.
    expect(shares(nets({ a: 100n, b: 0n, c: 300n, d: -50n }), 200n)).toEqual({ a: 50n, c: 150n });
  });

  it('is a function of the contents, never the insertion order', () => {
    const forward = nets({ a: 7n, b: 5n, c: 3n });
    const backward = nets({ c: 3n, b: 5n, a: 7n });
    expect(shares(forward, 11n)).toEqual(shares(backward, 11n));
  });

  it('conserves any legal amount exactly, across a spread of stakes and amounts', () => {
    const net = nets({ a: 3n, b: 7n, c: 11n, d: 1n, e: 999n });
    const owed = owedToBackers(net);
    for (let amount = 0n; amount <= owed; amount += 13n) {
      const total = [...proRataShares(net, amount).values()].reduce((s, n) => s + n, 0n);
      expect(total).toBe(amount);
    }
  });
});

describe('a distribution beyond the backers’ recorded stakes is corruption, halted loudly', () => {
  it('refuses a negative amount', () => {
    expect(() => proRataShares(nets({ a: 100n }), -1n)).toThrow(/beyond their recorded stakes/);
  });

  it('refuses an amount above everything owed — coins are never fabricated', () => {
    expect(() => proRataShares(nets({ a: 100n }), 101n)).toThrow(/beyond their recorded stakes/);
  });

  it('refuses any positive amount when no backer holds a stake', () => {
    expect(() => proRataShares(nets({ a: 0n, b: -5n }), 1n)).toThrow(/beyond their recorded stakes/);
    expect(() => proRataShares(new Map(), 1n)).toThrow(/beyond their recorded stakes/);
  });
});
