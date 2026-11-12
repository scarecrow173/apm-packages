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
- `adr-doc`: `new_adr`、`update_index`、`relate_adr`、`promote_index`、
  `doc_maintenance`、`scaffold_docs`、`migrate_docs`、`migrate_ids`
- `impl-doc`: `new_impl_record`、`new_experiment_log`、
  `append_experiment_event`、`edit_experiment_log`、`migrate_ids`、
  `promote_index`、`sync_impl_index`

## Audit owners per owner

- `doc-suite`: `doc_status`、`audit_docs`、`list_docs`
- `adr-doc`: `audit_adr`、`review_adr`、`list_adrs`、`migrate_report`、
  `check_code_links`。加えて共有 4 列 index については上記 doc-suite の
  検査 CLI も有効
- `impl-doc`: `audit_impl_record`、`audit_experiment_log`

## Index initialization

`scaffold_docs` は preview-first の maintenance ではなく、即時作成の
初期化ツールである。全 canonical ディレクトリを作成し、index が
存在しない場合はそのディレクトリの contract index を書き込む。
shared-suite のディレクトリには型付き managed index を、
`docs/adr`・`docs/impl/ir`・`docs/impl/exp` にはオーナーの contract
形式(ADR と IR は 4 列+`## Settled`、EXP は 1 列 `| File |`)を、常に
`<!-- doc-suite:generated-index -->` 付きで生成する。これによりオーナー
writer が scaffold 出力を hand-curated と誤認することはない。既存の
README は一切上書きしない。

Issue #184 以前の scaffold が生成した README には marker がなく、オーナーの
index 書き込みをブロックする。`promote_index`(preview、`--apply` で
書き込み)は、その旧出力とバイト一致(EOL 正規化のみ考慮)する
ファイルのみを昇格対象とし、オーナー writer を通じて再生成する。
それ以外の内容は拒否され、ファイルはバイト単位で不変のまま残る。
未検証ファイルへの force 経路は存在しない。

## Scope rules

- オーナー未定義のディレクトリ(checkout 内のカスタム `--dir`)は任意の
  type を受け付ける。オーナーシップが未記載のパスを占有することはない。
- `doc_maintenance` による index 修復は `shared-4col` 領域のみが対象。
  `impl-4col` / `exp-1col` の index は `sync_impl_index` のみが同期し、
  `--force-index` でこの境界を越えることはできない。
- `doc_maintenance index` は `plan|apply` の修復とは別の、index 専用
  materialization op である。各書き込みをディレクトリのオーナー writer
  （`shared-4col` では共有 renderer/merge、ADR managed writer、impl
  sync エンジン）に分派する。`impl-4col` / `exp-1col` の index は
  引き続き `sync_impl_index` の safe sync API のみが書き込み、この
  op は直接書き込まず同 API に委譲する。
- `migrate_docs` は front matter で認識された `type:` を先に、content
  pattern を次に route する。pattern のみでオーナー管理ディレクトリ
  （`docs/adr`、`docs/impl/ir`、`docs/impl/exp`）へ到達した route は
  `unsupported-owner-route` として skip され、content の推測が他
  オーナー配下にファイルを生成することはない。typed な `type: adr`
  の source は宣言済み `adr-doc` mutator 行を通じて引き続き migrate
  する。`migrate_docs` は `impl-doc` の mutator 一覧に含まれないまま
  である。
- `migrate_ids` は触れた index をすべてオーナー writer 経由で再生成
  する。`shared-4col` は共有 managed-index writer、`docs/adr` は ADR
  managed writer、`impl-4col` と `exp-1col` は `sync_impl_index` の
  safe sync エンジンである。オーナー index を直接書き込むことはなく、
  オーナーが拒否した index は強制されず `skipped` または `blocked`
  として報告される。
- `docs/impl` は resident type を持たないオーナー管理コンテナであり、
  直下への作成・監査はできない。
- scope 不適合は fail-closed:CLI は理由付きで非ゼロ終了し、ファイルの
  作成・変更・削除は一切行われない。
