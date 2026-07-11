import { describe, expect, test } from 'vitest';

import type { Result } from '@crowdship/std';
import {
  InMemoryAuthService,
  accountId,
  email,
  secret,
  type AccountId,
  type Email,
  type RecoveryDelivery,
  type RecoveryToken,
  type Secret,
} from '@crowdship/identity';
import {
  CryptoIdMint,
  CryptoSecretMint,
  ScryptCredentialStore,
  SystemClock,
  type ScryptParams,
} from '../src/index.js';

/** Low-cost scrypt for fast tests — the security of the params is exercised separately by the default-params test. */
const FAST: ScryptParams = { N: 2 ** 14, r: 8, p: 1 };

const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const anAccount = (s: string): AccountId => must(accountId(s));
const aSecret = (s: string): Secret => must(secret(s));

class NoopDelivery implements RecoveryDelivery {
  readonly delivered: Array<{ readonly email: Email; readonly token: RecoveryToken }> = [];
  deliver(to: Email, token: RecoveryToken): Promise<void> {
    this.delivered.push({ email: to, token });
    return Promise.resolve();
  }
}

describe('ScryptCredentialStore (real hashing)', () => {
  test('the correct secret verifies; a wrong one does not', async () => {
    const store = new ScryptCredentialStore(FAST);
    const id = anAccount('acc-1');
    await store.set(id, aSecret('correct horse'));
    expect(await store.verify(id, aSecret('correct horse'))).toBe(true);
    expect(await store.verify(id, aSecret('correct horse '))).toBe(false);
    expect(await store.verify(id, aSecret('wrong'))).toBe(false);
  });

  test('an account with no credential on file matches nothing', async () => {
    const store = new ScryptCredentialStore(FAST);
    expect(await store.verify(anAccount('ghost'), aSecret('anything'))).toBe(false);
  });

  test('credentials are isolated per account', async () => {
    const store = new ScryptCredentialStore(FAST);
    await store.set(anAccount('a'), aSecret('secret-a'));
    await store.set(anAccount('b'), aSecret('secret-b'));
    expect(await store.verify(anAccount('a'), aSecret('secret-b'))).toBe(false);
    expect(await store.verify(anAccount('b'), aSecret('secret-a'))).toBe(false);
    expect(await store.verify(anAccount('a'), aSecret('secret-a'))).toBe(true);
  });

  test('the same secret set twice still verifies (independent salts do not break it)', async () => {
    const store = new ScryptCredentialStore(FAST);
    const id = anAccount('rehash');
    await store.set(id, aSecret('same'));
    await store.set(id, aSecret('same')); // re-set: new salt
    expect(await store.verify(id, aSecret('same'))).toBe(true);
  });

  test('clearing a credential makes it stop verifying', async () => {
    const store = new ScryptCredentialStore(FAST);
    const id = anAccount('temp');
    await store.set(id, aSecret('pw'));
    await store.clear(id);
    expect(await store.verify(id, aSecret('pw'))).toBe(false);
  });

  test(
    'the secure default params hash and verify without blowing scrypt maxmem',
    async () => {
      // No FAST override: exercises DEFAULT_SCRYPT_PARAMS (N=2^17), proving the
      // strong default is usable and maxmem is auto-sized so scrypt does not throw.
      const store = new ScryptCredentialStore();
      const id = anAccount('default-cost');
      await store.set(id, aSecret('a strong default'));
      expect(await store.verify(id, aSecret('a strong default'))).toBe(true);
      expect(await store.verify(id, aSecret('nope'))).toBe(false);
    },
    // Three real N=2^17 derivations are legitimately slow, and slower still under the
    // full suite's CPU contention. The explicit ceiling declares that, so the verdict
    // is about scrypt working — never about machine load [LAW:no-ambient-temporal-coupling].
    30_000,
  );
});

describe('CryptoSecretMint (CSPRNG bearer secrets)', () => {
  test('tokens are long and unique across many draws', () => {
    const mint = new CryptoSecretMint();
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const t = mint.newSessionToken();
      expect(t.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
      tokens.add(t);
    }
    expect(tokens.size).toBe(1000); // no collisions
  });

  test('session and recovery tokens do not collide with each other', () => {
    const mint = new CryptoSecretMint();
    const all = new Set<string>();
    for (let i = 0; i < 500; i++) {
      all.add(mint.newSessionToken());
      all.add(mint.newRecoveryToken());
    }
    expect(all.size).toBe(1000);
  });
});

describe('CryptoIdMint', () => {
  test('mints unique account and session ids', () => {
    const mint = new CryptoIdMint();
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(mint.newAccountId());
      ids.add(mint.newSessionId());
    }
    expect(ids.size).toBe(2000);
  });
});

describe('SystemClock', () => {
  test('reads a positive, non-decreasing instant', () => {
    const clock = new SystemClock();
    const a = clock.now();
    const b = clock.now();
    expect(a).toBeGreaterThan(0);
    expect(Number.isSafeInteger(a)).toBe(true);
    expect(b).toBeGreaterThanOrEqual(a);
  });
});

describe('the seam composes: InMemoryAuthService on real crypto adapters', () => {
  const build = () =>
    new InMemoryAuthService({
      clock: new SystemClock(),
      ids: new CryptoIdMint(),
      secrets: new CryptoSecretMint(),
      credentials: new ScryptCredentialStore(FAST),
      delivery: new NoopDelivery(),
      sessionTtlMillis: 60_000,
      recoveryTtlMillis: 30_000,
    });

  test('signup → login → resolve works end-to-end with real hashing and CSPRNG tokens', async () => {
    const service = build();
    const e = must(email('builder@crowdship.dev'));
    const created = must(await service.signUp(e, aSecret('a real password')));
    const grant = must(await service.logIn(e, aSecret('a real password')));
    expect(grant.account.id).toBe(created.id);
    const who = must(await service.resolveSession(grant.token));
    expect(who.account.email).toBe(e);
  });

  test('a wrong password fails against the real hasher', async () => {
    const service = build();
    const e = must(email('builder2@crowdship.dev'));
    must(await service.signUp(e, aSecret('right')));
    expect(await service.logIn(e, aSecret('wrong'))).toEqual({
      ok: false,
      error: { kind: 'invalid-credentials' },
    });
  });
});
