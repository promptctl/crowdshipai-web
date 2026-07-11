import type { AccountMovement } from '@crowdship/ledger';
import type { AccountId, Transfer } from '@crowdship/ledger-kernel';
import { transfer } from '@crowdship/ledger-kernel';
import { coinAmount } from '@crowdship/std';

/**
 * The contributor ledger of an escrow and how an amount distributes back over it — the
 * one concept BOTH settlement directions return coins along [LAW:one-source-of-truth]:
 * the refund engine returns the WHOLE escrow (each backer their exact net), and the
 * release engine returns the overshoot beyond a pool's target (each backer their
 * pro-rata slice of the excess). Both are instances of one distribution, differing only
 * in the amount value that flows through it [LAW:one-type-per-behavior]; this module is
 * that shared third, named and extracted so neither engine keeps a private copy that
 * could drift [LAW:one-way-deps].
 */

/**
 * Each backer's net contribution to the escrow, read straight from its recorded history: a
 * credit (coins INTO escrow) is what a backer put in, a debit (coins OUT) is what already went
 * back to them. The fold over the history — oldest first, the ledger's contract — yields, per
 * counterparty, the coins still owed back. This is the whole reason a return needs no second
 * contributor list: the escrow's own legs are the list [LAW:one-source-of-truth]. A counterparty
 * whose net is zero (fully refunded) or negative (a payout leg, e.g. a builder on a release)
 * carries no stake to return, and the distribution below gives it nothing.
 */
export const netContributions = (history: readonly AccountMovement[]): ReadonlyMap<AccountId, bigint> => {
  const net = new Map<AccountId, bigint>();
  for (const movement of history) {
    const signed = movement.direction === 'credit' ? (movement.amount as bigint) : -(movement.amount as bigint);
    net.set(movement.counterparty, (net.get(movement.counterparty) ?? 0n) + signed);
  }
  return net;
};

/** The coins an escrow still owes back in total: the sum of its backers' positive nets. The
 *  ceiling every distribution is judged against — returning more than this would hand backers
 *  coins they never staked. */
export const owedToBackers = (net: ReadonlyMap<AccountId, bigint>): bigint =>
  [...net.values()].reduce((sum, n) => (n > 0n ? sum + n : sum), 0n);

/**
 * Distribute `amount` over the backers pro-rata by their positive net contributions, conserving
 * it EXACTLY in integer coins. The whole-escrow return (`amount` = everything owed) falls out as
 * each backer their exact net with no rounding at all; a partial return (a pool's overshoot)
 * rounds each slice down and then hands the leftover coins — strictly fewer than there are
 * weighted backers — one each to the backers with the largest discarded fraction, ties broken by
 * account id, so the remainder has one deterministic owner and two processes computing the same
 * distribution can never disagree [LAW:no-ambient-temporal-coupling].
 *
 * The result carries only POSITIVE shares — a zero share is not a coin movement, so it is not an
 * entry [LAW:types-are-the-program] — and always sums to `amount` exactly: coins are conserved by
 * construction, never checked after the fact by a guard that could be forgotten.
 *
 * Its domain is `0 <= amount <=` everything owed. A negative amount or one beyond the backers'
 * recorded stakes is not a routine input any caller can mean — it would fabricate a return the
 * money never backed — so it is corruption, halted loudly rather than clamped or partially
 * honoured [LAW:no-silent-failure].
 */
export const proRataShares = (
  net: ReadonlyMap<AccountId, bigint>,
  amount: bigint,
): ReadonlyMap<AccountId, bigint> => {
  const owed = owedToBackers(net);
  if (amount < 0n || amount > owed) {
    throw new Error(`cannot distribute ${amount} over backers owed ${owed}: beyond their recorded stakes`);
  }

  // Sorted once so the distribution is a pure function of the CONTENTS of `net`, never of the
  // incidental order its entries were inserted in [LAW:one-source-of-truth].
  const stakes = [...net].filter(([, n]) => n > 0n).sort(([a], [b]) => (a < b ? -1 : 1));

  const floors = stakes.map(([backer, stake]) => ({
    backer,
    share: (amount * stake) / owed,
    fraction: (amount * stake) % owed,
  }));

  // The leftover after flooring is strictly fewer coins than there are backers, so handing one
  // coin to each of the largest fractions (id-ascending on ties, from the sort above) lands the
  // total on `amount` exactly.
  let leftover = amount - floors.reduce((sum, f) => sum + f.share, 0n);
  const byFraction = [...floors].sort((a, b) => (a.fraction === b.fraction ? 0 : a.fraction > b.fraction ? -1 : 1));
  for (const f of byFraction) {
    if (leftover === 0n) break;
    f.share += 1n;
    leftover -= 1n;
  }

  return new Map(floors.filter((f) => f.share > 0n).map((f) => [f.backer, f.share]));
};

/**
 * The shares made movable: one balanced leg per backer, escrow → backer their share. A share is
 * strictly positive by {@link proRataShares}' contract and a backer is a credit counterparty of
 * the escrow, which the ledger guarantees is not the escrow itself — so a failure from either
 * constructor is a corrupt history, halted loudly rather than downgraded to a routine value
 * [LAW:no-silent-failure].
 */
export const returnLegs = (
  escrow: AccountId,
  shares: ReadonlyMap<AccountId, bigint>,
): readonly Transfer[] =>
  [...shares].map(([backer, share]) => {
    const amount = coinAmount(share);
    if (!amount.ok) throw new Error(`return share for ${backer} was not a valid coin amount: ${share}`);
    const leg = transfer(escrow, backer, amount.value);
    if (!leg.ok) throw new Error(`return leg escrow ${escrow} → backer ${backer} was rejected: ${leg.error.kind}`);
    return leg.value;
  });
