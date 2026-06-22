import type { Timestamp } from '@crowdship/std';

import type { RateLimitDecision, RateLimiter } from './sliding-window.js';

/** One limiter to consult and the key to consult it with — a (window, identity) pair. */
export interface RateLimitRequest {
  readonly limiter: RateLimiter;
  readonly key: string;
}

/**
 * Acquire one permit from each limiter in order, denying on the FIRST that trips.
 * The order is load-bearing, not incidental [LAW:no-ambient-temporal-coupling]: a
 * denial short-circuits, so limiters listed after the one that denies are never
 * touched — their budgets are not spent on an attempt that was already doomed.
 * Front-load the limiter keyed to the abuser (e.g. source IP) so a flood from one
 * source cannot consume a co-located victim's per-account budget.
 *
 * All requests share the single `now` the caller passes, so every window is judged
 * against one consistent instant. The list is a NON-EMPTY tuple: "check no windows"
 * is not a thing a caller means, so the type forbids it [LAW:types-are-the-program]
 * — which is also what guarantees the `Math.min` below always has an argument and
 * `remaining` is always a real, finite budget.
 */
export function acquireInOrder(
  requests: readonly [RateLimitRequest, ...RateLimitRequest[]],
  now: Timestamp,
): RateLimitDecision {
  const remainings: number[] = [];
  for (const { limiter, key } of requests) {
    const decision = limiter.tryAcquire(key, now);
    if (!decision.allowed) return decision;
    remainings.push(decision.remaining);
  }
  // The tightest surviving budget is the one that will deny first next time.
  return { allowed: true, remaining: Math.min(...remainings) };
}
