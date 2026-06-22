import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { AccountId, CredentialStore, Secret } from '@crowdship/identity';

/**
 * Promisified scrypt over the OPTIONS-taking callback overload. `promisify` binds
 * to the no-options overload, so it cannot pass cost params — this wrapper can,
 * and surfaces a KDF error by rejecting rather than swallowing it [LAW:no-silent-failure].
 */
const scryptAsync = (secret: Secret, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(secret, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });

const SALT_BYTES = 16;
/**
 * Fixed for ALL credentials, never per-record: it is what guarantees a freshly
 * computed candidate and the stored hash are the same length, so `timingSafeEqual`
 * can never throw on a mismatch [LAW:types-are-the-program]. Only the *cost*
 * varies per credential (below); the output length does not.
 */
const KEY_BYTES = 64;

/** The scrypt cost of one hash. CPU/memory hardness; not secret. */
export interface ScryptParams {
  readonly N: number;
  readonly r: number;
  readonly p: number;
}

/** OWASP-recommended scrypt minimum (2025): N=2^17, r=8, p=1. Secure by default; override down only for tests. */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { N: 2 ** 17, r: 8, p: 1 };

// scrypt needs roughly 128*N*r*p bytes and Node throws if maxmem is too low, so
// maxmem must rise WITH the cost — derived here with headroom rather than left at
// Node's 32MB default, which a stronger N would silently blow past.
const maxmemFor = (params: ScryptParams): number =>
  Math.max(32 * 1024 * 1024, 128 * params.N * params.r * params.p * 2);

/**
 * A credential record that DESCRIBES ITSELF: the salt, the hash, and the exact
 * cost used to make it. Verification recomputes with the record's own params, so
 * raising {@link DEFAULT_SCRYPT_PARAMS} never invalidates existing hashes — old
 * records keep verifying at their old cost and can be transparently rehashed at
 * the new cost on the next successful login [LAW:one-source-of-truth].
 */
type Stored = { readonly salt: Buffer; readonly hash: Buffer; readonly params: ScryptParams };

/**
 * Credential storage backed by scrypt — a vetted, memory-hard KDF from the Node
 * standard library. We adopt the primitive rather than hand-roll hashing: each
 * secret gets a fresh random salt, the cost is configurable (and stored with the
 * hash), and verification is a constant-time compare so a wrong guess leaks no
 * timing signal about how wrong it was.
 *
 * The HASHING here is production-grade; the STORAGE is an in-memory map, the one
 * non-durable part — a database-backed {@link CredentialStore} replaces this
 * behind the same seam when the persistence substrate (platform epic) lands, and
 * nothing else changes [LAW:locality-or-seam]. The `Stored` shape is exactly the
 * record a durable store would persist; swapping the Map for rows is the only
 * delta. Upgrading scrypt → argon2id is likewise a swap behind this seam.
 */
export class ScryptCredentialStore implements CredentialStore {
  readonly #byAccount = new Map<AccountId, Stored>();
  readonly #params: ScryptParams;

  constructor(params: ScryptParams = DEFAULT_SCRYPT_PARAMS) {
    this.#params = params;
  }

  async set(id: AccountId, secret: Secret): Promise<void> {
    const params = this.#params;
    const salt = randomBytes(SALT_BYTES);
    const hash = await scryptAsync(secret, salt, KEY_BYTES, { ...params, maxmem: maxmemFor(params) });
    this.#byAccount.set(id, { salt, hash, params });
  }

  async verify(id: AccountId, secret: Secret): Promise<boolean> {
    const stored = this.#byAccount.get(id);
    // No credential on file is a real, meaningful answer to "does this secret
    // match?" — nothing matches — not a skipped operation [LAW:no-defensive-null-guards].
    if (stored === undefined) return false;
    // Verify against the record's OWN params, not the current default — so a
    // hash made at an older cost still verifies after the default is raised.
    const candidate = await scryptAsync(secret, stored.salt, KEY_BYTES, {
      ...stored.params,
      maxmem: maxmemFor(stored.params),
    });
    // Both buffers are KEY_BYTES long by construction, so timingSafeEqual cannot
    // throw and the compare reveals nothing through timing.
    return timingSafeEqual(candidate, stored.hash);
  }

  clear(id: AccountId): Promise<void> {
    this.#byAccount.delete(id);
    return Promise.resolve();
  }
}
