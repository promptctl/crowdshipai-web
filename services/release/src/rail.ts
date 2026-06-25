import type { Ledger, MovementCommit, PostError, PostReceipt } from '@crowdship/ledger';
import type {
  IdempotencyKey,
  Result,
  TransactionReason,
  Transfer,
} from '@crowdship/ledger-kernel';
import { idempotencyKey } from '@crowdship/ledger-kernel';
import type { PledgeId } from '@crowdship/settlement';

/**
 * The settlement rail: the one seam a self-paying obligation settles through, so that
 * "custodial now, on-chain later" is a choice of *instance*, not a rewrite
 * [LAW:locality-or-seam]. The release engine names this seam and nothing under it — it
 * hands the rail a pledge to settle and asks whether a pledge has settled, and the
 * custodial rail (coins moved through the `Ledger`) or a future on-chain rail (coins
 * moved on a chain) answers the identical contract. Swapping the rail moves zero
 * settlement-domain code; that is the whole point of cutting the seam here.
 *
 * The rail owns the two acts that must agree about a release — moving the coins and
 * recording that it happened — as ONE thing, because the single fact "this pledge
 * settled" must have a single source of truth [LAW:one-source-of-truth]. Splitting them
 * across two stores (post the coins, then write a record) opens a window: a crash
 * between the two leaves coins moved with no record, and a pooled pledge re-reads its
 * drained escrow as still-below-target and wrongly believes it never paid. The custodial
 * rail closes that window not by making a second record durable — two stores can always
 * disagree without a cross-system commit — but by deriving "settled?" from the money
 * itself: the coin movement *is* the record.
 */
export interface SettlementRail {
  /**
   * Has this pledge already settled, and if so, the committed identity and instant of
   * the movement that settled it? Consulted before the engine observes anything, so a
   * released pool replays its verdict instead of re-reading its now-drained balance.
   * `undefined` means it has not settled — the engine must observe its condition.
   *
   * The custodial rail answers this from the ledger's own commit under the pledge's
   * settlement key, so the answer is true the instant the coins moved, with no second
   * record that a crash could skip [LAW:one-source-of-truth]. It returns the
   * {@link MovementCommit} and not balances: a settled pledge's instant reconstructs its
   * terminal state, and the accounts it touched are not recoverable from the key alone.
   */
  settlementOf(pledge: PledgeId): Promise<MovementCommit | undefined>;

  /**
   * Move the coins for a release AND commit that the pledge settled, as one atomic,
   * idempotent unit keyed by the pledge. A replay of an already-settled pledge moves no
   * coins and returns the original receipt; a ledger that refuses the movement returns
   * its reason as a value, never thrown [LAW:dataflow-not-control-flow]. The caller forms
   * the balanced transfers (it owns the cut policy and the routing); the rail owns only
   * the mechanism of making them happen-and-stick.
   */
  settle(request: SettleRequest): Promise<Result<PostReceipt, PostError>>;
}

/**
 * What the engine asks the rail to settle: which pledge (the identity the settlement is
 * keyed and made idempotent by), the balanced transfers that pay it out, and the audit
 * reason stamped on the movement. The idempotency key is NOT supplied — it is derived
 * from the pledge so the rail alone owns the mapping from pledge to key, and a retry
 * cannot accidentally settle under a different key [LAW:one-source-of-truth].
 */
export interface SettleRequest {
  readonly pledge: PledgeId;
  readonly transfers: readonly [Transfer, ...Transfer[]];
  readonly reason: TransactionReason;
}

/** The idempotency key a pledge's release commits under, derived from its id so the
 *  settle and the settled-check address the SAME movement [LAW:one-source-of-truth]. A
 *  pledge id is non-blank, so the prefixed key is never blank; a failure here would be
 *  corruption, not a routine outcome, so it halts loudly [LAW:no-silent-failure]. */
const settlementKey = (pledge: PledgeId): IdempotencyKey => {
  const key = idempotencyKey(`release:${pledge}`);
  if (!key.ok) throw new Error(`settlement key could not be formed from pledge ${pledge}`);
  return key.value;
};

/**
 * The custodial settlement rail: settlement runs against our own coin balances, through
 * the `Ledger` seam. It is deliberately thin — the ledger already owns balances, the
 * no-overdraft rule, atomicity, and idempotency [LAW:single-enforcer], so the rail adds
 * only the mapping from a pledge to the key its release commits under, and reads
 * "settled?" back from that same commit.
 *
 * This is the instance the founding document calls custodial-for-v1. A trustless on-chain
 * rail is a DIFFERENT `SettlementRail` whose `settle` posts to a chain and whose
 * `settlementOf` reads the chain — landing behind this same seam with no change to the
 * engine that drives it [LAW:locality-or-seam]. The window the custodial rail closes by
 * deriving the record from the ledger, the on-chain rail closes by the chain being the
 * one place both the coins and the record live.
 */
export const createCustodialRail = (ledger: Ledger): SettlementRail => ({
  settlementOf: (pledge) => ledger.commitOf(settlementKey(pledge)),
  settle: ({ pledge, transfers, reason }) =>
    ledger.post({ transfers, reason, idempotencyKey: settlementKey(pledge) }),
});
