# Skill Reference Catalog 仕様

## 概要

Skill Reference Catalog は、プロジェクト内のスキルが提供・利用する capability と
実行ポリシーを一覧化する **flow 非依存**の成果物である。

## ファイル形式

- 正規: `skill-reference-catalog.json`
- 派生: `skill-reference-catalog.md`（人間レビュー用）

## JSON Schema（概要）

```json
{
  "schema_version": "1.0",
  "generated_at": "2026-05-28T00:00:00Z",
  "validated_at": "2026-05-28T00:00:00Z",
  "skill_count": 10,
  "capability_count": 15,
  "skills": [
    {
      "name": "documentation-and-adrs",
      "description": "...",
      "provides": [
        { "capability": "adr_authoring", "description": "..." }
      ],
      "uses": [
        {
          "capability": "code_review",
          "required": false,
          "default_skill": "code-review-and-quality",
          "override_allowed": true
        }
      ],
      "execution_policy": {
        "strictness": "flexible",
        "sequence_required": false,
        "allow_step_reordering": true,
        "allow_partial_application": true,
        "guidance": "Steps can be applied in any order based on context"
      },
      "tags": ["architecture", "documentation"]
    }
  ]
}
```

## フィールド定義

### Top-level

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `schema_version` | string | yes | カタログスキーマバージョン |
| `generated_at` | ISO 8601 | yes | 生成日時 |
| `validated_at` | ISO 8601 | yes | 最終検証日時 |
| `skill_count` | number | yes | スキル総数 |
| `capability_count` | number | yes | capability 総数 |
| `skills` | array | yes | スキル一覧 |

### `skills[]`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | スキル名 |
| `description` | string | yes | スキル概要 |
| `provides` | array | yes | 提供する capability |
| `uses` | array | yes | 利用する capability |
| `execution_policy` | object | yes | 実行ポリシー |
| `tags` | string[] | no | 分類用タグ |

### `skills[].provides[]`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `capability` | string | yes | `snake_case` capability 識別子 |
| `description` | string | no | 提供内容の説明 |

### `skills[].uses[]`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `capability` | string | yes | `snake_case` capability 識別子 |
| `required` | boolean | yes | 必須かどうか |
| `default_skill` | string | no | 既定解決先スキル（flow 固有の resolved_skill は持たない） |
| `override_allowed` | boolean | yes | 親 flow からの override を許可するか。`false` の場合 `override_not_allowed` gate の検証対象になる |

### `skills[].execution_policy`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `strictness` | `"rigid"` \| `"flexible"` | yes | 実行の厳格度 |
| `sequence_required` | boolean | yes | ステップ順序が必須か |
| `allow_step_reordering` | boolean | yes | ステップの並び替えを許可するか |
| `allow_partial_application` | boolean | yes | 部分適用を許可するか |
| `guidance` | string | no | 実行時のガイダンステキスト |

## 命名規約

- すべての capability 識別子は `snake_case` 固定
- `kebab-case` や `camelCase` は schema error

## ソート規則

- `skills[]` は `name` の辞書順で安定ソート
- `provides[]` / `uses[]` は `capability` の辞書順
- 再実行で順序差分が出ないことを保証

## Flow Profile との関係

- Catalog は **flow 非依存**の情報のみ保持する
- invocation slot は Catalog ではなく Flow Profile の `flow_stack.slots[]` が保持する
- `skills[].uses[].default_skill` は capability 依存の既定候補であり、flow 固有の `resolved_skill` は持たない
- Flow Profile が `flow_stack.slots[]` と `resolved_invocations` で flow 固有のslot宣言・解決結果を保持する
