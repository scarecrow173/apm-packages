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
- When `GraphRoute.condition` is `tasks-active`, the candidates are exactly
  `taskGraph.resumableActive`.
- Otherwise the candidates are `taskGraph.runnable`.
- A task absent from the candidate list is ineligible: it is never evaluated
  for a parallel OR a serial start by this judgment.

## Write Scope Declaration

Each task's `## Affected Files` section is the sole source of its declared
write scope:

- An entry ending in `/` or `/*` is a directory prefix; any other entry is an
  exact file path. Paths normalize to forward-slash repo-relative form.
- Absolute paths, `..` escapes, embedded `*`/`?` segments, and non-path prose
  (for example `auth module`) are unverifiable.
- A missing or empty `## Affected Files` section → `scope-undeclared` →
  serial.
- Any unverifiable entry → `scope-unverifiable` → serial. The judgment never
  infers scope from prose or guesses a likely path.
- The scope check matches the `Affected Files` heading literally
  (case-insensitive); a localized heading reads as a missing section and
  currently resolves to `scope-undeclared` → serial.

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
- Task document status or front-matter writes: a slice may update only its
  own task doc; scopes that overlap on task documents conflict.

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
- The same path touched by two slices → `write-collision` → `merge-review`.
  Last-writer-win is never accepted silently.

## Per-Slice Handoff

Every parallel slice receives a `DelegateHandoff` as defined in
[delegate-execution-policy](../../doc-driven-dev-graph/references/delegate-execution-policy.md),
bound to its own task:

| Field | Parallel binding |
| --- | --- |
| `focus` | The slice's own task document |
| `permissions.write` | Exactly the declared `## Affected Files` scope — nothing else |
| `acceptanceCriteria` | The task's `## Verification` checklist |
| `completion` | A completed `EffectOutcome` plus evidence that references the slice's own task ID |

## Merge Verification

Before slice results are accepted, verify each one
(`verifyParallelMerge`):

- **Scope** — actual touched paths stay within the declared scope. A
  violation targeting the task-document subtree (`docs/tasks/` by default,
  where status and front matter live) is `blocked`-severity; other
  out-of-scope paths are `merge-review`-severity.
- **Collision** — no two slices touched the same path.
- **Evidence binding** — every evidence path lives under `docs/impl/` or is
  the slice's own task doc, and its file content literally contains the
  slice's own task ID (`verifyEvidenceBinding`). `evidence-mismatch` is
  `blocked`-severity: one task's evidence can never be applied to another.

The merge verdict ladder is `merge` (clean) → `merge-review` (collisions or
non-task-doc scope violations) → `blocked` (evidence mismatch, task-doc scope
violation, malformed input).

After a clean merge, re-project the graph and re-evaluate gates:
`doc-status`, tests, and `requiredAudits` run as usual — a merge never skips
them, and an unverified task never becomes `done`. Canonical artifact
identity (ID, relations, status) must be intact.

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
node scripts/check_parallel.js --plan <path-or-id> [--cwd DIR] [--task-dir DIR] [--json]
node scripts/check_parallel.js --verify-merge <slices.json> [--cwd DIR] [--base-ref REF] [--task-dir DIR] [--json]
```

- `--plan` mode builds the Task Graph from the resolved plan artifact and
  prints a `ParallelReport`. Exit `0` when `decision` is `parallel`; `1` on
  `serial` or `blocked`.
- `--verify-merge` mode reads slice outcomes and prints a `MergeReport`.
  Exit `0` when `verdict` is `merge`; `1` otherwise.
- The two modes are mutually exclusive. `--cwd` defaults to the process
  working directory; `--task-dir` defaults to `docs/tasks`. `--help` (`-h`)
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
`[{ taskId, declaredScope, evidencePaths, taskDocPath, touchedPaths?, baseRef? }]`.
When `touchedPaths` is absent, the CLI collects the real diff with
`collectChangedPaths`; a slice-level `baseRef` wins over `--base-ref`
(default `HEAD`).

This contract covers repo-relative paths inside the repository only; shared
resources outside the checkout — services, shared directories, remote state —
remain the dispatcher's responsibility to serialize.
