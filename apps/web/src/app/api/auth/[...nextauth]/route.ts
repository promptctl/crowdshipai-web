import { handlers } from '@/server/auth';

// The single NextAuth route: every sign-in/out/callback/CSRF request lands here
// [LAW:single-enforcer]. Node runtime (the default for route handlers) is required
// — identity storage runs on node:sqlite, which the edge runtime cannot load.
export const { GET, POST } = handlers;
