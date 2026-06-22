import type {
  Account,
  AccountId,
  AccountKind,
  IdempotencyKey,
  Timestamp,
  Transaction,
  TransactionId,
  TransactionReason,
  Transfer,
  TransactionError,
} from '@crowdship/ledger-kernel';
import { err, ok, timestamp, transaction, transactionId } from '@crowdship/ledger-kernel';
import type { Result } from '@crowdship/ledger-kernel';

import { resultingBalances } from './balances.js';
import { decideIdempotency, type IdempotencyConflict } from './idempotency.js';
import { decidePosting, type LedgerView, type PostingRejection } from './posting.js';
import { InMemoryLedgerStore, type AccountConflict, type LedgerStore } from './store.js';

/** Supplies the moment a transaction occurred. The boundary owns time; the
 *  kernel never reads a clock [LAW:no-ambient-temporal-coupling]. */
export type Clock = () => Timestamp;

/** Mints a fresh, unique transaction id. The boundary owns identity and
 *  randomness; the kernel never generates either [LAW:effects-at-boundaries]. */
export type TransactionIdSource = () => TransactionId;

/** What a caller asks the ledger to record: the balanced transfers, why they
 *  moved, and the idempotency key carried into the transaction. The id and the
 *  occurred-at moment are supplied by the boundary, never by the caller. The key
 *  makes the post idempotent: re-sending the same request under the same key
 *  returns the original receipt instead of recording a second movement, so a
 *  retry can never double-spend. */
export interface PostRequest {
  readonly transfers: readonly Transfer[];
  readonly reason: TransactionReason;
  readonly idempotencyKey: IdempotencyKey;
}

/** The proof a post happened: the transaction as recorded (with its generated
 *  id and timestamp) and the resulting balance of every account it changed. */
export interface PostReceipt {
  readonly transaction: Transaction;
  readonly balances: ReadonlyMap<AccountId, bigint>;
}

/** Every way a post can fail *as a domain outcome*, as one closed union of
 *  values the caller destructures: the transaction was ill-formed, the single
 *  enforcer refused it, or its idempotency key was already spent on a *different*
 *  operation. These are never thrown. A breach of the ledger's own integrity — a
 *  duplicate transaction id or a duplicate key reaching the log (see
 *  {@link LedgerStore.append}) — is deliberately NOT in this union: it is
 *  corruption, not a request a caller can reasonably handle, so it halts the post
 *  loudly by rejecting rather than being downgraded to a routine error someone
 *  might shrug off [LAW:no-silent-failure]. */
export type PostError = TransactionError | PostingRejection | IdempotencyConflict;

/**
 * The single write path for every coin movement [LAW:single-enforcer]. There is
 * no other way to mutate the ledger: all writes flow through `post` and
 * `openAccount`, and both are serialized through one owner so a read-decide-
 * append sequence can never interleave with another and tear [LAW:no-ambient-
 * temporal-coupling]. The serialization is explicit (a single-writer chain), not
 * an accident of synchronous execution.
 *
 * The boundary computes nothing about balance itself — it gathers state from the
 * store, asks the pure {@link decidePosting} gate, and only then acts by
 * appending [LAW:effects-at-boundaries]. The append-only log the store holds is
 * the authoritative record; balances are derived from it.
 */
export class Ledger {
  #tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: LedgerStore,
    private readonly clock: Clock,
    private readonly newTransactionId: TransactionIdSource,
  ) {}

  /** Runs `work` only after every previously enqueued write has settled, so at
   *  most one write is ever in flight. The chain never rejects (so one failed
   *  write does not poison the next), but the caller still receives `work`'s
   *  outcome — failures are surfaced, never swallowed [LAW:no-silent-failure].
   *  A `work` that never settles wedges every later write behind it; that is
   *  inherent to a single-writer queue and fine for the in-memory store (which
   *  always resolves). Bounding it (timeout / backpressure) belongs to the
   *  durable store boundary, where a hung settlement rail is possible. */
  #serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(work, work);
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Registers an account and its negativity rule. Idempotent for the same kind;
   *  refuses to change an existing account's kind. */
  openAccount(account: Account): Promise<Result<void, AccountConflict>> {
    return this.#serialize(() => this.store.openAccount(account));
  }

  /** Records one balanced coin movement, or returns the single reason it cannot
   *  be recorded. The only mutator of value in the system. Idempotent on the
   *  request's key: a retry of the same operation returns the original receipt and
   *  appends nothing, so it can never double-spend; reusing a key for a *different*
   *  operation is refused as a value. The dedup check and the append run in the
   *  same serialized critical section, so two concurrent retries of one key cannot
   *  both miss and both append [LAW:no-ambient-temporal-coupling]. Returns a
   *  `Result` for every domain outcome; it rejects only if the ledger's own
   *  integrity is breached (a duplicate id or key reaching the log), which halts
   *  loudly rather than silently double-posting [LAW:no-silent-failure]. */
  post(request: PostRequest): Promise<Result<PostReceipt, PostError>> {
    return this.#serialize(async (): Promise<Result<PostReceipt, PostError>> => {
      const prior = await this.store.findByIdempotencyKey(request.idempotencyKey);
      const idempotency = decideIdempotency(request, prior);
      switch (idempotency.kind) {
        case 'replay': {
          // The receipt of the prior post, re-derived from the authoritative log
          // by the one balance author — never a remembered copy, so it can never
          // disagree with history [LAW:one-source-of-truth].
          const history = await this.store.history();
          return ok({
            transaction: idempotency.recorded,
            balances: resultingBalances(history, idempotency.recorded),
          });
        }
        case 'conflict':
          return err(idempotency.conflict);
        case 'fresh':
          break;
      }

      const built = transaction({
        id: this.newTransactionId(),
        reason: request.reason,
        transfers: request.transfers,
        occurredAt: this.clock(),
        idempotencyKey: request.idempotencyKey,
      });
      if (!built.ok) return built;
      const txn = built.value;

      const kinds = new Map<AccountId, AccountKind | undefined>();
      for (const t of txn.transfers) {
        for (const account of [t.from, t.to]) {
          if (!kinds.has(account)) kinds.set(account, await this.store.kindOf(account));
        }
      }
      const balances = await this.store.balances();

      const view: LedgerView = {
        kindOf: (id) => kinds.get(id),
        balanceOf: (id) => balances.get(id) ?? 0n,
      };

      const decision = decidePosting(view, txn);
      if (!decision.ok) return decision;

      await this.store.append(txn);
      // The receipt's balances come from the one balance author folding the
      // authoritative log — the same function a later replay of this post will
      // use — so the fresh receipt and its replay are identical by construction,
      // not by two algorithms coinciding [LAW:one-source-of-truth].
      const history = await this.store.history();
      return ok({ transaction: txn, balances: resultingBalances(history, txn) });
    });
  }

  /** Derived, point-in-time balances (non-zero only). The authoritative source
   *  is the append-only log; ledger ticket .6 builds the full audit/query API on
   *  this same derivation. */
  balances(): Promise<ReadonlyMap<AccountId, bigint>> {
    return this.store.balances();
  }

  /** The authoritative append-only record, in posted order. */
  history(): Promise<readonly Transaction[]> {
    return this.store.history();
  }

  /** Every account the ledger knows and its kind. */
  accounts(): Promise<readonly Account[]> {
    return this.store.accounts();
  }
}

const systemClock: Clock = () => {
  const t = timestamp(Date.now());
  if (!t.ok) throw new Error(`system clock produced an invalid timestamp: ${JSON.stringify(t.error)}`);
  return t.value;
};

const uuidTransactionId: TransactionIdSource = () => {
  const id = transactionId(globalThis.crypto.randomUUID());
  if (!id.ok) throw new Error(`generated a blank transaction id: ${JSON.stringify(id.error)}`);
  return id.value;
};

export interface LedgerCapabilities {
  readonly store?: LedgerStore;
  readonly clock?: Clock;
  readonly newTransactionId?: TransactionIdSource;
}

/**
 * Builds a ledger with production capabilities by default: an in-memory store,
 * the system clock, and uuid transaction ids. Each capability can be overridden
 * — tests inject a deterministic clock and id source so posts are reproducible,
 * and a durable store swaps in behind the same seam [LAW:locality-or-seam].
 */
export const createLedger = (capabilities: LedgerCapabilities = {}): Ledger =>
  new Ledger(
    capabilities.store ?? new InMemoryLedgerStore(),
    capabilities.clock ?? systemClock,
    capabilities.newTransactionId ?? uuidTransactionId,
  );
