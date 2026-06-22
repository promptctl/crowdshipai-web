import type { Clock, Result, Timestamp } from '@crowdship/std';
import { timestamp } from '@crowdship/std';
import type {
  Account,
  Authenticated,
  AuthService,
  Email,
  LogInError,
  LoginGrant,
  Secret,
  SessionError,
  SessionToken,
  SignUpError,
} from '@crowdship/identity';
import { accountId, DEFAULT_ROLES, email, sessionId, sessionToken } from '@crowdship/identity';

/**
 * Unwrap a `Result` in test setup, throwing loudly on the unexpected `err` rather
 * than letting a malformed fixture flow on as a silent `undefined` [LAW:no-silent-failure].
 */
export function must<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error(`test setup expected ok, got error: ${JSON.stringify(result.error)}`);
  return result.value;
}

/**
 * A controllable clock for the auth-edge tests: time only moves when a test calls
 * {@link advance}, so a sliding window's slide is exercised deterministically
 * rather than against the wall clock [LAW:no-ambient-temporal-coupling].
 */
export class FakeClock implements Clock {
  #now: Timestamp;

  constructor(startMillis = 0) {
    this.#now = must(timestamp(startMillis));
  }

  now(): Timestamp {
    return this.#now;
  }

  advance(millis: number): void {
    this.#now = must(timestamp(this.#now + millis));
  }
}

/** A login grant whose every value is a real branded domain value — no casts. */
export function loginGrant(forEmail: Email): LoginGrant {
  const account: Account = {
    id: must(accountId('acct-1')),
    email: forEmail,
    createdAt: must(timestamp(0)),
    roles: DEFAULT_ROLES,
  };
  return {
    account,
    session: {
      id: must(sessionId('sess-1')),
      accountId: account.id,
      issuedAt: must(timestamp(0)),
      expiresAt: must(timestamp(1_000_000)),
    },
    token: must(sessionToken('tok-1')),
  };
}

/** A valid Email value for assertions that need one without re-parsing inline. */
export function anEmail(raw: string): Email {
  return must(email(raw));
}

/** Calls recorded by {@link recordingAuthService}, the spied trust-boundary port. */
export interface AuthServiceCalls {
  readonly logIn: Array<{ readonly email: Email; readonly secret: Secret }>;
  readonly signUp: Array<{ readonly email: Email; readonly secret: Secret }>;
  readonly resolveSession: Array<{ readonly token: SessionToken }>;
}

export interface RecordingAuthService {
  readonly service: AuthService;
  readonly calls: AuthServiceCalls;
}

/**
 * A recording test double for {@link AuthService}: it remembers every `logIn`,
 * `signUp`, and `resolveSession` it was asked to perform and answers with the
 * response the test configured. A call with no configured response throws — the
 * fake never invents a result, so "was scrypt / the session resolver reached?" is
 * read directly off {@link AuthServiceCalls} and an unconfigured call surfaces as a
 * test bug rather than a silent default. The lifecycle methods neither the auth
 * edge nor the request gate touch throw if reached [LAW:no-silent-failure].
 */
export function recordingAuthService(responses: {
  readonly logIn?: Result<LoginGrant, LogInError>;
  readonly signUp?: Result<Account, SignUpError>;
  readonly resolveSession?: Result<Authenticated, SessionError>;
}): RecordingAuthService {
  const calls: AuthServiceCalls = { logIn: [], signUp: [], resolveSession: [] };
  const service: AuthService = {
    logIn(emailValue, secretValue) {
      calls.logIn.push({ email: emailValue, secret: secretValue });
      if (responses.logIn === undefined) throw new Error('recordingAuthService: logIn called but no response configured');
      return Promise.resolve(responses.logIn);
    },
    signUp(emailValue, secretValue) {
      calls.signUp.push({ email: emailValue, secret: secretValue });
      if (responses.signUp === undefined) throw new Error('recordingAuthService: signUp called but no response configured');
      return Promise.resolve(responses.signUp);
    },
    resolveSession(token) {
      calls.resolveSession.push({ token });
      if (responses.resolveSession === undefined) throw new Error('recordingAuthService: resolveSession called but no response configured');
      return Promise.resolve(responses.resolveSession);
    },
    logOut() {
      throw new Error('recordingAuthService: logOut not used by the auth edge');
    },
    requestRecovery() {
      throw new Error('recordingAuthService: requestRecovery not used by the auth edge');
    },
    resetCredential() {
      throw new Error('recordingAuthService: resetCredential not used by the auth edge');
    },
    grantRole() {
      throw new Error('recordingAuthService: grantRole not used by the auth edge');
    },
    revokeRole() {
      throw new Error('recordingAuthService: revokeRole not used by the auth edge');
    },
  };
  return { service, calls };
}
