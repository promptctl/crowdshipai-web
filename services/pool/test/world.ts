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
  type Timestamp as LedgerTimestamp,
} from '@crowdship/ledger-kernel';
import { timestamp, type Timestamp } from '@crowdship/std';

import { openPool, poolId, type Pool } from '../src/index.js';

/**
 * The shared fake world the pool tests fund against: a ledger with the platform accounts, a
 * pool whose escrow is opened, and a set of backer wallets each minted coins to spend. It
 * lives in one place so every suite exercises the SAME world rather than fixtures that can
 * drift [LAW:one-source-of-truth]. Everything here is scaffolding — the real seams under test
 * are imported from the packages.
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

/** A fixed instant, in both the settlement domain's brand (the pledge's `escrowedAt`) and
 *  the ledger's (every recorded movement's `occurredAt`). They are the same epoch millis;
 *  a release happens when the rail's movement is recorded, so the released pledge's
 *  `releasedAt` is exactly this [LAW:no-ambient-temporal-coupling]. */
export const AT: Timestamp = must(timestamp(1_700_000_000_000));
const LEDGER_AT: LedgerTimestamp = must(ledgerTimestamp(1_700_000_000_000));

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
}

/**
 * A ledger with mint, the builder and platform wallets, the pool's escrow opened via
 * `openPool`, and one funded wallet per backer (minted `funds` coins to spend). The escrow
 * starts empty — backers fill it by contributing.
 */
export const fundedWorld = async (backers: readonly Backer[], pool: Pool): Promise<FundedWorld> => {
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
  return { ledger, wallet };
};
