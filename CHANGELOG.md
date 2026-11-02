# Changelog

## 0.1.0 (2026-10-27)

- Initial release: `map_internal_dependencies` MCP tool and
  `map` CLI command mapping a monorepo's internal
  dependencies.
- Per-package `depends_on` / `depended_by` / `external_count`
  entries, the full internal edge list, roots, and leaves —
  with external dependency names counted per package (distinct
  names only), never mapped and never an error, and duplicate
  dependency entries de-duplicated before mapping.
- Cycle reporting in two parts: `cyclic_packages` covering
  every package on any cycle (strongly connected components
  of size > 1 plus self-dependencies) and one concrete
  `cycle` from a deterministic ascending depth-first search.
- Mermaid rendering of the map (`graph TD`, sanitised ids
  with declaration lines for renamed packages), and
  path-naming validation errors for malformed input.
