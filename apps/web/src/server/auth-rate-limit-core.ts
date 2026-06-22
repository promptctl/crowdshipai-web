import type { Clock } from '@crowdship/std';
import { acquireInOrder, SlidingWindowRateLimiter, type RateLimiter } from '@crowdship/rate-limit';

/**
 * The PURE half of the web tier's auth-attempt throttle: the policy (two sliding
 * windows, denied if either trips) and the decision over an injected clock and
 * limiters, with no reach for ambient time or process-global state. The effectful
 * half — one process-wide singleton built on the real {@link SystemClock} and
 * cached on `globalThis` — lives in `./auth-rate-limit`, which imports this and is
 * the only thing that ever names a concrete clock [LAW:effects-at-boundaries].
 *
 * Keeping the decision here, free of that singleton (and of the node-runtime
 * `SystemClock` import that drags `node:sqlite` in behind it), is what lets a test
 * drive the exact composition the production edge runs — same limits, same IP-first
 * ordering — against a fake clock, deterministically.
 *
 * The two windows:
 *  - per-IP    — bounds how fast one network source can enqueue scrypt work, the
 *                volume lever in a CPU/heap DoS.
 *  - per-email — bounds brute force against one account regardless of source, and
 *                is the spoof-resistant backstop when X-Forwarded-For is untrusted
 *                (see {@link clientIp}).
 */

// A single source may start 10 scrypt-bearing attempts per 30s; an account may be
// targeted 5 times per 30s. Tunable — the shape (sliding window, IP ∧ email) is
// the contract, the numbers are not. The single source of truth for these limits:
// both the production singleton and the tests build limiters through
// {@link createAuthLimiters}, so a test can never silently assert a stale number.
export const IP_LIMIT = 10;
export const EMAIL_LIMIT = 5;
export const WINDOW_MILLIS = 30_000;

/**
 * One clock and the two limiters it judges, bundled so a caller holds a single
 * value rather than three correlated ones. The clock is the {@link Clock} port,
 * never a concrete class, so the owner injects real or fake time [LAW:no-ambient-temporal-coupling].
 */
export interface AuthLimiters {
  readonly clock: Clock;
  readonly ip: RateLimiter;
  readonly email: RateLimiter;
}

/**
 * Build the production limiter composition over a supplied clock: the IP and email
 * sliding windows at the policy limits above. The clock is a parameter, not a
 * `new SystemClock()` reached for here, so this same factory serves both the
 * process singleton (real clock) and tests (fake clock) with one definition of the
 * windows [LAW:one-source-of-truth].
 */
export function createAuthLimiters(clock: Clock): AuthLimiters {
  return {
    clock,
    ip: new SlidingWindowRateLimiter({ limit: IP_LIMIT, windowMillis: WINDOW_MILLIS }),
    email: new SlidingWindowRateLimiter({ limit: EMAIL_LIMIT, windowMillis: WINDOW_MILLIS }),
  };
}

/** Granted, or denied with the time until a slot frees — a value the edge destructures. */
export type AuthRateLimitOutcome =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterMillis: number };

/**
 * Decide whether one auth attempt may proceed to scrypt, against the supplied
 * limiters. Reads `now` once from the bundle's clock and applies it to both windows
 * for a consistent snapshot [LAW:no-ambient-temporal-coupling]. The IP window is
 * listed first so a source already over its limit is denied without touching the
 * per-email window — a flood from one IP cannot consume a victim account's budget
 * (the short-circuit guarantee proven in `acquireInOrder`).
 */
export function decideAuthRateLimit(
  limiters: AuthLimiters,
  attempt: { readonly ip: string; readonly email: string },
): AuthRateLimitOutcome {
  const decision = acquireInOrder(
    [
      { limiter: limiters.ip, key: attempt.ip },
      { limiter: limiters.email, key: attempt.email },
    ],
    limiters.clock.now(),
  );
  return decision.allowed ? { allowed: true } : { allowed: false, retryAfterMillis: decision.retryAfterMillis };
}
