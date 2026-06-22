/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The identity packages ship raw TypeScript source (no build step), so Next
  // must transpile them like first-party code [LAW:one-source-of-truth — one copy
  // of the source, consumed directly].
  transpilePackages: ['@crowdship/std', '@crowdship/identity', '@crowdship/identity-node'],
  webpack: (config) => {
    // Those packages import with explicit `.js` specifiers (the NodeNext/ESM
    // convention TypeScript and vitest already resolve to `.ts`). Teach webpack
    // the same mapping so a `./system-clock.js` import finds `system-clock.ts`.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
