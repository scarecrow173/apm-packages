# Knowledge 規約

この規約は Document Registry 3 の下で `knowledge-doc` が `docs/knowledge/` 配下の
永続的なナレッジドキュメントを作成・監査・インデックス化する方法を定義します。

ナレッジドキュメントは理解の永続的な記録です: コードベースの事実、
アーキテクチャメモ、運用runbook、あるいは教訓。正規の Git-Markdown であり、
実行アーティファクトでも派生出力でもありません。

契約の*抽出*部分 —— 実装の知見がいつナレッジになるか、および assess → 決定 →
apply の統合フロー —— は `references/knowledge-extraction.md` にあります。
このファイルは形式契約です。

## ディレクトリ

正規ディレクトリは `docs/knowledge/` です。旧スイートと異なり、ナレッジは
エイリアスディレクトリを宣言しません —— 単一の正規スペリングがルーティングと
所有権を明確に保ちます。

## ファイル名

`new_knowledge.js` は `--title` から `<slugified-title>.md` を生成するか、
`--name` で明示指定します。ファイル名は小文字ケバブケースです。

## フロントマター

```yaml
---
id: "KNOW-<22-char base62>"
type: "knowledge"
status: "draft"
lifecycle: "draft"
knowledge_kind: "codebase"
title: "…"
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

### 必須フィールド

- `id` —— `KNOW-` プレフィックスと共有の 22 文字 Base62 アーティファクト ID。
- `type` —— 常に `knowledge`。
- `knowledge_kind` —— レコードを分類するトップレベルフィールド:

  | 値 | 意味 |
  | --- | --- |
  | `codebase` | コードが今日どう構成され振る舞うか。 |
  | `architecture` | システムがなぜその形になっているか。 |
  | `operation` | プロセスをどう実行・デプロイ・運用するか。 |
  | `lesson` | 経験から将来の作業が再利用すべき教訓。 |

### ステータスとライフサイクル

`status` は型固有のワークフロー状態、`lifecycle` はレジストリの永続性軸
(`draft` → `current` → `superseded`/`retired`) です。新規ドキュメントは既定で
`lifecycle: "draft"` です。未知のライフサイクル値は無効であり、
`current` へ強制変換されることはありません。

| ステータス | 意味 |
| --- | --- |
| `draft` | 記録済みだが未検証。 |
| `confirmed` | レビュー済みで正確と認められた —— 記録済み出処が必須 (作成時に `--from`; 未検証の推測は確定的なものとして保存しない)。 |
| `archived` | 保守終了。参照用に保持 (確定)。 |
| `superseded` | 新しいナレッジドキュメントに置き換えられた (確定)。 |

## リレーション

- `relations.source` —— 知識の出処 (ドキュメント、URL、会話)。
  Knowledge Relations 語彙ではなく出処情報です。
- `relations.informs` —— この知識が影響する durable ドキュメント。
- `relations.explains` —— この知識が説明する durable ドキュメント。
- `relations.supersedes` —— このドキュメントが置き換えるナレッジドキュメント
  (`new_knowledge.js --supersedes` と `consolidate_knowledge.js` は対象が
  ナレッジドキュメントに解決されることを検証します)。

## 統合 CLI

`scripts/consolidate_knowledge.js` は統合エントリポイントです ——
`knowledge-extraction.md` の決定契約を決定的に強制します:

```bash
# 読み取り専用スクリーニング: 候補、競合、ゲート。
node scripts/consolidate_knowledge.js assess --title "…" [--kind codebase] [--keyword …]

# 明示的な決定 —— ちょうど1つ:
node scripts/consolidate_knowledge.js apply --decision none
node scripts/consolidate_knowledge.js apply --decision route --to spec|design|adr|verification|discovery|idea|brainstorm
node scripts/consolidate_knowledge.js apply --decision integrate --into <knowledge-doc> --from <src>… --basis <evidence> [--status …] [--informs <doc>]… [--explains <doc>]…
node scripts/consolidate_knowledge.js apply --decision create --title "…" --kind <kind> --from <src>… --basis <evidence> [--acknowledge <id|path>]…
```

- `assess` は書き込みません; `route` と `none` も書き込みません。
- `integrate` はナレッジドキュメントのみ変更します —— spec/design/ADR 対象は
  拒否され、所有スキルに振られます。
- `create` は `assess` が未承認の競合を報告する間は拒否します; 各競合は
  レビュー後に `--acknowledge` で渡す必要があります。
- `--from` と `--basis` は `integrate` と `create` で必須です: 抽出の
  原典と根拠は常に記録されます。

## インデックス

`docs/knowledge/README.md` は生成された派生インデックス
(`<!-- doc-suite:generated-index -->`) です。テーブルを手編集せず、
明示的に実体化します:

```bash
node ../doc-maintenance/scripts/doc_maintenance.js index plan
node ../doc-maintenance/scripts/doc_maintenance.js index apply
```
