import { createInMemoryLedger, type Ledger } from '@crowdship/ledger';
import {
  accountId,
  coinAmount,
  idempotencyKey,
  transactionReason,
  type Account,
  type AccountId,
  type CoinAmount,
  type IdempotencyKey,
  type Result,
  type TransactionReason,
} from '@crowdship/ledger-kernel';
import {
  chargeKey,
  currency,
  fiatAmount,
  paymentMethod,
  type FiatCharge,
} from '@crowdship/payments';

import type { OnRampRequest } from '../src/index.js';

/**
 * The shared fake world the on-ramp tests buy against: an in-memory ledger with the
 * mint opened and a backer wallet, plus builders for fiat charges and buy requests.
 * It lives in one place so every suite exercises the SAME world rather than fixtures
 * that can drift [LAW:one-source-of-truth]. Everything here is scaffolding — the real
 * seams under test (the gateway, the ledger) are imported from the packages themselves.
 */

/** Unwrap a successful result or fail loudly — never let an error slip past a
 *  truthiness check [LAW:no-silent-failure]. */
export const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

export const coins = (n: bigint): CoinAmount => must(coinAmount(n));
export const acc = (s: string): AccountId => must(accountId(s));
export const key = (s: string): IdempotencyKey => must(idempotencyKey(s));
export const reason = (s: string): TransactionReason => must(transactionReason(s));
const account = (id: AccountId, kind: Account['kind']): Account => ({ id, kind });

export const MINT = acc('mint');
export const WALLET = acc('backer-wallet');

/** A USD charge of `amount` minor units on a test card, idempotent under `k`. */
export const usdCharge = (amount: bigint, k: string): FiatCharge => ({
  amount: must(fiatAmount(amount)),
  currency: must(currency('USD')),
  method: must(paymentMethod('pm_test_card')),
  key: must(chargeKey(k)),
});

/** A ledger with the mint opened and (by default) the backer wallet too. A test
 *  that wants the credit refused opens it WITHOUT the wallet, so the mint movement
 *  names an account the ledger has never seen. */
export const onRampLedger = async (openWallet = true): Promise<Ledger> => {
  const ledger = createInMemoryLedger();
  must(await ledger.openAccount(account(MINT, 'mint')));
  if (openWallet) must(await ledger.openAccount(account(WALLET, 'user-wallet')));
  return ledger;
};

/**
 * A buy request: `coinCount` coins into the backer wallet for `fiat` minor units,
 * with the fiat charge key and the ledger post key both derived from one purchase
 * id `k` — the way the pricing policy upstream will mint a correlated pair.
 */
export const buyRequest = (coinCount: bigint, fiat: bigint, k: string): OnRampRequest => ({
  wallet: WALLET,
  coins: coins(coinCount),
  charge: usdCharge(fiat, `chg-${k}`),
  reason: reason(`coin-purchase:${k}`),
  idempotencyKey: key(`mint-${k}`),
});
