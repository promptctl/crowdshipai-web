/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The identity packages ship raw TypeScript source (no build step), so Next
  // must transpile them like first-party code [LAW:one-source-of-truth — one copy
  // of the source, consumed directly].
  transpilePackages: ['@crowdship/std', '@crowdship/identity', '@crowdship/identity-node'],
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
