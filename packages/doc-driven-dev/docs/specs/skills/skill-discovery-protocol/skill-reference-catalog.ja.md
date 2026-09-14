# Skill Reference Catalog 仕様

## 概要

Skill Reference Catalog は、scan で発見されたスキルにエージェント推論成果物を結合し、各スキルが提供・利用する capability と実行ポリシーを一覧化する **flow 非依存** の正規成果物である。

Catalog は `SKILL.md` に独自メタデータがあることを前提にしない。`provides` / `uses` / `execution_policy` / `tags` は、scan で保存された `SKILL.md` 全文をエージェントが読み、`skill-reference-inferences.json` として補完した値を使う。Catalog 化の前提として、各 inference entry は `review_status = "reviewed"` でなければならない。

## 入力成果物

| Artifact | Role |
| --- | --- |
| `skill-scan-list.json` | scan で見つかった各 `SKILL.md` の全文と所在 |
| `skill-reference-inferences.json` | エージェント推論で補完された reviewed inference 情報 |

## ファイル形式

- 正規: `skill-reference-catalog.json`
- 派生: `skill-reference-catalog.md`（人間レビュー用）

## JSON 例

```json
{
  "schema_version": "1.0",
  "generated_at": "2026-05-28T00:00:00Z",
  "validated_at": "2026-05-28T00:00:00Z",
  "skill_count": 1,
  "capability_count": 2,
  "skills": [
    {
      "name": "documentation-and-adrs",
      "description": "Document architecture decisions",
      "provides": [
        { "capability": "adr_authoring", "description": "Creates ADRs" }
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
      "runtime_guidance": [
        {
          "skill": "documentation-and-adrs",
          "context": "adr_authoring",
          "guidance": "Use when creating or updating architecture decision records",
          "priority_delta": 20,
          "prefer_when": ["adr_authoring", "design_decision"],
          "avoid_when": ["pure_copy_edit"]
        }
      ],
      "tags": ["architecture", "documentation"]
    }
  ]
}
```

## Top-level fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `schema_version` | string | yes | catalog schema version |
| `generated_at` | ISO 8601 | yes | 生成日時 |
| `validated_at` | ISO 8601 | yes | 最終検証日時 |
| `skill_count` | number | yes | スキル総数 |
| `capability_count` | number | yes | capability 総数 |
| `skills` | array | yes | スキル一覧 |

## `skills[]`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | スキル名 |
| `description` | string | yes | scan で得た標準 description |
| `provides` | array | yes | 推論された提供 capability |
| `uses` | array | yes | 推論された利用 capability |
| `execution_policy` | object | yes | 推論された実行ポリシー |
| `tags` | string[] | no | 推論された分類補助タグ |

## `skills[].provides[]`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `capability` | string | yes | `snake_case` capability 識別子 |
| `description` | string | no | 提供内容の説明 |

## `skills[].uses[]`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `capability` | string | yes | `snake_case` capability 識別子 |
| `required` | boolean | yes | 必須依存かどうか |
| `default_skill` | string | no | capability 依存の既定候補 |
| `override_allowed` | boolean | yes | flow からの override を許可するか |

## `skills[].execution_policy`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `strictness` | `"rigid"` \| `"flexible"` | yes | 実行の厳格度 |
| `sequence_required` | boolean | yes | 手順順序が必須か |
| `allow_step_reordering` | boolean | yes | 手順の並び替えを許可するか |
| `allow_partial_application` | boolean | yes | 部分適用を許可するか |
| `guidance` | string | no | 実行時ガイダンス |

## 制約

- すべての capability 識別子は `snake_case` 固定
- `skills[]` は `name` の辞書順で安定ソートする
- `provides[]` / `uses[]` は `capability` の辞書順で安定ソートする
- `skill-reference-inferences.json` に scan されていない skill がある場合は stale inference として失敗する
- scan された skill に対応する inference がない場合は missing inference として失敗する
- scan された skill に `review_status != reviewed` の inference がある場合は incomplete inference として失敗する

## Flow Profile との関係

- Catalog は flow 非依存の情報のみ保持する
- Catalog は `slots` / `slot_count` / `resolved_invocations` / flow 固有 classification を持たない
- invocation slot は Flow Profile の `flow_stack.slots[]` が保持する
- `skills[].uses[].default_skill` は capability 依存の既定候補であり、flow 固有の `resolved_skill` ではない
