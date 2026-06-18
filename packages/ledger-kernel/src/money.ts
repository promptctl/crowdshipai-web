import type { Brand } from './brand.js';
import type { Result } from './result.js';
import { err, ok } from './result.js';

/**
 * An exact, indivisible quantity of coins. Backed by `bigint`, so a fractional
 * amount is not even expressible and float rounding can never touch money
 * [LAW:types-are-the-program]. The buy/sell rate that maps coins to currency is
 * policy and lives outside the ledger; here a coin is only ever a whole count.
 */
export type CoinAmount = Brand<bigint, 'CoinAmount'>;

export type CoinAmountError = { readonly kind: 'not-positive'; readonly value: bigint };

/**
 * A movement amount is always at least one coin. A zero or negative movement is
 * meaningless, so it is rejected here rather than represented and defended
 * against at every callsite.
 */
export const coinAmount = (value: bigint): Result<CoinAmount, CoinAmountError> =>
  value > 0n ? ok(value as CoinAmount) : err({ kind: 'not-positive', value });
