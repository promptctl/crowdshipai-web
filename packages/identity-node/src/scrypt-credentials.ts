import type { AccountId, CredentialStore, Secret } from '@crowdship/identity';
import {
  DEFAULT_SCRYPT_PARAMS,
  deriveCredential,
  verifyAbsent,
  verifyCredential,
  type ScryptParams,
  type Stored,
} from './scrypt-kdf.js';

export { DEFAULT_SCRYPT_PARAMS } from './scrypt-kdf.js';
export type { ScryptParams } from './scrypt-kdf.js';

/**
 * Credential storage backed by scrypt with an in-memory map of records — the
 * test/skeleton {@link CredentialStore}. The HASHING is production-grade (it is
 * the shared {@link deriveCredential}/{@link verifyCredential} KDF, fresh salt
 * per secret, cost stored with the hash, constant-time verify); only the STORAGE
 * is non-durable. `SqliteCredentialStore` is the same KDF over a SQLite table —
 * the `Stored` shape persisted there is exactly what this map holds, so swapping
 * one for the other changes only where the record lives [LAW:locality-or-seam].
 */
export class ScryptCredentialStore implements CredentialStore {
  readonly #byAccount = new Map<AccountId, Stored>();
  readonly #params: ScryptParams;

  constructor(params: ScryptParams = DEFAULT_SCRYPT_PARAMS) {
    this.#params = params;
  }

  async set(id: AccountId, secret: Secret): Promise<void> {
    this.#byAccount.set(id, await deriveCredential(secret, this.#params));
  }

  async verify(id: AccountId, secret: Secret): Promise<boolean> {
    const stored = this.#byAccount.get(id);
    // No credential on file still pays a full scrypt (verifyAbsent), so "no such
    // credential" cannot be told from "wrong secret" by timing — nothing matches,
    // and it takes the same time to say so [LAW:no-defensive-null-guards].
    if (stored === undefined) return verifyAbsent(secret, this.#params);
    return verifyCredential(secret, stored);
  }

  clear(id: AccountId): Promise<void> {
    this.#byAccount.delete(id);
    return Promise.resolve();
  }
}
