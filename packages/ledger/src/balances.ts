import type { AccountId, Transaction } from '@crowdship/ledger-kernel';
import { netEffect } from '@crowdship/ledger-kernel';

/**
 * The single author of "what balances did this post produce" [LAW:one-source-of-
 * truth]. Given the authoritative log and one transaction in it, it derives the
 * resulting balance of every account that transaction changed, *as of that
 * transaction* — the fold of the log up to and including it. Accounts the
 * transaction nets to zero are absent, mirroring {@link netEffect}.
 *
 * Both receipts a `post` can return — the fresh post and the replay of a prior
 * one — derive through this one function, so they can never disagree: the same
 * key yields the same receipt forever, and a fresh post and its later replay
 * report identical numbers by construction, not by two algorithms happening to
 * coincide. Because the fold stops at `txn`, the result is point-in-time and
 * immune to later activity [LAW:no-ambient-temporal-coupling].
 *
 * It computes only — the caller supplies the log it read from the store
 * [LAW:effects-at-boundaries]. `txn` MUST be present in `history` (the boundary
 * appends it, or finds it there, before calling); a transaction absent from the
 * log it claims to belong to is corruption of the one authoritative record, so
 * it halts loudly rather than silently returning current-instead-of-point-in-time
 * balances [LAW:no-silent-failure].
 */
export const resultingBalances = (
  history: readonly Transaction[],
  txn: Transaction,
): ReadonlyMap<AccountId, bigint> => {
  const changed = netEffect(txn);
  const balances = new Map<AccountId, bigint>();
  let reached = false;
  for (const t of history) {
    for (const [account, delta] of netEffect(t)) {
      if (changed.has(account)) balances.set(account, (balances.get(account) ?? 0n) + delta);
    }
    if (t.id === txn.id) {
      reached = true;
      break;
    }
  }
  if (!reached) {
    throw new Error(`ledger corruption: transaction not found in its own log: ${txn.id}`);
  }
  return balances;
};
