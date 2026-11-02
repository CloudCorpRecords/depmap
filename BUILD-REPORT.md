# depmap — Build Report

MCP Rebuild 1000, Batch 14. Original program build from the
packages-100 plan (cluster D #47), built from the spec in
`~/workspace/mcp-rebuild-100/specs-batch14/depmap.md`
(read first). There is no external original; the tool surface
is the program's defined spec. Local build only — nothing
pushed or published.

Identity: repo `depmap`, npm `@reneturcios/depmap`,
MCP name `io.github.CloudCorpRecords/depmap`, version
`0.1.0`, bin `depmap` → `dist/cli.js`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json`, `server.json` (description "Internal
  dependency map for monorepo packages, as structured
  data and a Mermaid graph.", 86 chars ≤100;
  npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/depmap:0.1.0` carries **no**
  `version` field), `Dockerfile` (node:20-alpine two-stage,
  label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/depmap"`),
  `tsconfig.json`, `.gitignore`, `LICENSE` (MIT, Copyright
  (c) 2026 Rene Turcios), `README.md` (fresh text),
  `CHANGELOG.md` (single 0.1.0 entry, 2026-10-27),
  `package-lock.json` (Route 3, see below)
- `src/index.ts`, `src/cli.ts` (`map --input <args.json>`
  where the file holds the full arguments object, `mcp`,
  `--version`; exit 2 usage / 1 runtime error, argument
  validation before any file read), `src/mcp.ts`,
  `src/types.ts`, `src/depmap.ts` (core,
  `VERSION = "0.1.0"`)
- `test/depmap.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (publish-container `IMAGE = ghcr.io/cloudcorprecords/depmap`,
  smoke-test server-name assertion `depmap`)

## Tools implemented (1)

- `map_internal_dependencies` — arguments: `packages`
  (array, required, minItems 1) of `{name (string, required,
  non-empty, unique), dependencies (array of strings,
  optional, default [])}`.

  Returns `{packages, edges, roots, leaves, has_cycle,
  cycle, cyclic_packages, mermaid}`. A dependency naming a
  supplied package is internal; any other name is external —
  counted per package as the number of distinct external
  names (`external_count`), never mapped, and never an
  error. Duplicate entries in one package's `dependencies`
  are de-duplicated before mapping. `packages` entries are
  sorted by name ascending (code-unit) and carry
  `depends_on` / `depended_by` (both internal only, sorted
  ascending); `edges` lists every internal dependency as
  `{from, to}` sorted by (from asc, to asc); `roots` are the
  packages with an empty `depended_by`; `leaves` are the
  packages with an empty `depends_on`.

  Cycles are reported two ways: `cyclic_packages` holds
  every package lying on any cycle (members of a strongly
  connected component of size > 1, plus any package with a
  self-edge; `has_cycle` is exactly "that list is
  non-empty"), while `cycle` holds the single first cycle
  found by a depth-first search visiting names in ascending
  order and expanding internal dependencies in ascending
  order (the stack slice from the repeated package to the
  top of the stack; a self-dependency reports `[name]`;
  `[]` when acyclic). The two can differ: a graph whose
  components merge several cycles reports all cyclic
  packages but only the first DFS cycle, and the tests pin
  that distinction.

  `mermaid` is a Mermaid graph string: line 1 `graph TD`;
  then, for every package whose Mermaid id differs from its
  name (sorted by name), a declaration line
  `  <id>["<name>"]`; then one `  <id(from)> --> <id(to)>`
  line per edge in edge order. `id(name)` replaces every
  character outside `[A-Za-z0-9_]` with `_`. Lines are
  joined with `"\n"`, no trailing newline; with no edges and
  no declarations the mermaid is exactly `"graph TD"`.

  The fixture literal
  (`harness/fixtures/depmap-tools-original.json`) and the
  `src/mcp.ts` literal are identical, with no `$schema`
  and no `additionalProperties`.

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with an
  explicit inputSchema literal exactly matching the fixture,
  per the standing fleet rule (no McpServer/zod schema
  conversion). Every `tools/call` is validated by the core
  itself, so the MCP and CLI paths share one validation
  implementation.
- Validation is path-naming and total: missing/empty
  `packages`, a package that is not an object, a package
  missing `name`, an empty or non-string name, a duplicate
  name, a non-array `dependencies`, or a non-string
  `dependencies` entry throws an Error naming the offending
  path (e.g. `packages[1].dependencies[0] must be a string`)
  and produces no partial result (MCP: `isError`; CLI:
  exit 1). Unlike a closed publish graph there is no
  unknown-package error: external names are a normal,
  counted part of the input.
- Strongly connected components are computed with Kosaraju's
  algorithm (both passes iterative, names visited in
  ascending order) purely for `cyclic_packages` membership;
  the reported `cycle` comes from a separate iterative DFS
  with an explicit stack and per-package dependency cursor
  that simulates the spec's ascending search exactly (same
  visit order, same first back-edge).
- A self-dependency is an internal edge like any other: it
  appears in `depends_on`, `depended_by`, and `edges`, makes
  the package neither a root nor a leaf, marks it cyclic,
  and reports `cycle: [name]`.

## Verification (foreground, this session)

- `npx tsc` exit 0 (`dist/cli.js` built)
- `npm test` (`tsx --test test/*.test.ts`): **31 tests,
  31 pass, 0 fail** — the exact full result for a linear
  chain, diamond edges sorted by (from, to), code-unit
  package sorting and input-order independence, multiple
  roots/leaves, omitted vs empty dependencies, external
  dependencies counted but never mapped and never errors,
  distinct-external counting, duplicate internal and mixed
  duplicate de-duplication, a simple 3-cycle, a
  self-dependency as a `[name]` cycle (also neither root nor
  leaf, with a self-edge), SCC membership strictly broader
  than the single reported DFS cycle (merged component and
  disjoint cycles), a tail into a cycle marking only the
  cycle members, a package depending on a cyclic package not
  itself cyclic, ascending dependency expansion for the
  reported cycle, an acyclic revisiting graph, Mermaid id
  sanitisation with declaration lines sorted by name,
  declarations only for renamed packages, digits/underscores
  kept in ids, the exact `"graph TD"` empty case,
  declarations without edges, a rendered self-edge with no
  trailing newline, and every validation path (missing/
  empty `packages`, non-object package, missing/empty/
  non-string name, duplicate name, non-array `dependencies`,
  non-string `dependencies` entry, and an explicit
  does-not-throw for external names)
- `dist/cli.js --version` → `0.1.0`; unknown command exits
  2 with usage; `map` with no `--input` exits 2;
  `map --input <missing file>` exits 1 naming the file;
  `map --input <valid file>` exits 0 and prints the map
  JSON (verified against a hand-checked scoped graph: an
  `app → lib → @scope/core` chain with `react` external to
  app — external_count 1 on app only, root `app`, leaf
  `@scope/core`, and the mermaid carrying the
  `_scope_core["@scope/core"]` declaration);
  `map --input <invalid file>` exits 1 with
  `packages[1].dependencies[0] must be a string`
- Parity: `harness/parity.py` vs
  `harness/fixtures/depmap-tools-original.json` →
  **PASS, parity 100.0, identical_tools 1/1** (run with the
  rebuild path as an absolute path; the harness does not
  expand a `~` inside the quoted stdio command string)

## Lockfile status

`package-lock.json` generated clean via Route 3 (temp copy
without `node_modules`/`dist`/`package-lock.json`, offline
`npm install --package-lock-only --ignore-scripts
--offline`), verified: parses, name
`@reneturcios/depmap`, **128 package entries**. Local
`node_modules` was installed via `npm install
--ignore-scripts --offline` for build/test; gitignored.

## Gaps / honest notes

- **Spec ambiguity — none in the core behaviour.** The one
  local choice worth recording: duplicate-name error
  wording is not fixed by the spec (only that the error
  names the offending path); the message used is
  `packages[<i>].name duplicates packages[<first>].name "<name>"`,
  matching the fleet pattern.
- **Empty-string dependency entries:** the spec requires
  `dependencies` entries to be strings and does not address
  `""`; it is treated as an ordinary external name (it can
  never equal a package name, since names are non-empty) and
  counted once per package like any other distinct external
  name. Not pinned by a test, as the spec does not fix this
  case.
- **Mermaid id collisions:** two distinct names can sanitise
  to the same id (e.g. `a-b` and `a_b`); the spec's rendering
  rules are followed literally and both declaration/edge
  lines are emitted as specified.
- Container build not exercised locally; the
  publish-container workflow smoke-tests the image at
  publish time.
- Nothing pushed or published; this is a local build only.
