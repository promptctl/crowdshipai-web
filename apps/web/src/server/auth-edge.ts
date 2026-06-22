import type { AuthService, Email, Secret } from '@crowdship/identity';
import { email, secret } from '@crowdship/identity';

import type { AuthRateLimitOutcome } from './auth-rate-limit-core';
import { clientIp } from './client-ip';

/**
 * The two scrypt-bearing auth edges as framework-free orchestration cores: parse
 * the raw request, throttle, call the identity port, and shape the result — with
 * every dependency injected as a value [LAW:effects-at-boundaries]. The NextAuth
 * `authorize` closure and the `'use server'` signup action are thin adapters that
 * pass the production singletons in; these cores hold the logic those adapters
 * cannot be tested through (NextAuth's runtime, `next/headers`), so the ordering
 * guarantee — throttle BEFORE scrypt — and the failure-shaping are testable by
 * looking only at the part [LAW:decomposition].
 */

/** What an auth form gets back: nothing on success (the action redirects), or one message to show. */
export interface AuthFormState {
  readonly error?: string;
}

/** The identity NextAuth carries once `authorize` admits a login — the JWT's seed. */
export interface AuthorizedUser {
  readonly id: string;
  readonly email: string;
  readonly sessionToken: string;
}

/**
 * The throttle as the edges consume it: a function from an attempt to the
 * allow/deny outcome. Injected rather than imported so a test drives the same
 * decision the production singleton runs, over a fake clock [LAW:no-ambient-temporal-coupling].
 */
export type AuthGate = (attempt: { readonly ip: string; readonly email: string }) => AuthRateLimitOutcome;

export interface LoginDeps {
  readonly gate: AuthGate;
  readonly authService: AuthService;
}

/**
 * The login core: validated values cross into the port, nothing else
 * [LAW:single-enforcer]. Every failure — bad parse, throttle denial, bad
 * credential — returns the SAME opaque `null`, so login never reveals why it
 * failed (anti-enumeration) [LAW:types-are-the-program]. The throttle is consulted
 * BEFORE `logIn`, so a denied attempt never enters the scrypt threadpool.
 */
export async function authorizeCredentials(
  deps: LoginDeps,
  raw: { readonly email: unknown; readonly password: unknown },
  headers: Headers,
): Promise<AuthorizedUser | null> {
  const e = email(typeof raw.email === 'string' ? raw.email : '');
  const s = secret(typeof raw.password === 'string' ? raw.password : '');
  if (!e.ok || !s.ok) return null;

  if (!deps.gate({ ip: clientIp(headers), email: e.value }).allowed) return null;

  const result = await deps.authService.logIn(e.value, s.value);
  if (!result.ok) return null;
  return {
    id: result.value.account.id,
    email: result.value.account.email,
    sessionToken: result.value.token,
  };
}

/**
 * The post-signup auto-login's only NON-exceptional outcome. NextAuth's `signIn`
 * throws on both of its real results — a success redirect (NEXT_REDIRECT) and any
 * fault — so the single value an `autoLogin` adapter can RETURN is that the
 * re-entrant throttle tripped mid-flow. Naming it makes that one path legible at
 * the type level rather than left to a comment [LAW:types-are-the-program].
 */
export type AutoLoginOutcome = 'throttled';

export interface SignUpDeps {
  readonly gate: AuthGate;
  readonly authService: AuthService;
  /**
   * Continue an admitted signup into a session. Throws on the success redirect and
   * on any real fault (both propagate out of {@link performSignUp} untouched); only
   * ever RETURNS to report the re-entrant throttle tripped — see {@link AutoLoginOutcome}.
   */
  readonly autoLogin: (email: Email, secret: Secret) => Promise<AutoLoginOutcome>;
}

/**
 * The signup core: parse, throttle, create, then auto-login. Unlike login, signup
 * is allowed to disclose — "email taken", and a plain "too many attempts" — because
 * the mailbox owner already proved intent by submitting it; that disclosure is the
 * domain's deliberate choice, distinct from login's silence. The throttle runs
 * BEFORE `signUp`'s scrypt mint.
 *
 * Auto-login re-enters the SAME throttle (one structural cost of routing through
 * NextAuth), so after a fresh signUp the only way it fails is that window tripping
 * mid-flow. The account is already durably created, so a throttled auto-login is
 * expected backpressure, not a fault: tell the user to log in. The success redirect
 * and any real fault still propagate untouched and loudly [LAW:no-silent-failure].
 */
export async function performSignUp(
  deps: SignUpDeps,
  raw: { readonly email: unknown; readonly password: unknown },
  headers: Headers,
): Promise<AuthFormState> {
  const e = email(typeof raw.email === 'string' ? raw.email : '');
  const s = secret(typeof raw.password === 'string' ? raw.password : '');
  if (!e.ok) return { error: 'Enter a valid email address.' };
  if (!s.ok) return { error: 'Choose a password.' };

  const gate = deps.gate({ ip: clientIp(headers), email: e.value });
  if (!gate.allowed) {
    const retryAfterSeconds = Math.ceil(gate.retryAfterMillis / 1000);
    return { error: `Too many attempts. Please wait ${retryAfterSeconds}s and try again.` };
  }

  const created = await deps.authService.signUp(e.value, s.value);
  if (!created.ok) return { error: 'That email is already registered — try logging in.' };

  await deps.autoLogin(e.value, s.value);
  return { error: 'Account created — please log in to continue.' };
}
