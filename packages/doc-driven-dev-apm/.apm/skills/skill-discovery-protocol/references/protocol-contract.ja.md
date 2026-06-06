# Skill Discovery Protocol - Contract Specification 日本語版

Version: 1.0.0

この文書は Skill Discovery Protocol の形式的な契約を定義する。
flow 固有語彙は adapter YAML だけが持ち、protocol 本体は flow 非依存である。

## 1. Public Command Contract

公開ワークフローは次の順序である。

```text
sdp scan -> エージェント推論 -> sdp infer -> sdp profile -> sdp validate -> sdp query
```

以下の canonical steps は内部実装手順であり、`sdp profile` が scan や
inference を暗黙実行してよいという意味ではない。

## 2. Canonical Steps

```text
load_adapter -> scan_skills -> write_scan_list
-> read_skill_reference_inferences -> build_skill_reference_catalog
-> classify_skills -> resolve_invocations -> build_flow_profile
-> render_outputs -> validate_outputs
```

| Step | 事前条件 | 事後条件 |
| ---- | -------- | -------- |
| `load_adapter` | adapter YAML が存在する | `extends` 解決済み config |
| `scan_skills` | 有効 scope と roots がある | 未加工スキル一覧 |
| `write_scan_list` | 未加工スキル一覧がある | `skill-scan-list.json` を出力 |
| `read_skill_reference_inferences` | inference JSON がある | 推論済み capability 情報 |
| `build_skill_reference_catalog` | scan list と inference がある | Skill Reference Catalog JSON |
| `classify_skills` | catalog と taxonomy がある | 分類済み skill |
| `resolve_invocations` | classification と overrides がある | 解決済み invocation |
| `build_flow_profile` | classification と resolution が完了 | Flow Profile JSON |
| `render_outputs` | profile と catalog がある | 安定ソート済み JSON と任意 Markdown |
| `validate_outputs` | 成果物が出力済み | Validation Report JSON |

## 3. Scan Contract

scanner は有効化された `project` / `user` / `organization` / `builtin`
scope から `SKILL.md` を持つディレクトリを探す。

scanner は発見した各 skill の `SKILL.md` 全文を読まなければならない。
`provides` / `uses` / `tags` / `execution_policy` のような独自メタデータを
`SKILL.md` に要求してはならない。

`skill-scan-list.json` は `schema_version`, `generated_at`, `skills` を持つ。
各 skill entry は `name`, `description`, `body`, `skill_path`, `scope` を持つ。

## 4. Inference Contract

`skill-reference-inferences.json` は `skill-scan-list.json` から導かれる
agent-authored data である。agent は scan された `SKILL.md` 本文を読み、
`provides`、`uses`、`execution_policy`、`tags` を判断し、その結果を
`sdp infer` subcommands で保存する。

各 inference entry は `name`, `review_status`, `provides`, `uses`,
`execution_policy`, `tags` を持つ。scan されたすべての skill に対応する
inference が必要であり、scan されていない skill の inference は stale として扱う。
`sdp infer check` は `review_status != reviewed` の skill が 1 件でもあれば
失敗し、`sdp profile` は incomplete な inference から catalog/profile を
生成してはならない。

## 5. Skill Reference Catalog Contract

**File:** `skill-reference-catalog.json`

Catalog は flow 非依存である。flow 固有 classification、invocation slot、
resolved invocation を持たない。

Required top-level fields:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `schema_version` | string | `"1.0"` |
| `generated_at` | ISO 8601 | 生成日時 |
| `validated_at` | ISO 8601 | 最終検証日時 |
| `skill_count` | number | skill 総数 |
| `capability_count` | number | capability 総数 |
| `skills` | array | skill entry 一覧 |

Catalog は `slots` / `slot_count` / `resolved_invocations` を持ってはならない。
invocation slot は Flow Profile の `flow_stack.slots[]` が保持する。

## 6. Flow Profile Contract

**File:** `<flow-name>-profile.json`

Flow Profile は flow 固有成果物であり、adapter の分類と解決結果を保持する。
`flow_stack.slots[]`、`resolved_invocations`、`runtime_guidance` はここに保存する。
`execution-policy` は hard constraint、`runtime_guidance` は soft ranking signal として扱う。

## 7. Validation Report Contract

**File:** `validation-report.json`

schema、staleness、deterministic、blocking validation の結果を記録する。
すべての必須 gate が pass の場合だけ `overall_result` は `"pass"` になる。

## 8. Derived Outputs

Markdown sidecar は派生成果物であり、canonical source として扱ってはならない。
`sdp profile` の実行ごとに再生成してもよい。
