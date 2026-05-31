# Skill Discovery Protocol — 契約仕様

バージョン: 1.0.0

本ドキュメントは Skill Discovery Protocol の正式な契約を定義する。
すべての用語は flow 中立であり、flow 固有の語彙は adapter YAML ファイルでのみ定義される。

---

## 1. Canonical Steps 契約

プロトコルは以下のステップを順序通りに実行する:

```text
load_adapter → scan_skills → build_skill_reference_catalog
→ classify_skills → resolve_invocations → build_flow_profile
→ render_outputs → validate_outputs
```

### ステップ契約

| ステップ | 事前条件 | 事後条件 |
| -------- | -------- | -------- |
| `load_adapter` | 有効な adapter YAML パスが存在する | extends 解決済みのマージ済み設定 |
| `scan_skills` | マージ済み設定に有効スコープ ≥1（roots 非空） | 未加工スキル一覧が生成される |
| `build_skill_reference_catalog` | 非空の未加工スキル一覧 | 有効な Skill Reference Catalog JSON |
| `classify_skills` | カタログ + taxonomy がマージ済み設定に存在 | 各スキルが ≥1 カテゴリに割当または `unmatched` ポリシーで処理 |
| `resolve_invocations` | 分類完了 + overrides 読込済み | 全必須 invocation が解決または報告される |
| `build_flow_profile` | 分類 + 解決が完了 | 有効な Flow Profile JSON |
| `render_outputs` | プロファイル + カタログが生成済み | 安定ソート済み JSON + 任意 Markdown サイドカー |
| `validate_outputs` | 全成果物がレンダリング済み | `overall_result` を含む Validation Report JSON |

### 失敗の伝播

- いずれかのステップが失敗した場合、後続ステップは実行されない
- 到達可能であれば失敗は validation report に記録される
- いずれかのステップ失敗で終了コードは非 0

---

## 2. Scan 契約

### 2.1 スコープ

プロトコルは正確に 4 つの scan スコープを定義する:

| スコープ | ID | 説明 |
| -------- | -- | ---- |
| プロジェクト | `project` | リポジトリローカルのスキル |
| ユーザー | `user` | ユーザーレベル共有スキル（例: `$COPILOT_USER_SKILLS`） |
| 組織 | `organization` | 組織配布スキル |
| 組み込み | `builtin` | エージェント組み込み/システムスキル |

### 2.2 既定設定

```yaml
scan:
  scopes:
    project:
      enabled: true
      roots: [".apm/skills"]
    user:
      enabled: false
      roots: []
    organization:
      enabled: false
      roots: []
    builtin:
      enabled: false
      roots: []
```

**不変条件:** 既定では `project` スコープのみが有効。

### 2.3 スコープスキーマ

各スコープは以下の構造を持たなければならない（MUST）:

```yaml
scan.scopes.<scope_id>:
  enabled: boolean    # このスコープが有効かどうか
  roots: string[]    # 走査対象パス（プロジェクトルートからの相対パス）
```

**ルール:**

- `enabled: true` の場合、`roots` は非空でなければならない（MUST）（extends マージ後に検証）
- `enabled: false` の場合、`roots` は空でもよい（MAY）
- `roots` エントリはプロジェクトルートからの相対パス
- `roots` 内の環境変数（例: `${COPILOT_USER_SKILLS}`）はランタイムで展開される
- スコープ間の重複 roots は重複排除される（先頭出現が優先）

### 2.4 General Adapter の Root 集約

`general` adapter（`assets/adapters/general.yaml`）はサポートされる全ハーネス形式の roots を集約しなければならない（MUST）:

```yaml
# general adapter scan.scopes.project.roots
scan:
  scopes:
    project:
      enabled: true
      roots:
        # 主要スキルディレクトリ
        - ".apm/skills"
        - ".agents/skills"
        # GitHub Copilot
        - ".github/skills"
        - ".github/agents"
        # Cursor
        - ".cursor/rules"
        # Claude Code
        - ".claude/commands"
        # Gemini CLI
        - ".gemini/skills"
        - ".gemini/commands"
        # OpenCode
        - ".opencode/skills"
        # インストール済みパッケージ
        - "apm_modules"
        # ルート指示ファイル（スキル参照を走査）
        - "."
```

Flow 固有 adapter は `general` を extends し、差分のみ上書きする。

### 2.5 Scan 優先度

スコープ内では、ソースは優先度順に走査される:

| 優先度 | ソースパターン | 発見方法 |
| ------ | -------------- | -------- |
| 1 | `.apm/skills/` | `SKILL.md` を含むディレクトリ |
| 2 | `.agents/skills/` | `SKILL.md` を含むディレクトリ |
| 3 | `.github/skills/`, `.github/agents/`, `.cursor/rules/`, `.claude/commands/`, `.gemini/skills/`, `.gemini/commands/`, `.opencode/skills/` | 形式固有ファイル |
| 4 | システムスキル | エージェントコンテキスト/指示にリストされたスキル |
| 5 | `apm_modules/` | スキルを持つインストール済みパッケージ |
| 6 | ルートファイル（`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`, `.github/copilot-instructions.md`） | インラインまたは参照スキル |

---

## 3. Classification 契約

### 3.1 Taxonomy 構造

分類は adapter が `classification.taxonomy[]` で定義する:

```yaml
classification:
  taxonomy:
    - id: "<snake_case_id>"
      label: "<人間可読ラベル>"
      description: "<カテゴリ説明>"
      match:
        capabilities: []     # snake_case capability ID
        tags: []             # タグ文字列
        description_patterns: []  # 正規表現パターン
  unmatched:
    action: "assign" | "warn" | "fail" | "ignore"
    category: "<taxonomy_id>"    # action=assign の場合に必須
    severity: "info" | "warn" | "error"
```

### 3.2 Taxonomy ルール

- `taxonomy` が正規キー（`vocab` や `categories` は使用しない）
- 各エントリは `id`, `label`, `description`, `match` を持たなければならない（MUST）
- `match` は `capabilities[]`, `tags[]`, `description_patterns[]` を持たなければならない（MUST）
- `id` 値は `snake_case` でなければならない（MUST）
- `capabilities[]` 値は `snake_case` でなければならない（MUST）
- マッチングは taxonomy 配列順に評価される（最初のマッチが優先）
- adapter が許可する場合、スキルは複数カテゴリにマッチし得る

### 3.3 Unmatched ポリシー

`unmatched` キーは必須（REQUIRED）であり、どのカテゴリにも一致しないスキルを管理する:

| `action` | 動作 |
| -------- | ---- |
| `assign` | `category` に割り当てる（taxonomy の `id` を参照しなければならない（MUST）） |
| `warn` | 警告を出力; スキルは未分類のまま |
| `fail` | 分類ステップを失敗させる |
| `ignore` | スキルを静かにスキップする |

**無効な組み合わせ（スキーマエラー）:**

- `action=assign` で `category` 未指定
- `action=fail` で `severity=info`
- `action=ignore` で `severity=error`
- `category` 値が taxonomy `id` リストに存在しない

### 3.4 Flow 中立性

プロトコル本体は分類の**メカニズム**のみを定義する。
特定の taxonomy カテゴリを定義または仮定してはならない（MUST NOT）。
すべてのカテゴリ意味論は adapter の責務である。

---

## 4. 成果物契約

### 4.1 Skill Reference Catalog

**ファイル:** `skill-reference-catalog.json`

**性質:** Flow 非依存。flow 固有の分類を含まない。

**必須トップレベルフィールド:**

| フィールド | 型 | 説明 |
| ---------- | -- | ---- |
| `schema_version` | string | `"1.0"` |
| `generated_at` | ISO 8601 | 生成タイムスタンプ |
| `validated_at` | ISO 8601 | 最終検証タイムスタンプ |
| `skill_count` | number | 発見されたスキル総数 |
| `capability_count` | number | ユニーク capability 総数 |
| `slot_count` | number | スロット定義数 |
| `slots` | array | スロット定義 |
| `skills` | array | スキルエントリ |

**スキルエントリ必須フィールド:**

| フィールド | 型 | 説明 |
| ---------- | -- | ---- |
| `name` | string | スキル識別子 |
| `description` | string | スキル概要 |
| `provides` | array | 提供 capability（`{capability, description?}`） |
| `uses` | array | 利用 capability（`{capability, required, default_skill?, override_allowed?}`） |
| `execution_policy` | object | 実行制約 |

**スロットエントリ必須フィールド:**

| フィールド | 型 | 説明 |
| ---------- | -- | ---- |
| `slot_id` | string | `snake_case` 識別子 |
| `description` | string | スロットの目的 |

**制約:**

- `slot_id` と `capability` 識別子は `snake_case` でなければならない（MUST）
- カタログは `resolved_invocations` や flow 固有データを含んではならない（MUST NOT）
- `provides[].capability` 値はスキル内でユニークでなければならない（MUST）

### 4.2 Flow Profile

**ファイル:** `<flow-name>-profile.json`

**性質:** Flow 固有。adapter の flow に基づいて命名。

**必須トップレベルフィールド:**

| フィールド | 型 | 説明 |
| ---------- | -- | ---- |
| `schema_version` | string | `"1.0"` |
| `generated_at` | ISO 8601 | 生成タイムスタンプ |
| `adapter_id` | string | ソース adapter 識別子 |
| `flow_name` | string | このプロファイルが対象とする flow |
| `classification` | object | adapter taxonomy に基づく分類済みスキル |
| `flow_stack` | object | この flow のスロット割当 |
| `resolved_invocations` | array | 完全解決済みスキルルーティング |
| `runtime_guidance` | object | 実行時ヒント |

**制約:**

- プロファイルは Skill Reference Catalog に存在するスキルのみ参照しなければならない（MUST）
- `resolved_invocations` はカタログに存在するスキルのみ含めなければならない（MUST）
- `flow_stack.slots[].slot_id` はカタログのスロット定義と一致しなければならない（MUST）

### 4.3 Validation Report

**ファイル:** `validation-report.json`

**必須トップレベルフィールド:**

| フィールド | 型 | 説明 |
| ---------- | -- | ---- |
| `schema_version` | string | `"1.0"` |
| `generated_at` | ISO 8601 | レポート生成タイムスタンプ |
| `repository` | string | 対象リポジトリ名 |
| `adapter_id` | string | 生成に使用した adapter |
| `schema_validation` | object | Gate 1 結果 |
| `staleness_validation` | object | Gate 2 結果 |
| `deterministic_validation` | object | Gate 3 結果 |
| `blocking_validations` | object | Gate 4 結果 |
| `overall_result` | string | `"pass"` または `"fail"` |

**Overall result 計算式:**

```text
overall_result = schema ∧ staleness ∧ deterministic ∧ blocking_validations
```

### 4.4 派生出力

各 JSON 成果物に対して、オプションの Markdown サイドカーを生成してもよい（MAY）:

- `skill-reference-catalog.md`
- `*-profile.md`
- `validation-report.md`

Markdown ファイルは**派生物**であり、正規ソースとして扱ってはならない（MUST NOT）。
`sdp generate` 実行のたびに再生成される。

---

## 5. 検証契約

### 5.1 ゲート構造

検証は 4 つのゲートを順に実行する:

| ゲート | ID | 目的 |
| ------ | -- | ---- |
| 1 | `schema` | 成果物の構造的正しさ |
| 2 | `staleness` | `validated_at` 基準の鮮度 |
| 3 | `deterministic` | 再実行で同一出力 |
| 4 | `blocking` | 重要な invocation 解決チェック |

### 5.2 Schema Gate

検証対象:

- 全必須フィールドが正しい型で存在する
- enum 値が許可範囲内
- 識別子の `snake_case` 強制
- `classification` 整合性（unmatched.category が taxonomy に存在）
- `extends` が禁止キー（例: `priority`）を使用していない
- 有効スコープの roots が非空（マージ後）

**結果スキーマ:**

```json
{
  "result": "pass" | "fail",
  "errors": [
    { "path": "<json_path>", "message": "<説明>", "severity": "error" }
  ]
}
```

### 5.3 Staleness Gate

成果物の鮮度を検証:

- `now - validated_at <= max_age_days`
- 前回検証後に新規スキルが追加されていない
- 前回検証後にスキルが削除されていない

**設定（adapter）:**

```yaml
validation:
  staleness:
    enabled: true
    basis: "validated_at"
    max_age_days: 30
```

**結果スキーマ:**

```json
{
  "result": "pass" | "fail",
  "basis": "validated_at",
  "basis_date": "<ISO 8601>",
  "max_age_days": 30,
  "age_days": 5,
  "new_skills": [],
  "removed_skills": []
}
```

### 5.4 Deterministic Gate

再現性を検証:

1. 現在の成果物を退避
2. `sdp generate` を再実行
3. 出力をバイト単位で比較（設定に応じてタイムスタンプを除外）
4. 差分があれば fail

**設定（adapter）:**

```yaml
validation:
  deterministic:
    enabled: true
    compare:
      - "profile"
      - "profile+catalog-artifacts"
      - "validation-report:exclude-timestamp"
```

**結果スキーマ:**

```json
{
  "result": "pass" | "fail",
  "comparisons": [
    { "target": "<比較対象>", "diff_found": false }
  ]
}
```

### 5.5 Blocking Gate

重要な invocation 制約を検証:

| チェック | トリガー |
| -------- | -------- |
| `unresolved_required` | 必須 invocation に解決先がない |
| `unknown_skill_override` | override が存在しないスキルを参照している |
| `capability_mismatch_override` | override スキルが該当 capability を提供しない |

**設定（adapter）:**

```yaml
invocation_resolution:
  unresolved:
    required: "fail"
    optional: "warn"
  invalid_override:
    unknown_skill: "fail"
    capability_mismatch: "warn"
```

**結果スキーマ:**

```json
{
  "result": "pass" | "fail",
  "checks": [
    {
      "type": "<check_type>",
      "result": "pass" | "fail",
      "details": []
    }
  ]
}
```

---

## 6. Adapter Extends 契約

### 6.1 メカニズム

adapter は `extends` を文字列配列として宣言してもよい（MAY）:

```yaml
extends:
  - "general"
```

### 6.2 マージルール

- extends は宣言順（左から右）に解決される
- スカラーキーは後続の値で上書き
- 配列は置換（マージではない）、別途指定がない限り
- `scan.scopes` 内の `roots` 配列はマージ（和集合）
- `priority` キーは adapter YAML で使用禁止（FORBIDDEN）

### 6.3 制約

- 循環 extends はスキーマエラー
- extends 最大深度: 3 レベル
- 参照されるすべての adapter は解決時に存在しなければならない（MUST）
