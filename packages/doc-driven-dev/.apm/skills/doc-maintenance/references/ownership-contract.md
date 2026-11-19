# Ownership Contract

Every owned doc directory has exactly one owning skill. This table is
normative: it is kept consistent with `DIRECTORY_CONTRACTS` in
`scripts/doc-driven-dev/src/skills/lib/doc_ownership.ts` by an automated
test. Do not edit the table without updating the code in the same change.

Directory resolution always maps an explicit `--dir` through the shared
containment boundary first (real path for existing dirs), so aliases and
case/spelling variants resolve to the same owned row.

## Directory contract

| Directory | Owner | Resident types | Index format |
| --- | --- | --- | --- |
| `adr` | adr-doc | adr | shared-4col |
| `decisions` | adr-doc | adr | shared-4col |
| `design` | doc-suite | design | shared-4col |
| `designs` | doc-suite | design | shared-4col |
| `docs/adr` | adr-doc | adr | shared-4col |
| `docs/adrs` | adr-doc | adr | shared-4col |
| `docs/decisions` | adr-doc | adr | shared-4col |
| `docs/design` | doc-suite | design | shared-4col |
| `docs/designs` | doc-suite | design | shared-4col |
| `docs/discovery` | doc-suite | brainstorm, discovery | shared-4col |
| `docs/ideas` | doc-suite | idea | shared-4col |
| `docs/impl` | impl-doc | — | none |
| `docs/impl/exp` | impl-doc | exp | exp-1col |
| `docs/impl/ir` | impl-doc | impl | impl-4col |
| `docs/implementation-plans` | doc-suite | plan | shared-4col |
| `docs/knowledge` | doc-suite | knowledge | shared-4col |
| `docs/plans` | doc-suite | plan | shared-4col |
| `docs/spec` | doc-suite | spec | shared-4col |
| `docs/specs` | doc-suite | spec | shared-4col |
| `docs/tasks` | doc-suite | task | shared-4col |
| `docs/test-spec` | doc-suite | test-spec | shared-4col |
| `docs/test-specs` | doc-suite | test-spec | shared-4col |
| `docs/verification` | doc-suite | verification | shared-4col |
| `docs/work-items` | doc-suite | task | shared-4col |
| `implementation-plans` | doc-suite | plan | shared-4col |
| `plans` | doc-suite | plan | shared-4col |
| `spec` | doc-suite | spec | shared-4col |
| `specs` | doc-suite | spec | shared-4col |
| `tasks` | doc-suite | task | shared-4col |
| `test-spec` | doc-suite | test-spec | shared-4col |
| `test-specs` | doc-suite | test-spec | shared-4col |
| `work-items` | doc-suite | task | shared-4col |

## Persistence per resident type

Registry 3 splits the rows above into three persistence classes:

- **Durable residents** (`idea`, `brainstorm`, `discovery`, `spec`,
  `design`, `adr`, `knowledge`, `verification`) — canonical Git
  documents; their dirs are scaffolded, indexed, linted, and audited
  normally.
- **Execution-bound residents** (`plan`, `task`) — `persistence:
  ephemeral`; their dirs are *former* directories under Registry 2.
  They stay owned scopes so nothing unmanaged grows there, but they are
  never write targets: plan/task state lives in the Execution Store,
  and every normal writer fails closed on these rows.
- **Legacy residents** (`test-spec`, `impl`, `exp`) — migration-only
  formats. Their dirs are migration-owned scopes: interpreted by
  `migrate_docs` / `migrate_ids` only, and refused by every normal
  creator, linter, and index writer.

## Allowed mutators per owner

- `doc-suite`: `new_idea`, `new_discovery`, `new_spec`, `new_design`,
  `new_knowledge`, `new_verification`, `update_verification`,
  `doc_maintenance`,
  `scaffold_docs`, `migrate_docs`, `migrate_ids`. `update_verification`
  is the verification type's in-place design updater (check upserts and
  removals); `resolve_verification` is its read-only Claim/Check
  resolver, declared as an auditor alongside the shared inspectors. The
  retired creators are gone entirely: `new_test_spec`, `new_plan`, and
  `new_task` were removed in Issue #249 — the registry declares no
  mutator for these types (`mutators: []`) since execution-bound or
  migration-only types have no durable creation path.
- `adr-doc`: `new_adr`, `update_index`, `relate_adr`, `promote_index`,
  `doc_maintenance`, `scaffold_docs`, `migrate_docs`, `migrate_ids`
- `impl-doc`: `migrate_ids`, `promote_index`. `new_impl_record`,
  `new_experiment_log`, `append_experiment_event`, `edit_experiment_log`,
  and `sync_impl_index` were removed in Issue #249 — the impl/exp
  formats are migration-owned; their index engine runs only inside
  `migrate_ids` (which calls the sync library directly).

## Audit owners per owner

- `doc-suite`: `doc_status`, `audit_docs`, `list_docs`
- `adr-doc`: `audit_adr`, `review_adr`, `list_adrs`, `migrate_report`,
  `check_code_links` plus the doc-suite inspectors above for the shared
  4-column index
- `impl-doc`: `audit_impl_record`, `audit_experiment_log`

## Index initialization

`scaffold_docs` is an immediate-create initializer, not a preview-first
maintenance run: it creates every canonical *durable* directory and writes
each directory's contract index when none exists. Shared-suite dirs get
the typed managed index; `docs/adr` gets the owner's contract format —
4-column + `## Settled` — always carrying
`<!-- doc-suite:generated-index -->` so the owning writers never see
scaffold output as hand-curated. Execution-bound and migration-owned
dirs are never scaffolded. Existing READMEs are never overwritten.

A README produced by a pre-#184 scaffold has no marker and blocks owner
index writes. `promote_index` (preview, `--apply` to write) promotes only a
file byte-identical to that exact legacy output — EOL normalization aside —
and regenerates it through the owning writer. Any other content is rejected
and left byte-identical; there is no force path for unverified files.

## Scope rules

- A directory with no owner (a custom `--dir` inside the checkout) accepts
  any type. Ownership never claims unlisted paths.
- Only `shared-4col` territory with durable residents is eligible for
  `doc_maintenance` index repair. `impl-4col` and `exp-1col` indexes are
  migration-owned — reconciled only inside `migrate_ids`, which calls
  the impl sync engine directly; `--force-index` never widens this
  boundary.
- `doc_maintenance index` is the index-only materialization op, distinct
  from `plan|apply` repair: it dispatches each write to the directory's
  owning writer (the shared renderer/merge for `shared-4col` or the ADR
  managed writer). Rows whose residents are execution-bound or legacy
  are migration-owned — the op reports them as rejected targets
  (`... index is migration-owned`) and writes nothing.
- `migrate_docs` routes by a recognized front-matter `type:` first and
  content patterns second. A pattern-only route into an owned directory
  (`docs/adr`, `docs/impl/ir`, `docs/impl/exp`) is skipped as
  `unsupported-owner-route` — a content guess never mints files under
  another owner. Typed `type: adr` sources still migrate through the
  declared `adr-doc` mutator row; `migrate_docs` stays off the `impl-doc`
  mutator list.
- `migrate_ids` regenerates every touched index through the owning writer —
  the shared managed-index writer for durable `shared-4col`, the ADR
  managed writer for `docs/adr`, and the impl safe sync engine (called
  directly — the `sync_impl_index` CLI no longer ships) for
  `impl-4col` and `exp-1col`. It never writes an owner index directly;
  an index the owner refuses is reported `skipped` or `blocked`, never
  forced.
- `docs/impl` is an owned container with no resident types: nothing may be
  created or audited directly inside it.
- Scope mismatches fail closed: the CLI exits non-zero with a reason, and
  no file is created, modified, or deleted.
