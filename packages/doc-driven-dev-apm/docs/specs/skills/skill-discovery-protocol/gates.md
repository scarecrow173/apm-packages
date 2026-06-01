# Gates 仕様

## 概要

Skill Discovery Protocol は 3 層 + blocking の検証ゲートで成果物品質を保証する。

```
overall_result = schema && staleness && deterministic && blocking_validations
```

## Gate 1: Schema Validation

成果物の構造的正しさを検証する。

### 検証対象

- Flow Profile JSON の必須キー・型
- Skill Reference Catalog JSON の必須キー・型
- Adapter YAML の必須キー・制約

### 検証項目

| Check | Condition |
| --- | --- |
| 必須キー存在 | すべての required field が存在する |
| 型一致 | 各 field が期待される型を持つ |
| enum 値 | `slot_type`, `activation` 等が許可値の範囲内 |
| `snake_case` 強制 | slot_id, capability 識別子, override キー |
| `classification` 整合 | unmatched.category が taxonomy に存在する |
| `extends` 禁止キー | `priority` キーが存在しない |
| `scan.scopes` 整合 | `enabled=true` のスコープに `roots` が非空（マージ後） |
| `readable_outputs` 整合 | `include` のキーが `artifacts.protocol` に存在する |

### 失敗時

- `schema_validation.result = "fail"`
- `schema_validation.errors[]` に詳細を記録
- 終了コード: 非 0

---

## Gate 2: Staleness Validation

成果物の鮮度を検証する。

### 検証基準

- 基準日: `validated_at`
- 許容日数: adapter の `validation.staleness.max_age_days`（既定: 30）

### 検証項目

| Check | Condition |
| --- | --- |
| 経過日数 | `now - validated_at <= max_age_days` |
| スキル追加 | 前回検証後に新規スキルが追加されていない |
| スキル削除 | 前回検証後にスキルが削除されていない |

### 失敗時

- `staleness_validation.result = "fail"`
- `new_skills[]` / `removed_skills[]` に差分を記録
- 終了コード: 非 0

---

## Gate 3: Deterministic Validation

同一入力での再実行結果が一致することを検証する。

### 比較対象

adapter の `validation.deterministic.compare` で指定:

| Target | Description |
| --- | --- |
| `profile` | Flow Profile JSON の全体比較 |
| `profile+catalog-artifacts` | Flow Profile + Skill Reference Catalog の比較 |
| `validation-report:exclude-timestamp` | validation-report のタイムスタンプ除外比較 |

### 検証手順

1. 現在の成果物を退避
2. `sdp profile` を再実行
3. 退避した成果物と新規生成物を比較
4. 差分があれば fail

### 安定性の保証手段

- 安定ソート（`render.stable_sort` で定義）
- 正規化（`render.normalize_whitespace`, `render.newline`）
- 決定論的レンダリング（同一入力 → 同一バイト列）

### 失敗時

- `deterministic_validation.result = "fail"`
- `comparisons[].diff_found = true` の対象を記録
- 終了コード: 非 0

---

## Gate 4: Blocking Validations

adapter で `fail` 指定された invocation 検証を実行する。

### blocking に含まれるチェック

| Source Setting | Check Type |
| --- | --- |
| `invocation_resolution.unresolved.required = "fail"` | required capability の未解決 |
| `invocation_resolution.invalid_override.unknown_skill = "fail"` | 存在しないスキルへの override |
| `invocation_resolution.invalid_override.capability_mismatch = "fail"` | capability 不一致の override |
| `invocation_resolution.invalid_override.override_not_allowed = "fail"` | 許可されない override |

### 非 blocking（警告のみ）

| Setting Value | Behavior |
| --- | --- |
| `unresolved.required = "warn"` | 警告記録、overall に影響しない |
| `unresolved.optional = "warn"` | 警告記録、overall に影響しない |
| `invalid_override.* = "warn"` | 警告記録、overall に影響しない |
| 未使用 slot/override | 常に警告のみ |

### 失敗時

- `blocking_validations.result = "fail"`
- `checks[].result = "fail"` の詳細を記録
- 終了コード: 非 0

---

## 終了コード規約

| Code | Meaning |
| --- | --- |
| `0` | すべてのゲート pass |
| `1` | 1 つ以上のゲート fail |
| `2` | 入力エラー（ファイルが見つからない等） |

## ゲートの実行順序

1. Schema → 2. Staleness → 3. Deterministic → 4. Blocking

Schema が fail の場合でも他のゲートは実行し、すべての問題を一度に報告する。
