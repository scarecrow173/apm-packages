---
name: doc-status
description: document-driven development の成果物、ステータス、索引、意味付き relation を一覧・監査するときに使います。
license: MIT
---

# Document Status Skill

この skill は、spec、design、plan、task、test spec、その他の canonical document
type のライフサイクル状態と relation の健全性を確認するために使います。標準では
報告・判定専用であり、作成系または索引更新系のコマンドを使わない限り
プロジェクトファイルを変更しません。

## 監査の役割

この skill は文書駆動開発の整合性ゲートキーパーとして機能する。
監査結果は次の判定に使われる:

- **Completable**: ブロッキング指摘なし → 文書セット全体が整合・追跡可能。
- **Returned**: ブロッキング指摘あり → 該当文書の修正が必要。

ブロッキング指摘の例:

- 必須フロントマターフィールドの欠落（id, type, status, relations）
- 壊れた内部 relation（参照先ファイルが存在しない）
- 索引に未登録の文書
- `followup-triage` node から `exit-audit` node 前に残った未分類フォローアップ
- 必須の上流 relation または依存リンクを欠くフォローアップ task

## Output Contract

監査結果は次の構造で返す:

- `Verdict`: `Completable` または `Returned`
- `Blocking findings`: 進行を止める問題
- `Warnings`: ブロッキングではないが修正したい問題
- `Relation errors`: 壊れた内部リンクまたは不整合な relation
- `Index gaps`: 足りない registry / index coverage
- `Next actions`: ゲート通過に必要な最小フォローアップ。未分類フォローアップが
  残っている場合は、分類または修復できる最小の戻り先を示す

## ワークフロー

統一エントリポイント `doc_status.js` は 4 つの read-only コマンドを提供する。
`list_docs.js` と `audit_docs.js` は互換 wrapper として残る。

1. 種別またはステータスで文書を一覧する。

   ```bash
   node scripts/doc_status.js list --type spec
   node scripts/list_docs.js --type task --status in-progress
   ```

2. finding を列挙（`lint`）またはゲート要約を評価（`audit`）する。

   ```bash
   node scripts/doc_status.js lint --type spec --rule broken-link
   node scripts/doc_status.js audit --type plan --json
   node scripts/audit_docs.js --type spec
   ```

3. リポジトリ全体の health を category 別に集約する。

   ```bash
   node scripts/doc_status.js health
   node scripts/doc_status.js health --json
   ```

   `health` は同じ findings の集約ビューであり、別の scanner ではない。
   数値スコアは報告しない。

   共通フィルタ: `--type`, `--dir`, `--rule`, `--severity`, `--blocking`,
   `--status`（list）, `--json`, `--external-links`。finding は決定的順序で
   出力され、exit status は呼び出し自体が不正な場合のみ `0` 以外になる。

   `doc-driven-dev-graph` の named audit は次のコマンドに対応します:
   文書型（`spec`, `adr`, `design`, `plan`, `task`, `test-spec`, `idea`,
   `brainstorm`, `discovery`）は `audit_docs.js --type <name>`、
   `all` は全 canonical 文書型に加えて、root-level の unmanaged Markdown と
   配布 `.apm` skill 文書への legacy-reference sweep も対象とする
   `audit_docs.js --type all`、
   `impl-record` は `impl-doc/scripts/audit_impl_record.js` です。

4. `relations.source` は外部出典として扱う。
   HTTP、HTTPS、mail link は許可し、存在しないローカルファイルとして
   報告しません。
5. `relations.references` は補助資料として扱う。
   ローカルパスの場合は存在確認し、外部資料の場合は URL を許可します。
6. 壊れた内部 relation、不正ステータス、必須フロントマター欠落、
   索引欠落を報告する。

## 監査カバレッジ

監査は共有 document repository model 上で実行され、すべての問題を安定した
rule ID で報告する。対象チェック:

- `unparseable-front-matter`, `invalid-front-matter`, `invalid-type`,
  `invalid-status` — フロントマターと文書 contract の違反。
- `invalid-id-format`, `invalid-id-prefix`, `duplicate-id` — artifact
  identity の違反。
- `broken-relation-link`, `ambiguous-relation-target`,
  `relation-escapes-root`, `self-relation`, `inconsistent-reciprocal-relation`
  — 意味 relation の違反。
- `unresolved-legacy-reference` — 本文中の旧 `TYPE-NNNN` artifact id 参照で、
  対応する artifact が存在しないもの。番号付き `.jsonl` log を持たない
  `EXP-NNNN` experiment 参照も含む。既存 artifact や experiment file に
  解決できる token は報告しないため、migration 前のリポジトリは
  クリーンなまま。
- `ambiguous-experiment-reference` — 同一番号の numbered `.jsonl` experiment
  log が複数存在し、一意の canonical path を決められない `EXP-NNNN` 参照。
  `.jsonl` path へ手動で書き換える必要がある。
- `test-spec-missing-verifies`, `test-spec-invalid-verifies-target`,
  `plan-missing-test-spec-evidence`, `missing-required-relation`,
  `invalid-relation-target-type` — contract が要求する upstream / 検証
  evidence の traceability category rule。
- `provenance-missing-source`, `provenance-invalid-source`,
  `provenance-unresolved-local-source` — `relations.source` の provenance。
  ローカル source path はリポジトリ内で解決必須。外部 URL は外部
  evidence として分類し、`--external-links` 指定時のみ疎通確認する。
- `traceability-missing-upstream` — type-aware な upstream の期待。
  contract が upstream artifact を期待する type（`spec`, `plan`, `task`,
  `design`）で `implements` / `derives-from` / `refines` relation の宣言が
  ない場合に warning を出す。root 適格 type と終端 status
  （`superseded`, `rejected`, `archived`, `deprecated`, `abandoned`,
  `wont-do`）は対象外。
- `missing-index`, `index-missing-entry`, `index-missing-overview`,
  `missing-overview` — 索引とディレクトリ構造の欠落。
- `broken-link`, `missing-image-link`, `broken-anchor`, `link-escapes-root`,
  `link-case-mismatch` — ローカル Markdown link と anchor の整合性。
- `index-stale-entry`, `index-duplicate-entry`, `index-metadata-mismatch`,
  `index-ordering`, `index-unparseable`, `index-escapes-root` — 索引テーブルの
  整合性。
- `orphan-index`, `orphan-navigation`, `orphan-relation` — 索引未掲載、
  どの Markdown link からも到達不能、意味 relation を持たない文書。
  severity は type-aware で、root artifact として許可される type は
  `info`、それ以外は `warning` として報告する。
- `external-link-broken`, `external-link-redirect`,
  `external-link-unverifiable` — `audit_docs.js --external-links` による
  opt-in の外部リンク確認。デフォルトでは無効で、監査は決定的かつ
  オフライン安全を維持する。

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
  確認を有効化します。

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
