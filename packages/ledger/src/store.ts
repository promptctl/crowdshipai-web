import type {
  Account,
  AccountId,
  AccountKind,
  IdempotencyKey,
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
 * `append` rejects (never returns) if asked to record a transaction id — or an
 * idempotency key — already in the log: each is corruption of the one
 * authoritative record (a double-post that bypassed the boundary's dedup), halted
 * loudly rather than recorded [LAW:no-silent-failure]. The log therefore holds at
 * most one transaction per idempotency key, which is what makes
 * {@link findByIdempotencyKey} a total lookup.
 */
export interface LedgerStore {
  openAccount(account: Account): Promise<Result<void, AccountConflict>>;
  kindOf(id: AccountId): Promise<AccountKind | undefined>;
  accounts(): Promise<readonly Account[]>;
  append(txn: Transaction): Promise<void>;
  history(): Promise<readonly Transaction[]>;
  balances(): Promise<ReadonlyMap<AccountId, bigint>>;
  /** The transaction already recorded under this idempotency key, if any — the
   *  seam the idempotent boundary reads to replay a retry instead of double-
   *  posting. A pure lookup into the authoritative log: it returns only the
   *  recorded transaction, never derived balances, so every engine behind this
   *  seam (a durable store, TigerBeetle's native idempotency) implements a lookup
   *  and nothing more — the receipt's balances are derived above the seam by the
   *  one domain function {@link resultingBalances} [LAW:locality-or-seam]. */
  findByIdempotencyKey(key: IdempotencyKey): Promise<Transaction | undefined>;
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
  // Derived index over the log: idempotency key -> the one transaction that holds
  // it. Rebuildable by replaying the log (exactly like #ids), so it is not a
  // second source of truth — just a fast lookup into the authoritative record.
  readonly #byKey = new Map<IdempotencyKey, Transaction>();

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
    // A re-appended transaction id, or a re-used idempotency key, would each mean
    // the same coin movement recorded twice — corruption of the one authoritative
    // record, not a domain outcome a caller chooses to handle. The boundary gates
    // both away before reaching here, so neither is reachable in correct
    // operation; if either fires we halt loudly rather than double-post, and
    // before mutating anything so a rejected append leaves the log untouched
    // [LAW:no-silent-failure].
    if (this.#ids.has(txn.id)) {
      throw new Error(`ledger corruption: transaction id already in log: ${txn.id}`);
    }
    if (this.#byKey.has(txn.idempotencyKey)) {
      throw new Error(`ledger corruption: idempotency key already in log: ${txn.idempotencyKey}`);
    }
    this.#ids.add(txn.id);
    this.#byKey.set(txn.idempotencyKey, txn);
    this.#log.push(txn);
    return Promise.resolve();
  }

  findByIdempotencyKey(key: IdempotencyKey): Promise<Transaction | undefined> {
    return Promise.resolve(this.#byKey.get(key));
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
