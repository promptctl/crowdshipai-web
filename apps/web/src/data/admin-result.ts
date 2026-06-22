import type { VerificationStatus } from '@crowdship/identity';

/**
 * What a staff console learns after acting — the platform-authority twin of
 * `buy-result.ts`. A server action returns these across the network boundary, so
 * each arm carries only serializable primitives, never a domain handle. Every arm is
 * a DISTINCT outcome the surface must render differently: the two authorization
 * refusals (`must-authenticate`, `forbidden`) are never folded into the input-shape
 * refusals, because conflating "you are not allowed" with "that handle is malformed"
 * would tell a staff member the wrong thing to fix [LAW:no-silent-failure].
 *
 * `forbidden` deliberately carries no detail: a non-staff caller learns only that the
 * action is not theirs, never whether the channel or account exists — the gate leaks
 * nothing about the resources behind it.
 */

/** The outcome of setting a channel's verification tier. */
export type VerifyResult =
  /** The tier was set; the channel now carries `status`. */
  | { readonly kind: 'set'; readonly handle: string; readonly status: VerificationStatus }
  /** No channel holds that handle — nothing to verify. */
  | { readonly kind: 'no-such-channel'; readonly handle: string }
  /** The handle was not a well-formed handle. */
  | { readonly kind: 'invalid-handle' }
  /** The tier was not one of the known verification statuses. */
  | { readonly kind: 'invalid-status' }
  /** A live session without platform authority — the staff gate refused. */
  | { readonly kind: 'forbidden' }
  /** No live session — the request carried no principal to authorize. */
  | { readonly kind: 'must-authenticate' };

/** The outcome of imposing a sanction (ban/suspension) on an account. */
export type SanctionResult =
  /** The sanction was recorded against the account and now governs its conduct standing. */
  | { readonly kind: 'sanctioned'; readonly account: string; readonly scope: 'permanent' | 'until' }
  /** The account id was blank — no account to sanction. */
  | { readonly kind: 'invalid-account' }
  /** The reason was blank — a sanction the actor cannot understand is a silent one. */
  | { readonly kind: 'invalid-reason' }
  /** A timed suspension whose duration was not a positive whole number of days. */
  | { readonly kind: 'invalid-scope' }
  /** A live session without platform authority — the staff gate refused. */
  | { readonly kind: 'forbidden' }
  /** No live session — the request carried no principal to authorize. */
  | { readonly kind: 'must-authenticate' };
