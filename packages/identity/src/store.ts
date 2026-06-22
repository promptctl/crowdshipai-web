import type { Timestamp } from '@crowdship/std';
import type { Account } from './account.js';
import type { AccountId, Email, RecoveryToken, SessionToken } from './ids.js';
import type { RoleSet } from './roles.js';
import type { Session } from './session.js';

/**
 * A pending one-time credential-reset grant: which account it resets and when it
 * lapses. The token that names it is the map key in the store, never a field
 * here — same shape as a {@link Session}, which is what a {@link SessionToken}
 * resolves *to* [LAW:effects-at-boundaries].
 */
export interface Recovery {
  readonly accountId: AccountId;
  readonly expiresAt: Timestamp;
}

/**
 * Persistence for the identity lifecycle, expressed as the smallest seam the auth
 * logic needs [LAW:locality-or-seam] — and the ONLY axis along which storage
 * varies. The security behaviors (single-failure login, expiry-as-data, session
 * invalidation on reset, no account enumeration) live once in the service above
 * this seam; an in-memory map and a durable SQLite table are two *stores*, never
 * two services, so those money-critical behaviors can never drift between
 * implementations [LAW:single-enforcer]. This is the auth analogue of the ledger's
 * persistence seam.
 *
 * Three records, one concern. The account registry is the authoritative record
 * of which identities exist; lookup-by-email is a derived index into it the store
 * owns, never a second source of truth [LAW:one-source-of-truth]. The session and
 * recovery tables are keyed by their bearer token — the value the holder presents
 * — and the store decides how that key is stored at rest (raw in memory, hashed
 * in a durable adapter); the seam only ever passes the token itself.
 *
 * Every method is async so a real database or network store sits behind this seam
 * unchanged [LAW:effects-at-boundaries]. Write serialization is owned by the
 * boundary above (the auth service runs one lifecycle call at a time per the
 * walking skeleton), so a store need not guard its own read-modify-write
 * [LAW:no-ambient-temporal-coupling]; a durable adapter may additionally enforce
 * uniqueness as a loud backstop, never a silent one [LAW:no-silent-failure].
 */
export interface AuthStore {
  /**
   * Record a new account. The caller has already established the email is free
   * (that decision is the service's, made once); a store MAY enforce uniqueness
   * as a backstop, but does so by failing loudly, never by silently overwriting.
   */
  insertAccount(account: Account): Promise<void>;
  accountByEmail(email: Email): Promise<Account | undefined>;
  accountById(id: AccountId): Promise<Account | undefined>;
  /**
   * Replace an account's capabilities. A deliberately narrow seam — `roles` is
   * the one mutable axis of an account, so the store exposes updating *only* it,
   * never a general account overwrite that could silently mutate the email or
   * creation time [LAW:locality-or-seam]. Updating the roles of an account that
   * does not exist is the caller's precondition to check (the service does);
   * a store MAY no-op or backstop, never silently create one.
   */
  updateRoles(id: AccountId, roles: RoleSet): Promise<void>;

  putSession(token: SessionToken, session: Session): Promise<void>;
  sessionByToken(token: SessionToken): Promise<Session | undefined>;
  deleteSession(token: SessionToken): Promise<void>;
  /** Drop every session of one account at once — the credential-reset invalidation. */
  deleteSessionsOf(accountId: AccountId): Promise<void>;

  putRecovery(token: RecoveryToken, recovery: Recovery): Promise<void>;
  recoveryByToken(token: RecoveryToken): Promise<Recovery | undefined>;
  deleteRecovery(token: RecoveryToken): Promise<void>;
}

/**
 * The reference {@link AuthStore}: in-memory account registry, session table, and
 * recovery table. It is the walking-skeleton/test implementation; a durable store
 * (e.g. the SQLite adapter in `@crowdship/identity-node`) swaps in behind the same
 * seam without touching the auth service.
 *
 * `#accounts` is the authoritative registry; `#idByEmail` is a derived index into
 * it and never a second source of truth [LAW:one-source-of-truth]. Storing the raw
 * bearer token as the session/recovery key is safe ONLY because this map never
 * leaves memory — a durable adapter stores a hash of the token instead.
 */
export class InMemoryAuthStore implements AuthStore {
  readonly #accounts = new Map<AccountId, Account>();
  readonly #idByEmail = new Map<Email, AccountId>();
  readonly #sessions = new Map<SessionToken, Session>();
  readonly #recoveries = new Map<RecoveryToken, Recovery>();

  insertAccount(account: Account): Promise<void> {
    this.#accounts.set(account.id, account);
    this.#idByEmail.set(account.email, account.id);
    return Promise.resolve();
  }

  accountByEmail(email: Email): Promise<Account | undefined> {
    const id = this.#idByEmail.get(email);
    return Promise.resolve(id === undefined ? undefined : this.#accounts.get(id));
  }

  accountById(id: AccountId): Promise<Account | undefined> {
    return Promise.resolve(this.#accounts.get(id));
  }

  updateRoles(id: AccountId, roles: RoleSet): Promise<void> {
    const account = this.#accounts.get(id);
    // The service has already established the account exists; a missing one here
    // is a no-op rather than a silently-minted account [LAW:no-silent-failure].
    if (account !== undefined) this.#accounts.set(id, { ...account, roles });
    return Promise.resolve();
  }

  putSession(token: SessionToken, session: Session): Promise<void> {
    this.#sessions.set(token, session);
    return Promise.resolve();
  }

  sessionByToken(token: SessionToken): Promise<Session | undefined> {
    return Promise.resolve(this.#sessions.get(token));
  }

  deleteSession(token: SessionToken): Promise<void> {
    this.#sessions.delete(token);
    return Promise.resolve();
  }

  deleteSessionsOf(accountId: AccountId): Promise<void> {
    for (const [token, session] of this.#sessions) {
      if (session.accountId === accountId) this.#sessions.delete(token);
    }
    return Promise.resolve();
  }

  putRecovery(token: RecoveryToken, recovery: Recovery): Promise<void> {
    this.#recoveries.set(token, recovery);
    return Promise.resolve();
  }

  recoveryByToken(token: RecoveryToken): Promise<Recovery | undefined> {
    return Promise.resolve(this.#recoveries.get(token));
  }

  deleteRecovery(token: RecoveryToken): Promise<void> {
    this.#recoveries.delete(token);
    return Promise.resolve();
  }
}
