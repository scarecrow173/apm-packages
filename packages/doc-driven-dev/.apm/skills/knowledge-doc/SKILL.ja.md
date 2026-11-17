---
name: knowledge-doc
description: コードベースの知識、アーキテクチャメモ、運用runbook、教訓などの永続的な知識を docs/knowledge/ の正規ドキュメントとして記録し、informs/explains リレーションで他ドキュメントから引用できるようにする場合に使用する。
license: MIT
---

# Knowledge Documentation Skill

このスキルは `docs/knowledge/` 配下に永続的なナレッジドキュメントを作成します。
ナレッジドキュメントは、単一の変更を超えて有効であり続ける情報 ——
サブシステムの仕組み、アーキテクチャの背景、運用手順、将来の作業に活きる教訓 ——
を記録します。

ナレッジドキュメントは Document Registry 3 で **durable** です ——
Git 上の正規レコードとして存在し、型固有の `status` とは別の
ライフサイクル (`draft`, `current`, `superseded`, `retired`) を持ちます。

**役割の境界:**

- `idea-doc` は未整理の生のシグナルを捕捉します —— まだナレッジではありません。
- `discovery-doc` は出処エビデンス付きの限定された探索を構造化します。
- `knowledge-doc` は後から引用される確立した理解を記録します。
- `briefing-flow` は情報収集を統率し、`knowledge-doc` は永続的な結果を保存します。

## ワークフロー

1. 先に `docs/knowledge/` を確認します。
   新しい事実が既存レコードを更新する内容なら、准重複を作らず既存ドキュメントを
   更新するか `relations.supersedes` で置き換えます。
2. ナレッジの種別を選びます。
   すべてのナレッジドキュメントはトップレベルの `knowledge_kind` フィールドを
   宣言します: `codebase`、`architecture`、`operation`、`lesson` のいずれか。
3. ナレッジドキュメントを作成します。

   **必須**: この手順の前に `references/knowledge-conventions.md` を読み込んで
   ください —— 必須フロントマターフィールド、ファイル名規約、有効なステータス値を
   定義しています。

   推奨の作成コマンド:

   ```bash
   node scripts/new_knowledge.js --title "How the build cache works" \
     --kind codebase --informs docs/designs/0001-cache.md
   ```

   `--kind` は必須です。`--from`、`--informs`、`--explains` は繰り返し指定できます。

   スクリプトを実行できない場合は `assets/templates/knowledge.md` をコピーして
   手動で記入します。
4. リレーションを記録します。
   `relations.source` に知識の出処、`relations.informs` にこの知識が影響する
   ドキュメント、`relations.explains` にこの知識が説明するドキュメントを記録します。
5. ステータスを最新に保ちます。
   `draft` は未検証、`confirmed` はレビュー済み、`archived` は参照用に保持、
   `superseded` は置き換え済みを示します。

## フロントマター

```yaml
---
id: "KNOW-<22-char base62>"
type: "knowledge"
status: "draft"
lifecycle: "draft"
knowledge_kind: "codebase"
title: "How the build cache works"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
owners: []
relations:
  source: []
  informs: []
  explains: []
  supersedes: []
---
```

ステータス値: `draft`、`confirmed`、`archived`、`superseded`。
`archived` と `superseded` は確定状態で、インデックスの `## Settled` 層に
振り分けられます。

## 禁止事項

- `knowledge_kind` を省略しない —— 必須のトップレベルフィールドであり、
  欠落したドキュメントは lint で却下されます
- 実行時の状態をナレッジドキュメントに記録しない —— プラン、タスク、実行結果は
  durable レジストリではなく Execution Store に属します
- `docs/knowledge/README.md` を正規データとして扱わない —— インデックスは
  `doc_maintenance.js index plan|apply` で再生成される派生ビューです

## リソース

- `scripts/new_knowledge.js`: ナレッジドキュメントを作成します (インデックスの
  実体化は明示的です: `doc_maintenance.js index plan|apply`)。
- `references/knowledge-conventions.md`: ディレクトリ、ファイル名、ステータス、
  リレーション、必須フィールドの規約 —— **作成操作の前に必ず読み込むこと**
- `assets/templates/knowledge.md`: 既定のナレッジドキュメント本文テンプレート
  —— `new_knowledge.js` が自動で読み込むため**手動で読み込まないこと**
