import type { Brand, Result } from '@crowdship/std';
import { err, ok } from '@crowdship/std';

/** The stable internal identity of an account. Opaque; minted, never parsed. */
export type AccountId = Brand<string, 'AccountId'>;

/** The internal id of one session. Opaque; minted, never parsed. */
export type SessionId = Brand<string, 'SessionId'>;

/**
 * The bearer secret a client presents to prove a session. The domain carries it
 * as an opaque string and NEVER inspects, parses, or derives meaning from it
 * [LAW:effects-at-boundaries] — minting and verifying live behind the
 * `TokenMint` / store seam (the adopted auth library), not here.
 */
export type SessionToken = Brand<string, 'SessionToken'>;

/** The one-time bearer secret that authorizes a credential reset. Opaque, like a session token. */
export type RecoveryToken = Brand<string, 'RecoveryToken'>;

/**
 * A user-supplied credential secret (e.g. a password) crossing the trust
 * boundary. The domain never stores or compares it — it hands it to the
 * `CredentialStore` seam, where hashing happens [LAW:effects-at-boundaries]. The
 * only invariant enforced here is non-emptiness; strength policy is the adapter's.
 */
export type Secret = Brand<string, 'Secret'>;

/**
 * A canonical email address. `Email` is the login identity, so it is stored in a
 * single canonical form — trimmed and lowercased — to make "the same mailbox"
 * one value, not several that differ only by case [LAW:one-source-of-truth].
 * This canonicalization is defined behavior surfaced by the constructor, not a
 * silent mutation of a key.
 */
export type Email = Brand<string, 'Email'>;

export type BlankError = { readonly kind: 'blank'; readonly label: string };

const nonBlank = <B extends string>(label: string, raw: string): Result<Brand<string, B>, BlankError> =>
  raw.trim().length > 0 ? ok(raw as Brand<string, B>) : err({ kind: 'blank', label });

export const accountId = (raw: string): Result<AccountId, BlankError> =>
  nonBlank<'AccountId'>('accountId', raw);
export const sessionId = (raw: string): Result<SessionId, BlankError> =>
  nonBlank<'SessionId'>('sessionId', raw);
export const sessionToken = (raw: string): Result<SessionToken, BlankError> =>
  nonBlank<'SessionToken'>('sessionToken', raw);
export const recoveryToken = (raw: string): Result<RecoveryToken, BlankError> =>
  nonBlank<'RecoveryToken'>('recoveryToken', raw);

export type SecretError = BlankError | { readonly kind: 'too-long'; readonly max: number };

/**
 * No legitimate credential approaches this length; the cap is a trust-boundary
 * rejection of input whose only purpose is to feed an oversized buffer to the
 * KDF and amplify CPU cost [LAW:single-enforcer]. Enforced HERE, at the one
 * constructor that mints a `Secret`, so no downstream code must re-check it.
 */
const MAX_SECRET_LENGTH = 1024;

export const secret = (raw: string): Result<Secret, SecretError> => {
  // The value is preserved untrimmed — leading/trailing spaces are legitimate in
  // a password; only an all-whitespace value is blank.
  if (raw.trim().length === 0) return err({ kind: 'blank', label: 'secret' });
  if (raw.length > MAX_SECRET_LENGTH) return err({ kind: 'too-long', max: MAX_SECRET_LENGTH });
  return ok(raw as Secret);
};

export type EmailError =
  | { readonly kind: 'blank' }
  | { readonly kind: 'malformed'; readonly value: string };

/**
 * Accept an address only when it has the shape `local@domain` with both parts
 * non-empty, a dotted domain, and no internal whitespace. This is the trust
 * boundary's deliberately *permissive* gate — it rejects the obviously-not-an-
 * email, not every RFC edge case; deliverability is proven by the recovery/
 * verification flow, not by a regex [LAW:no-silent-failure] (we never quietly
 * "fix" a bad address into a different one).
 */
export const email = (raw: string): Result<Email, EmailError> => {
  const canonical = raw.trim().toLowerCase();
  if (canonical.length === 0) return err({ kind: 'blank' });
  const at = canonical.indexOf('@');
  const local = canonical.slice(0, at);
  const domain = canonical.slice(at + 1);
  // A dotted domain whose every label is non-empty: this single rule rejects a
  // leading dot, a trailing dot, AND an interior empty label (`b..com`) — the
  // gaps a start/end check leaves open [LAW:types-are-the-program].
  const domainLabels = domain.split('.');
  const wellShaped =
    at > 0 &&
    canonical.indexOf('@', at + 1) === -1 &&
    local.length > 0 &&
    domainLabels.length >= 2 &&
    domainLabels.every((label) => label.length > 0) &&
    !/\s/.test(canonical);
  return wellShaped ? ok(canonical as Email) : err({ kind: 'malformed', value: raw });
};
