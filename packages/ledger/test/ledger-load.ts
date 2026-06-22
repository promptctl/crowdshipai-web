import { describe, expect, test } from 'vitest';

import {
  accountId,
  coinAmount,
  idempotencyKey,
  transactionReason,
  transfer,
  type AccountId,
  type CoinAmount,
  type IdempotencyKey,
  type Result,
  type Transfer,
  type TransactionReason,
} from '@crowdship/ledger-kernel';

import type { Ledger, PostError, PostReceipt } from '../src/index.js';

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

/**
 * Production coin velocity — the verifiable goal this load test gates against
 * [LAW:verifiable-goals]. A coin movement is one PricedOffer firing: a backer
 * spends, the builder is credited, the platform skims its cut (the fire path in
 * docs/architecture-proposal.md). Sized to the platform epic's 10k concurrent
 * active users (crowdshipai-platform-m5t): at a peak hype spike each active user
 * fires ~1 offer per minute, so 10_000 / 60s ≈ 167 movements/s sustained.
 *
 * The gate sits at 150/s, just under the modeled 167. It is deliberately NOT a
 * benchmark of TigerBeetle — which sustains ~1e6 transfers/s — but a regression
 * tripwire for *our adapter*: if a future change reintroduces per-post O(history)
 * work (the log-fold cost this ticket's comments warn about), a storm of thousands
 * of posts degrades to O(n^2) and collapses far below this floor. A run under the
 * floor means our adapter, not the engine, is the bottleneck — and that is the one
 * failure this number exists to catch.
 */
export const SUSTAINED_TARGET_PER_SEC = 150;

/**
 * A load test's own deadline, derived from its workload and the floor it asserts —
 * never an ambient fixed number [LAW:no-ambient-temporal-coupling]. A run that
 * merely clears the floor takes `movements / floor` seconds; the deadline must be
 * strictly greater than that slowest *passing* run, or a correct-but-slow engine is
 * killed as a timeout before its assertion ever runs and the gate contradicts itself
 * [LAW:verifiable-goals]. The 3× headroom absorbs funding, the post-run balance reads,
 * and ordinary CI slowness; a genuinely collapsed (O(n²)) adapter still blows past it
 * and fails, which is the correct outcome.
 */
export const loadTimeoutMs = (scale: StormScale): number =>
  Math.max(30_000, Math.ceil((scale.movements / SUSTAINED_TARGET_PER_SEC) * 1000) * 3);

// The shape of one PricedOffer firing, in coins. Fixed knobs for the load test, not
// policy: the builder is credited the price less the platform's cut, the platform
// keeps the cut. The backer is debited the whole price across the two linked legs.
const OFFER_PRICE = 10n;
const PLATFORM_CUT = 1n;
const BUILDER_TAKE = OFFER_PRICE - PLATFORM_CUT;

/** How much load a run drives. The fast suite proves the invariants against the
 *  in-memory fake at a small scale; the integration suite drives the real engine at
 *  production-velocity scale. `movements` divides evenly by both `backers` and
 *  `builders` so every account carries an exactly predictable share of the storm. */
export interface StormScale {
  readonly movements: number;
  readonly backers: number;
  readonly builders: number;
  readonly concurrency: number;
  readonly overdraftSpends: number;
  readonly idempotencyKeys: number;
}

export const INTEGRATION_SCALE: StormScale = {
  movements: 10_000,
  backers: 200,
  builders: 40,
  concurrency: 128,
  overdraftSpends: 12,
  idempotencyKeys: 400,
};

export const FAST_SCALE: StormScale = {
  movements: 600,
  backers: 30,
  builders: 10,
  concurrency: 32,
  overdraftSpends: 12,
  idempotencyKeys: 50,
};

// Runs `count` tasks with at most `concurrency` in flight, preserving result order.
// `next` is read-then-incremented with no await between, so the single-threaded
// event loop hands each index to exactly one worker — the bounded fan-out needs no
// lock [LAW:no-ambient-temporal-coupling].
const pool = async <T>(
  count: number,
  concurrency: number,
  task: (i: number) => Promise<T>,
): Promise<T[]> => {
  const results = new Array<T>(count);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= count) return;
      results[i] = await task(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, worker));
  return results;
};

const ok = <T>(r: Result<T, unknown>): boolean => r.ok;

// The per-run scoped value constructors. Account ids and idempotency keys are
// namespaced so a shared, persistent engine keeps every run's keyspace disjoint —
// one construction idiom, shared by every runner rather than re-spelled in each.
const scopeOf = (
  ns: string,
): {
  acc: (s: string) => AccountId;
  key: (s: string) => IdempotencyKey;
  coins: (n: bigint) => CoinAmount;
} => ({
  acc: (s: string): AccountId => must(accountId(ns + s)),
  key: (s: string): IdempotencyKey => must(idempotencyKey(ns + s)),
  coins: (n: bigint): CoinAmount => must(coinAmount(n)),
});

/** What a velocity storm measured: how much was driven, how fast, and the
 *  independent per-account tally derived purely from the posts observed to succeed
 *  — the "claimed" view the engine's own balances are reconciled against
 *  [LAW:one-source-of-truth]. `accounts` is every account the run touched, so a
 *  caller can sum the engine's balances over exactly this run's key space. */
export interface StormReport {
  readonly attempted: number;
  readonly succeeded: number;
  readonly failures: number;
  readonly durationMs: number;
  readonly achievedPerSec: number;
  readonly expected: ReadonlyMap<AccountId, bigint>;
  readonly accounts: readonly AccountId[];
}

/**
 * Drives a production-shaped coin storm through the seam: fund a pool of backers
 * from the mint, then fire `movements` two-leg PricedOffer postings (backer pays
 * the builder its take and the platform its cut, atomically) under bounded
 * concurrency. Distinct idempotency keys throughout, so every post is a fresh
 * movement and the run is designed to fully succeed — no overdraft (grants cover
 * every backer's whole spend), no unknown account, no key reuse.
 *
 * Returns measurements and an independent expected tally accumulated from the posts
 * that actually returned ok; it asserts nothing itself, leaving the caller to
 * reconcile engine truth against this claim [LAW:dataflow-not-control-flow]. The
 * caller owns the ledger lifecycle; this never opens or closes the client.
 */
export const runVelocityStorm = async (
  ledger: Ledger,
  ns: string,
  scale: StormScale,
): Promise<StormReport> => {
  const { acc, key, coins } = scopeOf(ns);
  const reason: TransactionReason = must(transactionReason('offer-fire'));

  const mint = acc('mint');
  const platform = acc('platform');
  const backer = (i: number): AccountId => acc(`b${i}`);
  const builder = (j: number): AccountId => acc(`r${j}`);

  const backers = Array.from({ length: scale.backers }, (_unused, i) => backer(i));
  const builders = Array.from({ length: scale.builders }, (_unused, j) => builder(j));
  const allAccounts: AccountId[] = [mint, platform, ...backers, ...builders];

  await Promise.all([
    ledger.openAccount({ id: mint, kind: 'mint' }).then(must),
    ledger.openAccount({ id: platform, kind: 'platform-revenue' }).then(must),
    ...backers.map((id) => ledger.openAccount({ id, kind: 'user-wallet' }).then(must)),
    ...builders.map((id) => ledger.openAccount({ id, kind: 'user-wallet' }).then(must)),
  ]);

  // Each backer is granted enough to cover its whole share of the storm with a coin
  // to spare, so no movement in the storm can overdraft however the posts interleave.
  const movementsPerBacker = scale.movements / scale.backers;
  const grant = BigInt(movementsPerBacker + 1) * OFFER_PRICE;
  const expected = new Map<AccountId, bigint>();
  const credit = (id: AccountId, delta: bigint): void => {
    expected.set(id, (expected.get(id) ?? 0n) + delta);
  };

  // Funding is setup, not the thing under test: every grant must land for the storm
  // to be valid, so a failed grant halts loudly here at its source rather than
  // surfacing later as a confusing storm overdraft [LAW:no-silent-failure]. With the
  // grant guaranteed, the tally credit is unconditional — no skip to hide a gap.
  await pool(scale.backers, scale.concurrency, (i) =>
    ledger
      .post({
        transfers: [must(transfer(mint, backer(i), coins(grant)))],
        reason,
        idempotencyKey: key(`fund-${i}`),
      })
      .then(must),
  );
  for (let i = 0; i < scale.backers; i += 1) {
    credit(mint, -grant);
    credit(backer(i), grant);
  }

  // The storm proper, timed: every post is a distinct fresh movement, so achieved
  // throughput is a clean measure of the seam under sustained concurrent fire.
  const startedAt = performance.now();
  const storm = await pool(scale.movements, scale.concurrency, (m) => {
    const from = backer(m % scale.backers);
    const to = builder(m % scale.builders);
    const legs: readonly [Transfer, ...Transfer[]] = [
      must(transfer(from, to, coins(BUILDER_TAKE))),
      must(transfer(from, platform, coins(PLATFORM_CUT))),
    ];
    return ledger.post({ transfers: legs, reason, idempotencyKey: key(`m${m}`) });
  });
  const durationMs = performance.now() - startedAt;

  // The storm — unlike funding — may legitimately partially fail, and the report
  // must reflect exactly what moved, so the credit is data-dependent here by design.
  storm.forEach((r, m) => {
    if (ok(r)) {
      credit(backer(m % scale.backers), -OFFER_PRICE);
      credit(builder(m % scale.builders), BUILDER_TAKE);
      credit(platform, PLATFORM_CUT);
    }
  });

  const succeeded = storm.filter(ok).length;
  // A run too brief to measure is a failed measurement, not infinite throughput:
  // it reads as 0/s so the gate fails loudly rather than passing silently
  // [LAW:no-silent-failure]. `performance.now()` is sub-millisecond, so real load
  // never lands here.
  const achievedPerSec = durationMs > 0 ? (succeeded / durationMs) * 1000 : 0;

  return {
    attempted: scale.movements,
    succeeded,
    failures: scale.movements - succeeded,
    durationMs,
    achievedPerSec,
    expected,
    accounts: allAccounts,
  };
};

/** What concurrent contention for one wallet's coins resolved to: how many of the
 *  identical spends the engine let through, where the balance landed, and the typed
 *  reason every refused spend gave. */
export interface ContentionReport {
  readonly funded: bigint;
  readonly spendAmount: bigint;
  readonly succeeded: number;
  readonly finalBalance: bigint;
  readonly sinkBalance: bigint;
  readonly failures: readonly PostError[];
}

/**
 * Funds one wallet, then fires `spends` identical wallet→sink transfers at once,
 * each large enough that only a few fit. The engine — the single enforcer of the
 * no-overdraft rule [LAW:single-enforcer] — must let exactly as many through as the
 * balance affords and refuse the rest as a typed value, never letting the wallet go
 * negative however the concurrent spends race. Reports the outcome for the caller to
 * assert against; mutates nothing of its own.
 */
export const runOverdraftContention = async (
  ledger: Ledger,
  ns: string,
  scale: StormScale,
): Promise<ContentionReport> => {
  const { acc, key, coins } = scopeOf(ns);
  const reason: TransactionReason = must(transactionReason('contended-spend'));

  const mint = acc('mint');
  const wallet = acc('wallet');
  const sink = acc('sink');
  await Promise.all([
    ledger.openAccount({ id: mint, kind: 'mint' }).then(must),
    ledger.openAccount({ id: wallet, kind: 'user-wallet' }).then(must),
    ledger.openAccount({ id: sink, kind: 'user-wallet' }).then(must),
  ]);

  // The spend is sized so only a fraction of the concurrent attempts fit: funding
  // covers exactly `affordable` whole spends, with a remainder that fits none.
  const spendAmount = 30n;
  const affordable = Math.max(1, Math.floor(scale.overdraftSpends / 3));
  const funded = BigInt(affordable) * spendAmount + spendAmount - 1n;
  must(
    await ledger.post({
      transfers: [must(transfer(mint, wallet, coins(funded)))],
      reason,
      idempotencyKey: key('fund'),
    }),
  );

  const attempts = await Promise.all(
    Array.from({ length: scale.overdraftSpends }, (_unused, i) =>
      ledger.post({
        transfers: [must(transfer(wallet, sink, coins(spendAmount)))],
        reason,
        idempotencyKey: key(`spend-${i}`),
      }),
    ),
  );

  // Narrow each refusal to its typed error rather than casting — the Result union
  // carries the reason, so no assertion is needed [LAW:types-are-the-program].
  const failures: PostError[] = [];
  for (const r of attempts) if (!r.ok) failures.push(r.error);
  return {
    funded,
    spendAmount,
    succeeded: attempts.filter(ok).length,
    finalBalance: await ledger.balanceOf(wallet),
    sinkBalance: await ledger.balanceOf(sink),
    failures,
  };
};

/** What a storm of concurrent duplicate posts resolved to: whether every duplicate
 *  pair agreed on one receipt, whether any post errored, and where the credited
 *  wallet landed versus the single-application total. */
export interface IdempotencyReport {
  readonly keys: number;
  readonly receiptMismatches: number;
  readonly errors: number;
  readonly walletBalance: bigint;
  readonly expectedBalance: bigint;
}

/**
 * Posts each of `idempotencyKeys` movements twice, concurrently under one key, so
 * the engine — not our in-process serializer — is the arbiter of idempotency across
 * the racing pair [LAW:single-enforcer]. Every pair must apply exactly once and both
 * halves must recover the same receipt, so a wallet credited once per key ends at
 * exactly the single-application total: no duplicate can double-credit under load.
 */
export const runIdempotencyStorm = async (
  ledger: Ledger,
  ns: string,
  scale: StormScale,
): Promise<IdempotencyReport> => {
  const { acc, key, coins } = scopeOf(ns);
  const reason: TransactionReason = must(transactionReason('replayed-credit'));

  const mint = acc('mint');
  const wallet = acc('wallet');
  await Promise.all([
    ledger.openAccount({ id: mint, kind: 'mint' }).then(must),
    ledger.openAccount({ id: wallet, kind: 'user-wallet' }).then(must),
  ]);

  const amount = 5n;
  const post = (k: IdempotencyKey): Promise<Result<PostReceipt, PostError>> =>
    ledger.post({
      transfers: [must(transfer(mint, wallet, coins(amount)))],
      reason,
      idempotencyKey: k,
    });

  const pairs = await pool(scale.idempotencyKeys, scale.concurrency, async (i) => {
    const k = key(`dup-${i}`);
    return Promise.all([post(k), post(k)]);
  });

  let receiptMismatches = 0;
  let errors = 0;
  for (const [a, b] of pairs) {
    if (!a.ok || !b.ok) {
      errors += 1;
      continue;
    }
    // Both halves must recover the same recorded moment. The engine stamps the one
    // applied movement and a replay returns that stamp, so an occurredAt disagreement
    // witnesses two movements where there must be one. The transaction id is derived
    // from the key alone — it would agree even on a double-apply — so it cannot be the
    // witness here; the engine-recovered occurredAt can.
    if (a.value.occurredAt !== b.value.occurredAt) receiptMismatches += 1;
  }

  return {
    keys: scale.idempotencyKeys,
    receiptMismatches,
    errors,
    walletBalance: await ledger.balanceOf(wallet),
    expectedBalance: BigInt(scale.idempotencyKeys) * amount,
  };
};

/**
 * The behavioural load contract: the money invariants the {@link Ledger} seam must
 * hold under sustained concurrent fire, asserted against whatever implementation
 * `ledgerOf` returns. The in-memory fake runs it small in the fast suite; the real
 * TigerBeetle engine runs it at production-velocity scale under integration, so the
 * two cannot diverge under load [LAW:behavior-not-structure]. Throughput is *not*
 * asserted here — timing is only meaningful against the real engine, so its gate
 * lives in the integration suite alone.
 *
 * Each test draws a fresh namespace, so a shared, persistent engine keeps every
 * run's accounts and keys disjoint.
 */
export const ledgerLoadContract = (ledgerOf: () => Ledger, scale: StormScale): void => {
  let nsCounter = 0;
  const ns = (): string => `load${(nsCounter += 1)}-`;

  describe('the ledger holds its money invariants under concurrent load', () => {
    test('a production-velocity storm conserves every coin and reconciles per account', async () => {
      const ledger = ledgerOf();
      const report = await runVelocityStorm(ledger, ns(), scale);

      // Every designed-valid post succeeded: a dropped post would be a coin that
      // silently never moved [LAW:no-silent-failure].
      expect(report.failures).toBe(0);
      expect(report.succeeded).toBe(report.attempted);

      // Engine truth equals the independent claimed tally, account by account.
      for (const account of report.accounts) {
        expect(await ledger.balanceOf(account)).toBe(report.expected.get(account) ?? 0n);
      }

      // Double-entry closure over the whole run: no coin was created or destroyed.
      let sum = 0n;
      for (const account of report.accounts) sum += await ledger.balanceOf(account);
      expect(sum).toBe(0n);
    }, loadTimeoutMs(scale));

    test('the no-overdraft rule holds for one wallet under concurrent contention', async () => {
      const ledger = ledgerOf();
      const r = await runOverdraftContention(ledger, ns(), scale);

      // Never negative, and the balance is exactly what the affordable spends left.
      expect(r.finalBalance >= 0n).toBe(true);
      expect(r.finalBalance).toBe(r.funded - BigInt(r.succeeded) * r.spendAmount);
      // Exactly as many spends as the funding afforded got through — no more.
      expect(r.succeeded).toBe(Number(r.funded / r.spendAmount));
      // The sink holds precisely the coins that left the wallet — none conjured.
      expect(r.sinkBalance).toBe(BigInt(r.succeeded) * r.spendAmount);
      // Every refusal is a typed value, never a thrown surprise [LAW:no-silent-failure].
      for (const failure of r.failures) expect(failure.kind).toBe('would-overdraft');
    }, loadTimeoutMs(scale));

    test('concurrent duplicate posts apply exactly once under load', async () => {
      const ledger = ledgerOf();
      const r = await runIdempotencyStorm(ledger, ns(), scale);

      expect(r.errors).toBe(0); // no racing duplicate was refused as a conflict
      expect(r.receiptMismatches).toBe(0);
      expect(r.walletBalance).toBe(r.expectedBalance); // each key credited exactly once
    }, loadTimeoutMs(scale));
  });
};
