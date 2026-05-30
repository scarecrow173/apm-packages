# Skill Discovery Protocol — 運用規約

Version: 1.0.0

本文書は SDP 成果物の作成・更新・検証に関する運用規約を定義する。
生成された成果物への手動編集は禁止される。

---

## 1. スクリプト駆動操作ルール

**すべての成果物操作は `sdp` CLI を経由しなければならない。**

### 1.1 禁止操作

- JSON 成果物の手動編集（`*-catalog.json`、`*-profile.json`、
  `validation-report.json`、`resolved-invocations.json`）
- 派生 Markdown 成果物の手動編集（`sdp generate` で生成される `.md` サイドカー）
- `sdp` を迂回する外部スクリプトによる成果物内容の変更

### 1.2 手動編集が許可されるファイル

以下のファイルは**設定**であり、生成出力ではないため手動編集が可能:

- Adapter YAML ファイル（`references/*.yaml`）
- `SKILL.md` / `SKILL.ja.md`（スキル定義文書）
- `protocol-contract.md` 等のリファレンス文書
- ソーススクリプト（`src/skills/**/scripts/*.ts`）

### 1.3 例外条件

手動での成果物編集は以下の場合のみ許可される:

1. `sdp` CLI が壊れており出力を生成できない場合（緊急復旧）
2. 編集直後に `sdp validate` を実行し適合性を確認する場合
3. コミットメッセージに `# MANUAL_EDIT: <理由>` を記載する場合

---

## 2. スクリプト責務分離

CLI は 3 つの責務ドメインに分離される:

| コマンド | 責務 | 動詞 |
| -------- | ---- | ---- |
| `sdp generate` | 成果物の生成・更新 | Write |
| `sdp validate` | 成果物の正当性検証 | Read + Check |
| `sdp query` | 成果物からの情報抽出 | Read |

### 2.1 Generate スクリプト

- Adapter YAML を読み込み（`extends` 解決を含む）
- `scan.scopes` に従いスキルディレクトリを走査
- Skill Reference Catalog を構築
- adapter taxonomy に基づきスキルを分類
- invocation を解決
- Flow Profile を構築
- 安定ソートされた JSON + オプショナル Markdown サイドカーをレンダリング
- 成功時は終了コード `0`、入力エラー時は `1`、スキーマエラー時は `2`

### 2.2 Validate スクリプト

- 生成済み成果物（JSON）を読み込み
- 4 つのゲートを実行: schema → staleness → deterministic → blocking
- `validation-report.json` を生成
- 全ゲート通過時は終了コード `0`、いずれか失敗時は `1`、入力エラー時は `2`

### 2.3 Query スクリプト

- Flow Profile JSON を読み込み（Markdown は正規入力として扱わない）
- サブコマンド経由で情報を抽出・表示
- 純粋な読み取り専用操作（ファイルを変更しない）
- 成功時は終了コード `0`（結果なし = 空配列）、入力エラー時は `1`、
  未知サブコマンド時は `2`

---

## 3. ビルドパイプライン

### 3.1 ソースから出力へのパス

```text
src/skills/skill-discovery-protocol/scripts/*.ts
  → esbuild (bundled, ESM)
  → .apm/skills/skill-discovery-protocol/scripts/*.js
```

### 3.2 ビルドコマンド

```bash
pnpm run build:scripts
```

これは `tsx scripts/build-skill-scripts.ts` を呼び出し、esbuild を使って
`src/skills/**/scripts/` 配下の全 TypeScript ソースを対応する
`.apm/skills/**/scripts/` 出力先にコンパイルする。

### 3.3 不変条件

- 出力 `.js` ファイルはリポジトリにコミットされる（エージェントが消費する配布形式）
- ソース `.ts` ファイルが唯一の信頼できるソース
- `.ts` への変更後は必ず `pnpm run build:scripts` を実行する
- ビルドは決定論的でなければならない（同一ソース → 同一出力バイト列）

---

## 4. CLI コマンドリファレンス

### 4.1 `sdp generate`

```text
sdp generate --adapter <adapter-yaml>
```

adapter の `artifacts.protocol` セクションで定義された全成果物を生成する。

### 4.2 `sdp validate`

```text
sdp validate --profile <flow-profile-json>
sdp validate --adapter <adapter-yaml>
```

- `--profile`: 生成済み成果物の完全 4 ゲート検証
- `--adapter`: Adapter YAML 設定のスキーマのみ検証

### 4.3 `sdp query`

```text
sdp query --profile <flow-profile-json> <subcommand> [options]
```

サブコマンド: `categories`、`category-skills`、`resolution`、`flow-stack`、
`execution-policy`、`capability-skills`、`skill-detail`、`runtime-guidance`、
`unresolved`、`validation-status`

---

## 5. Adapter YAML スキーマ

### 5.1 必須キー

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

### 5.2 推奨キー

| キー | 型 | 説明 |
| ---- | -- | ---- |
| `extends` | string[] | 親 adapter の参照名（拡張子なし） |
| `enabled` | boolean | 有効/無効切替 |
| `metadata` | object | owner、description、last_validated_at |

### 5.3 `flow_stack.slots[]` スキーマ

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

## 6. Invocation Resolution 規約

### 6.1 `resolved_invocations` 生成規約

Flow Profile の `resolved_invocations` 配列は以下の手順で生成される:

1. `flow_stack.slots[]` を走査し各スロットの割り当てを解決
2. `invocation_resolution.overrides.slots` で明示的オーバーライドを適用
3. `invocation_resolution.overrides.capabilities` で capability ルーティングを適用
4. `resolution_order` に従い優先順位を決定
5. `unresolved` エントリをポリシーに従い記録（`fail` または `warn`）

### 6.2 解決順序

`resolution_order` 配列が優先順位を定義（最初にマッチした方が勝つ）:

1. `slot_override` — adapter 内の明示的スロットオーバーライド
2. `capability_override` — adapter 内の明示的 capability オーバーライド
3. `default_skill` — `flow_stack.slots[].default` からのデフォルト
4. `provider_lookup` — 必要な capability を `provides` するスキル

### 6.3 オーバーライド検証

| 条件 | 設定キー | `fail` 動作 | `warn` 動作 |
| ---- | -------- | ----------- | ----------- |
| 必須未解決 | `unresolved.required` | Gate 4 失敗 | 警告のみ |
| オプション未解決 | `unresolved.optional` | — | 警告のみ |
| 不明スキル参照 | `invalid_override.unknown_skill` | Gate 4 失敗 | 警告のみ |
| Capability 不一致 | `invalid_override.capability_mismatch` | Gate 4 失敗 | 警告のみ |
| 許可されないオーバーライド | `invalid_override.override_not_allowed` | Gate 4 失敗 | 警告のみ |

---

## 7. 命名規約

### 7.1 `snake_case` 要件

以下の識別子は `snake_case` を使用しなければならない:

- `flow_stack.slots[]` の `slot_id`
- `provides[]` および `uses[]` の `capability` 値
- `invocation_resolution.overrides.slots` のオーバーライドキー
- `invocation_resolution.overrides.capabilities` のオーバーライドキー
- `classification` の `taxonomy[].id`
- `taxonomy[].match.capabilities[]` の値

### 7.2 強制方法

パターン `^[a-z][a-z0-9]*(_[a-z0-9]+)*$` に一致しない識別子は
**スキーマエラー**であり、Gate 1（Schema Validation）を失敗させる。

### 7.3 根拠

- すべての adapter と成果物間の一貫性
- 曖昧さなく機械読取可能（大文字小文字の折りたたみ問題なし）
- YAML キーおよび JSON フィールド名との互換性

---

## 8. `extends` 解決ルール

### 8.1 参照名解決

`extends` の値は参照名であり、ファイルパスではない。

解決アルゴリズム:

```text
for name in extends:
  candidates = [
    "references/{name}.yaml",
    "references/{name}.yml"
  ]
  if both exist → schema error
  if neither exists → schema error
  resolved = the one that exists
```

### 8.2 マージセマンティクス

- 宣言順: `extends: [a, b]` → まず `a` を解決、次に `b`
- マージ方向: 最上位の親 → ... → 直接の親 → 子 adapter
- オブジェクトフィールド: 再帰マージ（子が勝つ）
- スカラーフィールド: 後勝ち上書き
- 配列フィールド: 子が完全に置換（追記なし）

### 8.3 制約

- パス直書きは禁止（例: `extends: ["./my-adapter.yaml"]`）
- `priority` キーはどこでも禁止（存在すればスキーマエラー）
- 循環参照はスキーマエラー
- ネストされた extends は許可（ルートまで再帰解決）
- スキーマ検証は最終マージ結果に対して実行

---

## 9. `scan.scopes` 集約ルール

### 9.1 General Adapter の役割

`general-adapter.yaml` は既知のすべてのハーネス roots を集約する:

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

### 9.2 Flow 差分上書きパターン

Flow adapter は `general-adapter` を extends し、差分のみ上書きする:

```yaml
extends:
  - "general-adapter"

scan:
  scopes:
    project:
      roots:
        - ".apm/skills"
        - ".agents/skills"
```

配列は完全置換されるため、flow adapter の `roots` は general adapter の
広範なリストを完全に上書きする。

### 9.3 マージ後検証

すべての `extends` マージ完了後:

- `enabled: true` のすべてのスコープは `roots` が非空でなければならない
- 違反 → スキーマエラー

---

## 10. Classification 検証規約

### 10.1 Taxonomy 検証

- `taxonomy` が正規キー（`vocab`、`categories` 等は使用しない）
- 各エントリは必須: `id`、`label`、`description`、`match`
- `match` は必須: `capabilities[]`、`tags[]`、`description_patterns[]`
- `id` の値は `snake_case` でなければならない

### 10.2 Unmatched ポリシー検証

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

## 11. Execution Policy 契約

### 11.1 Skill Reference Catalog の `execution_policy`

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

### 11.2 フィールド

| フィールド | 型 | デフォルト | 説明 |
| ---------- | -- | ---------- | ---- |
| `requires_human_review` | boolean | `false` | スキル出力に人間の承認が必要 |
| `max_parallel` | number | `1` | 最大同時実行数 |
| `timeout_seconds` | number or null | `null` | 実行タイムアウト（null = 無制限） |
| `retry_on_failure` | boolean | `false` | 一時的失敗時の自動リトライ |
| `idempotent` | boolean | `true` | 同一入力で再実行可能 |

### 11.3 クエリアクセス

```bash
sdp query --profile <json> execution-policy --skill <name>
```

カタログから指定スキルの `execution_policy` を返す。
