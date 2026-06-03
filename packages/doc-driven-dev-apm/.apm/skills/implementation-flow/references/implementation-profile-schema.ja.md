# implementation-profile スキーマ

このドキュメントは、`skill-discovery-protocol` によって `implementation-flow`
向けに生成される
`.sdp/implementation-flow-default/implementation-flow-profile.json`
の構造と検証ルールを定義します。

## ファイルの場所

- **パス:** `.sdp/implementation-flow-default/implementation-flow-profile.json`
- **生成者:** adapter path `.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml` を渡して呼び出された `skill-discovery-protocol`
- **更新者:** スキル構成または inference data が変わったときに再度呼び出された `skill-discovery-protocol`

## トップレベルフィールド

```json
{
  "adapter_id": "implementation-flow-default",
  "flow_profile": "implementation-flow-profile.json",
  "generated_at": "YYYY-MM-DDTHH:mm:ss.sssZ",
  "runtime_guidance": {},
  "flow_stack": {
    "slots": []
  },
  "resolved_invocations": []
}
```

| フィールド | 型 | 必須 | 説明 |
| ---------- | -- | ---- | ---- |
| adapter_id | 文字列 | はい | 配布されている implementation adapter では `implementation-flow-default` である必要があります |
| flow_profile | 文字列 | はい | 生成される profile JSON の出力ファイル名 |
| generated_at | 文字列 | はい | プロファイル生成時の ISO タイムスタンプ |
| runtime_guidance | オブジェクト | はい | 実行ポリシーや runtime hint など、問い合わせ対象になるガイダンス |
| flow_stack | オブジェクト | はい | デフォルトの実装スキルスタックを定義する slot 割り当て |
| resolved_invocations | 配列 | はい | 分類と override から解決された最終的な skill routing 決定 |

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
2. `flow_stack.slots` 内のすべてのスキルは「Available Skills」に存在する必要があります。
3. `activation` は `always-on`、`conditional`、`excluded` のいずれかである必要があります。
4. `conditional` スキルは空でない `Condition` フィールドを持つ必要があります。
5. 「Build」カテゴリに少なくとも 1 つの `always-on` スキルが必要です。
6. 「Meta」カテゴリは `flow_stack.slots` に表示されない必要があります（メタスキルはオーケストレーションであり、実行ではありません）。

## 陳腐化検出

プロファイルは以下の場合に陳腐化と見なされます:

1. 「Available Skills」にリストされていない新しいスキルディレクトリが存在する。
2. リストされたスキルのソースディレクトリが存在しなくなった。
3. `last_validated` が 30 日以上前である。
4. リポジトリのテクノロジースタックが明らかに変わった（新しい言語、フレームワークなど）。

陳腐化が検出された場合、`implementation-flow` は静かに再生成するのではなく、更新を提案します。
