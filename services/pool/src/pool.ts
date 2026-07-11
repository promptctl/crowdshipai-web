import type { AccountId } from '@crowdship/ledger-kernel';
import type { Escrowed, PledgeId, PoolTargetReached } from '@crowdship/settlement';
import { escrow, pledgeId } from '@crowdship/settlement';
import type { BlankError, Brand, CoinAmount, Result, Timestamp } from '@crowdship/std';
import { nonBlank } from '@crowdship/std';

/** Identity of a pool — opaque, minted once when the pool opens. The same non-blank,
 *  verbatim key every other id on the platform is: taken exactly as given, since
 *  normalization would silently change identity [LAW:no-silent-failure]. */
export type PoolId = Brand<string, 'PoolId'>;

export const poolId = (raw: string): Result<PoolId, BlankError> => nonBlank<'PoolId'>('poolId', raw);

/**
 * A pooled obligation as a first-class entity: many backers fund one shared escrow toward
 * one target, and the instant the target is reached the pool ships to one builder — the
 * TARGET's worth of it, with any overshoot returned to the backers pro-rata in the same
 * settlement. This is IDENTITY laid over the positional obligation the auto-release engine
 * already drains [LAW:locality-or-seam] — the escrow account *is* the pool, so the pooled
 * total is that account's ledger balance, never a second running sum a contribution would
 * have to keep in step [LAW:one-source-of-truth].
 *
 *  - `id` — who this pool is, so contributions, the stream's settlement feed, and a later
 *    refund path all name the same pool rather than passing its accounts around positionally.
 *  - `escrowAccount` — where every backer's coins are held until release; its BALANCE is the
 *    pooled total, judged against the target and drained whole on release (the target's
 *    split to the builder and platform, the excess back to the backers).
 *  - `builderAccount` — who ships it, paid the target minus the platform cut on release.
 *  - `target` — the coins that must accumulate in escrow before the obligation releases,
 *    and exactly what releases when it does: the price the backers funded the feature at.
 */
export interface Pool {
  readonly id: PoolId;
  readonly escrowAccount: AccountId;
  readonly builderAccount: AccountId;
  readonly target: CoinAmount;
}

/**
 * The concrete terms a pool's release pledge carries. Structurally this IS the release
 * engine's obligation shape ({escrowAccount, builderAccount, condition}) with the pool's
 * identity riding alongside and the condition pinned to its only kind — a pool always
 * releases on its target, never a deliverable or goal [LAW:types-are-the-program]. The
 * engine is generic over its terms and reads only the obligation fields, so the extra
 * `poolId` rides through untouched to the released pledge, where the stream's settlement
 * feed reads it to name which pool just shipped. The pool service never imports the release
 * engine [LAW:one-way-deps]; it emits this shape and the product surface hands it across.
 */
export interface PoolTerms {
  readonly poolId: PoolId;
  readonly escrowAccount: AccountId;
  readonly builderAccount: AccountId;
  readonly condition: PoolTargetReached;
}

/** The release pledge's id for a pool, derived from the pool id so the auto-release engine
 *  keys its idempotency and its log on a stable, pool-deterministic id. A pool id is
 *  non-blank, so the prefixed key is never blank; a failure here would be corruption, not a
 *  routine outcome, so it halts loudly rather than minting a degenerate id [LAW:no-silent-failure]. */
const poolPledgeId = (id: PoolId): PledgeId => {
  const minted = pledgeId(`pool:${id}`);
  if (!minted.ok) throw new Error(`pool pledge id could not be formed from pool ${id}`);
  return minted.value;
};

/**
 * Project a pool into the escrowed pledge the auto-release engine settles. The notional
 * `amount` is the target — but the engine ignores it and reads exactly the escrow balance
 * [LAW:one-source-of-truth], so the very divergence (notional vs. held) that was a
 * release-engine review finding cannot recur here: many backers funding one escrow makes the
 * held balance the pooled total, and the engine drains all of it — the target's split to
 * the builder, any overshoot back to the backers, one movement. Pure — the instant is owned
 * and passed in by the boundary, never read ambiently [LAW:no-ambient-temporal-coupling].
 */
export const asEscrowedPledge = (pool: Pool, at: Timestamp): Escrowed<PoolTerms> =>
  escrow(
    poolPledgeId(pool.id),
    pool.target,
    {
      poolId: pool.id,
      escrowAccount: pool.escrowAccount,
      builderAccount: pool.builderAccount,
      condition: { kind: 'pool-target-reached', target: pool.target },
    },
    at,
  );
