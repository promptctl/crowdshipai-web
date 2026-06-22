import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { AccountId, CredentialStore, Secret } from '@crowdship/identity';

const scryptAsync = promisify(scrypt);

const SALT_BYTES = 16;
const KEY_BYTES = 64;

type Stored = { readonly salt: Buffer; readonly hash: Buffer };

/**
 * Credential storage backed by scrypt — a vetted, memory-hard KDF from the Node
 * standard library. We adopt the primitive rather than hand-roll hashing: each
 * secret gets a fresh random salt, and verification is a constant-time compare
 * so a wrong guess leaks no timing signal about how wrong it was.
 *
 * The HASHING here is production-grade; the STORAGE is an in-memory map, the one
 * non-durable part — a database-backed {@link CredentialStore} replaces this
 * behind the same seam when the persistence substrate (platform epic) lands, and
 * nothing else changes [LAW:locality-or-seam]. scrypt's salt+hash output is the
 * full record a durable store would persist; swapping the Map for rows is the
 * only delta. Upgrading scrypt → argon2id is likewise a swap behind this seam.
 */
export class ScryptCredentialStore implements CredentialStore {
  readonly #byAccount = new Map<AccountId, Stored>();

  async set(id: AccountId, secret: Secret): Promise<void> {
    const salt = randomBytes(SALT_BYTES);
    const hash = (await scryptAsync(secret, salt, KEY_BYTES)) as Buffer;
    this.#byAccount.set(id, { salt, hash });
  }

  async verify(id: AccountId, secret: Secret): Promise<boolean> {
    const stored = this.#byAccount.get(id);
    // No credential on file is a real, meaningful answer to "does this secret
    // match?" — nothing matches — not a skipped operation [LAW:no-defensive-null-guards].
    if (stored === undefined) return false;
    const candidate = (await scryptAsync(secret, stored.salt, KEY_BYTES)) as Buffer;
    // Lengths are equal by construction (both KEY_BYTES), so timingSafeEqual is
    // safe to call and the compare reveals nothing through timing.
    return timingSafeEqual(candidate, stored.hash);
  }

  clear(id: AccountId): Promise<void> {
    this.#byAccount.delete(id);
    return Promise.resolve();
  }
}
