import type {
  Account,
  AccountId,
  AccountKind,
  Result,
  Timestamp,
  Transfer,
} from '@crowdship/ledger-kernel';
import { err, mayGoNegative, ok, timestamp } from '@crowdship/ledger-kernel';

import { touchedAccounts, transactionIdOf } from './movement.js';
import type { AccountConflict, Ledger, PostError, PostReceipt, PostRequest } from './port.js';

/** Supplies the moment a movement is recorded. The boundary owns time; the fake
 *  never reads a clock implicitly [LAW:no-ambient-temporal-coupling]. */
export type Clock = () => Timestamp;

const systemClock: Clock = () => {
  const t = timestamp(Date.now());
  if (!t.ok) throw new Error(`system clock produced an invalid timestamp: ${JSON.stringify(t.error)}`);
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
      readonly reason: string;
      readonly occurredAt: Timestamp;
    }
  | { readonly kind: 'failed' };

const sameMovement = (
  request: PostRequest,
  recorded: { readonly transfers: readonly Transfer[]; readonly reason: string },
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
export class InMemoryLedger implements Ledger {
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

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** Builds the in-memory fake ledger. Tests inject a deterministic clock so the
 *  receipt's occurred-at moment is reproducible. */
export const createInMemoryLedger = (clock?: Clock): Ledger => new InMemoryLedger(clock);
