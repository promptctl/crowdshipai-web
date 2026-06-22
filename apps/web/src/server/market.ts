import type { Principal } from '@crowdship/identity';
import { createInMemoryLedger, type Ledger } from '@crowdship/ledger';
import {
  accountId,
  coinAmount,
  idempotencyKey,
  transactionReason,
  type AccountId,
  type AccountKind,
} from '@crowdship/ledger-kernel';
import type { Effect, EffectPerformer, PricedOffer } from '@crowdship/menu';
import { createCoinOnRamp, type CoinOnRamp, type OnRampOutcome } from '@crowdship/on-ramp';
import { createInMemoryPurchaseLog, createPurchaser, type Purchaser, type PurchaseOutcome } from '@crowdship/purchase';
import {
  chargeKey,
  createInMemoryPaymentGateway,
  currency,
  fiatAmount,
  paymentMethod,
  type FiatCharge,
} from '@crowdship/payments';
import { ok, type Result } from '@crowdship/std';

/**
 * The single place the web app holds the coin economy [LAW:single-enforcer] — the
 * money twin of `getPolicyBoundary()` and `getSanctions()`. Every coin a backer
 * buys and every coin they spend moves through the one in-memory `Ledger` held
 * here; no surface keeps its own balance, because a duplicated tally is one that
 * drifts and money is the one place drift is fatal. Swapping the in-memory fake
 * for the real TigerBeetle ledger (and the in-memory PSP for the Stripe binding)
 * is a change HERE and nowhere else [LAW:locality-or-seam].
 *
 * It composes the demonstrated backend chain — the on-ramp (fiat in → coins) and
 * the purchase-to-fire pipeline (coins move → effect fires) — into the two
 * operations the backer surface drives, and owns the account-derivation and the
 * demo money-request construction so those rules live in exactly one place. It
 * computes outcomes by sequencing seams; it performs no effect of its own beyond
 * the ledger and PSP fakes it is built from [LAW:effects-at-boundaries].
 *
 * It is loudly a walking-skeleton stand-in, never a silent pretense: the ledger
 * and PSP are in-memory fakes, the coin↔fiat rate is a flat demo knob (its real
 * spread is its own ticket), and the effect "fires" by acknowledgement until the
 * live event channel lands — every one of those is a seam a real implementation
 * replaces with no caller change, not a lie the rest of the app trusts.
 */

/** Unwrap a branded-value construction loudly. Every raw here is a literal or an
 *  already-validated id, so a failure is a programmer error to surface at once,
 *  never a money movement formed from a bad value [LAW:no-silent-failure]. */
const unwrap = <T>(r: Result<T, unknown>, what: string): T => {
  if (!r.ok) throw new Error(`market: ${what}: ${JSON.stringify(r.error)}`);
  return r.value;
};

/**
 * The demo edge performer: every effect is acknowledged as fired, echoing the
 * builder's own params back as the receipt. This is where the live event channel
 * (evf.4) — the builder's overlay that gives a fired effect its real meaning on
 * stream — plugs in behind the same {@link EffectPerformer} seam with no caller
 * change [LAW:locality-or-seam]. It is a stand-in, not a silent no-op: it returns
 * a receipt so a paid purchase resolves `fired`, and the `effect-failed` arm a
 * real performer can still produce is handled upstream identically [LAW:no-silent-failure].
 */
const acceptAllPerformer: EffectPerformer = {
  perform: (effect: Effect) => Promise.resolve(ok(effect.params)),
};

interface Market {
  readonly ledger: Ledger;
  readonly purchaser: Purchaser;
  readonly onRamp: CoinOnRamp;
  /** The negative-allowed mint coins are drawn from; its balance is coins in circulation. */
  readonly mint: AccountId;
}

const ledgerAccountId = (raw: string): AccountId => unwrap(accountId(raw), `account id ${JSON.stringify(raw)}`);

const build = (): Market => {
  const ledger = createInMemoryLedger();
  const mint = ledgerAccountId('platform-mint');
  return {
    ledger,
    purchaser: createPurchaser(ledger, acceptAllPerformer, createInMemoryPurchaseLog()),
    onRamp: createCoinOnRamp({ ledger, gateway: createInMemoryPaymentGateway(), mint }),
    mint,
  };
};

// One economy per process, the single owner of the in-memory balances
// [LAW:no-shared-mutable-globals]. Cached on globalThis so Next.js dev HMR — which
// re-evaluates modules on every edit — reuses the live ledger instead of resetting
// every backer's balance to zero, the same pattern the ingest broker uses.
const globalForMarket = globalThis as unknown as { __crowdshipMarket?: Market };
const market: Market = globalForMarket.__crowdshipMarket ?? build();
if (process.env.NODE_ENV !== 'production') globalForMarket.__crowdshipMarket = market;

/** The ledger account a viewer's coins live in, derived from their account id at
 *  this one composition point — the money twin of how `access`/`sanctions` map a
 *  principal onto a moderation `ActorRef`. A logged-out viewer has no wallet; the
 *  surfaces gate spending on a live principal before reaching here. */
const walletIdOf = (principal: Principal): AccountId => ledgerAccountId(`wallet:${principal.id}`);

/** The ledger account a builder is paid into, derived from their channel slug.
 *  The slug→payee mapping is a money-routing decision, so it lives with the money,
 *  not in the read catalog that only knows what is being bought [LAW:decomposition]. */
const builderPayeeOf = (slug: string): AccountId => ledgerAccountId(`builder:${slug}`);

/** Open an account idempotently before it is moved against. `openAccount` only
 *  fails on a kind-conflict — the same id reused under a different kind — which is
 *  a bug in derivation, not a runtime condition a caller can handle, so it halts
 *  loudly rather than quietly mis-routing money [LAW:no-silent-failure]. */
const ensureAccount = async (id: AccountId, kind: AccountKind): Promise<void> => {
  const opened = await market.ledger.openAccount({ id, kind });
  if (!opened.ok) {
    throw new Error(`market: account ${id} is open as ${opened.error.existing}, not ${kind}`);
  }
};

/**
 * A backer's current coin balance — the authoritative ledger figure, not a tally
 * any surface keeps [LAW:one-source-of-truth]. A pure read: `balanceOf` is total
 * and answers `0n` for a wallet with no recorded movement, so a first-time viewer
 * needs no account opened to read an honest zero — the wallet is opened only where
 * coins actually move into or out of it, never as a side effect of reading.
 */
export const coinBalanceOf = async (principal: Principal): Promise<bigint> =>
  market.ledger.balanceOf(walletIdOf(principal));

/**
 * Buy coins for a backer: fiat in through the PSP, coins posted to their wallet,
 * as the on-ramp's one idempotent unit. The coin↔fiat rate is a flat demo knob —
 * one coin costs one cent — paired here at the surface exactly as the on-ramp
 * expects (it stays rate-agnostic; the real buy/sell spread is its own ticket).
 * The `attemptId` is the backer's per-click intent: the same attempt retries under
 * the same keys and never double-charges [LAW:no-ambient-temporal-coupling]. Both
 * keys pin to the attempt, so a faithful retry replays the one charge and the one
 * credit; the surface mints a fresh id per click, so distinct top-ups never collide.
 */
export const creditCoins = async (
  principal: Principal,
  coins: bigint,
  attemptId: string,
): Promise<OnRampOutcome> => {
  const wallet = walletIdOf(principal);
  await ensureAccount(market.mint, 'mint');
  await ensureAccount(wallet, 'user-wallet');

  const charge: FiatCharge = {
    amount: unwrap(fiatAmount(coins), 'fiat amount'),
    currency: unwrap(currency('USD'), 'currency'),
    method: unwrap(paymentMethod('demo-card'), 'payment method'),
    key: unwrap(chargeKey(`onramp:${attemptId}`), 'charge key'),
  };
  return market.onRamp.buy({
    wallet,
    coins: unwrap(coinAmount(coins), 'coin amount'),
    charge,
    reason: unwrap(transactionReason('coin-purchase'), 'reason'),
    idempotencyKey: unwrap(idempotencyKey(`onramp-post:${attemptId}`), 'idempotency key'),
  });
};

/**
 * Spend coins on a builder's offer: the purchase-to-fire spine. Coins move from
 * the backer's wallet to the builder, then the offer's effect fires — one path
 * every offer runs, the variety living entirely in the offer value, never a branch
 * per kind [LAW:dataflow-not-control-flow]. The price is the offer's own, taken
 * from the one place it lives; routing (who pays, who is paid) and the
 * idempotency key are the surface's [LAW:one-source-of-truth]. The platform cut is
 * deliberately not here — it is a later multi-leg movement and its own ticket, so
 * this keeps the single-leg case canonical [LAW:no-mode-explosion].
 */
export const spendOnOffer = async (
  principal: Principal,
  builderSlug: string,
  offer: PricedOffer,
  attemptId: string,
): Promise<PurchaseOutcome> => {
  const payer = walletIdOf(principal);
  const payee = builderPayeeOf(builderSlug);
  await ensureAccount(payer, 'user-wallet');
  await ensureAccount(payee, 'user-wallet');

  return market.purchaser.buy({
    offer,
    payer,
    payee,
    idempotencyKey: unwrap(idempotencyKey(`buy:${attemptId}`), 'idempotency key'),
    reason: unwrap(transactionReason(`offer:${offer.effect.kind}`), 'reason'),
  });
};
