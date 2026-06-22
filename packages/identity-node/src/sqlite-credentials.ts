import type { DatabaseSync } from 'node:sqlite';
import type { AccountId, CredentialStore, Secret } from '@crowdship/identity';
import { reqBytes, reqInt } from './internal.js';
import {
  DEFAULT_SCRYPT_PARAMS,
  deriveCredential,
  verifyCredential,
  type ScryptParams,
  type Stored,
} from './scrypt-kdf.js';

/**
 * The durable {@link CredentialStore}: the SAME scrypt KDF as the in-memory store
 * ({@link deriveCredential}/{@link verifyCredential}), persisting each
 * self-describing {@link Stored} record as a row instead of a map entry. Hashing
 * is identical to every other credential store by construction [LAW:single-enforcer];
 * the only difference is where the salt, hash, and cost live. Takes a shared
 * database handle from {@link openIdentityDb} so all identity state is one file.
 */
export class SqliteCredentialStore implements CredentialStore {
  readonly #db: DatabaseSync;
  readonly #params: ScryptParams;

  constructor(db: DatabaseSync, params: ScryptParams = DEFAULT_SCRYPT_PARAMS) {
    this.#db = db;
    this.#params = params;
  }

  async set(id: AccountId, secret: Secret): Promise<void> {
    const stored = await deriveCredential(secret, this.#params);
    // Re-setting a credential (signup re-run, password reset) replaces the record
    // with a fresh salt; the upsert makes that one atomic write, not a delete+insert.
    this.#db
      .prepare(
        `INSERT INTO credentials (account_id, salt, hash, n, r, p) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET
           salt = excluded.salt, hash = excluded.hash, n = excluded.n, r = excluded.r, p = excluded.p`,
      )
      .run(id, stored.salt, stored.hash, stored.params.N, stored.params.r, stored.params.p);
  }

  verify(id: AccountId, secret: Secret): Promise<boolean> {
    const row = this.#db
      .prepare('SELECT salt, hash, n, r, p FROM credentials WHERE account_id = ?')
      .get(id);
    // No credential on file is a real answer — nothing matches — not a skipped op
    // [LAW:no-defensive-null-guards].
    if (row === undefined) return Promise.resolve(false);
    const stored: Stored = {
      salt: reqBytes(row, 'salt'),
      hash: reqBytes(row, 'hash'),
      params: { N: reqInt(row, 'n'), r: reqInt(row, 'r'), p: reqInt(row, 'p') },
    };
    return verifyCredential(secret, stored);
  }

  clear(id: AccountId): Promise<void> {
    this.#db.prepare('DELETE FROM credentials WHERE account_id = ?').run(id);
    return Promise.resolve();
  }
}
