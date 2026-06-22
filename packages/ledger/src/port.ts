import type {
  Account,
  AccountId,
  AccountKind,
  IdempotencyKey,
  Result,
  Timestamp,
  TransactionId,
  TransactionReason,
  Transfer,
} from '@crowdship/ledger-kernel';

/**
 * The ledger seam: the one domain-terms interface every coin movement passes
 * through, with the settlement engine sitting entirely behind it [LAW:locality-
 * or-seam]. Callers speak coins — open an account, post a balanced movement, read
 * a balance — and never a vendor SDK, so the production engine (TigerBeetle) and
 * the in-memory test fake are interchangeable instances of this one type
 * [LAW:one-type-per-behavior]. This *is* the "custodial now, on-chain later" fork
 * made concrete: a different settlement engine is a different `Ledger`
 * implementation, not a change to any caller.
 *
 * The engine is the single source of truth for balances and the single enforcer
 * of the money rules (no-overdraft, idempotency, atomicity) [LAW:single-enforcer].
 * This package no longer re-derives or re-checks any of that — doing so would be a
 * second authority that could drift [LAW:one-source-of-truth].
 *
 * This seam is the *write and point-read* surface only: open, post, read one
 * balance, close. The richer query surface — full per-account history and
 * point-in-time/audit balances — is deliberately the `LedgerQuery` seam's concern
 * (`query.ts`), built directly on the engine's own history, not bolted onto the
 * write path [LAW:decomposition]. Its absence here is a cut, not an amputation.
 */
export interface Ledger {
  /** Registers an account and its negativity rule. Idempotent for the same kind;
   *  refuses to change an existing account's kind [LAW:no-silent-failure]. */
  openAccount(account: Account): Promise<Result<void, AccountConflict>>;

  /** Records one balanced coin movement, or returns the single reason it cannot
   *  be recorded. The only mutator of value in the system.
   *
   *  The idempotency key is *single-use*. A movement that succeeds is replayable:
   *  re-posting the identical movement under the same key returns the original
   *  receipt and records nothing new, so a retry can never double-spend. A movement
   *  that *fails* (overdraft, unknown account) still spends its key — the engine
   *  remembers the failed attempt, so re-posting under that key is refused as
   *  `idempotency-key-reused`; a corrected retry must use a fresh key. Reusing a key
   *  for a *different* movement is likewise refused as a value. */
  post(request: PostRequest): Promise<Result<PostReceipt, PostError>>;

  /** The recorded balance of one account: positive coins held, negative for the
   *  mint (its balance is the coins in circulation), `0n` for an account with no
   *  recorded movement. A total lookup — never throws for an absent account. */
  balanceOf(account: AccountId): Promise<bigint>;

  /** Releases the engine connection. A no-op for the in-memory fake; closes the
   *  client for a networked engine. Lifecycle is explicit, never ambient
   *  [LAW:no-ambient-temporal-coupling]. */
  close(): Promise<void>;
}

/** What a caller asks the ledger to record: the balanced transfers, why they
 *  moved, and the idempotency key that makes the post replay-safe. The key
 *  identifies *this specific movement*; retrying means resubmitting the identical
 *  set of transfers under the same key. The transaction id and occurred-at moment
 *  are assigned by the engine, never supplied by the caller.
 *
 *  A movement has at least one transfer — an empty movement is unrepresentable, so
 *  no caller or implementation defends against it [LAW:types-are-the-program]. */
export interface PostRequest {
  readonly transfers: readonly [Transfer, ...Transfer[]];
  readonly reason: TransactionReason;
  readonly idempotencyKey: IdempotencyKey;
}

/** The proof a movement was recorded: a stable id derived from the request's key
 *  (identical across every replay of the same movement), the moment the engine
 *  recorded it, and the resulting balance of every account the movement touched.
 *
 *  The balances are each touched account's balance *as currently recorded*. For a
 *  fresh post that is exactly the resulting balance; for a replay it is the
 *  current balance (the movement is not re-applied). Point-in-time historical
 *  balances are the concern of the `LedgerQuery` seam, not this receipt. */
export interface PostReceipt {
  readonly transactionId: TransactionId;
  readonly occurredAt: Timestamp;
  readonly balances: ReadonlyMap<AccountId, bigint>;
}

/**
 * Opening an account that already exists under a *different* kind is refused: an
 * account's kind (and the negativity rule it implies) is fixed when it is opened
 * and must never change underneath the balances that depend on it. Re-opening
 * with the same kind is a no-op success, so bootstrap and retry are safe.
 */
export type AccountConflict = {
  readonly kind: 'kind-conflict';
  readonly id: AccountId;
  readonly existing: AccountKind;
  readonly requested: AccountKind;
};

/**
 * Every way a post can fail *as a domain outcome*, as one closed union of values
 * the caller destructures — never thrown [LAW:dataflow-not-control-flow]. The
 * movement was empty, named an account the ledger has never opened, would push an
 * account below zero against its kind, or reused a key already spent on a
 * *different* movement.
 *
 * `idempotency-key-reused` covers every way a key is already spent: a prior
 * *successful* movement under it differs from this one, or a prior *failed* attempt
 * under it poisoned the key. (An identical replay of a prior success is not an
 * error — it returns the original receipt.)
 *
 * A breach of the engine's own integrity — a malformed request the engine rejects
 * for a reason that should be impossible given these types, or an internal-id
 * collision — is deliberately NOT in this union: it is corruption, not a request a
 * caller can handle, so it halts the post loudly by rejecting rather than being
 * downgraded to a routine error someone might shrug off [LAW:no-silent-failure].
 */
export type PostError =
  | { readonly kind: 'unknown-account'; readonly account: AccountId }
  | { readonly kind: 'would-overdraft'; readonly account: AccountId }
  | { readonly kind: 'idempotency-key-reused'; readonly key: IdempotencyKey };
