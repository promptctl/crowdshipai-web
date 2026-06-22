/**
 * The named ways each lifecycle operation can fail. Every one is a value the
 * caller must destructure [LAW:no-silent-failure]; the security-shaped choices
 * are encoded here, in the type, not left to a careful implementer.
 */
import type { HandleReservation } from './handle-policy.js';

/** Signup fails only because the mailbox is already an identity. */
export type SignUpError = { readonly kind: 'email-taken' };

/**
 * Login has exactly ONE failure value on purpose. "No such account" and "wrong
 * secret" are deliberately indistinguishable so the boundary cannot be used to
 * enumerate which emails are registered. Making them one variant means a future
 * implementer *cannot* accidentally leak the difference [LAW:types-are-the-program].
 */
export type LogInError = { readonly kind: 'invalid-credentials' };

/** Resolving or ending a session fails because the token names no live session, or names an expired one. */
export type SessionError = { readonly kind: 'unknown' } | { readonly kind: 'expired' };

/**
 * A credential reset fails as one opaque value: a token that is wrong, already
 * spent, or expired are not distinguished — same anti-enumeration reasoning as
 * {@link LogInError}.
 */
export type ResetError = { readonly kind: 'invalid-or-expired' };

/**
 * Granting or revoking a capability can fail only because the account does not
 * exist — the role value itself cannot be wrong, since `Role` is a closed type
 * the caller could not have constructed an illegal member of [LAW:types-are-the-program].
 */
export type RoleChangeError = { readonly kind: 'no-such-account' };

/**
 * Claiming a builder channel fails as exactly one of these named values: the
 * desired handle is reserved against public claiming (impersonation policy), it is
 * already someone's, the claiming account already holds a channel (one channel per
 * account, for now), or the account does not exist. The handle value itself cannot
 * be malformed here — `Handle` is constructed at the edge, so by the time a claim
 * is attempted that *shape* trust boundary is already crossed [LAW:single-enforcer];
 * `handle-reserved` is the distinct *policy* boundary, carrying the reason so the
 * edge can tell the builder which authority/brand term it collided with.
 */
export type ClaimError =
  | { readonly kind: 'handle-reserved'; readonly reservation: HandleReservation }
  | { readonly kind: 'handle-taken' }
  | { readonly kind: 'already-has-channel' }
  | { readonly kind: 'no-such-account' };

/** Renaming a channel fails because the target handle is reserved or taken, or the channel does not exist. */
export type RenameError =
  | { readonly kind: 'handle-reserved'; readonly reservation: HandleReservation }
  | { readonly kind: 'handle-taken' }
  | { readonly kind: 'no-such-channel' };

/** Editing a channel's profile fails only because the channel does not exist. */
export type EditProfileError = { readonly kind: 'no-such-channel' };

/**
 * Setting a channel's verification status fails only because the channel does not
 * exist — the status value itself cannot be wrong, since `VerificationStatus` is a
 * closed type the caller could not have constructed an illegal member of
 * [LAW:types-are-the-program]. The same shape as {@link RoleChangeError}.
 */
export type VerificationError = { readonly kind: 'no-such-channel' };
