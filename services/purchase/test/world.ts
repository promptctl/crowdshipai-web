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
  dispatchingPerformer,
  effectKind,
  offerId,
  type Effect,
  type EffectHandler,
  type EffectKind,
  type EffectPerformer,
  type JsonValue,
  type PricedOffer,
} from '@crowdship/menu';

import type { PurchaseRequest } from '../src/index.js';

/**
 * The shared fake world the purchase tests buy against: a funded in-memory ledger,
 * named accounts, and builders for offers, performers, and requests. It lives in one
 * place so the purchase-mechanics suite and the extensibility demonstration exercise
 * the SAME world rather than two fixtures that can drift [LAW:one-source-of-truth].
 * Everything here is test scaffolding — the real seams under test are imported from
 * the packages themselves.
 */

/** Unwrap a successful result or fail loudly — never let a falsy value or an error
 *  slip past a truthiness check [LAW:no-silent-failure]. */
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
export const BACKER = acc('backer');
export const BUILDER = acc('builder');

/** A funded world: mint, backer (holding `funded` coins), and builder, behind one
 *  in-memory ledger. The fixtures supply real coins so a purchase moves real value. */
export const fundedLedger = async (funded: bigint): Promise<Ledger> => {
  const ledger = createInMemoryLedger();
  must(await ledger.openAccount(account(MINT, 'mint')));
  must(await ledger.openAccount(account(BACKER, 'user-wallet')));
  must(await ledger.openAccount(account(BUILDER, 'user-wallet')));
  must(await ledger.post({ transfers: [must(transfer(MINT, BACKER, coins(funded)))], reason: reason('mint'), idempotencyKey: key('mint-fund') }));
  return ledger;
};

/** A priced offer carrying an effect of `kind`, failing loudly on bad fixture input.
 *  This builds an offer DIRECTLY — purchase-mechanics tests do not care how the offer
 *  came to be. The extensibility demonstration deliberately does NOT use this: it
 *  authors its offers through the real `authorMenu` to prove the whole chain. */
export const offer = (id: string, price: bigint, kind: string, params: JsonValue): PricedOffer => ({
  id: must(offerId(id)),
  price: coins(price),
  effect: { kind: must(effectKind(kind)), params },
});

/** A performer whose every handler records that it ran, so a test can prove an
 *  effect fired exactly once (or never) across retries and across instances. The
 *  handler is registered by kind into a Map — the same one map entry a builder's
 *  edge would add for a brand-new kind, and zero platform code. */
export const countingPerformer = (
  kinds: readonly string[],
): { performer: EffectPerformer; fires: () => readonly Effect[] } => {
  const fired: Effect[] = [];
  const record: EffectHandler = async (e) => {
    fired.push(e);
    return { ok: true, value: { ack: e.kind } };
  };
  const handlers = new Map<EffectKind, EffectHandler>(kinds.map((k) => [must(effectKind(k)), record]));
  return { performer: dispatchingPerformer(handlers), fires: () => fired };
};

/** A buy request routing a backer's purchase of `o` to the builder, keyed by `k`. */
export const buyRequest = (o: PricedOffer, k: string): PurchaseRequest => ({
  offer: o,
  payer: BACKER,
  payee: BUILDER,
  idempotencyKey: key(k),
  reason: reason(`buy:${o.id}`),
});
