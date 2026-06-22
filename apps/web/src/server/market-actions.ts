'use server';

import type { FundResult, SpendResult } from '../data/buy-result';
import { getCatalog } from '../data/catalog';
import { coinPurchaseAmount, toFundResult, toSpendResult } from './buy-mapping';
import { coinBalanceOf, creditCoins, spendOnOffer } from './market';
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
