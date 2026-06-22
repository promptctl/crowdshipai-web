import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The fast suite: package unit tests plus the web tier's server-edge tests.
    // apps/web tests import only the framework-free cores (auth-edge, the rate-limit
    // core, client-ip), never NextAuth or next/headers, so they run in plain Node
    // alongside the package suites — no jsdom, no app server. Integration tests that
    // need real engines stay out (see vitest.integration.config.ts).
    include: [
      'packages/*/test/**/*.test.ts',
      'services/*/test/**/*.test.ts',
      'apps/web/test/**/*.test.ts',
      // The cross-cutting workspace dependency-policy enforcer [LAW:single-enforcer].
      'architecture/**/*.test.ts',
    ],
  },
});
