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
 * [LAW:locality-or-seam]. An engine names this seam and nothing under it — it hands the
 * rail a pledge to settle and asks whether a pledge has settled, and the custodial rail
 * (coins moved through the `Ledger`) or a future on-chain rail (coins moved on a chain)
 * answers the identical contract. Swapping the rail moves zero settlement-domain code;
 * that is the whole point of cutting the seam here.
 *
 * A pledge settles in one of two DIRECTIONS — forward to the builder (a release) or back
 * to the backers (a refund) — and the rail carries every one of them the same way. The
 * direction is the {@link SettlementPurpose}, a value that namespaces the movement's key so
 * a pledge's release and its refund address DISTINCT movements that can never collide
 * [LAW:one-source-of-truth]. It is a closed pair, not an open menu: the pledge lifecycle
 * has exactly these two terminal settlements, so the type is exactly as wide as the domain
 * [LAW:types-are-the-program]. This is the money side — which way the coins flow — never a
 * builder's choice of what to sell.
 *
 * The rail owns the two acts that must agree about a settlement — moving the coins and
 * recording that it happened — as ONE thing, because the single fact "this pledge settled
 * (this way)" must have a single source of truth [LAW:one-source-of-truth]. Splitting them
 * across two stores (post the coins, then write a record) opens a window: a crash between
 * the two leaves coins moved with no record, and a pooled pledge re-reads its drained
 * escrow as still-below-target and wrongly believes it never paid. The custodial rail
 * closes that window not by making a second record durable — two stores can always disagree
 * without a cross-system commit — but by deriving "settled?" from the money itself: the coin
 * movement *is* the record.
 */
export interface SettlementRail {
  /**
   * Has this pledge already settled in this DIRECTION, and if so, the committed identity
   * and instant of the movement that settled it? Consulted before an engine observes or
   * computes anything, so a released pool replays its verdict instead of re-reading its
   * now-drained balance, and a refunded pool replays instead of re-deriving its (now
   * fully-paid-out) contributor shares. `undefined` means it has not settled this way — the
   * engine must do the work.
   *
   * The custodial rail answers this from the ledger's own commit under the pledge's
   * settlement key, so the answer is true the instant the coins moved, with no second
   * record that a crash could skip [LAW:one-source-of-truth]. It returns the
   * {@link MovementCommit} and not balances: a settled pledge's instant reconstructs its
   * terminal state, and the accounts it touched are not recoverable from the key alone.
   */
  settlementOf(purpose: SettlementPurpose, pledge: PledgeId): Promise<MovementCommit | undefined>;

  /**
   * Move the coins for a settlement AND commit that the pledge settled (this way), as one
   * atomic, idempotent unit keyed by the pledge and the purpose. A replay of an
   * already-settled pledge moves no coins and returns the original receipt; a ledger that
   * refuses the movement returns its reason as a value, never thrown
   * [LAW:dataflow-not-control-flow]. The caller forms the balanced transfers (it owns the
   * routing — escrow→builder+platform for a release, escrow→backers for a refund); the rail
   * owns only the mechanism of making them happen-and-stick.
   */
  settle(request: SettleRequest): Promise<Result<PostReceipt, PostError>>;
}

/**
 * Which DIRECTION a pledge settles: forward to the builder, or back to the backers. A
 * closed pair, exactly the lifecycle's two terminal phases — `released` and `refunded` —
 * mirrored on the money side. It namespaces a pledge's settlement key so the same pledge's
 * release and refund are different movements; without it, a refund posted under a release's
 * key would be refused as a key reuse, or worse, replay the release's verdict. New
 * directions are not a thing the money side grows — this stays a pair [LAW:no-mode-explosion].
 */
export type SettlementPurpose = 'release' | 'refund';

/**
 * What an engine asks the rail to settle: which pledge (the identity the settlement is keyed
 * and made idempotent by), in which direction, the balanced transfers that pay it out, and
 * the audit reason stamped on the movement. The idempotency key is NOT supplied — it is
 * derived from the pledge and the purpose so the rail alone owns the mapping from pledge to
 * key, and a retry cannot accidentally settle under a different key [LAW:one-source-of-truth].
 */
export interface SettleRequest {
  readonly purpose: SettlementPurpose;
  readonly pledge: PledgeId;
  readonly transfers: readonly [Transfer, ...Transfer[]];
  readonly reason: TransactionReason;
}

/** The idempotency key a pledge's settlement commits under, derived from its purpose and id
 *  so the settle and the settled-check address the SAME movement [LAW:one-source-of-truth],
 *  and a release and a refund of one pledge never collide. A pledge id is non-blank and the
 *  purpose is a fixed literal, so the joined key is never blank; a failure here would be
 *  corruption, not a routine outcome, so it halts loudly [LAW:no-silent-failure]. */
const settlementKey = (purpose: SettlementPurpose, pledge: PledgeId): IdempotencyKey => {
  const key = idempotencyKey(`${purpose}:${pledge}`);
  if (!key.ok) throw new Error(`settlement key could not be formed from ${purpose} of pledge ${pledge}`);
  return key.value;
};

/**
 * The custodial settlement rail: settlement runs against our own coin balances, through the
 * `Ledger` seam. It is deliberately thin — the ledger already owns balances, the no-overdraft
 * rule, atomicity, and idempotency [LAW:single-enforcer], so the rail adds only the mapping
 * from a (pledge, purpose) to the key its movement commits under, and reads "settled?" back
 * from that same commit.
 *
 * This is the instance the founding document calls custodial-for-v1. A trustless on-chain rail
 * is a DIFFERENT `SettlementRail` whose `settle` posts to a chain and whose `settlementOf`
 * reads the chain — landing behind this same seam with no change to the engines that drive it
 * [LAW:locality-or-seam]. The window the custodial rail closes by deriving the record from the
 * ledger, the on-chain rail closes by the chain being the one place both the coins and the
 * record live.
 */
export const createCustodialRail = (ledger: Ledger): SettlementRail => ({
  settlementOf: (purpose, pledge) => ledger.commitOf(settlementKey(purpose, pledge)),
  settle: ({ purpose, pledge, transfers, reason }) =>
    ledger.post({ transfers, reason, idempotencyKey: settlementKey(purpose, pledge) }),
});
