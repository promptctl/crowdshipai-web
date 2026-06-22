import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import type { Clock, Result, Timestamp } from '@crowdship/std';
import { timestamp } from '@crowdship/std';
import {
  InMemoryAuthService,
  accountId,
  email,
  recoveryToken,
  secret,
  sessionId,
  sessionToken,
  type AccountId,
  type CredentialStore,
  type Email,
  type IdMint,
  type RecoveryDelivery,
  type RecoveryToken,
  type Secret,
  type SecretMint,
  type SessionId,
  type SessionToken,
} from '../src/index.js';

/** Test-only: unwrap a Result loudly. A contract test must never silently proceed past a failed construction. */
const must = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
};

const anEmail = (s: string): Email => must(email(s));
const aSecret = (s: string): Secret => must(secret(s));

/** A clock the test owns and advances by hand — no real time, no ambient now. */
class TestClock implements Clock {
  #at: Timestamp;
  constructor(start = 0) {
    this.#at = must(timestamp(start));
  }
  now(): Timestamp {
    return this.#at;
  }
  advance(millis: number): void {
    this.#at = must(timestamp(this.#at + millis));
  }
}

/** Monotonic id/token mints — unique by construction via a counter. */
class CountingMint implements IdMint, SecretMint {
  #n = 0;
  newAccountId(): AccountId {
    return must(accountId(`acc-${this.#n++}`));
  }
  newSessionId(): SessionId {
    return must(sessionId(`sess-${this.#n++}`));
  }
  newSessionToken(): SessionToken {
    return must(sessionToken(`stok-${this.#n++}`));
  }
  newRecoveryToken(): RecoveryToken {
    return must(recoveryToken(`rtok-${this.#n++}`));
  }
}

/**
 * TEST-ONLY credential store: holds secrets in the clear. Never production — it
 * stands in for the adopted hasher behind the same seam so the service logic can
 * be exercised without real crypto.
 */
class PlaintextCredentials implements CredentialStore {
  readonly #byAccount = new Map<AccountId, Secret>();
  set(id: AccountId, s: Secret): Promise<void> {
    this.#byAccount.set(id, s);
    return Promise.resolve();
  }
  verify(id: AccountId, s: Secret): Promise<boolean> {
    return Promise.resolve(this.#byAccount.get(id) === s);
  }
  clear(id: AccountId): Promise<void> {
    this.#byAccount.delete(id);
    return Promise.resolve();
  }
}

/** Captures whatever recovery tokens were delivered, so a test can read what a real user would receive by mail. */
class CapturingDelivery implements RecoveryDelivery {
  readonly delivered: Array<{ readonly email: Email; readonly token: RecoveryToken }> = [];
  deliver(to: Email, token: RecoveryToken): Promise<void> {
    this.delivered.push({ email: to, token });
    return Promise.resolve();
  }
}

const SESSION_TTL = 60_000;
const RECOVERY_TTL = 30_000;

const makeService = () => {
  const clock = new TestClock();
  const mint = new CountingMint();
  const credentials = new PlaintextCredentials();
  const delivery = new CapturingDelivery();
  const service = new InMemoryAuthService({
    clock,
    ids: mint,
    secrets: mint,
    credentials,
    delivery,
    sessionTtlMillis: SESSION_TTL,
    recoveryTtlMillis: RECOVERY_TTL,
  });
  return { service, clock, delivery };
};

describe('email constructor (the trust boundary)', () => {
  test('canonicalizes to trimmed lowercase', () => {
    expect(must(email('  Foo@Bar.COM '))).toBe('foo@bar.com');
  });

  test('the same mailbox in any casing is one value [LAW:one-source-of-truth]', () => {
    expect(must(email('A@B.io'))).toBe(must(email('a@b.io')));
  });

  test.each(['', '   ', 'no-at', 'a@b', '@b.com', 'a@', 'a b@c.com', 'a@b..com', 'a@.com', 'a@b.'])(
    'rejects malformed: %j',
    (raw) => {
      expect(email(raw).ok).toBe(false);
    },
  );

  test('property: any well-shaped address round-trips canonical and is idempotent', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.stringMatching(/^[a-z0-9]{1,12}$/),
          fc.stringMatching(/^[a-z0-9]{1,12}$/),
          fc.constantFrom('com', 'io', 'dev', 'co.uk'),
        ),
        ([local, host, tld]) => {
          const raw = `${local}@${host}.${tld}`;
          const once = email(raw);
          expect(once.ok).toBe(true);
          if (once.ok) expect(must(email(once.value))).toBe(once.value);
        },
      ),
    );
  });
});

describe('signup + login + session resolution', () => {
  test('property: signup → login → resolve recovers the same account', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[a-z0-9]{1,10}$/),
        // The secret contract is "non-blank" (interior whitespace allowed), so the
        // generator's output set must equal that legal-input set — not `/.{1,32}/`,
        // which emits whitespace-only strings the `secret()` constructor rejects.
        fc.string({ minLength: 1, maxLength: 32 }).filter((s) => s.trim().length > 0),
        async (handle, pw) => {
          const { service } = makeService();
          const e = anEmail(`${handle}@ex.com`);
          const created = must(await service.signUp(e, aSecret(pw)));
          const grant = must(await service.logIn(e, aSecret(pw)));
          expect(grant.account.id).toBe(created.id);
          const who = must(await service.resolveSession(grant.token));
          expect(who.account.id).toBe(created.id);
          expect(who.account.email).toBe(e);
        },
      ),
    );
  });

  test('a mailbox can be registered only once', async () => {
    const { service } = makeService();
    const e = anEmail('dup@ex.com');
    must(await service.signUp(e, aSecret('pw')));
    const again = await service.signUp(e, aSecret('other'));
    expect(again).toEqual({ ok: false, error: { kind: 'email-taken' } });
  });

  test('a different casing of a registered mailbox is the same account', async () => {
    const { service } = makeService();
    must(await service.signUp(anEmail('Mixed@Ex.com'), aSecret('pw')));
    const again = await service.signUp(anEmail('mixed@ex.com'), aSecret('pw'));
    expect(again.ok).toBe(false);
  });
});

describe('login failure never enumerates accounts', () => {
  test('wrong secret and unknown email give the identical error', async () => {
    const { service } = makeService();
    const e = anEmail('real@ex.com');
    must(await service.signUp(e, aSecret('correct')));
    const wrongSecret = await service.logIn(e, aSecret('incorrect'));
    const noAccount = await service.logIn(anEmail('ghost@ex.com'), aSecret('correct'));
    expect(wrongSecret).toEqual({ ok: false, error: { kind: 'invalid-credentials' } });
    expect(noAccount).toEqual(wrongSecret);
  });

  test('a login for an unknown email STILL performs a verification (no timing oracle)', async () => {
    // The response value already hides which emails are registered; this pins the
    // other half — that a missing mailbox runs the same credential verification as
    // a wrong secret, so the two cannot be told apart by latency either. We assert
    // the behavior (verify is called) rather than a flaky wall-clock measurement.
    const verifiedIds: AccountId[] = [];
    class SpyCredentials implements CredentialStore {
      readonly #inner = new PlaintextCredentials();
      set(id: AccountId, s: Secret): Promise<void> {
        return this.#inner.set(id, s);
      }
      verify(id: AccountId, s: Secret): Promise<boolean> {
        verifiedIds.push(id);
        return this.#inner.verify(id, s);
      }
      clear(id: AccountId): Promise<void> {
        return this.#inner.clear(id);
      }
    }
    const mint = new CountingMint();
    const service = new InMemoryAuthService({
      clock: new TestClock(),
      ids: mint,
      secrets: mint,
      credentials: new SpyCredentials(),
      delivery: new CapturingDelivery(),
      sessionTtlMillis: SESSION_TTL,
      recoveryTtlMillis: RECOVERY_TTL,
    });
    const res = await service.logIn(anEmail('ghost@ex.com'), aSecret('whatever'));
    expect(res).toEqual({ ok: false, error: { kind: 'invalid-credentials' } });
    expect(verifiedIds).toHaveLength(1); // a verify ran even though no account exists
  });
});

describe('secret constructor bounds (the credential trust boundary)', () => {
  test('an all-whitespace secret is blank', () => {
    expect(secret('   ').ok).toBe(false);
  });

  test('leading/trailing spaces are preserved — legitimate in a password', () => {
    expect(must(secret(' pw '))).toBe(' pw ');
  });

  test('a bounded secret is accepted; an over-long one is rejected as too-long', () => {
    expect(secret('x'.repeat(1024)).ok).toBe(true);
    const tooLong = secret('x'.repeat(1025));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error.kind).toBe('too-long');
  });
});

describe('sessions are lifetime-as-data', () => {
  test('an unknown token resolves to unknown', async () => {
    const { service } = makeService();
    const bogus = must(sessionToken('nope'));
    expect(await service.resolveSession(bogus)).toEqual({ ok: false, error: { kind: 'unknown' } });
  });

  test('a session is live up to, and dead at, its expiry instant', async () => {
    const { service, clock } = makeService();
    const e = anEmail('exp@ex.com');
    must(await service.signUp(e, aSecret('pw')));
    const grant = must(await service.logIn(e, aSecret('pw')));

    clock.advance(SESSION_TTL - 1);
    expect((await service.resolveSession(grant.token)).ok).toBe(true);

    clock.advance(1); // now exactly at expiresAt
    expect(await service.resolveSession(grant.token)).toEqual({ ok: false, error: { kind: 'expired' } });
  });

  test('logout ends a session and is idempotent', async () => {
    const { service } = makeService();
    const e = anEmail('out@ex.com');
    must(await service.signUp(e, aSecret('pw')));
    const grant = must(await service.logIn(e, aSecret('pw')));

    await service.logOut(grant.token);
    expect(await service.resolveSession(grant.token)).toEqual({ ok: false, error: { kind: 'unknown' } });
    await expect(service.logOut(grant.token)).resolves.toBeUndefined(); // again: no error
  });
});

describe('recovery', () => {
  test('requesting recovery for a real mailbox delivers a one-time token that resets the credential', async () => {
    const { service, delivery } = makeService();
    const e = anEmail('recover@ex.com');
    must(await service.signUp(e, aSecret('old')));

    await service.requestRecovery(e);
    expect(delivery.delivered).toHaveLength(1);
    const token = delivery.delivered[0]!.token;

    must(await service.resetCredential(token, aSecret('new')));

    expect((await service.logIn(e, aSecret('old'))).ok).toBe(false);
    expect((await service.logIn(e, aSecret('new'))).ok).toBe(true);
  });

  test('requesting recovery for an unknown mailbox delivers nothing but does not reveal that', async () => {
    const { service, delivery } = makeService();
    await expect(service.requestRecovery(anEmail('ghost@ex.com'))).resolves.toBeUndefined();
    expect(delivery.delivered).toHaveLength(0);
  });

  test('a recovery token is single-use', async () => {
    const { service, delivery } = makeService();
    const e = anEmail('once@ex.com');
    must(await service.signUp(e, aSecret('pw')));
    await service.requestRecovery(e);
    const token = delivery.delivered[0]!.token;

    must(await service.resetCredential(token, aSecret('first')));
    const second = await service.resetCredential(token, aSecret('second'));
    expect(second).toEqual({ ok: false, error: { kind: 'invalid-or-expired' } });
  });

  test('an expired recovery token is refused', async () => {
    const { service, clock, delivery } = makeService();
    const e = anEmail('slow@ex.com');
    must(await service.signUp(e, aSecret('pw')));
    await service.requestRecovery(e);
    const token = delivery.delivered[0]!.token;

    clock.advance(RECOVERY_TTL);
    expect(await service.resetCredential(token, aSecret('new'))).toEqual({
      ok: false,
      error: { kind: 'invalid-or-expired' },
    });
  });

  test('a credential reset invalidates the account’s live sessions', async () => {
    const { service, delivery } = makeService();
    const e = anEmail('kick@ex.com');
    must(await service.signUp(e, aSecret('pw')));
    const grant = must(await service.logIn(e, aSecret('pw')));

    await service.requestRecovery(e);
    must(await service.resetCredential(delivery.delivered[0]!.token, aSecret('rotated')));

    expect(await service.resolveSession(grant.token)).toEqual({ ok: false, error: { kind: 'unknown' } });
  });

  test('an unknown recovery token is refused', async () => {
    const { service } = makeService();
    const bogus = must(recoveryToken('not-a-real-token'));
    expect(await service.resetCredential(bogus, aSecret('new'))).toEqual({
      ok: false,
      error: { kind: 'invalid-or-expired' },
    });
  });
});
