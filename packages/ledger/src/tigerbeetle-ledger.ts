import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

import type {
  Account,
  AccountId,
  AccountKind,
  IdempotencyKey,
  Result,
  Timestamp,
} from '@crowdship/ledger-kernel';
import {
  accountId,
  coinAmount,
  err,
  mayGoNegative,
  ok,
  timestamp,
  transactionReason,
} from '@crowdship/ledger-kernel';
import { show } from '@crowdship/std';
import type {
  Account as TBAccount,
  AccountFilter as TBAccountFilter,
  Client as TBClient,
  Transfer as TBTransfer,
} from 'tigerbeetle-node';

import { touchedAccounts, transactionIdOf } from './movement.js';
import { createInMemoryNameStore, type NameStore } from './name-store.js';
import type {
  AccountConflict,
  Ledger,
  MovementCommit,
  PostError,
  PostReceipt,
  PostRequest,
} from './port.js';
import type { AccountMovement, LedgerQuery, MovementDirection } from './query.js';

// tigerbeetle-node is a CommonJS native addon; under NodeNext ESM its enum exports
// are not statically importable as named bindings, so it is loaded through
// `createRequire` and consumed by value here while its object shapes come in as
// erased `import type`s above. One load, reused for the life of the module.
const nodeRequire = createRequire(import.meta.url);
const tb = nodeRequire('tigerbeetle-node') as typeof import('tigerbeetle-node');
const { createClient, AccountFlags, AccountFilterFlags, TransferFlags, CreateAccountStatus, CreateTransferStatus } =
  tb;

/** The cluster this ledger talks to. The buy/sell rate and every other policy
 *  live elsewhere; here is only where the coins are kept. */
export interface TigerBeetleConfig {
  readonly clusterId: bigint;
  readonly replicaAddresses: readonly string[];
}

// One ledger of coins, one generic transfer code. The ledger only ever moves the
// single CrowdShip coin, so these are constant; finer transfer typing (a code per
// kind of movement) is a later refinement that does not change this seam.
const LEDGER = 1;
const CODE = 1;

// The account's domain kind, encoded into the engine so a reopen under a different
// kind is rejected by the engine itself (a different code surfaces as
// `exists_with_different_user_data_32`) rather than by a registry we maintain
// [LAW:single-enforcer]. Values are arbitrary but fixed and distinct.
const KIND_CODE: Record<AccountKind, number> = {
  mint: 1,
  'user-wallet': 2,
  escrow: 3,
  'platform-revenue': 4,
};

const kindOfCode = (code: number): AccountKind | undefined =>
  (Object.keys(KIND_CODE) as AccountKind[]).find((k) => KIND_CODE[k] === code);

// The negativity rule is the only money rule a kind decides: the mint may carry a
// negative balance (its negative balance is the coins in circulation); every other
// kind is held to `debits must not exceed credits` by the engine, which is exactly
// "must not overdraft" [LAW:single-enforcer]. `history` is set so the `LedgerQuery`
// seam and the stream's transparent settlement view can read point-in-time balances
// from the engine's own history without reopening accounts.
const flagsFor = (kind: AccountKind): number =>
  AccountFlags.history | (mayGoNegative(kind) ? AccountFlags.none : AccountFlags.debits_must_not_exceed_credits);

// A stable 128-bit name for an opaque domain string. SHA-256 truncated to 128
// bits: the collision probability across any realistic number of accounts or
// movements is negligible, and a cryptographic digest means it cannot be steered.
// The prefixes keep the three id spaces (accounts, transfer legs, reasons) from
// ever colliding with each other.
const u128 = (s: string): bigint => {
  const digest = createHash('sha256').update(s).digest();
  let v = 0n;
  for (let i = 0; i < 16; i += 1) v = (v << 8n) | BigInt(digest[i] ?? 0);
  // The engine forbids an id of 0 or u128-max; nudge the two degenerate digests.
  if (v === 0n) return 1n;
  const max = (1n << 128n) - 1n;
  return v === max ? max - 1n : v;
};

const accountTbId = (id: AccountId): bigint => u128(`acct:${id}`);
const legTbId = (key: string, leg: number): bigint => u128(`xfer:${key}:${leg}`);
const reasonFingerprint = (reason: string): bigint => u128(`reason:${reason}`);

const nsToTimestamp = (ns: bigint): Timestamp => {
  const ms = timestamp(Number(ns / 1_000_000n));
  if (!ms.ok) throw new Error(`engine returned an unrepresentable timestamp: ${ns}`);
  return ms.value;
};

// The engine timestamps movements in nanoseconds; a domain moment is epoch ms.
// "At or before millisecond T" is every engine ns through the last ns of that
// millisecond, so the inclusive ns ceiling that maps a ms cutoff onto the engine's
// clock is (T+1)·1e6 − 1. This is what makes the fake's "occurredAt ≤ asOf" fold and
// the engine's `timestamp_max` filter agree on which movements count.
const msCeilingNs = (ms: Timestamp): bigint => (BigInt(ms) + 1n) * 1_000_000n - 1n;

// TigerBeetle caps a single query at 8189 results (its message-body limit), so a
// full account history is read page by page until a short page proves the end was
// reached — a money audit is never silently truncated to one page [LAW:no-silent-failure].
const HISTORY_PAGE = 8189;

// Both the account-side debit and credit transfers, oldest first: the full set of
// movements touching an account, in commit order.
const HISTORY_FLAGS = AccountFilterFlags.debits | AccountFilterFlags.credits;

// Re-brand a value read back from the engine through the kernel's own constructor —
// the single authority on these invariants [LAW:single-enforcer]. A recorded value
// that fails to re-validate is not a routine error a caller handles; it is the audit
// trail disagreeing with itself, so it halts loudly [LAW:no-silent-failure].
// Renders the error through std's `show`, not raw `JSON.stringify`, because a
// recorded value that fails to re-validate can carry a bigint — `coinAmount`'s
// `{ value: bigint }` for a non-positive recorded amount — and `JSON.stringify` THROWS
// on a bigint, which would replace this loud corruption message with a confusing
// serializer error on the money path [LAW:no-silent-failure]. `recover` stays distinct
// from node-std's `orThrow` for now only because it unwraps the kernel's own `Result`
// (ledger-kernel re-copies std's `Result`); converging the two awaits that deferred
// std/kernel unification, but the renderer is already one source of truth [LAW:one-source-of-truth].
const recover = <T>(result: Result<T, unknown>, what: string): T => {
  if (!result.ok) throw new Error(`ledger corruption: ${what}: ${show(result.error)}`);
  return result.value;
};

/**
 * Serializes work that shares an idempotency key, while letting distinct keys run
 * fully concurrently — so the engine's throughput is untouched and only same-key
 * posts are ordered [LAW:no-ambient-temporal-coupling]. This is what makes the
 * "is this key already used?" lookup and the subsequent submit one atomic step for
 * a given key in this process, closing the window where two different movements
 * under one key could both believe the key is fresh. Entries delete themselves once
 * drained, so the map cannot grow without bound.
 */
class KeyedSerializer {
  readonly #tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const prev = this.#tails.get(key) ?? Promise.resolve();
    const run = prev.then(work, work);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(key, tail);
    void tail.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
    return run;
  }
}

/**
 * The production ledger: a thin adapter over a TigerBeetle cluster behind the
 * {@link Ledger} seam [LAW:locality-or-seam]. The engine is the single source of
 * truth for balances and the single enforcer of every money rule — no-overdraft
 * (account flags), idempotency and conflict detection (client-supplied transfer
 * ids), and atomic multi-leg movements (linked transfers). This adapter only
 * translates domain values into the engine's vocabulary and back; it never
 * re-derives a balance or re-checks an invariant the engine already owns
 * [LAW:single-enforcer].
 *
 * The adapter holds no balance or account state of its own: every domain id maps
 * to an engine id by a pure hash, so there is nothing here that could drift from
 * the engine [LAW:one-source-of-truth].
 */
export class TigerBeetleLedger implements Ledger, LedgerQuery {
  readonly #serializer = new KeyedSerializer();

  // The engine holds money as fingerprints, not strings: an account id and a
  // movement's reason reach TigerBeetle only as one-way hashes. The control-plane
  // store keeps the verbatim words beside the engine so the audit/query side can
  // recover *which* account and *why*. It holds no money, so it is no second balance
  // authority [LAW:one-source-of-truth] — only the engine's dictionary.
  constructor(
    private readonly client: TBClient,
    private readonly names: NameStore,
  ) {}

  async openAccount(account: Account): Promise<Result<void, AccountConflict>> {
    const tbAccount: TBAccount = {
      id: accountTbId(account.id),
      debits_pending: 0n,
      debits_posted: 0n,
      credits_pending: 0n,
      credits_posted: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: KIND_CODE[account.kind],
      reserved: 0,
      ledger: LEDGER,
      code: CODE,
      flags: flagsFor(account.kind),
      timestamp: 0n,
    };

    const [result] = await this.client.createAccounts([tbAccount]);
    const status = result?.status;
    // Same id, same kind already open: a no-op success, so bootstrap and retry are
    // safe. Reopening under a different kind changes either the negativity-rule
    // flags or the encoded kind code, both of which the engine reports as a
    // mismatch — that is the kind-conflict, read back so the caller sees what the
    // account already is.
    if (status === CreateAccountStatus.created || status === CreateAccountStatus.exists) {
      // The account is open under this id; record the verbatim id behind its engine
      // fingerprint so the audit side can name it as a counterparty. Idempotent.
      await this.names.record(accountTbId(account.id), account.id);
      return ok(undefined);
    }
    if (
      status === CreateAccountStatus.exists_with_different_flags ||
      status === CreateAccountStatus.exists_with_different_user_data_32 ||
      status === CreateAccountStatus.exists_with_different_code
    ) {
      const [existing] = await this.client.lookupAccounts([accountTbId(account.id)]);
      const existingKind = existing === undefined ? undefined : kindOfCode(existing.user_data_32);
      if (existingKind === undefined) {
        throw new Error(`ledger corruption: account ${account.id} exists with an unrecognized kind`);
      }
      return err({ kind: 'kind-conflict', id: account.id, existing: existingKind, requested: account.kind });
    }
    throw new Error(`ledger: unexpected account-create status ${String(status)} for ${account.id}`);
  }

  post(request: PostRequest): Promise<Result<PostReceipt, PostError>> {
    return this.#serializer.run(request.idempotencyKey, () => this.#post(request));
  }

  async #post(request: PostRequest): Promise<Result<PostReceipt, PostError>> {
    const reasonFp = reasonFingerprint(request.reason);
    const byId = await this.#probe(request);
    if (byId.has(legTbId(request.idempotencyKey, 0))) {
      return this.#classifyReused(request, reasonFp, byId);
    }
    return this.#submitFresh(request, reasonFp);
  }

  // Look up the leg ids this movement would occupy, plus one past the end so a
  // recorded movement with *more* legs than this request is detectable. Keyed by id.
  // A present first leg means the key already holds a recorded movement.
  async #probe(request: PostRequest): Promise<Map<bigint, TBTransfer>> {
    const key = request.idempotencyKey;
    const probeIds = Array.from({ length: request.transfers.length + 1 }, (_unused, i) => legTbId(key, i));
    const existing = await this.client.lookupTransfers(probeIds);
    return new Map(existing.map((t) => [t.id, t]));
  }

  // A leg already exists under this key: the only success is an exact replay of the
  // same movement (return the original receipt, recording nothing). Any difference
  // — a different leg count, account, amount, or reason — is a key reused for a
  // different movement, refused loudly as a value [LAW:no-silent-failure].
  async #classifyReused(
    request: PostRequest,
    reasonFp: bigint,
    byId: Map<bigint, TBTransfer>,
  ): Promise<Result<PostReceipt, PostError>> {
    const key = request.idempotencyKey;
    const conflict = err<PostError>({ kind: 'idempotency-key-reused', key });

    if (byId.has(legTbId(key, request.transfers.length))) return conflict; // recorded has more legs

    for (const [i, want] of request.transfers.entries()) {
      const stored = byId.get(legTbId(key, i));
      if (
        stored === undefined || // recorded has fewer legs
        stored.debit_account_id !== accountTbId(want.from) ||
        stored.credit_account_id !== accountTbId(want.to) ||
        stored.amount !== want.amount ||
        stored.user_data_128 !== reasonFp
      ) {
        return conflict;
      }
    }

    const first = byId.get(legTbId(key, 0));
    if (first === undefined) throw new Error('ledger corruption: probed-present leg vanished on read');
    // A replay applies nothing, so its balances are simply the accounts' current
    // recorded balances — the same read a fresh receipt makes. The occurred-at
    // moment is the original movement's, recovered from the recorded first leg.
    return ok(await this.#receiptFresh(request, nsToTimestamp(first.timestamp)));
  }

  async #submitFresh(request: PostRequest, reasonFp: bigint): Promise<Result<PostReceipt, PostError>> {
    const key = request.idempotencyKey;
    const last = request.transfers.length - 1;
    const batch: TBTransfer[] = request.transfers.map((t, i) => ({
      id: legTbId(key, i),
      debit_account_id: accountTbId(t.from),
      credit_account_id: accountTbId(t.to),
      amount: t.amount,
      pending_id: 0n,
      user_data_128: reasonFp,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: LEDGER,
      code: CODE,
      // All legs but the last are linked, so the whole movement commits or none of
      // it does — atomicity is the engine's, not ours.
      flags: i < last ? TransferFlags.linked : TransferFlags.none,
      timestamp: 0n,
    }));

    const results = await this.client.createTransfers(batch);

    if (results.every((r) => r.status === CreateTransferStatus.created)) {
      const head = results[0];
      if (head === undefined) throw new Error('ledger corruption: created movement returned no result');
      // Keep the verbatim reason beside the engine fingerprint it was recorded under,
      // so the audit side can say *why* this movement happened. Only on a fresh post:
      // a replay's reason was recorded by the original.
      await this.names.record(reasonFp, request.reason);
      return ok(await this.#receiptFresh(request, nsToTimestamp(head.timestamp)));
    }

    // Nothing was applied — a linked chain commits whole or not at all, and an
    // already-recorded id commits nothing — so it is safe to classify why the engine
    // refused without unwinding any partial state.
    if (results.some((r) => r.status === CreateTransferStatus.id_already_failed)) {
      // A prior post under this key already failed; the engine remembers failed ids
      // forever, so the key is terminally spent — a corrected retry must use a fresh
      // key. Refused as a value, never thrown [LAW:no-silent-failure].
      return err({ kind: 'idempotency-key-reused', key });
    }

    // One leg failed; the others report `linked_event_failed` as a consequence. The
    // real cause is the single leg with a substantive status.
    const causeIndex = results.findIndex(
      (r) =>
        r.status !== CreateTransferStatus.created && r.status !== CreateTransferStatus.linked_event_failed,
    );
    const cause = results[causeIndex];
    const leg = request.transfers[causeIndex];
    if (cause === undefined || leg === undefined) {
      throw new Error(`ledger corruption: a movement failed with no identifiable cause: ${describe(results)}`);
    }

    switch (cause.status) {
      case CreateTransferStatus.exceeds_credits:
        return err({ kind: 'would-overdraft', account: leg.from });
      case CreateTransferStatus.exceeds_debits:
        return err({ kind: 'would-overdraft', account: leg.to });
      case CreateTransferStatus.debit_account_not_found:
        return err({ kind: 'unknown-account', account: leg.from });
      case CreateTransferStatus.credit_account_not_found:
        return err({ kind: 'unknown-account', account: leg.to });
      default:
        // The engine refused for a reason that is not a money rule. Under correct
        // construction (the kernel forbids zero amounts and same-account transfers)
        // this means the key's legs already exist because another process committed
        // this movement between our probe and submit — the in-process serializer
        // cannot order across processes. Re-probe and let the engine, the true single
        // authority on idempotency, say replay or conflict; a status with no recorded
        // movement behind it is genuine corruption, halted loudly there
        // [LAW:single-enforcer].
        return this.#reclassifyAfterRace(request, reasonFp, cause.status);
    }
  }

  async #reclassifyAfterRace(
    request: PostRequest,
    reasonFp: bigint,
    status: number,
  ): Promise<Result<PostReceipt, PostError>> {
    const byId = await this.#probe(request);
    if (byId.has(legTbId(request.idempotencyKey, 0))) {
      return this.#classifyReused(request, reasonFp, byId);
    }
    throw new Error(
      `ledger corruption: transfer status ${String(status)} with no recorded movement for key ${request.idempotencyKey}`,
    );
  }

  async #receiptFresh(request: PostRequest, occurredAt: Timestamp): Promise<PostReceipt> {
    const accounts = touchedAccounts(request.transfers);
    const tbAccounts = await this.client.lookupAccounts(accounts.map(accountTbId));
    const balanceByTbId = new Map(tbAccounts.map((a) => [a.id, a.credits_posted - a.debits_posted]));
    const balances = new Map<AccountId, bigint>();
    for (const account of accounts) balances.set(account, balanceByTbId.get(accountTbId(account)) ?? 0n);
    return { transactionId: transactionIdOf(request.idempotencyKey), occurredAt, balances };
  }

  async balanceOf(account: AccountId): Promise<bigint> {
    const [tbAccount] = await this.client.lookupAccounts([accountTbId(account)]);
    if (tbAccount === undefined) return 0n;
    return tbAccount.credits_posted - tbAccount.debits_posted;
  }

  // The movement committed under a key is recovered from the engine's own transfers,
  // not a record we keep beside them [LAW:one-source-of-truth]: a movement always has
  // a first leg, so the presence of leg 0 under this key *is* the proof it committed,
  // and its engine timestamp is when. A key that only ever failed created no transfer
  // (a rejected `createTransfers` records nothing), so leg 0 is absent and the commit
  // is `undefined` — no money moved, no commit. The accounts the legs touched are not
  // recovered: the seam promises only the commit a key identifies on its own.
  async commitOf(key: IdempotencyKey): Promise<MovementCommit | undefined> {
    const [first] = await this.client.lookupTransfers([legTbId(key, 0)]);
    if (first === undefined) return undefined;
    return { transactionId: transactionIdOf(key), occurredAt: nsToTimestamp(first.timestamp) };
  }

  // The balance as it stood at `asOf` is the engine's own recorded balance at the
  // newest movement no later than that moment — read straight from TigerBeetle's
  // history (the `history` account flag is what makes this possible), never folded by
  // us [LAW:one-source-of-truth]. `reversed` + `limit: 1` asks the engine for exactly
  // that one snapshot; its absence means the account had no movement by then, so `0n`.
  async balanceAt(account: AccountId, asOf: Timestamp): Promise<bigint> {
    const [latest] = await this.client.getAccountBalances({
      account_id: accountTbId(account),
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      code: 0,
      timestamp_min: 0n,
      timestamp_max: msCeilingNs(asOf),
      limit: 1,
      flags: HISTORY_FLAGS | AccountFilterFlags.reversed,
    });
    if (latest === undefined) return 0n;
    return latest.credits_posted - latest.debits_posted;
  }

  // The audit trail of an account: every transfer leg that touched it, paired with
  // the engine's recorded balance right after each, oldest first. The transfers and
  // their balance snapshots are two views of the same engine history, so they come
  // back in lockstep — zipped by their shared engine timestamp, and any disagreement
  // is corruption surfaced loudly, not papered over [LAW:no-silent-failure]. The only
  // thing not in the engine — the counterparty's verbatim id and the reason — is
  // recovered from the control-plane store.
  //
  // Precondition: the NameStore holds a name for every account and reason in this
  // account's history. One process recording and reading through one store satisfies
  // it by construction; a multi-process audit needs a shared durable store. A name the
  // store lacks is surfaced loudly, never guessed or blanked [LAW:no-silent-failure] —
  // and it is reported as a *name* gap, distinct from engine corruption, because the
  // money it labels is intact in the engine.
  async historyOf(account: AccountId): Promise<readonly AccountMovement[]> {
    const selfTbId = accountTbId(account);
    const transfers = await this.#paginate((filter) => this.client.getAccountTransfers(filter), account);
    const balances = await this.#paginate((filter) => this.client.getAccountBalances(filter), account);
    if (transfers.length !== balances.length) {
      throw new Error(
        `ledger corruption: ${transfers.length} transfers but ${balances.length} balance snapshots for ${account}`,
      );
    }

    const counterpartyOf = (t: TBTransfer): bigint =>
      t.debit_account_id === selfTbId ? t.credit_account_id : t.debit_account_id;
    const fingerprints = new Set<bigint>();
    for (const t of transfers) {
      fingerprints.add(t.user_data_128); // the reason's fingerprint
      fingerprints.add(counterpartyOf(t));
    }
    const names = await this.names.resolve([...fingerprints]);
    const named = (fingerprint: bigint, what: string): string => {
      const name = names.get(fingerprint);
      // A name gap, not engine corruption: the engine recorded the movement and its
      // money is intact; the NameStore simply lacks the label for it. Surfaced loudly
      // with the cause and the fix, never blanked over [LAW:no-silent-failure].
      if (name === undefined) {
        throw new Error(
          `ledger: NameStore holds no ${what} for a movement touching ${account} — ` +
            `historyOf needs a NameStore carrying every name for the movements it reads ` +
            `(one process records and reads its own; a multi-process audit needs a shared store)`,
        );
      }
      return name;
    };

    return transfers.map((t, i) => {
      const snapshot = balances[i];
      if (snapshot === undefined || snapshot.timestamp !== t.timestamp) {
        throw new Error(`ledger corruption: transfer and balance history disagree for ${account}`);
      }
      const direction: MovementDirection = t.debit_account_id === selfTbId ? 'debit' : 'credit';
      return {
        occurredAt: nsToTimestamp(t.timestamp),
        direction,
        amount: recover(coinAmount(t.amount), 'recorded movement amount'),
        counterparty: recover(accountId(named(counterpartyOf(t), 'counterparty id')), 'recorded counterparty id'),
        resultingBalance: snapshot.credits_posted - snapshot.debits_posted,
        reason: recover(transactionReason(named(t.user_data_128, 'reason')), 'recorded movement reason'),
      };
    });
  }

  // Reads a full account history one engine page at a time, advancing the lower
  // timestamp bound past the last row seen until a short page proves the end was
  // reached. Engine timestamps are unique, so `+1` skips nothing.
  async #paginate<T extends { readonly timestamp: bigint }>(
    query: (filter: TBAccountFilter) => Promise<T[]>,
    account: AccountId,
  ): Promise<T[]> {
    const all: T[] = [];
    let cursorMin = 0n;
    for (;;) {
      const page = await query({
        account_id: accountTbId(account),
        user_data_128: 0n,
        user_data_64: 0n,
        user_data_32: 0,
        code: 0,
        timestamp_min: cursorMin,
        timestamp_max: 0n,
        limit: HISTORY_PAGE,
        flags: HISTORY_FLAGS,
      });
      all.push(...page);
      const last = page[page.length - 1];
      if (page.length < HISTORY_PAGE || last === undefined) return all;
      cursorMin = last.timestamp + 1n;
    }
  }

  close(): Promise<void> {
    return Promise.resolve(this.client.destroy());
  }
}

const describe = (results: readonly { status: number }[]): string =>
  results.map((r) => r.status).join(',');

/** Builds the production ledger over a live TigerBeetle cluster, exposing both the
 *  write seam and the audit/query seam. The returned ledger owns the client;
 *  `close()` releases it.
 *
 *  The `names` control-plane store recovers the verbatim account ids and reasons the
 *  engine keeps only as fingerprints. It defaults to an in-memory store — correct for
 *  a single process and the tests; a durable, shared implementation is the production
 *  follow-up for recovering names a *different* process recorded, and slots in here
 *  behind the same seam with no caller change [LAW:locality-or-seam]. */
export const createTigerBeetleLedger = (
  config: TigerBeetleConfig,
  names: NameStore = createInMemoryNameStore(),
): Ledger & LedgerQuery => {
  const client = createClient({
    cluster_id: config.clusterId,
    replica_addresses: [...config.replicaAddresses],
  });
  return new TigerBeetleLedger(client, names);
};
