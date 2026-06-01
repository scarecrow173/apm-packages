# Flow Profile 仕様

## 概要

Flow Profile（`*-profile.json`）は、特定の flow に紐づく分類結果・解決結果・
実行時ガイダンスを保持する **正規成果物**（canonical artifact）である。

`sdp profile` が生成し、`sdp query` が参照する。

## ファイル形式

- 正規: `.sdp/<adapter_id>/*-profile.json`（例: `.sdp/briefing-flow-default/briefing-profile.json`, `.sdp/implementation-flow-default/implementation-flow-profile.json`）
- 派生: `.sdp/<adapter_id>/*-profile.md`（人間レビュー用）

## JSON Schema（概要）

```json
{
  "schema_version": "1.0",
  "profile_id": "briefing-flow-default",
  "generated_at": "2026-05-28T00:00:00Z",
  "validated_at": "2026-05-28T00:00:00Z",
  "adapter_id": "briefing-flow-default",
  "flow_stack": {
    "slots": [
      {
        "slot_id": "adr_authoring",
        "slot_type": "exclusive",
        "activation": "on_demand",
        "default": {
          "skill": "documentation-and-adrs",
          "reason": "ADR authoring tasks need architecture-focused output"
        }
      }
    ]
  },
  "classification": {
    "categories": [
      {
        "id": "architecture",
        "label": "Architecture",
        "skills": ["documentation-and-adrs"]
      }
    ],
    "unmatched_skills": []
  },
  "resolved_invocations": [
    {
      "source_skill": "implementation-flow",
      "slot": "adr_authoring",
      "capability": "adr_authoring",
      "resolved_skill": "documentation-and-adrs",
      "resolution_method": "slot_override",
      "reason": "ADR authoring tasks require architecture-focused output",
      "fallback": null
    }
  ],
  "runtime_guidance": [
    {
      "skill": "documentation-and-adrs",
      "context": "adr_authoring",
      "guidance": "Use when creating or updating architecture decision records"
    }
  ],
  "warnings": []
}
```

## フィールド定義

### Top-level

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `schema_version` | string | yes | プロファイルスキーマバージョン |
| `profile_id` | string | yes | プロファイル識別子 |
| `generated_at` | ISO 8601 | yes | 生成日時 |
| `validated_at` | ISO 8601 | yes | 最終検証日時 |
| `adapter_id` | string | yes | 使用した adapter の ID |
| `flow_stack` | object | yes | Flow Stack 定義 |
| `classification` | object | yes | 分類結果 |
| `resolved_invocations` | array | yes | 解決済み呼び出し |
| `runtime_guidance` | array | yes | 実行時ガイダンス |
| `warnings` | array | yes | 警告一覧（未使用 slot 等） |

### `flow_stack.slots[]`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `slot_id` | string | yes | `snake_case` スロット識別子 |
| `slot_type` | `"layerable"` \| `"exclusive"` | yes | スロットタイプ |
| `activation` | `"always"` \| `"conditional"` \| `"on_demand"` \| `"gate"` | yes | 起動条件 |
| `default` | object | no | 既定割り当て |
| `default.skill` | string | no | 既定スキル名 |
| `default.reason` | string | no | 既定割り当ての根拠 |

### `classification.categories[]`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | カテゴリ識別子 |
| `label` | string | yes | 表示名 |
| `skills` | string[] | yes | 該当スキル名一覧 |

### `resolved_invocations[]`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `source_skill` | string | yes | 呼び出し元スキル |
| `slot` | string | no | 対象 slot |
| `capability` | string | yes | 対象 capability |
| `resolved_skill` | string | yes | 解決先スキル |
| `resolution_method` | string | yes | 解決方法（slot_override/capability_override/default_skill/provider_lookup） |
| `reason` | string | no | 解決理由 |
| `fallback` | string \| null | no | フォールバック先 |

### `runtime_guidance[]`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `skill` | string | yes | 対象スキル名 |
| `context` | string | yes | 適用コンテキスト |
| `guidance` | string | yes | ガイダンステキスト |

## ソート規則

- `resolved_invocations[]`: `source_skill` → `slot` → `capability` の辞書順
- `classification.categories[]`: `id` の辞書順
- `flow_stack.slots[]`: adapter YAML の宣言順を維持

## Skill Reference Catalog との関係

- Flow Profile は Catalog を参照し、flow 固有の解決結果を追加する
- `resolved_invocations` は adapter の `invocation_resolution` 設定に基づいて生成される
- Catalog 側には `resolved_skill` を持たない（`default_skill` のみ）
