# Skill Discovery Protocol — ゲート仕様

Version: 1.0.0

本文書は Skill Discovery Protocol の 4 つの検証ゲート、終了コード規約、
およびエラーメッセージフォーマットを定義する。

---

## 1. ゲート概要

検証は順番に実行される 4 つのゲートで構成される:

| ゲート | ID | 目的 |
| ------ | -- | ---- |
| 1 | `schema` | 成果物と adapter の構造的正しさ |
| 2 | `staleness` | `validated_at` に基づく成果物の鮮度 |
| 3 | `deterministic` | 再実行で同一出力が得られること |
| 4 | `blocking` | 重要な invocation 解決チェック |

### 全体結果の算出式

```text
overall_result = schema ∧ staleness ∧ deterministic ∧ blocking
```

先行ゲートが失敗しても全ゲートが実行され、すべての問題が一度に報告される。

---

## 2. 終了コード規約

| コード | 意味 | 発生条件 |
| ------ | ---- | -------- |
| `0` | 成功 | すべてのゲートが pass |
| `1` | 検証失敗 | 1 つ以上のゲートが fail |
| `2` | 入力エラー | ファイル未検出、YAML/JSON パースエラー、未知サブコマンド |

### ルール

- 終了コード `1`: 入力は有効だが内容が検証に失敗
- 終了コード `2`: 検証を開始することすらできない
- 単一の検証実行ですべての失敗を報告する（短絡しない）
- 入力エラーと検証失敗の両方がある場合、`2` が優先

---

## 3. エラーメッセージフォーマット

すべての検証エラーは一貫した構造に従う:

```json
{
  "path": "<失敗フィールドへのドット記法パス>",
  "message": "<人間可読な失敗の説明>",
  "severity": "error",
  "gate": "<gate_id>"
}
```

### フィールド

| フィールド | 型 | 説明 |
| ---------- | -- | ---- |
| `path` | string | エラー箇所への JSON パス（例: `"scan.scopes.project.roots"`） |
| `message` | string | 何が失敗したか、なぜかの明確な説明 |
| `severity` | enum | `"error"`（pass をブロック）または `"warning"`（情報提供） |
| `gate` | string | このエラーを生成したゲート |

### メッセージガイドライン

- メッセージは対処可能でなければならない（修正方法を説明）
- メッセージは可能な限り問題の値を参照する
- メッセージにスタックトレースや内部実装の詳細を含めない
- 例: `"slot_id 'adrAuthoring' does not match snake_case pattern ^[a-z][a-z0-9]*(_[a-z0-9]+)*$"`

---

## 4. Gate 1: Schema Validation

成果物と adapter 設定の構造的正しさを検証する。

### 実行されるチェック

| チェック | 対象 | 条件 |
| -------- | ---- | ---- |
| 必須キー存在 | Adapter, Catalog, Profile | すべての必須フィールドが存在する |
| 型正確性 | 全フィールド | 各フィールドが期待される型に一致する |
| Enum 値 | `slot_type`, `activation`, `action`, `severity` | 許可セット内の値 |
| `snake_case` 強制 | 識別子 | `^[a-z][a-z0-9]*(_[a-z0-9]+)*$` に一致 |
| Classification 整合性 | `unmatched.category` | `taxonomy[].id` に存在する |
| 禁止キー | `priority` | どこにも存在してはならない |
| スコープ整合性 | `scan.scopes` | `enabled: true` のスコープは `roots` が非空（マージ後） |
| Readable outputs 整合性 | `readable_outputs.include` | すべてのエントリが `artifacts.protocol` に存在する |
| Unmatched ポリシー妥当性 | `classification.unmatched` | 矛盾する組み合わせなし |
| Default 排他性 | `flow_stack.slots[].default` | `skill` と `capability` の同時指定なし。`layerable` は順序付きの default entry 配列を使う |

### `snake_case` 強制の詳細

以下の識別子が検証される:

- `flow_stack.slots[].slot_id`
- `classification.taxonomy[].id`
- `classification.taxonomy[].match.capabilities[]`
- `invocation_resolution.overrides.slots.<key>`
- `invocation_resolution.overrides.capabilities.<key>`
- `provides[].capability`（カタログ内）
- `uses[].capability`（カタログ内）

不適合な識別子は以下を生成する:

```json
{
  "path": "flow_stack.slots[0].slot_id",
  "message": "slot_id 'adrAuthoring' does not match snake_case pattern ^[a-z][a-z0-9]*(_[a-z0-9]+)*$",
  "severity": "error",
  "gate": "schema"
}
```

### 無効な `classification.unmatched` の組み合わせ

| `action` | `severity` | `category` | 結果 |
| -------- | ---------- | ---------- | ---- |
| `assign` | any | 欠落 | error |
| `fail` | `info` | any | error |
| `ignore` | `error` | any | error |
| any | any | taxonomy にない | error |

### 結果スキーマ

```json
{
  "result": "pass" | "fail",
  "errors": [
    {
      "path": "scan.scopes.project.roots",
      "message": "enabled scope 'project' has empty roots after merge",
      "severity": "error",
      "gate": "schema"
    }
  ],
  "warnings": []
}
```

---

## 5. Gate 2: Staleness Validation

成果物が信頼できるほど新しいことを検証する。

### 設定

```yaml
validation:
  staleness:
    enabled: true
    basis: "validated_at"
    max_age_days: 30
```

### 実行されるチェック

| チェック | 条件 |
| -------- | ---- |
| 経過日数制限 | `now - validated_at <= max_age_days` |
| 新規スキル | 最後の `validated_at` 以降にスキルが追加されていない |
| 削除スキル | 最後の `validated_at` 以降にスキルが削除されていない |

### スキル変更の検出

- 現在のスキャン結果を既存カタログのスキルリストと比較
- `SKILL.md` を含む新規ディレクトリ → `new_skills[]`
- ディレクトリの削除または `SKILL.md` の削除 → `removed_skills[]`

### 結果スキーマ

```json
{
  "result": "pass" | "fail",
  "basis": "validated_at",
  "basis_date": "2025-01-15T10:30:00Z",
  "max_age_days": 30,
  "age_days": 5,
  "new_skills": [],
  "removed_skills": []
}
```

---

## 6. Gate 3: Deterministic Validation

再実行でバイト同一の出力が得られることを検証する。

### 設定

```yaml
validation:
  deterministic:
    enabled: true
    compare:
      - "profile"
      - "profile+catalog-artifacts"
      - "validation-report:exclude-timestamp"
```

### 手順

1. 現在の成果物ファイルを退避
2. 同じ adapter で `sdp profile` を再実行
3. 各対象ペアをバイト単位で比較
4. 元の成果物を復元
5. いずれかの比較で差分が見つかった場合 → fail

### 比較対象

| 対象 | 比較内容 |
| ---- | -------- |
| `profile` | Flow Profile JSON |
| `profile+catalog-artifacts` | Flow Profile + Skill Reference Catalog |
| `validation-report:exclude-timestamp` | `generated_at` を除いた Validation Report |

### 安定性メカニズム

- `render.stable_sort` で定義される安定ソートキー
- `render.normalize_whitespace` による空白正規化
- `render.newline` による改行正規化
- ランダム値なし、環境依存コンテンツなし

### 結果スキーマ

```json
{
  "result": "pass" | "fail",
  "comparisons": [
    {
      "target": "profile",
      "diff_found": false,
      "details": null
    },
    {
      "target": "profile+catalog-artifacts",
      "diff_found": true,
      "details": "catalog.skills[3].description differs"
    }
  ]
}
```

---

## 7. Gate 4: Blocking Validations

重要な invocation 解決制約を検証する。

### 設定ソース

blocking チェックは `invocation_resolution` 設定から導出される:

| 設定 | 値 | 動作 |
| ---- | -- | ---- |
| `unresolved.required` | `"fail"` | 必須未解決 → ゲート失敗 |
| `unresolved.required` | `"warn"` | 警告のみ |
| `unresolved.optional` | `"warn"` | 警告のみ |
| `unresolved.optional` | `"ignore"` | サイレントスキップ |
| `invalid_override.unknown_skill` | `"fail"` | 不明スキル → ゲート失敗 |
| `invalid_override.capability_mismatch` | `"fail"` | 不一致 → ゲート失敗 |
| `invalid_override.override_not_allowed` | `"fail"` | 不許可 → ゲート失敗 |
| 上記のいずれか | `"warn"` | 警告のみ、ブロックしない |

### 非 blocking 項目（常に警告のみ）

- 未使用スロットオーバーライド（定義されたが参照されないスロット）
- 未使用 capability オーバーライド
- オプション未解決 invocation（`unresolved.optional = "warn"` の場合）

### Invocation ゲートトグル

```yaml
validation:
  invocation:
    enabled: true
```

`enabled: false` の場合、Gate 4 は完全にスキップされるがレポートに記録される:

```json
{
  "result": "skip",
  "reason": "invocation validation disabled in adapter"
}
```

### 結果スキーマ

```json
{
  "result": "pass" | "fail" | "skip",
  "checks": [
    {
      "type": "unresolved_required",
      "target": "code_review",
      "result": "fail",
      "message": "Required capability 'code_review' has no provider and no override"
    }
  ],
  "warnings": [
    {
      "type": "unused_override",
      "target": "deprecated_slot",
      "message": "Override for slot 'deprecated_slot' is never referenced"
    }
  ]
}
```

---

## 8. 全体検証レポート

検証レポートはすべてのゲート結果を集約する:

```json
{
  "schema_version": "1.0",
  "generated_at": "2025-01-20T14:00:00Z",
  "repository": "my-project",
  "adapter_id": "implementation-flow-default",
  "schema_validation": { "result": "pass", "errors": [], "warnings": [] },
  "staleness_validation": { "result": "pass", "basis_date": "...", "age_days": 2 },
  "deterministic_validation": { "result": "pass", "comparisons": [] },
  "blocking_validations": { "result": "pass", "checks": [], "warnings": [] },
  "overall_result": "pass"
}
```

### ゲート実行順序

1. Schema（常に実行）
2. Staleness（常に実行）
3. Deterministic（常に実行）
4. Blocking（`validation.invocation.enabled = false` でない限り実行）

Gate 1 が失敗しても後続のすべてのゲートは実行され、
全問題の完全な把握が可能。

---

## 9. `snake_case` はスキーマエラー

### スコープ

`snake_case` ルールの対象となる識別子がパターンチェック
`^[a-z][a-z0-9]*(_[a-z0-9]+)*$` に失敗した場合、
警告ではなく**スキーマエラー**に分類される。

### 影響

- Gate 1（Schema Validation）で報告
- `schema_validation.result = "fail"` を引き起こす
- `overall_result = "fail"` を引き起こす
- 終了コード = `1`

### 例

| 値 | 有効 | 理由 |
| -- | ---- | ---- |
| `adr_authoring` | Yes | 正しい snake_case |
| `code_review` | Yes | 正しい snake_case |
| `adrAuthoring` | No | camelCase |
| `ADR_AUTHORING` | No | UPPER_CASE |
| `adr-authoring` | No | kebab-case |
| `_private` | No | 先頭アンダースコア |
| `123_slot` | No | 先頭数字 |
