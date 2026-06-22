import { describe, expect, it } from 'vitest';

import { err, ok } from '@crowdship/std';

import {
  authorizeCredentials,
  performSignUp,
  type AuthGate,
  type AutoLoginOutcome,
} from '../src/server/auth-edge';
import type { AuthRateLimitOutcome } from '../src/server/auth-rate-limit-core';
import { anEmail, loginGrant, recordingAuthService } from './support';

const VALID_EMAIL = 'Builder@Example.com'; // mixed case → canonicalised by `email()`
const CANONICAL_EMAIL = 'builder@example.com';
const VALID_PASSWORD = 'correct horse battery staple';
const HEADERS = new Headers({ 'x-forwarded-for': '203.0.113.5' });

/** A gate that records the attempts it was asked about and returns a fixed outcome. */
function recordingGate(outcome: AuthRateLimitOutcome) {
  const attempts: Array<{ readonly ip: string; readonly email: string }> = [];
  const gate: AuthGate = (attempt) => {
    attempts.push(attempt);
    return outcome;
  };
  return { gate, attempts };
}

const ALLOW: AuthRateLimitOutcome = { allowed: true };
const deny = (retryAfterMillis: number): AuthRateLimitOutcome => ({ allowed: false, retryAfterMillis });

describe('authorizeCredentials (login edge core)', () => {
  it('returns an AuthorizedUser from the grant when gate allows and credentials verify', async () => {
    const { gate, attempts } = recordingGate(ALLOW);
    const auth = recordingAuthService({ logIn: ok(loginGrant(anEmail(CANONICAL_EMAIL))) });

    const user = await authorizeCredentials(
      { gate, authService: auth.service },
      { email: VALID_EMAIL, password: VALID_PASSWORD },
      HEADERS,
    );

    expect(user).toEqual({ id: 'acct-1', email: CANONICAL_EMAIL, sessionToken: 'tok-1' });
    // The gate was consulted with the clientIp-derived source and the canonical email.
    expect(attempts).toEqual([{ ip: '203.0.113.5', email: CANONICAL_EMAIL }]);
    expect(auth.calls.logIn).toHaveLength(1);
  });

  it('denies BEFORE scrypt: a gate denial returns null and never calls logIn', async () => {
    const { gate, attempts } = recordingGate(deny(5000));
    // No logIn response configured — if the edge reached scrypt, the fake would throw.
    const auth = recordingAuthService({});

    const user = await authorizeCredentials(
      { gate, authService: auth.service },
      { email: VALID_EMAIL, password: VALID_PASSWORD },
      HEADERS,
    );

    expect(user).toBeNull();
    expect(attempts).toHaveLength(1);
    expect(auth.calls.logIn).toHaveLength(0); // the scrypt-bearing call never happened
  });

  it('returns the SAME opaque null for a bad credential as for a denial', async () => {
    const { gate } = recordingGate(ALLOW);
    const auth = recordingAuthService({ logIn: err({ kind: 'invalid-credentials' }) });

    const user = await authorizeCredentials(
      { gate, authService: auth.service },
      { email: VALID_EMAIL, password: VALID_PASSWORD },
      HEADERS,
    );

    expect(user).toBeNull();
    expect(auth.calls.logIn).toHaveLength(1);
  });

  it('rejects an unparseable email before the gate or scrypt is touched', async () => {
    const { gate, attempts } = recordingGate(ALLOW);
    const auth = recordingAuthService({});

    const user = await authorizeCredentials(
      { gate, authService: auth.service },
      { email: 'not-an-email', password: VALID_PASSWORD },
      HEADERS,
    );

    expect(user).toBeNull();
    expect(attempts).toHaveLength(0); // parse failure short-circuits ahead of the gate
    expect(auth.calls.logIn).toHaveLength(0);
  });

  it('treats a non-string credential field as absent (opaque null), not a crash', async () => {
    const { gate } = recordingGate(ALLOW);
    const auth = recordingAuthService({});

    const user = await authorizeCredentials(
      { gate, authService: auth.service },
      { email: undefined, password: 12345 },
      HEADERS,
    );

    expect(user).toBeNull();
    expect(auth.calls.logIn).toHaveLength(0);
  });
});

describe('performSignUp (signup edge core)', () => {
  const throttledAutoLogin = async (): Promise<AutoLoginOutcome> => 'throttled';

  it('creates then reports the throttled auto-login degradation branch', async () => {
    const { gate } = recordingGate(ALLOW);
    const auth = recordingAuthService({ signUp: ok(loginGrant(anEmail(CANONICAL_EMAIL)).account) });
    let autoLoginCalls = 0;
    const autoLogin = async (): Promise<AutoLoginOutcome> => {
      autoLoginCalls += 1;
      return 'throttled';
    };

    const state = await performSignUp(
      { gate, authService: auth.service, autoLogin },
      { email: VALID_EMAIL, password: VALID_PASSWORD },
      HEADERS,
    );

    expect(state).toEqual({ error: 'Account created — please log in to continue.' });
    expect(auth.calls.signUp).toHaveLength(1);
    expect(autoLoginCalls).toBe(1);
  });

  it('propagates the auto-login throw (success redirect / real fault), never swallowing it', async () => {
    const { gate } = recordingGate(ALLOW);
    const auth = recordingAuthService({ signUp: ok(loginGrant(anEmail(CANONICAL_EMAIL)).account) });
    const redirect = new Error('NEXT_REDIRECT');
    const autoLogin = async (): Promise<AutoLoginOutcome> => {
      throw redirect;
    };

    await expect(
      performSignUp(
        { gate, authService: auth.service, autoLogin },
        { email: VALID_EMAIL, password: VALID_PASSWORD },
        HEADERS,
      ),
    ).rejects.toBe(redirect);
  });

  it('denies BEFORE scrypt: a gate denial reports the wait and never calls signUp or auto-login', async () => {
    const { gate, attempts } = recordingGate(deny(4200));
    const auth = recordingAuthService({});
    let autoLoginCalls = 0;
    const autoLogin = async (): Promise<AutoLoginOutcome> => {
      autoLoginCalls += 1;
      return 'throttled';
    };

    const state = await performSignUp(
      { gate, authService: auth.service, autoLogin },
      { email: VALID_EMAIL, password: VALID_PASSWORD },
      HEADERS,
    );

    expect(state).toEqual({ error: 'Too many attempts. Please wait 5s and try again.' }); // ceil(4200/1000)
    expect(attempts).toEqual([{ ip: '203.0.113.5', email: CANONICAL_EMAIL }]);
    expect(auth.calls.signUp).toHaveLength(0); // the scrypt-bearing mint never happened
    expect(autoLoginCalls).toBe(0);
  });

  it('discloses an already-registered email and does not attempt auto-login', async () => {
    const { gate } = recordingGate(ALLOW);
    const auth = recordingAuthService({ signUp: err({ kind: 'email-taken' }) });
    let autoLoginCalls = 0;
    const autoLogin = async (): Promise<AutoLoginOutcome> => {
      autoLoginCalls += 1;
      return 'throttled';
    };

    const state = await performSignUp(
      { gate, authService: auth.service, autoLogin },
      { email: VALID_EMAIL, password: VALID_PASSWORD },
      HEADERS,
    );

    expect(state).toEqual({ error: 'That email is already registered — try logging in.' });
    expect(auth.calls.signUp).toHaveLength(1);
    expect(autoLoginCalls).toBe(0);
  });

  it('rejects an invalid email with a distinct message before the gate or scrypt', async () => {
    const { gate, attempts } = recordingGate(ALLOW);
    const auth = recordingAuthService({});

    const state = await performSignUp(
      { gate, authService: auth.service, autoLogin: throttledAutoLogin },
      { email: 'nope', password: VALID_PASSWORD },
      HEADERS,
    );

    expect(state).toEqual({ error: 'Enter a valid email address.' });
    expect(attempts).toHaveLength(0);
    expect(auth.calls.signUp).toHaveLength(0);
  });

  it('rejects a blank password with a distinct message before the gate or scrypt', async () => {
    const { gate, attempts } = recordingGate(ALLOW);
    const auth = recordingAuthService({});

    const state = await performSignUp(
      { gate, authService: auth.service, autoLogin: throttledAutoLogin },
      { email: VALID_EMAIL, password: '' },
      HEADERS,
    );

    expect(state).toEqual({ error: 'Choose a password.' });
    expect(attempts).toHaveLength(0);
    expect(auth.calls.signUp).toHaveLength(0);
  });
});
