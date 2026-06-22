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
    id: 'adapter',
    description:
      'Binds an adopted runtime or vendor to a core behind a seam (node/sqlite, TigerBeetle). May depend on cores and foundation.',
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
  '@crowdship/menu': 'core',
  '@crowdship/rate-limit': 'core',
  '@crowdship/settlement': 'core',

  '@crowdship/identity-node': 'adapter',
  '@crowdship/ledger': 'adapter',

  '@crowdship/pool': 'service',
  '@crowdship/purchase': 'service',
  '@crowdship/release': 'service',

  '@crowdship/web': 'app',
};

export const DEPENDENCY_POLICY: LayerSpec = {
  layers: LAYERS,
  assign: ASSIGN,
};
