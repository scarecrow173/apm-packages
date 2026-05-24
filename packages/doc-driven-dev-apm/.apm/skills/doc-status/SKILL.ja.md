---
name: doc-status
description: document-driven development の成果物、ステータス、索引、意味付き relation を一覧・監査するときに使います。
license: MIT
---

# Document Status Skill

この skill は、spec、plan、task のライフサイクル状態と relation の健全性を
確認するために使います。標準では報告専用であり、作成系または索引更新系の
コマンドを使わない限りプロジェクトファイルを変更しません。

## ワークフロー

1. 種別またはステータスで文書を一覧する。

   ```bash
   node scripts/list_docs.js --type spec
   node scripts/list_docs.js --type task --status in-progress
   ```

2. フロントマターと relation を監査する。

   ```bash
   node scripts/audit_docs.js --type spec
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
