/**
 * Rate limiting as a standalone capability [LAW:decomposition]: a {@link RateLimiter}
 * port and an in-memory {@link SlidingWindowRateLimiter} that rate-limits a single
 * string key against a sliding window. It knows nothing of auth, IPs, or accounts
 * — callers compose those policies on top — so it stands on `@crowdship/std` alone
 * and is reusable by any boundary that must bound a per-key rate [LAW:one-way-deps].
 */
export type { RateLimitDecision, RateLimitPolicy, RateLimiter } from './sliding-window.js';
export { SlidingWindowRateLimiter } from './sliding-window.js';
export type { RateLimitRequest } from './composite.js';
export { acquireInOrder } from './composite.js';
