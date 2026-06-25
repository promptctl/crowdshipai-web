import { createInMemoryLedger, type Ledger, type LedgerQuery } from '@crowdship/ledger';
import {
  accountId,
  idempotencyKey,
  timestamp as ledgerTimestamp,
  transactionReason,
  transfer,
  type Account,
  type AccountId,
} from '@crowdship/ledger-kernel';
import { asEscrowedPledge, createPoolFunder, openPool, poolId, type Pool } from '@crowdship/pool';
import { createCustodialRail } from '@crowdship/settlement-rail';
import { describe, expect, it } from 'vitest';

import { createRefundEngine } from '../src/index.js';
import { AT, coins, must, reason } from './world.js';

/**
 * The whole point of the refund path, end to end: many backers fund one pool, the target is
 * NEVER reached, and instead of the coins sitting stranded the refund returns every backer
 * exactly what they put in — the failure mode designed like the success path. This exercises
 * the REAL pool funder (a test-only dependency — the refund service never imports a sibling
 * service [LAW:one-way-deps]) over a pool the funder filled, proving the two compose through
 * the structural `PoolTerms` → `Refundable` bridge with no runtime coupling, exactly as the
 * release engine composes with the funder.
 */

const acc = (s: string): AccountId => must(accountId(s));
const LEDGER_AT = must(ledgerTimestamp(1_700_000_000_000));
const MINT = acc('mint');
const BUILDER = acc('builder');
const POOL_ESCROW = acc('pool-escrow-ffmpeg');
const wallet = (id: string): AccountId => acc(`backer-${id}`);

const ffmpegPool = (target: bigint): Pool => ({
  id: must(poolId('pool-ffmpeg-feature')),
  escrowAccount: POOL_ESCROW,
  builderAccount: BUILDER,
  target: coins(target),
});

/** A ledger with the pool's escrow opened and one funded wallet per backer (minted exactly the
 *  coins it will contribute), ready for the real funder to fill the pool. */
const worldFor = async (
  pool: Pool,
  backers: readonly { id: string; funds: bigint }[],
): Promise<Ledger & LedgerQuery> => {
  const ledger = createInMemoryLedger(() => LEDGER_AT);
  const open = (id: AccountId, kind: Account['kind']): Promise<unknown> => ledger.openAccount({ id, kind });
  await open(MINT, 'mint');
  must(await openPool(ledger, pool));
  for (const { id, funds } of backers) {
    await open(wallet(id), 'user-wallet');
    must(
      await ledger.post({
        transfers: [must(transfer(MINT, wallet(id), coins(funds)))],
        reason: must(transactionReason('mint-to-backer')),
        idempotencyKey: must(idempotencyKey(`mint-${id}`)),
      }),
    );
  }
  return ledger;
};

describe('a pool that never reaches its target refunds its backers, every coin accounted for', () => {
  it('returns each backer exactly what they contributed and drains the escrow, the pool id riding through', async () => {
    const pool = ffmpegPool(100n); // target the contributions will fall short of
    const ledger = await worldFor(pool, [
      { id: 'ami', funds: 20n },
      { id: 'ben', funds: 20n },
      { id: 'cleo', funds: 20n },
    ]);
    const funder = createPoolFunder(ledger);

    // Three backers chip in twenty each — sixty pooled against a hundred-coin target, so it
    // never ships. The contributions are the genuine record the refund will read.
    for (const id of ['ami', 'ben', 'cleo']) {
      const contributed = await funder.contribute({
        pool,
        backer: wallet(id),
        amount: coins(20n),
        idempotencyKey: must(idempotencyKey(`c-${id}`)),
        reason: must(transactionReason('pool-contribution')),
      });
      expect(contributed.kind).toBe('contributed');
    }
    expect(await ledger.balanceOf(POOL_ESCROW)).toBe(60n);

    // The product surface gives up on the unmet pool and refunds it — the SAME pledge shape the
    // release engine would have settled, here settled backwards instead.
    const engine = createRefundEngine({ query: ledger, rail: createCustodialRail(ledger) });
    const outcome = await engine.tryRefund(asEscrowedPledge(pool, AT), reason('pool-expired'));

    expect(outcome.kind).toBe('refunded');
    if (outcome.kind !== 'refunded') throw new Error('unreachable');
    // Every backer made whole, the escrow empty, nothing left stranded and nothing invented —
    // the refunds sum to exactly the sixty that was pooled.
    expect(await ledger.balanceOf(wallet('ami'))).toBe(20n);
    expect(await ledger.balanceOf(wallet('ben'))).toBe(20n);
    expect(await ledger.balanceOf(wallet('cleo'))).toBe(20n);
    expect(await ledger.balanceOf(POOL_ESCROW)).toBe(0n);
    // The builder, who never shipped, is paid nothing.
    expect(await ledger.balanceOf(BUILDER)).toBe(0n);
    // The pool's identity rides through to the refunded pledge — what the stream's feed names.
    expect(outcome.pledge.terms.poolId).toBe(pool.id);
    expect(outcome.pledge.refundedAt).toBe(AT);
    expect(String(outcome.pledge.reason)).toBe('pool-expired');
  });
});
