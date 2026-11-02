/**
 * depmap types.
 *
 * depmap maps the internal dependency structure of a monorepo.
 * The caller supplies the full package set — each package's
 * name and the names it depends on — and depmap reports, as
 * pure local computation:
 *
 *   - for every package, its internal dependencies
 *     (`depends_on`), the packages that depend on it
 *     (`depended_by`), and how many distinct dependency names
 *     point outside the set (`external_count`)
 *   - every internal edge, the roots (nothing internal
 *     depends on them), and the leaves (no internal
 *     dependencies)
 *   - whether the graph has a cycle, which packages lie on
 *     any cycle, and one concrete cycle
 *   - the whole map rendered as a Mermaid graph
 *
 * A dependency name that is not a supplied package is
 * external: it is counted, never mapped, and never an error.
 * Nothing is fetched, executed, or guessed: the map comes
 * only from the graph supplied.
 */

/** One package in the monorepo, as supplied by the caller. */
export interface DepMapPackage {
  /** Package name; unique across the supplied set. */
  name: string;
  /**
   * Names this package depends on. Names outside the supplied
   * set are external. Defaults to [] when omitted.
   */
  dependencies: string[];
}

/** One package's place in the internal dependency map. */
export interface DepMapPackageEntry {
  /** Package name. */
  name: string;
  /** Internal dependencies of this package, sorted ascending. */
  depends_on: string[];
  /** Packages that internally depend on this one, sorted ascending. */
  depended_by: string[];
  /** Number of distinct external names in this package's dependencies. */
  external_count: number;
}

/** One internal dependency edge: `from` depends on `to`. */
export interface DepMapEdge {
  from: string;
  to: string;
}

/** The internal dependency map. */
export interface DepMapResult {
  /** Per-package entries, sorted by name ascending. */
  packages: DepMapPackageEntry[];
  /** Every internal edge, sorted by (from asc, to asc). */
  edges: DepMapEdge[];
  /** Packages nothing internal depends on, sorted ascending. */
  roots: string[];
  /** Packages with no internal dependencies, sorted ascending. */
  leaves: string[];
  /** True when at least one package lies on a cycle. */
  has_cycle: boolean;
  /**
   * The first cycle found by a depth-first search that visits
   * names in ascending order and expands internal dependencies
   * in ascending order; [] when the graph is acyclic.
   */
  cycle: string[];
  /**
   * Packages lying on any cycle: members of a strongly
   * connected component of size > 1, plus any package with a
   * self-edge. Sorted ascending.
   */
  cyclic_packages: string[];
  /** The map as a Mermaid graph string ("graph TD" ...). */
  mermaid: string;
}
