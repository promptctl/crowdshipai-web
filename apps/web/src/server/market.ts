import { accountId as principalAccountId, type Principal } from '@crowdship/identity';
import { createInMemoryLedger, type Ledger, type LedgerQuery } from '@crowdship/ledger';
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
import { createRefundEngine, type RefundEngine, type RefundOutcome } from '@crowdship/refund';
import {
  createReleaseEngine,
  type CutPolicy,
  type ObligationFacts,
  type ReleaseEngine,
  type ReleaseOutcome,
} from '@crowdship/release';
import { refundReason } from '@crowdship/settlement';
import { settlementFeed, type SettlementEvent, type SettlementRoles } from '@crowdship/settlement-feed';
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
 *
 * `cancelled` is POLICY state, not money state, and the registry is its one owner
 * [LAW:one-source-of-truth]: a cancelled pool accepts no further pledges. It is distinct from
 * "the escrow refunded" — an empty pool cancels with nothing to refund, so no ledger record
 * exists to derive it from; whether coins actually moved back stays the ledger's own record,
 * never copied here. It flips only AFTER the refund engine's money act succeeds, so a pool is
 * never marked closed while its backers' coins are still owed [LAW:no-ambient-temporal-coupling].
 */
interface FeaturePool {
  readonly pool: Pool;
  readonly builderSlug: string;
  readonly title: string;
  readonly cancelled: boolean;
}

interface Market {
  /** Both faces of the one engine: the write seam the movements go through, and the
   *  read/audit seam the settlement feed projects from. One backend implements both,
   *  so the story the audience reads and the coins that moved cannot disagree
   *  [LAW:one-source-of-truth]. */
  readonly ledger: Ledger & LedgerQuery;
  readonly purchaser: Purchaser;
  readonly onRamp: CoinOnRamp;
  /** The negative-allowed mint coins are drawn from; its balance is coins in circulation. */
  readonly mint: AccountId;
  /** The funding side of pooled obligations: a backer adds coins to a pool's escrow. */
  readonly poolFunder: PoolFunder;
  /** The settle side: the instant a pool's target is reached, drain the escrow to the builder
   *  and skim the cut. The single authority on met-ness — the surface only offers the pool. */
  readonly releaseEngine: ReleaseEngine;
  /** The settle-BACK side: return an unmet or cancelled escrow to the backers who funded it,
   *  each their net recorded contribution — the failure mode built like the success path. WHO
   *  is owed is read from the escrow's own ledger history, never a list kept here
   *  [LAW:one-source-of-truth]. */
  readonly refundEngine: RefundEngine;
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
    refundEngine: createRefundEngine({ query: ledger, rail }),
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
 * whether it has already settled — read from the money via the rail, not a flag kept here —
 * and whether the builder has cancelled it, read from the registry that owns that policy state.
 */
export interface FeaturePoolView {
  readonly id: PoolId;
  readonly title: string;
  readonly builderSlug: string;
  readonly target: bigint;
  readonly pooled: bigint;
  readonly released: boolean;
  readonly cancelled: boolean;
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
    cancelled: fp.cancelled,
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
  const fp: FeaturePool = { pool, builderSlug, title, cancelled: false };
  // Re-opening an existing pool id must not resurrect a cancelled pool: the registry write is
  // first-open-wins, so the idempotent re-open returns the pool as it stands, cancellation
  // included [LAW:one-source-of-truth].
  const existing = market.pools.get(id);
  if (existing === undefined) market.pools.set(id, fp);
  return viewOf(existing ?? fp);
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
 *
 * A pledge into a CANCELLED pool is a legal, representable request — a stale watch page can
 * make it in good faith — so it is its own typed arm, never a throw and never a contribution
 * quietly accepted into an escrow whose refund has already settled (coins that would strand,
 * unreturnable under the pool's already-used refund key) [LAW:types-are-the-program]
 * [LAW:no-silent-failure]. The refusal is enforced HERE, the one place pool coins move in
 * [LAW:single-enforcer].
 */
export type PledgeOutcome =
  | {
      readonly kind: 'pledged';
      readonly contribution: ContributionOutcome;
      readonly release: ReleaseOutcome<PoolTerms>;
      readonly pool: FeaturePoolView;
    }
  | { readonly kind: 'pool-cancelled'; readonly pool: FeaturePoolView };

export const pledgeToFeaturePool = async (
  principal: Principal,
  pool: PoolId,
  amount: bigint,
  attemptId: string,
): Promise<PledgeOutcome> => {
  const fp = market.pools.get(pool);
  if (fp === undefined) throw new Error(`market: no feature pool ${show(pool)}`);
  if (fp.cancelled) return { kind: 'pool-cancelled', pool: await viewOf(fp) };

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

  return { kind: 'pledged', contribution, release, pool: await viewOf(fp) };
};

/** Offer a pool to the release engine without a new pledge — for a poll or a manual settle.
 *  Idempotent and safe: `pending` until the target is met, `released` once, `already-released`
 *  thereafter. The engine, not this caller, decides met-ness [LAW:single-enforcer]. */
export const tryReleaseFeaturePool = async (pool: PoolId): Promise<ReleaseOutcome<PoolTerms>> => {
  const fp = market.pools.get(pool);
  if (fp === undefined) throw new Error(`market: no feature pool ${show(pool)}`);
  return market.releaseEngine.tryRelease(asEscrowedPledge(fp.pool, nowInstant()));
};

/**
 * Every way a builder's cancel resolves, one closed union the edge destructures
 * [LAW:dataflow-not-control-flow]:
 *
 *  - `cancelled` — the pool stopped accepting pledges on THIS call, after the refund engine's
 *    money act succeeded. The embedded `refund` says what the money did: `refunded` (coins went
 *    back now — the arm the edge announces on), `nothing-to-refund` (an empty pool closed; no
 *    coins ever pooled), or `already-refunded` (the money had returned on a prior settle; the
 *    registry flag is healed to match). `refund-refused` is deliberately NOT representable
 *    here — a cancel whose money act failed never reports cancelled [LAW:types-are-the-program].
 *  - `already-cancelled` — an idempotent replay; nothing changed.
 *  - `already-released` — the pool shipped; the builder is paid and there is nothing to cancel.
 *  - `not-your-pool` — the caller is not the builder this pool belongs to. Ownership of pool
 *    money commands is enforced HERE, the one composition point that knows the routing
 *    [LAW:single-enforcer].
 *  - `no-such-pool` — the id names nothing in the registry. A routine, representable request
 *    (a stale surface, a restarted in-memory registry), so it is a typed arm rather than the
 *    throw the read paths use — a cancel is a money COMMAND, and every way a command resolves
 *    must be a value its caller destructures [LAW:types-are-the-program].
 *  - `refund-refused` — the rail refused the return (most really: a release raced this cancel
 *    and drained the escrow first; the ledger's no-overdraft rule is the single arbiter of that
 *    race [LAW:single-enforcer]). The pool is NOT marked cancelled; loud reconciliation, never
 *    a quiet half-state [LAW:no-silent-failure].
 */
export type CancelOutcome =
  | {
      readonly kind: 'cancelled';
      readonly refund: Exclude<RefundOutcome<PoolTerms>, { readonly kind: 'refund-refused' }>;
      readonly pool: FeaturePoolView;
    }
  | { readonly kind: 'already-cancelled'; readonly pool: FeaturePoolView }
  | { readonly kind: 'already-released'; readonly pool: FeaturePoolView }
  | { readonly kind: 'not-your-pool'; readonly pool: FeaturePoolView }
  | { readonly kind: 'no-such-pool' }
  | { readonly kind: 'refund-refused'; readonly error: Extract<RefundOutcome<PoolTerms>, { readonly kind: 'refund-refused' }>['error'] };

/**
 * A builder cancels their own funding pool: refund whatever its escrow still owes the backers,
 * then close it to further pledges. The money moves FIRST and the registry flag flips only on a
 * successful (or already-settled, or trivially-empty) money act, so ordering has one explicit
 * owner and a pool is never closed while backers' coins hang unreturned
 * [LAW:no-ambient-temporal-coupling]. WHETHER to cancel is the builder's policy decision; the
 * engine only performs the return it is ordered to [LAW:decomposition]. WHO gets refunded is
 * the escrow's own recorded history — this call carries no backer list [LAW:one-source-of-truth].
 */
export const cancelFeaturePool = async (pool: PoolId, byBuilderSlug: string): Promise<CancelOutcome> => {
  const fp = market.pools.get(pool);
  if (fp === undefined) return { kind: 'no-such-pool' };
  if (fp.builderSlug !== byBuilderSlug) return { kind: 'not-your-pool', pool: await viewOf(fp) };
  if (fp.cancelled) return { kind: 'already-cancelled', pool: await viewOf(fp) };

  // A shipped pool has nothing to cancel — the courtesy read for the common case. A release
  // landing BETWEEN this read and the refund below still cannot double-move the coins: the
  // drained escrow fails the ledger's no-overdraft rule and surfaces as `refund-refused`.
  const view = await viewOf(fp);
  if (view.released) return { kind: 'already-released', pool: view };

  const refund = await market.refundEngine.tryRefund(
    asEscrowedPledge(fp.pool, nowInstant()),
    unwrap(refundReason('pool-cancelled'), 'refund reason'),
  );
  if (refund.kind === 'refund-refused') return { kind: 'refund-refused', error: refund.error };

  const closed: FeaturePool = { ...fp, cancelled: true };
  market.pools.set(pool, closed);
  return { kind: 'cancelled', refund, pool: await viewOf(closed) };
};

/** A pool's settlement money roles, assembled from the accounts this composition point
 *  already owns — the projection cannot divine meaning from raw ledger accounts, so the
 *  boundary that opened the pool is the one that names them [LAW:single-enforcer]. */
const settlementRolesOf = (fp: FeaturePool): SettlementRoles => ({
  escrow: fp.pool.escrowAccount,
  builder: fp.pool.builderAccount,
  platform: market.platformAccount,
});

/**
 * The transparent money story of one pool — its recorded escrow history projected into
 * settlement events (contribution, release, cut, refund) by `@crowdship/settlement-feed`.
 * A pure re-read of the ledger every call [LAW:one-source-of-truth]: idempotent,
 * replayable, and therefore what a watch surface renders after any nudge or reconnect
 * with no exactly-once machinery [LAW:no-ambient-temporal-coupling].
 */
export const settlementFeedOfPool = async (pool: PoolId): Promise<readonly SettlementEvent[]> => {
  const fp = market.pools.get(pool);
  if (fp === undefined) throw new Error(`market: no feature pool ${show(pool)}`);
  return settlementFeed(market.ledger, settlementRolesOf(fp));
};

/** One settlement moment on a channel's timeline: the event plus the title of the pool it
 *  settled against. The tag is the caller's, exactly as the projection prescribes — merging
 *  several pools' feeds into one channel timeline is a surface concern, not a field the
 *  money feed mints [LAW:decomposition]. */
export interface ChannelSettlementEvent {
  readonly poolTitle: string;
  readonly event: SettlementEvent;
}

/**
 * Every settlement event across a builder's pools, merged oldest-first into the one
 * channel timeline the watch surface renders — "the releases, refunds, and the cut moving
 * in view of the stream". Each pool's feed is the ledger's own recorded history; the merge
 * only interleaves by the instants the engine recorded, deriving nothing of its own
 * [LAW:one-source-of-truth].
 */
export const channelSettlementFeed = async (builderSlug: string): Promise<readonly ChannelSettlementEvent[]> => {
  const pools = [...market.pools.values()].filter((fp) => fp.builderSlug === builderSlug);
  const feeds = await Promise.all(
    pools.map(async (fp) =>
      (await settlementFeed(market.ledger, settlementRolesOf(fp))).map((event) => ({ poolTitle: fp.title, event })),
    ),
  );
  return feeds.flat().sort((a, b) => Number(a.event.at) - Number(b.event.at));
};

/**
 * Recover the principal id inside a backer's wallet account — the inverse of `walletIdOf`,
 * kept beside it so the derivation and its inverse are one fact in one place
 * [LAW:one-source-of-truth]. The surface uses it to show the SAME public pseudonym for a
 * backer's pledge as for their chat lines — one person, one public identity. In this
 * economy every escrow contributor IS a wallet, so a non-wallet backer account is a
 * derivation bug surfaced loudly, never mislabeled [LAW:no-silent-failure].
 */
export const backerPrincipalIdOf = (backer: AccountId): Principal['id'] => {
  const raw = String(backer);
  if (!raw.startsWith('wallet:')) {
    throw new Error(`market: settlement backer ${raw} is not a wallet account`);
  }
  // Re-earn identity's brand through its own constructor — the recovered id is only a
  // principal id because it validates as one, never because this file says so
  // [LAW:types-are-the-program].
  const recovered = principalAccountId(raw.slice('wallet:'.length));
  if (!recovered.ok) throw new Error(`market: settlement backer ${raw} carries a blank principal id`);
  return recovered.value;
};
