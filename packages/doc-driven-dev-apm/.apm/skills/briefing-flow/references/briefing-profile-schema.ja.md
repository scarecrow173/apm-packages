# briefing-profile スキーマ

このドキュメントは、`skill-discovery-protocol` によって `briefing-flow`
向けに生成される `.sdp/briefing-flow-default/briefing-profile.json`
の構造と検証ルールを定義する。

## ファイルの場所

- **パス:** `.sdp/briefing-flow-default/briefing-profile.json`
- **生成者:** adapter path `.apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml` を渡して呼び出された `skill-discovery-protocol`
- **更新者:** スキル構成または inference data が変わったときに再度呼び出された `skill-discovery-protocol`

## トップレベルフィールド

```json
{
  "adapter_id": "briefing-flow-default",
  "flow_profile": "briefing-profile.json",
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
| adapter_id | 文字列 | はい | 配布されている briefing adapter では `briefing-flow-default` である必要がある |
| flow_profile | 文字列 | はい | 生成される profile JSON の出力ファイル名 |
| generated_at | 文字列 | はい | プロファイル生成時の ISO タイムスタンプ |
| runtime_guidance | オブジェクト | はい | Entry Decision 依存の実行ヒントなど、問い合わせ対象になるガイダンス |
| flow_stack | オブジェクト | はい | デフォルトの briefing スキルスタックを定義する slot 割り当て |
| resolved_invocations | 配列 | はい | 分類と override から解決された最終的な skill routing 決定 |

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
2. `flow_stack.slots` 内のすべてのスキルは「Available Skills」に存在する必要がある。
3. `activation` は `always-on`、`conditional`、`excluded` のいずれかである必要がある。
4. `conditional` スキルは空でない `Condition` フィールドを持つ必要がある。
5. 「Document」カテゴリに少なくとも 1 つの `always-on` スキルが必要（spec-doc または adr-doc）。
6. 「Meta」カテゴリは `flow_stack.slots` に表示されない（メタスキルはオーケストレーションであり実行ではない）。

## 陳腐化検出

プロファイルは以下の場合に陳腐化と見なされる:

1. 「Available Skills」にリストされていない新しいスキルディレクトリが存在する。
2. リストされたスキルのソースディレクトリが存在しなくなった。
3. `last_validated` が 30 日以上前である。
4. 新しい情報収集系スキルがインストールされた。

陳腐化が検出された場合、`briefing-flow` は静かに再生成するのではなく、更新を提案する。
