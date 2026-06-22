'use server';

import { email, secret } from '@crowdship/identity';
import { AuthError, signIn } from './auth';
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

  const created = await getAuthService().signUp(e.value, s.value);
  if (!created.ok) return { error: 'That email is already registered — try logging in.' };

  // Auto-login. On success `signIn` throws the redirect (NEXT_REDIRECT), which
  // must propagate — so it is deliberately NOT wrapped here. A failure right after
  // a successful signup is a real fault and should surface loudly [LAW:no-silent-failure].
  await signIn('credentials', { email: e.value, password: s.value, redirectTo: '/account' });
  return {};
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
