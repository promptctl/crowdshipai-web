import type { AccountId } from '@crowdship/ledger-kernel';
import type { OnRampOutcome } from '@crowdship/on-ramp';
import type { ContributionOutcome } from '@crowdship/pool';
import type { PurchaseOutcome } from '@crowdship/purchase';
import type { ReleaseOutcome } from '@crowdship/release';

import type { FundResult, PledgeResult, PoolCancelResult, SpendResult } from '../data/buy-result';
import type { PoolView, SettlementEventView } from '../data/types';
import type { CancelOutcome, ChannelSettlementEvent, FeaturePoolView } from './market';

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
  cancelled: view.cancelled,
});

/**
 * The public display labels a settlement event's parties resolve to — the facts the
 * projection deliberately does not hold, lifted to this seam as values so the mapper
 * stays a closed, caller-agnostic projection [LAW:composability]. The backer label is a
 * function because WHICH backer varies per event; the builder and platform are fixed for
 * the channel being rendered. The action edge supplies all three, applying the same
 * naming policy chat uses so one person carries one public identity everywhere
 * [LAW:one-source-of-truth].
 */
export interface SettlementPartyLabels {
  backer(account: AccountId): string;
  readonly builder: string;
  readonly platform: string;
}

/**
 * Project one tagged settlement event (branded ids, bigints, timestamps) to the
 * serializable {@link SettlementEventView} the surface holds — plain strings and numbers
 * only, same discipline as {@link toPoolView} [LAW:effects-at-boundaries]. Pure and
 * total: an exhaustive match over the projection's closed event union, so a new
 * settlement kind is a compile error here, never a money movement the surface silently
 * fails to render [LAW:dataflow-not-control-flow] [LAW:no-silent-failure].
 */
export const toSettlementView = (
  tagged: ChannelSettlementEvent,
  labels: SettlementPartyLabels,
): SettlementEventView => {
  const { poolTitle, event } = tagged;
  const common = {
    poolTitle,
    amountCoins: Number(event.amount),
    pooledAfterCoins: Number(event.pooledAfter),
    atMs: Number(event.at),
  };
  switch (event.kind) {
    case 'contribution':
      return { kind: 'contribution', party: labels.backer(event.backer), ...common };
    case 'release':
      return { kind: 'release', party: labels.builder, ...common };
    case 'cut':
      return { kind: 'cut', party: labels.platform, ...common };
    case 'refund':
      return { kind: 'refund', party: labels.backer(event.backer), ...common };
  }
};

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
/**
 * Project the market's cancel outcome onto the surface result. Pure and total over the
 * closed {@link CancelOutcome} union — a new arm is a compile error here, never a money
 * case the studio silently fails to report [LAW:dataflow-not-control-flow]
 * [LAW:no-silent-failure]. The `refundedCoins` on the freshly-refunded arm is supplied by
 * the caller from the ledger's own recorded refund legs; this mapper derives nothing
 * [LAW:one-source-of-truth]. The `already-refunded` replay maps to `already-cancelled`:
 * the money had returned on a prior act, so nothing newly happened for the builder to see.
 * `refundedCoins` is `null` exactly when no fresh refund happened; a freshly-refunded
 * outcome arriving without its figure is a caller bug surfaced loudly, never a money line
 * rendered as zero [LAW:no-silent-failure].
 */
export const toCancelResult = (outcome: CancelOutcome, refundedCoins: number | null): PoolCancelResult => {
  switch (outcome.kind) {
    case 'cancelled': {
      const pool = toPoolView(outcome.pool);
      switch (outcome.refund.kind) {
        case 'refunded': {
          if (refundedCoins === null) {
            throw new Error(`cancel: pool ${pool.id} refunded but no recorded refund total was supplied`);
          }
          return { kind: 'cancelled-refunded', pool, refundedCoins };
        }
        case 'nothing-to-refund':
          return { kind: 'cancelled-empty', pool };
        case 'already-refunded':
          return { kind: 'already-cancelled', pool };
      }
    }
    case 'already-cancelled':
      return { kind: 'already-cancelled', pool: toPoolView(outcome.pool) };
    case 'already-released':
      return { kind: 'already-released', pool: toPoolView(outcome.pool) };
    case 'not-your-pool':
      return { kind: 'not-your-pool' };
    case 'no-such-pool':
      return { kind: 'no-such-pool' };
    case 'refund-refused':
      return { kind: 'cancel-refused' };
  }
};

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
