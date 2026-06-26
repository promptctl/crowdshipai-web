import type { OnRampOutcome } from '@crowdship/on-ramp';
import type { ContributionOutcome } from '@crowdship/pool';
import type { PurchaseOutcome } from '@crowdship/purchase';
import type { ReleaseOutcome } from '@crowdship/release';

import type { FundResult, PledgeResult, SpendResult } from '../data/buy-result';
import type { PoolView } from '../data/types';
import type { FeaturePoolView } from './market';

/**
 * Parse an untrusted coin amount from the wire into a positive, exact count — or
 * null if it is not one. `buyCoins` is an exported server action, a network
 * endpoint any crafted request can reach and not only the surface's fixed packs,
 * so the raw `number` is validated HERE at its trust boundary [LAW:single-enforcer]
 * before it becomes a `bigint` (which throws on a fraction) or a `CoinAmount`
 * (which rejects a non-positive). A bad amount is a representable input, so it
 * resolves to a typed `invalid-amount` outcome rather than a thrown guard
 * [LAW:no-silent-failure][LAW:types-are-the-program]. `Number.isSafeInteger`
 * rejects fractions, NaN, ±Infinity, and magnitudes past 2^53 where integer
 * precision silently breaks down — the floor the timestamp and coin primitives hold.
 */
export const coinPurchaseAmount = (coins: number): bigint | null =>
  Number.isSafeInteger(coins) && coins > 0 ? BigInt(coins) : null;

/**
 * Project the purchase pipeline's domain outcome onto the surface result, pairing
 * it with the balance re-read after the attempt. Pure and total — an exhaustive
 * match over the closed {@link PurchaseOutcome} union with no default arm, so a new
 * outcome arm is a compile error here, never a silently dropped money case
 * [LAW:dataflow-not-control-flow]. The one arm that splits is `charge-refused`: a
 * `would-overdraft` is the everyday "buy more coins" case the surface invites a
 * retry on, while any other ledger refusal is a fault the surface must not dress up
 * as "not enough coins" [LAW:no-silent-failure]. `effect-failed` is preserved
 * distinct from every "no coins moved" arm because coins DID move — the surface owes
 * the backer the loud reconciliation, not a generic failure.
 */
export const toSpendResult = (outcome: PurchaseOutcome, balance: number): SpendResult => {
  switch (outcome.kind) {
    case 'fired':
      return { kind: 'fired', balance };
    case 'already-applied':
      return { kind: 'already-applied', balance };
    case 'charge-refused':
      return outcome.error.kind === 'would-overdraft'
        ? { kind: 'insufficient-coins', balance }
        : { kind: 'charge-refused', balance };
    case 'invalid-charge':
      return { kind: 'invalid-charge', balance };
    case 'effect-failed':
      return { kind: 'effect-failed', balance };
  }
};

/**
 * Project the on-ramp's domain outcome onto the surface result. Pure and total over
 * the closed {@link OnRampOutcome} union, same discipline as {@link toSpendResult}:
 * `credit-refused` (fiat charged, coins not credited) stays distinct from
 * `charge-declined` (no money moved) because the money truth differs and the surface
 * owes the backer a true account of which one happened [LAW:no-silent-failure].
 */
export const toFundResult = (outcome: OnRampOutcome, balance: number): FundResult => {
  switch (outcome.kind) {
    case 'purchased':
      return { kind: 'purchased', balance };
    case 'charge-declined':
      return { kind: 'charge-declined', balance };
    case 'credit-refused':
      return { kind: 'credit-refused', balance };
    case 'invalid-routing':
      return { kind: 'invalid-routing', balance };
  }
};

/**
 * Project a domain {@link FeaturePoolView} (branded id, bigint amounts) to the
 * serializable {@link PoolView} the surface holds — plain string and number only.
 * Pure and zero-loss: the brand is compile-time only, and `Number(bigint)` is
 * lossless for coin amounts that fit in a JS safe integer (< 2^53, which the
 * ledger kernel's own cap enforces) [LAW:effects-at-boundaries].
 */
export const toPoolView = (view: FeaturePoolView): PoolView => ({
  id: String(view.id),
  title: view.title,
  builderSlug: view.builderSlug,
  targetCoins: Number(view.target),
  pooledCoins: Number(view.pooled),
  released: view.released,
});

/**
 * Project the pool pledge's composite domain outcome onto the surface result. Pure and
 * total over both the {@link ContributionOutcome} and the {@link ReleaseOutcome} it
 * pairs with, so a new arm in either is a compile error here rather than a silently
 * dropped case [LAW:dataflow-not-control-flow].
 *
 * The `contributed-released` vs `contributed-pending` split is preserved — not collapsed
 * into a single `contributed` — because the release IS the product differentiator:
 * "the backer whose pledge tips the target watches the whole pool ship." Collapsing it
 * would hide the moment of settlement [LAW:no-silent-failure].
 *
 * The `release` arm is trusted conservatively: any non-`released` / non-`already-released`
 * release outcome after a successful contribution yields `contributed-pending`. The coins
 * ARE safely in escrow; the engine retries on the next pledge or explicit poll. The
 * balance and pool view are always the ledger's truth re-read after the attempt
 * [LAW:one-source-of-truth].
 */
export const toPledgeResult = (
  contribution: ContributionOutcome,
  release: ReleaseOutcome<unknown>,
  pool: PoolView,
  balance: number,
): PledgeResult => {
  switch (contribution.kind) {
    case 'contributed': {
      const shipped = release.kind === 'released' || release.kind === 'already-released';
      return shipped
        ? { kind: 'contributed-released', balance, pool }
        : { kind: 'contributed-pending', balance, pool };
    }
    case 'refused':
      return contribution.error.kind === 'would-overdraft'
        ? { kind: 'insufficient-coins', balance }
        : { kind: 'pledge-refused', balance };
    case 'invalid-contribution':
      return { kind: 'invalid-pledge' };
  }
};
