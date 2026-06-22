import { createInMemoryLedger, type Ledger } from '@crowdship/ledger';
import {
  accountId,
  coinAmount,
  idempotencyKey,
  transactionReason,
  transfer,
  type Account,
  type AccountId,
  type CoinAmount,
  type IdempotencyKey,
  type Result,
  type TransactionReason,
} from '@crowdship/ledger-kernel';
import {
  deliverableId,
  escrow,
  goalId,
  pledgeId,
  type Condition,
  type Escrowed,
} from '@crowdship/settlement';
import { timestamp, type Clock, type Timestamp } from '@crowdship/std';

import {
  createInMemoryReleaseLog,
  createReleaseEngine,
  type CutPolicy,
  type Obligation,
  type ObligationFacts,
  type ReleaseEngine,
} from '../src/index.js';

/**
 * The shared fake world the release tests settle against: a ledger with a funded escrow
 * account, the three other accounts a release touches, and builders for conditions,
 * pledges, fact sources, and the engine. It lives in one place so every suite exercises
 * the SAME world rather than fixtures that can drift [LAW:one-source-of-truth]. Everything
 * here is scaffolding — the real seams under test are imported from the packages.
 */

/** Unwrap a successful result or fail loudly — never let an error slip past [LAW:no-silent-failure]. */
export const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

export const coins = (n: bigint): CoinAmount => must(coinAmount(n));
const acc = (s: string): AccountId => must(accountId(s));
const key = (s: string): IdempotencyKey => must(idempotencyKey(s));
const reason = (s: string): TransactionReason => must(transactionReason(s));
const account = (id: AccountId, kind: Account['kind']): Account => ({ id, kind });

export const ESCROW = acc('escrow-obligation-1');
export const BUILDER = acc('builder');
export const PLATFORM = acc('platform-revenue');
const MINT = acc('mint');

/** A fixed clock — the boundary owns "now", and a deterministic instant makes the
 *  released pledge's timestamps assertable [LAW:no-ambient-temporal-coupling]. */
export const AT: Timestamp = must(timestamp(1_700_000_000_000));
export const clock: Clock = { now: () => AT };

const fundEscrow = async (ledger: Ledger, escrowFunds: bigint): Promise<void> => {
  // Zero coins is a real state (an unfunded escrow) — there is simply no movement to post.
  if (escrowFunds === 0n) return;
  must(
    await ledger.post({
      transfers: [must(transfer(MINT, ESCROW, coins(escrowFunds)))],
      reason: reason('fund-escrow'),
      idempotencyKey: key('fund-escrow'),
    }),
  );
};

/** A ledger with the four accounts a release touches, the escrow holding `escrowFunds`
 *  coins (the coins backers pledged, already in escrow when the pledge opened). */
export const ledgerWithEscrow = async (escrowFunds: bigint): Promise<Ledger> => {
  const ledger = createInMemoryLedger();
  must(await ledger.openAccount(account(MINT, 'mint')));
  must(await ledger.openAccount(account(ESCROW, 'escrow')));
  must(await ledger.openAccount(account(BUILDER, 'user-wallet')));
  must(await ledger.openAccount(account(PLATFORM, 'platform-revenue')));
  await fundEscrow(ledger, escrowFunds);
  return ledger;
};

/** A funded ledger whose builder account was never opened — so a release that tries to pay
 *  the builder is refused by the ledger (`unknown-account`), the realistic loud-refusal case. */
export const ledgerMissingBuilder = async (escrowFunds: bigint): Promise<Ledger> => {
  const ledger = createInMemoryLedger();
  must(await ledger.openAccount(account(MINT, 'mint')));
  must(await ledger.openAccount(account(ESCROW, 'escrow')));
  must(await ledger.openAccount(account(PLATFORM, 'platform-revenue')));
  await fundEscrow(ledger, escrowFunds);
  return ledger;
};

/** A cut taking 10% for the platform, the builder gets the rest — the default knob. */
export const tenPercentCut: CutPolicy = (gross) => ({
  platformCut: coins(gross / 10n),
  builderShare: coins(gross - gross / 10n),
});

/** A fact source answering the deliverable/goal questions with fixed booleans. */
export const facts = (opts: { accepted?: boolean; resolved?: boolean }): ObligationFacts => ({
  accepted: () => Promise.resolve(opts.accepted ?? false),
  resolved: () => Promise.resolve(opts.resolved ?? false),
});

/** Build a release engine over a ledger and fact source, with a fresh in-memory log so
 *  a suite's repeated calls share one release record. The cut defaults to the 10% knob. */
export const engineOver = (
  ledger: Ledger,
  factSource: ObligationFacts,
  cut: CutPolicy = tenPercentCut,
): ReleaseEngine =>
  createReleaseEngine({
    ledger,
    facts: factSource,
    platformAccount: PLATFORM,
    cut,
    clock,
    reason: reason('obligation-release'),
    log: createInMemoryReleaseLog(),
  });

export const poolTarget = (target: bigint): Condition => ({
  kind: 'pool-target-reached',
  target: coins(target),
});
export const deliverableAccepted = (id: string): Condition => ({
  kind: 'deliverable-accepted',
  deliverable: must(deliverableId(id)),
});
export const goalResolved = (id: string): Condition => ({
  kind: 'goal-resolved',
  goal: must(goalId(id)),
});

/** An escrowed pledge of `amount` coins against `condition`, routed escrow → builder by
 *  default; `routing` overrides the accounts (e.g. to make a misrouted obligation). */
export const escrowedPledge = (
  id: string,
  amount: bigint,
  condition: Condition,
  routing?: Partial<Pick<Obligation, 'escrowAccount' | 'builderAccount'>>,
): Escrowed<Obligation> => {
  const terms: Obligation = {
    escrowAccount: ESCROW,
    builderAccount: BUILDER,
    condition,
    ...routing,
  };
  return escrow(must(pledgeId(id)), coins(amount), terms, AT);
};
