# オーナーシップ契約

各オーナー管理ドキュメントディレクトリには、ちょうど 1 つの所有スキルが
ある。以下の表は規範であり、
`scripts/doc-driven-dev/src/skills/lib/doc_ownership.ts` の
`DIRECTORY_CONTRACTS` との一致を自動テストが保証する。コードを変更せずに
表だけを編集してはならない。

明示的な `--dir` は必ず共有の containment 境界を通して解決される(既存
ディレクトリは real path に正規化)ため、alias や表記揺れは同一の
オーナー行に集約される。

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

- `doc-suite`: `new_idea`、`new_discovery`、`new_spec`、`new_plan`、
  `new_task`、`new_design`、`new_test_spec`、`doc_maintenance`、
  `scaffold_docs`、`migrate_docs`、`migrate_ids`
- `adr-doc`: `new_adr`、`update_index`、`relate_adr`、`doc_maintenance`、
  `scaffold_docs`、`migrate_docs`、`migrate_ids`
- `impl-doc`: `new_impl_record`、`new_experiment_log`、
  `append_experiment_event`、`edit_experiment_log`、`migrate_ids`

## Audit owners per owner

- `doc-suite`: `doc_status`、`audit_docs`、`list_docs`
- `adr-doc`: `audit_adr`、`review_adr`、`list_adrs`、`migrate_report`、
  `check_code_links`。加えて共有 4 列 index については上記 doc-suite の
  検査 CLI も有効
- `impl-doc`: `audit_impl_record`、`audit_experiment_log`

## Scope rules

- オーナー未定義のディレクトリ(checkout 内のカスタム `--dir`)は任意の
  type を受け付ける。オーナーシップが未記載のパスを占有することはない。
- `doc_maintenance` による index 修復は `shared-4col` 領域のみが対象。
  `impl-4col` / `exp-1col` の index は impl-doc のツールのみが修復し、
  `--force-index` でこの境界を越えることはできない。
- `docs/impl` は resident type を持たないオーナー管理コンテナであり、
  直下への作成・監査はできない。
- scope 不適合は fail-closed:CLI は理由付きで非ゼロ終了し、ファイルの
  作成・変更・削除は一切行われない。
