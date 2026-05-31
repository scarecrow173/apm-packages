# Skill Discovery Protocol — CLI & スキーマリファレンス

Version: 1.0.0

本文書は CLI コマンド、Adapter YAML スキーマ、invocation 解決ルール、
および検証セマンティクスを記述する。

運用上のルールと制約については `operation-policy.ja.md` を参照。

---

## 1. CLI コマンドリファレンス

### 1.1 `sdp generate`

```text
sdp generate --adapter <adapter-yaml>
```

adapter の `artifacts.protocol` セクションで定義された全成果物を生成する。

### 1.2 `sdp validate`

```text
sdp validate --profile <flow-profile-json>
sdp validate --adapter <adapter-yaml>
```

- `--profile`: 生成済み成果物の完全 4 ゲート検証
- `--adapter`: Adapter YAML 設定のスキーマのみ検証

### 1.3 `sdp query`

```text
sdp query --profile <flow-profile-json> <subcommand> [options]
```

サブコマンド: `categories`、`category-skills`、`resolution`、`flow-stack`、
`execution-policy`、`capability-skills`、`skill-detail`、`runtime-guidance`、
`unresolved`、`validation-status`

---

## 2. Adapter YAML スキーマ

### 2.1 必須キー

| キー | 型 | 説明 |
| ---- | -- | ---- |
| `schema_version` | string | スキーマバージョン（例: `"1.0"`） |
| `adapter_id` | string | Adapter 識別子 |
| `protocol` | object | 対象プロトコル互換性情報 |
| `scan` | object | 有効スコープ定義 |
| `profile` | object | Profile 成果物の出力設定 |
| `flow_stack` | object | Flow スロット定義 |
| `classification` | object | Taxonomy と unmatched ポリシー |
| `invocation_resolution` | object | 解決設定 |
| `validation` | object | ゲート設定 |
| `render` | object | 決定論的出力制御 |
| `artifacts` | object | 出力パス |
| `readable_outputs` | object | Markdown サイドカー制御 |

### 2.2 推奨キー

| キー | 型 | 説明 |
| ---- | -- | ---- |
| `extends` | string[] | 親 adapter の参照名（拡張子なし） |
| `enabled` | boolean | 有効/無効切替 |
| `metadata` | object | owner、description、last_validated_at |

### 2.3 `flow_stack.slots[]` スキーマ

各スロットエントリの構造:

| フィールド | 型 | 必須 | 説明 |
| ---------- | -- | ---- | ---- |
| `slot_id` | string | Yes | `snake_case` 識別子 |
| `slot_type` | enum | Yes | `"layerable"` または `"exclusive"` |
| `activation` | enum | Yes | `"always"`、`"conditional"`、`"on_demand"`、`"gate"` |
| `default` | object | No | デフォルト割り当て（`skill` または `capability`） |

`default` サブフィールド:

- `default.skill`: スキル名（`default.capability` と排他）
- `default.capability`: capability ID（`default.skill` と排他）
- `default.reason`: 説明テキスト（オプション）

---

## 3. Invocation Resolution 規約

### 3.1 `resolved_invocations` 生成規約

Flow Profile の `resolved_invocations` 配列は以下の手順で生成される:

1. `flow_stack.slots[]` を走査し各スロットの割り当てを解決
2. `invocation_resolution.overrides.slots` で明示的オーバーライドを適用
3. `invocation_resolution.overrides.capabilities` で capability ルーティングを適用
4. `resolution_order` に従い優先順位を決定
5. `unresolved` エントリをポリシーに従い記録（`fail` または `warn`）

### 3.2 解決順序

`resolution_order` 配列が優先順位を定義（最初にマッチした方が勝つ）:

1. `slot_override` — adapter 内の明示的スロットオーバーライド
2. `capability_override` — adapter 内の明示的 capability オーバーライド
3. `default_skill` — `flow_stack.slots[].default` からのデフォルト
4. `provider_lookup` — 必要な capability を `provides` するスキル

### 3.3 オーバーライド検証

| 条件 | 設定キー | `fail` 動作 | `warn` 動作 |
| ---- | -------- | ----------- | ----------- |
| 必須未解決 | `unresolved.required` | Gate 4 失敗 | 警告のみ |
| オプション未解決 | `unresolved.optional` | — | 警告のみ |
| 不明スキル参照 | `invalid_override.unknown_skill` | Gate 4 失敗 | 警告のみ |
| Capability 不一致 | `invalid_override.capability_mismatch` | Gate 4 失敗 | 警告のみ |
| 許可されないオーバーライド | `invalid_override.override_not_allowed` | Gate 4 失敗 | 警告のみ |

---

## 4. `scan.scopes` 集約ルール

### 4.1 General Adapter の役割

`general.yaml`（`assets/adapters/` 内）は既知のすべてのハーネス roots を集約する:

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

### 4.2 Flow 差分上書きパターン

Flow adapter は `general` を extends し、差分のみ上書きする:

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
広範なリストを完全に上書きする。

### 4.3 マージ後検証

すべての `extends` マージ完了後:

- `enabled: true` のすべてのスコープは `roots` が非空でなければならない
- 違反 → スキーマエラー

---

## 5. Classification 検証規約

### 5.1 Taxonomy 検証

- `taxonomy` が正規キー（`vocab`、`categories` 等は使用しない）
- 各エントリは必須: `id`、`label`、`description`、`match`
- `match` は必須: `capabilities[]`、`tags[]`、`description_patterns[]`
- `id` の値は `snake_case` でなければならない

### 5.2 Unmatched ポリシー検証

- `unmatched` キーは必須
- `action` と `severity` は必須

無効な組み合わせ（各々スキーマエラー）:

| 条件 | 無効な理由 |
| ---- | ---------- |
| `action=assign` で `category` なし | 割り当て先がない |
| `action=fail` で `severity=info` | severity セマンティクスと矛盾 |
| `action=ignore` で `severity=error` | ignore セマンティクスと矛盾 |
| `category` が taxonomy にない | 宙に浮いた参照 |

---

## 6. Execution Policy 契約

### 6.1 Skill Reference Catalog の `execution_policy`

カタログ内の各スキルエントリは `execution_policy` オブジェクトを含む:

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

### 6.2 フィールド

| フィールド | 型 | デフォルト | 説明 |
| ---------- | -- | ---------- | ---- |
| `requires_human_review` | boolean | `false` | スキル出力に人間の承認が必要 |
| `max_parallel` | number | `1` | 最大同時実行数 |
| `timeout_seconds` | number or null | `null` | 実行タイムアウト（null = 無制限） |
| `retry_on_failure` | boolean | `false` | 一時的失敗時の自動リトライ |
| `idempotent` | boolean | `true` | 同一入力で再実行可能 |

### 6.3 クエリアクセス

```bash
sdp query --profile <json> execution-policy --skill <name>
```

カタログから指定スキルの `execution_policy` を返す。
