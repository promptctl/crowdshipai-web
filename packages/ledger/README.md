# @crowdship/ledger

The coin ledger — the one place any coin movement is recorded. It is a
**ports-and-adapters seam**: callers speak coins, and the settlement engine sits
entirely behind the seam, never leaking into a caller ([LAW:locality-or-seam]).

The integrity of value is not something this package *proves by building it* — it
is something we *get* by recording coins in the most trustworthy proven engine and
shipping it. That engine is **TigerBeetle**.

## The shape

```
caller ── post(transfers, reason, key) ──▶  Ledger      (port: write + point-read)
caller ── balanceAt / historyOf ─────────▶  LedgerQuery (port: read + audit)
                                              ▲   ▲
                                              │   └──▶ TigerBeetle  (production)
                                              │        InMemoryLedger (the test fake)
                                  open / post / balanceOf / close
```

The seam is two ports, cut by concern ([LAW:decomposition]): `Ledger` (`src/port.ts`)
is the *write and point-read* surface (open / post / balanceOf / close), and
`LedgerQuery` (`src/query.ts`) is the *read and audit* surface (point-in-time
balances, full per-account history). A caller that only records movements depends on
`Ledger`; one that audits depends on `LedgerQuery`; neither drags in the other. Both
ports are implemented by the same backend so they share one source of truth — the
engine — and cannot disagree ([LAW:one-source-of-truth]).

Two implementations stand behind the seam, and nothing else in the system knows
which one it holds ([LAW:one-type-per-behavior]):

- **`TigerBeetleLedger`** (`src/tigerbeetle-ledger.ts`) — production. A thin adapter
  over a TigerBeetle cluster. It holds **no balance or account state of its own**:
  every domain id maps to an engine id by a pure hash, so there is nothing here that
  could drift from the engine ([LAW:one-source-of-truth]).
- **`InMemoryLedger`** (`src/in-memory-ledger.ts`) — a small fake behind the same
  seam, so everything downstream of the ledger can be tested fast and hermetically.
  It is a test double, **not** a second production ledger.

## The engine is the single enforcer

TigerBeetle owns every money rule; this package re-checks none of them, because a
second authority is one that can drift ([LAW:single-enforcer], [LAW:one-source-of-truth]):

- **No coin from nowhere.** Each account kind maps to a TigerBeetle account flag.
  Every kind but the `mint` is held to *debits must not exceed credits* — i.e. it
  cannot overdraft — by the engine. The mint omits that flag; its negative balance
  *is* the coins in circulation (`mayGoNegative`).
- **Balances are the engine's.** A balance is `credits_posted - debits_posted`, read
  straight from the engine. Nothing is folded or cached on our side.
- **Atomic movements.** A multi-leg movement (a backer paying a builder *and* the
  platform cut) is one chain of linked transfers: it commits whole or not at all.
- **Idempotency is the engine's.** Each leg's transfer id is a deterministic hash of
  the idempotency key and leg index, so a retry submits the same ids and the engine
  dedupes them natively.

## The idempotency contract

An idempotency **key is single-use**:

- A movement that **succeeds** is replayable — re-posting the identical movement
  under the same key returns the *original* receipt and records nothing, so a retry
  can never double-spend.
- A movement that **fails** (overdraft, unknown account) still **spends its key**:
  the engine remembers the failed transfer ids, so re-posting under that key is
  refused as `idempotency-key-reused`. A corrected retry must use a **fresh key**.
- Reusing a key for a **different** movement is refused the same way.

Idempotency is enforced by the engine, not by an in-process lock, so it holds across
processes — the platform's horizontal-scale posture. A small in-process serializer
orders same-key posts to keep the common path tidy, but the engine is the authority,
and the integration suite proves the cross-process case against a live cluster.

## The audit/query side derives from the engine

`LedgerQuery` answers two questions, and every number in the answer is *derived from
the engine's own recorded history*, never a second balance we keep and fold
([LAW:one-source-of-truth]):

- **`balanceAt(account, asOf)`** — the balance as it stood at a moment, read straight
  from TigerBeetle's history (accounts are opened with the engine's `history` flag
  precisely so this is possible). It is immune to every movement that came later;
  `balanceAt(account, now)` is exactly `balanceOf`, generalised across time.
- **`historyOf(account)`** — every transfer leg that touched the account, oldest
  first: what moved, with whom, why, when, and the balance it left behind. Each entry
  is one leg seen from the account's side (`credit` if coins arrived, `debit` if they
  left), so the sign lives in a discriminator and the amount stays a positive count.

**The one thing the engine cannot hold is strings.** A movement's reason and an
account's id reach TigerBeetle only as one-way fingerprints (it stores money, not
text). So a small **control-plane store** — `NameStore` (`src/name-store.ts`) — keeps
`fingerprint → verbatim string` beside the engine, written when an account is opened
and when a movement is posted, read back when history is queried. It holds no money,
so it is no second authority that could drift ([LAW:one-source-of-truth]) — only the
engine's dictionary. It is a seam (`InMemoryNameStore` now, a durable cross-process
store later) so the production follow-up slots in with no caller change. `historyOf`
requires the store to hold a name for every account and reason in an account's
history — true by construction when one process records and reads through one store;
a multi-process audit needs a shared durable store. A name the store lacks is
surfaced loudly with its cause, never a blank shrugged past ([LAW:no-silent-failure]),
and is reported as a *name gap* distinct from engine corruption — the money it labels
is intact in the engine.

## Failures are values; corruption is loud

A bad post returns a `Result` whose error names the single reason
(`unknown-account`, `would-overdraft`, `idempotency-key-reused`); nothing is
thrown-and-swallowed ([LAW:dataflow-not-control-flow]). The one thing that *does*
throw is genuine engine corruption — a status the domain types should have made
impossible — which halts loudly rather than being mapped to a routine error
([LAW:no-silent-failure]).

```ts
import { createInMemoryLedger, createTigerBeetleLedger } from '@crowdship/ledger';

// Tests / local dev: the fake, optionally with a deterministic clock.
const ledger = createInMemoryLedger();

// Production: a real cluster behind the same seam.
// const ledger = createTigerBeetleLedger({ clusterId: 0n, replicaAddresses: ['127.0.0.1:3000'] });

await ledger.openAccount({ id: mintId, kind: 'mint' });
await ledger.openAccount({ id: aliceId, kind: 'user-wallet' });

const result = await ledger.post({ transfers: [mintToAlice], reason, idempotencyKey });
// result.ok === true → result.value.balances has alice: +500, mint: -500
```

## Testing

- `pnpm test` — the fast suite. Runs the shared seam contract
  (`test/ledger-contract.ts`) against the in-memory fake. No engine required.
- `pnpm test:integration` — runs the **same** contract, plus cross-process tests,
  against a real TigerBeetle cluster the harness boots itself
  (`integration/`). The fake and the engine must satisfy the identical contract, so
  the fake can never silently drift from production ([LAW:behavior-not-structure]).
  A money path is never silently un-run: if the engine cannot be obtained, the suite
  fails loudly ([LAW:no-silent-failure]).

## What lives elsewhere (on purpose)

- **Throughput / load validation at production coin velocity** → ledger ticket .7.
- **A durable, cross-process `NameStore`** — the in-memory one recovers names in the
  process that recorded them, which serves single-process audit and the tests; a
  shared persistent store for recovering names a *different* process recorded slots in
  behind the same seam.
- **Movement-level audit fields** — an entry's domain transaction id and an
  all-account roster are additive later (the former needs a per-movement engine key,
  the latter an account registry TigerBeetle does not natively enumerate); the
  per-account, per-leg history here is the foundation they would build on.
- **The buy/sell rate** that maps coins to currency is policy and lives outside the
  ledger entirely; here a coin is only ever a whole count.
