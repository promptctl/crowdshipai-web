/**
 * The workspace dependency policy, as a mechanically-checked representation
 * rather than prose [FRAMING:representation]: every internal dependency edge
 * must point strictly *down* a declared stack of layers.
 *
 * That single rule encodes both halves of [LAW:one-way-deps] at once — direction
 * is declared (each package's layer) and there are no upward calls (an edge's
 * rank must strictly decrease) — and it makes cycles unrepresentable, since a
 * cycle would require an edge whose endpoints do not strictly decrease. So there
 * is no separate cycle check to keep in sync: the strict-rank invariant *is* the
 * acyclicity guarantee [LAW:single-enforcer].
 *
 * This module is the pure mechanism [LAW:effects-at-boundaries]: it knows nothing
 * about the filesystem. The enforcer test reads the real workspace and feeds it
 * here; the layer assignment that makes the rule concrete lives in `./layers.ts`.
 */

import ts from 'typescript';

export type LayerId = string;

/**
 * A layer in the stack. A layer's rank is its index in the declared order
 * (`LayerSpec.layers`): a higher-ranked layer may depend on a lower-ranked one,
 * never the reverse, and never a peer at equal rank.
 */
export interface Layer {
  readonly id: LayerId;
  readonly description: string;
}

export interface WorkspacePackage {
  readonly name: string;
  /** The `@crowdship/*` workspace packages this package declares as runtime deps. */
  readonly deps: readonly string[];
}

export interface LayerSpec {
  /** Layers in dependency order, lowest (most foundational) first. */
  readonly layers: readonly Layer[];
  /** Every workspace package's layer, keyed by package name. */
  readonly assign: Readonly<Record<string, LayerId>>;
}

/**
 * A way the real graph diverges from the policy. Carried as data so the enforcer
 * surfaces *every* divergence at once with a loud, actionable message
 * [LAW:dataflow-not-control-flow] [LAW:no-silent-failure].
 */
export type Violation =
  | { readonly kind: 'unranked-package'; readonly pkg: string }
  | { readonly kind: 'stale-assignment'; readonly pkg: string }
  | { readonly kind: 'unknown-layer'; readonly pkg: string; readonly layer: LayerId }
  | {
      readonly kind: 'illegal-edge';
      readonly from: string;
      readonly to: string;
      readonly fromLayer: LayerId;
      readonly toLayer: LayerId;
    };

/**
 * Check the actual dependency graph against the declared layering. Returns every
 * violation found; an empty array means the graph conforms.
 */
export function checkLayering(packages: readonly WorkspacePackage[], spec: LayerSpec): Violation[] {
  const violations: Violation[] = [];

  const rankOf = new Map<LayerId, number>();
  spec.layers.forEach((layer, rank) => rankOf.set(layer.id, rank));

  const packageNames = new Set(packages.map((p) => p.name));

  // Every assignment must name a real package and a real layer; every name that
  // appears in the graph (as a package or as a dependency target) must be ranked,
  // or an edge touching it would escape the rule unchecked.
  for (const [pkg, layer] of Object.entries(spec.assign)) {
    if (!packageNames.has(pkg)) violations.push({ kind: 'stale-assignment', pkg });
    else if (!rankOf.has(layer)) violations.push({ kind: 'unknown-layer', pkg, layer });
  }

  const graphNames = new Set<string>();
  for (const p of packages) {
    graphNames.add(p.name);
    for (const dep of p.deps) graphNames.add(dep);
  }
  const rankFor = (name: string): number | undefined => {
    const layer = spec.assign[name];
    return layer === undefined ? undefined : rankOf.get(layer);
  };
  for (const name of graphNames) {
    if (rankFor(name) === undefined) violations.push({ kind: 'unranked-package', pkg: name });
  }

  for (const p of packages) {
    const fromRank = rankFor(p.name);
    if (fromRank === undefined) continue; // already reported as unranked
    for (const dep of p.deps) {
      const toRank = rankFor(dep);
      if (toRank === undefined) continue; // already reported as unranked
      if (fromRank <= toRank) {
        violations.push({
          kind: 'illegal-edge',
          from: p.name,
          to: dep,
          fromLayer: spec.assign[p.name] as LayerId,
          toLayer: spec.assign[dep] as LayerId,
        });
      }
    }
  }

  return violations;
}

const WORKSPACE_SCOPE = '@crowdship/';

/**
 * Extract the `@crowdship/*` workspace packages a source file imports — the
 * *true* edges, as the code actually wires them.
 *
 * Delegates to the TypeScript compiler's own pre-processor rather than a regex
 * [LAW:one-source-of-truth]: "what counts as an import" is the language's
 * definition, not a second one we would have to keep in sync. So a specifier
 * hidden inside a string, comment, or template literal can never become a
 * phantom edge, and a real import can never be silently dropped by mishandled
 * lexical context [LAW:no-silent-failure].
 */
export function extractWorkspaceImports(source: string): string[] {
  const { importedFiles } = ts.preProcessFile(source, true, true);
  const found = new Set<string>();
  for (const { fileName } of importedFiles) {
    if (fileName.startsWith(WORKSPACE_SCOPE)) found.add(fileName);
  }
  return [...found].sort();
}
