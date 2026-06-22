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

/** The injected world the reference service runs against — every effect it needs, declared. */
export interface InMemoryAuthDeps {
  readonly clock: Clock;
  readonly ids: IdMint;
  readonly secrets: SecretMint;
  readonly credentials: CredentialStore;
  readonly delivery: RecoveryDelivery;
  /** How long a session stays live after login, in milliseconds. */
  readonly sessionTtlMillis: number;
  /** How long a recovery token stays usable after it is requested, in milliseconds. */
  readonly recoveryTtlMillis: number;
}

type Recovery = { readonly accountId: AccountId; readonly expiresAt: Timestamp };

/**
 * The reference {@link AuthService}: an in-memory account registry, session
 * table, and recovery table. It is the walking-skeleton implementation — the
 * adopted auth library (e.g. Auth.js) implements the same port for production
 * and swaps in behind it unchanged.
 *
 * NOT FOR PRODUCTION as the holder of real secrets: it stores sessions keyed by
 * the bearer token and recoveries by the recovery token directly, where a real
 * adapter would store only a hash. That simplification is safe ONLY because this
 * impl never holds real user secrets — it exists for tests and the local
 * skeleton. The security *behaviors* it does model are real and load-bearing:
 * single-failure login (no account enumeration), expiry as data, and session
 * invalidation on credential reset.
 *
 * The `#accounts` map is the authoritative registry; `#idByEmail` is a derived
 * index into it and never a second source of truth [LAW:one-source-of-truth].
 */
export class InMemoryAuthService implements AuthService {
  readonly #accounts = new Map<AccountId, Account>();
  readonly #idByEmail = new Map<Email, AccountId>();
  readonly #sessionsByToken = new Map<SessionToken, Session>();
  readonly #recoveries = new Map<RecoveryToken, Recovery>();
  readonly #deps: InMemoryAuthDeps;

  constructor(deps: InMemoryAuthDeps) {
    this.#deps = deps;
  }

  async signUp(email: Email, secret: Secret): Promise<Result<Account, SignUpError>> {
    if (this.#idByEmail.has(email)) return err({ kind: 'email-taken' });
    const id = this.#deps.ids.newAccountId();
    const account: Account = { id, email, createdAt: this.#deps.clock.now() };
    // Set the credential before registering the account, so a failure to store
    // it leaves no orphan identity that nothing can authenticate as.
    await this.#deps.credentials.set(id, secret);
    this.#accounts.set(id, account);
    this.#idByEmail.set(email, id);
    return ok(account);
  }

  async logIn(email: Email, secret: Secret): Promise<Result<LoginGrant, LogInError>> {
    const id = this.#idByEmail.get(email);
    const account = id === undefined ? undefined : this.#accounts.get(id);
    // One failure value whether the account is missing or the secret is wrong
    // [LAW:types-are-the-program]. (A production adapter additionally equalizes
    // timing against a dummy verify; that is the adapter's concern, not the
    // domain's.)
    if (account === undefined) return err({ kind: 'invalid-credentials' });
    const verified = await this.#deps.credentials.verify(account.id, secret);
    if (!verified) return err({ kind: 'invalid-credentials' });
    const grant = this.#openSession(account);
    return ok(grant);
  }

  resolveSession(token: SessionToken): Promise<Result<Authenticated, SessionError>> {
    const session = this.#sessionsByToken.get(token);
    if (session === undefined) return Promise.resolve(err({ kind: 'unknown' }));
    if (isExpired(session, this.#deps.clock.now())) {
      this.#sessionsByToken.delete(token);
      return Promise.resolve(err({ kind: 'expired' }));
    }
    const account = this.#accounts.get(session.accountId);
    // Accounts are never removed in this lifecycle, so a live session pointing at
    // no account is state corruption, halted loudly rather than papered over
    // [LAW:no-silent-failure].
    if (account === undefined) {
      throw new Error(`identity corruption: session references unknown account: ${session.accountId}`);
    }
    return Promise.resolve(ok({ account, session }));
  }

  logOut(token: SessionToken): Promise<void> {
    this.#sessionsByToken.delete(token);
    return Promise.resolve();
  }

  async requestRecovery(email: Email): Promise<void> {
    const id = this.#idByEmail.get(email);
    // No account: resolve exactly as if one existed, minting and delivering
    // nothing — the caller cannot tell the mailbox is unregistered.
    if (id === undefined) return;
    const token = this.#deps.secrets.newRecoveryToken();
    const expiresAt = this.#after(this.#deps.recoveryTtlMillis);
    this.#recoveries.set(token, { accountId: id, expiresAt });
    await this.#deps.delivery.deliver(email, token);
  }

  async resetCredential(token: RecoveryToken, newSecret: Secret): Promise<Result<void, ResetError>> {
    const recovery = this.#recoveries.get(token);
    if (recovery === undefined) return err({ kind: 'invalid-or-expired' });
    if (this.#deps.clock.now() >= recovery.expiresAt) {
      this.#recoveries.delete(token);
      return err({ kind: 'invalid-or-expired' });
    }
    await this.#deps.credentials.set(recovery.accountId, newSecret);
    this.#recoveries.delete(token);
    this.#invalidateSessionsOf(recovery.accountId);
    return ok(undefined);
  }

  #openSession(account: Account): LoginGrant {
    const issuedAt = this.#deps.clock.now();
    const session: Session = {
      id: this.#deps.ids.newSessionId(),
      accountId: account.id,
      issuedAt,
      expiresAt: this.#after(this.#deps.sessionTtlMillis),
    };
    const token = this.#deps.secrets.newSessionToken();
    this.#sessionsByToken.set(token, session);
    return { account, session, token };
  }

  #invalidateSessionsOf(accountId: AccountId): void {
    for (const [token, session] of this.#sessionsByToken) {
      if (session.accountId === accountId) this.#sessionsByToken.delete(token);
    }
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
