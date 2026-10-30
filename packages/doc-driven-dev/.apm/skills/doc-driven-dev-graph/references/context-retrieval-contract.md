# Context Retrieval Contract

This contract defines how a caller retrieves artifact context progressively —
L0 route state, L1 metadata, L2 document bodies, and L3 bounded traversal —
so each delegate receives only the context it needs. Programmatic callers
inside this repository use `scripts/lib/artifact_context.ts`
(`listArtifactMetadata`, `fetchArtifactBodies`, `expandArtifactContext`);
agent callers reach the same functions through the `fetch_context.js` CLI.
All levels resolve through the Artifact Graph's scan and relation helpers —
there is no second index and no vector DB — and every refused lookup is
recorded as a finding, never silently dropped.

## Levels at a glance

| Level | Channel | Source | Carries | Never carries |
| --- | --- | --- | --- | --- |
| L0 | Route state | `route_graph.js` output | `GraphRoute` fields plus resolved focus | document bodies |
| L1 | Metadata | `fetch_context.js --metadata` | `path`, `id`, `type`, `status`, `relations` per record | `body` |
| L2 | Body fetch | `fetch_context.js --fetch` | validated `{path, id, body}` documents | unvalidated refs |
| L3 | Traversal | `fetch_context.js --expand` | bounded `{path, id, depth, via}` nodes | `body` |

## L0 — route state

`route_graph.js` returns the complete `GraphRoute` once per invocation (see
[graph-contract.md](graph-contract.md)): `status`, `current`/`next`, `edgeId`,
`condition`, `delegate`, `requiredAudits`, `blockers`, `commitGate`, and the
selected `taskGraph`, computed from a fresh Graph State projection whose
resolved `focus` is recorded on the `route-selected` trace event. This route
state is always available to the caller at every hop — it
is sufficient to run audits, dispatch the declared delegate, and evaluate
yield reasons. L0 carries no document bodies: it names artifacts, it does
not quote them.

## L1 — metadata

```bash
node .apm/skills/doc-driven-dev-graph/scripts/fetch_context.js \
  [--cwd <repo>] --metadata --focus <id-or-path> [--focus <id-or-path> ...] \
  [--task-dir <dir>] [--json]
```

Output: `{ "metadata": [...], "findings": [...] }`. Each metadata record is
`{ path, id, type, status, relations }` — never `body`. The result covers the
focus-resolved artifact chain (the same `resolveArtifactFocus` /
`selectArtifactChain` semantics the router uses — spec, ADR, design, plan,
tasks, and anchors), or the resolved focus paths when the focus names no
chain member, plus each included record's resolved typed-relation neighbors
one hop in both directions where declared. External references
(URI-scheme or `//` targets) are skipped because they are not local
artifacts. Records sort deterministically by `path`.

Use L1 when deciding which documents to read and when building handoff focus
lists — anywhere a path, ID, status, or relation answers the question.
Target selection follows the explicit `--focus` values plus typed relations
only: no proximity or filename guessing and no automatic focus completion.
On `focus-required` or `focus-invalid` the result carries no metadata.

| Finding code | Raised when |
| --- | --- |
| `focus-required` | No `--focus` was supplied. |
| `focus-invalid` | The supplied focus did not resolve to a unique artifact chain — unknown path, ambiguous ID, or multiple candidate chains. |
| `duplicate-id` | The scan found two records sharing one artifact ID (scan diagnostic, passed through). |
| `broken-relation` | A declared relation target does not resolve to a record — reported by the scan or by an included record's unresolved neighbor. |
| `ambiguous-target` | An included record's relation target is unresolvable because more than one record carries that ID. |

`--task-dir` adds its directory to the artifact scan set alongside the
canonical docs directories. The same selector is accepted by L2 and L3 and it
is containment-checked — see the guards below.

## L2 — body fetch

```bash
node .apm/skills/doc-driven-dev-graph/scripts/fetch_context.js \
  [--cwd <repo>] --fetch <path> [--fetch <path> ...] \
  [--id <path>:<id> ...] [--fingerprint <path>:<fp> ...] \
  [--task-dir <dir>] [--json]
```

Output: `{ "level": "L2", "documents": [...], "findings": [...] }`, where each
document is `{ path, id, body }` — `body` is the Markdown body without front
matter. Documents are emitted only for refs that pass validation, sorted by
`path`. L2 is required for a delegate's authoritative inputs: a handoff
canonical reference (`path`, `id`, `fingerprint`) maps to `--fetch <path>`
plus its `--id` and `--fingerprint` pins.

Pin semantics:

- `--id <path>:<id>` requires the resolved artifact ID to equal `<id>`; a
  mismatch refuses the ref with `id-mismatch`.
- `--fingerprint <path>:<fp>` requires the live `canonicalReference`
  fingerprint to equal `<fp>`; a mismatch refuses the ref with
  `stale-fingerprint`. A stale fingerprint means the document changed since
  the reference was taken — re-project and re-fetch; never reuse stale
  content.
- A pin naming a path not given via `--fetch`, or a second pin of the same
  kind for one path, is a caller error (`{ "error": ... }`, exit 1) — a pin
  must never be silently unenforced.

Each refused ref lands in `findings`, never in `documents`:

| Finding code | Raised when |
| --- | --- |
| `path-escape` | The ref is absolute or escapes the checkout (`..`). |
| `not-canonical` | The ref is not a canonical artifact doc — outside the canonical docs directories (`docs/ideas`, `docs/discovery`, `docs/specs`, `docs/designs`, `docs/plans`, `docs/tasks`, `docs/test-specs`, `docs/adr`, `docs/impl/ir`, `docs/impl/exp`) plus the resolved `--task-dir`, not `.md`, or a `README`/`index` file. |
| `not-found` | The ref does not exist as a file. |
| `unreadable` | The file does not parse as an artifact doc. |
| `id-mismatch` | `--id` does not equal the resolved artifact ID. |
| `stale-fingerprint` | `--fingerprint` does not equal the live fingerprint. |

## L3 — bounded traversal

```bash
node .apm/skills/doc-driven-dev-graph/scripts/fetch_context.js \
  [--cwd <repo>] --expand <id-or-path> [--relations <a,b,c>] \
  [--depth <n>] [--reason "<text>"] [--task-dir <dir>] [--json]
```

Output: `{ "nodes": [...], "findings": [...], "reason"?: <text> }`. Each node
is `{ path, id, depth, via }` — the expansion root at depth 0 (`via: null`),
then each discovered neighbor with the relation field name it was reached
through. Nodes sort deterministically by depth, then `path`. The supplied
`--reason` is echoed into the output for the audit trail.

Traversal is deterministic breadth-first over typed relations via
`resolveArtifactRelation`. The default relation set is the lineage set —
`implements`, `implemented-by`, `derives-from`, `derived-by`, `refines`,
`refined-by`; `--relations` accepts a comma-separated list of relation names
and must name at least one. `--depth` bounds the walk at a non-negative
integer, default `2`. The expansion root resolves by unique artifact ID
first, then by checkout-relative path. External references (URI-scheme or
`//` targets) are skipped as non-local. A visited set guarantees cycle
safety, and duplicate arrivals are suppressed.

L3 is allowed only when judgment needs more context than L0–L2 provide —
record the reason and the scope (`--relations`, `--depth`) with the call. Do
not expand by default, and do not guess: every per-lookup failure is reported
as a finding, never skipped silently.

| Finding code | Raised when |
| --- | --- |
| `duplicate-id` | The expansion root ID matches more than one record. |
| `not-found` | The expansion root does not resolve to an artifact. |
| `broken-relation` | A declared relation target does not resolve to a record. |
| `ambiguous-target` | A relation target is unresolvable because more than one record carries that ID. |
| `unused-relation` | An explicitly `--relations`-requested name is not declared on any scanned artifact record — almost certainly a typo, since traversal could never use it. |

`unused-relation` exists to catch misspelled relation names. "Declared" means
present in some record's relation keys anywhere in the scan set — a relation
used only on records outside the walk still counts as declared and produces no
finding. Only names the caller explicitly requested are checked; the default
lineage set is curated and is never reported.

## Guards and invariants

- **Fail closed.** Path escapes, missing documents, ambiguous targets,
  duplicate IDs, invalid focus, and stale fingerprints all produce findings —
  no lookup is silently dropped, guessed, or auto-corrected.
- **Runtime analysis is not the delegate body channel.** Audits that require
  whole-repo inspection (exit-audit / `doc-status`) keep their full scans;
  this contract governs document bodies passed to delegates, which is a
  separate channel.
- **Required inputs are always fetched.** Evidence and gate-required
  documents named by the handoff go through L2 validation — omission must
  fail, not silently drop a requirement.
- **One authority.** Every level reuses `scanArtifactGraph` records and
  `resolveArtifactFocus` / `selectArtifactChain` / `resolveArtifactRelation`
  semantics. There is no vector DB and no second artifact authority.
- **Explicit selection only.** L1 and L3 targets come from explicit focus and
  typed relations — never filename proximity or automatic focus completion.
- **Deterministic order.** Metadata records, documents, traversal nodes, and
  findings all sort deterministically; traversal is fixed-order BFS.
- **Refresh by re-projection.** When a fingerprint no longer matches, the
  caller re-projects and re-fetches — stale content is never reused.
- **Exactly one mode per invocation.** `--metadata`, `--fetch`, and
  `--expand` are mutually exclusive, and each supporting flag is valid only
  with its own mode — a foreign flag is a caller error, not something to
  drop.
- **One `--task-dir`, one scan set.** `--task-dir` selects the same custom
  task-doc directory at L1, L2, and L3, so a path L1 lists is never refused
  by L2 as `not-canonical` and L3 roots resolve in the same projection. The
  directory must resolve inside the checkout — the containment rule the
  artifact scan enforces. An escaping or absolute-outside value is a caller
  error raised before anything is read, identical at every level and on
  `route_graph.js`/`inspect_graph.js`, not a finding. Containment is checked
  by real path too: a symlinked directory inside the checkout that resolves
  outside is rejected the same way. The value is a recursive scan root —
  `.` (or an empty value) makes the checkout itself the task-doc scan set,
  walking everything including `node_modules`/`.git`; keep it a focused
  directory.

## CLI and exit codes

Output is always JSON on stdout; `--cwd` selects the checkout (default: the
current directory) and `--help` prints usage.

| Result | Output | Exit code |
| --- | --- | --- |
| Success, no findings | Mode result | `0` |
| Success with findings | Mode result with non-empty `findings` | `1` |
| CLI-level error — unknown flag, missing value, conflicting modes, malformed `--id`/`--fingerprint`/`--depth`/`--relations`, a `--task-dir` escaping the checkout, or a flag foreign to the mode | `{ "error": "..." }` on stdout; message and usage on stderr | `1` |

Findings are data — fail-closed refusals the caller must act on — not
crashes. A non-zero exit on findings is the contract; inspect `findings`
rather than retry blindly.

## Baseline measurement

`scripts/lib/context_metrics.ts` (`summarizeBaseline`) measures the channel
separation this contract exists to protect. `scan` counts runtime
artifact-scan reads — `filesRead` and `bytesRead` aggregated over
`artifact-scan` trace events, the allowed whole-repo projection channel.
`delegateInputs` counts the unique focus paths actually dispatched to
effects, summed by file size. `ratio` is `delegateInputs.bytes / scan.bytes`
(`0` when the scan read nothing). A third channel — in-process
`canonicalReference` fingerprint reads — is intentionally not counted in
`scan`; do not read `scan` as "all bytes read by the run".

The e2e harness attaches the result to `CaseRun.baseline` and serializes it
verbatim into the JSONL case report, plus the text report's `baseline` block,
so scan vs delegate-input separation is asserted deterministically on every
case run.

## Non-goals

- No token, cost, or LLM-quality evaluation — the contract governs
  deterministic retrieval, not model behavior.
- No new persistent store — Graph State and metadata remain per-invocation
  projections of canonical Markdown.
- No delegate wiring — which delegates call `fetch_context.js` is the host's
  dispatch decision; this contract defines the levels, the validation, and
  the failure semantics.
