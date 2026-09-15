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

1. 種別またはステータスで文書を一覧する。

   ```bash
   node scripts/list_docs.js --type spec
   node scripts/list_docs.js --type design
   node scripts/list_docs.js --type task --status in-progress
   ```

2. フロントマターと relation を監査する。

   ```bash
   node scripts/audit_docs.js --type spec
   node scripts/audit_docs.js --type design
   node scripts/audit_docs.js --type plan --json
   ```

   `doc-driven-dev-graph` の named audit は次のコマンドに対応します:
   文書型（`spec`, `adr`, `design`, `plan`, `task`, `test-spec`, `idea`,
   `brainstorm`, `discovery`）は `audit_docs.js --type <name>`、
   `all` は全 canonical 文書型を対象とする `audit_docs.js --type all`、
   `impl-record` は `impl-doc/scripts/audit_impl_record.js` です。

3. `relations.source` は外部出典として扱う。
   HTTP、HTTPS、mail link は許可し、存在しないローカルファイルとして
   報告しません。
4. `relations.references` は補助資料として扱う。
   ローカルパスの場合は存在確認し、外部資料の場合は URL を許可します。
5. 壊れた内部 relation、不正ステータス、必須フロントマター欠落、
   索引欠落を報告する。

## リソース

- `scripts/list_docs.js`: 種別とステータスで文書メタデータを一覧します。
- `scripts/audit_docs.js`: フロントマター、ステータス、relation、索引を
  検証します。

## Graph Effect Outcome

`doc-driven-dev-graph` からこの skill が呼び出された場合、audit または delegate effect
ごとに正確な [`EffectOutcome footer`](../doc-driven-dev-graph/references/execution-outcome-contract.ja.md)
を返します。local partial variant を作成しません。

Completable result には `completed`、declared repair evidence を伴う Returned には
`retry`、safe repair のない Returned には `unrecoverable-blocker` を理由とする `yield`
を使います。必須の `edgeId`、stage、effect identity、authoritative input scope、proof
field はその footer が定義します。
