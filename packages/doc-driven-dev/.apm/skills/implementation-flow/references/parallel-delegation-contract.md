# Parallel Delegation Safety Contract

This contract defines when `implementation-flow` may run independent Task
Graph entries as parallel subagent slices, and how their results are verified
on merge. Dependency independence in `taskGraph.edges` is a **necessary but
not sufficient** condition for parallel dispatch: a slice is parallel-safe
only when its declared write scope is verifiably disjoint from every other
candidate's. Serial execution is always a correct fallback — the judgment
never guesses a scope.

Programmatic callers use `scripts/check_parallel.js`
(`lib/parallel_safety.ts` for dispatch judgment, `lib/merge_verification.ts`
for merge verification); agent callers apply the same judgment order and the
same verdict vocabulary.

## Eligibility Authority

Task eligibility stays with the Task Graph projection; this contract never
reimplements or weakens `buildTaskGraph`:

- Non-empty `taskGraph.issues` → `blocked`. No slice dispatches — the
  judgment fails closed before any scope is read.
- When `taskGraph.resumableActive` is non-empty, the candidates are exactly
  `taskGraph.resumableActive` — resuming active work precedes starting new
  work.
- Otherwise the candidates are `taskGraph.runnable`.
- A task absent from the candidate list is ineligible: it is never evaluated
  for a parallel OR a serial start by this judgment.

## Write Scope Declaration

Each task record's `scope` field in the selected Execution Store run is the
sole source of its declared write scope — the same authority the Task Graph
projects as `node.scope`:

- An entry ending in `/` or `/*` is a directory prefix; any other entry is an
  exact file path. Paths normalize to forward-slash repo-relative form.
- Absolute paths, `..` escapes, embedded `*`/`?` segments, and non-path prose
  (for example `auth module`) are unverifiable.
- A missing or empty `scope` → `scope-undeclared` → serial.
- Any unverifiable entry → `scope-unverifiable` → serial. The judgment never
  infers scope from prose or guesses a likely path.
- Scope entries are strings on the record; the write API accepts any string
  and the readers classify them — an opaque entry fails closed at judgment
  time, never at write time.
- Paths compare case-insensitively (Windows dev environment); a case-only
  spelling drift never bypasses a scope or collision check.

## Conflict Classes

A pairwise write-scope overlap is a `write-conflict` and forces both tasks to
serial:

- The same file path declared by two tasks.
- A directory prefix in one scope containing a path in the other
  (`src/` versus `src/auth/login.ts`), including dir-versus-dir prefix
  containment.
- Shared generated files — indexes such as `docs/*/README.md`, lockfiles,
  shared configuration — declared by two or more tasks. Prefer not declaring
  them at all: assign generated-index updates to the serial merge phase.
- Task record status writes: task state lives in the Execution Store and is
  updated through `put-task` CAS only — it is never a writable repo path,
  so it can never appear in a slice's declared scope.

Any task involved in at least one conflict pair is serial (the safe side);
clean tasks may still run concurrently with each other. `decision` is
`parallel` only when two or more tasks cleared — a single clean task reports
`serial` because there is nothing to parallelize.

## Slice Isolation

Independent slices edit in separate worktrees or clones. After each slice
completes, collect its actual diff — `git diff --name-only` plus
`git status --porcelain` — and verify it is a subset of the declared scope:

- Renames report both source and destination paths, so a rename out of a
  protected path cannot masquerade as a pure addition.
- A touched path outside the declared scope → `scope-violation`.
- The slice's declared evidence artifacts under `docs/impl/` (the
  implementation record listed in `evidencePaths`) need no scope declaration
  because the contract already requires them. An undeclared `docs/impl/`
  write goes through normal scope verification like any other path.
- The Execution Store is never writable via a repo diff: a touched path
  inside the resolved state root (`.apm/state/doc-driven-dev/` by default)
  would bypass the record CAS that guards task status and scope —
  `scope-violation` at `blocked` severity, checked before any other scope
  rule.
- The same path touched by two slices → `write-collision` → `merge-review`.
  Last-writer-win is never accepted silently.

## Per-Slice Handoff

Every parallel slice receives a `DelegateHandoff` as defined in
[delegate-execution-policy](../../doc-driven-dev-graph/references/delegate-execution-policy.md),
bound to its own task record in the selected run:

| Field | Parallel binding |
| --- | --- |
| `focus` | The slice's own task identity — `(runId, taskId)` |
| `permissions.write` | Exactly the task record's declared `scope` — nothing else |
| `acceptanceCriteria` | The task record's `checks` |
| `completion` | A completed `EffectOutcome` plus evidence that references the slice's own task ID |

## Merge Verification

Before slice results are accepted, verify each one
(`verifyParallelMerge`):

- **Scope** — actual touched paths stay within the declared scope. The task
  record's `scope` in the selected run is the authority, and the claimed
  `taskId` binds to a run record before it grants anything: a slice naming a
  task absent from the run is `blocked` — tasks from another run (or
  invented ids) never bind scope. Every supplied `declaredScope` entry must
  then be covered by the bound record's declaration — an entry absent from
  or wider than the record's declaration is an inflated claim and blocks (a
  file entry in the record never covers a directory claim). A touched path
  inside the state root is `blocked`-severity; other out-of-scope paths are
  `merge-review`-severity.
- **Collision** — no two slices touched the same path.
- **Evidence binding** — every evidence path lives under `docs/impl/`, and
  its file content literally contains the slice's own task ID
  (`verifyEvidenceBinding`). `evidence-mismatch` is `blocked`-severity: one
  task's evidence can never be applied to another.

The merge verdict ladder is `merge` (clean) → `merge-review` (collisions or
non-store scope violations) → `blocked` (evidence mismatch, store-path
violation, unbound task ID, malformed input).

After a clean merge, re-project the graph and re-evaluate gates:
`doc-status`, tests, and `requiredAudits` run as usual — a merge never skips
them, and an unverified task never becomes `done`. Task status advances only
through `put-task` CAS on the run record; canonical artifact identity
(ID, relations, status) must be intact.

## Fallback Ladder

The contract degrades in one direction only:

1. **Serial fallback** — insufficient or conflicting information → run the
   tasks serially; never guess a scope.
2. **Merge review** — actual diffs collided or strayed out of scope → stop
   and review manually; never resolve by last-writer-win.
3. **Blocked / yield** — evidence cannot be bound or the verification input
   is malformed → `blocked`; return `yield` when the work cannot proceed
   within granted authority.

Parallel delegation never bypasses `commitGate` or `authority-required`:
each slice still satisfies the effect-outcome contract independently.

## CLI Contract

```text
node scripts/check_parallel.js --run <run-id> [--cwd DIR] [--state-root DIR] [--allow-external-root] [--json]
node scripts/check_parallel.js --verify-merge <slices.json> --run <run-id> [--cwd DIR] [--base-ref REF] [--json]
```

- `--run` is required in both modes and selects the Execution Store run whose
  task records supply eligibility and declared scopes. `--state-root`
  overrides store root resolution and `--allow-external-root` authorizes a
  root outside the checkout — the same store selectors as
  `route_graph.js` and `build_task_graph.js`.
- Default mode builds the Task Graph from the run and prints a
  `ParallelReport`. Exit `0` when `decision` is `parallel`; `1` on
  `serial` or `blocked`.
- `--verify-merge` mode reads slice outcomes and prints a `MergeReport`.
  Exit `0` when `verdict` is `merge`; `1` otherwise.
- The two modes are mutually exclusive. `--cwd` defaults to the process
  working directory. `--help` (`-h`)
  prints usage to stdout and exits `0`. With `--json`, errors print as
  `{"error": "..."}` on stdout; otherwise they print to stderr with usage —
  argument and runtime errors always exit `1`.

`ParallelReport` fields:

| Field | Content |
| --- | --- |
| `decision` | `parallel` \| `serial` \| `blocked` |
| `eligible` | candidate task IDs (`resumableActive`, else `runnable`) |
| `parallel` | task IDs safe to run concurrently |
| `serial` | `[{ id, reasons }]` — serial-only tasks; reasons are `scope-undeclared`, `scope-unverifiable`, `write-conflict` |
| `conflicts` | `[{ a, b, path }]` — the overlapping path between task `a` and `b` |
| `taskGraphIssues` | Task Graph issue codes when `blocked` |

`MergeReport` fields:

| Field | Content |
| --- | --- |
| `verdict` | `merge` \| `merge-review` \| `blocked` |
| `findings` | `[{ code, taskId?, path?, message }]` — codes are `scope-violation`, `write-collision`, `evidence-mismatch` |

A slices file is
`[{ taskId, declaredScope, evidencePaths, touchedPaths?, baseRef? }]`.
Supplied fields are **asserted, not trusted**: `taskId` must bind to a task
record in the run before it acts as authority, `declaredScope` is
re-verified against that record's `scope`, `touchedPaths` against the
declared scope plus the contract-implied evidence writes, and
`evidencePaths` against the evidence subtree and task-ID binding —
including a realpath check so a `docs/impl/` symlink cannot bind evidence
outside the checkout. Prefer
omitting `touchedPaths` so the verifier collects the real diff with
`collectChangedPaths`; a slice-level `baseRef` wins over `--base-ref`
(default `HEAD`) and must predate the slice — a base at or after the slice's
changes makes the collected diff incomplete rather than authoritative.

This contract covers repo-relative paths inside the repository only; shared
resources outside the checkout — services, shared directories, remote state —
remain the dispatcher's responsibility to serialize.
