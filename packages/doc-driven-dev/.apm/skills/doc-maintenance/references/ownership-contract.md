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
| `docs/plans` | doc-suite | plan | shared-4col |
| `docs/spec` | doc-suite | spec | shared-4col |
| `docs/specs` | doc-suite | spec | shared-4col |
| `docs/tasks` | doc-suite | task | shared-4col |
| `docs/test-spec` | doc-suite | test-spec | shared-4col |
| `docs/test-specs` | doc-suite | test-spec | shared-4col |
| `docs/work-items` | doc-suite | task | shared-4col |
| `implementation-plans` | doc-suite | plan | shared-4col |
| `plans` | doc-suite | plan | shared-4col |
| `spec` | doc-suite | spec | shared-4col |
| `specs` | doc-suite | spec | shared-4col |
| `tasks` | doc-suite | task | shared-4col |
| `test-spec` | doc-suite | test-spec | shared-4col |
| `test-specs` | doc-suite | test-spec | shared-4col |
| `work-items` | doc-suite | task | shared-4col |

## Allowed mutators per owner

- `doc-suite`: `new_idea`, `new_discovery`, `new_spec`, `new_plan`,
  `new_task`, `new_design`, `new_test_spec`, `doc_maintenance`,
  `scaffold_docs`, `migrate_docs`, `migrate_ids`
- `adr-doc`: `new_adr`, `update_index`, `relate_adr`, `doc_maintenance`,
  `scaffold_docs`, `migrate_docs`, `migrate_ids`
- `impl-doc`: `new_impl_record`, `new_experiment_log`,
  `append_experiment_event`, `edit_experiment_log`, `migrate_ids`

## Audit owners per owner

- `doc-suite`: `doc_status`, `audit_docs`, `list_docs`
- `adr-doc`: `audit_adr`, `review_adr`, `list_adrs`, `migrate_report`,
  `check_code_links` plus the doc-suite inspectors above for the shared
  4-column index
- `impl-doc`: `audit_impl_record`, `audit_experiment_log`

## Scope rules

- A directory with no owner (a custom `--dir` inside the checkout) accepts
  any type. Ownership never claims unlisted paths.
- Only `shared-4col` territory is eligible for `doc_maintenance` index
  repair. `impl-4col` and `exp-1col` indexes are repaired by impl-doc
  tooling only; `--force-index` never widens this boundary.
- `docs/impl` is an owned container with no resident types: nothing may be
  created or audited directly inside it.
- Scope mismatches fail closed: the CLI exits non-zero with a reason, and
  no file is created, modified, or deleted.
