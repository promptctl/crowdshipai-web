'use server';

import { poolId as makePoolId } from '@crowdship/pool';

import type { FundResult, PledgeResult, PoolCancelResult, PoolOpenResult, SpendResult } from '../data/buy-result';
import type { PoolView, SettlementEventView } from '../data/types';
import { getCatalog } from '../data/catalog';
import { chatAuthorLabel } from '../data/chat';
import {
  coinPurchaseAmount,
  toCancelResult,
  toFundResult,
  toPledgeResult,
  toPoolView,
  toSpendResult,
  toSettlementView,
  type SettlementPartyLabels,
} from './buy-mapping';
import { getChannelService } from './channels';
import { announceEffectFired, announceSettlement } from './live-feed';
import {
  backerPrincipalIdOf,
  cancelFeaturePool,
  channelSettlementFeed,
  coinBalanceOf,
  creditCoins,
  listFeaturePools,
  openFeaturePool,
  pledgeToFeaturePool,
  settlementFeedOfPool,
  spendOnOffer,
  type CancelOutcome,
  type PledgeOutcome,
} from './market';
import { currentPrincipal } from './principal';

/**
 * The backer's money actions — the `'use server'` edge over the market composition
 * root. Each resolves the request-bound effect (WHO is acting, via
 * {@link currentPrincipal}) at its own boundary and hands the pure money mechanics
 * to {@link spendOnOffer}/{@link creditCoins}, then projects the domain outcome to a
 * serializable surface result [LAW:effects-at-boundaries]. Spending requires a live
 * session: a viewer with no account has no wallet to move coins out of, so an
 * anonymous request is refused as `must-authenticate` rather than spending from a
 * phantom account [LAW:no-silent-failure].
 *
 * The `attemptId` is the backer's per-click intent, minted client-side and passed
 * in: it keys both money movements so a double-submit of the SAME click is an
 * idempotent no-op (the ledger and PSP replay their first result), while a genuinely
 * new click carries a fresh id and is a new purchase [LAW:no-ambient-temporal-coupling].
 *
 * Every routine money outcome is a typed arm of the returned result; a thrown
 * rejection is reserved for the exceptional, corruption-class failure the pipeline
 * itself refuses to downgrade to a routine arm [LAW:no-silent-failure]. That
 * rejection is the loud server error boundary, surfaced to the backer by the
 * calling surface rather than swallowed into a misleading "try again" outcome.
 */

export async function buyOffer(
  slug: string,
  offerId: string,
  attemptId: string,
): Promise<SpendResult> {
  const principal = await currentPrincipal();
  if (principal === null) return { kind: 'must-authenticate' };

  const offer = await getCatalog().purchasable(slug, offerId);
  if (offer === null) return { kind: 'no-such-offer' };

  const outcome = await spendOnOffer(principal, slug, offer, attemptId);
  // The effect FIRING is the moment it appears live on the stream. Only a genuine
  // first firing is announced — destructuring the closed `PurchaseOutcome` for the
  // one arm that carries a fresh effect receipt, never the idempotent `already-applied`
  // replay (which would re-show the audience an effect they already saw) and never a
  // refusal (no effect fired) [LAW:dataflow-not-control-flow]. The announce is
  // best-effort live fan-out downstream of the already-committed purchase; the money
  // moved and the purchase is recorded regardless of who is watching, so it can never
  // change the backer's result [LAW:one-source-of-truth]. (Today's in-memory feed
  // never rejects; a real fan-out transport that can must be made non-fatal HERE,
  // since the purchase is already complete — the transport-adapter ticket's concern.)
  if (outcome.kind === 'fired') await announceEffectFired(slug, offer.effect, outcome.effect);
  const balance = Number(await coinBalanceOf(principal));
  return toSpendResult(outcome, balance);
}

export async function buyCoins(coins: number, attemptId: string): Promise<FundResult> {
  const principal = await currentPrincipal();
  if (principal === null) return { kind: 'must-authenticate' };

  const amount = coinPurchaseAmount(coins);
  if (amount === null) return { kind: 'invalid-amount' };

  const outcome = await creditCoins(principal, amount, attemptId);
  const balance = Number(await coinBalanceOf(principal));
  return toFundResult(outcome, balance);
}

/** The backer's current coin balance, for a surface to read on load. Returns null
 *  for an anonymous viewer — a real "no wallet" absence, not a zero balance that
 *  would imply an empty account they do not have [LAW:no-defensive-null-guards]. */
export async function walletBalance(): Promise<number | null> {
  const principal = await currentPrincipal();
  if (principal === null) return null;
  return Number(await coinBalanceOf(principal));
}

/**
 * Every funding pool a builder has opened, as the backer surface sees them — their
 * titles, live pooled totals (ledger escrow balances), and settled status. A pure
 * read with no authentication requirement: pools are public, the same way the menu
 * and chat are visible without a wallet [LAW:effects-at-boundaries].
 */
export async function listPools(slug: string): Promise<readonly PoolView[]> {
  const views = await listFeaturePools(slug);
  return views.map(toPoolView);
}

/**
 * The channel's transparent settlement timeline — every recorded movement of every pool's
 * escrow, projected from the ledger's own history and mapped to the view the watch
 * surface renders. A pure, public read like {@link listPools}: transparency is the
 * feature, so the money story needs no wallet to be watched [LAW:effects-at-boundaries].
 * Idempotent by construction — the same history yields the same timeline — so the
 * surface re-reads it on every settlement nudge and reconnect and can never accumulate
 * a drifted copy [LAW:one-source-of-truth].
 *
 * Party labels are decided here, once, at the edge [LAW:single-enforcer]: a backer is
 * shown under the SAME public identity chat gives them — their channel's display name if
 * they are a builder, else their stable viewer pseudonym — by composing the market's
 * wallet-derivation inverse with chat's one naming policy [LAW:one-source-of-truth].
 */
export async function settlementEvents(slug: string): Promise<readonly SettlementEventView[]> {
  const timeline = await channelSettlementFeed(slug);

  const backers = [
    ...new Set(
      timeline.flatMap(({ event }) =>
        event.kind === 'contribution' || event.kind === 'refund' ? [event.backer] : [],
      ),
    ),
  ];
  const labelled = await Promise.all(
    backers.map(async (account) => {
      const principalId = backerPrincipalIdOf(account);
      const channel = await getChannelService().channelByOwner(principalId);
      return [account, chatAuthorLabel(principalId, channel === undefined ? null : channel.profile.displayName)] as const;
    }),
  );
  const backerNames = new Map(labelled);

  const labels: SettlementPartyLabels = {
    backer: (account) => {
      const label = backerNames.get(account);
      // The set above is built from the very events being mapped, so a miss is a bug in
      // this function, surfaced loudly rather than a mislabeled money line [LAW:no-silent-failure].
      if (label === undefined) throw new Error(`settlement: no label resolved for backer ${String(account)}`);
      return label;
    },
    builder: slug,
    platform: 'CrowdShip',
  };
  return timeline.map((tagged) => toSettlementView(tagged, labels));
}

/**
 * A backer pledges coins toward a builder's funding pool, and the surface composes
 * fund-then-release: the pledge action returns immediately with whether the pool
 * shipped. The `attemptId` is the backer's per-click intent — the same discipline
 * as `buyOffer` and `buyCoins` [LAW:no-ambient-temporal-coupling]. The pool's updated
 * view is carried in every successful arm, re-read from the ledger's escrow balance,
 * so the surface never tallies coins itself [LAW:one-source-of-truth].
 */
export async function pledgeToPool(
  poolId: string,
  amountCoins: number,
  attemptId: string,
): Promise<PledgeResult> {
  const principal = await currentPrincipal();
  if (principal === null) return { kind: 'must-authenticate' };

  const amount = coinPurchaseAmount(amountCoins);
  if (amount === null) return { kind: 'invalid-pledge' };

  const id = makePoolId(poolId);
  if (!id.ok) return { kind: 'no-such-pool' };

  let outcome: PledgeOutcome;
  try {
    outcome = await pledgeToFeaturePool(principal, id.value, amount, attemptId);
  } catch {
    // The only throw path is "no feature pool <id>" — the pool was opened but is no longer
    // in the registry (e.g. process restart with in-memory store). Loud in the server log;
    // the surface gets a typed absence [LAW:no-silent-failure]. The try is exactly this
    // wide so nothing downstream can be mistaken for a missing pool.
    return { kind: 'no-such-pool' };
  }

  // A cancelled pool refuses the pledge before any coin moves — the market's typed arm,
  // carried to the surface so a stale page catches up to the pool as it now stands.
  if (outcome.kind === 'pool-cancelled') {
    return { kind: 'pool-cancelled', pool: toPoolView(outcome.pool) };
  }

  // The settlement MOVING is the moment the audience sees it — the money twin of the
  // fired-effect announce above, best-effort live fan-out downstream of already-committed
  // coins that can never change the backer's result [LAW:one-source-of-truth]. A genuine
  // release ships ONCE: only the `released` arm carries the shipped line, never the
  // idempotent `already-released` replay. The shipped figures are read back from the
  // pool's settlement feed — the ledger's own recorded release and cut legs — never
  // re-derived from the cut policy, which could drift from what the engine actually
  // posted [LAW:one-source-of-truth]. A contribution has no replay-distinct arm, so a
  // faithful retry may re-nudge; a nudge only prompts an idempotent re-read, so a
  // duplicate is a no-op for every watcher, not a duplicated money line.
  if (outcome.release.kind === 'released') {
    const feed = await settlementFeedOfPool(id.value);
    const release = feed.filter((e) => e.kind === 'release').at(-1);
    const cut = feed.filter((e) => e.kind === 'cut').at(-1);
    if (release === undefined || cut === undefined) {
      throw new Error(`settlement: pool ${poolId} released but its feed shows no release/cut leg`);
    }
    await announceSettlement(outcome.pool.builderSlug, {
      poolTitle: outcome.pool.title,
      settled: { kind: 'shipped', releasedCoins: Number(release.amount), cutCoins: Number(cut.amount) },
    });
  } else if (outcome.contribution.kind === 'contributed') {
    await announceSettlement(outcome.pool.builderSlug, { poolTitle: outcome.pool.title });
  }

  const balance = Number(await coinBalanceOf(principal));
  return toPledgeResult(outcome.contribution, outcome.release, toPoolView(outcome.pool), balance);
}

/**
 * A builder opens a new funding pool from their studio. The pool's slug is derived from
 * the authenticated principal's channel — the single routing fact the money path owns
 * [LAW:single-enforcer]. The `targetCoins` is validated at this trust boundary so the
 * ledger's positive-amount invariant is enforced before any account is touched
 * [LAW:no-ambient-temporal-coupling].
 */
export async function openPool(title: string, targetCoins: number): Promise<PoolOpenResult> {
  const principal = await currentPrincipal();
  if (principal === null) return { kind: 'must-authenticate' };

  const target = coinPurchaseAmount(targetCoins);
  if (target === null) return { kind: 'invalid-target' };

  const channel = await getChannelService().channelByOwner(principal.id);
  if (channel === undefined) return { kind: 'no-channel' };

  const view = await openFeaturePool(channel.handle, title.trim(), target);
  return { kind: 'opened', pool: toPoolView(view) };
}

/**
 * A builder cancels their funding pool from the studio: whatever the escrow still owes
 * goes back to the backers who pledged it, and the pool closes to further pledges. The
 * refund is the self-settling obligation's failure mode exercised in view of everyone
 * — the same discipline as `pledgeToPool`'s release: the money act commits first at the
 * market seam, then the live channel is nudged, best-effort, downstream of the
 * already-recorded coins [LAW:one-source-of-truth]. WHO may cancel resolves here (the
 * session's channel); WHETHER that channel owns the pool is the market's judgment, at
 * the one composition point that knows the routing [LAW:single-enforcer].
 *
 * A genuine refund is announced ONCE — only the fresh `refunded` arm carries the
 * REFUNDED broadcast, never the idempotent `already-refunded` replay — with the total
 * read back from the ledger's own recorded refund legs, never re-derived
 * [LAW:one-source-of-truth]. A pool refunds at most once, so every refund leg in its
 * feed belongs to this one settlement.
 */
export async function cancelPool(poolId: string): Promise<PoolCancelResult> {
  const principal = await currentPrincipal();
  if (principal === null) return { kind: 'must-authenticate' };

  const channel = await getChannelService().channelByOwner(principal.id);
  if (channel === undefined) return { kind: 'no-channel' };

  const id = makePoolId(poolId);
  if (!id.ok) return { kind: 'no-such-pool' };

  // `const`, so the narrowing below flows through the aliased condition. A thrown
  // rejection here is the exceptional, corruption-class failure (a refund leg the
  // engine refused to form) — left to the loud server error boundary, never dressed
  // as a routine arm [LAW:no-silent-failure]; a missing pool is the market's own
  // typed answer.
  const outcome = await cancelFeaturePool(id.value, channel.handle);

  const freshlyRefunded = outcome.kind === 'cancelled' && outcome.refund.kind === 'refunded';
  let refundedCoins: number | null = null;
  if (freshlyRefunded) {
    const refunds = (await settlementFeedOfPool(id.value)).filter((e) => e.kind === 'refund');
    if (refunds.length === 0) {
      throw new Error(`settlement: pool ${poolId} refunded but its feed shows no refund leg`);
    }
    refundedCoins = refunds.reduce((sum, e) => sum + Number(e.amount), 0);
    await announceSettlement(channel.handle, {
      poolTitle: outcome.pool.title,
      settled: { kind: 'refunded', refundedCoins },
    });
  }

  return toCancelResult(outcome, refundedCoins);
}
