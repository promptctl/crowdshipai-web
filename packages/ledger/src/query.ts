import type {
  AccountId,
  CoinAmount,
  Timestamp,
  TransactionReason,
} from '@crowdship/ledger-kernel';

/**
 * The ledger's *read and audit* surface, deliberately a seam apart from the
 * write-and-point-read {@link Ledger} [LAW:decomposition]. A caller that only
 * needs to record a movement depends on `Ledger`; one that needs to audit
 * depends on `LedgerQuery`; neither drags in the other. Both are implemented by
 * the same concrete backend so they share one source of truth — the engine — and
 * cannot disagree [LAW:one-source-of-truth].
 *
 * Every number here is *derived from the engine's own recorded history*, never a
 * second balance we keep and fold [LAW:one-source-of-truth]. TigerBeetle accounts
 * are opened with the `history` flag precisely so these point-in-time and
 * full-history reads come from the engine; the in-memory fake derives the same
 * answers from its own movement log, and the shared contract proves the two
 * agree [LAW:behavior-not-structure].
 */
export interface LedgerQuery {
  /** The balance of an account *as it stood at a moment*: the engine's recorded
   *  balance after the last movement at or before `asOf`, immune to every movement
   *  that came later. `0n` for an account with no movement by then. A total lookup —
   *  never throws for an absent account. `balanceAt(account, now)` is exactly today's
   *  `balanceOf`; this is its generalisation across time.
   *
   *  `asOf` is a millisecond, and the cut is inclusive *through the end of that
   *  millisecond*: every movement whose moment is `asOf` counts. Two movements that
   *  land in the same millisecond therefore both count, and the result is the balance
   *  after the later of them — a query by one movement's moment includes any sibling
   *  recorded in the same millisecond. */
  balanceAt(account: AccountId, asOf: Timestamp): Promise<bigint>;

  /** Every movement that touched an account, oldest first: the complete, derived
   *  audit trail. Each entry is one transfer leg from the account's point of view
   *  — what moved, with whom, why, when, and the balance it left behind — so the
   *  story of an account is just the in-order list of what happened to it. An
   *  account with no movement has an empty history; an absent account likewise. */
  historyOf(account: AccountId): Promise<readonly AccountMovement[]>;
}

/**
 * One line in an account's audit trail: a single transfer leg seen from *this*
 * account's side. The money facts (direction, amount, counterparty, resulting
 * balance, time) are read straight from the engine; the verbatim `reason` is the
 * one thing the engine cannot hold — it stores a fingerprint of the words, not
 * the words — so it is recovered from the control-plane store that keeps the
 * names beside the numbers.
 */
export interface AccountMovement {
  /** When the engine recorded this movement. */
  readonly occurredAt: Timestamp;
  /** `credit` if coins arrived at this account, `debit` if they left it. The sign
   *  of the movement lives in this discriminator, so `amount` stays a positive
   *  coin count and no caller juggles a signed number [LAW:dataflow-not-control-flow]. */
  readonly direction: MovementDirection;
  /** How many coins moved on this leg — always at least one (a `CoinAmount`). */
  readonly amount: CoinAmount;
  /** The other account on this leg: where the coins went (for a `debit`) or came
   *  from (for a `credit`). */
  readonly counterparty: AccountId;
  /** This account's balance immediately after the leg was applied. Read from the
   *  engine's own history, never re-summed by us [LAW:one-source-of-truth]. */
  readonly resultingBalance: bigint;
  /** Why the coins moved, verbatim — the same string the post carried. */
  readonly reason: TransactionReason;
}

export type MovementDirection = 'credit' | 'debit';
