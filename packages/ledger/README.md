# @crowdship/ledger

The single write path for the coin ledger — the one place any coin movement is
recorded. It wraps the pure [`@crowdship/ledger-kernel`](../ledger-kernel) with
the things the kernel deliberately refuses to hold: balances, persistence,
no-overdraft enforcement, the clock, and id generation.

## The shape

```
caller ── post(transfers, reason, key) ──▶  Ledger  ──▶  LedgerStore (append-only log + registry)
                                              │
                                              ├─ generates id, supplies occurredAt   [effects at the boundary]
                                              ├─ gathers account kinds + balances     [reads]
                                              ├─ decidePosting(view, txn)             [pure gate — the one enforcer]
                                              └─ append(txn)                          [acts]
```

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
- **Failures are values.** A bad post returns a `Result` whose error names the
  single reason (`no-transfers`, `unknown-account`, `would-overdraft`); nothing
  is thrown-and-swallowed. The one exception is a re-appended transaction id —
  corruption of the authoritative record — which halts loudly. (`[LAW:no-silent-failure]`)

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

- **Idempotent dedup on the key** → ledger ticket .3. The `idempotencyKey` is
  carried into every transaction here, but this path does not yet deduplicate;
  every `post` appends.
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
