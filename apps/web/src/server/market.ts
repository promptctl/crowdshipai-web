import type { Principal } from '@crowdship/identity';
import { createInMemoryLedger, type Ledger } from '@crowdship/ledger';
import {
  accountId,
  coinAmount,
  idempotencyKey,
  transactionReason,
  type AccountId,
  type AccountKind,
  type CoinAmount,
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
import {
  asEscrowedPledge,
  createPoolFunder,
  openPool,
  poolId,
  type ContributionOutcome,
  type Pool,
  type PoolFunder,
  type PoolId,
  type PoolTerms,
} from '@crowdship/pool';
import {
  createReleaseEngine,
  type CutPolicy,
  type ObligationFacts,
  type ReleaseEngine,
  type ReleaseOutcome,
} from '@crowdship/release';
import { createCustodialRail, type SettlementRail } from '@crowdship/settlement-rail';
import { ok, show, timestamp, type Result, type Timestamp } from '@crowdship/std';

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
  if (!r.ok) throw new Error(`market: ${what}: ${show(r.error)}`);
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

/** Construct a coin amount loudly — a raw here is always a literal or an already-validated
 *  figure, so a non-positive value is a programmer error to surface, never a movement formed
 *  from a bad amount [LAW:no-silent-failure]. The cut policy below relies on this: a gross too
 *  small to split into a positive builder share AND a positive cut throws here rather than
 *  minting a degenerate zero leg. */
const coins = (n: bigint): CoinAmount => unwrap(coinAmount(n), `coin amount ${show(n)}`);

/** The platform's cut, the one demo knob: 10% to the platform, the rest to the builder — the
 *  same default the pool service's own end-to-end test ships. The exact rate is the business
 *  model ("the spread is the business model"), injected as policy so swapping it is swapping
 *  this value, never editing the release path [LAW:no-mode-explosion]. Its own ticket (rky.2)
 *  makes the rate real; this is the floor that keeps the cut a real ledger leg, not omitted. */
const tenPercentCut: CutPolicy = (gross) => ({
  platformCut: coins(gross / 10n),
  builderShare: coins(gross - gross / 10n),
});

/** A pool release's single authority is the escrow balance the engine already holds, never a
 *  deliverable or goal — so these facts must never be consulted on the pool path. They throw if
 *  reached, turning a wrong-seam call into a loud bug, not a silent false [LAW:no-silent-failure].
 *  A deliverable/goal-backed obligation slots a real facts source in behind this same seam. */
const poolNeverUsesFacts: ObligationFacts = {
  accepted: () => Promise.reject(new Error('a pool release must not consult deliverable facts')),
  resolved: () => Promise.reject(new Error('a pool release must not consult goal facts')),
};

/**
 * A builder's funding pool surfaced to backers: the settle-able {@link Pool} the engines act on,
 * plus the human title it was opened under and the builder slug it ships to. The pooled total is
 * deliberately NOT a field here — it is the escrow's ledger balance, read live, never a second
 * running sum that could drift [LAW:one-source-of-truth].
 */
interface FeaturePool {
  readonly pool: Pool;
  readonly builderSlug: string;
  readonly title: string;
}

interface Market {
  readonly ledger: Ledger;
  readonly purchaser: Purchaser;
  readonly onRamp: CoinOnRamp;
  /** The negative-allowed mint coins are drawn from; its balance is coins in circulation. */
  readonly mint: AccountId;
  /** The funding side of pooled obligations: a backer adds coins to a pool's escrow. */
  readonly poolFunder: PoolFunder;
  /** The settle side: the instant a pool's target is reached, drain the escrow to the builder
   *  and skim the cut. The single authority on met-ness — the surface only offers the pool. */
  readonly releaseEngine: ReleaseEngine;
  /** The rail both engines settle through; queried here for settled-status read from the money
   *  itself, never a flag the surface keeps [LAW:one-source-of-truth]. */
  readonly rail: SettlementRail;
  /** The account the platform's cut is paid into on every release. */
  readonly platformAccount: AccountId;
  /** The pools a builder has opened, by id — their definitions (target, builder, title), never
   *  their running totals, which are the escrow balances. The single owner of this registry
   *  [LAW:no-shared-mutable-globals]; its only mutation is opening a pool. */
  readonly pools: Map<PoolId, FeaturePool>;
}

const ledgerAccountId = (raw: string): AccountId => unwrap(accountId(raw), `account id ${show(raw)}`);

const build = (): Market => {
  const ledger = createInMemoryLedger();
  const mint = ledgerAccountId('platform-mint');
  const platformAccount = ledgerAccountId('platform-revenue');
  const rail = createCustodialRail(ledger);
  return {
    ledger,
    purchaser: createPurchaser(ledger, acceptAllPerformer, createInMemoryPurchaseLog()),
    onRamp: createCoinOnRamp({ ledger, gateway: createInMemoryPaymentGateway(), mint }),
    mint,
    poolFunder: createPoolFunder(ledger),
    releaseEngine: createReleaseEngine({
      ledger,
      facts: poolNeverUsesFacts,
      platformAccount,
      cut: tenPercentCut,
      reason: unwrap(transactionReason('pool-release'), 'reason'),
      rail,
    }),
    rail,
    platformAccount,
    pools: new Map(),
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

/** The ledger account a pool's coins are escrowed in, derived from the pool id at this one
 *  point — the money-routing twin of `walletIdOf`/`builderPayeeOf` [LAW:decomposition]. */
const poolEscrowOf = (id: PoolId): AccountId => ledgerAccountId(`escrow:${id}`);

/** The current instant, branded for the settlement domain. A release's recorded moment is the
 *  rail's own (the ledger's clock); this is only the escrow pledge's notional `escrowedAt`. A
 *  real epoch-millis cannot fail to brand, so a failure would be corruption [LAW:no-silent-failure]. */
const nowInstant = (): Timestamp => unwrap(timestamp(Date.now()), 'instant');

/** A pool's release-pledge id — stable, derived from the pool id alone (the projection ignores
 *  the instant for identity), so the same id keys both the rail's settled-status read and the
 *  engine's release [LAW:one-source-of-truth]. */
const pledgeIdOf = (pool: Pool) => asEscrowedPledge(pool, nowInstant()).id;

/**
 * A funding pool as a backer surface sees it: its identity and title, the target it ships at,
 * the live pooled total (the escrow balance, never a stored tally [LAW:one-source-of-truth]),
 * and whether it has already settled — read from the money via the rail, not a flag kept here.
 */
export interface FeaturePoolView {
  readonly id: PoolId;
  readonly title: string;
  readonly builderSlug: string;
  readonly target: bigint;
  readonly pooled: bigint;
  readonly released: boolean;
}

const viewOf = async (fp: FeaturePool): Promise<FeaturePoolView> => {
  const pooled = await market.ledger.balanceOf(fp.pool.escrowAccount);
  const settled = await market.rail.settlementOf('release', pledgeIdOf(fp.pool));
  return {
    id: fp.pool.id,
    title: fp.title,
    builderSlug: fp.builderSlug,
    target: fp.pool.target,
    pooled,
    released: settled !== undefined,
  };
};

/**
 * Open a builder's funding pool so backers can pledge toward it. The pool id is derived from
 * the builder and title, so re-opening the same feature is idempotent rather than a duplicate
 * pool. Provisions the escrow (via `openPool`), the builder's payee wallet, and the platform's
 * cut account — every account a later release moves against, opened before any coin moves
 * [LAW:no-ambient-temporal-coupling] — then registers the pool as the one owner of its definition.
 */
export const openFeaturePool = async (
  builderSlug: string,
  title: string,
  target: bigint,
): Promise<FeaturePoolView> => {
  const id = unwrap(poolId(`pool:${builderSlug}:${title}`), 'pool id');
  const pool: Pool = {
    id,
    escrowAccount: poolEscrowOf(id),
    builderAccount: builderPayeeOf(builderSlug),
    target: coins(target),
  };
  await ensureAccount(market.platformAccount, 'platform-revenue');
  await ensureAccount(pool.builderAccount, 'user-wallet');
  const opened = await openPool(market.ledger, pool);
  if (!opened.ok) {
    throw new Error(`market: pool escrow ${pool.escrowAccount} is open as ${opened.error.existing}, not escrow`);
  }
  const fp: FeaturePool = { pool, builderSlug, title };
  market.pools.set(id, fp);
  return viewOf(fp);
};

/** Every pool a builder has opened, as the backer surface sees them. A pure read over the
 *  registry and the live escrow balances; opening is the only thing that mutates the set. */
export const listFeaturePools = async (builderSlug: string): Promise<readonly FeaturePoolView[]> =>
  Promise.all([...market.pools.values()].filter((fp) => fp.builderSlug === builderSlug).map(viewOf));

/**
 * A backer pledges coins toward a pool, and the surface composes fund-then-release: it offers
 * the pool to the release engine on every pledge. The engine is the single authority on
 * met-ness — it answers `pending` (no coins move) until the target is reached and `released`
 * the instant it is, atomically and at-most-once [LAW:single-enforcer]. So the backer whose
 * pledge tips the target is the one who watches the whole pool ship. The contribution and the
 * release are each their own closed outcome the caller destructures; the view is the pool as it
 * now stands.
 */
export interface PledgeOutcome {
  readonly contribution: ContributionOutcome;
  readonly release: ReleaseOutcome<PoolTerms>;
  readonly pool: FeaturePoolView;
}

export const pledgeToFeaturePool = async (
  principal: Principal,
  pool: PoolId,
  amount: bigint,
  attemptId: string,
): Promise<PledgeOutcome> => {
  const fp = market.pools.get(pool);
  if (fp === undefined) throw new Error(`market: no feature pool ${show(pool)}`);

  const backer = walletIdOf(principal);
  await ensureAccount(backer, 'user-wallet');

  const contribution = await market.poolFunder.contribute({
    pool: fp.pool,
    backer,
    amount: coins(amount),
    idempotencyKey: unwrap(idempotencyKey(`pledge:${attemptId}`), 'idempotency key'),
    reason: unwrap(transactionReason('pool-contribution'), 'reason'),
  });

  // Always offer the pool to the engine: it is the one place met-ness is judged, and it settles
  // at-most-once, so an unmet pool is a cheap `pending` and a met one ships exactly once — no
  // compare minted here, no double-release on a faithful retry [LAW:no-ambient-temporal-coupling].
  const release = await market.releaseEngine.tryRelease(asEscrowedPledge(fp.pool, nowInstant()));

  return { contribution, release, pool: await viewOf(fp) };
};

/** Offer a pool to the release engine without a new pledge — for a poll or a manual settle.
 *  Idempotent and safe: `pending` until the target is met, `released` once, `already-released`
 *  thereafter. The engine, not this caller, decides met-ness [LAW:single-enforcer]. */
export const tryReleaseFeaturePool = async (pool: PoolId): Promise<ReleaseOutcome<PoolTerms>> => {
  const fp = market.pools.get(pool);
  if (fp === undefined) throw new Error(`market: no feature pool ${show(pool)}`);
  return market.releaseEngine.tryRelease(asEscrowedPledge(fp.pool, nowInstant()));
};
