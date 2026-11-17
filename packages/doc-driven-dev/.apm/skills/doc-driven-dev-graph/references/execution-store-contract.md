# Execution Store Contract v1

The Execution Store (Issue `#236`) holds per-run execution state — plans,
tasks, approvals, checkpoints, effect receipts, and run traces — outside
Git, so durable knowledge stays the only thing Markdown ever persists. It
is the only writer under `.apm/state/doc-driven-dev/` and is **not** a
second source of truth for durable knowledge.

Runtime: `scripts/execution_store.js` (source of truth:
`src/skills/lib/execution_store/`). Every subcommand runs the shared schema
preflight first, exactly like every other normal entrypoint.

## Layout

```text
<checkout>/.apm/state/doc-driven-dev/     state root (Git-untracked)
└── runs/<run-id>/                        one directory per run
    ├── manifest.json                     run manifest — the run-level CAS object
    ├── plan.md                           editable Markdown plan
    ├── tasks/<task-id>.json              task records — per-task CAS objects
    ├── checkpoints/<checkpoint-id>.json  append-once checkpoint records
    ├── receipts/<receipt-id>.json        append-once effect receipts
    ├── run_trace.jsonl                   appended diagnostics (never authoritative)
    └── writer.lock                       transient single-writer lock
```

The standard root is per-worktree: a run created in one worktree or clone
is invisible everywhere else unless it is explicitly transferred. A shared
root exists only when `stateRoot` resolves outside the checkout AND
`allowExternalRoot` is passed — the store never picks an outside location
on its own.

## Record schemas

### `manifest.json` (schemaVersion 1)

| Field | Meaning |
| --- | --- |
| `runId` | `<RUN>-<22-char base62>` or a caller-supplied valid id; also the directory name |
| `revision` | positive integer, +1 on every manifest write — the run-level CAS token |
| `status` | `active`, `completed`, or `aborted`; terminal statuses freeze the run |
| `graphId` | graph the run belongs to (default `doc-driven-dev`) |
| `focus` | caller-supplied opaque focus descriptor |
| `baseCommit` | `git rev-parse HEAD` at creation, or `null` outside a work tree |
| `planDigest` | SHA-256 of the current `plan.md`, or `null` |
| `approval` | `{ planDigest, actor, approvedAt }` or `null` |
| `createdAt` / `updatedAt` / `finalizedAt` | ISO-8601 timestamps |

### `tasks/<task-id>.json` (schemaVersion 1)

`{ runId, taskId, title, status, dependsOn, checks, version, createdAt,
updatedAt }`. `status` keeps the v2 vocabulary (`todo`, `in-progress`,
`blocked`, `done`, `wont-do`). `version` is the per-task CAS token.
`dependsOn` lists sibling task ids in the SAME run — entries containing
`:`/`/`/`\` are rejected as cross-run references, unknown ids and
self-dependencies fail closed. `checks` holds opaque VerificationCheck
references (`#239`).

### `checkpoints/<id>.json` and `receipts/<id>.json` (schemaVersion 1)

Append-once typed files. Checkpoint: `{ runId, checkpointId, nodeId,
edgeId, taskId, at, data }`. Receipt: `{ runId, receiptId, effect, taskId,
idempotencyKey, actor, status: success|failure|waived, at, input, output }`.
Re-recording identical content is an idempotent no-op (`at` is excluded
from the comparison); same-id different-content is a `record-conflict`.
A receipt proves an effect *ran* — it is not an Evidence Record of a check
outcome (`#240`).

## Consistency model

- **Single writer per run.** `writer.lock` (O_EXCL create, `{pid, hostname,
  acquiredAt}`) serializes every mutation. A live same-host holder, or any
  lock whose holder's host cannot be assessed, refuses with
  `writer-conflict`. A lock left by a dead local pid is recovered by the
  next writer.
- **CAS, not atomic rename alone.** Under the lock an operation re-reads
  the record, verifies `expectedRevision` (manifest) or `expectedVersion`
  (task), then writes. A stale expectation refuses with `cas-conflict` —
  updates are never silently lost.
- **Atomic replace + fsync.** Every committed file is written to a
  `*.tmp-<pid>-<n>` sibling, fsynced, renamed, and the directory is fsynced
  where the filesystem supports it. The manifest is always the commit
  point: a crashed write sequence leaves an incomplete dir or `*.tmp-*`
  evidence, never a torn file a reader would adopt.
- **Crash recovery.** `loadRun` reports `recovery.incompleteWrites`;
  `recover` removes `*.tmp-*` leftovers and re-validates every record.
  Partial or schema-invalid JSON is `corrupt-state` — it is reported and
  left in place, never adopted or silently deleted.

## Plan approval

`approve-plan` binds `{ planDigest, actor, approvedAt }` to the CURRENT
plan digest. `save-plan` invalidates the approval when the digest changes;
validity is computed on load (`approval.planDigest` must equal the current
file's SHA-256), so a stale approval cannot be reused even if `plan.md` is
edited outside the API.

## Boundaries — refuse before writing

- **Ignore coverage**: inside a work tree, `git check-ignore` must cover
  the root; outside Git, `.gitignore` files are evaluated directly
  (`.git/info/exclude`, root `.gitignore`, nested `.gitignore`s along the
  path, last match wins, ancestor-exclusion honored). `init` writes
  `/.apm/state/` itself and re-verifies.
- **Tracked state**: `git ls-files` must report nothing under `.apm/state/`
  — tracked execution state refuses.
- **Containment**: the root and run dirs must stay inside the checkout
  lexically and by real path; symlinked ancestors or run dirs that escape
  refuse. Run/task/record ids match `[A-Za-z0-9][A-Za-z0-9._-]{0,127}` plus
  Windows reserved-name rejection, so an id can never become a path escape.
- **Finalized runs** are read-only (`run-finalized`).

## Disposal and transfer

- `dispose` on an `active` run refuses `run-active` with a disposal
  inspection (final state, per-status task counts, approval, record counts)
  — the review happens before deletion. `force` plus an explicit `reason`
  discards it; a corrupt run that cannot be inspected disposes only via
  `force`.
- **Handoff is explicit.** `export` emits a single JSON document
  (`execution-run-export`, schemaVersion 1): runId, per-file SHA-256 +
  content, and a `payloadDigest` over the file list. `import` verifies the
  envelope digests, then the internal consistency (manifest validity,
  every record bound to the same runId, file names matching record ids,
  the approval → manifest → plan.md digest chain) before any write.
  Existing runs refuse (`import-conflict`) unless `onConflict: "replace"`;
  replacing an ACTIVE target additionally requires `force`.
- A run in another worktree fails closed as `run-not-found` — absence is
  the expected answer, never an error to paper over. Local state is not
  shared by copying; undeclared copies are not handoffs.

## CLI

```bash
node .apm/skills/doc-driven-dev-graph/scripts/execution_store.js <command> \
  --cwd <repo> [--state-root <path>] [--allow-external-root] [--json]
```

`init | create [run-id] | show <run-id> | list | save-plan --file |
approve-plan --actor | update --focus <json> | put-task --file
[--expect-version] | record-checkpoint --file | record-receipt --file |
trace --event <json> | finalize --status completed|aborted | dispose
[--force --reason] | recover | export --out <file> | import --file
[--on-conflict refuse|replace]`. CAS flags: `--expect-revision`,
`--expect-version`.

Errors print `{ "error": <code>, "message": ..., "detail": ... }` with exit
1; the preflight gate exits 2. Codes include `boundary-gitignore`,
`boundary-tracked`, `boundary-escape`, `external-root-not-authorized`,
`run-exists`, `run-not-found`, `run-active`, `run-finalized`,
`cas-conflict`, `expected-version-required`, `writer-conflict`,
`corrupt-state`, `unsupported-version`, `record-conflict`, `no-plan`,
`import-integrity`, `import-conflict`, `task-not-found`,
`invalid-argument`.

## Library API

`createRun / loadRun / listRuns / savePlan / approvePlan / updateRun /
updateTask / recordCheckpoint / recordReceipt / appendTrace / finalizeRun /
disposeRun / recoverRun / exportRun / importRun / initStateRoot` from
`src/skills/lib/execution_store` — same semantics as the CLI.
