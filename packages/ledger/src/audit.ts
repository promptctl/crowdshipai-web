import type { AccountId, NonEmptyArray, Transaction } from '@crowdship/ledger-kernel';

import { foldBalances } from './balances.js';

/**
 * One account whose *derived* balance disagrees with the fold of the
 * authoritative log — the single way the ledger's global state can be unsound at
 * this layer, carried as a value an alarm reads rather than a thrown blob
 * [LAW:no-silent-failure]. It names the account and both numbers so an operator
 * sees exactly what diverged and by how much.
 *
 * There is deliberately no "value not conserved" or "transaction does not net to
 * zero" breach here. Those invariants hold *by construction* in the kernel —
 * every `Transfer` debits and credits the same amount, so every transaction, and
 * the whole log, nets to zero for any well-typed history — and the kernel already
 * owns and property-tests that theorem [LAW:single-enforcer]. Re-checking it here
 * would be a branch no well-typed input could ever trip: an un-fireable,
 * un-verifiable guard [LAW:verifiable-goals]. This audit complements those
 * upstream guarantees with the one global invariant that *can* drift — a
 * separately-maintained balance view falling out of step with the log.
 */
export interface BalanceDrift {
  readonly account: AccountId;
  readonly authoritative: bigint;
  readonly claimed: bigint;
}

/**
 * The verdict of a reconciliation, as one closed union the caller matches
 * exhaustively [LAW:dataflow-not-control-flow]: either the derived view is
 * `sound` (matches the fold of the authoritative log everywhere), or it has
 * `drifted` with at least one specific, actionable divergence. The non-empty list
 * makes "drifted but nothing actually diverged" unrepresentable — a `drifted`
 * verdict always carries the reason [LAW:types-are-the-program].
 */
export type LedgerIntegrity =
  | { readonly kind: 'sound' }
  | { readonly kind: 'drifted'; readonly drift: NonEmptyArray<BalanceDrift> };

/**
 * The single author of "does this derived balance view still agree with the
 * authoritative log" [LAW:one-source-of-truth]. Pure: it computes only, from the
 * log and a claimed balance view the caller read from the store
 * [LAW:effects-at-boundaries].
 *
 * It re-derives the authoritative balances *independently* via the one
 * {@link foldBalances} author — the same fold the store's derived view uses — so
 * a drift finding can only ever be a real divergence in the *claimed* view, never
 * two fold algorithms disagreeing; this is the y38.3 "one balance author"
 * guarantee applied to reconciliation. Today the in-memory store's `balances()`
 * *is* that fold, so this is always `sound`; it becomes load-bearing when a
 * derived balance index (ledger .7) is maintained alongside the log and could
 * fall out of step with it.
 *
 * The comparison ranges over the *union* of accounts in both views, so a view
 * that claims a balance the log does not have — or omits one the log does — is
 * caught, never silently skipped [LAW:no-silent-failure].
 *
 * Trust direction is fixed here: *our* log is authoritative and the claimed view
 * is the suspect. That is true for any engine whose log we own (the in-memory
 * store, a durable SQL store). An engine with its own *native* authoritative
 * balance source (an on-chain or TigerBeetle settlement engine, ledger .5) needs
 * a distinct reconciliation — engine-native balances vs. our replica, with the
 * engine as the authority — not a reinterpretation of this one, whose
 * `authoritative`/`claimed` names would then misstate which side to trust
 * [FRAMING:representation].
 */
export const auditLedger = (
  history: readonly Transaction[],
  claimed: ReadonlyMap<AccountId, bigint>,
): LedgerIntegrity => {
  const authoritative = foldBalances(history);
  const drift: BalanceDrift[] = [];

  for (const account of new Set<AccountId>([...authoritative.keys(), ...claimed.keys()])) {
    const a = authoritative.get(account) ?? 0n;
    const c = claimed.get(account) ?? 0n;
    if (a !== c) drift.push({ account, authoritative: a, claimed: c });
  }

  const [head, ...rest] = drift;
  if (head === undefined) return { kind: 'sound' };
  return { kind: 'drifted', drift: [head, ...rest] };
};

const describeDrift = (d: BalanceDrift): string =>
  `${d.account}: authoritative ${d.authoritative}, claimed ${d.claimed}`;

/**
 * The loud halt raised when a reconciliation finds a derived balance view out of
 * step with the authoritative log. It carries the structured drift so an
 * operator's alarm can read exactly what diverged, and renders it into its
 * message so a log line is never empty [LAW:no-silent-failure]. Thrown (never
 * returned) because drift is not a routine outcome a caller chooses to handle —
 * it means a balance the system trusts cannot be trusted, and the suspect path
 * must stop rather than paper over it.
 */
export class LedgerIntegrityError extends Error {
  readonly drift: NonEmptyArray<BalanceDrift>;

  constructor(drift: NonEmptyArray<BalanceDrift>) {
    super(`ledger integrity breached — derived balances drifted from the log: ${drift.map(describeDrift).join('; ')}`);
    this.name = 'LedgerIntegrityError';
    this.drift = drift;
  }
}
