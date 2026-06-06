---
name: skill-discovery-protocol
description: "インストール済みスキルをスキャンし、推論した skill reference を構築し、capability catalog と flow profile を作成し、discovery artifacts を検証するメタスキル。skill catalog の生成、flow profile の構築、discovery artifacts の検証、skill capability の問い合わせ時に使用します。Keywords: sdp, discovery, catalog, profile, validation, adapter."
version: "1.0.0"
license: MIT
---

# Skill Discovery Protocol

インストール済みのスキルを発見し、capability を推論し、その結果を
flow-neutral な catalog, profile, validation artifacts に変換する
メタスキルです。skill catalog の生成、flow profile の構築、
discovery artifacts の検証、skill capability の問い合わせ時に使用します。

## 使用タイミング

- `project`, `user`, `organization`, `builtin` の各 scope からスキルを
  スキャンしたいとき。
- スキャン済みスキルの本文から `provides`, `uses`,
  `execution_policy`, `tags` を推論したいとき。
- `.sdp` の discovery artifacts を作成または確認したいとき。
- freshness, determinism, schema compliance, blocking invocation の
  問題を検証したいとき。
- 生成済みの flow profile を問い合わせたいとき。

## 基本モデル

インストール済みスキルは外部入力です。`SKILL.md` には `name` と
`description` などの標準メタデータだけが含まれる前提で扱ってください。
`provides`, `uses`, `tags`, `execution_policy` のような独自 front matter を
要求してはいけません。

この protocol は flow-neutral です。

- `sdp scan` は raw な discovery data を書き出します。
- agent inference が capability metadata を決めます。
- `sdp infer` がその agent-authored metadata を保存します。
- `sdp profile` が scan と inference を catalog と profile にまとめます。
- `sdp validate` と `sdp query` が生成済み artifacts を読み、検証します。

## ワークフロー

```text
load_adapter -> scan_skills -> write_scan_list
-> read_skill_reference_inferences -> build_skill_reference_catalog
-> classify_skills -> resolve_invocations -> build_flow_profile
-> render_outputs -> validate_outputs
```

| Step | Input | Output |
| ---- | ----- | ------ |
| `load_adapter` | Adapter YAML | Merged config |
| `scan_skills` | Scopes + roots | Raw skill list |
| `write_scan_list` | Raw skill list | `skill-scan-list.json` |
| `read_skill_reference_inferences` | Inference JSON | Inferred skill references |
| `build_skill_reference_catalog` | Scan list + inferences | Skill Reference Catalog JSON |
| `classify_skills` | Catalog + taxonomy | Classified skills |
| `resolve_invocations` | Classified skills + overrides | Resolved invocations |
| `build_flow_profile` | All above | Flow Profile JSON |
| `render_outputs` | JSON artifacts | Stable-sorted JSON + optional Markdown |
| `validate_outputs` | Artifacts | Validation Report |

## Agent Inference Rules

`sdp scan` の後は `.sdp/skill-scan-list.json` を確認し、次のルールで
metadata を推論してください。

- `provides[]` は、そのスキルが直接できることを表します。
- `uses[]` は、そのスキルが依存するもの、または別のスキルに期待する
  ものを表します。
- `execution_policy` は、順序、検証、ツール使用に関する強い制約がある
  場合だけ使います。
- `runtime_guidance` は、`execution_policy` の後に参照する soft ranking
  signal です。候補の順位付けや実行時の補助判断に使います。
- `tags[]` は分類の補助に限定します。flow routing には使いません。

これらの決定は `sdp infer` で保存します。

```text
sdp infer init --scan .sdp/skill-scan-list.json --out .sdp/skill-reference-inferences.json --if-exists merge
sdp infer set-skill --name <skill> --spec <skill-inference.json> --in .sdp/skill-reference-inferences.json --out .sdp/skill-reference-inferences.json
sdp infer apply --ops <jsonl> --in .sdp/skill-reference-inferences.json --out .sdp/skill-reference-inferences.json
sdp infer check --in .sdp/skill-reference-inferences.json
```

生成済みの catalog, profile, report, Markdown sidecar は手編集しないでください。
inference JSON は agent-authored input ですが、schema check と stable sorting を
保つため、必ず `sdp infer` 経由で更新してください。

## コマンド規則

| Command | Purpose |
| ------- | ------- |
| `sdp scan --adapter <yaml>` | Generate the raw scan list |
| `sdp infer init --scan <json>` | Create the editable inference artifact from scan output |
| `sdp infer set-skill --name <skill> --spec <json>` | Upsert one agent-authored inference entry |
| `sdp infer apply --ops <jsonl>` | Apply multiple inference edits atomically |
| `sdp infer check --in <json>` | Validate inference schema before profiling |
| `sdp profile --adapter <yaml> [--references <json>]` | Generate catalog and adapter-scoped profile from existing scan + inference artifacts |
| `sdp validate --profile <json>` | Validate artifacts against gates |
| `sdp query --profile <json> <sub>` | Extract information from artifacts |

scan data がないときは `sdp scan` を先に実行してください。inference data が
ないときは `sdp infer init --scan .sdp/skill-scan-list.json` を実行し、その後に
`sdp profile` を再実行してください。

## Artifact Model

### Skill Scan List

`skill-scan-list.json` には、各スキャン済みスキルの `name`, `description`,
全文 `body`, `skill_path`, `scope` が入ります。

### Skill Reference Inferences

`skill-reference-inferences.json` には、agent が推論した `provides`, `uses`,
`execution_policy`, `tags` が入ります。各 entry はスキャン済みスキルと一致
していなければなりません。

### Skill Reference Catalog

`skill-reference-catalog.json` には次の情報が入ります。

- `provides[]`: スキルが提供する capability
- `uses[]`: スキルが消費する capability
- `execution_policy`: スキルの実行方法
- `runtime_guidance`: 実行時の補助情報
- `tags[]`: 分類用の hint

この catalog は flow-independent です。`slots`, `slot_count`,
`resolved_invocations`, flow-specific classification は含めてはいけません。

### Flow Profile

`*-profile.json` には次の情報が入ります。

- adapter taxonomy による skill classification
- `flow_stack.slots[]`: flow 用の invocation slot 割り当て
- `resolved_invocations`: fully resolved skill routing
- `runtime_guidance`: 実行時の補助情報

## NEVER

- 生成済みの JSON artifacts を手編集しない。
- 生成済みの Markdown sidecar を手編集しない。
- `sdp profile` が scan や inference を暗黙実行すると考えない。
- flow-independent catalog に flow-specific routing data を入れない。
- `tags[]` を routing logic として扱わない。
- スキャン済みスキルに独自 front matter を要求しない。

## Reference Loading Guide

必要な参照だけを読みます。

- `references/cli-reference.md`
  - CLI の使い方、command order、引数、出力形式に関する作業では
    MANDATORY です。
  - このファイルの workflow だけで足りるなら、追加で読む必要はありません。
- `references/operation-policy.md`
  - 生成済み artifacts、手編集、write-vs-read のルールを扱うときは
    MANDATORY です。
  - 純粋な query 作業では読む必要はありません。
- `references/gate-spec.md`
  - validation failure、gate の挙動、exit code を扱うときは
    MANDATORY です。
  - validation や staleness の調査でなければ読みません。
- `references/protocol-contract.md`
  - artifact structure、required fields、contract semantics を扱うときは
    MANDATORY です。
  - operator recipe だけなら不要です。
- `references/schema-reference.md`
  - adapter YAML, schema fields, merge / extends 解決を扱うときは
    MANDATORY です。
  - query-only 作業では不要です。

## References

- [Protocol Contract](references/protocol-contract.md)
- [Protocol Contract (Japanese)](references/protocol-contract.ja.md)
- [CLI Reference](references/cli-reference.md)
- [CLI Reference (Japanese)](references/cli-reference.ja.md)
- [Operation Policy](references/operation-policy.md)
- [Operation Policy (Japanese)](references/operation-policy.ja.md)
- [Gate Specification](references/gate-spec.md)
- [Gate Specification (Japanese)](references/gate-spec.ja.md)
- [Schema Reference](references/schema-reference.md)
- [Schema Reference (Japanese)](references/schema-reference.ja.md)
- Spec details: `docs/specs/skills/skill-discovery-protocol/`
