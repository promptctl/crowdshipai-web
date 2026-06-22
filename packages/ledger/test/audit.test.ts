import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import {
  accountId,
  coinAmount,
  idempotencyKey,
  timestamp,
  transaction,
  transactionId,
  transactionReason,
  transfer,
  type Account,
  type AccountId,
  type AccountKind,
  type CoinAmount,
  type IdempotencyKey,
  type Result,
  type Transaction,
  type Transfer,
} from '@crowdship/ledger-kernel';

import {
  auditLedger,
  foldBalances,
  InMemoryLedgerStore,
  Ledger,
  LedgerIntegrityError,
} from '../src/index.js';

/** Unwrap a Result loudly — a money test must never proceed past a failed construction. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const acc = (s: string): AccountId => must(accountId(s));
const coins = (n: bigint): CoinAmount => must(coinAmount(n));
const xfer = (from: string, to: string, amount: bigint): Transfer =>
  must(transfer(acc(from), acc(to), coins(amount)));

const txn = (id: string, transfers: readonly Transfer[]): Transaction =>
  must(
    transaction({
      id: must(transactionId(id)),
      reason: must(transactionReason('test')),
      transfers,
      occurredAt: must(timestamp(0)),
      idempotencyKey: must(idempotencyKey(id)),
    }),
  );

describe('auditLedger reconciles a claimed balance view against the fold of the log', () => {
  const log = [txn('t1', [xfer('mint', 'alice', 100n)]), txn('t2', [xfer('alice', 'bob', 30n)])];
  // Authoritative fold: mint -100, alice 70, bob 30.

  test('a view equal to the fold is sound', () => {
    expect(auditLedger(log, foldBalances(log))).toEqual({ kind: 'sound' });
  });

  test('a view that overstates an account drifts, naming the account and both numbers', () => {
    const claimed = new Map(foldBalances(log));
    claimed.set(acc('alice'), 71n); // an index that gained a coin it should not have
    const verdict = auditLedger(log, claimed);
    expect(verdict.kind).toBe('drifted');
    if (verdict.kind === 'drifted') {
      expect(verdict.drift).toEqual([{ account: acc('alice'), authoritative: 70n, claimed: 71n }]);
    }
  });

  test('a view claiming a balance the log never produced drifts (authoritative is zero)', () => {
    const claimed = new Map(foldBalances(log));
    claimed.set(acc('ghost'), 5n); // an account the log never touched
    const verdict = auditLedger(log, claimed);
    expect(verdict.kind).toBe('drifted');
    if (verdict.kind === 'drifted') {
      expect(verdict.drift).toContainEqual({ account: acc('ghost'), authoritative: 0n, claimed: 5n });
    }
  });

  test('a view omitting an account the log holds drifts (claimed is zero)', () => {
    const claimed = new Map(foldBalances(log));
    claimed.delete(acc('bob')); // an index that lost a credit it should have kept
    const verdict = auditLedger(log, claimed);
    expect(verdict.kind).toBe('drifted');
    if (verdict.kind === 'drifted') {
      expect(verdict.drift).toContainEqual({ account: acc('bob'), authoritative: 30n, claimed: 0n });
    }
  });

  test('every divergent account is reported, not only the first', () => {
    const claimed = new Map(foldBalances(log));
    claimed.set(acc('alice'), 71n);
    claimed.set(acc('bob'), 29n);
    const verdict = auditLedger(log, claimed);
    expect(verdict.kind).toBe('drifted');
    if (verdict.kind === 'drifted') {
      const accounts = verdict.drift.map((d) => d.account);
      expect(accounts).toContain(acc('alice'));
      expect(accounts).toContain(acc('bob'));
      expect(verdict.drift).toHaveLength(2);
    }
  });
});

describe('auditLedger agrees with the fold over arbitrary logs', () => {
  const pool = ['mint', 'alice', 'bob', 'carol'] as const;
  const arbAccount = fc.constantFrom(...pool).map(acc);
  const arbTransfer = fc
    .record({ from: arbAccount, to: arbAccount, amount: fc.bigInt({ min: 1n, max: 10n ** 6n }).map(coins) })
    .filter((t) => t.from !== t.to)
    .map((t) => must(transfer(t.from, t.to, t.amount)));
  const arbLog = fc
    .array(fc.array(arbTransfer, { minLength: 1, maxLength: 5 }), { minLength: 0, maxLength: 8 })
    .map((txnsTransfers) => txnsTransfers.map((transfers, i) => txn(`t${i}`, transfers)));

  test('the fold of any log reconciles as sound against itself — there is no spurious drift', () => {
    fc.assert(
      fc.property(arbLog, (log) => auditLedger(log, foldBalances(log)).kind === 'sound'),
    );
  });

  test('perturbing any single account by a non-zero amount is always detected', () => {
    fc.assert(
      fc.property(arbLog, arbAccount, fc.bigInt({ min: 1n, max: 10n ** 6n }), (log, account, bump) => {
        const claimed = new Map(foldBalances(log));
        claimed.set(account, (claimed.get(account) ?? 0n) + bump); // guaranteed to differ
        const verdict = auditLedger(log, claimed);
        return verdict.kind === 'drifted' && verdict.drift.some((d) => d.account === account);
      }),
    );
  });
});

const account = (id: string, kind: AccountKind): Account => ({ id: acc(id), kind });
const reason = must(transactionReason('test'));
const key = (s: string): IdempotencyKey => must(idempotencyKey(s));

let keyCounter = 0;
const freshKey = (): IdempotencyKey => key(`audit-k-${(keyCounter += 1)}`);

const tx = (
  from: string,
  to: string,
  amount: bigint,
): { transfers: readonly Transfer[]; reason: typeof reason; idempotencyKey: IdempotencyKey } => ({
  transfers: [must(transfer(acc(from), acc(to), coins(amount)))],
  reason,
  idempotencyKey: freshKey(),
});

const deterministicLedger = (store: InMemoryLedgerStore): Ledger => {
  let n = 0;
  return new Ledger(
    store,
    () => must(timestamp(1000 + n)),
    () => must(transactionId(`audit-txn-${(n += 1)}`)),
  );
};

/** A store whose derived balance view is deliberately corrupted relative to its
 *  own authoritative log — standing in for a future maintained balance index
 *  (ledger .7) that has fallen out of step. The log itself stays truthful. */
class DriftingStore extends InMemoryLedgerStore {
  constructor(private readonly tamper: (balances: Map<AccountId, bigint>) => void) {
    super();
  }
  override async balances(): Promise<ReadonlyMap<AccountId, bigint>> {
    const corrupted = new Map(await super.balances());
    this.tamper(corrupted);
    return corrupted;
  }
}

describe('Ledger.audit() reconciles loudly — silent when sound, halting when drifted', () => {
  test('a sound ledger audits without raising', async () => {
    const ledger = deterministicLedger(new InMemoryLedgerStore());
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));
    await ledger.openAccount(account('bob', 'user-wallet'));

    must(await ledger.post(tx('mint', 'alice', 100n)));
    must(await ledger.post(tx('alice', 'bob', 30n)));

    await expect(ledger.audit()).resolves.toBeUndefined();
  });

  test('an empty ledger is sound', async () => {
    await expect(deterministicLedger(new InMemoryLedgerStore()).audit()).resolves.toBeUndefined();
  });

  test('a derived view drifted from the log halts the audit loudly with the structured drift', async () => {
    const store = new DriftingStore((b) => b.set(acc('ghost'), 5n)); // index claims coins the log never made
    const ledger = deterministicLedger(store);
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));
    must(await ledger.post(tx('mint', 'alice', 100n)));

    const raised = await ledger.audit().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(raised).toBeInstanceOf(LedgerIntegrityError);
    if (raised instanceof LedgerIntegrityError) {
      expect(raised.drift).toContainEqual({ account: acc('ghost'), authoritative: 0n, claimed: 5n });
      expect(raised.message).toContain('drifted');
    }
  });

  test('inspectIntegrity returns the verdict as a value — sound, without raising', async () => {
    const ledger = deterministicLedger(new InMemoryLedgerStore());
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));
    must(await ledger.post(tx('mint', 'alice', 100n)));

    expect(await ledger.inspectIntegrity()).toEqual({ kind: 'sound' });
  });

  test('inspectIntegrity reports drift as data, never as a throw — the report is readable without catching', async () => {
    const store = new DriftingStore((b) => b.set(acc('ghost'), 5n));
    const ledger = deterministicLedger(store);
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));
    must(await ledger.post(tx('mint', 'alice', 100n)));

    const verdict = await ledger.inspectIntegrity(); // does not throw
    expect(verdict.kind).toBe('drifted');
    if (verdict.kind === 'drifted') {
      expect(verdict.drift).toContainEqual({ account: acc('ghost'), authoritative: 0n, claimed: 5n });
    }
  });

  test('the audit reads a consistent snapshot — a post enqueued concurrently does not tear it', async () => {
    // On a healthy in-memory store balances() is the fold, so any consistent
    // snapshot is sound; an audit racing a post must still see one or the other
    // whole, never a half-applied write, so it never false-alarms.
    const ledger = deterministicLedger(new InMemoryLedgerStore());
    await ledger.openAccount(account('mint', 'mint'));
    await ledger.openAccount(account('alice', 'user-wallet'));

    const posted = ledger.post(tx('mint', 'alice', 50n));
    const audited = ledger.audit();
    const [postResult] = await Promise.all([posted, audited]);
    expect(postResult.ok).toBe(true);
    await expect(audited).resolves.toBeUndefined();
  });
});
