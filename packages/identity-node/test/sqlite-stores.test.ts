import { describe, expect, test } from 'vitest';

import type { Result } from '@crowdship/std';
import {
  StandardAuthService,
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
  SqliteAuthStore,
  SqliteCredentialStore,
  SystemClock,
  openIdentityDb,
  type ScryptParams,
} from '../src/index.js';

/** Low-cost scrypt for fast tests — the security of the default params is exercised in the in-memory suite. */
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

describe('SqliteCredentialStore (durable, same KDF as in-memory)', () => {
  const freshStore = () => new SqliteCredentialStore(openIdentityDb(':memory:'), FAST);

  test('the correct secret verifies; a wrong one does not', async () => {
    const store = freshStore();
    const id = anAccount('acc-1');
    await store.set(id, aSecret('correct horse'));
    expect(await store.verify(id, aSecret('correct horse'))).toBe(true);
    expect(await store.verify(id, aSecret('correct horse '))).toBe(false);
    expect(await store.verify(id, aSecret('wrong'))).toBe(false);
  });

  test('an account with no credential on file matches nothing', async () => {
    const store = freshStore();
    expect(await store.verify(anAccount('ghost'), aSecret('anything'))).toBe(false);
  });

  test('re-setting replaces the record (new salt) and still verifies', async () => {
    const store = freshStore();
    const id = anAccount('rehash');
    await store.set(id, aSecret('same'));
    await store.set(id, aSecret('same'));
    expect(await store.verify(id, aSecret('same'))).toBe(true);
  });

  test('clearing a credential makes it stop verifying', async () => {
    const store = freshStore();
    const id = anAccount('temp');
    await store.set(id, aSecret('pw'));
    await store.clear(id);
    expect(await store.verify(id, aSecret('pw'))).toBe(false);
  });

  test('records survive across store instances on the same database (durability)', async () => {
    const db = openIdentityDb(':memory:');
    const id = anAccount('persist');
    await new SqliteCredentialStore(db, FAST).set(id, aSecret('kept'));
    // A second store over the SAME handle is a fresh object with no in-process
    // state — if it verifies, the record came from the database, not memory.
    expect(await new SqliteCredentialStore(db, FAST).verify(id, aSecret('kept'))).toBe(true);
  });
});

describe('the durable seam composes: StandardAuthService on the SQLite stores', () => {
  const build = () => {
    const db = openIdentityDb(':memory:');
    return new StandardAuthService({
      clock: new SystemClock(),
      ids: new CryptoIdMint(),
      secrets: new CryptoSecretMint(),
      credentials: new SqliteCredentialStore(db, FAST),
      delivery: new NoopDelivery(),
      store: new SqliteAuthStore(db),
      sessionTtlMillis: 60_000,
      recoveryTtlMillis: 30_000,
    });
  };

  test('signup → login → resolve works end-to-end against SQLite', async () => {
    const service = build();
    const e = must(email('builder@crowdship.dev'));
    const created = must(await service.signUp(e, aSecret('a real password')));
    const grant = must(await service.logIn(e, aSecret('a real password')));
    expect(grant.account.id).toBe(created.id);
    const who = must(await service.resolveSession(grant.token));
    expect(who.account.email).toBe(e);
  });

  test('signing up the same mailbox twice is refused', async () => {
    const service = build();
    const e = must(email('dupe@crowdship.dev'));
    must(await service.signUp(e, aSecret('first')));
    expect(await service.signUp(e, aSecret('second'))).toEqual({
      ok: false,
      error: { kind: 'email-taken' },
    });
  });

  test('a wrong password is one opaque failure; a missing mailbox is the same one', async () => {
    const service = build();
    const e = must(email('real@crowdship.dev'));
    must(await service.signUp(e, aSecret('right')));
    expect(await service.logIn(e, aSecret('wrong'))).toEqual({ ok: false, error: { kind: 'invalid-credentials' } });
    expect(await service.logIn(must(email('nobody@crowdship.dev')), aSecret('x'))).toEqual({
      ok: false,
      error: { kind: 'invalid-credentials' },
    });
  });

  test('logout makes the session no longer resolve', async () => {
    const service = build();
    const e = must(email('out@crowdship.dev'));
    must(await service.signUp(e, aSecret('pw')));
    const grant = must(await service.logIn(e, aSecret('pw')));
    await service.logOut(grant.token);
    expect(await service.resolveSession(grant.token)).toEqual({ ok: false, error: { kind: 'unknown' } });
  });

  test('a credential reset invalidates every existing session of that account', async () => {
    const service = build();
    const delivery = new NoopDelivery();
    const db = openIdentityDb(':memory:');
    const svc = new StandardAuthService({
      clock: new SystemClock(),
      ids: new CryptoIdMint(),
      secrets: new CryptoSecretMint(),
      credentials: new SqliteCredentialStore(db, FAST),
      delivery,
      store: new SqliteAuthStore(db),
      sessionTtlMillis: 60_000,
      recoveryTtlMillis: 30_000,
    });
    const e = must(email('reset@crowdship.dev'));
    must(await svc.signUp(e, aSecret('old')));
    const grant = must(await svc.logIn(e, aSecret('old')));
    await svc.requestRecovery(e);
    const token = delivery.delivered.at(-1)?.token;
    if (token === undefined) throw new Error('expected a recovery token to be delivered');
    must(await svc.resetCredential(token, aSecret('new')));
    // Old session gone, old secret dead, new secret works.
    expect(await svc.resolveSession(grant.token)).toEqual({ ok: false, error: { kind: 'unknown' } });
    expect(await svc.logIn(e, aSecret('old'))).toEqual({ ok: false, error: { kind: 'invalid-credentials' } });
    expect((await svc.logIn(e, aSecret('new'))).ok).toBe(true);
  });

  test('roles round-trip through SQLite and survive across store instances', async () => {
    const db = openIdentityDb(':memory:');
    const svc = new StandardAuthService({
      clock: new SystemClock(),
      ids: new CryptoIdMint(),
      secrets: new CryptoSecretMint(),
      credentials: new SqliteCredentialStore(db, FAST),
      delivery: new NoopDelivery(),
      store: new SqliteAuthStore(db),
      sessionTtlMillis: 60_000,
      recoveryTtlMillis: 30_000,
    });
    const e = must(email('roles@crowdship.dev'));
    const created = must(await svc.signUp(e, aSecret('pw')));
    expect(created.roles).toEqual(['backer']);
    must(await svc.grantRole(created.id, 'recruiter'));
    must(await svc.grantRole(created.id, 'builder'));

    // A second store over the SAME handle has no in-process state — if it reads
    // the full canonical capability set, it came from the database, not memory.
    const reread = await new SqliteAuthStore(db).accountById(created.id);
    expect(reread?.roles).toEqual(['backer', 'builder', 'recruiter']);

    must(await svc.revokeRole(created.id, 'backer'));
    expect((await new SqliteAuthStore(db).accountById(created.id))?.roles).toEqual(['builder', 'recruiter']);
  });

  test('requesting recovery for an unknown mailbox delivers nothing and discloses nothing', async () => {
    const delivery = new NoopDelivery();
    const db = openIdentityDb(':memory:');
    const svc = new StandardAuthService({
      clock: new SystemClock(),
      ids: new CryptoIdMint(),
      secrets: new CryptoSecretMint(),
      credentials: new SqliteCredentialStore(db, FAST),
      delivery,
      store: new SqliteAuthStore(db),
      sessionTtlMillis: 60_000,
      recoveryTtlMillis: 30_000,
    });
    await svc.requestRecovery(must(email('stranger@crowdship.dev')));
    expect(delivery.delivered).toHaveLength(0);
  });
});
