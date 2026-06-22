import { describe, expect, test } from 'vitest';

import type { Result, Timestamp } from '@crowdship/std';
import { timestamp } from '@crowdship/std';

import { acquireInOrder, SlidingWindowRateLimiter } from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};
const ts = (n: number): Timestamp => must(timestamp(n));

describe('acquireInOrder', () => {
  test('grants only when every limiter grants', () => {
    const ip = new SlidingWindowRateLimiter({ limit: 5, windowMillis: 1000 });
    const email = new SlidingWindowRateLimiter({ limit: 5, windowMillis: 1000 });
    const d = acquireInOrder([{ limiter: ip, key: 'a' }, { limiter: email, key: 'x' }], ts(0));
    expect(d.allowed).toBe(true);
  });

  test('reports the tightest surviving budget as remaining', () => {
    const ip = new SlidingWindowRateLimiter({ limit: 10, windowMillis: 1000 });
    const email = new SlidingWindowRateLimiter({ limit: 3, windowMillis: 1000 });
    const d = acquireInOrder([{ limiter: ip, key: 'a' }, { limiter: email, key: 'x' }], ts(0));
    // ip has 9 left, email has 2 left → the binding constraint is 2.
    expect(d).toEqual({ allowed: true, remaining: 2 });
  });

  test('a denial short-circuits: limiters after the first failure are never consumed', () => {
    const ip = new SlidingWindowRateLimiter({ limit: 1, windowMillis: 1000 });
    const email = new SlidingWindowRateLimiter({ limit: 1, windowMillis: 1000 });
    // Exhaust the IP window for source 'a'.
    expect(acquireInOrder([{ limiter: ip, key: 'a' }, { limiter: email, key: 'x' }], ts(0)).allowed).toBe(true);
    // A second attempt from 'a' targeting a FRESH victim email 'z' must be denied
    // by the IP window — and must NOT spend victim 'z's email budget.
    const denied = acquireInOrder([{ limiter: ip, key: 'a' }, { limiter: email, key: 'z' }], ts(0));
    expect(denied.allowed).toBe(false);
    // Proof 'z' was untouched: it still has its full permit available.
    expect(email.tryAcquire('z', ts(0)).allowed).toBe(true);
  });

  test('limiters before the first failure DO record their permit', () => {
    const ip = new SlidingWindowRateLimiter({ limit: 1, windowMillis: 1000 });
    const email = new SlidingWindowRateLimiter({ limit: 1, windowMillis: 1000 });
    // Use up email 'x' so the next attempt fails at the email (second) window.
    expect(acquireInOrder([{ limiter: ip, key: 'a' }, { limiter: email, key: 'x' }], ts(0)).allowed).toBe(true);
    // Source 'b' passes the IP window (recording 'b'), then trips the email window.
    expect(acquireInOrder([{ limiter: ip, key: 'b' }, { limiter: email, key: 'x' }], ts(0)).allowed).toBe(false);
    // Proof 'b' was recorded despite the overall denial: its IP window is now spent.
    expect(ip.tryAcquire('b', ts(0)).allowed).toBe(false);
  });
});
