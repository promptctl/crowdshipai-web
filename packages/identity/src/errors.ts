/**
 * The named ways each lifecycle operation can fail. Every one is a value the
 * caller must destructure [LAW:no-silent-failure]; the security-shaped choices
 * are encoded here, in the type, not left to a careful implementer.
 */

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
