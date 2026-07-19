import { join } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (server.js + only the traced node_modules) so the
  // container image carries exactly what runtime needs and nothing else — the reproducible
  // deploy artifact [LAW:decomposition — the image is one part with a closed dependency set].
  output: 'standalone',
  // apps/web lives in a pnpm monorepo; trace from the workspace root so standalone follows the
  // symlinked @crowdship/* workspace packages, not just apps/web's own node_modules.
  outputFileTracingRoot: join(import.meta.dirname, '../../'),
  // The identity packages ship raw TypeScript source (no build step), so Next
  // must transpile them like first-party code [LAW:one-source-of-truth — one copy
  // of the source, consumed directly]. @crowdship/node-std is the shared node-runtime
  // home identity-node now loads node:sqlite through, raw TS in the same chain.
  transpilePackages: ['@crowdship/std', '@crowdship/node-std', '@crowdship/identity', '@crowdship/identity-node'],
  webpack: (config, { isServer }) => {
    // Those packages import with explicit `.js` specifiers (the NodeNext/ESM
    // convention TypeScript and vitest already resolve to `.ts`). Teach webpack
    // the same mapping so a `./system-clock.js` import finds `system-clock.ts`.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    // `tigerbeetle-node` is a native addon (a transitive dep of @crowdship/ledger, loaded
    // there via `createRequire`): it loads its compiled `./bin/<arch>/client.node` by a path
    // relative to its own package, so bundling it into the server output breaks that path.
    // Mark it external on the server build so it stays a runtime `require` resolvable in
    // node_modules [LAW:effects-at-boundaries — the native edge stays at the edge]. This is
    // the reliable mechanism where `serverExternalPackages` is not: that list does not reach
    // a dependency pulled in by `createRequire` inside a transpiled workspace package.
    if (isServer) {
      const externals = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
      config.externals = [...externals, { 'tigerbeetle-node': 'commonjs tigerbeetle-node' }];
    }
    return config;
  },
};

export default nextConfig;
