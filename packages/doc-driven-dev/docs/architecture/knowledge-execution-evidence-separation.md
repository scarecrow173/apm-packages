# Architecture: Knowledge / Execution / Evidence Separation

Maintainer-facing architecture documentation for the `doc-driven-dev` redesign
tracked by `#232` and its child issues `#233`–`#249`. This document organizes
the agreed content of those issues into a single reference: the current (v2)
architecture, the target (v3) architecture, and the mapping between them.

Normative sources: `#232` (parent contract and acceptance criteria) and the
child issues listed in §6. Where this document and an issue disagree, the
issue wins. Code-level authorities for the current architecture are the Graph
Definition (`graphs/doc-driven-dev.yaml`), the contracts under
`.apm/skills/doc-driven-dev-graph/references/`, and the shared library under
`scripts/doc-driven-dev/src/skills/lib/`.

## 1. Purpose

The current `doc-driven-dev-graph` treats durable knowledge (Spec / Design /
ADR / Discovery), transient execution state (Plan / Task / approvals /
checkpoints), implementation history (IR / EXP), and verification intent and
outcomes as one Git-tracked Markdown Artifact Graph. `#127` showed the cost:
document volume grows, shared Markdown becomes an update-contention point, and
execution state is mixed with long-term knowledge in a single responsibility
boundary. `#232` resolves this by separating the data model's
responsibilities, not by archive/index tuning alone.

Goals (from `#232`):

1. Concentrate Git-tracked content on persistent knowledge, specifications,
   design, decisions, and verification design — the **Knowledge Graph**.
2. Move Plan / Task / approvals / Checkpoints / Effect Receipts to a
   Git-untracked **Execution Store**, preserving parallel execution, resume,
   and verifiable idempotency.
3. Split verification *intent* (**Verification Design**) from verification
   *outcomes* (**Evidence Record**), tracking Claim / Check / subject
   revisions.
4. Make Graph State a **derived projection** of Knowledge / Execution /
   Evidence, keeping Graph Definition v3's one-edge routing and caller-owned
   run-to-yield.
5. On detecting the old format, **Schema Preflight stops normal execution and
   directs to explicit Migration**. No backward-compat parsers, no v2 graph
   co-existence, no legacy document fallback in normal runs.

## 2. Current architecture (v2)

### 2.1 Four layers

- **Execution Graph** — `graphs/doc-driven-dev.yaml`, `schemaVersion: 2`.
  Declared nodes (`probe`, `migration`, `bootstrap`, `briefing`, `design`,
  `planning`, `task-graph`, `implementation`, `followup-triage`,
  `exit-audit`, `complete`), edges with unique priorities, a generic
  condition DSL (`signal` / `gate` / `task-graph` predicates), delegate and
  audit bindings, and `commitGate` declarations. `route_graph.js` returns at
  most one declared edge per invocation, a terminal result, or a fail-closed
  same-node blocked result; it never follows a second edge.
- **Artifact Graph** — canonical Markdown artifacts: typed IDs
  (`<PREFIX>-<22-char Base62>`), per-type `status` vocabularies, and
  front-matter `relations`. Relations are an undifferentiated vocabulary
  stored manually in both directions (`implements` / `implemented-by`,
  `derives-from` / `derived-by`, `verifies` / `verified-by`,
  `supersedes` / `superseded-by`, `refines` / `refined-by`, `defers` /
  `deferred-by`, plus `source`, `depends-on`, `blocks`, `related`,
  `references`).
- **Graph State** — a fresh per-invocation projection (`schemaVersion: 2`)
  of the Artifact Graph: resolved focus, gate results, caller signals,
  sorted blockers, and the selected Task Graph. Derived, not stored.
- **Dynamic Task Graph** — a deterministic read-only projection of a focused
  plan's task documents (`docs/tasks`): `active` / `resumableActive` /
  `runnable` / `blocked` / `idle` with fail-closed handling of duplicate IDs,
  unresolved references, cycles, malformed relations, and empty selections.

### 2.2 Persistence model

Every artifact class is Git-tracked Markdown; Markdown is the durable
history and the status authority. There is exactly one persistence class.

| Type | Canonical dir | Role | Status vocabulary |
| --- | --- | --- | --- |
| `idea` | `docs/ideas` | captured raw ideas | draft, exploring, promoted, parked, archived, superseded |
| `brainstorm` | `docs/discovery` | brainstorming output | capturing, confirmed, routed, superseded |
| `discovery` | `docs/discovery` | exploration / framing | draft, active, resolved, archived, superseded |
| `spec` | `docs/specs` | requirements | draft, proposed, approved, implemented, superseded, rejected |
| `design` | `docs/designs` | design docs | draft, approved, superseded, rejected |
| `adr` | `docs/adr` | decisions (MADR) | proposed, accepted, rejected, deprecated, superseded, draft |
| `test-spec` | `docs/test-specs` | verification *intent* | draft, proposed, approved, deprecated, superseded |
| `plan` | `docs/plans` | execution plan | draft, approved, in-progress, blocked, completed, superseded |
| `task` | `docs/tasks` | execution unit + DAG | todo, in-progress, blocked, done, wont-do |
| `ir` (impl record) | `docs/impl/ir` | per-task implementation record | impl-doc owned |
| `exp` (experiment log) | `docs/impl/exp` | JSONL experiment events | impl-doc owned |

The type registry (`lib/doc_types.ts`) declares dirs, aliases, ID prefixes,
and status vocabularies; `lib/doc_ownership.ts` assigns each canonical dir an
owner (`doc-suite`, `adr-doc`, `impl-doc`), mutator/auditor allowlists, and
index format. `docs/impl` is an owned scope with no resident types. Per-type
`status` is the only lifecycle axis — there is no separate `lifecycle` field.

README / INDEX files are **derived materialized views** regenerated by
`doc-maintenance` writers per owning directory (`#194`); they are never
canonical.

### 2.3 Execution model

The caller owns a bounded **run-to-yield** loop (`execution-contract.md`):

1. `route_graph.js` returns one `GraphRoute` for `current`.
2. Run declared audits in stable order; dispatch only the returned delegate.
3. Persist completion / gate / follow-up evidence in the run's
   **Execution Store** — accepted outcomes become Effect Receipts
   (`receipts/`) and the edge becomes a checkpoint (`checkpoints/`); the
   caller pins `--task-dir docs/tasks` as its task-budget anchor.
4. Re-project and continue (`run-until-yield`) or stop (`single-step`).

Around that loop:

- **Yield table**: `terminal`, `approval-required`, `input-required`,
  `authority-required`, `unrecoverable-blocker`, `budget-exhausted`,
  `commit-required`.
- **Commit gate**: declared per node (`implementation`); captures a
  `{ head, dirty }` worktree baseline before effects, retained on the pending
  edge across mid-edge yields; `commit-waived` is the declared bypass.
- **Bounded autonomy**: `maxHops` (topology base + frozen task budget),
  route-fingerprint loop detection, per-edge and run-level dispatch budgets.
- **Resume**: re-projects Markdown; a stage is skipped only when canonical
  evidence or a provider idempotency proof shows completion, else
  `authority-required`.
- **Run trace** (`run_trace.jsonl`): caller- and CLI-emitted JSONL events;
  strictly non-authoritative diagnostics.

Checkpoint completion, effect receipts, and run progress therefore live in
the same Git-tracked Markdown as durable knowledge.

### 2.4 Verification model

`test-spec-doc` produces `docs/test-specs/` — verification *intent*
(Feature / Rule / Example linked to specs, designs, or ADRs). Results are
not a first-class artifact: the `implementation` gate requires selected tasks
resolved plus the caller-provided `implementation-verified` **signal** —
effectively a boolean attestation. There is no tracking of *which* claim a
check verified, at *which* document/check revision, or against *which* commit
or workspace state. IR/EXP bodies carry the narrative record.

### 2.5 Skill and ownership map

- Orchestration: `doc-driven-dev-graph` (sole graph-wide router),
  `briefing-flow`, `planning-flow` (graph-delegated subgraph sequencing
  `plan-doc` → approval yield → `test-spec-doc` → `task-doc`),
  `implementation-flow` (SDP `flow_stack`; `impl-doc` is an always-on
  `implementation_documentation` slot).
- Document-generation skills own their contracts: `idea-doc`,
  `discovery-doc`, `adr-doc`, `spec-doc`, `design-doc`, `plan-doc`,
  `task-doc`, `test-spec-doc`, `impl-doc`. `deep-dive` is an interview skill,
  not a document owner.
- Inspection/maintenance: `doc-status` (read-only list/lint/audit/health),
  `doc-maintenance` (explicit preview→apply repairs, index materialization,
  `migrate_docs` / `migrate_ids`), `doc-dashboard` (offline HTML snapshot).
- `skill-discovery-protocol` builds the flow-neutral catalog and flow
  profiles consumed by flow adapters.

### 2.6 Structural problems this architecture causes

- **One persistence class for two lifetimes.** Transient per-run state
  (plans, tasks, checkpoints, receipts) is committed as durable history, so
  `#127`-scale document growth is structural, and parallel work contends on
  the same tracked files.
- **Mixed responsibilities in one graph.** Knowledge, execution state, and
  verification facts share the Artifact Graph and its gate evaluations, so
  focus resolution and gate evidence depend on artifacts unrelated to the
  active work (e.g. other plans' task counts).
- **Verification results are not modeled.** `implementation-verified` is a
  caller signal; nothing ties an outcome to a claim, a check revision, or a
  subject commit/workspace — stale or unrelated results can be attested as
  current.
- **Always-on history generation.** `impl-doc` fires for every task, so
  IR/EXP accumulate regardless of whether durable knowledge resulted.
- **Untyped bidirectional relations.** Hand-maintained inverse pairs drift
  and legacy fields (`derives-from` et al.) have ambiguous semantics that
  cannot be machine-remapped safely.
- **No schema gate.** Nothing distinguishes a current repo from a legacy
  one at the CLI boundary.

## 3. Target architecture (v3)

### 3.1 Three stores, everything else derived

```text
 Git-tracked (durable)          Git-untracked (local / explicit handoff)
 ┌───────────────────────────┐  ┌────────────────────────────────────────┐
 │ Knowledge Graph           │  │ Execution Store                        │
 │  docs/specs designs adr   │  │  .apm/state/doc-driven-dev/runs/<id>/  │
 │  discovery ideas          │  │   manifest · plan.md · tasks           │
 │  docs/knowledge           │  │   checkpoints · receipts · trace       │
 │  docs/verification        │  └────────────────────────────────────────┘
 │  docs/.doc-driven-dev/    │  ┌────────────────────────────────────────┐
 │    schema.json            │  │ Evidence Store                         │
 └───────────────────────────┘  │  immutable Evidence Records + artifact │
        │                       │  refs; retention: transient/release/   │
        ▼                       │  durable (location tracked in manifest)│
        └──── derived ─────────►└────────────────────────────────────────┘
                  │
                  ▼
   Graph State v3 · Dynamic Task Graph (read-only, per Run)
   Verification Summary · Indexes · Dashboard · doc-status findings
```

The split is by **lifetime and trust boundary**, not by file format: durable
knowledge stays in Git; per-run execution state and verification results move
to stores with their own consistency rules; every view over them is derived
and regenerable.

### 3.2 Document Registry v3 (`#234`)

One registry is the single authority for document types, storage, status,
lifecycle, ownership, and allowed relations — replacing `doc_types.ts` +
`doc_repository.ts` + `doc_ownership.ts` as separate partial authorities.

- Per type: `persistence: durable | ephemeral | evidence | derived`,
  canonical dir, aliases, `idPrefix`, type-specific `status`, `lifecycle`,
  index owner, required fields, allowed relations.
- New durable types: **Knowledge** (`docs/knowledge`,
  `knowledge_kind: codebase | architecture | operation | lesson`) and
  **Verification Design** (`docs/verification`).
- `lifecycle: draft | current | superseded | retired` is a separate axis from
  type `status`; unknown lifecycle is never silently treated as `current`.
- Plan / Task become Execution types and leave the canonical document set —
  they can no longer be created as durable documents. IR/EXP are legacy-only.
- The 22-char Base62 ID mechanism is reused; ADR owner boundaries and the
  shared/owner-specific index contract are preserved.

### 3.3 Knowledge Relations v1 (`#235`)

- **Claim IDs** (`SPEC-<id>::R-01`) are stable under heading/body edits and
  unique per document; duplicates, deletions, and cross-document moves are
  detected.
- Typed **unidirectional** relations, stored only source→target:
  `motivates` (idea/discovery→spec), `decides-for` (ADR→spec/design),
  `realizes` (design→spec), `informs` / `explains` (knowledge→doc),
  `supersedes` (between durables). Reverse links are always derived.
- `checks` (VD→claim) derives from check `target`; `supported-by`
  (claim←evidence) derives from the Evidence Store. No relation is stored in
  both front matter and body.
- Lint: allowed source/target matrix, claim existence, cycles, duplicates,
  unresolved references. Legacy relations are migration input only — never
  force-mapped to new semantics.
- The Knowledge Graph is stable under Plan/Task/Evidence volume and ordering.

### 3.4 Execution Store v1 (`#236`–`#238`)

Root: `.apm/state/doc-driven-dev/runs/<run-id>/` per worktree (gitignored);
shared roots only on explicit configuration.

- **Run manifest**: runId, revision, base commit, graph id, focus, approval
  digest, status.
- **Plan**: editable Markdown inside the run; approval is bound to plan
  digest + actor + time — editing the plan invalidates the approval.
- **Task**: ID, status, `dependsOn`, check references, version; referenced
  as `(runId, taskId)` — never a bare global task ID.
- **Checkpoint / Receipt / Trace**: typed separate files; `run_trace.jsonl`
  remains non-authoritative diagnostics.
- Consistency: CAS on run and task, per-run single writer, atomic replace +
  fsync, crash-resume with partial-write detection. CAS conflicts refuse the
  update — no lost updates.
- Portability: local by default; worktree/machine handoff requires explicit
  export/import or a declared shared store, with authorization, conflict,
  and snapshot-integrity checks. Disposing an active run requires final-state
  and handoff inspection.

Into this store move (`#237`, `#238`):

- **Planning Flow + Task Graph**: plan approval → task materialization inside
  the run; Task Graph is a read-only deterministic projection of the run
  snapshot, preserving the v2 semantics (`active` / `runnable` /
  `resumableActive` / `blocked` / `idle`, fail-closed on cycle/duplicate/
  unresolved/empty, `wont-do` never satisfies a dependency). Tasks from
  different runs or worktrees never mix.
- **Caller Effect Receipts / Checkpoints / Commit Gate** (landed in
  `#238`): the `docs/tasks` proof path and front-matter `effectOutcomes` /
  `checkpointEvidence` are retired. `EffectOutcome` input/output becomes a
  typed reference (durable doc + revision / execution task + version /
  provider idempotency). Effect scope checks, dispatch attribution, stored-
  receipt reuse, and the commit-gate baseline semantics carry over — now
  via `recordReceipt` / `recordCheckpoint`. Provider success followed by a
  recording gap is never asserted complete without an idempotency match.

### 3.5 Verification: Design / Evidence / Assessment (`#239`–`#241`)

Three contracts replace the single `test-spec` intent document and the
`implementation-verified` signal:

- **Verification Design v1** (durable, `docs/verification/`):
  `VerificationCheckV1 { id, target, method, implementation, preconditions,
  passCriteria, limitations, required }`. `target` references a Claim;
  `method` is a discriminated union (`unit`, `integration`, `e2e`,
  `property`, `static`, `model-checking`, `formal-proof`,
  `runtime-monitoring`, `manual-review`) with method-typed criteria — one
  boolean never flattens different verification methods. `checks[].target` is
  the sole authority; graph relations are derived. Existing VD is
  updated/reused; new VD is created only when needed.
- **Evidence Record v1** (immutable store): per evidence ID, an append-once
  record of claim `documentRevision`, check `designRevision`, subject
  (`commit` | `workspace(snapshotDigest)`), method/provider/runId/environment,
  `outcome: passed | failed | inconclusive | error | not-run`, and artifact
  URI/SHA-256/retention. `putImmutable` fails on same-ID different-content,
  is idempotent on identical re-put; indexes are derived and rebuildable.
  Workspace results are never promoted to commit results without content
  identity. Retention classes: `transient | release | durable`; repository /
  CI / external-provider artifacts are distinguished.
- **Evidence Assessment + Verification Summary**: evaluates whether recorded
  evidence is valid *for the current target*: `applicability`, `availability`,
  `integrity`, `assessment: sufficient | insufficient | indeterminate`, plus
  reasons. A `passed` record whose claim/check revision or subject
  commit/workspace does not match is not sufficient. Summaries classify
  required checks by coverage and record `not-applicable` verdicts with
  explicit basis — never conflated with `unexecuted`. The **Verification
  Gate** uses the assessment as authority; the blanket
  `implementation-verified` signal is abolished. Waivers carry authority,
  scope, and expiry and are distinct from skips.

**Evidence ≠ Receipt**: an Effect Receipt proves an effect *ran*; an Evidence
Record captures a check's *outcome*. They differ in type, producing path, API,
and UI presentation — deliberately.

### 3.6 Graph v3 (`#243`)

- `GraphStateV3 { knowledge, execution, verification, focus, gates, signals,
  blockers, hardBlockers }` — a projection of the three stores, replacing the
  Artifact-Graph projection.
- **Focus** resolves by durable Claim/Document ID and Run ID. Other runs' or
  chains' plan/task counts cannot trigger `focus-required`; ambiguous focus
  stays fail-closed.
- Graph Definition `schemaVersion: 3` and GraphRoute v3 keep declared
  topology, one-edge routing, priorities, required audits, approval and
  commit gates, run-to-yield, and hard blockers.
- Gates check **sufficiency of the underlying requirement/decision/
  implementation/verification**, not document existence; each returns
  `pass | fail | blocked` with basis. `not-applicable` and `waived` verdicts
  require evidence and authority.
- Normal path: `probe → briefing/design → planning → task-graph →
  implementation → verification → knowledge-consolidation → exit-audit`,
  with declared loopbacks. The `docs/tasks` forced generation, the legacy
  artifact chain, and v2 GraphRoute acceptance are removed; CLI takes
  `runId` / `stateRoot`; `--task-dir` is rejected by the normal v3 CLI.

### 3.7 Schema Manifest and Preflight (`#233`)

- Consumers carry `docs/.doc-driven-dev/schema.json` declaring
  `schemaVersion: 1`, `documentRegistry: 3`, `knowledgeRelations: 1`,
  `verificationDesign: 1`, `evidenceRecord: 1`, `graphDefinition: 3`.
  Execution runs carry an independent `schemaVersion: 1`.
- A shared preflight guard (`schema_preflight.ts`) sits at every normal CLI /
  generation / mutation entry and returns one of `current | uninitialized |
  migration-required | migration-incomplete | unsupported-version | invalid`,
  combining the manifest with a lightweight check of actual files/types/
  relations — never the manifest alone.
- Results are read-only JSON diagnostics (reason code, detected version,
  path, recommended command); everything non-current fails closed except the
  explicitly enumerated migration operations.

### 3.8 Migration (`#245`, `#247`)

Owned by `doc-maintenance`; the only place legacy readers exist.

- `migrate plan` — fully read-only. Inventories every legacy artifact
  (specs/ADRs/designs/discovery/test-specs/plans/tasks/IR/EXP, relations,
  indexes, caller checkpoints/receipts) and emits a deterministic report:
  input hashes, file lists, planned writes, convertibles, semantic-decision
  blockers, residual risks, explicit resolution inputs, `planHash`.
- `migrate apply --expect <planHash>` — explicit apply: full preflight
  (source/target/owner/git-dirty/state root/manifest/references), staging +
  migration journal, `prepare → transform → validate → publish → finalize`.
  Heterogeneous stores can't atomically rename, so the journal drives
  resume/rollback and forbids partial-failure false reports. Legacy deletion
  happens only after post-migration integrity checks; the schema manifest is
  finalized `current` last. Re-apply is a safe no-op.
- Conversions: test-spec → Verification Design preserving guarantees/rules/
  examples/limits; plan/task/approvals/DAG → run snapshot; IR/EXP →
  classified into Knowledge / ADR / Spec / Design / Evidence / diagnostic
  trace. Ambiguous relations, lifecycles, or evidence are reported as
  blockers — semantics are never guessed.
- **Active runs**: local state is not auto-shared across clones/worktrees, so
  apply requires explicit export/import or declared termination; copying
  unshared local state is not a handoff.

### 3.9 Flows, skills, diagnostics (`#244`, `#246`, `#249`)

- `briefing-flow` / `planning-flow` / `implementation-flow` / SDP
  `flow_stack` rewire to v3 delegate boundaries: reuse and sufficiency of
  existing documents first; forced generation is abolished. `plan-doc` /
  `task-doc` become in-run state operations; `test-spec-doc` and `impl-doc`
  leave the normal trigger path (the always-on
  `implementation_documentation` slot becomes conditional).
- **`knowledge-doc`** (new, `docs/knowledge`): search/update/integrate
  existing Spec/Design/ADR/Knowledge *before* creating anything new;
  consolidates implementation findings (why-designed-so, recurrence
  prevention, confirmed constraints) into durable knowledge — while chat-like
  work logs and command transcripts stay out. Completion with nothing worth
  persisting is a valid no-op; unorganized important findings block the
  run's exit gate.
- `doc-status` / `doc-maintenance` / Index / `doc-dashboard` move to the new
  authorities: typed relations, Claim/Check IDs, stale references, evidence
  applicability/availability/integrity, tracked-vs-ephemeral violations,
  migration-needed. Index materialization stays derived and now covers
  `docs/knowledge` + `docs/verification`; git-untracked runs and transient
  evidence never enter README indexes. Dashboards never conflate Execution
  Receipts with Evidence.
- Distribution: bilingual SKILL/reference parity, built JS/schemas
  regenerated from source, and all v2 runtime remnants (legacy proof paths,
  `--task-dir`, test-spec/impl-doc default triggers, v2 normal entry)
  removed — legacy readers remain only inside migration.

### 3.10 Deterministic E2E (`#248`)

The existing `route_graph` + `runCaller` + scripted-delegate + independent-
validator harness is kept; golden cases switch to the new contracts — 17
declared cases covering bootstrap-to-exit on v3, preflight stop + migration-
only on legacy trees, focus/resume across runs, approval digest re-approval,
task-DAG semantics, CAS conflicts, receipt scope/idempotency, commit-gate
baseline, evidence revision/subject mismatch, partial coverage and waiver
expiry, zero-new-Markdown completion, knowledge consolidation, plan/apply
hash pinning and idempotence, interrupted-migration resume, index-free
worktrees, and v2 rejection at normal entrypoints.

## 4. Concept mapping: v2 → v3

| v2 concept | v3 concept | Notes |
| --- | --- | --- |
| `docs/plans`, `docs/tasks` Markdown | Execution Store run snapshot (plan.md + task records) | plans editable; tasks keyed `(runId, taskId)` |
| Task front matter `status`, `depends-on` | Task record `status` / `dependsOn` + CAS version | same DAG semantics, read-only projection |
| Task `effectOutcomes` / `checkpointEvidence` | Checkpoint / Effect Receipt files per run | typed references; scope/idempotency checked |
| `DEFAULT_PROOF_PATH = docs/tasks/...` | `recordReceipt` / `recordCheckpoint` API | proof path removed from normal runtime |
| `test-spec` document | Verification Design (`docs/verification`) | intent only; guarantees → checks |
| `implementation-verified` signal | Evidence Assessment → Verification Gate | revision/subject mismatch ≠ verified |
| (no result store) | Evidence Store (`EvidenceRecordV1`) | immutable, revisioned, artifact refs |
| `ir` / `exp` per task | `knowledge-doc` conditional extraction + diagnostic trace | always-on generation abolished |
| Untyped bidirectional `relations` | Typed forward relations + derived inverses | `motivates`/`decides-for`/`realizes`/`informs`/`explains`/`supersedes` |
| `status` as sole lifecycle | `status` (per-type) + `lifecycle` axes | old status→lifecycle decided at migration |
| README/INDEX materialized views | unchanged — derived indexes (+ knowledge/verification dirs) | runs/transient evidence excluded |
| Artifact-Graph chain focus | Claim/Document ID + Run ID focus | cross-run interference removed |
| `--task-dir` CLI selector | `runId` / `stateRoot` | v2 values rejected normally |
| (no schema gate) | Schema Manifest + shared Preflight | every entry fail-closed on non-current |
| `migrate_docs`/`migrate_ids` in-graph | `doc_maintenance migrate plan/apply` | journal-resumable, hash-pinned |
| `schemaVersion: 2` graph/state/route | `schemaVersion: 3` + per-store versions | single current schema, no parallel v2 |

## 5. What does not change

- Declared-topology one-edge routing; the router never follows a second edge.
- Caller-owned `run-until-yield` / `single-step`, the yield table, bounded
  autonomy budgets, fingerprint loop detection.
- Commit-gate baseline semantics (`head` + `dirty`, `commit-required`,
  `commit-waived`) — receipts move, enforcement stays.
- Fail-closed posture: malformed inputs, unknown signals, ambiguous focus,
  missing evidence block rather than infer.
- Derived materialized indexes and `doc-maintenance`'s preview→apply
  discipline; owner boundaries for ADR and suite dirs.
- `run_trace.jsonl` as non-authoritative diagnostics.
- Markdown as the durable knowledge authority — now scoped to knowledge and
  verification design instead of every artifact.

## 6. Issue map

| Issue | Scope | Depends on |
| --- | --- | --- |
| `#233` | Schema Manifest v1 + shared Migration Preflight | — |
| `#234` | Document Registry v3 / lifecycle / owner contract | `#233` |
| `#236` | Execution Store v1: CAS, atomicity, handoff | `#233` |
| `#235` | Claim IDs + Knowledge Relations v1 | `#234` |
| `#237` | Planning flow + Task Graph on Execution Store | `#234`, `#236` |
| `#238` | Caller Effect Receipt / Checkpoint / commit gate move | `#236` |
| `#239` | Verification Design v1 + Check contract | `#234`, `#235` |
| `#240` | Immutable Evidence Store | `#239` |
| `#241` | Evidence Assessment + Verification Summary + gate policy | `#235`, `#239`, `#240` |
| `#242` | `knowledge-doc` skill + extraction contract | `#234`, `#235` |
| `#243` | Graph State / Route / Definition v3 | `#233`, `#235`, `#237`, `#238`, `#241`, `#242` |
| `#244` | Flow + SDP `flow_stack` rewiring | `#237`, `#239`, `#242`, `#243` |
| `#245` | Migration inventory + read-only plan | `#233`–`#237`, `#239`, `#240`, `#242` |
| `#246` | doc-status / doc-maintenance / index / dashboard update | `#233`–`#235`, `#239`–`#241`, `#243` |
| `#247` | Migration apply + resume/rollback + post-gate | `#237`, `#238`, `#240`, `#242`, `#243`, `#245`, `#246` |
| `#248` | Deterministic E2E + regression fixtures | `#237`, `#238`, `#241`, `#243`, `#244`, `#246`, `#247` |
| `#249` | Bilingual skill/CLI/dist parity + legacy runtime removal | `#244`, `#246`–`#248` |

Phase order (`#232`): **A** foundation (`#233`, `#234`, `#236`) →
**B** independent areas (`#235`, `#237`, `#238`, `#239`, `#240`, `#241`,
`#242`, parallelizable) → **C** route switch (`#243`, `#244`) →
**D** migration + diagnostics (`#245`, `#246`, `#247`) →
**E** completion + distribution (`#248`, `#249`).

## 7. Guardrails carried by the design

- Normal processing reads the new schema only; legacy parsing exists solely
  inside migration.
- No dual authorities: inverse relations, check relations, evidence
  summaries, and indexes are always derived.
- Evidence and Effect Receipts are separate contracts at every layer.
- Migration plans are hash-pinned, previewed, explicitly applied, resumable,
  and post-audited; active-run handoff is a precondition, never assumed.
- Deterministic E2E validates structure, permissions, evidence, and resume —
  LLM prose quality is out of scope by design.
