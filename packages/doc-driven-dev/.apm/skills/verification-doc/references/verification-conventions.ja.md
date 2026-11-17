# Verification Design 規約

この規約は Document Registry 3 の下で `verification-doc` が `docs/verification/`
配下の永続的な検証設計ドキュメントを作成・監査・インデックス化する方法を定義します。

検証設計ドキュメントは検証の*意図*を記録します: 何を検証するか、どの契約や
クレームを守るのか、なぜその検証が存在するのか。Registry 3 で
マイグレーション専用となった旧 `test-spec` 形式を置き換えます。

## ディレクトリ

正規ディレクトリは `docs/verification/` です。エイリアスディレクトリは宣言
されません —— 単一の正規スペリングがルーティングと所有権を明確に保ちます。

## ファイル名

`new_verification.js` は `--title` から `<slugified-title>.md` を生成するか、
`--name` で明示指定します。ファイル名は小文字ケバブケースです。

## フロントマター

```yaml
---
id: "VD-<22-char base62>"
type: "verification"
status: "draft"
lifecycle: "draft"
title: "…"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
owners: []
relations:
  source: []
  supersedes: []
---
```

### 必須フィールド

- `id` —— `VD-` プレフィックスと共有の 22 文字 Base62 アーティファクト ID。
- `type` —— 常に `verification`。

### ステータスとライフサイクル

`status` は型固有のワークフロー状態、`lifecycle` はレジストリの永続性軸
(`draft` → `current` → `superseded`/`retired`) です。新規ドキュメントは既定で
`lifecycle: "draft"` です。未知のライフサイクル値は無効であり、
`current` へ強制変換されることはありません。

| ステータス | 意味 |
| --- | --- |
| `draft` | 検証意図を記録中。 |
| `proposed` | 設計記述済み。レビュー待ち。 |
| `approved` | レビュー済みで検証契約として受理された。 |
| `deprecated` | 検証が不要になった (確定)。 |
| `superseded` | 新しい検証設計に置き換えられた (確定)。 |

## リレーション

- `relations.source` —— この検証設計の動機となったドキュメント、issue、
  エビデンス。
- `relations.supersedes` —— このドキュメントが置き換える検証設計ドキュメント。

Check→Claim リレーション (`checks[].target`) は後続作業で定義される Check 契約から
導出され、Evidence の `supported-by` リンクは Evidence Store から来ます ——
どちらもここで保持されるリレーションフィールドではありません。

## インデックス

`docs/verification/README.md` は生成された派生インデックス
(`<!-- doc-suite:generated-index -->`) です。テーブルを手編集せず、
明示的に実体化します:

```bash
node ../doc-maintenance/scripts/doc_maintenance.js index plan
node ../doc-maintenance/scripts/doc_maintenance.js index apply
```
