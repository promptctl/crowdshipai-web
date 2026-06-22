import { defineConfig } from 'vitest/config';

// Integration tests stand up real external engines (a live TigerBeetle cluster for
// the ledger) and so are kept out of the default `vitest run` — they live under
// `packages/*/integration/` rather than `packages/*/test/`, and are run explicitly
// with `pnpm test:integration`. The split is by directory, not by a skip flag: a
// money path is never silently un-run [LAW:no-silent-failure]. The fast suite still
// proves the same behavioural contract against the in-memory fake, so adapter logic
// regressions surface without a database; this suite proves the real engine honours
// that identical contract. Booting a cluster costs a few seconds, so it earns its
// own command rather than taxing every unrelated `pnpm test`.
export default defineConfig({
  test: {
    include: ['packages/*/integration/**/*.test.ts'],
    // A single TigerBeetle cluster is shared across the file's tests (formatted and
    // booted once); keep the suite single-threaded so nothing races the teardown.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
