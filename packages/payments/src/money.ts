import type { Brand, BlankError, Result } from '@crowdship/std';
import { err, nonBlank, ok } from '@crowdship/std';

/**
 * An exact amount of real money in its currency's smallest indivisible unit
 * (cents for USD, pence for GBP). Backed by `bigint` for the same reason a coin
 * is — a fractional minor unit is not expressible and float rounding can never
 * touch money [LAW:types-are-the-program]. This is the *fiat* side of the
 * on-ramp; the coin side is `@crowdship/std`'s `CoinAmount`, and the rate that
 * maps one to the other is policy that lives in neither primitive (its own
 * ticket), so this type carries no exchange knowledge — only a charged amount.
 */
export type FiatAmount = Brand<bigint, 'FiatAmount'>;

export type FiatAmountError = { readonly kind: 'not-positive'; readonly value: bigint };

/**
 * A charge is always at least one minor unit. A zero or negative charge is
 * meaningless — you cannot take nothing, nor give money back through the
 * on-ramp (a refund is its own movement) — so it is rejected here rather than
 * represented and defended against downstream [LAW:no-defensive-null-guards].
 */
export const fiatAmount = (value: bigint): Result<FiatAmount, FiatAmountError> =>
  value > 0n ? ok(value as FiatAmount) : err({ kind: 'not-positive', value });

/**
 * The currency a charge is denominated in — an opaque, non-blank code (e.g.
 * `USD`). Taken verbatim at the trust boundary [LAW:single-enforcer]; this
 * primitive does not police the ISO-4217 set, only that a currency was named,
 * because which currencies the platform accepts is policy, not a property of
 * the money type. The brand keeps a currency from being passed where a payment
 * method or any other opaque string is meant.
 */
export type Currency = Brand<string, 'Currency'>;

export const currency = (raw: string): Result<Currency, BlankError> =>
  nonBlank<'Currency'>('currency', raw);
