import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapInternalDependencies } from "../src/depmap.js";

/**
 * All tests are pure local computation over inline package
 * graphs: no filesystem, no network. Each behaviour in the
 * spec is pinned by its own case, including external
 * dependencies, cycles (SCC membership vs the single DFS
 * cycle), the Mermaid rendering, and the validation paths.
 */

const pkg = (name: string, dependencies?: string[]) => ({
  name,
  ...(dependencies !== undefined ? { dependencies } : {}),
});

describe("mapInternalDependencies — packages, edges, roots, leaves", () => {
  it("maps a linear chain with exact per-package entries", () => {
    const out = mapInternalDependencies([
      pkg("app", ["lib"]),
      pkg("lib", ["core"]),
      pkg("core", []),
    ]);
    assert.deepEqual(out, {
      packages: [
        { name: "app", depends_on: ["lib"], depended_by: [], external_count: 0 },
        { name: "core", depends_on: [], depended_by: ["lib"], external_count: 0 },
        { name: "lib", depends_on: ["core"], depended_by: ["app"], external_count: 0 },
      ],
      edges: [
        { from: "app", to: "lib" },
        { from: "lib", to: "core" },
      ],
      roots: ["app"],
      leaves: ["core"],
      has_cycle: false,
      cycle: [],
      cyclic_packages: [],
      mermaid: "graph TD\n  app --> lib\n  lib --> core",
    });
  });

  it("maps a diamond graph with edges sorted by (from, to)", () => {
    const out = mapInternalDependencies([
      pkg("app", ["right", "left"]),
      pkg("right", ["base"]),
      pkg("left", ["base"]),
      pkg("base"),
    ]);
    assert.deepEqual(out.edges, [
      { from: "app", to: "left" },
      { from: "app", to: "right" },
      { from: "left", to: "base" },
      { from: "right", to: "base" },
    ]);
    const base = out.packages.find((p) => p.name === "base");
    assert.deepEqual(base?.depended_by, ["left", "right"]);
    assert.deepEqual(out.roots, ["app"]);
    assert.deepEqual(out.leaves, ["base"]);
  });

  it("sorts package entries by name in code-unit order, independent of input order", () => {
    const out = mapInternalDependencies([pkg("zebra"), pkg("Alpha"), pkg("mid")]);
    assert.deepEqual(
      out.packages.map((p) => p.name),
      ["Alpha", "mid", "zebra"],
    );
    const graph = [pkg("b", ["a"]), pkg("a"), pkg("c", ["a"])];
    assert.deepEqual(
      mapInternalDependencies([...graph].reverse()),
      mapInternalDependencies(graph),
    );
  });

  it("reports multiple roots and leaves, both sorted ascending", () => {
    const out = mapInternalDependencies([
      pkg("a", ["b"]),
      pkg("c", ["b"]),
      pkg("b"),
      pkg("d"),
    ]);
    assert.deepEqual(out.roots, ["a", "c", "d"]);
    assert.deepEqual(out.leaves, ["b", "d"]);
  });

  it("treats an omitted dependencies field the same as an empty one", () => {
    const omitted = mapInternalDependencies([pkg("a"), pkg("b", ["a"])]);
    const explicit = mapInternalDependencies([pkg("a", []), pkg("b", ["a"])]);
    assert.deepEqual(omitted, explicit);
  });
});

describe("mapInternalDependencies — external dependencies", () => {
  it("counts external dependencies but never maps them and never errors", () => {
    const out = mapInternalDependencies([
      pkg("app", ["core", "react", "lodash"]),
      pkg("core", ["react"]),
    ]);
    const app = out.packages.find((p) => p.name === "app");
    const core = out.packages.find((p) => p.name === "core");
    assert.equal(app?.external_count, 2);
    assert.equal(core?.external_count, 1);
    assert.deepEqual(app?.depends_on, ["core"]);
    // The external react dependency does not make core internal,
    // and core is a leaf despite depending on react.
    assert.deepEqual(out.edges, [{ from: "app", to: "core" }]);
    assert.deepEqual(out.leaves, ["core"]);
    assert.deepEqual(out.roots, ["app"]);
    assert.equal(out.mermaid, "graph TD\n  app --> core");
  });

  it("counts each distinct external name once, however often it is listed", () => {
    const out = mapInternalDependencies([pkg("a", ["react", "react", "vue", "react"])]);
    assert.equal(out.packages[0].external_count, 2);
  });

  it("de-duplicates repeated internal dependency entries before mapping", () => {
    const out = mapInternalDependencies([pkg("a", ["b", "b", "b"]), pkg("b")]);
    assert.deepEqual(out.packages.find((p) => p.name === "a")?.depends_on, ["b"]);
    assert.deepEqual(out.edges, [{ from: "a", to: "b" }]);
    assert.deepEqual(out.packages.find((p) => p.name === "b")?.depended_by, ["a"]);
  });

  it("de-duplicates a mix of repeated internal and external entries together", () => {
    const out = mapInternalDependencies([
      pkg("a", ["ext", "b", "ext", "b"]),
      pkg("b"),
    ]);
    const a = out.packages.find((p) => p.name === "a");
    assert.deepEqual(a?.depends_on, ["b"]);
    assert.equal(a?.external_count, 1);
    assert.equal(out.edges.length, 1);
  });
});

describe("mapInternalDependencies — cycles", () => {
  it("reports a simple cycle: every member is cyclic and the DFS cycle lists them all", () => {
    const out = mapInternalDependencies([
      pkg("x", ["y"]),
      pkg("y", ["z"]),
      pkg("z", ["x"]),
    ]);
    assert.equal(out.has_cycle, true);
    assert.deepEqual(out.cyclic_packages, ["x", "y", "z"]);
    assert.deepEqual(out.cycle, ["x", "y", "z"]);
  });

  it("reports a self-dependency as a [name] cycle and a cyclic package", () => {
    const out = mapInternalDependencies([pkg("solo", ["solo"]), pkg("other")]);
    assert.equal(out.has_cycle, true);
    assert.deepEqual(out.cyclic_packages, ["solo"]);
    assert.deepEqual(out.cycle, ["solo"]);
    const solo = out.packages.find((p) => p.name === "solo");
    assert.deepEqual(solo?.depends_on, ["solo"]);
    assert.deepEqual(solo?.depended_by, ["solo"]);
    assert.deepEqual(out.edges, [{ from: "solo", to: "solo" }]);
    // A self-dependent package is neither a root nor a leaf.
    assert.deepEqual(out.roots, ["other"]);
    assert.deepEqual(out.leaves, ["other"]);
  });

  it("distinguishes SCC membership from the single reported DFS cycle", () => {
    // a <-> b and b <-> c put a, b and c in one strongly
    // connected component, so all three are cyclic; but the
    // DFS from a expands b first, whose first dependency (a)
    // is already on the stack, so the reported cycle is [a, b].
    const out = mapInternalDependencies([
      pkg("a", ["b"]),
      pkg("b", ["a", "c"]),
      pkg("c", ["b"]),
    ]);
    assert.deepEqual(out.cyclic_packages, ["a", "b", "c"]);
    assert.deepEqual(out.cycle, ["a", "b"]);
  });

  it("marks only the cycle members cyclic when a tail leads into a cycle", () => {
    const out = mapInternalDependencies([
      pkg("a", ["b"]),
      pkg("b", ["c"]),
      pkg("c", ["b"]),
    ]);
    assert.deepEqual(out.cyclic_packages, ["b", "c"]);
    assert.deepEqual(out.cycle, ["b", "c"]);
  });

  it("does not mark a package cyclic just for depending on a cyclic package", () => {
    const out = mapInternalDependencies([
      pkg("app", ["x"]),
      pkg("x", ["y"]),
      pkg("y", ["x"]),
    ]);
    assert.deepEqual(out.cyclic_packages, ["x", "y"]);
    assert.deepEqual(out.cycle, ["x", "y"]);
    assert.deepEqual(out.roots, ["app"]);
  });

  it("collects cyclic packages from disjoint cycles while reporting only the first DFS cycle", () => {
    const out = mapInternalDependencies([
      pkg("c", ["d"]),
      pkg("d", ["c"]),
      pkg("a", ["b"]),
      pkg("b", ["a"]),
      pkg("e", ["a"]),
    ]);
    assert.deepEqual(out.cyclic_packages, ["a", "b", "c", "d"]);
    assert.deepEqual(out.cycle, ["a", "b"]);
  });

  it("expands dependencies in ascending order when finding the reported cycle", () => {
    // a's dependencies are listed [c, b]; the search expands b
    // first (ascending), so the reported cycle goes through b.
    const out = mapInternalDependencies([
      pkg("a", ["c", "b"]),
      pkg("b", ["a"]),
      pkg("c", ["a"]),
    ]);
    assert.deepEqual(out.cycle, ["a", "b"]);
    assert.deepEqual(out.cyclic_packages, ["a", "b", "c"]);
  });

  it("reports no cycle for an acyclic graph that revisits finished packages", () => {
    const out = mapInternalDependencies([
      pkg("a", ["b", "c"]),
      pkg("b", ["d"]),
      pkg("c", ["d"]),
      pkg("d"),
    ]);
    assert.equal(out.has_cycle, false);
    assert.deepEqual(out.cycle, []);
    assert.deepEqual(out.cyclic_packages, []);
  });
});

describe("mapInternalDependencies — mermaid", () => {
  it("sanitises ids and emits declaration lines for renamed packages, sorted by name", () => {
    const out = mapInternalDependencies([
      pkg("@scope/app", ["@scope/core", "ext-lib"]),
      pkg("@scope/core"),
    ]);
    assert.equal(
      out.mermaid,
      'graph TD\n  _scope_app["@scope/app"]\n  _scope_core["@scope/core"]\n  _scope_app --> _scope_core',
    );
  });

  it("declares only the packages whose id differs from their name", () => {
    const out = mapInternalDependencies([pkg("my-pkg", ["plain"]), pkg("plain")]);
    assert.equal(out.mermaid, 'graph TD\n  my_pkg["my-pkg"]\n  my_pkg --> plain');
  });

  it("replaces every character outside [A-Za-z0-9_] in ids, keeping digits and underscores", () => {
    const out = mapInternalDependencies([
      pkg("pkg_2", ["a.b/c d"]),
      pkg("a.b/c d"),
    ]);
    // pkg_2 needs no declaration; "a.b/c d" becomes a_b_c_d.
    assert.equal(
      out.mermaid,
      'graph TD\n  a_b_c_d["a.b/c d"]\n  pkg_2 --> a_b_c_d',
    );
  });

  it('is exactly "graph TD" when there are no edges and no declarations', () => {
    assert.equal(mapInternalDependencies([pkg("solo")]).mermaid, "graph TD");
    assert.equal(
      mapInternalDependencies([pkg("a"), pkg("b")]).mermaid,
      "graph TD",
    );
  });

  it("emits declaration lines even when there are no edges", () => {
    const out = mapInternalDependencies([pkg("c.d"), pkg("a-b")]);
    assert.equal(out.mermaid, 'graph TD\n  a_b["a-b"]\n  c_d["c.d"]');
  });

  it("renders a self-edge and carries no trailing newline", () => {
    const out = mapInternalDependencies([pkg("loop", ["loop"])]);
    assert.equal(out.mermaid, "graph TD\n  loop --> loop");
    assert.equal(out.mermaid.endsWith("\n"), false);
  });
});

describe("mapInternalDependencies — validation", () => {
  it("rejects missing or empty packages", () => {
    assert.throws(() => mapInternalDependencies(undefined), /packages is required/);
    assert.throws(
      () => mapInternalDependencies([]),
      /packages must be a non-empty array/,
    );
    assert.throws(
      () => mapInternalDependencies("nope"),
      /packages must be a non-empty array/,
    );
  });

  it("rejects a package that is not an object, naming the path", () => {
    assert.throws(() => mapInternalDependencies([42]), /packages\[0\] must be an object/);
    assert.throws(
      () => mapInternalDependencies([pkg("a"), "b"]),
      /packages\[1\] must be an object/,
    );
  });

  it("rejects a package missing its name, naming the path", () => {
    assert.throws(
      () => mapInternalDependencies([{ dependencies: [] }]),
      /packages\[0\]\.name is required/,
    );
  });

  it("rejects an empty or non-string package name, naming the path", () => {
    assert.throws(
      () => mapInternalDependencies([pkg("")]),
      /packages\[0\]\.name must be a non-empty string/,
    );
    assert.throws(
      () => mapInternalDependencies([{ name: 42 }]),
      /packages\[0\]\.name must be a non-empty string/,
    );
  });

  it("rejects a duplicate package name, naming both paths", () => {
    assert.throws(
      () => mapInternalDependencies([pkg("a"), pkg("b"), pkg("a")]),
      /packages\[2\]\.name duplicates packages\[0\]\.name "a"/,
    );
  });

  it("rejects a non-array dependencies field, naming the path", () => {
    assert.throws(
      () => mapInternalDependencies([{ name: "a", dependencies: "core" }]),
      /packages\[0\]\.dependencies must be an array/,
    );
  });

  it("rejects a non-string dependencies entry, naming the path", () => {
    assert.throws(
      () => mapInternalDependencies([pkg("a", []), { name: "b", dependencies: [42] }]),
      /packages\[1\]\.dependencies\[0\] must be a string/,
    );
  });

  it("never rejects a dependency name outside the set: it is external, not unknown", () => {
    assert.doesNotThrow(() =>
      mapInternalDependencies([pkg("a", ["totally-external"])]),
    );
  });
});
