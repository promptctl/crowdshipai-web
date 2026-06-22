import { SystemClock } from '@crowdship/identity-node';
import {
  createAuthLimiters,
  decideAuthRateLimit,
  type AuthLimiters,
  type AuthRateLimitOutcome,
} from './auth-rate-limit-core';

/**
 * The EFFECTFUL half of the web tier's auth-attempt throttle: the single
 * process-wide limiter set the scrypt-bearing edges (the NextAuth `authorize`
 * login path and the signup server action) consult BEFORE spending a ~134MB scrypt
 * [LAW:single-enforcer]. The policy and the decision live in
 * `./auth-rate-limit-core`; this module is just the composition root that binds the
 * real wall clock and owns the in-memory windows for the process.
 *
 * In-memory and single-instance for now [LAW:no-shared-mutable-globals]; both
 * limiters sit behind the `RateLimiter` seam in the core, so a shared-store swap
 * for multi-instance is a change there and nowhere else.
 */

// One set of limiters per process, the single owner of the in-memory windows.
// Cached on globalThis so Next.js dev HMR reuses the same counters across module
// re-evaluation instead of silently resetting the limit on every edit.
const globalForLimit = globalThis as unknown as { __crowdshipAuthLimiters?: AuthLimiters };
const limiters: AuthLimiters = globalForLimit.__crowdshipAuthLimiters ?? createAuthLimiters(new SystemClock());
if (process.env.NODE_ENV !== 'production') globalForLimit.__crowdshipAuthLimiters = limiters;

export type { AuthRateLimitOutcome };

/**
 * Decide whether one auth attempt may proceed to scrypt, against the process
 * singleton. The injectable form is {@link decideAuthRateLimit} in the core; the
 * auth edges call this binding so they share the one set of windows.
 */
export function enforceAuthRateLimit(attempt: { readonly ip: string; readonly email: string }): AuthRateLimitOutcome {
  return decideAuthRateLimit(limiters, attempt);
}
