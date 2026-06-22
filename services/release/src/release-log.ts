import type { PostReceipt } from '@crowdship/ledger';
import type { PledgeId } from '@crowdship/settlement';
import type { Timestamp } from '@crowdship/std';

/**
 * The fact recorded when a pledge releases: the ledger receipt proving the coins moved
 * and the instant the engine met-and-released it. It is everything needed to reconstruct
 * the terminal `Released` pledge deterministically from the (unchanged) escrowed pledge a
 * retry hands back — the terms ride in on that pledge, only the receipt and the instant
 * cannot be re-derived, so only those are stored [LAW:one-source-of-truth].
 */
export interface ReleaseRecord {
  readonly receipt: PostReceipt;
  readonly at: Timestamp;
}

/**
 * The authority for the one question observation alone cannot answer for every condition:
 * *has this pledge already released?* The ledger guarantees the coins move at most once
 * (the release movement's idempotency key), but observation cannot replay the verdict for
 * a pool-target condition — releasing DRAINS the escrow whose balance the condition reads,
 * so a second observation of a released pool sees it below target and would wrongly report
 * it unmet. Inferring "already released" from the now-drained balance is exactly how a paid
 * obligation would be silently re-judged unpaid [LAW:no-silent-failure], so the fact lives
 * here, in its own single authority [LAW:one-source-of-truth], consulted before the engine
 * observes anything.
 *
 * This is the menu/ledger `Ledger`-style seam: an in-memory implementation now, a durable
 * one behind the same interface for crash-recovery across processes later — the atomic
 * money-and-record settlement that closes the post-then-record window is the two-phase
 * settlement rail's concern, behind this same seam [LAW:locality-or-seam].
 */
export interface ReleaseLog {
  /** The release record for a pledge, or `undefined` if it has not released yet (so the
   *  engine must observe its condition). */
  released(pledge: PledgeId): Promise<ReleaseRecord | undefined>;
  /** Record that a pledge released. Recording the same release again is harmless. */
  record(pledge: PledgeId, record: ReleaseRecord): Promise<void>;
}

/**
 * The in-memory release log: correct for a single process and for tests, holding exactly
 * the releases recorded so far. A durable, shared implementation slots in behind this same
 * seam with no engine change, exactly as the ledger's in-memory fake gives way to
 * TigerBeetle [LAW:locality-or-seam].
 */
export const createInMemoryReleaseLog = (): ReleaseLog => {
  const done = new Map<PledgeId, ReleaseRecord>();
  return {
    released: (pledge) => Promise.resolve(done.get(pledge)),
    record: (pledge, record) => {
      done.set(pledge, record);
      return Promise.resolve();
    },
  };
};
