# @crowdship/ledger-kernel

The pure, no-IO core of the coin ledger — the one sacred thing in CrowdShip.
This package holds **only** the domain types and the algebra over them. It never
touches a database, a clock, randomness, or the network; those belong to the
posting boundary that wraps this kernel.

## The central idea

A naive double-entry ledger models `Entry[]` and *checks* that the entries of a
transaction sum to zero. A check can be skipped, and a checked value can still
be built wrong somewhere else.

Instead, the authoritative primitive here is the **`Transfer`**: `amount` leaves
`from` and arrives at `to`. A transfer is a matched `+amount / -amount` pair, so
**a list of transfers cannot be unbalanced** — there is no code path that
produces an illegal one. Balance is a property of the representation, not a rule
we remember to enforce (`[LAW:types-are-the-program]`). `Transfer` is *nominal* —
`transfer()` is the only way to obtain one — so its distinct-account invariant
is carried by the type everywhere downstream, not merely checked in one function
a second caller could sidestep (`[LAW:single-enforcer]`).

`Entry` still exists, but as a *derived* debit/credit projection of the
transfers (`entriesOf`), never a second source of truth that could drift from
them (`[LAW:one-source-of-truth]`).

## The theorem

For any `Transaction`, `netEffect(txn)` sums to exactly `0n` across all
accounts. It is true by construction and asserted as a property over arbitrary
transactions in the test suite (`[LAW:verifiable-goals]`).

## What lives elsewhere (on purpose)

- **Balances, persistence, no-overdraft, idempotent posting** → the single write
  path (ledger ticket 2/3/4). This kernel states the negativity rule
  (`mayGoNegative`) but does not hold balances, so it cannot enforce it.
- **The coin↔currency rate / spread / platform cut** → payments policy. The
  kernel knows only whole-coin movements, never prices.
- **Custodial vs. on-chain settlement** → the settlement-agnostic posting
  interface (ledger ticket 5) wraps this kernel; the kernel is identical either
  way.

## Money safety choices

- Amounts are `bigint`, so fractional coins and float rounding are
  unrepresentable.
- Every constructor returns a `Result`; a bad input is a value the caller must
  handle, never a thrown-and-swallowed failure (`[LAW:no-silent-failure]`).
- Domain ids are nominal (`Brand`), so a raw string can never stand in for a
  validated `AccountId`.
