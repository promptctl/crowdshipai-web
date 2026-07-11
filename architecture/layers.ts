/**
 * The single source of truth for the workspace's dependency direction
 * [LAW:one-source-of-truth]. Each `@crowdship/*` package is assigned to one
 * layer; the enforcer (`./dependency-graph.test.ts`) checks that every real
 * dependency edge points strictly down this stack. The diagram in
 * `docs/architecture-proposal.md` is the prose picture of the same idea — this
 * is the version a machine checks.
 *
 * Adding a package means adding it here (the enforcer fails loudly on any
 * package it cannot find a layer for), which forces a deliberate answer to
 * "where in the stack does this belong?" — the question [LAW:one-way-deps] is
 * really about.
 */

import type { LayerSpec } from './dependency-graph.js';

/** The layers, most-foundational first; a layer's rank is its index here. */
export const LAYERS = [
  {
    id: 'foundation',
    description:
      'Cross-cutting primitives that belong to no domain — the vocabulary every layer stands on (e.g. brand, result, time, the coin unit). Depend on nothing internal.',
  },
  {
    id: 'core',
    description:
      'Pure logic — domain truth and cross-cutting capability alike, vendor- and framework-free. May depend only on foundation.',
  },
  {
    id: 'runtime',
    description:
      "Shared node-runtime primitives the adapters stand on — the platform's own built-ins (node:sqlite behind a bundler-safe loader) and the trust-boundary readers over their rows. Depends only on foundation; sitting ABOVE the framework-free cores means a core that DEPENDS ON this package is an illegal upward edge (the graph enforcer checks @crowdship/* dependency edges — it does not police a core importing a raw node: builtin directly; that would want a lint rule).",
  },
  {
    id: 'adapter',
    description:
      'Binds an adopted runtime or vendor to a core behind a seam (node/sqlite, TigerBeetle). May depend on the runtime primitives, cores, and foundation.',
  },
  {
    id: 'rail',
    description:
      'A domain money-movement seam that binds a ledger adapter into a higher-level settlement contract — "custodial now, on-chain later" made swappable — for services to share. May depend on adapters, cores, and foundation. It sits BELOW services on purpose: several settlement engines (release, refund) settle through this ONE seam, and a seam shared by services cannot live in any one of them without making a service depend on a service [LAW:one-way-deps] [LAW:one-type-per-behavior].',
  },
  {
    id: 'service',
    description:
      'A use-case that composes cores and adapters into one dataflow pipeline (e.g. purchase-to-fire: post coins, then fire the effect). The product surface drives it; it depends on no other service.',
  },
  {
    id: 'app',
    description: 'The product surface. Composes everything beneath it; nothing depends on it.',
  },
] as const;

type RepoLayerId = (typeof LAYERS)[number]['id'];

// Typing the assignment values to the declared layer ids makes a typo or a
// reference to a non-existent layer a compile error, not a runtime one
// [LAW:types-are-the-program].
const ASSIGN: Readonly<Record<string, RepoLayerId>> = {
  '@crowdship/std': 'foundation',

  '@crowdship/identity': 'core',
  '@crowdship/ledger-kernel': 'core',
  '@crowdship/live-feed': 'core',
  '@crowdship/menu': 'core',
  '@crowdship/moderation': 'core',
  '@crowdship/payments': 'core',
  '@crowdship/presence': 'core',
  '@crowdship/rate-limit': 'core',
  '@crowdship/settlement': 'core',
  '@crowdship/stream': 'core',

  '@crowdship/node-std': 'runtime',

  '@crowdship/identity-node': 'adapter',
  '@crowdship/ledger': 'adapter',
  '@crowdship/moderation-node': 'adapter',
  '@crowdship/payments-stripe': 'adapter',
  '@crowdship/stream-livekit': 'adapter',

  '@crowdship/escrow-shares': 'rail',
  '@crowdship/settlement-rail': 'rail',

  '@crowdship/on-ramp': 'service',
  '@crowdship/pool': 'service',
  '@crowdship/purchase': 'service',
  '@crowdship/refund': 'service',
  '@crowdship/release': 'service',
  '@crowdship/settlement-feed': 'service',

  '@crowdship/web': 'app',
};

export const DEPENDENCY_POLICY: LayerSpec = {
  layers: LAYERS,
  assign: ASSIGN,
};
