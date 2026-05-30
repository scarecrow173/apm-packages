# implementation-profile スキーマ

> **⚠️ 非推奨 (DEPRECATED)**
>
> このドキュメントは旧 Markdown ベースのプロファイル形式を記述しています。
> 移行期間中の参照用としてのみ保持されています。
>
> **新しいアプローチ:** `sdp generate --adapter <adapter-yaml>` を使用して
> JSON ベースのプロファイルを生成してください。[移行ガイド](../../skill-discovery-protocol/docs/migration.ja.md)を参照。
>
> 旧形式は将来のバージョンで削除されます。

このドキュメントは、`implementation-flow` によって生成される `implementation-profile.md` ファイルの構造と検証ルールを定義します。

## ファイルの場所

- **パス:** リポジトリルート `implementation-profile.md`
- **生成者:** `implementation-flow` スキル（初回実行時）
- **更新者:** `implementation-flow`（陳腐化を検出した時）

## YAML フロントマター（必須）

```yaml
---
type: implementation-profile
version: "1.0"
generated: "YYYY-MM-DD"
last_validated: "YYYY-MM-DD"
repository: "<repository-name>"
---
```

| フィールド | 型 | 必須 | 説明 |
| ---------- | -- | ---- | ---- |
| type | 文字列 | はい | `implementation-profile` である必要があります |
| version | 文字列 | はい | スキーマバージョン（semver） |
| generated | 文字列 | はい | プロファイルが最初に生成された ISO 日付 |
| last_validated | 文字列 | はい | プロファイルが利用可能なスキルに対して最後に検証された ISO 日付 |
| repository | 文字列 | はい | 識別用のリポジトリ名 |

## セクション

### 1. Available Skills（利用可能なスキル）

発見されたすべてのスキルをメタデータとともにリストアップするテーブル。

| 列 | 必須 | 説明 |
| -- | ---- | ---- |
| Name | はい | スキル識別子（ディレクトリ/ファイル名と一致） |
| Category | はい | 定義されたカテゴリの 1 つ |
| Source | はい | スキルが発見された場所 |
| Activation | はい | `always-on`、`conditional`、`excluded` のいずれか |
| Execution | はい | `rigid`、`flexible` のいずれか |
| Condition | いいえ | Activation が `conditional` の場合、トリガーを記述 |

### 2. Category Assignments（カテゴリ割り当て）

スキルをカテゴリでグループ化します。各カテゴリには説明と割り当てられたスキルのリストがあります。

**有効なカテゴリ:**

| カテゴリ | 目的 | 例 |
| -------- | ---- | -- |
| Process | タスクへのアプローチを決定 | debugging、planning、task-breakdown |
| Build | 実装を構造化して実行 | incremental-implementation、TDD、frontend-engineering |
| Verify | 正確性と品質を検証 | source-driven-development、doubt-driven-development |
| Review | 実装後の品質ゲート | code-review、security-audit |
| Domain | 言語/フレームワーク/プラットフォーム固有のガイダンス | TypeScript conventions、React patterns、API design |
| Tooling | ツール固有のワークフロー | git、CI/CD、browser-devtools |
| Meta | 他のスキルをオーケストレーションするスキル | implementation-flow、doc-driven-dev-flow |

### 3. Default Stack（デフォルトスタック）

標準的な実装タスクに適用される基本スキルの組み合わせを定義します。これはタスク特性に基づいて補強される「開始点」です。

構造:

```markdown
## Default Stack

| Priority | Category | Skill | Rationale |
| -------- | -------- | ----- | --------- |
| 1 | Process | <skill> | <常に適用される理由> |
| 2 | Build | <skill> | <常に適用される理由> |
| ... | ... | ... | ... |
```

### 4. Override Rules（オーバーライドルール）

リポジトリ固有のルーティングオーバーライドのためのオプションセクション。

構造:

```markdown
## Override Rules

| Condition | Action | Reason |
| --------- | ------ | ------ |
| <これが真の時> | <スキルを追加/削除/置換> | <理由> |
```

## 検証ルール

1. 「Available Skills」内のすべてのスキルは、定義されたセットから有効なカテゴリを持つ必要があります。
2. 「Default Stack」内のすべてのスキルは「Available Skills」に存在する必要があります。
3. `activation` は `always-on`、`conditional`、`excluded` のいずれかである必要があります。
4. `conditional` スキルは空でない `Condition` フィールドを持つ必要があります。
5. 「Build」カテゴリに少なくとも 1 つの `always-on` スキルが必要です。
6. 「Meta」カテゴリは Default Stack に表示されない必要があります（メタスキルはオーケストレーションであり、実行ではありません）。

## 陳腐化検出

プロファイルは以下の場合に陳腐化と見なされます:

1. 「Available Skills」にリストされていない新しいスキルディレクトリが存在する。
2. リストされたスキルのソースディレクトリが存在しなくなった。
3. `last_validated` が 30 日以上前である。
4. リポジトリのテクノロジースタックが明らかに変わった（新しい言語、フレームワークなど）。

陳腐化が検出された場合、`implementation-flow` は静かに再生成するのではなく、更新を提案します。
