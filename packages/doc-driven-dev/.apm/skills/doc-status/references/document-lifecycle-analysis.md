# Document Lifecycle Cost Analysis (Issue #127)

**Status:** Analysis reference — measured findings and reduction
classification. Maintainer-facing; deliberately not linked from `SKILL.md`,
so it does not add runtime load surface.

## 1. Purpose and scope

Long-running use of doc-driven-dev accumulates canonical Markdown — ideas,
discovery, specs, designs, plans, tasks, test-specs, ADRs, Implementation
Records. Progressive disclosure (#124) reduces how much of that mass is
*loaded into context*; it does not reduce how much is *generated and
maintained*. This document measures the lifecycle cost — generation volume,
relation/reference density, orphan rates, status drift, and maintenance
findings — and classifies where document mass can be reduced without
weakening Graph/contract guarantees.

### Non-goals

- Measuring LLM task-achievement quality, token/cost/latency, or semantic
  skill-firing.
- Changing Graph status authority, the typed-relation contract, or any
  required-evidence gate.
- Re-implementing the diagnostics owned by `doc-status` (#87–#94) or the
  repair/migration owned by `doc-maintenance`.
- Proposing bulk deletion, automatic archival, reference-breaking
  compaction, force-merging documents, or hiding required evidence in Git
  history.
- Treating runtime repository scans as equivalent to delegate body reads —
  they are different channels (see §2.4).

## 2. Method

### 2.1 Measurement tool

`scripts/doc-driven-dev/src/skills/lib/lifecycle_stats.ts` exposes
`analyzeCorpus(cwd)`. It is a **projection over the existing doc-status
pipeline**, not a new diagnostic:

| Reused surface | What it contributes |
| -------------- | ------------------- |
| `scanRepository` (`lib/doc_repository.ts`) | One canonical scan: kind (canonical/index/unmanaged), type, status, relations, links, locale siblings, `resolveRelationTarget`/`resolvePath`, `artifactKeyOf` |
| `collectFindings` + `summarizeHealth` (`lib/doc_report.ts`) | The exact findings and health categories `doc_status audit/health` reports |
| `inboundLinkCounts` + `inboundRelationCounts` (`lib/doc_structure_lint.ts`) | The same inbound-coverage maps `lintOrphans` uses (exported for reuse — no logic duplicated) |

The only new semantics are aggregation (per-type buckets) over two status
axes — both now single-sourced in `lib/doc_repository.ts`:

- *Settled* = the document's own lifecycle work has concluded
  (`done`, `wont-do`, `completed`, `implemented`, `resolved`, `routed`,
  `promoted`, `parked`, `archived`, `superseded`, `rejected`, `deprecated`,
  `abandoned` — per-type sets in `SETTLED_STATUSES`). `approved`/`accepted`
  normative baselines stay in-flight: in-flight work legitimately derives
  from them.
- *Stale upstream* = an in-flight document with ≥1 resolved
  `implements`/`derives-from`/`refines` target in a dead status
  (`superseded`/`rejected`/`deprecated`/`archived`/`abandoned`/`wont-do`/
  `completed`/`done`). **Promoted in #166:** the heuristic became the
  `stale-upstream` doc-status rule — the stats consume the shared
  `staleUpstreamTargets` predicate, so the counts below are the same edges
  `doc_status lint` reports as non-blocking warnings. Resolved/active
  upstreams and normative baselines never flag.
- Legacy fixture spelling `type: "implementation-record"` merges into the
  `impl` bucket (`LIFECYCLE_TYPE_ALIASES`) — same artifact kind,
  pre-contract spelling.

### 2.2 Corpora

`tests/fixtures/doc-lifecycle/corpora.ts` builds three corpora on the
deterministic `createFixtureRepo` harness (fixed `created`/`updated` dates,
fixed ids, fixed bodies):

| Corpus | What it models |
| ------ | -------------- |
| `small` | `createFixtureRepo({})` — the standard 7-doc chain (fresh project) |
| `benchmark` | The #124 ~60-doc context-load corpus, shared verbatim with `doc-driven-dev-fetch-context.test.ts` as `benchmarkCorpusFiles` |
| `long-running` | ~100-doc synthesized project: 4 completed chains, a supersession chain, a mid-flight chain, a stalled chain, plus accumulated debt (un-promoted captures, orphans, stale upstreams, index drift, a broken relation, provenance gaps, a ja sibling, an unmanaged doc) |

The `benchmark` corpus keeps its pre-contract spellings (`SPEC-B0101`,
`status: "confirmed"`); doc-status surfaces those as `invalid-id-*` /
`invalid-status` findings. That is **fixture debt, measured faithfully** —
it is reported separately from lifecycle debt below and must not be read as
"the benchmark is broken".

### 2.3 Determinism and verification

- Output is a plain JSON object with sorted keys — no wall-clock, no
  environment sensitivity. Two runs on the same corpus are byte-identical
  (guarded by `doc-lifecycle-analysis.test.ts`).
- `tests/fixtures/doc-lifecycle/stats-{small,benchmark,long-running}.json`
  are the committed baselines; the test byte-compares live output to them.
- Regenerate after intentional corpus/contract changes:
  `mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx tests/fixtures/doc-lifecycle/write_stats.ts`

### 2.4 What is *not* measured

The stats consume the **whole-repository doc-status scan** — the audit
channel. They do not measure delegate retrieval (#124's L1/L2/L3 channels)
and do not claim equivalence between the two. `doc-status` lint scopes cover
the nine `docTypes`; `impl` records and unmanaged docs are scanned and
bucketed but never linted — their `findings` counts are 0 by construction.
Orphan rates below are *doc-status orphan findings per file*, exactly as the
lint reports them.

## 3. Measured results

### 3.1 Corpus-level

| Metric | small | benchmark | long-running |
| ------ | ----- | --------- | ------------ |
| Scanned Markdown | 17 | 78 | 116 |
| Documents (non-index) | 7 | 68 | 106 |
| …canonical / unmanaged | 7 / 0 | 68 / 0 | 105 / 1 |
| Indexes | 10 | 10 | 10 |
| Body bytes | 181 | 57,451 | 42,793 |
| Settled / in-flight | 0 / 7 | 0 / 68 | 57 / 49 |
| Stale-upstream docs | 0 | 0 | 3 |
| Duplicate-id groups | 0 | 0 | 0 |
| Findings (blocking/warn/info) | 21 (0/0/21) | 348 (86/239/23) | 37 (6/12/19) |

### 3.2 Per-type — long-running corpus

| Type | Files | Settled | Stale | Body bytes | Max file | Orphans (rel/idx/nav) | Findings |
| ---- | ----- | ------- | ----- | ---------- | -------- | --------------------- | -------- |
| task | 23 | 17 (74%) | 2 | 1,106 | 48 | 0/0/0 | 2 |
| impl | 18 | 16 (89%) | 0 | 1,318 | 70 | 0/0/0 | 0* |
| spec | 11 | 7 (64%) | 0 | 1,117 | 102 | 1/0/0 | 4 |
| discovery | 10 | 6 (60%) | 0 | 39,809 | 39,018 | 3/3/3 | 14 |
| plan | 9 | 6 (67%) | 0 | 120 | 12 | 1/0/0 | 1 |
| design | 9 | 0 | 1 | 219 | 25 | 1/0/0 | 4 |
| adr | 8 | 1 (13%) | 0 | 377 | 62 | 0/0/0 | 0 |
| idea | 8 | 3 (38%) | 0 | 136 | 16 | 8/0/0 | 8 |
| test-spec | 7 | 1 (14%) | 0 | 118 | 17 | 0/0/0 | 0 |
| brainstorm | 2 | 0 | 0 | 36 | 18 | 2/0/0 | 2 |
| unmanaged | 1 | 0 | 0 | 57 | 57 | 0/0/0 | 0 |

\* impl records are scanned but outside `doc-status` lint scopes (§2.4).

Status distributions (long-running): task `done` 15 / `todo` 4 / `wont-do`
2 / `in-progress` 1 / `blocked` 1; plan `completed` 5 / `approved` 1 /
`in-progress` 1 / `blocked` 1 / `superseded` 1; spec `implemented` 6 /
`approved` 3 / `proposed` 1 / `superseded` 1; impl `completed` 15 /
`in-progress` 1 / `superseded` 1 / `complete` (legacy spelling) 1.

### 3.3 Relations and references — long-running

- 119 declared relation values: `implements` 39, `derives-from` 41,
  `derived-by` 14, `verifies` 7, `verified-by` 7, `source` 9,
  `supersedes`/`superseded-by` 1 each. Lineage fields
  (`implements`+`derives-from`+`refines`) = 67% of declared.
  (`test-spec-skip` is a non-reference metadata key and no longer counts
  as a relation — see §4.5.)
- Resolution: 110 resolved, 7 external (discovery source URLs), 2
  unresolved (the planted `DISC-9999` and the dead local `source`).
- 63 / 106 artifacts receive ≥1 inbound resolved relation — 40% of the
  corpus are relation-islands, matching the orphan findings.
- Markdown links: 17 declared (16 resolved `impl→task` links, 1 unmanaged
  broken link). **102 / 106 documents receive inbound links almost
  exclusively from generated index tables** — indexes carry essentially the
  whole navigation layer in this corpus.

### 3.4 Findings by rule — long-running

| Rule | Count | Note |
| ---- | ----- | ---- |
| orphan-relation | 16 | 8 ideas + 2 brainstorms + 3 discovery orphans + superseded plan + broken spec + design overview |
| orphan-index / orphan-navigation / index-missing-entry | 3 / 3 / 3 | the 3 un-indexed orphan discoveries |
| index-stale-entry / index-metadata-mismatch | 1 / 1 | deleted spec row; task row lagging its doc's status |
| broken-relation-link | 1 | `SPEC-9201 → DISC-9999` |
| inconsistent-reciprocal-relation | 1 | `SPEC-0502` not back-linked in `DISC-0501.derived-by` — supersession drift |
| traceability-missing-upstream | 2 | `SPEC-0001`, `DESIGN-OVERVIEW` |
| stale-upstream | 4 | `DESIGN-0501` ×2 edges (`SPEC-0501` + `ADR-0501`), `TASK-0503`/`TASK-0504` on completed `PLAN-0501` |
| provenance-missing-source / provenance-unresolved-local-source | 1 / 1 | orphan discoveries |
| (indexes) | — | 2 findings attach to index files themselves |

Benchmark corpus (for contrast — pre-contract fixture debt): 348 findings,
dominated by `invalid-id-prefix` 38 + `invalid-status` 25 +
`provenance-missing-source` 20 + `traceability-missing-upstream` 14 +
index/orphan coverage (~200) because its README stubs list nothing.

## 4. Top five measured impacts

### 4.1 The capture layer is the orphan reservoir

13 of 18 capture-layer docs (idea/brainstorm/discovery) in the long-running
corpus have **zero semantic relations in either direction** — 16
`orphan-relation` findings total, 81% of them on capture types. Capture docs
are cheap to create and almost never revisited; nothing in the lifecycle
promotes or closes them. *This is the largest single reduction surface:
fewer capture files, not shorter ones.*

### 4.2 The corpus is mostly settled evidence

54% of long-running documents are settled; tasks (74%) and Implementation
Records (89%) settle fastest and are never deleted (correctly — they are
the evidence trail). Per-file body mass is tiny (task median ~48 B, impl
~70 B) but they are **41% of all files** — a long tail of small records
that index tables, audits, and navigation must carry forever. Reduction
must come from *status-aware surfaces*, not deletion.

### 4.3 Body mass concentrates in discovery evidence

Discovery is 93% of long-running body bytes (one 39 KB evidence doc) and
98% of benchmark bytes. Discovery docs are write-once research dumps —
high per-file bytes, near-zero reference traffic after resolution. They
are the natural "cold storage" tier: candidates for summary-front /
evidence-append structure, never for deletion.

### 4.4 Generated indexes are load-bearing — and they drift

102/106 docs are reachable **only** through index links (body-level
cross-links are rare — exactly what orphan-navigation measures). Index
tables therefore *are* the navigation contract; their own drift
(stale-entry, metadata-mismatch, missing-entry — 5 findings on 10 indexes
in a ~100-doc corpus) silently removes documents from the reachable
surface. `doc-status` already reports all of these; `doc-maintenance`
already regenerates indexes. The gap is cadence, not capability.

### 4.5 Lifecycle-debt edges are small, real, and were invisible until #166

3 stale-upstream docs (todo tasks on a completed plan; approved design on a
superseded spec), 1 reciprocal-relation break from supersession, 2
unresolved relation targets, 2 provenance gaps. Individually minor — but
**two observations the stats exposed**:

- `test-spec-skip: "<reason>"` (documented convention in
  `plan-conventions`) previously resolved as a relation target and
  reported `broken-relation-link` — a reason string counted as a broken
  reference. **Resolved in #165:** the relation-ingestion boundaries now
  exempt `test-spec-skip` as a non-reference metadata key (alongside
  `changes`), so the recorded reason no longer resolves, counts, or gates
  as a relation.
- A superseding spec does not automatically produce the `derived-by`
  back-link, leaving `inconsistent-reciprocal-relation` drift no one is
  told to fix.

The stale-upstream edges are now surfaced by the dedicated `stale-upstream`
rule (landed in #166 — see §6); the reciprocal-drift gap remains
instruction-level (A2), and this analysis is still where it was measured.

## 5. Required vs optional classification

Per document skill: *required* = mandated by Graph/contract or a gate;
*new file* = when creating another document earns its keep; *update* =
when updating an existing document is sufficient; *skip* = when the
artifact can legitimately be omitted.

| Skill | Required evidence | New file earns its keep | Update is sufficient | Skippable |
| ----- | ----------------- | ----------------------- | -------------------- | --------- |
| idea-doc | Only as flow input when a spec chain needs an idea anchor | Each genuinely distinct proposal worth promoting | Refining/scoping the same idea; parking | Capture for every stray thought — the measured orphan reservoir |
| discovery-doc / deep-dive | Source evidence is contract-required on the doc itself; required when a spec needs research lineage | One file per research question worth evidence | Continuing the same investigation | Answered-by-inspection questions; duplicates of existing resolved discovery |
| spec | Required for feature work (acceptance gate) | Per distinct feature/behavior contract | Revisions within the same feature scope | Do not supersede for cosmetic edits; update in place |
| adr | Required per architecture decision | Per decision (ADR is a point-in-time record) | Clarifications only | Never update a decided ADR in place for a new decision — supersede |
| design-doc | Required before plan when design authority is needed | Per system/feature baseline | Iterating the same baseline while approved | Re-baselining under superseded upstreams without re-pointing (measured drift) |
| plan-doc | Required for implementation flow (approval gate) | Per work package | Status/progress/tasks within the package | New plan for in-package scope changes |
| task | Required per work item under a plan (execution contract) | Per delegable work item | Status transitions in place | Micro-tasks under ~1 step — fold into the plan's task list |
| test-spec | Required for plan approval (`verified-by`) unless `test-spec-skip` reason recorded | Per verification surface | Adding/adjusting cases for the same surface | Verified-by is a gate — the skip reason is the only opt-out |
| impl-doc (IR/exp) | IR required per implementation task; exp optional | IR per task; exp per experiment worth a log | IR during the task's lifetime | Never skip the IR; exp is optional |
| doc-status reports | No document artifacts — reads-only | n/a | n/a | n/a |
| briefing-flow / implementation-flow | The flow's own profile/doc set per run | Per flow instance | n/a | n/a |

Two cross-cutting observations:

- "Required" attaches to **flow states**, not to doc types globally: a
  completed plan's test-spec was required at approval time and is evidence
  forever after.
- The measured corpus shows the failure mode is *over-creation at the
  capture layer and under-closure downstream* — not too many required
  artifacts. No required-evidence document is redundant in the measured
  set.

## 6. Reduction opportunities and recommendations

### Bucket A — skill-instruction-only changes (no Graph/contract change)

| # | Recommendation | Measured basis | Effort |
| - | -------------- | -------------- | ------ |
| A1 | idea/discovery instructions: state explicitly when updating the existing capture suffices vs when a new file is warranted; require `relations.source` at creation time | §4.1, §4.5 | small |
| A2 | On supersession, instructions should require re-pointing or closing in-flight dependents (the measured stale-upstream pattern) and emitting the reciprocal back-link | §4.5 | small |
| A3 | Task guidance: a minimum work-item size before a task file is warranted (fold micro-items into the plan's list) | §4.2 file-tail | small |

### Bucket B — index/search/navigation improvements (no second authority)

| # | Recommendation | Measured basis | Effort |
| - | -------------- | -------------- | ------ |
| B1 | Status-aware index views: generated index tables partitioned or annotated so settled docs are visible-but-de-emphasized (active-first ordering or a settled section) | §4.2 | medium |
| B2 | Regenerate indexes on a cadence (doc-maintenance already owns regeneration; doc-status already reports drift) — wire regeneration into the close-out path rather than relying on manual runs | §4.4 | small |
| B3 | Surface capture-layer age/linked-ness in `doc_status` output consumers (the orphan findings already exist; the gap is visibility) | §4.1 | small |

### Bucket C — structure changes requiring migration (each = own issue)

| # | Recommendation | Measured basis | Migration concerns |
| - | -------------- | -------------- | ------------------ |
| C1 | Consider a settled/historical index tier or `archive:` front-matter flag consumed by indexes/navigation (status authority unchanged — a presentation axis) | §4.2 | Back-fill flag derivation from status; index-format change needs a doc-maintenance migration; reversible by flag removal |
| C2 | Discovery evidence structure: split oversized evidence dumps into a summary front-matter section + append-only evidence tail so L1 metadata stays small regardless of evidence mass | §4.3 | Body-format convention change; existing files grandfathered; template + convention docs migrate |
| C3 | Teach relation resolution that `test-spec-skip` is a reason string, not a target — **landed in #165**: the ingestion boundaries exempt it as a non-reference `relations:` key and the `verified-by` gate reads the recorded reason | §4.5 | Contract-visible: `test-spec-skip` is a documented metadata key under `relations:`; small blast radius |

### Suggested follow-up issues (one per implementation effort)

1. Skill-instruction pass: update-vs-create + source-required guidance
   (A1–A3) — one issue.
2. Status-aware index/navigation views + close-out index regeneration
   (B1–B3) — one issue.
3. Settled-tier presentation flag (`archive:` axis) (C1) — one issue.
4. Discovery evidence front/tail structure (C2) — one issue.
5. `test-spec-skip` resolution semantics (C3) — one issue; **landed as
   #165**.
6. Promote the stale-upstream heuristic into a `doc-status` lint rule if
   the signal proves stable on real repos — one issue; **landed as #166**:
   `stale-upstream` is a non-blocking warning emitted once per dead
   upstream edge, and the stats consume the same `staleUpstreamTargets`
   predicate the rule runs on.

## 7. Explicit non-actions

This analysis does **not** propose, and implementation must not introduce:

- bulk deletion of documents;
- automatic archival that hides required evidence;
- compaction that breaks relations, links, or stable IDs;
- force-merging documents (e.g., folding tasks into plans, impls into
  tasks);
- changing Graph status authority or any required-evidence gate;
- hiding required evidence in Git history instead of current artifacts;
- a second artifact authority or a persistent vector index;
- re-implementing #87–#94 diagnostics/repair (they are reused here).

## 8. Reproduction

```text
mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx tests/fixtures/doc-lifecycle/write_stats.ts
mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-lifecycle-analysis.test.ts
```

Inputs: `scripts/doc-driven-dev/tests/fixtures/doc-lifecycle/corpora.ts`
(corpus builders), `scripts/doc-driven-dev/src/skills/lib/lifecycle_stats.ts`
(measurement), `scripts/doc-driven-dev/tests/doc-lifecycle-analysis.test.ts`
(shape/determinism/bounds guards), `tests/fixtures/doc-lifecycle/stats-*.json`
(committed baselines — numbers in §3 come from these files).
