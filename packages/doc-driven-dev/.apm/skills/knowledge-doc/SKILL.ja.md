---
name: knowledge-doc
description: コードベースの知識、アーキテクチャメモ、運用runbook、教訓などの永続的な知識を docs/knowledge/ に統合する場合に使用する。新規作成より既存ドキュメントの検索・更新・統合を優先する。
license: MIT
---

# Knowledge Documentation Skill

このスキルは `docs/knowledge/` 配下で永続的なナレッジを統合します。
ナレッジドキュメントは、単一の変更を超えて有効であり続ける情報 ——
サブシステムの仕組み、アーキテクチャの背景、運用手順、将来の作業に活きる教訓 ——
を記録します。

ナレッジドキュメントは Document Registry 3 で **durable** です ——
Git 上の正規レコードとして存在し、型固有の `status` とは別の
ライフサイクル (`draft`, `current`, `superseded`, `retired`) を持ちます。

**役割の境界:**

- `idea-doc` は未整理の生のシグナルを捕捉します —— まだナレッジではありません。
- `discovery-doc` は出処エビデンス付きの限定された探索を構造化します。
- `knowledge-doc` は確立した理解を統合します —— **新規作成より既存ドキュメントへの
  統合を優先**し、`none` 決定 (保存する価値なし) は有効な結果です。
- `briefing-flow` は情報収集を統率し、`knowledge-doc` は永続的な結果を保存します。

## ワークフロー

実装の知見では**必須**: `references/knowledge-extraction.md` を読み込んで
ください —— 何が永続的なナレッジになるか (設計根拠、再発防止、確定した制約と
性質 —— 時系列、コマンドログ、チャット的記録は含まない) と完全な決定契約を
定義しています。

1. 保存する価値があるかを決めます。
   通常の実装修正は新規ドキュメント**なし**で完了します —— IR/EXP/ナレッジの
   作成は強制されません。重要な知見が未整理のまま残る場合は、静かに完了せず
   ランの終了ゲートに報告します。
2. 作成前に assess します。
   `consolidate_knowledge.js assess --title "…" --kind <kind>` がすべての
   durable ディレクトリを走査し、候補 (ナレッジには `integrate`、
   spec/design/ADR には所有スキルのルート)、競合、ゲートを報告します。
3. `consolidate_knowledge.js apply --decision <d>` でちょうど1つの決定を
   適用します (完全なフラグ契約は規約リファレンス):
   - `integrate` —— 既存ナレッジドキュメントへ統合 (`--into` 必須); 既存
     レコードが担えるなら常に優先します。
   - `route` —— 知見が spec/design/ADR などに属する場合: 統合は何も
     書き込みません; その型の所有スキル経由で適用します。
   - `create` —— どの既存ドキュメントも担えない場合のみ; 報告された
     すべての競合を `--acknowledge` で承認するまで拒否します —— レビューは
     必須であり、重複を無条件に追加しません。
   - `none` —— 何も保存しません。
   すべての永続化経路は `--from` (抽出元) と `--basis` (根拠) を必須とし、
   両方が記録されます。
4. 直接の随時作成 (ユーザー要求で、抽出ではない) は
   `new_knowledge.js --title "…" --kind <kind>` を使います; `--kind` は必須で、
   `--status confirmed` は `--from` の出処を要求します。
5. ステータスを最新に保ちます。
   `draft` は未検証、`confirmed` はレビュー済み (記録済み出処が必須)、
   `archived` は参照用に保持、`superseded` は置き換え済み (後継で
   `--supersedes`) を示します。

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
- 実行時の状態をナレッジドキュメントに記録しない —— プラン、タスク、実行結果、
  コマンドログ、チャット的作業記録は durable レジストリではなく
  [Execution Store](../doc-driven-dev-graph/references/execution-store-contract.ja.md)
  / [run trace](../doc-driven-dev-graph/references/run-trace-contract.ja.md)
  に属します
- `assess` が未承認の競合を報告する間は作成しない —— 各重複/矛盾候補を
  レビューして `--acknowledge` を渡します
- このスキル経由で spec、design、ADR に書き込まない —— 統合はそれらの変更を
  所有スキルに振ります
- 未検証の推測を `confirmed` として保存しない —— 記録済みの出処
  (`--from`/`--basis`) が必須です
- `docs/knowledge/README.md` を正規データとして扱わない —— インデックスは
  `doc_maintenance.js index plan|apply` で再生成される派生ビューです

## リソース

- `scripts/consolidate_knowledge.js`: 統合エントリポイント —— `assess`
  (読み取り専用スクリーニング) と `apply --decision none|route|integrate|create`。
- `scripts/new_knowledge.js`: ナレッジドキュメントを直接作成します (インデックスの
  実体化は明示的です: `doc_maintenance.js index plan|apply`)。
- `references/knowledge-extraction.md`: 抽出と統合決定の契約 —— **実装の知見を
  永続化する際は必ず読み込むこと**
- `references/knowledge-conventions.md`: ディレクトリ、ファイル名、ステータス、
  リレーション、CLI、必須フィールドの規約 —— **作成/統合操作の前に必ず
  読み込むこと**
- `assets/templates/knowledge.md`: 既定のナレッジドキュメント本文テンプレート
  —— `new_knowledge.js` が自動で読み込むため**手動で読み込まないこと**
