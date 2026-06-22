import type { AccountId } from './ids.js';

/**
 * The kind of an account. It decides exactly one domain rule: whether the
 * account may carry a negative balance. Only the mint may — its negative
 * balance is, by definition, the total number of coins in circulation. Every
 * other kind going negative would mean coins came from nowhere.
 */
export type AccountKind = 'user-wallet' | 'escrow' | 'platform-revenue' | 'mint';

export interface Account {
  readonly id: AccountId;
  readonly kind: AccountKind;
}

/**
 * The single source of truth for which kinds may go negative
 * [LAW:one-source-of-truth]. The kernel states the rule; the settlement engine
 * behind the `Ledger` seam is the one place that enforces it (TigerBeetle, via
 * the no-overdraft account flag) [LAW:single-enforcer].
 */
export const mayGoNegative = (kind: AccountKind): boolean => kind === 'mint';
