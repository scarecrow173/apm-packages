# briefing-profile スキーマ

> **⚠️ 非推奨 (DEPRECATED)**
>
> このドキュメントは旧 Markdown ベースのプロファイル形式を記述しています。
> 移行期間中の参照用としてのみ保持されています。
>
> **新しいアプローチ:** `sdp scan --adapter <adapter-yaml>` を実行し、
> 推論された `provides` / `uses` を確認または更新してから `sdp infer`、
> その後 `sdp profile --adapter <adapter-yaml>` を実行して
> `.sdp/<adapter_id>/<flow_profile>.json` を生成してください。
> [移行ガイド](../../skill-discovery-protocol/docs/migration.ja.md)を参照。
>
> 旧形式は将来のバージョンで削除されます。

このドキュメントは、`briefing-flow` によって生成される `briefing-profile.md` ファイルの構造と検証ルールを定義する。

## ファイルの場所

- **パス:** リポジトリルート `briefing-profile.md`
- **生成者:** `briefing-flow` スキル（初回実行時）
- **更新者:** `briefing-flow`（陳腐化を検出した時）

## YAML フロントマター（必須）

```yaml
---
type: briefing-profile
version: "1.0"
generated: "YYYY-MM-DD"
last_validated: "YYYY-MM-DD"
repository: "<repository-name>"
---
```

| フィールド | 型 | 必須 | 説明 |
| ---------- | -- | ---- | ---- |
| type | 文字列 | はい | `briefing-profile` である必要がある |
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
| Category | はい | 定義された Briefing カテゴリの 1 つ |
| Source | はい | スキルが発見された場所 |
| Activation | はい | `always-on`、`conditional`、`excluded` のいずれか |
| Execution | はい | `rigid`、`flexible` のいずれか |
| Condition | いいえ | Activation が `conditional` の場合、トリガーを記述 |

### 2. Category Assignments（カテゴリ割り当て）

スキルをカテゴリでグループ化する。各カテゴリには説明と割り当てられたスキルのリストがある。

**有効なカテゴリ:**

| カテゴリ | 目的 | 例 |
| -------- | ---- | -- |
| Frame | 問題・選択肢を構造化する | idea-refine、brainstorming、interview-me |
| Discover | 情報を探索・発見する | steer-web-research、外部情報収集 |
| Research | 深掘り調査を行う | source-driven-development、ドキュメント検証 |
| Validate | 情報の正確性・完全性を検証する | doubt-driven-development、対抗的分析 |
| Document | 正式な文書を生成する | spec-doc、adr-doc |
| Meta | 他のスキルをオーケストレーションする | briefing-flow、doc-driven-dev-flow |

### 3. Default Stack（デフォルトスタック）

標準的なブリーフィングに適用される基本スキルの組み合わせを定義する。
これは Entry Decision に基づいて補強される「開始点」。

構造:

```markdown
## Default Stack

| Priority | Category | Skill | Rationale |
| -------- | -------- | ----- | --------- |
| 1 | Document | spec-doc | 全ブリーフィングで仕様書を生成 |
| 2 | Document | adr-doc | 全ブリーフィングで ADR を生成 |
```

### 4. Override Rules（オーバーライドルール）

Entry Decision と情報状態に基づくルーティングオーバーライドのセクション。

構造:

```markdown
## Override Rules

| Condition | Action | Reason |
| --------- | ------ | ------ |
| Entry Decision = A-1 | Frame カテゴリ全スキルを活性化 | 問題定義が曖昧 |
| Entry Decision = A-2 | Frame カテゴリ（比較系）を活性化 | トレードオフ整理が必要 |
| Entry Decision = A-5 | Discover + Research を活性化 | 外部調査が必要 |
| 外部 API/ライブラリが関係する | Discover + Research を活性化 | 一次情報の参照が必要 |
| 複数の実現方法が存在する | Frame + Validate を活性化 | 選択肢の構造化と検証が必要 |
| 前例のないアーキテクチャ判断 | Research + Validate を活性化 | 根拠の調査と前提検証が必要 |
```

### 5. Information State Indicators（情報状態指標）

Entry Decision を補助する指標。Phase A の評価で使用する。

構造:

```markdown
## Information State Indicators

| Indicator | Description | Suggests |
| --------- | ----------- | -------- |
| Problem clarity | 問題を 1 文で説明できるか | Low → A-1, High → A-4 |
| Direction clarity | 解決の方向性があるか | Partial → A-2 |
| External dependency | 外部情報が必要か | Yes → A-5 |
| Convergence need | 複数情報源の収束が必要か | Yes → A-3 |
```

## 検証ルール

1. 「Available Skills」内のすべてのスキルは、定義されたセットから有効なカテゴリを持つ必要がある。
2. 「Default Stack」内のすべてのスキルは「Available Skills」に存在する必要がある。
3. `activation` は `always-on`、`conditional`、`excluded` のいずれかである必要がある。
4. `conditional` スキルは空でない `Condition` フィールドを持つ必要がある。
5. 「Document」カテゴリに少なくとも 1 つの `always-on` スキルが必要（spec-doc または adr-doc）。
6. 「Meta」カテゴリは Default Stack に表示されない（メタスキルはオーケストレーションであり実行ではない）。

## 陳腐化検出

プロファイルは以下の場合に陳腐化と見なされる:

1. 「Available Skills」にリストされていない新しいスキルディレクトリが存在する。
2. リストされたスキルのソースディレクトリが存在しなくなった。
3. `last_validated` が 30 日以上前である。
4. 新しい情報収集系スキルがインストールされた。

陳腐化が検出された場合、`briefing-flow` は静かに再生成するのではなく、更新を提案する。
