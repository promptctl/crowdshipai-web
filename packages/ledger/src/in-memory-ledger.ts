import type {
  Account,
  AccountId,
  AccountKind,
  Result,
  Timestamp,
  Transfer,
} from '@crowdship/ledger-kernel';
import { err, mayGoNegative, ok, timestamp } from '@crowdship/ledger-kernel';

import { transactionIdOf } from './movement.js';
import type { AccountConflict, Ledger, PostError, PostReceipt, PostRequest } from './port.js';

/** Supplies the moment a movement is recorded. The boundary owns time; the fake
 *  never reads a clock implicitly [LAW:no-ambient-temporal-coupling]. */
export type Clock = () => Timestamp;

const systemClock: Clock = () => {
  const t = timestamp(Date.now());
  if (!t.ok) throw new Error(`system clock produced an invalid timestamp: ${JSON.stringify(t.error)}`);
  return t.value;
};

interface RecordedMovement {
  readonly transfers: readonly Transfer[];
  readonly reason: string;
  readonly occurredAt: Timestamp;
}

const sameMovement = (request: PostRequest, recorded: RecordedMovement): boolean =>
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

/** Every account a movement touches, in first-seen order. */
const touchedAccounts = (transfers: readonly Transfer[]): readonly AccountId[] => {
  const seen = new Set<AccountId>();
  const order: AccountId[] = [];
  for (const t of transfers) {
    for (const a of [t.from, t.to]) {
      if (!seen.has(a)) {
        seen.add(a);
        order.push(a);
      }
    }
  }
  return order;
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
    if (request.transfers.length === 0) return err({ kind: 'empty-movement' });

    const prior = this.#movements.get(request.idempotencyKey);
    if (prior !== undefined) {
      if (sameMovement(request, prior)) return ok(this.#receipt(request, prior.occurredAt));
      return err({ kind: 'idempotency-key-reused', key: request.idempotencyKey });
    }

    const net = netEffect(request.transfers);
    for (const [account, delta] of net) {
      const kind = this.#registry.get(account);
      if (kind === undefined) return err({ kind: 'unknown-account', account });
      const resulting = (this.#balances.get(account) ?? 0n) + delta;
      if (resulting < 0n && !mayGoNegative(kind)) {
        return err({ kind: 'would-overdraft', account });
      }
    }

    for (const [account, delta] of net) {
      this.#balances.set(account, (this.#balances.get(account) ?? 0n) + delta);
    }
    const occurredAt = this.clock();
    this.#movements.set(request.idempotencyKey, {
      transfers: request.transfers,
      reason: request.reason,
      occurredAt,
    });
    return ok(this.#receipt(request, occurredAt));
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
export const createInMemoryLedger = (clock?: Clock): Ledger =>
  clock === undefined ? new InMemoryLedger() : new InMemoryLedger(clock);
