import type { Clock, Result, Timestamp } from '@crowdship/std';
import { err, ok, timestamp } from '@crowdship/std';
import type { Account } from './account.js';
import type { LogInError, ResetError, SessionError, SignUpError } from './errors.js';
import type { AccountId, Email, RecoveryToken, Secret, SessionToken } from './ids.js';
import type {
  AuthService,
  CredentialStore,
  IdMint,
  LoginGrant,
  RecoveryDelivery,
  SecretMint,
} from './service.js';
import type { Authenticated, Session } from './session.js';
import { isExpired } from './session.js';
import type { AuthStore } from './store.js';
import { InMemoryAuthStore } from './store.js';

/** The injected world the auth service runs against — every effect and store it needs, declared. */
export interface AuthServiceDeps {
  readonly clock: Clock;
  readonly ids: IdMint;
  readonly secrets: SecretMint;
  readonly credentials: CredentialStore;
  readonly delivery: RecoveryDelivery;
  /** Where accounts, sessions, and recoveries live — the one swappable storage axis [LAW:locality-or-seam]. */
  readonly store: AuthStore;
  /** How long a session stays live after login, in milliseconds. */
  readonly sessionTtlMillis: number;
  /** How long a recovery token stays usable after it is requested, in milliseconds. */
  readonly recoveryTtlMillis: number;
}

/**
 * THE implementation of the {@link AuthService} lifecycle — the single home of
 * the security behaviors this platform's identity rests on: one login failure
 * value (no account enumeration), recovery that does not disclose mailbox
 * existence, expiry-as-data, and session invalidation on credential reset. These
 * behaviors live here ONCE and run over any {@link AuthStore}, so the in-memory
 * skeleton and the durable SQLite production store are the same code path with a
 * different store [LAW:single-enforcer]. This is the auth analogue of `Ledger`:
 * the engine is store-agnostic; durability is the store's property, not the
 * service's.
 *
 * Inputs are already-validated domain values (`Email`, `Secret`), not raw
 * strings: parsing untrusted input is the edge's job (a route handler, a
 * Credentials provider's `authorize`), so by the time a call reaches here the
 * trust boundary has already been crossed [LAW:single-enforcer].
 */
export class StandardAuthService implements AuthService {
  readonly #deps: AuthServiceDeps;

  constructor(deps: AuthServiceDeps) {
    this.#deps = deps;
  }

  async signUp(email: Email, secret: Secret): Promise<Result<Account, SignUpError>> {
    if ((await this.#deps.store.accountByEmail(email)) !== undefined) {
      return err({ kind: 'email-taken' });
    }
    const account: Account = {
      id: this.#deps.ids.newAccountId(),
      email,
      createdAt: this.#deps.clock.now(),
    };
    // Set the credential before registering the account, so a failure to store
    // it leaves no orphan identity that nothing can authenticate as.
    await this.#deps.credentials.set(account.id, secret);
    await this.#deps.store.insertAccount(account);
    return ok(account);
  }

  async logIn(email: Email, secret: Secret): Promise<Result<LoginGrant, LogInError>> {
    const account = await this.#deps.store.accountByEmail(email);
    // One failure value whether the account is missing or the secret is wrong
    // [LAW:types-are-the-program]. (A production adapter additionally equalizes
    // timing against a dummy verify; that is the adapter's concern, not the
    // domain's.)
    if (account === undefined) return err({ kind: 'invalid-credentials' });
    const verified = await this.#deps.credentials.verify(account.id, secret);
    if (!verified) return err({ kind: 'invalid-credentials' });
    return ok(await this.#openSession(account));
  }

  async resolveSession(token: SessionToken): Promise<Result<Authenticated, SessionError>> {
    const session = await this.#deps.store.sessionByToken(token);
    if (session === undefined) return err({ kind: 'unknown' });
    if (isExpired(session, this.#deps.clock.now())) {
      await this.#deps.store.deleteSession(token);
      return err({ kind: 'expired' });
    }
    const account = await this.#deps.store.accountById(session.accountId);
    // Accounts are never removed in this lifecycle, so a live session pointing at
    // no account is state corruption, halted loudly rather than papered over
    // [LAW:no-silent-failure].
    if (account === undefined) {
      throw new Error(`identity corruption: session references unknown account: ${session.accountId}`);
    }
    return ok({ account, session });
  }

  logOut(token: SessionToken): Promise<void> {
    return this.#deps.store.deleteSession(token);
  }

  async requestRecovery(email: Email): Promise<void> {
    const account = await this.#deps.store.accountByEmail(email);
    // No account: resolve exactly as if one existed, minting and delivering
    // nothing — the caller cannot tell the mailbox is unregistered.
    if (account === undefined) return;
    const token = this.#deps.secrets.newRecoveryToken();
    await this.#deps.store.putRecovery(token, {
      accountId: account.id,
      expiresAt: this.#after(this.#deps.recoveryTtlMillis),
    });
    await this.#deps.delivery.deliver(email, token);
  }

  async resetCredential(token: RecoveryToken, newSecret: Secret): Promise<Result<void, ResetError>> {
    const recovery = await this.#deps.store.recoveryByToken(token);
    if (recovery === undefined) return err({ kind: 'invalid-or-expired' });
    if (this.#deps.clock.now() >= recovery.expiresAt) {
      await this.#deps.store.deleteRecovery(token);
      return err({ kind: 'invalid-or-expired' });
    }
    await this.#deps.credentials.set(recovery.accountId, newSecret);
    await this.#deps.store.deleteRecovery(token);
    await this.#deps.store.deleteSessionsOf(recovery.accountId);
    return ok(undefined);
  }

  async #openSession(account: Account): Promise<LoginGrant> {
    const session: Session = {
      id: this.#deps.ids.newSessionId(),
      accountId: account.id,
      issuedAt: this.#deps.clock.now(),
      expiresAt: this.#after(this.#deps.sessionTtlMillis),
    };
    const token = this.#deps.secrets.newSessionToken();
    await this.#deps.store.putSession(token, session);
    return { account, session, token };
  }

  /** A timestamp `millis` after now, or a loud failure if the configured span is nonsensical. */
  #after(millis: number): Timestamp {
    const at = timestamp(this.#deps.clock.now() + millis);
    if (!at.ok) {
      throw new Error(`identity misconfiguration: ttl produced an invalid timestamp: ${JSON.stringify(at.error)}`);
    }
    return at.value;
  }
}

/** The deps an in-memory service needs — everything {@link AuthServiceDeps} declares except the store, which is supplied. */
export type InMemoryAuthDeps = Omit<AuthServiceDeps, 'store'>;

/**
 * A {@link StandardAuthService} wired to a fresh {@link InMemoryAuthStore} — the
 * zero-config walking-skeleton/test service. It is the standard engine with the
 * throwaway store baked in; the production wiring instead passes a durable store
 * to {@link StandardAuthService} directly. Keeping this convenience is near-zero
 * carrying cost and keeps the tests and skeleton honest about which store backs
 * them [LAW:carrying-cost].
 */
export class InMemoryAuthService extends StandardAuthService {
  constructor(deps: InMemoryAuthDeps) {
    super({ ...deps, store: new InMemoryAuthStore() });
  }
}
