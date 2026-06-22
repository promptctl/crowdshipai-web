import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  checkLayering,
  extractWorkspaceImports,
  type LayerSpec,
  type Violation,
  type WorkspacePackage,
} from './dependency-graph.js';
import { DEPENDENCY_POLICY } from './layers.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A discovered workspace package: its declared `@crowdship/*` runtime deps and what its src actually imports. */
interface DiscoveredPackage extends WorkspacePackage {
  readonly dir: string;
  readonly srcImports: readonly string[];
}

/** Parse the `packages/*`-style globs from pnpm-workspace.yaml — the one place that says where packages live. */
function workspaceGlobs(): string[] {
  const yaml = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
  const globs = [...yaml.matchAll(/^\s*-\s*['"]([^'"]+)['"]/gm)].map((m) => m[1] as string);
  if (globs.length === 0) throw new Error('no workspace globs found in pnpm-workspace.yaml');
  return globs;
}

/** Expand a `dir/*` glob to the package directories that actually contain a package.json. */
function packageDirs(glob: string): string[] {
  if (!glob.endsWith('/*')) throw new Error(`unsupported workspace glob (expected dir/*): ${glob}`);
  const parent = join(REPO_ROOT, glob.slice(0, -2));
  let entries: string[];
  try {
    entries = readdirSync(parent, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(parent, e.name));
  } catch {
    return []; // a declared workspace dir (e.g. services/) may not exist yet
  }
  return entries.filter((dir) => {
    try {
      readFileSync(join(dir, 'package.json'));
      return true;
    } catch {
      return false;
    }
  });
}

function workspaceImportsUnder(srcDir: string): string[] {
  let files: string[];
  try {
    files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  const found = new Set<string>();
  for (const rel of files) {
    if (!/\.tsx?$/.test(rel)) continue;
    const source = readFileSync(join(srcDir, rel), 'utf8');
    for (const name of extractWorkspaceImports(source)) found.add(name);
  }
  return [...found].sort();
}

function discoverPackages(): DiscoveredPackage[] {
  const packages: DiscoveredPackage[] = [];
  for (const glob of workspaceGlobs()) {
    for (const dir of packageDirs(glob)) {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        name: string;
        dependencies?: Record<string, string>;
      };
      const deps = Object.keys(manifest.dependencies ?? {})
        .filter((d) => d.startsWith('@crowdship/'))
        .sort();
      packages.push({
        name: manifest.name,
        dir,
        deps,
        srcImports: workspaceImportsUnder(join(dir, 'src')),
      });
    }
  }
  return packages;
}

function describeViolations(violations: readonly Violation[]): string {
  return violations
    .map((v) => {
      switch (v.kind) {
        case 'unranked-package':
          return `  - ${v.pkg}: no layer declared in architecture/layers.ts`;
        case 'stale-assignment':
          return `  - ${v.pkg}: layer declared but no such workspace package`;
        case 'unknown-layer':
          return `  - ${v.pkg}: assigned to unknown layer "${v.layer}"`;
        case 'illegal-edge':
          return `  - ${v.from} (${v.fromLayer}) -> ${v.to} (${v.toLayer}): edge does not point strictly down the stack [LAW:one-way-deps]`;
      }
    })
    .join('\n');
}

describe('workspace dependency graph', () => {
  const packages = discoverPackages();

  it('discovers the workspace packages', () => {
    // A floor so a broken discovery (wrong cwd, glob change) fails loudly here
    // rather than vacuously "passing" the layering check over zero packages.
    expect(packages.length).toBeGreaterThanOrEqual(5);
  });

  it.each(packages.map((p) => [p.name, p] as const))(
    '%s declares exactly the workspace packages its src imports',
    (_name, pkg) => {
      // Keeps the declared graph honest: package.json runtime deps must equal what
      // src actually imports, so the layering check below runs over the real graph
      // and not a stale declaration [LAW:one-source-of-truth].
      expect([...pkg.deps].sort()).toEqual([...pkg.srcImports].sort());
    },
  );

  it('has every internal dependency edge pointing strictly down the declared layers', () => {
    const violations = checkLayering(packages, DEPENDENCY_POLICY);
    expect(violations, `dependency policy violations:\n${describeViolations(violations)}`).toEqual([]);
  });
});

describe('checkLayering', () => {
  const spec: LayerSpec = {
    layers: [
      { id: 'low', description: '' },
      { id: 'mid', description: '' },
      { id: 'high', description: '' },
    ],
    assign: { a: 'low', b: 'mid', c: 'high' },
  };

  it('accepts edges that point strictly down', () => {
    const ok: WorkspacePackage[] = [
      { name: 'c', deps: ['b', 'a'] },
      { name: 'b', deps: ['a'] },
      { name: 'a', deps: [] },
    ];
    expect(checkLayering(ok, spec)).toEqual([]);
  });

  it('rejects an upward edge', () => {
    const up: WorkspacePackage[] = [
      { name: 'a', deps: ['c'] },
      { name: 'b', deps: [] },
      { name: 'c', deps: [] },
    ];
    expect(checkLayering(up, spec)).toContainEqual({
      kind: 'illegal-edge',
      from: 'a',
      to: 'c',
      fromLayer: 'low',
      toLayer: 'high',
    });
  });

  it('rejects a same-rank edge — which is how it forbids cycles', () => {
    const peers: LayerSpec = {
      layers: [{ id: 'only', description: '' }],
      assign: { x: 'only', y: 'only' },
    };
    const cycle: WorkspacePackage[] = [
      { name: 'x', deps: ['y'] },
      { name: 'y', deps: ['x'] },
    ];
    const violations = checkLayering(cycle, peers);
    expect(violations).toContainEqual({
      kind: 'illegal-edge',
      from: 'x',
      to: 'y',
      fromLayer: 'only',
      toLayer: 'only',
    });
    expect(violations).toContainEqual({
      kind: 'illegal-edge',
      from: 'y',
      to: 'x',
      fromLayer: 'only',
      toLayer: 'only',
    });
  });

  it('reports a package with no declared layer', () => {
    const orphan: WorkspacePackage[] = [{ name: 'z', deps: [] }];
    expect(checkLayering(orphan, spec)).toContainEqual({ kind: 'unranked-package', pkg: 'z' });
  });

  it('reports a dependency on a package with no declared layer', () => {
    const ghostDep: WorkspacePackage[] = [{ name: 'a', deps: ['ghost'] }];
    expect(checkLayering(ghostDep, spec)).toContainEqual({ kind: 'unranked-package', pkg: 'ghost' });
  });

  it('reports a stale assignment for a package that no longer exists', () => {
    expect(checkLayering([{ name: 'a', deps: [] }], spec)).toContainEqual({
      kind: 'stale-assignment',
      pkg: 'b',
    });
  });

  it('reports an assignment to an unknown layer', () => {
    const badSpec: LayerSpec = { layers: [{ id: 'low', description: '' }], assign: { a: 'nope' } };
    expect(checkLayering([{ name: 'a', deps: [] }], badSpec)).toContainEqual({
      kind: 'unknown-layer',
      pkg: 'a',
      layer: 'nope',
    });
  });
});

describe('extractWorkspaceImports', () => {
  it('finds static, type-only, side-effect, and dynamic imports', () => {
    const src = [
      `import { a } from '@crowdship/std';`,
      `import type { B } from '@crowdship/identity';`,
      `export { c } from '@crowdship/ledger-kernel';`,
      `import '@crowdship/rate-limit';`,
      `const m = await import('@crowdship/identity-node');`,
    ].join('\n');
    expect(extractWorkspaceImports(src)).toEqual([
      '@crowdship/identity',
      '@crowdship/identity-node',
      '@crowdship/ledger-kernel',
      '@crowdship/rate-limit',
      '@crowdship/std',
    ]);
  });

  it('finds a specifier split across lines', () => {
    const src = `import {\n  a,\n  b,\n} from '@crowdship/std';`;
    expect(extractWorkspaceImports(src)).toEqual(['@crowdship/std']);
  });

  it('does NOT treat a package merely named in a comment as an edge', () => {
    // The bug this guards: @crowdship/std's JSDoc names @crowdship/ledger-kernel
    // in prose; a substring scan would invent a std -> ledger-kernel edge.
    const src = [
      `/**`,
      ` * @crowdship/ledger-kernel should re-export these from @crowdship/std.`,
      ` */`,
      `// see import from '@crowdship/identity' (not a real import)`,
      `export const x = 1;`,
    ].join('\n');
    expect(extractWorkspaceImports(src)).toEqual([]);
  });

  it('does NOT treat an import-shaped string or template literal as an edge', () => {
    // A specifier that lives inside a data string is not an edge; a lexically
    // blind scanner would invent one [LAW:no-silent-failure].
    expect(extractWorkspaceImports(`const s = "import x from '@crowdship/std'";`)).toEqual([]);
    expect(extractWorkspaceImports('const t = `import x from \'@crowdship/std\'`;')).toEqual([]);
  });

  it('does NOT drop a real import because a comment marker hides in a nearby string', () => {
    // The dangerous false-negative: a `//` or unbalanced `/*` inside a string
    // must not swallow a genuine import line and silently erase the edge.
    expect(extractWorkspaceImports(`const u = 'a//b'; import x from '@crowdship/std';`)).toEqual([
      '@crowdship/std',
    ]);
    const acrossLines = [`const s = '/*';`, `import x from '@crowdship/std';`, `const e = '*/';`].join('\n');
    expect(extractWorkspaceImports(acrossLines)).toEqual(['@crowdship/std']);
  });
});
