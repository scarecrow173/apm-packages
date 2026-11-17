---
name: verification-doc
description: 検証意図 —— 何を、どの契約に対して、なぜ検証するか —— を docs/verification/ の永続的な検証設計ドキュメントとして記録する場合に使用する。従来の test-spec 形式を置き換える。
license: MIT
---

# Verification Design Documentation Skill

このスキルは `docs/verification/` 配下に永続的な検証設計ドキュメントを作成します。
検証設計ドキュメントは検証の*意図*を記録します: 何を検証するか、どの契約や
クレームを守るのか、なぜその検証が存在するのか。

検証設計ドキュメントは Document Registry 3 で **durable** です ——
マイグレーション専用アーティファクトとなった旧 `test-spec` 形式を置き換えます。
実行可能なコマンドは引き続きタスクの `## Verification` セクションに、
実行結果は Evidence Store に属します。

**スコープ注意:** Check 契約 —— クレーム ID を対象とする `checks[]` エントリ ——
は後続の作業 (Knowledge Relations / Evidence issue) で定義されます。このスキルは
永続的なコンテナドキュメントを作成するものであり、ここで check 構文を発明しないで
ください。

## ワークフロー

1. 先に `docs/verification/` と `docs/specs/` を確認します。
   既存の検証設計を複製せず、実際に置き換える場合は
   `relations.supersedes` で置き換えます。
2. 検証設計ドキュメントを作成します。

   **必須**: この手順の前に `references/verification-conventions.md` を読み込んで
   ください —— 必須フロントマターフィールド、ファイル名規約、有効なステータス値を
   定義しています。

   推奨の作成コマンド:

   ```bash
   node scripts/new_verification.js --title "Checkout total calculation" \
     --from docs/specs/checkout-flow.md
   ```

   `--from` と `--supersedes` は繰り返し指定できます。

   スクリプトを実行できない場合は `assets/templates/verification.md` をコピーして
   手動で記入します。
3. ステータスを最新に保ちます。
   `draft` は意図の記録中、`proposed` は記述済み、`approved` はレビュー済み、
   `deprecated` は検証が不要になった、`superseded` は新しい設計に置き換えられた
   ことを示します。

## フロントマター

```yaml
---
id: "VD-<22-char base62>"
type: "verification"
status: "draft"
lifecycle: "draft"
title: "Checkout total calculation"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
owners: []
relations:
  source: []
  supersedes: []
---
```

ステータス値: `draft`、`proposed`、`approved`、`deprecated`、`superseded`。
`deprecated` と `superseded` は確定状態で、インデックスの `## Settled` 層に
振り分けられます。

## 禁止事項

- `test-spec` ドキュメントを作成しない —— Registry 3 では `test-spec` は
  レガシーのマイグレーション専用型であり、`new_test_spec.js` はレジストリ境界で
  拒否します
- 合否の結果をこのドキュメントに記録しない —— 実行結果は揮発性のエビデンスであり、
  永続的な検証意図ではありません
- `docs/verification/README.md` を正規データとして扱わない —— インデックスは
  `doc_maintenance.js index plan|apply` で実体化される派生ビューです

## リソース

- `scripts/new_verification.js`: 検証設計ドキュメントを作成します
  (インデックスの実体化は明示的です: `doc_maintenance.js index plan|apply`)。
- `references/verification-conventions.md`: ディレクトリ、ファイル名、ステータス、
  リレーションの規約 —— **作成操作の前に必ず読み込むこと**
- `assets/templates/verification.md`: 既定の検証設計本文テンプレート ——
  `new_verification.js` が自動で読み込むため**手動で読み込まないこと**
