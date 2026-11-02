# depmap

A monorepo is easy to lose track of: which packages actually
depend on which other packages in the set, what sits at the
top with nothing depending on it, what sits at the bottom
depending on nothing internal, and whether the internal
graph loops back on itself. depmap takes the package graph —
every package's name and the names it depends on — and draws
the whole map:

- **Per-package entries** — for every package, its internal
  dependencies (`depends_on`), the packages that depend on
  it (`depended_by`), and `external_count`: how many of its
  dependency names point outside the set. External names are
  counted, never mapped, and never an error — a package may
  freely depend on libraries the monorepo does not contain.
- **Edges, roots, and leaves** — every internal dependency
  as a `{from, to}` edge, the roots (packages nothing
  internal depends on), and the leaves (packages with no
  internal dependencies).
- **Cycles, two ways** — `cyclic_packages` lists every
  package that lies on any cycle: members of a strongly
  connected component of more than one package, plus any
  package that depends on itself. Alongside it, `cycle`
  reports one concrete cycle, found by a depth-first search
  that visits names and dependencies in ascending order. A
  cycle is a finding, not an error.
- **A Mermaid graph** — the map rendered as a `graph TD`
  diagram you can paste into any Mermaid renderer. Package
  names that are not valid Mermaid ids get a sanitised id
  (`@scope/app` becomes `_scope_app`) with a declaration
  line tying the id back to the real name.

Duplicate entries in one package's `dependencies` are
de-duplicated before mapping, and every list in the result
is sorted ascending, so the same graph always yields
exactly the same map. Malformed input — a missing or empty
package list, a missing or duplicate package name, a
wrongly typed field — is a validation error naming the
offending path (for example
`packages[1].dependencies[0] must be a string`), and no
partial map is produced. The computation is pure and
local: no network, no configuration, no files read beyond
the input you pass in.

## CLI

```bash
npx @reneturcios/depmap map --input args.json
npx @reneturcios/depmap --version
```

`args.json` contains the full arguments object:

```json
{
  "packages": [
    { "name": "core" },
    { "name": "lib", "dependencies": ["core"] },
    { "name": "app", "dependencies": ["lib", "react"] }
  ]
}
```

`dependencies` defaults to `[]` per package; here `react`
is external to the set, so it appears only in `app`'s
`external_count`. The map is printed as JSON:

```json
{
  "packages": [
    { "name": "app", "depends_on": ["lib"], "depended_by": [], "external_count": 1 },
    { "name": "core", "depends_on": [], "depended_by": ["lib"], "external_count": 0 },
    { "name": "lib", "depends_on": ["core"], "depended_by": ["app"], "external_count": 0 }
  ],
  "edges": [
    { "from": "app", "to": "lib" },
    { "from": "lib", "to": "core" }
  ],
  "roots": ["app"],
  "leaves": ["core"],
  "has_cycle": false,
  "cycle": [],
  "cyclic_packages": [],
  "mermaid": "graph TD\n  app --> lib\n  lib --> core"
}
```

Exit codes: `0` on success, `1` on a runtime error (including
an unreadable or invalid input file, or invalid input), `2`
on a usage error.

## MCP server

```bash
npx -y @reneturcios/depmap mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "depmap": {
      "command": "npx",
      "args": ["-y", "@reneturcios/depmap", "mcp"]
    }
  }
}
```

### Tools

- `map_internal_dependencies` — Map a monorepo's internal
  dependencies.
  - `packages` (array, required, at least one) — packages as
    `{name, dependencies?}` objects; `name` is unique across
    the set, and each `dependencies` entry either names
    another supplied package (internal) or anything else
    (external, counted only)

  Returns `{packages, edges, roots, leaves, has_cycle, cycle,
  cyclic_packages, mermaid}`.

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/depmap
docker run --rm -v "$PWD:/w" ghcr.io/cloudcorprecords/depmap map --input /w/args.json
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (pure local, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
