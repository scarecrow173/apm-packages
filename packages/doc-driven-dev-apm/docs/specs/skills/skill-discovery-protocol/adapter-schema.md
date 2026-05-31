# Adapter YAML Schema 仕様

## 概要

Adapter YAML は `sdp generate` の入力として、プロトコルの動作を flow ごとにカスタマイズする設定ファイルである。

## 必須キー

| Key | Type | Description |
| --- | --- | --- |
| `schema_version` | string | スキーマバージョン（例: `"1.0"`） |
| `adapter_id` | string | adapter 識別子 |
| `protocol` | object | 対象 protocol 互換性情報 |
| `scan` | object | 有効スコープ定義 |
| `profile` | object | profile artifact 出力設定 |
| `flow_stack` | object | flow が使うスタックのスロット定義 |
| `classification` | object | flow 固有分類 taxonomy 定義 |
| `invocation_resolution` | object | 解決設定 |
| `validation` | object | gate 設定 |
| `render` | object | 再現性出力制御 |
| `artifacts` | object | 成果物の出力先 |
| `readable_outputs` | object | Markdown 派生出力の制御 |

## 推奨キー

| Key | Type | Description |
| --- | --- | --- |
| `extends` | string[] | 継承元 adapter の参照名（拡張子なし） |
| `enabled` | boolean | adapter の有効/無効切替 |
| `metadata` | object | owner / last_validated_at / description |

## `protocol`

```yaml
protocol:
  name: "skill-discovery-protocol"
  min_version: "1.0"
```

## `scan`

スコープは `project` / `user` / `organization` / `builtin` の 4 種。

```yaml
scan:
  scopes:
    project:
      enabled: true
      roots:
        - ".apm/skills"
        - ".apm/skills/*/references"
    user:
      enabled: false
      roots:
        - "${COPILOT_USER_SKILLS}"
    organization:
      enabled: false
      roots: []
    builtin:
      enabled: false
      roots: []
```

**ルール:**

- `enabled: true` のスコープは `roots` 非空が必須（マージ後に検証）
- 既定値: `project.enabled = true`、その他 `false`
- `general-adapter` に全主要ハーネスの roots を集約し、flow adapter は差分上書き

## `flow_stack`

```yaml
flow_stack:
  slots:
    - slot_id: "adr_authoring"
      slot_type: "exclusive"
      activation: "on_demand"
      default:
        skill: "documentation-and-adrs"
        reason: "ADR authoring tasks need architecture-focused output"
```

**ルール:**

- `slots` は配列必須
- 各要素の必須フィールド: `slot_id`, `slot_type`, `activation`
- `slot_id`: `snake_case` 固定、Flow Profile の `flow_stack.slots[]` にそのまま反映される
- `slot_type`: `layerable` | `exclusive`
- `activation`: `always` | `conditional` | `on_demand` | `gate`
- `default`: 任意。MVP では `default.skill` のみ許可
- `default.skill` と `default.capability` の同時指定は禁止
- `default.skill` 指定時、該当 skill が存在し対応 slot/capability を provides していることを検証

## `classification`

```yaml
classification:
  unmatched:
    action: "assign"
    category: "uncategorized"
    severity: "warn"
  taxonomy:
    - id: "uncategorized"
      label: "Uncategorized"
      description: "Fallback category"
      match:
        capabilities: []
        tags: []
        description_patterns: []
```

**ルール:**

- `taxonomy` を正規形式とする（`vocab` は使わない）
- 各要素: `id`, `label`, `description`, `match` を必須
- `match`: `capabilities[]`, `tags[]`, `description_patterns[]` を必須
- `capabilities[]` の値は `snake_case` 固定
- `unmatched` 必須: `action`, `severity` を持つ
- `action`: `assign` | `warn` | `fail` | `ignore`
- `severity`: `info` | `warn` | `error`
- `category`: `action = assign` の場合に必須、taxonomy の `id` と一致

**矛盾する組み合わせ（schema error）:**

- `action = assign` かつ `category` 未指定
- `action = fail` かつ `severity = info`
- `action = ignore` かつ `severity = error`
- `category` が taxonomy に存在しない

## `invocation_resolution`

```yaml
invocation_resolution:
  overrides:
    slots:
      adr_authoring:
        use: "documentation-and-adrs"
        reason: "..."
        fallback: null
    capabilities:
      code_review:
        prefer: "code-review-and-quality"
        fallback: null
        reason: "..."
  resolution_order:
    - "slot_override"
    - "capability_override"
    - "default_skill"
    - "provider_lookup"
  unresolved:
    required: "fail"
    optional: "warn"
  invalid_override:
    unknown_skill: "fail"
    capability_mismatch: "warn"
    override_not_allowed: "warn"
```

**ルール:**

- `overrides.slots` のキーは `snake_case`、adapter の `flow_stack.slots[].slot_id` と一致
- `overrides.capabilities` のキーは `snake_case`、capability 識別子と一致
- `resolution_order`: 重複なしで優先順を定義
- `unresolved.required`: `fail` | `warn`
- `unresolved.optional`: `warn` | `ignore`
- `invalid_override.*`: `fail` | `warn`

## `validation`

```yaml
validation:
  schema: true
  staleness:
    enabled: true
    basis: "validated_at"
    max_age_days: 30
  deterministic:
    enabled: true
    compare:
      - "profile"
      - "profile+catalog-artifacts"
      - "validation-report:exclude-timestamp"
  invocation:
    enabled: true
```

**`validation.invocation` ルール:**

- `enabled: true` — invocation gate（blocking_validations）を実行する
- `enabled: false` — invocation gate を一括無効化する（開発初期や実験的設定時に使用）
- 無効時も `validation-report` に `invocation.enabled = false` を記録する

## `render`

```yaml
render:
  stable_sort:
    skills: ["name"]
    invocations: ["source_skill", "slot", "capability"]
  normalize_whitespace: true
  newline: "lf"
```

## `artifacts`

```yaml
artifacts:
  protocol:
    skill_reference_catalog: "skill-reference-catalog.json"
    flow_profile: "briefing-profile.json"
    validation_report: "validation-report.json"
    resolved_invocations: "resolved-invocations.json"  # optional
```

**出力ベースディレクトリ:** すべての成果物はプロジェクトルート直下の `.sdp/` ディレクトリに出力される。`artifacts.protocol` のパスは `.sdp/` からの相対パスとして解決される。

例: `skill_reference_catalog: "skill-reference-catalog.json"` → `.sdp/skill-reference-catalog.json`

## `readable_outputs`

```yaml
readable_outputs:
  enabled: true
  include:
    - "skill_reference_catalog"
    - "flow_profile"
    - "validation_report"
```

**ルール:**

- `enabled: true` → `include` の artifact に対して `.md` を自動生成
- `enabled: false` → Markdown 一切生成しない
- `include` に `artifacts.protocol` に存在しないキーが含まれる場合は schema error
- `sdp query` は常に JSON を入力とし、Markdown を正規入力として扱わない

## `extends` 解決ルール

- パス文字列は書かない（参照名のみ）
- 解決先: `skill-discovery-protocol/references/{name}.yaml` or `.yml`
- 両方存在 → schema error
- 宣言順に親 adapter をマージし、最後に子 adapter を適用
- 再帰的解決を許可（親もさらに extends を持てる）
- 循環参照 → schema error
- マージ規則:
  - オブジェクト: 再帰マージ（後勝ち）
  - スカラー: 後勝ち上書き
  - 配列: 子側で置換
- `priority` キーは使用禁止（存在 → schema error）
- schema 検証は全 `extends` マージ後の最終結果に対して実行

## 最小例

```yaml
schema_version: "1.0"
adapter_id: "briefing-flow-default"

protocol:
  name: "skill-discovery-protocol"
  min_version: "1.0"

scan:
  scopes:
    project:
      enabled: true
      roots:
        - ".apm/skills"

profile:
  title: "Briefing Flow Profile"

flow_stack:
  slots:
    - slot_id: "adr_authoring"
      slot_type: "exclusive"
      activation: "on_demand"

classification:
  unmatched:
    action: "assign"
    category: "uncategorized"
    severity: "warn"
  taxonomy:
    - id: "uncategorized"
      label: "Uncategorized"
      description: "Fallback"
      match:
        capabilities: []
        tags: []
        description_patterns: []

invocation_resolution:
  overrides:
    slots: {}
    capabilities: {}
  resolution_order:
    - "slot_override"
    - "capability_override"
    - "default_skill"
    - "provider_lookup"
  unresolved:
    required: "fail"
    optional: "warn"
  invalid_override:
    unknown_skill: "fail"
    capability_mismatch: "warn"
    override_not_allowed: "warn"

validation:
  schema: true
  staleness:
    enabled: true
    basis: "validated_at"
    max_age_days: 30
  deterministic:
    enabled: true
    compare:
      - "profile"

render:
  stable_sort:
    skills: ["name"]
    invocations: ["source_skill"]
  normalize_whitespace: true
  newline: "lf"

artifacts:
  protocol:
    skill_reference_catalog: "skill-reference-catalog.json"
    flow_profile: "flow-profile.json"
    validation_report: "validation-report.json"

readable_outputs:
  enabled: false
  include: []

extends:
  - "general-adapter"
enabled: true
```
