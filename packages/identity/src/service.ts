import type { Result } from '@crowdship/std';
import type { Account } from './account.js';
import type { SignUpError, LogInError, SessionError, ResetError, RoleChangeError } from './errors.js';
import type {
  AccountId,
  Email,
  RecoveryToken,
  Secret,
  SessionId,
  SessionToken,
} from './ids.js';
import type { Role } from './roles.js';
import type { Authenticated, Session } from './session.js';

/**
 * The capability of minting opaque internal ids. An id need only be unique, not
 * unguessable — that is what separates it from {@link SecretMint}. Injected, so
 * "generate an id" is not an ambient effect reached for in the middle of logic
 * [LAW:effects-at-boundaries].
 */
export interface IdMint {
  newAccountId(): AccountId;
  newSessionId(): SessionId;
}

/**
 * The capability of minting bearer secrets. Unlike an id, a token guards access,
 * so it MUST be high-entropy and unguessable — a distinct seam from {@link IdMint}
 * precisely so that requirement cannot be lost by reusing an id generator for a
 * token [LAW:decomposition]. The real adapter draws from a CSPRNG; the domain
 * never assumes how.
 */
export interface SecretMint {
  newSessionToken(): SessionToken;
  newRecoveryToken(): RecoveryToken;
}

/**
 * The seam to credential storage — where a secret is hashed and a presented
 * secret is checked against the hash. The platform does NOT hand-roll this; an
 * adopted library (e.g. Auth.js + a password hasher) lives behind it
 * [LAW:effects-at-boundaries]. The domain only ever learns yes/no from `verify`,
 * never the stored material.
 */
export interface CredentialStore {
  set(accountId: AccountId, secret: Secret): Promise<void>;
  verify(accountId: AccountId, secret: Secret): Promise<boolean>;
  /** Forget an account's credential (used when nothing should authenticate as it). */
  clear(accountId: AccountId): Promise<void>;
}

/**
 * The seam that carries a freshly-minted recovery token to its owner, out of
 * band (email, etc.). It is a capability, not return data, because the token
 * must reach the mailbox holder and no one else — surfacing it to the caller of
 * `requestRecovery` would defeat the entire flow [LAW:effects-at-boundaries].
 */
export interface RecoveryDelivery {
  deliver(email: Email, token: RecoveryToken): Promise<void>;
}

/**
 * What a successful login surrenders: the account, the live session, and the
 * bearer `token` the client must keep. The token is present HERE and nowhere
 * else — it is handed over exactly once and thereafter only ever *resolved*, not
 * re-read [LAW:one-source-of-truth for the secret].
 */
export interface LoginGrant {
  readonly account: Account;
  readonly session: Session;
  readonly token: SessionToken;
}

/**
 * The identity seam: the whole account + auth lifecycle as one port
 * [LAW:locality-or-seam]. An in-memory reference implements it for the walking
 * skeleton and tests; the adopted auth library implements the same port for
 * production, and not one caller changes when the implementation is swapped
 * [LAW:single-enforcer for identity].
 *
 * Every method is async because every real implementation is (database, hashing,
 * mail) — modeling it sync now would force a rewrite later, the same reasoning
 * the ledger's `Ledger` seam uses.
 *
 * Inputs are already-validated domain values (`Email`, `Secret`), not raw
 * strings: parsing untrusted input is the constructors' job at the edge, so by
 * the time a call reaches this port the trust boundary has already been crossed
 * [LAW:single-enforcer]. Operations are idempotent where the binding says so
 * (`logOut`, `requestRecovery`).
 */
export interface AuthService {
  /** Register a new identity for a mailbox. Fails only if the mailbox is already taken. */
  signUp(email: Email, secret: Secret): Promise<Result<Account, SignUpError>>;

  /**
   * Authenticate and open a session. The single `invalid-credentials` failure
   * never reveals whether it was the email or the secret that was wrong.
   */
  logIn(email: Email, secret: Secret): Promise<Result<LoginGrant, LogInError>>;

  /** Resolve a bearer token to its principal, or say why it is not live. */
  resolveSession(token: SessionToken): Promise<Result<Authenticated, SessionError>>;

  /** End a session. Idempotent: ending an already-gone session is success, not an error. */
  logOut(token: SessionToken): Promise<void>;

  /**
   * Begin credential recovery for a mailbox. Always resolves the same way
   * whether or not the mailbox is registered — the caller learns nothing about
   * existence [LAW:no-silent-failure does not mean leak]. If the account exists,
   * a one-time token is minted and delivered out of band.
   */
  requestRecovery(email: Email): Promise<void>;

  /**
   * Consume a recovery token to set a new credential. One opaque failure for a
   * token that is wrong, spent, or expired. On success the old credential no
   * longer authenticates.
   */
  resetCredential(token: RecoveryToken, newSecret: Secret): Promise<Result<void, ResetError>>;

  /**
   * Grant a capability to an account, returning the account with its updated
   * roles. Idempotent: granting a role the account already holds succeeds and
   * leaves the role set unchanged. This is how building and recruiting are
   * opted into after signup — the data model says capabilities, so they must be
   * able to change [LAW:one-type-per-behavior]; authorization (who is allowed to
   * grant) is the single auth gate's concern (bb2.5), not this lifecycle call.
   */
  grantRole(accountId: AccountId, role: Role): Promise<Result<Account, RoleChangeError>>;

  /** Revoke a capability, returning the updated account. Idempotent: revoking a role not held succeeds unchanged. */
  revokeRole(accountId: AccountId, role: Role): Promise<Result<Account, RoleChangeError>>;
}
