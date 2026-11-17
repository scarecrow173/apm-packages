# Knowledge 規約

この規約は Document Registry 3 の下で `knowledge-doc` が `docs/knowledge/` 配下の
永続的なナレッジドキュメントを作成・監査・インデックス化する方法を定義します。

ナレッジドキュメントは理解の永続的な記録です: コードベースの事実、
アーキテクチャメモ、運用runbook、あるいは教訓。正規の Git-Markdown であり、
実行アーティファクトでも派生出力でもありません。

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
| `confirmed` | レビュー済みで正確と認められた。 |
| `archived` | 保守終了。参照用に保持 (確定)。 |
| `superseded` | 新しいナレッジドキュメントに置き換えられた (確定)。 |

## リレーション

- `relations.source` —— 知識の出処 (ドキュメント、URL、会話)。
  Knowledge Relations 語彙ではなく出処情報です。
- `relations.informs` —— この知識が影響する durable ドキュメント。
- `relations.explains` —— この知識が説明する durable ドキュメント。
- `relations.supersedes` —— このドキュメントが置き換えるナレッジドキュメント。

## インデックス

`docs/knowledge/README.md` は生成された派生インデックス
(`<!-- doc-suite:generated-index -->`) です。テーブルを手編集せず、
明示的に実体化します:

```bash
node ../doc-maintenance/scripts/doc_maintenance.js index plan
node ../doc-maintenance/scripts/doc_maintenance.js index apply
```
