import type { Brand } from './brand.js';
import type { AccountId } from './ids.js';
import type { CoinAmount } from './money.js';
import type { Result } from './result.js';
import { err, ok } from './result.js';

/**
 * The authoritative unit of coin movement: `amount` leaves `from` and arrives
 * at `to`. It is balanced by construction — one account loses exactly what
 * another gains — so a movement that creates or destroys coins has no
 * representation in this system [LAW:types-are-the-program].
 *
 * The type is nominal: `transfer()` is the ONLY way to obtain one, so the
 * distinct-account invariant is carried by the type itself, not just enforced
 * in a function a second constructor could bypass [LAW:single-enforcer].
 */
interface TransferFields {
  readonly from: AccountId;
  readonly to: AccountId;
  readonly amount: CoinAmount;
}

export type Transfer = Brand<TransferFields, 'Transfer'>;

export type TransferError = { readonly kind: 'same-account'; readonly account: AccountId };

export const transfer = (
  from: AccountId,
  to: AccountId,
  amount: CoinAmount,
): Result<Transfer, TransferError> => {
  if (from === to) return err({ kind: 'same-account', account: from });
  const fields: TransferFields = { from, to, amount };
  return ok(fields as Transfer);
};
