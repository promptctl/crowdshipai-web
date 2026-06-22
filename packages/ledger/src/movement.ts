import { createHash } from 'node:crypto';

import type { AccountId, IdempotencyKey, TransactionId, Transfer } from '@crowdship/ledger-kernel';
import { transactionId } from '@crowdship/ledger-kernel';

/**
 * The stable domain id of the movement a key identifies, derived from the key
 * alone so every replay of the same movement reports the identical id
 * [LAW:one-source-of-truth]. It is a handle for callers (settlement referencing
 * "the transaction that funded this escrow"), distinct from the raw key. Both
 * ledger implementations derive it the same way, so a movement has one id
 * regardless of which engine recorded it.
 */
export const transactionIdOf = (key: IdempotencyKey): TransactionId => {
  const hex = createHash('sha256').update(`movement:${key}`).digest('hex').slice(0, 32);
  const id = transactionId(hex);
  if (!id.ok) throw new Error('unreachable: a sha-256 hex digest is never blank');
  return id.value;
};

/**
 * Every account a movement touches, in first-seen order — the account set a
 * receipt reports balances for. Both ledger implementations build the receipt from
 * this one function, so the fake and the engine can never disagree on which
 * accounts a movement's receipt names [LAW:one-source-of-truth].
 */
export const touchedAccounts = (transfers: readonly Transfer[]): readonly AccountId[] => {
  const seen = new Set<AccountId>();
  const order: AccountId[] = [];
  for (const t of transfers) {
    for (const account of [t.from, t.to]) {
      if (!seen.has(account)) {
        seen.add(account);
        order.push(account);
      }
    }
  }
  return order;
};
