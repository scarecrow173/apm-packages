# Evidence Store Contract v1

The Evidence Store (Issue `#240`) holds **Evidence Records** — the measured
outcomes of Verification Checks — as immutable, Git-untracked records.
Evidence is verification *result* data: it is not run state (that is the
Execution Store) and it is not durable knowledge (that is Markdown). An
Effect Receipt proves an effect *ran*; an Evidence Record records what a
check *concluded* — separate name, type, producing path, and judgment.

Runtime: `scripts/evidence_store.js` (source of truth:
`src/skills/lib/evidence_store/`). Every subcommand runs the shared schema
preflight first, exactly like every other normal entrypoint.

## Layout

```text
<checkout>/.apm/state/doc-driven-dev/      state root (Git-untracked)
├── runs/<run-id>/                         Execution Store (per-run state)
└── evidence/                              Evidence Store root
    ├── manifest.json                      write-once store manifest
    ├── index.json                         DERIVED aggregate index (regenerable)
    └── records/<evidence-id>.json         one immutable record per file
```

The store shares the Execution Store's state root, boundary rules
(gitignore coverage, containment, tracked-state probes), and per-worktree
default: records in one worktree are invisible elsewhere unless a shared
`stateRoot` is explicitly declared.

## Record schema (`records/<id>.json`, schemaVersion 1)

| Field | Meaning |
| --- | --- |
| `evidenceId` | unique record id (`EVID-<22-char base62>` or caller id); also the file name |
| `claim.ref` | qualified claim reference `<document-id>::<KEY>` (e.g. `SPEC-<id>::R-01`) |
| `claim.documentRevision` | `sha256:<hex>` digest of the claim's document at measure time |
| `check.ref` | qualified check reference `VD-<id>::CHK-NN` |
| `check.designRevision` | `sha256:<hex>` of the check's canonical payload at measure time |
| `subject` | `{ kind: "commit", commit }` or `{ kind: "workspace", snapshotDigest }` — what the outcome was measured against; `snapshotDigest` is the canonical subject digest (below) |
| `method` | verification method used (`unit`, `integration`, `e2e`, `property`, `static`, `model-checking`, `formal-proof`, `runtime-monitoring`, `manual-review`) |
| `provider` | `{ kind: repository\|ci\|external, name }` — which adapter produced the result |
| `runId` | producing Execution Store run, or `null` — context only, never run state |
| `environment` | freeform runner/os/toolchain description, stored as its JSON round-trip form — non-serializable values (circular, BigInt, functions) are refused `invalid-argument` |
| `outcome` | `passed`, `failed`, `inconclusive`, `error`, or `not-run` |
| `retention` | `transient`, `release`, or `durable` — the storage policy (below) |
| `artifacts` | recorded artifact references (below) |
| `derivedFrom` | source evidence id when this record was promoted from another, else `null` — written only by `promote`; intake that supplies it is refused |
| `createdAt` | ISO-8601 creation timestamp |

From a record you can always back-resolve: the claim/check it measured,
the pinned revisions it measured them at (`resolve <id>` reports
`currentRevision` vs the pin), and the subject commit or workspace digest.

### Artifacts

`{ uri, sha256, availability, retention, expiresAt }`.

- `uri` is normalized at write time — scheme lowercased, `file:` paths
  lexically resolved, bare paths treated as repo-relative POSIX. Unsafe
  schemes (`javascript:`, `data:`, `vbscript:`), absolute or escaping
  paths, and whitespace-bearing references refuse `invalid-argument`.
- `sha256` is the verified content digest (`sha256:<hex>`). It is required
  exactly when `availability` is `available` — an artifact claimed
  available without a digest is refused, so an unfetched reference can
  never masquerade as verified content.
- `availability`: `available` (fetched, digest-verified), `unverified`
  (recorded reference, never fetched — default when no digest is given),
  or `unavailable` (checked and known-inaccessible). `unverified` and
  `unavailable` references never support a `passed` reading.
- `retention` inherits the record's class by default; `expiresAt` is the
  artifact's retention deadline or `null`.

### Retention classes

- `transient` — working evidence tied to a run; safe to drop with it.
- `release` — evidence backing a release decision; kept until superseded.
- `durable` — long-term project evidence; kept indefinitely.

Retention is per-record (artifacts may carry their own deadline); the
write-once `manifest.json` records the store's location and the retention
vocabulary so consumers can find the Git-untracked records and apply the
right retention handling.

## Consistency model

- **Immutable.** `putImmutable` commits a record through a write-tmp +
  hardlink create — the link is the atomic create, so a reader only ever
  sees a complete file and exactly one of two racing writers wins. There
  is **no update or delete path** at any layer.
- **Idempotent re-put.** Putting the same id with identical content
  (`createdAt` excluded) is a no-op returning `duplicate: true`. Same id
  with different content is `record-conflict`.
- **No shared-file writes on the append path.** Parallel puts touch only
  their own `records/<id>.json` — concurrent appends cannot create a
  shared-file contention point.
- **Derived index.** `index.json` is rebuilt deterministically from the
  records dir by `reindex` (`recordCount`, per-outcome/retention/subject
  counts, and check/claim/run → evidence-id lists, `generatedAt` pinned to
  the newest record stamp). Same records, same bytes — delete and rebuild
  at will. Queries scan records directly and never consult it.
- **Crash recovery.** `*.tmp-*` leftovers are crash evidence, never
  content; `recover` removes them. A record file whose `evidenceId`
  disagrees with its file name is `corrupt-state`.

## Subject digests and promotion

A **subject digest** names the content a check was measured against. Both
subject kinds share one canonical algorithm so adapters on either side
compute comparable values:

```text
subjectDigest = "sha256:" + sha256("doc-driven-dev:subject-tree:v1:" + <git tree oid hex>)
```

Git's tree object id is the repository's own content identity — it covers
every tracked path, entry mode, and blob content recursively. The
namespaced sha256 wrapper normalizes the repo's object format (sha1 or
sha256 trees) into the record's fixed digest slot.

- `treeDigestOf(cwd, commit)` computes the commit side: it resolves
  `<commit>^{commit}^{tree}` through git, so the digest is *computed from
  an object that provably exists*, never asserted. It returns `null`
  when the commit does not resolve.
- `workspaceDigestOf(treeOid)` computes the workspace side: the measuring
  adapter snapshots the workspace it tested into a git tree oid — the
  documented recipe is a temporary index (`GIT_INDEX_FILE=<tmp>`)
  populated from the measured tree, then `git write-tree` — and records
  the returned digest as `subject.snapshotDigest`.

### Workspace → commit promotion

A workspace outcome is **never** silently treated as commit evidence. The
only promotion path is `promote <id> --commit <sha>`: the store resolves
the commit's tree through git — an object that must exist — computes its
canonical digest, and requires it to equal the record's `snapshotDigest`.
That is the content-identity check: both sides of the comparison are
computed through one algorithm, and the commit side is verified against
the object database. A digest mismatch refuses `subject-mismatch`; a
commit that does not resolve refuses `invalid-argument`; a commit-subject
record cannot promote. Promotion writes a NEW immutable record with
`derivedFrom` set — the original workspace evidence is untouched.

**Trust boundary, stated plainly:** the store verifies the *commit* side
in the object database and verifies that both digests were computed by
one canonical algorithm. It can never re-observe the workspace the
measurement ran against, so `snapshotDigest` remains adapter-attested —
promotion proves the recorded attestation and the commit name the same
content, not that the attestation was honest. Callers that need that
guarantee must trust the measuring adapter (or gate it out-of-band).

## Boundaries — refuse before writing

Same gates as the Execution Store: `/.apm/state/` ignore coverage must be
configured, no Git-tracked files may exist under the state root, and the
evidence root + records dir must realpath inside the resolved root — a
symlinked `evidence/` landing outside the root is `boundary-escape`. Record
ids match the shared filesystem-safe pattern, so an id can never become a
path escape.

On **case-insensitive filesystems** (default macOS/Windows), ids that
differ only in case still collide on disk: `EVID-A.json` and
`EVID-a.json` name one file. The store never merges them — a same-name
write is the usual append-once conflict (`record-conflict` for different
content), and a stored file whose `evidenceId` does not match its file
name is `corrupt-state`. The failure is fail-closed, not silent; callers
must not rely on case to distinguish ids.

## CLI

```bash
node .apm/skills/doc-driven-dev-graph/scripts/evidence_store.js <command> \
  --cwd <repo> [--state-root <path>] [--allow-external-root] [--json]
```

- `put --file <evidence.json> [--resolve]` — store a record; `--resolve`
  pins `claim.documentRevision`/`check.designRevision` from the live
  Knowledge Graph (either reference failing closed stops the put, and the
  check must target the record's claim).
- `get <id>` / `query [--check|--claim|--outcome|--retention|
  --subject-kind|--run-id]` / `manifest`
- `resolve <id>` — back-resolve the record: reference status +
  `matchesPinned` per claim/check, plus `checkTargetsClaim` — whether the
  resolved check's `target` equals the record's `claim.ref`.
- `promote <id> --commit <sha> [--as <new-id>]` — the store resolves and
  digests the commit's tree itself; no digest is taken on the command
  line.
- `reindex` — regenerate `index.json`; `recover` — drop tmp orphans.

Errors print `{ "error": <code>, "message": ..., "detail": ... }` with exit
1; the preflight gate exits 2. Codes: `boundary-gitignore`,
`boundary-git-unavailable`, `boundary-tracked`, `boundary-escape`,
`external-root-not-authorized`, `record-conflict`, `evidence-not-found`,
`subject-mismatch`, `corrupt-state`, `state-unwritable`,
`unsupported-version`, `invalid-argument`.

## Library API

`putImmutable / getById / query / buildIndex / rebuildIndex / promoteToCommit /
loadManifest / recoverEvidence / documentRevisionOf /
workspaceDigestOf / treeDigestOf` plus
`resolveEvidence / resolveEvidenceIn` (back-resolution, the interface
Evidence Assessment `#241` consumes) from `src/skills/lib/evidence_store`.
