/**
 * depmap core: internal dependency map for monorepo packages.
 *
 *   mapInternalDependencies(packages) -> map
 *
 * Behaviour:
 * - A dependency naming a supplied package is INTERNAL; any
 *   other name is EXTERNAL — counted per package (distinct
 *   names only), never mapped, and never an error. Duplicate
 *   entries in one package's `dependencies` are de-duplicated
 *   before mapping.
 * - `packages` in the result carries, per package sorted by
 *   name ascending (code-unit), its internal dependencies
 *   (`depends_on`, ascending), the packages that internally
 *   depend on it (`depended_by`, ascending), and its distinct
 *   external dependency count.
 * - `edges` lists every internal dependency as {from, to}
 *   (from depends on to), sorted by (from asc, to asc).
 *   `roots` are the packages with an empty `depended_by`;
 *   `leaves` are the packages with an empty `depends_on`.
 * - `cyclic_packages` are the packages lying on any cycle:
 *   members of a strongly connected component of size > 1,
 *   plus any package with a self-edge. `has_cycle` is true
 *   exactly when that list is non-empty.
 * - `cycle` is the first cycle found by a depth-first search
 *   that visits package names in ascending order and expands
 *   each package's internal dependencies in ascending order:
 *   the stack slice from the repeated package to the top of
 *   the stack. A self-dependency reports [name]; an acyclic
 *   graph reports []. A cycle is an analysis result, not an
 *   error.
 * - `mermaid` renders the map: line 1 is "graph TD"; then a
 *   declaration line `  <id>["<name>"]` for every package
 *   whose Mermaid id differs from its name (sorted by name);
 *   then one `  <id(from)> --> <id(to)>` line per edge in
 *   edge order. id(name) replaces every character outside
 *   [A-Za-z0-9_] with "_". Lines are joined with "\n" and
 *   there is no trailing newline; with no edges and no
 *   declarations the result is exactly "graph TD".
 *
 * Validation is strict and path-naming: any malformed input
 * throws an Error naming the offending path (for example
 * "packages[1].dependencies[0] must be a string") and no
 * partial result is produced.
 */
import type {
  DepMapEdge,
  DepMapPackage,
  DepMapPackageEntry,
  DepMapResult,
} from "./types.js";

export const VERSION = "0.1.0";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort(byCodeUnit);
}

/**
 * Validate the raw `packages` argument and return the
 * normalised package list (dependencies defaulted to [] and
 * de-duplicated). External names are kept at this stage; they
 * are separated from internal ones during mapping.
 */
function validatePackages(packages: unknown): DepMapPackage[] {
  if (packages === undefined) throw new Error("packages is required");
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new Error("packages must be a non-empty array");
  }

  const validated: DepMapPackage[] = [];
  const indexByName = new Map<string, number>();
  packages.forEach((raw, i) => {
    const path = `packages[${i}]`;
    if (!isRecord(raw)) throw new Error(`${path} must be an object`);
    if (raw.name === undefined) throw new Error(`${path}.name is required`);
    if (typeof raw.name !== "string" || raw.name.length === 0) {
      throw new Error(`${path}.name must be a non-empty string`);
    }
    const firstIndex = indexByName.get(raw.name);
    if (firstIndex !== undefined) {
      throw new Error(
        `${path}.name duplicates packages[${firstIndex}].name "${raw.name}"`,
      );
    }
    indexByName.set(raw.name, i);

    let dependencies: string[] = [];
    if (raw.dependencies !== undefined) {
      if (!Array.isArray(raw.dependencies)) {
        throw new Error(`${path}.dependencies must be an array`);
      }
      raw.dependencies.forEach((dep, j) => {
        if (typeof dep !== "string") {
          throw new Error(`${path}.dependencies[${j}] must be a string`);
        }
      });
      dependencies = [...new Set(raw.dependencies as string[])];
    }
    validated.push({ name: raw.name, dependencies });
  });

  return validated;
}

/** Mermaid id for a package name: unsafe characters become "_". */
function mermaidId(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * Strongly connected components of the internal graph, via
 * Kosaraju's algorithm with iterative depth-first searches:
 * a finishing-order pass over the dependency edges, then a
 * component pass over the reverse edges in reverse finishing
 * order. Both passes visit names in ascending order so the
 * components are deterministic (their membership is in any
 * case order-independent).
 */
function stronglyConnectedComponents(
  names: string[],
  dependsOn: Map<string, string[]>,
  dependedBy: Map<string, string[]>,
): string[][] {
  const visited = new Set<string>();
  const finishOrder: string[] = [];
  for (const start of names) {
    if (visited.has(start)) continue;
    // Stack entries are [name, next dependency index]; a node
    // is finished once all its dependencies are processed.
    const stack: Array<[string, number]> = [[start, 0]];
    visited.add(start);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const deps = dependsOn.get(frame[0]) as string[];
      if (frame[1] >= deps.length) {
        finishOrder.push(frame[0]);
        stack.pop();
        continue;
      }
      const dep = deps[frame[1]++];
      if (!visited.has(dep)) {
        visited.add(dep);
        stack.push([dep, 0]);
      }
    }
  }

  const assigned = new Set<string>();
  const components: string[][] = [];
  for (let i = finishOrder.length - 1; i >= 0; i--) {
    const start = finishOrder[i];
    if (assigned.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    assigned.add(start);
    while (stack.length > 0) {
      const name = stack.pop() as string;
      component.push(name);
      for (const dependent of dependedBy.get(name) as string[]) {
        if (!assigned.has(dependent)) {
          assigned.add(dependent);
          stack.push(dependent);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/**
 * The first cycle found by a depth-first search that visits
 * package names in ascending order and expands each package's
 * internal dependencies in ascending order, implemented
 * iteratively with an explicit stack and a per-package
 * dependency cursor. The first back-edge to a package on the
 * current stack gives the cycle as the stack slice from that
 * package to the top of the stack.
 */
function findCycle(
  names: string[],
  dependsOn: Map<string, string[]>,
): string[] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(names.map((n) => [n, WHITE]));

  for (const start of names) {
    if (color.get(start) !== WHITE) continue;
    const stack: string[] = [start];
    const nextDepIndex = new Map<string, number>([[start, 0]]);
    color.set(start, GRAY);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const deps = dependsOn.get(top) as string[];
      const idx = nextDepIndex.get(top) as number;
      if (idx >= deps.length) {
        color.set(top, BLACK);
        stack.pop();
        continue;
      }
      nextDepIndex.set(top, idx + 1);
      const dep = deps[idx];
      const depColor = color.get(dep);
      if (depColor === GRAY) {
        return stack.slice(stack.indexOf(dep));
      }
      if (depColor === WHITE) {
        color.set(dep, GRAY);
        stack.push(dep);
        nextDepIndex.set(dep, 0);
      }
    }
  }
  return [];
}

/** Map the internal dependencies of the supplied packages. */
export function mapInternalDependencies(packages: unknown): DepMapResult {
  const validPackages = validatePackages(packages);

  const known = new Set(validPackages.map((p) => p.name));
  const names = sorted(known);

  // Split each package's (de-duplicated) dependencies into
  // internal edges and a distinct external count.
  const dependsOn = new Map<string, string[]>();
  const externalCount = new Map<string, number>();
  for (const pkg of validPackages) {
    const internal: string[] = [];
    let external = 0;
    for (const dep of pkg.dependencies) {
      if (known.has(dep)) internal.push(dep);
      else external += 1;
    }
    dependsOn.set(pkg.name, internal.sort(byCodeUnit));
    externalCount.set(pkg.name, external);
  }

  const dependedBy = new Map<string, string[]>(
    names.map((n) => [n, [] as string[]]),
  );
  for (const pkg of validPackages) {
    for (const dep of dependsOn.get(pkg.name) as string[]) {
      (dependedBy.get(dep) as string[]).push(pkg.name);
    }
  }
  for (const list of dependedBy.values()) list.sort(byCodeUnit);

  const entries: DepMapPackageEntry[] = names.map((name) => ({
    name,
    depends_on: dependsOn.get(name) as string[],
    depended_by: dependedBy.get(name) as string[],
    external_count: externalCount.get(name) as number,
  }));

  const edges: DepMapEdge[] = [];
  for (const entry of entries) {
    for (const to of entry.depends_on) edges.push({ from: entry.name, to });
  }

  const roots = entries.filter((e) => e.depended_by.length === 0).map((e) => e.name);
  const leaves = entries.filter((e) => e.depends_on.length === 0).map((e) => e.name);

  // Cyclic packages: every member of a multi-package strongly
  // connected component, plus any package that depends on
  // itself (a component of one with a self-edge).
  const cyclic = new Set<string>();
  for (const component of stronglyConnectedComponents(names, dependsOn, dependedBy)) {
    if (component.length > 1) {
      for (const name of component) cyclic.add(name);
    }
  }
  for (const name of names) {
    if ((dependsOn.get(name) as string[]).includes(name)) cyclic.add(name);
  }
  const cyclicPackages = sorted(cyclic);

  const cycle = findCycle(names, dependsOn);

  const lines: string[] = ["graph TD"];
  for (const entry of entries) {
    const id = mermaidId(entry.name);
    if (id !== entry.name) lines.push(`  ${id}["${entry.name}"]`);
  }
  for (const edge of edges) {
    lines.push(`  ${mermaidId(edge.from)} --> ${mermaidId(edge.to)}`);
  }
  const mermaid = lines.join("\n");

  return {
    packages: entries,
    edges,
    roots,
    leaves,
    has_cycle: cyclicPackages.length > 0,
    cycle,
    cyclic_packages: cyclicPackages,
    mermaid,
  };
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}
