---
name: doc-status
description: Use when listing, auditing, or validating document-driven development artifacts, statuses, indexes, and semantic relations.
license: MIT
---

# Document Status Skill

Use this skill to inspect document lifecycle state and relation health across
the durable Registry 3 types — `idea`, `brainstorm`, `discovery`, `spec`,
`design`, `adr`, `knowledge`, and `verification`. It is report-and-judge only
by default and should not modify project files unless a separate creation or
index command is used.

`--type plan`, `--type task`, and `--type test-spec` are refused scopes under
Registry 3: `plan`/`task` are execution-bound (their state lives in the
Execution Store) and `test-spec` is a legacy, migration-only format — none of
them are durable documents the linter can check.

## Audit Role

This skill acts as the integrity gatekeeper for document-driven development.
Audit results serve the following verdicts:

- **Completable**: No blocking issues → the document set is consistent and traceable.
- **Returned**: Blocking issues found → the affected documents need correction.

Examples of blocking issues:

- Missing required front matter fields (id, type, status, relations)
- Broken internal relations (referenced file does not exist)
- Documents not registered in the index
- Typed Knowledge Relation issues remaining before the `exit-audit` node —
  unresolved or ambiguous targets, relation cycles, or legacy relation fields
  only migration may carry
- Documents whose stored type, lifecycle, or status is inconsistent with
  Document Registry 3

## Output Contract

Return audit results using this structure:

- `Verdict`: `Completable` or `Returned`
- `Blocking findings`: issues that stop progression
- `Warnings`: non-blocking issues worth fixing
- `Relation errors`: broken internal links or inconsistent relations
- `Index gaps`: missing registry or index coverage
- `Next actions`: the minimum repair needed to pass the gate; name the
  smallest graph repair point (the node the router will return to) that can
  resolve each blocking finding

## Workflow

The unified `doc_status.js` entry point exposes four read-only commands.
`list_docs.js` and `audit_docs.js` remain as compatibility wrappers.

1. List documents by type or status; each entry shows `status` and
   `created` (capture-layer age).

   ```bash
   node scripts/doc_status.js list --type spec
   node scripts/list_docs.js --type spec --status draft
   ```

2. Enumerate findings (`lint`) or evaluate the gate summary (`audit`).

   ```bash
   node scripts/doc_status.js lint --type spec --rule broken-link
   node scripts/doc_status.js audit --type spec --json
   node scripts/audit_docs.js --type spec
   ```

3. Aggregate repository-wide health by category.

   ```bash
   node scripts/doc_status.js health
   node scripts/doc_status.js health --json
   ```

   `health` is an aggregate view over the same findings — it is not a second
   scanner and reports no numeric score. Its `Orphans` line (`orphans` in
   `--json`) rolls up `orphan-*` findings by rule and document type.
   Repo-level findings aggregate under their own `migration` and
   `evidence` categories.

   Shared filters: `--type`, `--dir`, `--rule`, `--severity`,
   `--blocking`, `--status` (list), `--json`, `--external-links`,
   `--profile` (lint, audit, health), `--state-root`, and
   `--allow-external-root`. The last two select the Evidence Store the
   repo-level `evidence` gate reads — an external `--state-root` is
   refused unless `--allow-external-root` is passed, the same
   containment contract the Execution/Evidence CLIs enforce.
   Findings print in deterministic order; exit status is `0` unless the
   invocation itself is invalid.

   `audit_docs.js --type all` audits the shared durable suite only —
   `idea`, `brainstorm`, `discovery`, `spec`, `design`, `adr`,
   `knowledge`, and `verification`. impl-doc's owned directories
   (`docs/impl/ir`, `docs/impl/exp`) are never inside a `--type` scope;
   their integrity is owned by `audit_impl_record.js` and
   `audit_experiment_log.js`.
   `audit_docs.js --type all --owners` is the package-wide audit: the
   shared report plus `ownerAudits` entries for `impl-record` and
   `experiment-log`. `--owners` requires `--type all` and cannot be
   combined with `--dir`; owner audits always run their full check
   regardless of `--profile`.

   An un-narrowed query — `--type all` or an omitted `--type` with no
   `--dir` — additionally runs the two repo-level gates. The
   `execution-boundary` gate inventories every file the repository model
   classifies as migration corpus: Markdown under migration-owned
   directories (former `plan`/`task` homes and legacy
   `test-spec`/`impl`/`exp` scopes) plus `plan`, `task`, `test-spec`,
   `impl`, or `exp` typed files wherever they land — a durable directory
   cannot make them durable documents. `git ls-files` is the tracking
   authority: a Git-tracked file reports `tracked-execution-doc` or
   `tracked-legacy-doc` (durable Git form no longer exists — that state
   lives in the Execution Store or belongs to migration tooling), while
   content the index does not track — untracked leftovers, gitignored
   files, or corpus where no usable Git work tree exists — reports
   `legacy-corpus-doc`, never a guessed tracked state. All are blocking
   `migration` findings whose repair class is `migration`, never the
   safe fix path. The `evidence` gate first audits the Evidence Store's
   own marker — a torn or invalid `manifest.json` reports
   `corrupt-evidence-store`, record files with no manifest report
   `unmanifested-evidence-store`, and an absent store reports nothing —
   then re-assesses every record against the live Knowledge Graph and
   the checkout's `HEAD` subject, one finding per failed axis (rule
   list below). A `--type`- or `--dir`-narrowed query never runs these
   gates; the report's `gates` envelope lists them under `skipped`.

   Named audits from `doc-driven-dev-graph` map to commands as follows:
   durable document types (`spec`, `adr`, `design`, `idea`, `brainstorm`,
   `discovery`, `knowledge`, `verification`) run as
   `audit_docs.js --type <name> --profile artifact`. The `plan`, `task`,
   and `test-spec` names resolve to refused Registry 3 scopes (see
   above); `all` runs as
   `audit_docs.js --type all --profile artifact`
   covering every canonical document type plus a legacy-reference sweep over
   root-level unmanaged Markdown and distributed `.apm` skill documents;
   `impl-record` runs as `impl-doc/scripts/audit_impl_record.js` and
   `experiment-log` runs as `impl-doc/scripts/audit_experiment_log.js`, which
   need no profile flag (their only index observation is a non-blocking
   warning).
   Graph-dispatched audits run the `artifact` profile so a missing or stale
   index never gates graph execution; direct strict checks may omit
   `--profile` to keep the default `materialized` coverage. Under Graph
   Definition v3 the `exit-audit` node runs the named audit `all` only —
   `impl-record` and `experiment-log` are `--owners` opt-ins, never
   graph-dispatched scopes; `all`
   keeps `--profile artifact`, so index state cannot gate graph execution.

4. Treat `relations.source` as external evidence.
   HTTP, HTTPS, and mail links are allowed and should not be reported as missing
   local files.
5. Treat pre-v3 relation keys as migration-domain input.
   Populated legacy keys (`implements`, `derives-from`, `references`,
   `related`, inverse names, and friends) report `legacy-relation-field`
   and are never resolved or walked as current graph edges.
6. Report broken internal relations, invalid statuses, missing required front
   matter, and missing index entries.

## Audit Coverage

Audits run on a shared document repository model and report every problem with
a stable rule ID. `--profile materialized` (the default) evaluates every rule
below; `--profile artifact` evaluates only canonical-document integrity and
skips the index checks — a missing or stale index never produces an
artifact-profile finding. JSON output reports the active profile and which
check groups ran or were skipped. Covered checks include:

- `unparseable-front-matter`, `invalid-front-matter`, `invalid-type`,
  `invalid-status` — front matter and document contract violations.
- `missing-lifecycle`, `invalid-lifecycle` — the Registry 3 lifecycle axis
  (`draft`, `current`, `superseded`, `retired`) is its own contract, never
  read off `status`. Absent is `missing-lifecycle` (migration debt,
  repairable by the docs migration); a populated non-axis value is
  `invalid-lifecycle`.
- `invalid-id-format`, `invalid-id-prefix`, `duplicate-id` — artifact identity
  violations.
- `broken-relation-link`, `ambiguous-relation-target`,
  `relation-escapes-root`, `self-relation`, `invalid-relation-field`,
  `invalid-relation-target-type`, `relation-cycle` — semantic relation
  violations projected by the Knowledge Graph. Stored relations are
  canonical forward fields (`motivates`, `decides-for`, `realizes`,
  `informs`, `explains`, `supersedes`); inverse names are derived
  projections, so there is no reciprocal-link check — consistency is
  structural.
- `invalid-claim-id`, `claim-without-doc-id`, `duplicate-claim`,
  `claim-doc-mismatch`, `unresolved-claim-target` — Claim marker and
  stable Claim-ID (`<DOC-ID>::<CLAIM-ID>`) violations.
- `legacy-relation-field` — populated pre-v3 relation keys. They are
  migration-domain findings, never graph input.
- `unresolved-legacy-reference` — body text references to legacy `TYPE-NNNN`
  artifact ids that no artifact provides, including `EXP-NNNN` experiment
  references without a matching numbered `.jsonl` log. Tokens that still
  resolve to an existing artifact or experiment file are not reported, so
  pre-migration repositories stay clean.
- `ambiguous-experiment-reference` — body text `EXP-NNNN` references whose
  number matches multiple numbered `.jsonl` experiment logs, so no unique
  canonical path exists; rewrite the token to a `.jsonl` path manually.
- `missing-required-relation`, `invalid-relation-target-type` — generic
  relation-contract rules: a type-declared required relation is absent, or
  a populated relation points at a type its contract does not allow.
  (The Registry 2 type-specific `test-spec-*` and
  `plan-missing-test-spec-evidence` rules are retired with their types.)
- `provenance-missing-source`, `provenance-invalid-source`,
  `provenance-unresolved-local-source` — `relations.source` provenance.
  Local source paths must resolve inside the repository; external URLs are
  classified as external evidence and only probed with `--external-links`.
- `traceability-missing-upstream` — type-aware upstream expectation.
  Under Knowledge Relations v1 the durable type with an expected upstream
  is `design` (via `realizes`); a non-settled design that declares no
  `realizes` relation is flagged. Settled statuses (`superseded`,
  `rejected`, `archived`, `deprecated`, `abandoned`, `wont-do`) are
  exempt.
- `stale-upstream` — in-flight documents riding on a dead upstream. A
  `motivates`, `decides-for`, or `realizes` target that resolves to a
  document in a dead status
  (`superseded`, `rejected`, `deprecated`, `archived`, `abandoned`,
  `wont-do`, `completed`, `done`) warns once per dead target.
  `approved`/`accepted`/`implemented`/`resolved` upstreams and settled
  source documents never flag. Non-blocking warning: stale lineage is a
  signal to re-point or close, not a contract violation.
- `missing-overview` — required canonical directory documents. Runs in both
  profiles.
- `missing-index`, `index-missing-entry`, `index-missing-overview` — index
  presence and coverage gaps. Materialized profile only.
- `broken-link`, `missing-image-link`, `broken-anchor`, `link-escapes-root`,
  `link-case-mismatch` — local Markdown link and anchor integrity.
- `index-stale-entry`, `index-duplicate-entry`, `index-metadata-mismatch`,
  `index-ordering`, `index-tier-mismatch`, `index-unparseable`,
  `index-escapes-root` — index table consistency. Materialized profile only.
  Managed indexes are status-aware — in-flight rows first, then a
  `## Settled` tier; `index-ordering` flags rows violating the deterministic
  ordering and `index-metadata-mismatch` flags status cells that no longer
  match front matter. `index-tier-mismatch` flags a managed index row in the
  wrong tier — a settled document still in the active table or an in-flight
  document under `## Settled`. It is a `materialized`-profile warning
  repaired by the owning materialization path (index regeneration), never
  by editing the index by hand.
- `orphan-index` — documents not listed in the index. Materialized profile
  only.
- `orphan-navigation`, `orphan-relation` — documents unreachable from any
  canonical Markdown link, or lacking semantic relations. Both profiles; under
  `artifact`, links inside index files do not count as inbound navigation.
  Severity is type-aware: types allowed as root artifacts report these as
  `info`, others as `warning`.
- `external-link-broken`, `external-link-redirect`,
  `external-link-unverifiable` — opt-in external link probing via
  `audit_docs.js --external-links`. Disabled by default so audits stay
  deterministic and offline-safe.
- `legacy-doc-in-durable-dir` — a file inside a durable scope whose
  declared `type:` has no durable Git form (execution-bound
  `plan`/`task` or legacy `test-spec`/`impl`/`exp`). The file is
  migration corpus, never a document of that scope — no scope rule or
  index row applies to it. Blocking `migration` marker on scoped and
  repo-wide queries alike.
- `tracked-execution-doc`, `tracked-legacy-doc`, `legacy-corpus-doc` —
  repo-level migration sweep over Markdown the repository model
  classifies as migration corpus (former `plan`/`task` homes, legacy
  `test-spec`/`impl`/`exp` scope, and execution-bound or legacy-typed
  files wherever they land). `git ls-files` is the tracking authority:
  tracked files report `tracked-execution-doc`/`tracked-legacy-doc`;
  untracked, gitignored, or unverifiable content reports
  `legacy-corpus-doc` — never a guessed tracked state. Blocking
  `migration`-category markers; the `migrate` family of
  `doc_maintenance.js` owns the repair. Repo-wide queries only.
- `corrupt-evidence-store`, `unmanifested-evidence-store` — Evidence
  Store marker integrity: a `manifest.json` that cannot be read or
  fails validation reports `corrupt-evidence-store` (blocking error);
  record files present without the write-once manifest report
  `unmanifested-evidence-store` (blocking warning). Records under an
  uncertified marker still get their per-axis assessment; an absent
  store emits nothing. Repo-wide queries only.
- `unresolved-evidence-claim`, `unresolved-evidence-check`,
  `stale-evidence-revision`, `evidence-check-target-mismatch`,
  `evidence-method-mismatch`, `stale-evidence-subject`,
  `evidence-artifact-unavailable`, `evidence-artifact-expired`,
  `failed-evidence` — blocking Evidence Store axes: claim/check refs
  that no longer resolve in the live Knowledge Graph, pinned revisions
  that moved, a check that does not verify the credited claim, a method
  mismatch, a subject older than `HEAD`, inaccessible or expired
  artifacts, and a recorded failed outcome.
- `unverifiable-evidence-subject`, `unverifiable-evidence-target`,
  `unverified-evidence-artifact`, `attestation-only-evidence`,
  `inconclusive-evidence` — non-blocking Evidence axes: subjects that
  cannot be digest-verified in this checkout, artifacts never
  digest-verified, attestation-only records, and outcomes that are not
  a conclusive pass/fail. The Evidence Store stays read-only for the
  linter — records are re-assessed, never copied into Markdown.
  Repo-wide queries only; `--state-root`/`--allow-external-root`
  select the store root.

Relation targets resolve by unique artifact ID first, then by repository or
document-relative path. Missing relations are never inferred from filenames or
path proximity. Broken link targets and orphan remedies are never inferred
either; they are reported for review or explicit maintenance.

## Read-Only Invariant

`list_docs.js` and `audit_docs.js` never modify project documents. Repairs and
index regeneration are delegated to a separate maintenance capability.

## Resources

- `scripts/doc_status.js`: unified read-only entry point with `list`,
  `lint`, `audit`, and `health` commands, shared filters, and stable JSON
  output over the shared Finding contract.
- `scripts/list_docs.js`: list document metadata by type and status.
- `scripts/audit_docs.js`: validate front matter, statuses, relations, links,
  index coverage, and orphans. `--external-links` enables opt-in external
  link probing; `--owners` extends `--type all` into the package-wide
  audit; `--state-root`/`--allow-external-root` select the Evidence Store
  the repo-level `evidence` gate reads.

## Graph Effect Outcome

When `doc-driven-dev-graph` invokes this skill, return exactly the
[`EffectOutcome footer`](../doc-driven-dev-graph/references/execution-outcome-contract.md)
after each audit or delegate effect; do not create a local partial variant.

Use `completed` for a Completable result, `retry` for Returned with declared
repair evidence, and `yield` with `unrecoverable-blocker` for Returned without
a safe repair. The required `edgeId`, stage, effect identity, authoritative
input scope, and proof fields are defined by that footer.

For a manually generated offline HTML view of graph facts, remaining tasks,
status-lane task cards, and draft documents, use
[doc-dashboard](../doc-dashboard/SKILL.md).
