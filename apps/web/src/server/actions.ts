'use server';

import { headers } from 'next/headers';

import type { Email, Secret } from '@crowdship/identity';
import { performSignUp, type AuthFormState, type AutoLoginOutcome } from './auth-edge';
import { enforceAuthRateLimit } from './auth-rate-limit';
import { AuthError, signIn } from './auth';
import { getAuthService } from './identity';

export type { AuthFormState };

/**
 * Continue an admitted signup into a session by re-entering NextAuth's `signIn`.
 * `signIn` never returns normally: success throws a redirect (NEXT_REDIRECT), and a
 * re-entrant throttle denial surfaces as an `AuthError` (authorize returned null).
 * This adapter translates that throw-based contract into the value
 * {@link performSignUp} expects — `'throttled'` for the denial, propagating
 * everything else untouched [LAW:no-silent-failure].
 */
const autoLogin = async (email: Email, secret: Secret): Promise<AutoLoginOutcome> => {
  try {
    await signIn('credentials', { email, password: secret, redirectTo: '/account' });
    // signIn is contracted to always throw; a normal return means NextAuth changed
    // under us — fail loud rather than silently reporting a throttle that did not happen.
    throw new Error('signIn returned without throwing — NextAuth contract changed');
  } catch (error) {
    if (error instanceof AuthError) return 'throttled';
    throw error;
  }
};

/**
 * Create an account, then sign in — the `'use server'` adapter over
 * {@link performSignUp}. It only resolves the request-bound effects (`headers()`,
 * the production singletons) and hands the orchestration core its dependencies as
 * values [LAW:effects-at-boundaries].
 */
export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return performSignUp(
    { gate: enforceAuthRateLimit, authService: getAuthService(), autoLogin },
    { email: formData.get('email'), password: formData.get('password') },
    await headers(),
  );
}

/**
 * Authenticate an existing account. Parsing and throttling are `authorize`'s job
 * (the login edge owns its own throttle, inside NextAuth), so this hands the raw
 * strings straight to `signIn`; the single opaque failure comes back as one
 * message [LAW:types-are-the-program].
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
