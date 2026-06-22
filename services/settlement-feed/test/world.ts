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
  type TransactionReason,
} from '@crowdship/ledger-kernel';
import { createPoolFunder, openPool, poolId, type Pool } from '@crowdship/pool';
import { timestamp, type Clock, type Timestamp } from '@crowdship/std';

/**
 * The shared fake world the transparency tests watch: a ledger with the platform accounts,
 * a pool whose escrow is opened, and a set of backer wallets each minted coins to spend. It
 * mirrors the pool service's own world so both suites fund against the SAME shape rather than
 * fixtures that can drift [LAW:one-source-of-truth]. Everything here is scaffolding — the seam
 * under test (the settlement feed) reads only the ledger's recorded history.
 */

/** Unwrap a successful result or fail loudly — never let an error slip past [LAW:no-silent-failure]. */
export const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

export const coins = (n: bigint): CoinAmount => must(coinAmount(n));
const acc = (s: string): AccountId => must(accountId(s));
export const key = (s: string): IdempotencyKey => must(idempotencyKey(s));
export const reason = (s: string): TransactionReason => must(transactionReason(s));
const account = (id: AccountId, kind: Account['kind']): Account => ({ id, kind });

export const MINT = acc('mint');
export const BUILDER = acc('builder');
export const PLATFORM = acc('platform-revenue');
export const POOL_ESCROW = acc('pool-escrow-ffmpeg');

/** A fixed clock — the boundary owns "now", and a deterministic instant makes the feed's
 *  timestamps assertable [LAW:no-ambient-temporal-coupling]. */
export const AT: Timestamp = must(timestamp(1_700_000_000_000));
export const clock: Clock = { now: () => AT };

/** The same instant, in the ledger-kernel's own `Timestamp` brand — what the in-memory
 *  ledger stamps each movement's `occurredAt` with, so the feed's `at` is this exact value.
 *  (Two brands for one concept is a pre-existing std/ledger-kernel duplication, not this
 *  service's to resolve here.) */
export const LEDGER_AT = must(ledgerTimestamp(1_700_000_000_000));

/** The ffmpeg-feature pool the founding doc describes — many backers, one target, one builder. */
export const ffmpegPool = (target: bigint): Pool => ({
  id: must(poolId('pool-ffmpeg-feature')),
  escrowAccount: POOL_ESCROW,
  builderAccount: BUILDER,
  target: coins(target),
});

export interface Backer {
  readonly id: string;
  readonly funds: bigint;
}

export interface FundedWorld {
  readonly ledger: Ledger & LedgerQuery;
  /** The wallet account of a backer set up in this world. */
  readonly wallet: (id: string) => AccountId;
  /** Fund a backer's contribution into the pool, failing loudly if it does not land. */
  readonly contribute: (backer: string, amount: bigint, k: string) => Promise<void>;
}

/**
 * A ledger with mint, the builder and platform wallets, the pool's escrow opened via
 * `openPool`, and one funded wallet per backer (minted `funds` coins to spend). The escrow
 * starts empty — backers fill it by contributing through the real pool funder, so the ledger
 * history the feed reads is the genuine record a live platform would produce.
 */
export const fundedWorld = async (backers: readonly Backer[], pool: Pool): Promise<FundedWorld> => {
  // A deterministic ledger clock so every recorded movement's `occurredAt` is the fixed
  // instant, making the feed's timestamps assertable [LAW:no-ambient-temporal-coupling].
  const ledger = createInMemoryLedger(() => LEDGER_AT);
  must(await ledger.openAccount(account(MINT, 'mint')));
  must(await ledger.openAccount(account(BUILDER, 'user-wallet')));
  must(await ledger.openAccount(account(PLATFORM, 'platform-revenue')));
  must(await openPool(ledger, pool));

  const wallets = new Map<string, AccountId>();
  for (const backer of backers) {
    const id = acc(`backer-${backer.id}`);
    wallets.set(backer.id, id);
    must(await ledger.openAccount(account(id, 'user-wallet')));
    if (backer.funds > 0n) {
      must(
        await ledger.post({
          transfers: [must(transfer(MINT, id, coins(backer.funds)))],
          reason: reason('mint-to-backer'),
          idempotencyKey: key(`mint-${backer.id}`),
        }),
      );
    }
  }

  const wallet = (id: string): AccountId => {
    const found = wallets.get(id);
    if (found === undefined) throw new Error(`no backer wallet for ${id}`);
    return found;
  };

  const funder = createPoolFunder(ledger);
  const contribute = async (backer: string, amount: bigint, k: string): Promise<void> => {
    const outcome = await funder.contribute({
      pool,
      backer: wallet(backer),
      amount: coins(amount),
      idempotencyKey: key(k),
      reason: reason('pool-contribution'),
    });
    if (outcome.kind !== 'contributed') {
      throw new Error(`contribution did not land: ${JSON.stringify(outcome)}`);
    }
  };

  return { ledger, wallet, contribute };
};
