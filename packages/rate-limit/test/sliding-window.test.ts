import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import type { Result, Timestamp } from '@crowdship/std';
import { timestamp } from '@crowdship/std';

import { SlidingWindowRateLimiter, type RateLimitDecision, type RateLimitPolicy } from '../src/index.js';

/** Test-only: unwrap a Result loudly. A contract test must never silently proceed past a failed construction. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const ts = (n: number): Timestamp => must(timestamp(n));

/**
 * An independent reference model of the contract: a permit is granted iff fewer
 * than `limit` permits already sit within the half-open window `(now - W, now]`.
 * Deliberately a DIFFERENT implementation from the engine (recompute-from-history,
 * no pruning) so the property witnesses behavior, not a mirror of the code
 * [LAW:behavior-not-structure].
 */
const modelAllows = (policy: RateLimitPolicy, events: readonly { key: string; now: number }[]): boolean[] => {
  const granted = new Map<string, number[]>();
  return events.map(({ key, now }) => {
    const within = (granted.get(key) ?? []).filter((t) => t > now - policy.windowMillis);
    const allowed = within.length < policy.limit;
    if (allowed) within.push(now);
    granted.set(key, within);
    return allowed;
  });
};

describe('SlidingWindowRateLimiter', () => {
  test('rejects a non-sensical policy at construction', () => {
    expect(() => new SlidingWindowRateLimiter({ limit: 0, windowMillis: 1000 })).toThrow(RangeError);
    expect(() => new SlidingWindowRateLimiter({ limit: 3, windowMillis: 0 })).toThrow(RangeError);
    expect(() => new SlidingWindowRateLimiter({ limit: 1.5, windowMillis: 1000 })).toThrow(RangeError);
  });

  test('grants up to the limit, then denies, within one window', () => {
    const limiter = new SlidingWindowRateLimiter({ limit: 3, windowMillis: 1000 });
    expect(limiter.tryAcquire('k', ts(0))).toEqual({ allowed: true, remaining: 2 });
    expect(limiter.tryAcquire('k', ts(100))).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.tryAcquire('k', ts(200))).toEqual({ allowed: true, remaining: 0 });
    const denied = limiter.tryAcquire('k', ts(300));
    expect(denied.allowed).toBe(false);
    // The first hit (t=0) ages out at t=1000, so retry is possible 700ms later.
    if (!denied.allowed) expect(denied.retryAfterMillis).toBe(700);
  });

  test('a permit frees once the oldest hit ages out of the window', () => {
    const limiter = new SlidingWindowRateLimiter({ limit: 1, windowMillis: 1000 });
    expect(limiter.tryAcquire('k', ts(0)).allowed).toBe(true);
    expect(limiter.tryAcquire('k', ts(500)).allowed).toBe(false); // t=0 hit still inside (−500, 500]
    // The window is half-open (now−W, now]: at now=1000 the t=0 hit sits exactly on
    // the excluded edge (now−W), so it no longer counts and a permit frees.
    expect(limiter.tryAcquire('k', ts(1000)).allowed).toBe(true);
  });

  test('distinct keys carry independent budgets', () => {
    const limiter = new SlidingWindowRateLimiter({ limit: 1, windowMillis: 1000 });
    expect(limiter.tryAcquire('a', ts(0)).allowed).toBe(true);
    expect(limiter.tryAcquire('b', ts(0)).allowed).toBe(true); // 'a' exhausted, 'b' untouched
    expect(limiter.tryAcquire('a', ts(0)).allowed).toBe(false);
  });

  test('matches the reference model over arbitrary monotonic request streams', () => {
    fc.assert(
      fc.property(
        fc.record({ limit: fc.integer({ min: 1, max: 5 }), windowMillis: fc.integer({ min: 1, max: 5000 }) }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.array(
          fc.record({ key: fc.constantFrom('a', 'b', 'c'), advance: fc.nat({ max: 8000 }) }),
          { maxLength: 200 },
        ),
        (policy, start, steps) => {
          // Accumulate non-decreasing instants — the contract assumes a monotonic
          // clock, the same guarantee a real Clock provides [LAW:no-ambient-temporal-coupling].
          let now = start;
          const events = steps.map(({ key, advance }) => {
            now += advance;
            return { key, now };
          });

          const expected = modelAllows(policy, events);
          const limiter = new SlidingWindowRateLimiter(policy);
          events.forEach(({ key, now: at }, i) => {
            const decision: RateLimitDecision = limiter.tryAcquire(key, ts(at));
            expect(decision.allowed).toBe(expected[i]);
            // A denial always names a real, bounded retry horizon.
            if (!decision.allowed) {
              expect(decision.retryAfterMillis).toBeGreaterThan(0);
              expect(decision.retryAfterMillis).toBeLessThanOrEqual(policy.windowMillis);
            }
          });
        },
      ),
    );
  });

  test('never grants more than `limit` permits in any window-wide span', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 2000 }),
        fc.array(fc.nat({ max: 6000 }), { maxLength: 150 }),
        (limit, windowMillis, advances) => {
          const limiter = new SlidingWindowRateLimiter({ limit, windowMillis });
          let now = 0;
          const grantedAt: number[] = [];
          for (const advance of advances) {
            now += advance;
            const decision = limiter.tryAcquire('k', ts(now));
            if (decision.allowed) grantedAt.push(now);
          }
          // For every granted instant, the count of grants in the trailing window
          // (t - W, t] never exceeds the limit.
          for (const t of grantedAt) {
            const inWindow = grantedAt.filter((g) => g > t - windowMillis && g <= t).length;
            expect(inWindow).toBeLessThanOrEqual(limit);
          }
        },
      ),
    );
  });
});
