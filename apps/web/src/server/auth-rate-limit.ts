import { SystemClock } from '@crowdship/identity-node';
import { acquireInOrder, SlidingWindowRateLimiter, type RateLimiter } from '@crowdship/rate-limit';

/**
 * The web tier's auth-attempt throttle: the single place the scrypt-bearing edges
 * (the NextAuth `authorize` login path and the signup server action) ask "may this
 * attempt proceed?" BEFORE spending a ~134MB scrypt [LAW:single-enforcer]. Two
 * windows, denied if EITHER trips:
 *
 *  - per-IP    — bounds how fast one network source can enqueue scrypt work, the
 *                volume lever in a CPU/heap DoS.
 *  - per-email — bounds brute force against one account regardless of source, and
 *                is the spoof-resistant backstop when X-Forwarded-For is untrusted
 *                (see {@link clientIp}).
 *
 * The limits are policy knobs, intentionally generous for shared-NAT clients while
 * still capping a single source/account. In-memory and single-instance for now
 * [LAW:no-shared-mutable-globals]; both limiters sit behind the {@link RateLimiter}
 * seam, so a shared-store swap for multi-instance is a change here and nowhere else.
 */

// A single source may start 10 scrypt-bearing attempts per 30s; an account may be
// targeted 5 times per 30s. Tunable — the shape (sliding window, IP ∧ email) is
// the contract, the numbers are not.
const IP_LIMIT = 10;
const EMAIL_LIMIT = 5;
const WINDOW_MILLIS = 30_000;

interface AuthLimiters {
  readonly clock: SystemClock;
  readonly ip: RateLimiter;
  readonly email: RateLimiter;
}

const build = (): AuthLimiters => ({
  clock: new SystemClock(),
  ip: new SlidingWindowRateLimiter({ limit: IP_LIMIT, windowMillis: WINDOW_MILLIS }),
  email: new SlidingWindowRateLimiter({ limit: EMAIL_LIMIT, windowMillis: WINDOW_MILLIS }),
});

// One set of limiters per process, the single owner of the in-memory windows.
// Cached on globalThis so Next.js dev HMR reuses the same counters across module
// re-evaluation instead of silently resetting the limit on every edit.
const globalForLimit = globalThis as unknown as { __crowdshipAuthLimiters?: AuthLimiters };
const limiters: AuthLimiters = globalForLimit.__crowdshipAuthLimiters ?? build();
if (process.env.NODE_ENV !== 'production') globalForLimit.__crowdshipAuthLimiters = limiters;

/** Granted, or denied with the time until a slot frees — a value the edge destructures. */
export type AuthRateLimitOutcome =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterMillis: number };

/**
 * Decide whether one auth attempt may proceed to scrypt. Reads `now` once and
 * applies it to both windows for a consistent snapshot [LAW:no-ambient-temporal-coupling].
 * The IP window is listed first so a source already over its limit is denied
 * without touching the per-email window — a flood from one IP cannot consume a
 * victim account's budget (the short-circuit guarantee proven in `acquireInOrder`).
 */
export function enforceAuthRateLimit(attempt: { readonly ip: string; readonly email: string }): AuthRateLimitOutcome {
  const decision = acquireInOrder(
    [
      { limiter: limiters.ip, key: attempt.ip },
      { limiter: limiters.email, key: attempt.email },
    ],
    limiters.clock.now(),
  );
  return decision.allowed ? { allowed: true } : { allowed: false, retryAfterMillis: decision.retryAfterMillis };
}
