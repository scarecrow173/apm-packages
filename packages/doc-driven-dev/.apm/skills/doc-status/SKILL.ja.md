---
name: doc-status
description: document-driven development の成果物、ステータス、索引、意味付き relation を一覧・監査するときに使います。
license: MIT
---

# Document Status Skill

この skill は、spec、design、plan、task のライフサイクル状態と relation の健全性を
確認するために使います。標準では報告・判定専用であり、作成系または索引更新系の
コマンドを使わない限りプロジェクトファイルを変更しません。

## 監査の役割

この skill は文書駆動開発の整合性ゲートキーパーとして機能する。
監査結果は次の判定に使われる:

- **Completable**: ブロッキング指摘なし → 文書セット全体が整合・追跡可能。
- **Returned**: ブロッキング指摘あり → 該当文書の修正が必要。

ブロッキング指摘の例:

- 必須フロントマターフィールドの欠落（id, type, status, relations）
- 壊れた内部 relation（参照先ファイルが存在しない）
- 索引に未登録の文書
- ステータス遷移の矛盾（例: plan が `approved` だが参照 design が `draft`）

## Output Contract

監査結果は次の構造で返す:

- `Verdict`: `Completable` または `Returned`
- `Blocking findings`: 進行を止める問題
- `Warnings`: ブロッキングではないが修正したい問題
- `Relation errors`: 壊れた内部リンクまたは不整合な relation
- `Index gaps`: 足りない registry / index coverage
- `Next actions`: ゲート通過に必要な最小フォローアップ

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
