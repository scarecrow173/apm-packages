# Task 2 report

Implemented segment-first Mermaid label escaping for graph inspection output.

- Added a special-character fixture covering the requested node ID, delegate, audit, and condition key values.
- Added CR/LF, angle bracket, square bracket, brace, and backslash coverage, plus deterministic rendering and raw-pipe regression assertions.
- Replaced the old ampersand/quote-only helper with `escapeMermaidText`, applying replacements in the required order: ampersand, quote, pipe, angle brackets, CR/LF, backslash, square brackets, and braces.
- Escaped each user-defined label segment before joining with the renderer-owned `<br/>` markup.
- Escaped `edge.when` separately before appending the renderer-owned ` · pN` priority text.
- Preserved deterministic `nN` aliases and the existing reserved-ID, end, subgraph, style, and classDef regression.

Verification:

- RED confirmed before implementation: the special-character test failed because node IDs, delegates, audit pipes, and edge-condition pipes were not safely represented.
- `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-graph-inspector.test.ts tests/doc-driven-dev-graph-cli.test.ts` — 24 passed, 0 failed.
- `git diff --check` passes.

## Review round 1/5

- Added an explicit special-character assertion requiring literal renderer-owned `<br/>` markup between escaped node label segments.
- Re-ran the focused inspector and CLI suites: 24 passed, 0 failed.
