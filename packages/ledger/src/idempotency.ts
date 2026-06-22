import type {
  IdempotencyKey,
  Transaction,
  TransactionId,
  TransactionParams,
  Transfer,
} from '@crowdship/ledger-kernel';

/** Compile-time assertion: instantiating it with anything but `true` is a type
 *  error, so a guard written as `Assert<…>` fails the build when it does not
 *  hold. Used below to keep the operation matcher honest as the kernel evolves. */
type Assert<T extends true> = T;

/**
 * A caller reused an idempotency key for a *different* coin movement than the one
 * already recorded under it. This is never silently absorbed: returning the old,
 * unrelated receipt would let the caller believe their new movement posted when it
 * did not — a swallowed money failure [LAW:no-silent-failure]. It is a domain
 * outcome (the caller's mistake, diagnosable and recoverable), not corruption, so
 * it is a returned value the caller destructures, never a throw. It carries the key
 * and the id of the transaction that actually holds it, so the caller can see what
 * the key was already spent on.
 */
export type IdempotencyConflict = {
  readonly kind: 'idempotency-key-reused';
  readonly key: IdempotencyKey;
  readonly recordedTransactionId: TransactionId;
};

/**
 * What an idempotency key resolves to before a post is built, as one closed union
 * of values the boundary matches exhaustively [LAW:dataflow-not-control-flow]:
 *  - `fresh`   — no transaction holds this key; proceed to build, gate, and append.
 *  - `replay`  — this exact operation is already recorded; return its receipt
 *                (balances derived from the log by the boundary) and append
 *                nothing, so a retry can never double-spend.
 *  - `conflict`— the key is taken by a *different* operation; refuse loudly.
 */
export type IdempotencyDecision =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'replay'; readonly recorded: Transaction }
  | { readonly kind: 'conflict'; readonly conflict: IdempotencyConflict };

/**
 * The operation identity a key stands for, derived from the kernel transaction's
 * own field set rather than re-declared, so it cannot fall out of step with it
 * [LAW:one-source-of-truth]. The boundary-minted id and occurred-at moment, and
 * the idempotency key itself, are deliberately excluded: a genuine retry mints a
 * fresh id and reads a later clock yet is the *same* operation, and the key is
 * equal by construction (the prior was fetched by it). Everything else is what
 * makes two posts the same movement. Built from the unbranded `TransactionParams`
 * so a plain request and a recorded transaction both satisfy it structurally.
 */
type NonIdentityField = 'id' | 'occurredAt' | 'idempotencyKey';
type Operation = Omit<TransactionParams, NonIdentityField>;

const sameTransfer = (a: Transfer, b: Transfer): boolean =>
  a.from === b.from && a.to === b.to && a.amount === b.amount;

/** Guard: a transfer is identified by exactly these fields, and `sameTransfer`
 *  compares exactly these. If the kernel adds a field to `Transfer`, `keyof
 *  Transfer` widens and this fails to compile until `sameTransfer` learns it —
 *  the matcher can never silently ignore a new field and call two distinct
 *  transfers equal [LAW:one-source-of-truth]. (`Extract<…, string>` drops the
 *  phantom nominal brand, which carries no comparable data.) */
type _TransferFieldsAllCompared = Assert<
  [Exclude<Extract<keyof Transfer, string>, 'from' | 'to' | 'amount'>] extends [never] ? true : false
>;

const sameTransfers = (a: readonly Transfer[], b: readonly Transfer[]): boolean =>
  a.length === b.length &&
  a.every((t, i) => {
    const r = b[i];
    return r !== undefined && sameTransfer(t, r);
  });

/** Exact, total equality of two operations: same reason, same transfers in the
 *  same order. Branded ids compare by `===` and coin amounts by `===` (bigint),
 *  so there is no fuzzy match to leak a near-miss through — every pair is either
 *  the same operation or a conflict, with no third outcome. */
const sameOperation = (request: Operation, recorded: Operation): boolean =>
  request.reason === recorded.reason && sameTransfers(request.transfers, recorded.transfers);

/** Guard: an operation is identified by exactly these fields, and `sameOperation`
 *  compares exactly these. A new identity-bearing field on the kernel transaction
 *  widens `keyof Operation` and breaks this build until `sameOperation` learns to
 *  compare it — closing the enumeration gap where an unchecked field would let a
 *  genuinely different movement pass as a replay and return a wrong receipt for
 *  real money [LAW:no-silent-failure]. */
type _OperationFieldsAllCompared = Assert<
  [Exclude<keyof Operation, 'reason' | 'transfers'>] extends [never] ? true : false
>;

/**
 * The pure idempotency gate: given the request being posted and whatever (if
 * anything) the store already holds under its key, decide whether this is a fresh
 * post, an exact replay, or a conflicting reuse. It computes only — the boundary
 * performs the lookup that produced `prior` and acts on this decision
 * [LAW:effects-at-boundaries]. The key itself is not compared here: `prior` was
 * fetched *by* that key, so it is equal by construction; only the operation behind
 * the key can differ.
 */
export const decideIdempotency = (
  request: Operation,
  prior: Transaction | undefined,
): IdempotencyDecision => {
  if (prior === undefined) return { kind: 'fresh' };
  if (sameOperation(request, prior)) return { kind: 'replay', recorded: prior };
  return {
    kind: 'conflict',
    conflict: {
      kind: 'idempotency-key-reused',
      key: prior.idempotencyKey,
      recordedTransactionId: prior.id,
    },
  };
};
