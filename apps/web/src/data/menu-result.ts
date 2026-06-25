import type { MenuProblems } from '@crowdship/menu';

/**
 * The outcome of a builder authoring their menu, as a closed union the form matches
 * exhaustively [LAW:dataflow-not-control-flow] — the menu twin of `ClaimResult`. Every
 * way the submission can be refused is its OWN arm carrying its own reason, never a
 * single "couldn't save" that hides which input to fix [LAW:no-silent-failure]:
 *
 * - `saved` — the menu was authored and persisted; `count` is how many offers it holds.
 * - `must-authenticate` — no session; you cannot author a menu as no one.
 * - `no-channel` — a signed-in account that has not claimed a channel has nothing to
 *   author a menu against; claim first.
 * - `malformed-submission` — the form payload itself was not a well-formed list of
 *   offers (a tampered or broken client; the real form can only ever submit valid
 *   JSON). The failure is surfaced through this arm rather than thrown, so it flows
 *   through the same outcome channel every other refusal does and the form renders it
 *   [LAW:dataflow-not-control-flow] — loud, never swallowed into an empty menu that
 *   would wipe the builder's real one [LAW:no-silent-failure].
 * - `invalid-prices` — one or more prices were not whole numbers, located by position.
 *   This is the edge's string→number trust boundary, distinct from the domain's
 *   non-positive check, so the form can say exactly "that price is not a number".
 * - `invalid` — the menu domain's own authoring boundary rejected the submission; the
 *   {@link MenuProblems} are forwarded verbatim (field faults, duplicate ids, the
 *   guardrail cap) so every fault shows at once, never collapsed [LAW:no-silent-failure].
 *
 * Every arm is plain serializable data, so it crosses the server-action boundary back
 * to the form unchanged.
 */
export type MenuAuthorResult =
  | { readonly kind: 'saved'; readonly count: number }
  | { readonly kind: 'must-authenticate' }
  | { readonly kind: 'no-channel' }
  | { readonly kind: 'malformed-submission' }
  | { readonly kind: 'invalid-prices'; readonly at: readonly number[] }
  | { readonly kind: 'invalid'; readonly problems: MenuProblems };
