import type { Timestamp } from '@crowdship/std';

/**
 * How many permits a key may take, and over how wide a sliding window. A duration
 * (`windowMillis`) and a count (`limit`) — both plain magnitudes, validated once
 * at construction so every later decision can assume them well-formed
 * [LAW:types-are-the-program].
 */
export interface RateLimitPolicy {
  /** Maximum permits granted to one key within any `windowMillis`-wide window. */
  readonly limit: number;
  /** The sliding window's width, in milliseconds. */
  readonly windowMillis: number;
}

/**
 * The outcome of asking for a permit: a value the caller destructures, never a
 * bare boolean that drops the "when can I retry" information on the floor
 * [LAW:no-silent-failure]. `retryAfterMillis` is the time until the oldest hit in
 * the window ages out and a slot frees — always in `(0, windowMillis]`.
 */
export type RateLimitDecision =
  | { readonly allowed: true; readonly remaining: number }
  | { readonly allowed: false; readonly retryAfterMillis: number };

/**
 * The capability of rate-limiting one key. A port so the in-memory engine below
 * can be swapped for a shared store (Redis, a durable counter) when the platform
 * runs more than one instance — the call sites depend on this contract, never the
 * implementation [LAW:locality-or-seam].
 */
export interface RateLimiter {
  /**
   * Try to take one permit for `key` at instant `now`. Records the attempt iff it
   * is granted. `now` is supplied by the boundary that owns the clock — the
   * limiter never reaches for ambient time [LAW:no-ambient-temporal-coupling].
   */
  tryAcquire(key: string, now: Timestamp): RateLimitDecision;
}

// How many acquisitions between opportunistic sweeps of fully-aged-out keys. The
// per-key prune on access keeps each window honest; this bounds the map's key
// count under an attacker who rotates keys to never touch the same one twice —
// without it the in-memory store grows unbounded, which would make a control
// meant to PREVENT resource exhaustion into a vector for it.
const SWEEP_EVERY_ACQUISITIONS = 1024;

/**
 * An in-memory sliding-window rate limiter: for each key it keeps the ascending
 * timestamps of granted permits still inside the window, grants while that count
 * is below `limit`, and denies otherwise. Single-instance only — its state is a
 * process-local Map it solely owns [LAW:no-shared-mutable-globals]. Multi-instance
 * deployments swap a shared-store {@link RateLimiter} behind the same seam.
 *
 * Synchronous by construction: `tryAcquire` performs no `await`, so on Node's
 * single-threaded loop the read-decide-record is atomic — two concurrent callers
 * cannot both squeeze past the limit [LAW:no-ambient-temporal-coupling].
 */
export class SlidingWindowRateLimiter implements RateLimiter {
  readonly #limit: number;
  readonly #windowMillis: number;
  // key -> ascending granted-permit timestamps still within the window.
  readonly #hits = new Map<string, number[]>();
  #acquisitionsSinceSweep = 0;

  constructor(policy: RateLimitPolicy) {
    if (!Number.isInteger(policy.limit) || policy.limit < 1) {
      throw new RangeError(`rate-limit policy.limit must be a positive integer, got ${policy.limit}`);
    }
    if (!Number.isInteger(policy.windowMillis) || policy.windowMillis < 1) {
      throw new RangeError(`rate-limit policy.windowMillis must be a positive integer, got ${policy.windowMillis}`);
    }
    this.#limit = policy.limit;
    this.#windowMillis = policy.windowMillis;
  }

  tryAcquire(key: string, now: Timestamp): RateLimitDecision {
    this.#maybeSweep(now);
    const cutoff = now - this.#windowMillis;
    // A hit at exactly `cutoff` has fully aged out; only strictly-newer hits count.
    const recent = (this.#hits.get(key) ?? []).filter((t) => t > cutoff);

    if (recent.length >= this.#limit) {
      // recent is ascending, so its head is the oldest hit; it must exist because
      // length >= limit >= 1. A loud throw documents that invariant rather than
      // letting a `!` assert it silently [LAW:no-silent-failure].
      const oldest = recent[0];
      if (oldest === undefined) throw new Error('rate-limit invariant: a saturated window is non-empty');
      this.#hits.set(key, recent);
      return { allowed: false, retryAfterMillis: oldest + this.#windowMillis - now };
    }

    recent.push(now);
    this.#hits.set(key, recent);
    return { allowed: true, remaining: this.#limit - recent.length };
  }

  // Drop keys whose newest hit has aged out of the window. Cheap amortized: runs
  // once per SWEEP_EVERY_ACQUISITIONS, and only ever removes keys a fresh
  // tryAcquire would have pruned to empty anyway — never changes a decision.
  #maybeSweep(now: Timestamp): void {
    if (++this.#acquisitionsSinceSweep < SWEEP_EVERY_ACQUISITIONS) return;
    this.#acquisitionsSinceSweep = 0;
    const cutoff = now - this.#windowMillis;
    for (const [key, hits] of this.#hits) {
      const newest = hits[hits.length - 1];
      if (newest === undefined || newest <= cutoff) this.#hits.delete(key);
    }
  }
}
