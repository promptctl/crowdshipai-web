import type { AccountMovement, MovementDirection } from '@crowdship/ledger';
import { accountId, coinAmount, timestamp, transactionReason, type AccountId } from '@crowdship/ledger-kernel';
import { describe, expect, it } from 'vitest';

import { projectSettlement, type SettlementRoles } from '../src/index.js';
import { plain } from './plain.js';

/**
 * The pure heart of the feed, tested against a hand-built escrow history so the projection
 * is pinned independent of any ledger — given recorded movements, it yields exactly the
 * settlement events the stream renders [LAW:behavior-not-structure]. Timestamps come from the
 * ledger-kernel constructor here because the feed's `at` is the ledger's own recorded instant.
 */

const must = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};

const acc = (s: string): AccountId => must(accountId(s));
const ESCROW = acc('pool-escrow');
const BUILDER = acc('builder');
const PLATFORM = acc('platform');

const roles: SettlementRoles = { escrow: ESCROW, builder: BUILDER, platform: PLATFORM };

/** One recorded escrow leg, the shape `LedgerQuery.historyOf` returns. */
const leg = (
  direction: MovementDirection,
  amount: bigint,
  counterparty: AccountId,
  resultingBalance: bigint,
  at: number,
  reasonText?: string,
): AccountMovement => ({
  direction,
  amount: must(coinAmount(amount)),
  counterparty,
  resultingBalance,
  reason: must(transactionReason(reasonText ?? (direction === 'credit' ? 'pool-contribution' : 'pool-release'))),
  occurredAt: must(timestamp(at)),
});

describe('projectSettlement — the escrow history is the transparent feed', () => {
  it('names each movement by what it means: contributions in, release and cut out', () => {
    const history: readonly AccountMovement[] = [
      leg('credit', 20n, acc('backer-ami'), 20n, 1_700_000_000_001),
      leg('credit', 30n, acc('backer-ben'), 50n, 1_700_000_000_002),
      leg('debit', 45n, BUILDER, 5n, 1_700_000_000_003),
      leg('debit', 5n, PLATFORM, 0n, 1_700_000_000_004),
    ];

    expect(projectSettlement(history, roles).map(plain)).toEqual([
      { kind: 'contribution', party: 'backer-ami', amount: 20n, pooledAfter: 20n, reason: 'pool-contribution', at: 1_700_000_000_001 },
      { kind: 'contribution', party: 'backer-ben', amount: 30n, pooledAfter: 50n, reason: 'pool-contribution', at: 1_700_000_000_002 },
      { kind: 'release', party: 'builder', amount: 45n, pooledAfter: 5n, reason: 'pool-release', at: 1_700_000_000_003 },
      { kind: 'cut', party: 'platform', amount: 5n, pooledAfter: 0n, reason: 'pool-release', at: 1_700_000_000_004 },
    ]);
  });

  it('preserves the recorded order — the feed reads as the obligation story start to finish', () => {
    const history: readonly AccountMovement[] = [
      leg('credit', 10n, acc('backer-ami'), 10n, 1_700_000_000_001),
      leg('credit', 10n, acc('backer-ben'), 20n, 1_700_000_000_002),
    ];
    const feed = projectSettlement(history, roles);
    expect(feed.map((e) => e.kind)).toEqual(['contribution', 'contribution']);
    expect(feed.map((e) => e.pooledAfter)).toEqual([10n, 20n]);
  });

  it('names a debit back to a prior contributor a refund — the failure mode shown in plain view', () => {
    // An unmet pool returns each backer's stake: a debit to an account that funded the escrow
    // earlier in this same history is a refund, named from the contributor set the projection
    // folds as it walks [LAW:one-source-of-truth] — no new seam input.
    const history: readonly AccountMovement[] = [
      leg('credit', 20n, acc('backer-ami'), 20n, 1_700_000_000_001),
      leg('credit', 30n, acc('backer-ben'), 50n, 1_700_000_000_002),
      leg('debit', 20n, acc('backer-ami'), 30n, 1_700_000_000_003, 'pool-expired'),
      leg('debit', 30n, acc('backer-ben'), 0n, 1_700_000_000_004, 'pool-expired'),
    ];

    expect(projectSettlement(history, roles).map(plain)).toEqual([
      { kind: 'contribution', party: 'backer-ami', amount: 20n, pooledAfter: 20n, reason: 'pool-contribution', at: 1_700_000_000_001 },
      { kind: 'contribution', party: 'backer-ben', amount: 30n, pooledAfter: 50n, reason: 'pool-contribution', at: 1_700_000_000_002 },
      { kind: 'refund', party: 'backer-ami', amount: 20n, pooledAfter: 30n, reason: 'pool-expired', at: 1_700_000_000_003 },
      { kind: 'refund', party: 'backer-ben', amount: 30n, pooledAfter: 0n, reason: 'pool-expired', at: 1_700_000_000_004 },
    ]);
  });

  it('halts loudly on an escrow debit to a party that never contributed — money is never swallowed', () => {
    // The refund arm shrank the anomaly arm but did not remove it: a debit to an account that
    // is neither a payee NOR a prior contributor is still an integrity anomaly, surfaced rather
    // than rendered as something benign [LAW:no-silent-failure]. Here ami DID contribute, so the
    // set is non-empty, proving the check is specific to the actual contributor — not "anyone".
    const history: readonly AccountMovement[] = [
      leg('credit', 20n, acc('backer-ami'), 20n, 1_700_000_000_001),
      leg('debit', 10n, acc('stranger'), 10n, 1_700_000_000_002),
    ];
    expect(() => projectSettlement(history, roles)).toThrow(/unrecognized party/);
  });

  it('halts loudly on a credit FROM a payee — an escrow is funded only by backers', () => {
    // The classification is total and loud on the credit arm too: a settlement escrow being
    // credited by its own builder/platform is an anomaly, not a benign contribution.
    const history: readonly AccountMovement[] = [leg('credit', 10n, BUILDER, 10n, 1_700_000_000_001)];
    expect(() => projectSettlement(history, roles)).toThrow(/funded only by backers/);
  });

  it('halts loudly when the builder and platform roles collide — the cut could not be told apart', () => {
    // Distinctness cannot be stated in the type, so it is checked once at the boundary; a
    // collision would silently drop the cut, which a money feed must never do [LAW:no-silent-failure].
    const collided: SettlementRoles = { escrow: ESCROW, builder: BUILDER, platform: BUILDER };
    const history: readonly AccountMovement[] = [leg('debit', 10n, BUILDER, 0n, 1_700_000_000_003)];
    expect(() => projectSettlement(history, collided)).toThrow(/roles collide/);
  });

  it('is empty for an obligation whose escrow has no recorded movement yet', () => {
    expect(projectSettlement([], roles)).toEqual([]);
  });
});
