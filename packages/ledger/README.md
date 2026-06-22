# @crowdship/ledger

The coin ledger — the one place any coin movement is recorded. It is a
**ports-and-adapters seam**: callers speak coins, and the settlement engine sits
entirely behind the seam, never leaking into a caller ([LAW:locality-or-seam]).

The integrity of value is not something this package *proves by building it* — it
is something we *get* by recording coins in the most trustworthy proven engine and
shipping it. That engine is **TigerBeetle**.

## The shape

```
caller ── post(transfers, reason, key) ──▶  Ledger (port)  ──▶  TigerBeetle  (production)
                                              ▲                  InMemoryLedger (the test fake)
                                              │
                                  open / post / balanceOf / close
```

`Ledger` (`src/port.ts`) is the seam. Two implementations stand behind it, and
nothing else in the system knows which one it holds ([LAW:one-type-per-behavior]):

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

- **The balance/audit query API** — full history, all-account balances, point-in-time
  views → ledger ticket .6, built on TigerBeetle's own history (accounts are opened
  with the engine's `history` flag so those queries are possible). This seam is the
  write-and-point-read surface only; the richer query surface is a separate cut, not
  an amputation ([LAW:decomposition]).
- **Throughput / load validation at production coin velocity** → ledger ticket .7.
- **The buy/sell rate** that maps coins to currency is policy and lives outside the
  ledger entirely; here a coin is only ever a whole count.
