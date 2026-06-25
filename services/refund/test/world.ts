import { createInMemoryLedger, type Ledger, type LedgerQuery } from '@crowdship/ledger';
import {
  accountId,
  coinAmount,
  idempotencyKey,
  timestamp as ledgerTimestamp,
  transactionReason,
  transfer,
  type Account,
  type AccountId,
  type CoinAmount,
  type IdempotencyKey,
  type Result,
  type Timestamp as LedgerTimestamp,
  type TransactionReason,
} from '@crowdship/ledger-kernel';
import { escrow, pledgeId, refundReason, type Escrowed, type RefundReason } from '@crowdship/settlement';
import { createCustodialRail } from '@crowdship/settlement-rail';
import { timestamp, type Timestamp } from '@crowdship/std';

import { createRefundEngine, type RefundEngine, type Refundable } from '../src/index.js';

/**
 * The shared fake world the refund tests settle against: a ledger whose escrow has been
 * funded by real per-backer contributions, so the recorded history the engine reads is the
 * genuine record a live platform would produce — the credit legs ARE the contributor ledger
 * the refund returns coins along [LAW:one-source-of-truth]. It lives in one place so every
 * suite exercises the SAME world rather than fixtures that can drift. Everything here is
 * scaffolding — the seam under test is imported from the package.
 */

/** Unwrap a successful result or fail loudly — never let an error slip past [LAW:no-silent-failure]. */
export const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

export const coins = (n: bigint): CoinAmount => must(coinAmount(n));
const acc = (s: string): AccountId => must(accountId(s));
const key = (s: string): IdempotencyKey => must(idempotencyKey(s));
const txReason = (s: string): TransactionReason => must(transactionReason(s));
const account = (id: AccountId, kind: Account['kind']): Account => ({ id, kind });
export const reason = (s: string): RefundReason => must(refundReason(s));

const MINT = acc('mint');
export const ESCROW = acc('escrow-obligation-1');
export const BUILDER = acc('builder');

/** A fixed instant the ledger records every movement at — the boundary owns "now", and a
 *  deterministic moment makes the refunded pledge's timestamps assertable: a refund happens at
 *  the instant the rail's movement is recorded, so the pledge's `refundedAt` is exactly this
 *  [LAW:no-ambient-temporal-coupling]. */
export const AT: Timestamp = must(timestamp(1_700_000_000_000));
const LEDGER_AT: LedgerTimestamp = must(ledgerTimestamp(1_700_000_000_000));

/** The wallet account id of a named backer — `backer-ami` etc., the same shape the other
 *  settlement worlds use so the suites read alike. */
export const backerWallet = (id: string): AccountId => acc(`backer-${id}`);

export interface Contribution {
  readonly id: string;
  readonly funds: bigint;
}

/**
 * A ledger with the mint and the escrow opened, then funded by `contributions`: each named
 * backer gets a wallet minted exactly its coins, which it then contributes into the escrow.
 * So the escrow's recorded history is one credit leg per backer — the genuine record a refund
 * reads to compute who is owed what. Returns the ledger ready for a refund engine to settle.
 */
export const fundedEscrow = async (contributions: readonly Contribution[]): Promise<Ledger & LedgerQuery> => {
  const ledger = createInMemoryLedger(() => LEDGER_AT);
  must(await ledger.openAccount(account(MINT, 'mint')));
  must(await ledger.openAccount(account(ESCROW, 'escrow')));
  for (const { id, funds } of contributions) {
    const wallet = backerWallet(id);
    must(await ledger.openAccount(account(wallet, 'user-wallet')));
    // Mint the backer its coins, then the backer contributes them into the escrow — two real
    // movements, so the escrow's credit leg names this backer as the contributor.
    must(
      await ledger.post({
        transfers: [must(transfer(MINT, wallet, coins(funds)))],
        reason: txReason('mint-to-backer'),
        idempotencyKey: key(`mint-${id}`),
      }),
    );
    must(
      await ledger.post({
        transfers: [must(transfer(wallet, ESCROW, coins(funds)))],
        reason: txReason('pool-contribution'),
        idempotencyKey: key(`contribute-${id}`),
      }),
    );
  }
  return ledger;
};

/** Drain the escrow to the builder as a manual "release" — opens the builder wallet and posts
 *  the whole escrow balance escrow → builder. Used to set up the realistic race where a refund
 *  is attempted on a stale escrowed pledge whose coins have ALREADY left as a release: the
 *  ledger's no-overdraft rule must then refuse the refund loudly [LAW:single-enforcer]. */
export const releaseEscrowToBuilder = async (ledger: Ledger, gross: bigint): Promise<void> => {
  must(await ledger.openAccount(account(BUILDER, 'user-wallet')));
  must(
    await ledger.post({
      transfers: [must(transfer(ESCROW, BUILDER, coins(gross)))],
      reason: txReason('obligation-release'),
      idempotencyKey: key('manual-release'),
    }),
  );
};

/** A refund engine over a ledger, settling through a custodial rail on that same ledger — so
 *  "has this pledge refunded?" is read from the money the engine moved. */
export const engineOver = (ledger: Ledger & LedgerQuery): RefundEngine =>
  createRefundEngine({ query: ledger, rail: createCustodialRail(ledger) });

/** An escrowed pledge over the world's escrow account. The notional `amount` is irrelevant to
 *  the refund — the engine reads exactly what the ledger holds and who funded it — so it is a
 *  token positive value, never a second source of truth for the refund [LAW:one-source-of-truth]. */
export const refundablePledge = (id: string): Escrowed<Refundable> =>
  escrow(must(pledgeId(id)), coins(1n), { escrowAccount: ESCROW }, AT);
