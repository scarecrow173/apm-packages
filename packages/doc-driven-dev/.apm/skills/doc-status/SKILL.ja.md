---
name: doc-status
description: document-driven development の成果物、ステータス、索引、意味付き relation を一覧・監査するときに使います。
license: MIT
---

# Document Status Skill

この skill は、Registry 3 の durable 文書型 —— `idea`、`brainstorm`、
`discovery`、`spec`、`design`、`adr`、`knowledge`、`verification` —— の
ライフサイクル状態と relation の健全性を確認するために使います。標準では
報告・判定専用であり、作成系または索引更新系のコマンドを使わない限り
プロジェクトファイルを変更しません。

`--type plan`、`--type task`、`--type test-spec` は Registry 3 で拒否される
scope です。`plan`/`task` は execution-bound(状態は Execution Store にある)、
`test-spec` は legacy・migration 専用形式であり、いずれも linter が検査
できる durable 文書ではありません。

## 監査の役割

この skill は文書駆動開発の整合性ゲートキーパーとして機能する。
監査結果は次の判定に使われる:

- **Completable**: ブロッキング指摘なし → 文書セット全体が整合・追跡可能。
- **Returned**: ブロッキング指摘あり → 該当文書の修正が必要。

ブロッキング指摘の例:

- 必須フロントマターフィールドの欠落（id, type, status, relations）
- 壊れた内部 relation（参照先ファイルが存在しない）
- 索引に未登録の文書
- `exit-audit` node 前に残った型付き Knowledge Relation の問題 ——
  未解決または曖昧なターゲット、relation cycle、migration 以外が
  持てない legacy relation フィールド
- 文書の格納された type・lifecycle・status が Document Registry 3 と
  不整合である

## Output Contract

監査結果は次の構造で返す:

- `Verdict`: `Completable` または `Returned`
- `Blocking findings`: 進行を止める問題
- `Warnings`: ブロッキングではないが修正したい問題
- `Relation errors`: 壊れた内部リンクまたは不整合な relation
- `Index gaps`: 足りない registry / index coverage
- `Next actions`: ゲート通過に必要な最小の修復。各 blocking finding を
  解決できる最小の graph repair point（router が戻る node）を示す

## ワークフロー

統一エントリポイント `doc_status.js` は 4 つの read-only コマンドを提供する。
`list_docs.js` と `audit_docs.js` は互換 wrapper として残る。

1. 種別またはステータスで文書を一覧する。各エントリは `status` と
   `created`（キャプチャ層の経過）を表示する。

   ```bash
   node scripts/doc_status.js list --type spec
   node scripts/list_docs.js --type spec --status draft
   ```

2. finding を列挙（`lint`）またはゲート要約を評価（`audit`）する。

   ```bash
   node scripts/doc_status.js lint --type spec --rule broken-link
   node scripts/doc_status.js audit --type spec --json
   node scripts/audit_docs.js --type spec
   ```

3. リポジトリ全体の health を category 別に集約する。

   ```bash
   node scripts/doc_status.js health
   node scripts/doc_status.js health --json
   ```

   `health` は同じ findings の集約ビューであり、別の scanner ではない。
   数値スコアは報告しない。`Orphans` 行（`--json` では `orphans`）が
   `orphan-*` findings をルール別・文書型別に集約する。
   repo-level の findings は独自の `migration` / `evidence` category に
   集約される。

   共通フィルタ: `--type`, `--dir`, `--rule`, `--severity`, `--blocking`,
   `--status`（list）, `--json`, `--external-links`,
   `--profile`（lint, audit, health）, `--state-root`,
   `--allow-external-root`。最後の 2 つは repo-level の `evidence` gate
   が読み取る Evidence Store を選択する —— repository 外の
   `--state-root` は `--allow-external-root` を指定しない限り拒否
   される。Execution/Evidence CLI が強制するのと同じ containment
   contract である。
   finding は決定的順序で
   出力され、exit status は呼び出し自体が不正な場合のみ `0` 以外になる。

   `audit_docs.js --type all` が監査するのは shared durable suite のみ ——
   `idea`、`brainstorm`、`discovery`、`spec`、`design`、`adr`、
   `knowledge`、`verification` です。impl-doc の所有 directory
   （`docs/impl/ir`、`docs/impl/exp`）は `--type` scope に含まれません。
   その整合性は `audit_impl_record.js` と `audit_experiment_log.js` が
   所有します。
   `audit_docs.js --type all --owners` は package-wide audit です:
   shared report に `impl-record` と `experiment-log` の `ownerAudits`
   entry を追加します。`--owners` は `--type all` を必須とし、`--dir`
   とは併用できません。owner audit は `--profile` に関係なく常に
   full check を実行します。

   絞り込みのない query —— `--type all`、または `--dir` なしで `--type`
   を省略 —— は、追加で 2 つの repo-level gate を実行します。
   `execution-boundary` gate は、リポジトリモデルが migration コーパスと
   分類するすべてのファイルを棚卸しします。migration 所有 directory
   配下の Markdown（旧 `plan`/`task` ホームと legacy
   `test-spec`/`impl`/`exp` scope）に加え、`plan`、`task`、`test-spec`、
   `impl`、`exp` を type 宣言したファイルはどこに置かれていても対象です
   —— durable な directory がそれらを durable 文書にすることはありません。
   `git ls-files` が tracking の権威です。Git-tracked なファイルには
   `tracked-execution-doc` または `tracked-legacy-doc` を報告します
   （durable な Git 形式はもう存在しない —— その状態は Execution Store
   にあるか migration ツールの管轄）。index が track していない
   コンテンツ —— untracked の残存物、gitignore されたファイル、または
   利用可能な Git work tree がない場所のコーパス —— には
   `legacy-corpus-doc` を報告し、推測で tracked とはしません。いずれも
   blocking の `migration` finding で、repair class は `migration` であり、
   safe な修正経路ではありません。
   `evidence` gate はまず Evidence Store 自身の marker を監査します
   —— 破損または不正な `manifest.json` には `corrupt-evidence-store`、
   manifest のない record ファイルには `unmanifested-evidence-store`、
   store が存在しなければ何も報告しません —— そのうえで全 record を
   live な Knowledge Graph と checkout の `HEAD` subject に対して
   再評価します —— 失敗した軸ごとに 1 finding（rule 一覧は後述）。
   `--type` や `--dir` で絞り込んだ query はこれらの gate を実行せず、
   レポートの `gates` envelope では `skipped` に列挙されます。

   `doc-driven-dev-graph` の named audit は次のコマンドに対応します:
   durable 文書型（`spec`, `adr`, `design`, `idea`, `brainstorm`,
   `discovery`, `knowledge`, `verification`）は
   `audit_docs.js --type <name> --profile artifact`。`plan`、`task`、
   `test-spec` の名前は拒否される Registry 3 scope に解決されます(上記
   参照)。`all` は全 canonical 文書型に加えて、root-level の unmanaged
   Markdown と
   配布 `.apm` skill 文書への legacy-reference sweep も対象とする
   `audit_docs.js --type all --profile artifact`、
   `impl-record` は `impl-doc/scripts/audit_impl_record.js`、`experiment-log` は
   `impl-doc/scripts/audit_experiment_log.js` です（profile flag は不要 ——
   index の観測は non-blocking warning のみ）。
   Graph から dispatch される audit は `artifact` profile で実行されるため、
   missing または stale な index が graph execution を gate することは
   ありません。直接の厳密チェックでは `--profile` を省略して default の
   `materialized` coverage を維持できます。Graph Definition v3 では
   `exit-audit` node は named audit `all` のみを実行します ——
   `impl-record` と `experiment-log` は `--owners` の opt-in であり、
   graph から dispatch される scope ではありません。`all` は
   `--profile artifact` を維持するため、index の状態に graph execution を
   gate させることはありません。

4. `relations.source` は外部出典として扱う。
   HTTP、HTTPS、mail link は許可し、存在しないローカルファイルとして
   報告しません。
5. v3 以前の relation キーは migration 領域の入力として扱う。
   値が記録された legacy キー（`implements`、`derives-from`、`references`、
   `related`、逆名など）は `legacy-relation-field` として報告され、
   現行グラフの辺として解決・走査されることはありません。
6. 壊れた内部 relation、不正ステータス、必須フロントマター欠落、
   索引欠落を報告する。

## 監査カバレッジ

監査は共有 document repository model 上で実行され、すべての問題を安定した
rule ID で報告する。`--profile materialized`（デフォルト）は以下の全 rule
を評価し、`--profile artifact` は canonical 文書の完全性のみを評価して
index チェックをスキップする —— missing / stale な index は
artifact profile の finding を一切生じさせない。JSON 出力は有効な
profile と、実行・スキップされたチェック群を報告する。対象チェック:

- `unparseable-front-matter`, `invalid-front-matter`, `invalid-type`,
  `invalid-status` — フロントマターと文書 contract の違反。
- `missing-lifecycle`, `invalid-lifecycle` — Registry 3 の lifecycle 軸
  (`draft`、`current`、`superseded`、`retired`)は独立した contract で
  あり、`status` からは読み取らない。欠落は `missing-lifecycle`
  (migration debt、docs migration で修復可能)、軸外の値が記録されている
  場合は `invalid-lifecycle`。
- `invalid-id-format`, `invalid-id-prefix`, `duplicate-id` — artifact
  identity の違反。
- `broken-relation-link`, `ambiguous-relation-target`,
  `relation-escapes-root`, `self-relation`, `invalid-relation-field`,
  `invalid-relation-target-type`, `relation-cycle` — Knowledge Graph が
  投影する意味 relation の違反。格納される relation は正規の順方向
  field（`motivates`、`decides-for`、`realizes`、`informs`、`explains`、
  `supersedes`）のみであり、逆名は派生投影のため reciprocal-link
  チェックは存在しない — 一貫性は構造上保証される。
- `invalid-claim-id`, `claim-without-doc-id`, `duplicate-claim`,
  `claim-doc-mismatch`, `unresolved-claim-target` — Claim マーカーと
  安定 Claim ID（`<DOC-ID>::<CLAIM-ID>`）の違反。
- `legacy-relation-field` — 値が記録された v3 以前の relation キー。
  migration 領域の指摘であり、グラフ入力にはならない。
- `unresolved-legacy-reference` — 本文中の旧 `TYPE-NNNN` artifact id 参照で、
  対応する artifact が存在しないもの。番号付き `.jsonl` log を持たない
  `EXP-NNNN` experiment 参照も含む。既存 artifact や experiment file に
  解決できる token は報告しないため、migration 前のリポジトリは
  クリーンなまま。
- `ambiguous-experiment-reference` — 同一番号の numbered `.jsonl` experiment
  log が複数存在し、一意の canonical path を決められない `EXP-NNNN` 参照。
  `.jsonl` path へ手動で書き換える必要がある。
- `missing-required-relation`, `invalid-relation-target-type` — 汎用の
  relation 契約 rule: 型で宣言された必須 relation が欠落しているか、
  記録された relation が contract の許可しない型を指している。
  (Registry 2 の型別 `test-spec-*` / `plan-missing-test-spec-evidence`
  rule はその型とともに廃止。)
- `provenance-missing-source`, `provenance-invalid-source`,
  `provenance-unresolved-local-source` — `relations.source` の provenance。
  ローカル source path はリポジトリ内で解決必須。外部 URL は外部
  evidence として分類し、`--external-links` 指定時のみ疎通確認する。
- `traceability-missing-upstream` — type-aware な upstream の期待。
  Knowledge Relations v1 で上流を期待する durable 型は `design`
  (`realizes` 経由)のみ。settled でない design が `realizes` relation を
  宣言していない場合に指摘する。settled status(`superseded`、`rejected`、
  `archived`、`deprecated`、`abandoned`、`wont-do`)は対象外。
- `stale-upstream` — 死んだ上流に乗っている in-flight 文書。
  `motivates` / `decides-for` / `realizes` のターゲットが、dead status
  （`superseded`, `rejected`, `deprecated`, `archived`, `abandoned`,
  `wont-do`, `completed`, `done`）の文書に解決した場合、dead ターゲット
  ごとに warning を出す。`approved`/`accepted`/`implemented`/`resolved`
  の上流や settled な文書はフラグされない。non-blocking な warning:
  stale 系譜は契約違反ではなく、向き先変更またはクローズを促す
  シグナル。
- `missing-overview` — 必須 canonical ディレクトリ文書。両 profile で実行。
- `missing-index`, `index-missing-entry`, `index-missing-overview` —
  索引の存在とカバレッジの欠落。materialized profile のみ。
- `broken-link`, `missing-image-link`, `broken-anchor`, `link-escapes-root`,
  `link-case-mismatch` — ローカル Markdown link と anchor の整合性。
- `index-stale-entry`, `index-duplicate-entry`, `index-metadata-mismatch`,
  `index-ordering`, `index-tier-mismatch`, `index-unparseable`,
  `index-escapes-root` — 索引テーブルの整合性。materialized profile のみ。
  管理索引は status-aware —— in-flight の行が先、その下に `## Settled`
  層が続く。`index-ordering` は deterministic ordering 違反の行を、
  `index-metadata-mismatch` は front matter と不一致になった status
  セルを指摘する。`index-tier-mismatch` は誤った層にある管理索引の行 ——
  active テーブルに残った settled 文書、または `## Settled` 下の
  in-flight 文書 —— を指摘する `materialized` profile の warning で、
  索引を手編集するのではなく、所有する materialization path
  （索引の再生成）で修復します。
- `orphan-index` — 索引未掲載の文書。materialized profile のみ。
- `orphan-navigation`, `orphan-relation` — canonical Markdown link の
  どれからも到達不能、または意味 relation を持たない文書。両 profile;
  `artifact` では index ファイル内の link は inbound navigation に
  カウントしない。severity は type-aware で、root artifact として許可
  される type は `info`、それ以外は `warning` として報告する。
- `external-link-broken`, `external-link-redirect`,
  `external-link-unverifiable` — `audit_docs.js --external-links` による
  opt-in の外部リンク確認。デフォルトでは無効で、監査は決定的かつ
  オフライン安全を維持する。
- `legacy-doc-in-durable-dir` — durable scope 内にあるファイルで、宣言
  `type:` に durable な Git 形式がないもの（execution-bound な
  `plan`/`task`、legacy な `test-spec`/`impl`/`exp`）。そのファイルは
  migration コーパスであり、その scope の文書ではない —— scope の
  どの rule も index 行も適用されない。scoped / repo-wide いずれの
  query でも blocking の `migration` マーカーを報告する。
- `tracked-execution-doc`, `tracked-legacy-doc`, `legacy-corpus-doc` —
  リポジトリモデルが migration コーパスと分類する Markdown を対象に
  する repo-level の migration sweep（旧 `plan`/`task` ホーム、legacy
  `test-spec`/`impl`/`exp` scope、および execution-bound / legacy な
  type を持つファイルは設置場所を問わない）。`git ls-files` が
  tracking の権威: tracked なファイルには
  `tracked-execution-doc`/`tracked-legacy-doc`、untracked・gitignore・
  検証不能なコンテンツには `legacy-corpus-doc` を報告 —— 推測で
  tracked とはしない。blocking の `migration` category マーカーで、
  修復は `doc_maintenance.js` の `migrate` 系が所有する。
  repo-wide query のみ。
- `corrupt-evidence-store`, `unmanifested-evidence-store` — Evidence
  Store の marker 整合性: 読み取れない、または検証に失敗する
  `manifest.json` には `corrupt-evidence-store`（blocking error）、
  write-once manifest のない record ファイルには
  `unmanifested-evidence-store`（blocking warning）。証明できない
  marker 配下の record にも個別軸の評価は行う。store が存在しない
  場合は何も報告しない。repo-wide query のみ。
- `unresolved-evidence-claim`, `unresolved-evidence-check`,
  `stale-evidence-revision`, `evidence-check-target-mismatch`,
  `evidence-method-mismatch`, `stale-evidence-subject`,
  `evidence-artifact-unavailable`, `evidence-artifact-expired`,
  `failed-evidence` — blocking の Evidence Store 軸: live な Knowledge
  Graph で解決できなくなった claim/check 参照、動いた pin revision、
  記録された claim を検証しない check、method の不一致、`HEAD` より
  古い subject、到達不能または期限切れの artifact、記録された failed
  outcome。
- `unverifiable-evidence-subject`, `unverifiable-evidence-target`,
  `unverified-evidence-artifact`, `attestation-only-evidence`,
  `inconclusive-evidence` — non-blocking の Evidence 軸: この checkout
  で digest 検証できない subject、一度も digest 検証されていない
  artifact、attestation-only の record、決定的な pass/fail でない
  outcome。linter にとって Evidence Store は read-only —— record は
  再評価されるだけで、Markdown へコピーされることはない。
  repo-wide query のみ。`--state-root`/`--allow-external-root` で
  store root を選択する。

relation target はまず一意な artifact ID で解決し、次にリポジトリ相対または
文書相対パスで解決する。欠落した relation をファイル名やパス近接から
推測しない。壊れた link target や orphan の対処も推測せず、レビューまたは
明示的な maintenance へ報告する。

## Read-Only Invariant

`list_docs.js` と `audit_docs.js` はプロジェクト文書を一切変更しない。
修復と索引再生成は別の maintenance capability に委譲される。

## リソース

- `scripts/doc_status.js`: `list` / `lint` / `audit` / `health` コマンド、
  共通フィルタ、共有 Finding contract 上の安定した JSON 出力を持つ
  統一 read-only エントリポイント。
- `scripts/list_docs.js`: 種別とステータスで文書メタデータを一覧します。
- `scripts/audit_docs.js`: フロントマター、ステータス、relation、link、
  索引、orphan を検証します。`--external-links` で opt-in の外部リンク
  確認を有効化し、`--owners` は `--type all` を package-wide audit に
  拡張し、`--state-root`/`--allow-external-root` は repo-level の
  `evidence` gate が読み取る Evidence Store を選択します。

## Graph Effect Outcome

`doc-driven-dev-graph` からこの skill が呼び出された場合、audit または delegate effect
ごとに正確な [`EffectOutcome footer`](../doc-driven-dev-graph/references/execution-outcome-contract.ja.md)
を返します。local partial variant を作成しません。

Completable result には `completed`、declared repair evidence を伴う Returned には
`retry`、safe repair のない Returned には `unrecoverable-blocker` を理由とする `yield`
を使います。必須の `edgeId`、stage、effect identity、authoritative input scope、proof
field はその footer が定義します。

Graph の状態、ステータス別タスクカード、残存タスク、draft 文書を手動生成する
オフライン HTML で確認するには、[doc-dashboard](../doc-dashboard/SKILL.ja.md) を使います。
