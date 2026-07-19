import NextAuth, { AuthError, type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
// Type-only import so the `next-auth/jwt` module is loaded for augmentation below
// without pulling a runtime dependency [LAW:effects-at-boundaries].
import type {} from 'next-auth/jwt';

import { accountId, roleSet, sessionToken } from '@crowdship/identity';
import type { AccountId, Role, RoleSet } from '@crowdship/identity';
import { authorizeCredentials } from './auth-edge';
import { resolveRequest } from './auth-gate';
import { enforceAuthRateLimit } from './auth-rate-limit';
import { getAuthService } from './identity';

/**
 * NextAuth owns the browser-facing session: the signed JWT cookie and CSRF. The
 * `@crowdship/identity` AuthService owns credential verification and the account
 * registry. There is exactly one authority for "is this request authenticated" —
 * the JWT cookie [LAW:one-source-of-truth]. The domain session the AuthService
 * opens is a server-side lifecycle record carried in the JWT (ended on logout).
 *
 * REVOCATION (bb2.5): the JWT is no longer trusted by its signature alone. The
 * `jwt` callback below re-resolves the DOMAIN session this token names on every
 * request through the single auth gate ({@link resolveRequest}); a session that
 * has been logged out, credential-reset, or expired makes the callback return
 * `null`, which invalidates the cookie. So a credential reset (which deletes the
 * account's domain sessions) and a logout are now authoritative server-side, not
 * merely a dropped cookie [LAW:single-enforcer][LAW:no-silent-failure].
 */

// The session cookie's lifetime. With per-request re-resolution above, this is a
// backstop — the longest a cookie can live if it is never presented again — not
// the primary revocation control, which is the domain session's own lifecycle.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

// In production the host must not be inferred from an attacker-controllable header,
// and the signing secret must be real — fail loudly rather than booting insecure. This is
// a BOOT guarantee, not a build one: `next build` evaluates this module to collect page data
// with no secret present (and none is used — nothing authenticates during static generation),
// so the check is skipped in the build phase Next marks with NEXT_PHASE. It stays active at
// runtime (server phase or unset), where an absent secret must still halt the boot
// [LAW:no-silent-failure][LAW:no-ambient-temporal-coupling — the check owns runtime, not the build].
if (
  process.env.NEXT_PHASE !== 'phase-production-build' &&
  process.env.NODE_ENV === 'production' &&
  (process.env.AUTH_SECRET?.length ?? 0) < 32
) {
  throw new Error('AUTH_SECRET must be set to a 32+ character secret in production');
}
declare module 'next-auth' {
  interface Session {
    /** The request's resolved principal as branded domain values — the authz subject (`@crowdship/identity` `Principal`). */
    readonly user: { readonly id: AccountId; readonly roles: RoleSet } & DefaultSession['user'];
  }
  interface User {
    /** The domain session token minted by `AuthService.logIn`, threaded so logout can end the server-side session. */
    sessionToken?: string;
  }
}
declare module 'next-auth/jwt' {
  interface JWT {
    sessionToken?: string;
    /** The principal's capabilities, carried so the session can surface them to authorization. */
    roles?: readonly Role[];
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Self-hosted Auth.js v5 (non-Vercel) MUST trust the host or it throws UntrustedHost on
  // every request — AUTH_URL alone does not lift that guard, it only pins the canonical origin
  // for redirects and cookie scope. Trusting the raw Host is only safe because a single
  // enforcer guarantees the Host is ours: the edge middleware refuses any request whose Host is
  // not the one AUTH_URL pins [LAW:single-enforcer], standing in for the validating ingress this
  // deployment does not yet have. Hardening that boundary into TLS + a real reverse proxy is the
  // tracked HTTPS/domain follow-on; until then the middleware is the host boundary.
  trustHost: true,
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
    jwt: async ({ token, user }) => {
      // Carry the domain bearer token into the JWT at sign-in, so every later
      // request can re-resolve the session it names.
      if (user?.sessionToken !== undefined) token.sessionToken = user.sessionToken;

      // THE authentication boundary: re-resolve the domain session this JWT names on
      // EVERY request. An absent principal — logged out, reset, expired, or a JWT
      // carrying no/garbled token — returns null, which invalidates the cookie: real
      // server-side revocation, not a JWT trusted by its signature until maxAge
      // [LAW:single-enforcer][LAW:no-silent-failure].
      const principal = await resolveRequest(getAuthService(), token.sessionToken);
      if (principal === null) return null;

      // Stamp the resolved principal, refreshed each call so a role grant or
      // revocation reflects immediately — the request now CARRIES the principal and
      // authz reads it with no further IO [LAW:effects-at-boundaries][LAW:one-source-of-truth].
      token.sub = principal.account.id;
      token.roles = principal.account.roles;
      return token;
    },
    session: ({ session, token }) => {
      // Rehydrate the carried principal as validated domain values — the trust
      // boundary turning the JWT's JSON back into branded identity types
      // [LAW:single-enforcer]. The jwt boundary only ever returns an authenticated
      // token here (a dead one became null), and stamped these from already-valid
      // domain values over a signed, encrypted token, so a missing subject or a
      // parse miss is corruption surfaced loudly, never folded into a half-formed
      // session [LAW:no-silent-failure].
      if (token.sub === undefined) throw new Error('auth: authenticated session JWT is missing its subject');
      const id = accountId(token.sub);
      if (!id.ok) throw new Error(`auth: JWT carries an invalid account id: ${token.sub}`);
      return { ...session, user: { ...session.user, id: id.value, roles: roleSet(token.roles ?? []) } };
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
