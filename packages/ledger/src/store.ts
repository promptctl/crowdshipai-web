import type {
  Account,
  AccountId,
  AccountKind,
  Transaction,
  TransactionId,
} from '@crowdship/ledger-kernel';
import { netEffect, ok, err } from '@crowdship/ledger-kernel';
import type { Result } from '@crowdship/ledger-kernel';

/**
 * Opening an account that already exists with a different kind is refused: an
 * account's negativity rule is fixed when it is opened and must never change
 * underneath the balances that depend on it. Re-opening with the *same* kind is
 * a no-op success, so bootstrap and retry are safe.
 */
export type AccountConflict = {
  readonly kind: 'kind-conflict';
  readonly id: AccountId;
  readonly existing: AccountKind;
  readonly requested: AccountKind;
};

/**
 * Persistence for the ledger, expressed as the smallest seam the write path
 * needs [LAW:locality-or-seam]. The append-only transaction log is the single
 * authoritative record; the account registry is the authority on which accounts
 * exist and their kinds. Everything else — balances above all — is *derived*
 * from the log and never stored as a second truth [LAW:one-source-of-truth].
 *
 * There is deliberately no update or delete of a posted transaction: history is
 * append-only by the shape of this interface, not by a rule callers remember
 * [LAW:types-are-the-program]. The methods are async so a real database or
 * settlement rail can sit behind this seam unchanged [LAW:effects-at-boundaries].
 *
 * Serialization of writes is owned by the boundary above (the `Ledger`), not by
 * the store — so an implementation may assume a single writer at a time and need
 * not guard its own read-modify-write [LAW:no-ambient-temporal-coupling]. A
 * caller using this interface directly must uphold that precondition.
 *
 * `append` rejects (never returns) if asked to record a transaction id already
 * in the log: that is corruption of the one authoritative record, halted loudly
 * rather than double-posted [LAW:no-silent-failure].
 */
export interface LedgerStore {
  openAccount(account: Account): Promise<Result<void, AccountConflict>>;
  kindOf(id: AccountId): Promise<AccountKind | undefined>;
  accounts(): Promise<readonly Account[]>;
  append(txn: Transaction): Promise<void>;
  history(): Promise<readonly Transaction[]>;
  balances(): Promise<ReadonlyMap<AccountId, bigint>>;
}

/**
 * The reference store: an in-memory append-only log and account registry. It is
 * the walking-skeleton implementation of {@link LedgerStore}; a durable store
 * swaps in behind the same seam without touching the write path.
 *
 * Balances are computed by folding the authoritative log on demand, so the
 * derived number can never drift from history — there is no incremental balance
 * field that could fall out of step. (Ledger ticket .7 may introduce a derived
 * index for throughput; ticket .4 owns reconciling any such index against this
 * fold. The fold here remains the meaning of "balance".)
 */
export class InMemoryLedgerStore implements LedgerStore {
  readonly #registry = new Map<AccountId, AccountKind>();
  readonly #log: Transaction[] = [];
  readonly #ids = new Set<TransactionId>();

  openAccount(account: Account): Promise<Result<void, AccountConflict>> {
    const existing = this.#registry.get(account.id);
    if (existing !== undefined && existing !== account.kind) {
      return Promise.resolve(
        err({ kind: 'kind-conflict', id: account.id, existing, requested: account.kind }),
      );
    }
    this.#registry.set(account.id, account.kind);
    return Promise.resolve(ok(undefined));
  }

  kindOf(id: AccountId): Promise<AccountKind | undefined> {
    return Promise.resolve(this.#registry.get(id));
  }

  accounts(): Promise<readonly Account[]> {
    return Promise.resolve([...this.#registry].map(([id, kind]) => ({ id, kind })));
  }

  append(txn: Transaction): Promise<void> {
    // A re-appended transaction id would mean the same coin movement recorded
    // twice — corruption of the one authoritative record, not a domain outcome a
    // caller chooses to handle. Generated ids are unique, so this is unreachable
    // in practice; if it ever fires we halt loudly rather than double-post
    // [LAW:no-silent-failure].
    if (this.#ids.has(txn.id)) {
      throw new Error(`ledger corruption: transaction id already in log: ${txn.id}`);
    }
    this.#ids.add(txn.id);
    this.#log.push(txn);
    return Promise.resolve();
  }

  history(): Promise<readonly Transaction[]> {
    return Promise.resolve([...this.#log]);
  }

  balances(): Promise<ReadonlyMap<AccountId, bigint>> {
    const balances = new Map<AccountId, bigint>();
    for (const txn of this.#log) {
      for (const [account, delta] of netEffect(txn)) {
        balances.set(account, (balances.get(account) ?? 0n) + delta);
      }
    }
    for (const [account, balance] of balances) {
      if (balance === 0n) balances.delete(account);
    }
    return Promise.resolve(balances);
  }
}
