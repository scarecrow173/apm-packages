# Validation Report 仕様

## 概要

Validation Report は `sdp validate` の出力として、成果物の品質状態を記録する。
3 層ゲート + blocking validations の結果を構造化して保持する。

## ファイル形式

- 正規: `validation-report.json`
- 派生: `validation-report.md`（人間レビュー用）

## JSON Schema（概要）

```json
{
  "schema_version": "1.0",
  "generated_at": "2026-05-28T00:00:00Z",
  "repository": "doc-driven-dev",
  "adapter_id": "briefing-flow-default",
  "schema_validation": {
    "result": "pass",
    "errors": []
  },
  "staleness_validation": {
    "result": "pass",
    "basis": "validated_at",
    "basis_date": "2026-05-28T00:00:00Z",
    "max_age_days": 30,
    "age_days": 0,
    "new_skills": [],
    "removed_skills": []
  },
  "deterministic_validation": {
    "result": "pass",
    "comparisons": [
      {
        "target": "profile",
        "diff_found": false
      },
      {
        "target": "profile+catalog-artifacts",
        "diff_found": false
      },
      {
        "target": "validation-report:exclude-timestamp",
        "diff_found": false
      }
    ]
  },
  "blocking_validations": {
    "result": "pass",
    "checks": [
      {
        "type": "unresolved_required",
        "result": "pass",
        "details": []
      },
      {
        "type": "unknown_skill_override",
        "result": "pass",
        "details": []
      },
      {
        "type": "capability_mismatch_override",
        "result": "pass",
        "details": []
      }
    ]
  },
  "catalog_validation": {
    "skill_count": 10,
    "reference_count": 25,
    "capability_count": 15,
    "orphan_skills": []
  },
  "profile_validation": {
    "flow_count": 1,
    "flow_stack_slot_count": 5,
    "unresolved_slots": [],
    "resolved_invocation_count": 8,
    "unused_override_warnings": []
  },
  "overall_result": "pass"
}
```

## フィールド定義

### Top-level

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `schema_version` | string | yes | レポートスキーマバージョン |
| `generated_at` | ISO 8601 | yes | レポート生成日時 |
| `repository` | string | yes | 対象リポジトリ名 |
| `adapter_id` | string | yes | 使用した adapter ID |
| `schema_validation` | object | yes | Schema gate 結果 |
| `staleness_validation` | object | yes | Staleness gate 結果 |
| `deterministic_validation` | object | yes | Deterministic gate 結果 |
| `blocking_validations` | object | yes | Blocking validation 結果 |
| `catalog_validation` | object | yes | Catalog 整合性検証結果 |
| `profile_validation` | object | yes | Profile 検証結果 |
| `overall_result` | `"pass"` \| `"fail"` | yes | 総合結果 |

### `overall_result` 算出式

```
overall_result = schema_validation.result == "pass"
             && staleness_validation.result == "pass"
             && deterministic_validation.result == "pass"
             && blocking_validations.result == "pass"
```

### `schema_validation`

| Field | Type | Description |
| --- | --- | --- |
| `result` | `"pass"` \| `"fail"` | 検証結果 |
| `errors` | array | 失敗項目一覧（キー名、期待型、実際値など） |

### `staleness_validation`

| Field | Type | Description |
| --- | --- | --- |
| `result` | `"pass"` \| `"fail"` | 検証結果 |
| `basis` | string | 基準フィールド名 |
| `basis_date` | ISO 8601 | 基準日時 |
| `max_age_days` | number | 許容日数 |
| `age_days` | number | 経過日数 |
| `new_skills` | string[] | 前回以降に追加されたスキル |
| `removed_skills` | string[] | 前回以降に削除されたスキル |

### `deterministic_validation`

| Field | Type | Description |
| --- | --- | --- |
| `result` | `"pass"` \| `"fail"` | 検証結果 |
| `comparisons` | array | 比較対象ごとの結果 |
| `comparisons[].target` | string | 比較対象識別子 |
| `comparisons[].diff_found` | boolean | 差分があったか |

### `blocking_validations`

| Field | Type | Description |
| --- | --- | --- |
| `result` | `"pass"` \| `"fail"` | 検証結果 |
| `checks` | array | 個別チェック結果 |
| `checks[].type` | string | チェック種別 |
| `checks[].result` | `"pass"` \| `"fail"` | 個別結果 |
| `checks[].details` | array | 詳細情報 |

**blocking に含まれるチェック:**

- `unresolved_required`: adapter で `fail` 指定された required 解決の失敗
- `unknown_skill_override`: adapter で `fail` 指定された unknown_skill
- `capability_mismatch_override`: adapter で `fail` 指定された capability_mismatch
- `override_not_allowed`: adapter で `fail` 指定された override_not_allowed

### `catalog_validation`

| Field | Type | Description |
| --- | --- | --- |
| `skill_count` | number | スキル総数 |
| `reference_count` | number | 参照総数 |
| `capability_count` | number | capability 総数 |
| `orphan_skills` | string[] | どの分類・解決結果にも紐づかないスキル |

### `profile_validation`

| Field | Type | Description |
| --- | --- | --- |
| `flow_count` | number | flow 数 |
| `flow_stack_slot_count` | number | Flow Profile の `flow_stack.slots[]` 定義数 |
| `unresolved_slots` | string[] | Flow Profile 上で解決先が見つからない slot |
| `resolved_invocation_count` | number | 解決済み invocation 数 |
| `unused_override_warnings` | array | 未使用 override の警告 |

## 警告と失敗の区別

- **未使用 slot/override**: 警告記録のみ（`profile_validation.unused_override_warnings`）
- **blocking_validations の fail**: `overall_result` を fail にする
- 非 blocking な問題は警告として記録するが、`overall_result` には影響しない

