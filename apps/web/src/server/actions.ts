'use server';

import { headers } from 'next/headers';

import { email, secret } from '@crowdship/identity';
import { enforceAuthRateLimit } from './auth-rate-limit';
import { AuthError, signIn } from './auth';
import { clientIp } from './client-ip';
import { getAuthService } from './identity';

/** What an auth form gets back: nothing on success (the action redirects), or one message to show. */
export interface AuthFormState {
  readonly error?: string;
}

/**
 * Create an account, then sign in. The same edge parse as `authorize`
 * [LAW:single-enforcer]: raw form strings become `Email`/`Secret` before any
 * call to the port. Signup is allowed to say "email taken" — that disclosure is
 * the domain's deliberate choice for the signup path, distinct from login's
 * anti-enumeration silence.
 */
export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const e = email(String(formData.get('email') ?? ''));
  const s = secret(String(formData.get('password') ?? ''));
  if (!e.ok) return { error: 'Enter a valid email address.' };
  if (!s.ok) return { error: 'Choose a password.' };

  // Throttle BEFORE signUp's ~134MB scrypt mint. Signup owns its own flow (unlike
  // login, which throttles inside `authorize`), so it can surface the limit plainly
  // — consistent with signup's existing choice to disclose rather than stay opaque.
  const gate = enforceAuthRateLimit({ ip: clientIp(await headers()), email: e.value });
  if (!gate.allowed) {
    const retryAfterSeconds = Math.ceil(gate.retryAfterMillis / 1000);
    return { error: `Too many attempts. Please wait ${retryAfterSeconds}s and try again.` };
  }

  const created = await getAuthService().signUp(e.value, s.value);
  if (!created.ok) return { error: 'That email is already registered — try logging in.' };

  // Auto-login is the CONTINUATION of an already-admitted signup, but it re-enters
  // `authorize` and is therefore throttled a second time (the one structural cost
  // of routing through NextAuth). After a fresh signUp the credentials are valid
  // and parse cleanly, so the only way `authorize` returns null here is the rate
  // limiter tripping mid-flow — surfacing as an AuthError, never the success
  // redirect (NEXT_REDIRECT) and never a real credential fault. The account is
  // already durably created, so a throttled auto-login is expected backpressure,
  // not a fault to crash on: tell the user to log in. The success redirect and any
  // non-AuthError fault still propagate untouched and loudly [LAW:no-silent-failure].
  try {
    await signIn('credentials', { email: e.value, password: s.value, redirectTo: '/account' });
    return {};
  } catch (error) {
    if (error instanceof AuthError) return { error: 'Account created — please log in to continue.' };
    throw error;
  }
}

/**
 * Authenticate an existing account. Parsing is `authorize`'s job, so this hands
 * the raw strings straight to `signIn`; the single opaque failure comes back as
 * one message [LAW:types-are-the-program].
 */
export async function logInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const address = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  try {
    await signIn('credentials', { email: address, password, redirectTo: '/account' });
    return {};
  } catch (error) {
    // An AuthError is the credential failure → one message. Anything else is the
    // success redirect (or a real fault) and must propagate untouched.
    if (error instanceof AuthError) return { error: 'Invalid email or password.' };
    throw error;
  }
}
