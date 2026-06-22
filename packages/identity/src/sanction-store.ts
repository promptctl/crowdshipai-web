import type { AccountId } from './ids.js';
import type { Sanction } from './sanction.js';

/**
 * Persistence for enforcement actions, keyed by the account they bind to — the
 * smallest seam the conduct logic needs [LAW:locality-or-seam], the same shape
 * {@link ChannelStore} and {@link AuthStore} follow. Sanctions attach to the ACCOUNT,
 * never a channel or session, which is what makes a ban survive a builder abandoning
 * their channel or starting a fresh session [LAW:one-source-of-truth].
 *
 * Append-only: a {@link Sanction} is a historical fact, so the store records and reads
 * but never edits or deletes one — a lifted ban is a NEW sanction (or simply a timed
 * one expiring), not a row mutated away, so the enforcement history stays honest
 * [LAW:no-silent-failure]. WHICH sanction governs an account right now is not the
 * store's call but `effectiveSanction`'s, a pure read over the list — the store holds
 * the truth, the derivation reads it. Every method is async so a durable table sits
 * behind this seam unchanged [LAW:effects-at-boundaries].
 */
export interface SanctionStore {
  /** Record a sanction against an account. Append-only; existing sanctions are untouched. */
  record(account: AccountId, sanction: Sanction): Promise<void>;
  /** Every sanction recorded against an account, in record order. Empty when none. */
  forAccount(account: AccountId): Promise<readonly Sanction[]>;
}

/**
 * The reference {@link SanctionStore}: an in-memory log of sanctions per account. The
 * walking-skeleton/test implementation; a durable store (a SQLite adapter) swaps in
 * behind the same seam without touching the conduct edge.
 *
 * `forAccount` hands back a fresh array, so a caller mutating the result cannot corrupt
 * the log [LAW:one-source-of-truth] — the same snapshot defense the audit trail makes.
 */
export class InMemorySanctionStore implements SanctionStore {
  readonly #byAccount = new Map<AccountId, Sanction[]>();

  record(account: AccountId, sanction: Sanction): Promise<void> {
    const existing = this.#byAccount.get(account);
    if (existing === undefined) this.#byAccount.set(account, [sanction]);
    else existing.push(sanction);
    return Promise.resolve();
  }

  forAccount(account: AccountId): Promise<readonly Sanction[]> {
    return Promise.resolve([...(this.#byAccount.get(account) ?? [])]);
  }
}
