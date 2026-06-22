import type { Timestamp } from '@crowdship/std';
import type { Account } from './account.js';
import type { AccountId, SessionId } from './ids.js';

/**
 * A live authenticated span for one account. The bearer `SessionToken` is NOT a
 * field here: the token is the client's secret, surrendered once at login; the
 * stored session is what the token resolves *to* [LAW:effects-at-boundaries].
 * Lifetime is data — `issuedAt`/`expiresAt` — not an ambient timer, so expiry is
 * a pure function of a session and a clock reading [LAW:no-ambient-temporal-coupling].
 */
export interface Session {
  readonly id: SessionId;
  readonly accountId: AccountId;
  readonly issuedAt: Timestamp;
  readonly expiresAt: Timestamp;
}

/** A session is live until the instant it expires; at `expiresAt` exactly it is over. */
export const isExpired = (session: Session, now: Timestamp): boolean => now >= session.expiresAt;

/**
 * The resolved principal a `SessionToken` stands for: the account and the live
 * session proving it. This is the value the single auth gate (bb2.5) hands to a
 * request handler — the one shape downstream code may assume "is authenticated".
 */
export interface Authenticated {
  readonly account: Account;
  readonly session: Session;
}
