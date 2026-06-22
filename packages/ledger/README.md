# @crowdship/ledger

The single write path for the coin ledger — the one place any coin movement is
recorded. It wraps the pure [`@crowdship/ledger-kernel`](../ledger-kernel) with
the things the kernel deliberately refuses to hold: balances, persistence,
no-overdraft enforcement, the clock, and id generation.

## The shape

```
caller ── post(transfers, reason, key) ──▶  Ledger  ──▶  LedgerStore (append-only log + registry)
                                              │
                                              ├─ findByIdempotencyKey(key)           [reads: the recorded txn, if any]
                                              ├─ decideIdempotency(req, prior)        [pure: fresh | replay | conflict]
                                              ├─ generates id, supplies occurredAt   [effects at the boundary]
                                              ├─ gathers account kinds + balances     [reads]
                                              ├─ decidePosting(view, txn)             [pure gate — the one enforcer]
                                              ├─ append(txn)                          [acts]
                                              └─ resultingBalances(log, txn)          [pure: the one receipt author]
```

The idempotency lookup is a *pure lookup* — it returns only the recorded
transaction, never balances. Both receipts a `post` can return (the fresh post and
the replay of a prior one) derive their balances above the seam through the single
`resultingBalances` function, so the two can never disagree and every engine behind
the seam implements a lookup and nothing more. (`[LAW:one-source-of-truth]`,
`[LAW:locality-or-seam]`)

There is exactly one way to move value: `Ledger.post`. There is no second
constructor, no direct store mutation, no balance you can set. (`[LAW:single-enforcer]`)

## What it guarantees

- **One enforcer, no torn writes.** Every `post` and `openAccount` is serialized
  through a single-writer chain, so a read-decide-append sequence can never
  interleave with another and double-spend. The serialization is an explicit
  owner, not an accident of synchronous execution. (`[LAW:no-ambient-temporal-coupling]`)
- **No coin from nowhere.** A post that would drive any account below zero is
  refused — unless the account is the `mint`, whose negative balance *is* the
  number of coins in circulation (`mayGoNegative`). Overdraft is judged on the
  *net* effect, so an account that dips and recovers within one atomic
  transaction is never falsely refused.
- **Append-only history is the truth.** Balances are *derived* by folding the
  log, never stored as a second number that could drift. (`[LAW:one-source-of-truth]`)
- **A retry can never double-spend.** Every post is idempotent on its key: re-sending
  the same operation under the same key returns the *original* receipt (point-in-time
  balances and all) and appends nothing. The dedup check and the append run in the same
  serialized section, so even concurrent retries of one key let exactly one movement
  through. Reusing a key for a *different* operation is refused loudly as a value
  (`idempotency-key-reused`) rather than silently absorbed. The seen-keys answer is
  *derived from the log* — every transaction carries its key — so a durable store
  deduplicates correctly across restarts with no second record to keep in sync.
  (`[LAW:one-source-of-truth]`)
- **Failures are values.** A bad post returns a `Result` whose error names the
  single reason (`no-transfers`, `unknown-account`, `would-overdraft`,
  `idempotency-key-reused`); nothing is thrown-and-swallowed. The one exception is a
  re-appended transaction id or idempotency key reaching the log — corruption of the
  authoritative record — which halts loudly. (`[LAW:no-silent-failure]`)

## Effects live only here

The kernel never reads a clock or generates randomness. This boundary supplies
both as injected capabilities (`clock`, `newTransactionId`), so tests run with a
deterministic clock and id source and the kernel stays pure. (`[LAW:effects-at-boundaries]`)

```ts
import { createLedger } from '@crowdship/ledger';

const ledger = createLedger(); // in-memory store, system clock, uuid ids

await ledger.openAccount({ id: mintId, kind: 'mint' });
await ledger.openAccount({ id: aliceId, kind: 'user-wallet' });

const receipt = await ledger.post({ transfers: [mintToAlice], reason, idempotencyKey });
// receipt.ok === true → receipt.value.balances has alice: +500, mint: -500
```

## What lives elsewhere (on purpose)

- **Continuous reconciliation / drift alarms** → ledger ticket .4. This path
  enforces per-post invariants; global monitoring (and reconciling any future
  derived balance index against the fold) is its own boundary.
- **Custodial-vs-on-chain settlement** → ledger ticket .5. The `LedgerStore`
  seam is async precisely so a durable database or settlement rail swaps in
  without touching the write path. (`[LAW:locality-or-seam]`)
- **The full balance/audit query API** → ledger ticket .6, built on the same
  "balances are a fold of history" derivation this package establishes.
- **Throughput** → ledger ticket .7. The reference store folds the log on demand;
  a derived index for velocity is a later, reconciled optimization.
