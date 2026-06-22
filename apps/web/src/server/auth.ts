import NextAuth, { AuthError, type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
// Type-only import so the `next-auth/jwt` module is loaded for augmentation below
// without pulling a runtime dependency [LAW:effects-at-boundaries].
import type {} from 'next-auth/jwt';

import { email, secret, sessionToken } from '@crowdship/identity';
import { getAuthService } from './identity';

/**
 * NextAuth owns the browser-facing session: the signed JWT cookie and CSRF. The
 * `@crowdship/identity` AuthService owns credential verification and the account
 * registry. These are not two session authorities [LAW:one-source-of-truth]: the
 * cookie is the authority for "is this request authenticated"; the domain session
 * the AuthService opens is a server-side lifecycle record (what logout ends, what
 * a future single auth gate will resolve), carried in the JWT so the two stay in
 * step rather than competing.
 */
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
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw) => {
        // THE edge: raw form strings become validated domain values here, and
        // only validated values cross into the AuthService port — the web tier's
        // single enforcer of the identity trust boundary [LAW:single-enforcer].
        const e = email(typeof raw?.email === 'string' ? raw.email : '');
        const s = secret(typeof raw?.password === 'string' ? raw.password : '');
        if (!e.ok || !s.ok) return null;
        const result = await getAuthService().logIn(e.value, s.value);
        // One failure → null → NextAuth's single CredentialsSignin error. Nothing
        // distinguishes "no such account" from "wrong secret" [LAW:types-are-the-program].
        if (!result.ok) return null;
        return {
          id: result.value.account.id,
          email: result.value.account.email,
          sessionToken: result.value.token,
        };
      },
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
