import type {
  Account,
  AccountId,
  AccountKind,
  IdempotencyKey,
  Result,
  Timestamp,
  TransactionReason,
  Transfer,
} from '@crowdship/ledger-kernel';
import { err, mayGoNegative, ok, timestamp } from '@crowdship/ledger-kernel';
import { show } from '@crowdship/std';

import { touchedAccounts, transactionIdOf } from './movement.js';
import type {
  AccountConflict,
  Ledger,
  MovementCommit,
  PostError,
  PostReceipt,
  PostRequest,
} from './port.js';
import type { AccountMovement, LedgerQuery } from './query.js';

/** Supplies the moment a movement is recorded. The boundary owns time; the fake
 *  never reads a clock implicitly [LAW:no-ambient-temporal-coupling]. */
export type Clock = () => Timestamp;

const systemClock: Clock = () => {
  const t = timestamp(Date.now());
  if (!t.ok) throw new Error(`system clock produced an invalid timestamp: ${show(t.error)}`);
  return t.value;
};

/**
 * What a spent idempotency key holds: a `success` (replayable — its transfers and
 * timestamp recover the original receipt) or a `failed` attempt (the key is
 * terminally spent, mirroring how the real engine remembers a failed transfer id).
 * Either way the key is single-use [LAW:types-are-the-program].
 */
type RecordedMovement =
  | {
      readonly kind: 'success';
      readonly transfers: readonly Transfer[];
      readonly reason: TransactionReason;
      readonly occurredAt: Timestamp;
    }
  | { readonly kind: 'failed' };

const sameMovement = (
  request: PostRequest,
  recorded: { readonly transfers: readonly Transfer[]; readonly reason: TransactionReason },
): boolean =>
  request.reason === recorded.reason &&
  request.transfers.length === recorded.transfers.length &&
  request.transfers.every((t, i) => {
    const r = recorded.transfers[i];
    return r !== undefined && t.from === r.from && t.to === r.to && t.amount === r.amount;
  });

/** Net coin delta per account for a set of transfers; accounts that net to zero
 *  are kept (a touched account at zero is still part of the movement's receipt). */
const netEffect = (transfers: readonly Transfer[]): Map<AccountId, bigint> => {
  const net = new Map<AccountId, bigint>();
  for (const t of transfers) {
    net.set(t.from, (net.get(t.from) ?? 0n) - t.amount);
    net.set(t.to, (net.get(t.to) ?? 0n) + t.amount);
  }
  return net;
};

/**
 * The in-memory fake behind the {@link Ledger} seam: the test double that lets
 * everything downstream of the ledger (settlement, menu, payments) be tested fast
 * and hermetically, with no engine to stand up [LAW:locality-or-seam]. It is NOT a
 * second production ledger — it holds exactly enough state to honour the seam's
 * observable contract, and the shared contract suite asserts that it and the real
 * TigerBeetle engine agree, so it cannot quietly drift from production behaviour.
 *
 * Every method completes synchronously before returning its resolved promise, so a
 * burst of concurrent posts cannot interleave a read with another's write — the
 * no-double-spend guarantee falls out of single-threaded execution, with no lock
 * to own [LAW:no-ambient-temporal-coupling].
 */
export class InMemoryLedger implements Ledger, LedgerQuery {
  readonly #registry = new Map<AccountId, AccountKind>();
  readonly #balances = new Map<AccountId, bigint>();
  readonly #movements = new Map<string, RecordedMovement>();

  constructor(private readonly clock: Clock = systemClock) {}

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

  post(request: PostRequest): Promise<Result<PostReceipt, PostError>> {
    return Promise.resolve(this.#post(request));
  }

  #post(request: PostRequest): Result<PostReceipt, PostError> {
    const key = request.idempotencyKey;
    const prior = this.#movements.get(key);
    if (prior !== undefined) {
      // The key is spent. An identical replay of a prior success returns the original
      // receipt; everything else (a different movement, or a prior failed attempt) is
      // a reuse conflict — a failed attempt spends its key just like the real engine.
      if (prior.kind === 'success' && sameMovement(request, prior)) {
        return ok(this.#receipt(request, prior.occurredAt));
      }
      return err({ kind: 'idempotency-key-reused', key });
    }

    const net = netEffect(request.transfers);
    for (const [account, delta] of net) {
      const kind = this.#registry.get(account);
      if (kind === undefined) return this.#fail(key, { kind: 'unknown-account', account });
      const resulting = (this.#balances.get(account) ?? 0n) + delta;
      if (resulting < 0n && !mayGoNegative(kind)) {
        return this.#fail(key, { kind: 'would-overdraft', account });
      }
    }

    for (const [account, delta] of net) {
      this.#balances.set(account, (this.#balances.get(account) ?? 0n) + delta);
    }
    const occurredAt = this.clock();
    this.#movements.set(key, {
      kind: 'success',
      transfers: request.transfers,
      reason: request.reason,
      occurredAt,
    });
    return ok(this.#receipt(request, occurredAt));
  }

  // A failed post spends its key: record the failure so a retry under the same key
  // is refused, mirroring the engine remembering a failed transfer id.
  #fail(key: string, error: PostError): Result<PostReceipt, PostError> {
    this.#movements.set(key, { kind: 'failed' });
    return err(error);
  }

  #receipt(request: PostRequest, occurredAt: Timestamp): PostReceipt {
    const balances = new Map<AccountId, bigint>();
    for (const account of touchedAccounts(request.transfers)) {
      balances.set(account, this.#balances.get(account) ?? 0n);
    }
    return { transactionId: transactionIdOf(request.idempotencyKey), occurredAt, balances };
  }

  balanceOf(account: AccountId): Promise<bigint> {
    return Promise.resolve(this.#balances.get(account) ?? 0n);
  }

  // The commit recovered from the one record the write side already keeps for
  // idempotency — the movement stored under the key — so "did this movement happen?"
  // has the same single source of truth as the post that recorded it
  // [LAW:one-source-of-truth]. A key spent only on a failed attempt holds no success
  // and so committed nothing.
  commitOf(key: IdempotencyKey): Promise<MovementCommit | undefined> {
    const recorded = this.#movements.get(key);
    if (recorded === undefined || recorded.kind !== 'success') return Promise.resolve(undefined);
    return Promise.resolve({ transactionId: transactionIdOf(key), occurredAt: recorded.occurredAt });
  }

  // The query side derives every answer by folding the same recorded movements the
  // write side appended — the fake's single source of truth — never a parallel
  // balance kept in step [LAW:one-source-of-truth]. Folding is the fake's nature;
  // the real engine answers the identical contract from its own native history, and
  // the shared query contract proves the two agree [LAW:behavior-not-structure].

  // The point-in-time balance is the sum of every leg delta from a movement at or
  // before `asOf`. Movements are scanned in full (the fake holds them all in
  // memory); a later movement simply does not contribute, so the answer is immune
  // to activity after `asOf`.
  balanceAt(account: AccountId, asOf: Timestamp): Promise<bigint> {
    let balance = 0n;
    for (const movement of this.#successes()) {
      if (movement.occurredAt > asOf) continue;
      for (const leg of movement.transfers) {
        if (leg.from === account) balance -= leg.amount;
        if (leg.to === account) balance += leg.amount;
      }
    }
    return Promise.resolve(balance);
  }

  // Replays the movements in record order, the same order the engine commits them,
  // carrying a running balance for every account so each leg that touches `account`
  // can report the balance it left behind. One entry per touching leg, oldest first.
  historyOf(account: AccountId): Promise<readonly AccountMovement[]> {
    const entries: AccountMovement[] = [];
    const running = new Map<AccountId, bigint>();
    for (const movement of this.#successes()) {
      for (const leg of movement.transfers) {
        const fromNext = (running.get(leg.from) ?? 0n) - leg.amount;
        const toNext = (running.get(leg.to) ?? 0n) + leg.amount;
        running.set(leg.from, fromNext);
        running.set(leg.to, toNext);
        if (leg.from === account) {
          entries.push({
            occurredAt: movement.occurredAt,
            direction: 'debit',
            amount: leg.amount,
            counterparty: leg.to,
            resultingBalance: fromNext,
            reason: movement.reason,
          });
        } else if (leg.to === account) {
          entries.push({
            occurredAt: movement.occurredAt,
            direction: 'credit',
            amount: leg.amount,
            counterparty: leg.from,
            resultingBalance: toNext,
            reason: movement.reason,
          });
        }
      }
    }
    return Promise.resolve(entries);
  }

  // Recorded movements in append order (a Map preserves insertion order), narrowed
  // to the successes — a failed key holds no transfers and is not part of history.
  *#successes(): Generator<Extract<RecordedMovement, { kind: 'success' }>> {
    for (const movement of this.#movements.values()) {
      if (movement.kind === 'success') yield movement;
    }
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** Builds the in-memory fake ledger, exposing both the write seam and the
 *  audit/query seam over one source of truth. Tests inject a deterministic clock
 *  so the receipt's occurred-at moment — and every point-in-time query — is
 *  reproducible. */
export const createInMemoryLedger = (clock?: Clock): Ledger & LedgerQuery =>
  new InMemoryLedger(clock);
