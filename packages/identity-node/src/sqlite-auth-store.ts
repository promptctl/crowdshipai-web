import type { DatabaseSync } from 'node:sqlite';
import {
  accountId,
  email,
  role,
  roleSet,
  sessionId,
  type Account,
  type AccountId,
  type AuthStore,
  type Email,
  type Recovery,
  type RecoveryToken,
  type RoleSet,
  type Session,
  type SessionToken,
} from '@crowdship/identity';
import { orThrow, reqInt, reqStr } from '@crowdship/node-std';
import { timestamp } from '@crowdship/std';

import { hashToken } from './internal.js';

type Row = Record<string, unknown>;

/**
 * A {@link RoleSet} at rest: the canonical roles joined by commas. Roles are a
 * closed alphanumeric set with no commas, so the delimiter is unambiguous, and
 * the set is already canonical so the stored string is too — one mailbox of
 * capabilities maps to exactly one string [LAW:one-source-of-truth].
 */
const serializeRoles = (roles: RoleSet): string => roles.join(',');

/**
 * Rebuild a {@link RoleSet} from its stored form, halting loudly on any token
 * that is not a known role [LAW:no-silent-failure] — a hand-edited or corrupt
 * row is surfaced, never silently dropped to a smaller set. The empty string
 * (the migration default for legacy rows) is an empty set, not an error.
 */
const parseRoles = (raw: string): RoleSet =>
  roleSet(
    raw
      .split(',')
      .filter((token) => token.length > 0)
      .map((token) => orThrow(role(token), 'accounts.roles')),
  );

/** Rebuild an {@link Account} from its row, halting loudly if the durable record is malformed [LAW:no-silent-failure]. */
const toAccount = (row: Row): Account => ({
  id: orThrow(accountId(reqStr(row, 'id')), 'accounts.id'),
  email: orThrow(email(reqStr(row, 'email')), 'accounts.email'),
  createdAt: orThrow(timestamp(reqInt(row, 'created_at')), 'accounts.created_at'),
  roles: parseRoles(reqStr(row, 'roles')),
});

const toSession = (row: Row): Session => ({
  id: orThrow(sessionId(reqStr(row, 'id')), 'sessions.id'),
  accountId: orThrow(accountId(reqStr(row, 'account_id')), 'sessions.account_id'),
  issuedAt: orThrow(timestamp(reqInt(row, 'issued_at')), 'sessions.issued_at'),
  expiresAt: orThrow(timestamp(reqInt(row, 'expires_at')), 'sessions.expires_at'),
});

const toRecovery = (row: Row): Recovery => ({
  accountId: orThrow(accountId(reqStr(row, 'account_id')), 'recoveries.account_id'),
  expiresAt: orThrow(timestamp(reqInt(row, 'expires_at')), 'recoveries.expires_at'),
});

/**
 * The durable {@link AuthStore}: accounts, sessions, and recoveries persisted in
 * SQLite. It is pure storage — every security behavior stays in `StandardAuthService`
 * above the seam, so this store and the in-memory one are interchangeable and the
 * money-critical login/recovery logic cannot drift between them [LAW:single-enforcer].
 *
 * Bearer tokens are keyed by {@link hashToken}, never stored raw: a leak of this
 * database exposes no usable session or recovery token. The `accounts.email`
 * UNIQUE constraint is a loud backstop — the service has already decided the
 * email is free, but if two writers ever raced past that check the insert throws
 * rather than silently minting a second account for one mailbox [LAW:no-silent-failure].
 */
export class SqliteAuthStore implements AuthStore {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  insertAccount(account: Account): Promise<void> {
    this.#db
      .prepare('INSERT INTO accounts (id, email, created_at, roles) VALUES (?, ?, ?, ?)')
      .run(account.id, account.email, account.createdAt, serializeRoles(account.roles));
    return Promise.resolve();
  }

  accountByEmail(address: Email): Promise<Account | undefined> {
    const row = this.#db.prepare('SELECT id, email, created_at, roles FROM accounts WHERE email = ?').get(address);
    return Promise.resolve(row === undefined ? undefined : toAccount(row));
  }

  accountById(id: AccountId): Promise<Account | undefined> {
    const row = this.#db.prepare('SELECT id, email, created_at, roles FROM accounts WHERE id = ?').get(id);
    return Promise.resolve(row === undefined ? undefined : toAccount(row));
  }

  updateRoles(id: AccountId, roles: RoleSet): Promise<void> {
    // A row-targeted UPDATE: an absent account changes nothing rather than
    // creating one, the same precondition the in-memory store honors. The
    // service guarantees existence before calling.
    this.#db.prepare('UPDATE accounts SET roles = ? WHERE id = ?').run(serializeRoles(roles), id);
    return Promise.resolve();
  }

  putSession(token: SessionToken, session: Session): Promise<void> {
    this.#db
      .prepare('INSERT INTO sessions (token_hash, id, account_id, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(hashToken(token), session.id, session.accountId, session.issuedAt, session.expiresAt);
    return Promise.resolve();
  }

  sessionByToken(token: SessionToken): Promise<Session | undefined> {
    const row = this.#db
      .prepare('SELECT id, account_id, issued_at, expires_at FROM sessions WHERE token_hash = ?')
      .get(hashToken(token));
    return Promise.resolve(row === undefined ? undefined : toSession(row));
  }

  deleteSession(token: SessionToken): Promise<void> {
    this.#db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    return Promise.resolve();
  }

  deleteSessionsOf(account: AccountId): Promise<void> {
    this.#db.prepare('DELETE FROM sessions WHERE account_id = ?').run(account);
    return Promise.resolve();
  }

  putRecovery(token: RecoveryToken, recovery: Recovery): Promise<void> {
    this.#db
      .prepare('INSERT INTO recoveries (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
      .run(hashToken(token), recovery.accountId, recovery.expiresAt);
    return Promise.resolve();
  }

  recoveryByToken(token: RecoveryToken): Promise<Recovery | undefined> {
    const row = this.#db
      .prepare('SELECT account_id, expires_at FROM recoveries WHERE token_hash = ?')
      .get(hashToken(token));
    return Promise.resolve(row === undefined ? undefined : toRecovery(row));
  }

  deleteRecovery(token: RecoveryToken): Promise<void> {
    this.#db.prepare('DELETE FROM recoveries WHERE token_hash = ?').run(hashToken(token));
    return Promise.resolve();
  }
}
