import type { AccountMovement, LedgerQuery } from '@crowdship/ledger';
import type { AccountId, CoinAmount, Timestamp, TransactionReason } from '@crowdship/ledger-kernel';

/**
 * The settlement money roles for one obligation: the escrow whose history tells the
 * story, the builder paid on release, and the platform whose cut is skimmed. The ledger
 * records accounts and verbatim reason strings, never "this account is the platform" —
 * the *meaning* of a movement (a contribution vs. the builder's share vs. the cut) comes
 * from the obligation definition, which the boundary that owns the obligation supplies
 * [LAW:single-enforcer]. So roles are an input to the projection, not something it can
 * divine from the raw ledger.
 *
 * For a pool: `escrow` is the pool's escrow account, `builder` its builder account, and
 * `platform` the release engine's cut account — every one of them already known to the
 * surface that funded and released the pool.
 */
export interface SettlementRoles {
  readonly escrow: AccountId;
  readonly builder: AccountId;
  readonly platform: AccountId;
}

/**
 * One transparent moment in an obligation's settlement, as the audience sees it: a real
 * coin movement against the escrow, named by what it MEANS rather than by raw accounts
 * [LAW:dataflow-not-control-flow]. Every arm is exactly one recorded ledger leg — never a
 * total this feed sums itself [LAW:one-source-of-truth] — so the feed is the money's own
 * story, not a parallel tally that could drift from it.
 *
 *  - `contribution` — coins arrived in the pool's escrow: a backer funded it. `pooledAfter`
 *    is the escrow's balance the instant this contribution landed — the live ticker total,
 *    "ten people with twenty dollars each" filling the bar in view of the stream.
 *  - `release` — coins left escrow to the builder: their share of the shipped pool.
 *  - `cut` — coins left escrow to the platform: the spread skimmed, in plain view.
 *
 * `pooledAfter` is the same concept on every arm — the escrow balance immediately after
 * this movement, read straight from the ledger's recorded history. It is `bigint`, not
 * `CoinAmount`, precisely because it can be zero (a release drains the escrow): a
 * post-movement balance is a reading, not a movement, so a strictly-positive coin type
 * would be too strong and false. `amount` is the leg itself, always at least one coin.
 */
export type SettlementEvent =
  | {
      readonly kind: 'contribution';
      readonly backer: AccountId;
      readonly amount: CoinAmount;
      readonly pooledAfter: bigint;
      readonly reason: TransactionReason;
      readonly at: Timestamp;
    }
  | {
      readonly kind: 'release';
      readonly builder: AccountId;
      readonly amount: CoinAmount;
      readonly pooledAfter: bigint;
      readonly reason: TransactionReason;
      readonly at: Timestamp;
    }
  | {
      readonly kind: 'cut';
      readonly platform: AccountId;
      readonly amount: CoinAmount;
      readonly pooledAfter: bigint;
      readonly reason: TransactionReason;
      readonly at: Timestamp;
    };

/**
 * Project one recorded escrow movement into the settlement event it means. The MEANING is
 * carried in the data the ledger already recorded — the direction the coins flowed and who
 * was on the other side — read against the obligation's roles, mapping a discriminated
 * input (the leg) onto a discriminated output (the event) [LAW:dataflow-not-control-flow]:
 *
 *  - coins INTO the escrow (a credit) is a backer funding the pool — a contribution;
 *  - coins OUT of the escrow (a debit) to the builder is their release share, to the
 *    platform is the cut.
 *
 * The classification is TOTAL and LOUD on both arms — every recorded movement maps to exactly
 * one named event or halts the projection, so a money feed can never silently misrepresent a
 * movement [LAW:no-silent-failure]. A settlement escrow is funded only by backers, so a credit
 * FROM its own payee, and a debit to anyone but the builder or platform, are both integrity
 * anomalies surfaced rather than rendered as something benign. (The refund path to backers
 * lands additively in a later ticket: a debit to an account that appears as a contributor in
 * this same history gains its own `refund` meaning, shrinking the anomaly arm — the contributor
 * set is already in the history, so no new seam input is needed.)
 */
const project = (movement: AccountMovement, roles: SettlementRoles): SettlementEvent => {
  const { direction, amount, counterparty, resultingBalance, reason, occurredAt } = movement;
  const common = { amount, pooledAfter: resultingBalance, reason, at: occurredAt } as const;

  if (direction === 'credit') {
    if (counterparty === roles.builder || counterparty === roles.platform) {
      throw new Error(
        `settlement escrow ${roles.escrow} was credited by its own payee ${counterparty}; ` +
          `a settlement escrow is funded only by backers`,
      );
    }
    return { kind: 'contribution', backer: counterparty, ...common };
  }
  if (counterparty === roles.builder) {
    return { kind: 'release', builder: counterparty, ...common };
  }
  if (counterparty === roles.platform) {
    return { kind: 'cut', platform: counterparty, ...common };
  }
  throw new Error(
    `settlement escrow ${roles.escrow} was debited to an unrecognized party ${counterparty}; ` +
      `a settlement escrow's coins may only flow to the builder or the platform`,
  );
};

/**
 * The pure heart of the transparent feed: an obligation's recorded escrow history, in the
 * order it happened, projected into the settlement events the stream renders. Pure over its
 * input [LAW:effects-at-boundaries] — given the same history it yields the same feed, so it
 * is trivially testable and a viewer can re-render it any number of times with no effect.
 * The history is already oldest-first (the ledger's contract), and this preserves that
 * order, so the feed reads as the obligation's story start to finish.
 *
 * The roles must name three distinct accounts, checked once here — the one boundary that holds
 * them [LAW:single-enforcer]. If the builder and the platform collapsed to one account the
 * release share and the cut could not be told apart, and the cut would silently vanish from
 * the feed; a money feed never swallows a movement, so a collision halts loudly rather than
 * mislabelling [LAW:no-silent-failure]. (Distinctness cannot be stated in the type, so it is a
 * precondition on an illegal argument, not an effect.)
 */
export const projectSettlement = (
  history: readonly AccountMovement[],
  roles: SettlementRoles,
): readonly SettlementEvent[] => {
  if (roles.builder === roles.platform) {
    throw new Error(
      `settlement roles collide: builder and platform are the same account ${roles.builder}; ` +
        `the release share and the cut could not be told apart`,
    );
  }
  return history.map((movement) => project(movement, roles));
};

/**
 * The transparent settlement feed for one obligation: read the escrow's recorded history
 * through the ledger's audit seam and project it into the events the stream shows. The one
 * effect — the history read — sits at this boundary [LAW:effects-at-boundaries]; everything
 * the audience sees is derived from the ledger's own recorded movements, never a second
 * record this service keeps [LAW:one-source-of-truth].
 *
 * This is the durable, replayable backstop: it answers "what has this obligation's money
 * done?" at any time, from the ledger itself, so it cannot disagree with the engine that
 * moved the coins. A LIVE push (re-render the moment a movement lands) layers on top of
 * this additively — the auto-release engine's `released` signal is the natural once-per-
 * release nudge to re-read — but the view itself stays a projection, never a fired effect,
 * so it needs no exactly-once machinery of its own [LAW:no-ambient-temporal-coupling].
 *
 * (A separate viewer PROCESS resolves the verbatim reasons only if its ledger is built on
 * the shared name store; an in-process feed needs nothing extra. That is the ledger seam's
 * concern, surfaced where it belongs rather than re-solved here.)
 */
export const settlementFeed = async (
  query: LedgerQuery,
  roles: SettlementRoles,
): Promise<readonly SettlementEvent[]> => {
  const history = await query.historyOf(roles.escrow);
  return projectSettlement(history, roles);
};
