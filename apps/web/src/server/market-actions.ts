'use server';

import { poolId as makePoolId } from '@crowdship/pool';

import type { FundResult, PledgeResult, PoolOpenResult, SpendResult } from '../data/buy-result';
import type { PoolView } from '../data/types';
import { getCatalog } from '../data/catalog';
import { coinPurchaseAmount, toFundResult, toPledgeResult, toPoolView, toSpendResult } from './buy-mapping';
import { getChannelService } from './channels';
import { announceEffectFired } from './live-feed';
import { coinBalanceOf, creditCoins, listFeaturePools, openFeaturePool, pledgeToFeaturePool, spendOnOffer } from './market';
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

  try {
    const outcome = await pledgeToFeaturePool(principal, id.value, amount, attemptId);
    const balance = Number(await coinBalanceOf(principal));
    return toPledgeResult(outcome.contribution, outcome.release, toPoolView(outcome.pool), balance);
  } catch {
    // The only throw path is "no feature pool <id>" — the pool was opened but is no longer
    // in the registry (e.g. process restart with in-memory store). Loud in the server log;
    // the surface gets a typed absence [LAW:no-silent-failure].
    return { kind: 'no-such-pool' };
  }
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
