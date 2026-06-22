import NextAuth, { AuthError, type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
// Type-only import so the `next-auth/jwt` module is loaded for augmentation below
// without pulling a runtime dependency [LAW:effects-at-boundaries].
import type {} from 'next-auth/jwt';

import { sessionToken } from '@crowdship/identity';
import { authorizeCredentials } from './auth-edge';
import { enforceAuthRateLimit } from './auth-rate-limit';
import { getAuthService } from './identity';

/**
 * NextAuth owns the browser-facing session: the signed JWT cookie and CSRF. The
 * `@crowdship/identity` AuthService owns credential verification and the account
 * registry. There is exactly one authority for "is this request authenticated" —
 * the JWT cookie [LAW:one-source-of-truth]. The domain session the AuthService
 * opens is a server-side lifecycle record carried in the JWT (ended on logout).
 *
 * KNOWN LIMITATION, by design, deferred to the single auth gate (bb2.5): the JWT
 * is self-contained and trusted by its signature alone — no request re-resolves
 * the domain session. So a credential reset, which invalidates the *domain*
 * session, does NOT revoke an already-issued JWT; that JWT stays valid until its
 * `maxAge` below. The `maxAge` is deliberately short to bound that window. Real
 * revocation arrives when bb2.5 wires `resolveSession` into the request gate — do
 * NOT claim reset revokes live sessions until then [LAW:no-silent-failure].
 */

// The session cookie's lifetime — kept short on purpose: it is the upper bound on
// how long a JWT issued before a password reset can outlive that reset (see above).
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

// In production the host must not be inferred from an attacker-controllable header,
// and the signing secret must be real — fail loudly rather than booting insecure.
if (process.env.NODE_ENV === 'production' && (process.env.AUTH_SECRET?.length ?? 0) < 32) {
  throw new Error('AUTH_SECRET must be set to a 32+ character secret in production');
}
declare module 'next-auth' {
  interface Session {
    readonly user: { readonly id: string } & DefaultSession['user'];
  }
  interface User {
    /** The domain session token minted by `AuthService.logIn`, threaded so logout can end the server-side session. */
    sessionToken?: string;
  }
}
declare module 'next-auth/jwt' {
  interface JWT {
    sessionToken?: string;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Trust the request host only outside production; in production the deployment
  // pins AUTH_URL so a poisoned Host/X-Forwarded-Host header cannot redirect or
  // re-scope cookies [LAW:no-silent-failure].
  trustHost: process.env.NODE_ENV !== 'production',
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      // THE login edge, delegated to the framework-free core: parse → throttle
      // (before scrypt) → verify, every failure collapsing to the same opaque null
      // [LAW:single-enforcer]. This closure only binds the production singletons;
      // the orchestration and its ordering guarantee live in `authorizeCredentials`,
      // where they are testable without NextAuth's runtime [LAW:effects-at-boundaries].
      authorize: (raw, request) =>
        authorizeCredentials(
          { gate: enforceAuthRateLimit, authService: getAuthService() },
          { email: raw?.email, password: raw?.password },
          request.headers,
        ),
    }),
  ],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user?.sessionToken !== undefined) token.sessionToken = user.sessionToken;
      return token;
    },
    session: ({ session, token }) => {
      if (token.sub !== undefined) session.user.id = token.sub;
      return session;
    },
  },
  events: {
    signOut: async (message) => {
      // End the domain session too, so logout is a real lifecycle end, not just a
      // dropped cookie [LAW:no-silent-failure]. JWT strategy → the message carries
      // the token; reconstruct the branded value and let a bad one fail loudly.
      const carried = 'token' in message ? message.token?.sessionToken : undefined;
      if (carried === undefined) return;
      const token = sessionToken(carried);
      if (token.ok) await getAuthService().logOut(token.value);
    },
  },
});

export { AuthError };
