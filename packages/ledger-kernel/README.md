# @crowdship/ledger-kernel

The pure, no-IO core of the coin ledger — the one sacred thing in CrowdShip.
This package holds **only** the domain value types. It never touches a database, a
clock, randomness, or the network; those belong to the settlement engine (and its
seam, `@crowdship/ledger`) that stands on this kernel.

## The central idea

A naive double-entry ledger models `Entry[]` and *checks* that the entries of a
movement sum to zero. A check can be skipped, and a checked value can still be built
wrong somewhere else.

Instead, the authoritative primitive here is the **`Transfer`**: `amount` leaves
`from` and arrives at `to`. A transfer is a matched `+amount / -amount` pair, so
**a list of transfers cannot be unbalanced** — there is no code path that produces
an illegal one. Balance is a property of the representation, not a rule we remember
to enforce (`[LAW:types-are-the-program]`). `Transfer` is *nominal* — `transfer()`
is the only way to obtain one — so its distinct-account invariant is carried by the
type everywhere downstream, not merely checked in one function a second caller could
sidestep (`[LAW:single-enforcer]`).

The conservation theorem ("every movement nets to zero") is therefore structural:
because each `Transfer` is a balanced pair, any set of them sums to zero by
construction. The settlement engine (TigerBeetle) enforces it natively too, so the
kernel does not re-derive or re-check it — doing so would be a second authority that
could only drift.

## What this package is

The domain vocabulary every other package speaks in coins:

- `Account` and `AccountKind`, with `mayGoNegative` (only the `mint` may).
- `CoinAmount` — a whole, positive `bigint` count of coins.
- `Transfer` — the balanced unit of movement.
- The branded ids: `AccountId`, `TransactionId`, `IdempotencyKey`,
  `TransactionReason`, and `Timestamp`.
- `Result`, `ok`, `err`, and the `Brand` helper.

## What lives elsewhere (on purpose)

- **Balances, persistence, no-overdraft, idempotency, atomicity** → the settlement
  engine behind the `Ledger` seam (`@crowdship/ledger`). TigerBeetle owns them; this
  kernel states the negativity rule (`mayGoNegative`) but holds no balances, so it
  cannot — and must not — enforce it.
- **The coin↔currency rate / spread / platform cut** → payments policy. The kernel
  knows only whole-coin movements, never prices.

## Money safety choices

- Amounts are `bigint`, so fractional coins and float rounding are unrepresentable.
- Every constructor returns a `Result`; a bad input is a value the caller must
  handle, never a thrown-and-swallowed failure (`[LAW:no-silent-failure]`).
- Domain ids are nominal (`Brand`), so a raw string can never stand in for a
  validated `AccountId`.
