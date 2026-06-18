import type { AccountId } from './ids.js';
import type { CoinAmount } from './money.js';
import type { Result } from './result.js';
import { err, ok } from './result.js';

/**
 * The authoritative unit of coin movement: `amount` leaves `from` and arrives
 * at `to`. It is balanced by construction — one account loses exactly what
 * another gains — so a movement that creates or destroys coins has no
 * representation in this system [LAW:types-are-the-program].
 */
export interface Transfer {
  readonly from: AccountId;
  readonly to: AccountId;
  readonly amount: CoinAmount;
}

export type TransferError = { readonly kind: 'same-account'; readonly account: AccountId };

export const transfer = (
  from: AccountId,
  to: AccountId,
  amount: CoinAmount,
): Result<Transfer, TransferError> =>
  from === to ? err({ kind: 'same-account', account: from }) : ok({ from, to, amount });
