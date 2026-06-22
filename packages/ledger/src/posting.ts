import type { AccountId, AccountKind, Transaction } from '@crowdship/ledger-kernel';
import { mayGoNegative, netEffect, ok, err } from '@crowdship/ledger-kernel';
import type { Result } from '@crowdship/ledger-kernel';

/**
 * The state the posting decision reads, supplied by the boundary as plain
 * values. Keeping it as two pure lookups (never the store itself) is what makes
 * the decision a pure function: the boundary performs the reads, this gate only
 * computes [LAW:effects-at-boundaries].
 *
 * `kindOf` returns `undefined` for an account the ledger has never opened — its
 * negativity rule is therefore unknowable, so it must be rejected rather than
 * defaulted [LAW:no-silent-failure]. `balanceOf` returns the account's current
 * derived balance, `0n` for a known account that has never moved coins.
 */
export interface LedgerView {
  readonly kindOf: (id: AccountId) => AccountKind | undefined;
  readonly balanceOf: (id: AccountId) => bigint;
}

/**
 * The reasons a coin movement may be refused at the single enforcement point.
 * Each is a value the caller destructures, never a thrown exception
 * [LAW:no-silent-failure]. The set is closed: these are the only ways a
 * well-formed transaction can fail to post.
 */
export type PostingRejection =
  | { readonly kind: 'unknown-account'; readonly account: AccountId }
  | {
      readonly kind: 'would-overdraft';
      readonly account: AccountId;
      readonly accountKind: AccountKind;
      readonly balance: bigint;
      readonly delta: bigint;
      readonly resulting: bigint;
    };

/** Every account named by a transfer leg, in first-seen order. */
const accountsOf = (txn: Transaction): readonly AccountId[] => {
  const seen = new Set<AccountId>();
  const order: AccountId[] = [];
  for (const t of txn.transfers) {
    for (const a of [t.from, t.to]) {
      if (!seen.has(a)) {
        seen.add(a);
        order.push(a);
      }
    }
  }
  return order;
};

/**
 * The one place no-overdraft is enforced [LAW:single-enforcer]. Pure: given the
 * current view and a (kernel-balanced) transaction, it either approves the post
 * or names the single reason it is refused. It decides *legality* only and
 * reports nothing about resulting balances — that is the separate concern of
 * {@link resultingBalances}, the single author of the post's receipt
 * [LAW:one-source-of-truth]. Folding "is this legal" and "what did it produce"
 * into one output is what let two derivations of a money value drift apart.
 *
 * Two rules, and only two:
 *  - Every account named by the transaction must be known, or its negativity
 *    rule is unknowable.
 *  - No account whose net balance falls below zero may do so unless its kind
 *    permits it (`mayGoNegative` — only the mint, whose negative balance *is*
 *    the coins in circulation).
 *
 * Overdraft is judged on the *net* effect, so an account that dips and recovers
 * within one atomic transaction is never falsely refused — only the resulting
 * balance can be illegal.
 */
export const decidePosting = (
  view: LedgerView,
  txn: Transaction,
): Result<void, PostingRejection> => {
  const net = netEffect(txn);

  for (const account of accountsOf(txn)) {
    const accountKind = view.kindOf(account);
    if (accountKind === undefined) return err({ kind: 'unknown-account', account });

    const delta = net.get(account);
    if (delta === undefined) continue; // known account, but this transaction nets it to zero

    const balance = view.balanceOf(account);
    const resulting = balance + delta;
    if (resulting < 0n && !mayGoNegative(accountKind)) {
      return err({ kind: 'would-overdraft', account, accountKind, balance, delta, resulting });
    }
  }

  return ok(undefined);
};
