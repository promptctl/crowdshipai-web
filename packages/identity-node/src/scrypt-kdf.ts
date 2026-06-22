import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { Secret } from '@crowdship/identity';

/**
 * The scrypt key-derivation, isolated as the ONE place a credential secret is
 * turned into a stored hash and the ONE place a presented secret is checked
 * against one [LAW:single-enforcer]. Every credential store — the in-memory map,
 * the SQLite table, a future Postgres adapter — derives and verifies through
 * these functions, so the hashing is identical across all of them and cannot
 * drift; the stores differ only in where the {@link Stored} record lives.
 */

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
 * varies per credential; the output length does not.
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
 * the new cost on the next successful login [LAW:one-source-of-truth]. This is
 * exactly the row a durable store persists: a salt blob, a hash blob, three cost
 * integers.
 */
export interface Stored {
  readonly salt: Buffer;
  readonly hash: Buffer;
  readonly params: ScryptParams;
}

/** Derive a fresh self-describing credential record for a secret: new random salt, hash at `params`. */
export const deriveCredential = async (secret: Secret, params: ScryptParams): Promise<Stored> => {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(secret, salt, KEY_BYTES, { ...params, maxmem: maxmemFor(params) });
  return { salt, hash, params };
};

/** Check a presented secret against a stored record, recomputing at the record's OWN cost; constant-time compare. */
export const verifyCredential = async (secret: Secret, stored: Stored): Promise<boolean> => {
  const candidate = await scryptAsync(secret, stored.salt, KEY_BYTES, {
    ...stored.params,
    maxmem: maxmemFor(stored.params),
  });
  // Both buffers are KEY_BYTES long by construction, so timingSafeEqual cannot
  // throw and the compare reveals nothing through timing.
  return timingSafeEqual(candidate, stored.hash);
};

/** A fixed salt for the work {@link verifyAbsent} performs — its only job is to make scrypt run, never to protect anything. */
const ABSENT_SALT = Buffer.alloc(SALT_BYTES, 0x00);

/**
 * Spend the full cost of a verification that is guaranteed to fail, so an account
 * with NO credential on file takes the same wall-clock time as one with a wrong
 * secret. Without this, "no such credential" returns instantly while a real
 * verify burns scrypt — a timing side channel that re-enables the account
 * enumeration the single login-failure value exists to prevent [LAW:types-are-the-program].
 * Always resolves `false`; the comparison result is discarded, only its cost matters.
 */
export const verifyAbsent = async (secret: Secret, params: ScryptParams): Promise<false> => {
  const candidate = await scryptAsync(secret, ABSENT_SALT, KEY_BYTES, { ...params, maxmem: maxmemFor(params) });
  timingSafeEqual(candidate, candidate);
  return false;
};
