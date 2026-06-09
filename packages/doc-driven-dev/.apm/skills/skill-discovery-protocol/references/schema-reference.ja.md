# Skill Discovery Protocol - スキーマリファレンス

Version: 1.0.0

この文書は Adapter YAML スキーマ、invocation resolution、scan 集約、
classification 検証、および execution policy を説明する。

CLI コマンドについては `cli-reference.ja.md` を参照。
運用ルールと制約については `operation-policy.ja.md` を参照。

---

## 1. Adapter YAML スキーマ

### 1.1 必須キー

| キー | 型 | 説明 |
| --- | ---- | ----------- |
| `schema_version` | string | スキーマバージョン（例: `"1.0"`） |
| `adapter_id` | string | Adapter 識別子 |
| `protocol` | object | 対象プロトコル互換性 |
| `scan` | object | アクティブなスコープ定義 |
| `profile` | object | Profile アーティファクト出力設定 |
| `flow_stack` | object | Flow slot 定義 |
| `classification` | object | Taxonomy と unmatched ポリシー |
| `invocation_resolution` | object | 解決設定 |
| `validation` | object | Gate 設定 |
| `render` | object | 決定論的出力制御 |
| `artifacts` | object | 出力パス（`.sdp/` 相対） |
| `readable_outputs` | object | Markdown sidecar 制御 |

**アーティファクト出力ベースディレクトリ:** `artifacts.protocol` の全パスは、
プロジェクトルートの `.sdp/` ディレクトリ基準で解決される。
`.sdp/` ディレクトリは存在しなければ自動作成される。

### 1.2 推奨キー

| キー | 型 | 説明 |
| --- | ---- | ----------- |
| `extends` | string[] | 親 adapter 参照名（拡張子なし） |
| `enabled` | boolean | 有効/無効切り替え |
| `metadata` | object | owner, description, last_validated_at |

### 1.3 `flow_stack.slots[]` スキーマ

各 slot entry は次の構造を持つ:

| フィールド | 型 | 必須 | 説明 |
| ----- | ---- | -------- | ----------- |
| `slot_id` | string | Yes | `snake_case` 識別子 |
| `slot_type` | enum | Yes | `"layerable"` または `"exclusive"` |
| `activation` | enum | Yes | `"always"`, `"conditional"`, `"on_demand"`, `"gate"` |
| `default` | object | No | デフォルト割り当て（`skill` または `capability`） |

`default` の sub-field:

- `default.skill`: skill 名（`default.capability` とは排他的）
- `default.capability`: capability ID（`default.skill` とは排他的）
- `default.reason`: 説明文（任意）

---

## 2. Invocation Resolution Rules

### 2.1 `resolved_invocations` の生成

Flow Profile の `resolved_invocations` 配列は次の手順で生成される:

1. `flow_stack.slots[]` を走査し、各 slot の割り当てを解決する
2. `invocation_resolution.overrides.slots` を走査し、明示的 override を適用する
3. `invocation_resolution.overrides.capabilities` を走査し、capability routing を適用する
4. `resolution_order` で優先順位を決める
5. ポリシー（`fail` または `warn`）に従って `unresolved` エントリを記録する

`runtime_guidance` は `resolved_invocations` の一部ではない。`execution_policy`
が互換性のない候補を除外した後に flow が参照する、別の構造化メタデータである。

### 2.2 解決順

`resolution_order` 配列は優先順位を定義する（先勝ち）:

1. `slot_override` - adapter 内の明示的 slot override
2. `capability_override` - adapter 内の明示的 capability override
3. `default_skill` - `flow_stack.slots[].default` からのデフォルト（`exclusive` は単一 entry、`layerable` は順序付き配列）
4. `provider_lookup` - 必要な capability を `provides` する skill

### 2.3 Override 検証

| 条件 | 設定キー | `fail` 時の動作 | `warn` 時の動作 |
| --------- | ----------- | --------------- | --------------- |
| 必須 unresolved | `unresolved.required` | Gate 4 fail | Warning のみ |
| 任意 unresolved | `unresolved.optional` | - | Warning のみ |
| 不明な skill 参照 | `invalid_override.unknown_skill` | Gate 4 fail | Warning のみ |
| capability 不一致 | `invalid_override.capability_mismatch` | Gate 4 fail | Warning のみ |
| override 不可 | `invalid_override.override_not_allowed` | Gate 4 fail | Warning のみ |

---

## 3. `scan.scopes` 集約ルール

### 3.1 General Adapter の役割

正本の `general.yaml` は `skill-discovery-protocol/assets/adapters/general.yaml` にあり、
既知のすべての harness root を集約する:

```yaml
scan:
  scopes:
    project:
      enabled: true
      roots:
        - ".apm/skills"
        - ".agents/skills"
        - ".github/skills"
        - ".github/agents"
        - ".cursor/rules"
        - ".claude/commands"
        - ".gemini/skills"
        - ".gemini/commands"
        - ".opencode/skills"
        - "apm_modules"
        - "."
```

### 3.2 Flow Override Pattern

Flow adapter は `general` を extends し、まず現在の adapter ツリー上の
`assets/adapters/` を解決する。そこで見つからない場合は、
同梱の `skill-discovery-protocol/assets/adapters/` を使う。flow adapter は
違いだけを上書きする:

```yaml
extends:
  - "general"

scan:
  scopes:
    project:
      roots:
        - ".apm/skills"
        - ".agents/skills"
```

配列は完全置換されるため、flow adapter の `roots` は general adapter の
広い一覧を完全に上書きする。

### 3.3 Post-Merge Validation

すべての `extends` マージ後:

- `enabled: true` の scope はすべて non-empty な `roots` を持たなければならない
- これは schema error である

---

## 4. Classification Validation Rules

### 4.1 Taxonomy 検証

- `taxonomy` が canonical key である（`vocab` や `categories` ではない）
- 各 entry は `id`, `label`, `description`, `match` を持たなければならない
- `match` は `capabilities[]`, `tags[]`, `description_patterns[]` を持たなければならない
- `id` 値は `snake_case` でなければならない

### 4.2 Unmatched Policy 検証

- `unmatched` key は必須
- `action` と `severity` は必須

無効な組み合わせ（すべて schema error）:

| 条件 | なぜ無効か |
| ----------- | ----------- |
| `action=assign` で `category` がない | 割り当て先がない |
| `action=fail` で `severity=info` | severity の意味と矛盾する |
| `action=ignore` で `severity=error` | ignore の意味と矛盾する |
| `category` が taxonomy にない | dangling reference になる |

---

## 5. Execution Policy Contract

### 5.1 Skill Reference Catalog の `execution_policy`

Catalog 中の各 skill entry は `execution_policy` object を含まなければならない:

```json
{
  "execution_policy": {
    "requires_human_review": false,
    "max_parallel": 1,
    "timeout_seconds": null,
    "retry_on_failure": false,
    "idempotent": true
  }
}
```

### 5.2 フィールド

| フィールド | 型 | デフォルト | 説明 |
| ----- | ---- | ------- | ----------- |
| `requires_human_review` | boolean | `false` | 出力に人間の承認が必要 |
| `max_parallel` | number | `1` | 最大同時実行数 |
| `timeout_seconds` | number or null | `null` | 実行タイムアウト（null = 無制限） |
| `retry_on_failure` | boolean | `false` | 一時的失敗時に自動再試行する |
| `idempotent` | boolean | `true` | 同じ入力で安全に再実行できる |

### 5.3 Query からの参照

```bash
sdp query --profile <json> execution-policy --skill <name>
```

指定した skill の `execution_policy` を catalog から返す。

### 5.4 `runtime_guidance`

`runtime_guidance` は Flow Profile に保存される flow-specific の構造化メタデータであり、
catalog ではない。`execution_policy` によって互換性のない候補を除外した後に flow が参照し、
ranking と実行時のガイダンスに使う。

主なフィールド:

| フィールド | 型 | 説明 |
| ----- | ---- | ----------- |
| `priority_delta` | number | 候補の相対優先度調整 |
| `prefer_when` | string[] | 優先度を上げるべき条件 |
| `avoid_when` | string[] | 優先度を下げるべき条件 |
| `requires_sequence` | boolean | 順序依存があることを示す |
| `requires_step_reordering` | boolean | ステップ並べ替えが必要であることを示す |
| `requires_partial_application` | boolean | 部分適用が必要であることを示す |

`runtime_guidance` は hard constraint ではなく、soft ranking signal である。
