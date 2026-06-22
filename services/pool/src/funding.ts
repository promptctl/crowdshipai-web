import type { AccountConflict, Ledger, PostError, PostReceipt } from '@crowdship/ledger';
import type {
  Account,
  AccountId,
  IdempotencyKey,
  TransactionReason,
  TransferError,
} from '@crowdship/ledger-kernel';
import { transfer } from '@crowdship/ledger-kernel';
import type { PoolObservation } from '@crowdship/settlement';
import { observePool } from '@crowdship/settlement';
import type { CoinAmount, Result } from '@crowdship/std';
import { ok } from '@crowdship/std';

import type { Pool } from './pool.js';

/**
 * One backer funding one pool: the coins they add, and the key + reason that make the
 * movement replay-safe and auditable. The amount is the backer's to choose — "ten people
 * with twenty dollars each" is ten contributions, the platform never dictating the size.
 * The key identifies THIS contribution: a retry must re-issue the identical movement under
 * the same key, which the ledger replays rather than double-charging; a different movement
 * under a spent key is refused.
 */
export interface Contribution {
  readonly pool: Pool;
  readonly backer: AccountId;
  readonly amount: CoinAmount;
  readonly idempotencyKey: IdempotencyKey;
  readonly reason: TransactionReason;
}

/**
 * Every way a contribution resolves, as one closed union the caller destructures — never a
 * bare boolean or a thrown error for a routine outcome [LAW:dataflow-not-control-flow].
 *
 *  - `contributed` — the coins moved into the pool's escrow. Carries the ledger receipt and
 *    the pool `observation`: the target criterion paired with the pool's total as the ledger
 *    currently records it. That total is a point read carried out of the receipt, NOT an
 *    isolated as-of-this-movement snapshot — under a concurrent contribution or a faithful
 *    replay it reflects the live recorded balance (it may already include other backers'
 *    coins, or read zero if a release has since drained the pool). So it is the same `bigint`
 *    reading `PoolObservation` carries, never a strictly-positive movement amount; whether the
 *    pool is now ready to ship is decided by the settlement core's one `isMet` over this
 *    observation, at whichever boundary asks — never a second compare here [LAW:single-enforcer].
 *    The exactly-once *firing* of the release is the engine's to own, not this report's.
 *  - `refused` — the ledger refused the movement (the backer can't cover it, an account was
 *    never opened, the key was reused for a different movement). No coins moved; surfaced,
 *    never swallowed [LAW:no-silent-failure].
 *  - `invalid-contribution` — the backer and the pool's escrow are the same account, so no
 *    movement can even be formed. A misconfiguration, surfaced as a value, not thrown.
 */
export type ContributionOutcome =
  | {
      readonly kind: 'contributed';
      readonly receipt: PostReceipt;
      readonly observation: PoolObservation;
    }
  | { readonly kind: 'refused'; readonly error: PostError }
  | { readonly kind: 'invalid-contribution'; readonly error: TransferError };

/**
 * The funding side of a pooled obligation: a backer adds coins to a pool's shared escrow.
 * One movement, every time — the variety is the value (which pool, which backer, how much),
 * never a branch per kind of contribution [LAW:dataflow-not-control-flow].
 */
export interface PoolFunder {
  contribute(contribution: Contribution): Promise<ContributionOutcome>;
}

/**
 * Provision a pool's escrow account so backers can fund it, returning the pool ready to
 * receive contributions. A pool's escrow exists BECAUSE the pool does, so establishing it is
 * part of opening the pool rather than scattered bootstrap [LAW:locality-or-seam]. Opening is
 * idempotent for the same kind, so re-opening a pool is safe; opening an id that already
 * exists under a different kind is refused, never silently reused [LAW:no-silent-failure]. The
 * builder's wallet is opened elsewhere — a pre-existing account the pool only names.
 */
export const openPool = async (ledger: Ledger, pool: Pool): Promise<Result<Pool, AccountConflict>> => {
  const escrowAccount: Account = { id: pool.escrowAccount, kind: 'escrow' };
  const opened = await ledger.openAccount(escrowAccount);
  if (!opened.ok) return opened;
  return ok(pool);
};

/**
 * Build the pool funder over the one seam it touches: the `Ledger` that owns balances, the
 * no-overdraft rule, and movement idempotency [LAW:single-enforcer]. A contribution is a
 * single coin movement and nothing more — and that is the whole reason this needs neither a
 * completion log nor a per-key serializer, unlike `purchase`. Purchase pairs a charge with a
 * NON-idempotent effect (a shoutout must fire exactly once), so it must remember "did the
 * effect fire?" and serialize racers around that. A contribution has no such second effect:
 * the coin movement IS the entire act, and the ledger's single-use key already makes it
 * at-most-once. Re-posting the identical contribution replays the original receipt and moves
 * nothing more, so two racing retries are both correct with no ordering to own
 * [LAW:no-ambient-temporal-coupling]. The reported total is a live reading of that escrow
 * balance, so it is always a real recorded total — never a doubled or invented one — even
 * though, being a point read, it is not isolated to this one movement.
 *
 * The pool total IS the escrow balance, never a second running sum a contribution would have
 * to keep in step [LAW:one-source-of-truth]. The funder reports that balance paired with the
 * target as a `PoolObservation`; it does not itself judge met-ness — the settlement core's
 * one `isMet` does, at whichever boundary asks, the same predicate the release engine
 * re-applies [LAW:single-enforcer]. The release that follows a reached pool is the
 * auto-release engine's job behind its own seam.
 */
export const createPoolFunder = (ledger: Ledger): PoolFunder => {
  const contribute = async (contribution: Contribution): Promise<ContributionOutcome> => {
    const { pool, backer, amount, idempotencyKey, reason } = contribution;

    // The single contribution movement: coins leave the backer's wallet and arrive in the
    // pool's escrow. `transfer` rejects a same-account leg, so a backer funding the escrow
    // they ARE is a typed outcome, not a movement the ledger must defend.
    const leg = transfer(backer, pool.escrowAccount, amount);
    if (!leg.ok) return { kind: 'invalid-contribution', error: leg.error };

    const posted = await ledger.post({ transfers: [leg.value], reason, idempotencyKey });
    if (!posted.ok) return { kind: 'refused', error: posted.error };

    // The pooled total is the escrow's balance carried out of the receipt — the pool total IS
    // that balance [LAW:one-source-of-truth]. The escrow is this movement's payee, so it is
    // always present; its absence would be a ledger integrity breach, halted loudly rather
    // than defaulted to a number that lies [LAW:no-silent-failure].
    const pooled = posted.value.balances.get(pool.escrowAccount);
    if (pooled === undefined) {
      throw new Error(`ledger receipt omitted the pool escrow balance for ${pool.escrowAccount}`);
    }

    // Pair the reading with the target into the same observation the release engine judges, so
    // readiness is decided by the one `isMet`, never a compare minted here.
    const observation = observePool({ kind: 'pool-target-reached', target: pool.target }, pooled);
    return { kind: 'contributed', receipt: posted.value, observation };
  };

  return { contribute };
};
