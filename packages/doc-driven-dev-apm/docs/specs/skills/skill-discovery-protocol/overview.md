# Skill Discovery Protocol - 仕様概要

## 推奨読書順

1. 本ドキュメント
2. [Adapter YAML Schema](adapter-schema.md)
3. [Skill Reference Catalog](skill-reference-catalog.md)
4. [Flow Profile](flow-profile.md)
5. [Validation Report](validation-report.md)
6. [sdp CLI](sdp-cli.md)
7. [Gates](gates.md)

## 目的

`skill-discovery-protocol` は、外部からインストールされた標準的な `SKILL.md` を対象に、スキルを走査し、エージェント推論で能力情報を補完し、flow 非依存の catalog と flow 固有 profile を生成するプロトコルである。

`SKILL.md` には標準メタデータ以外の `provides` / `uses` / `tags` / `execution_policy` を要求しない。scan は見つかった各スキルの `SKILL.md` 全文を `skill-scan-list.json` に保存し、その全文を読んだエージェントが `skill-reference-inferences.json` を作る。catalog は scan 成果物と inference 成果物を結合して生成する。

## Scope

### In Scope

- adapter YAML の読み込みと `extends` 解決
- project/user/organization/builtin scope の skill scan
- scan 結果の `skill-scan-list.json` 生成
- エージェント推論成果物 `skill-reference-inferences.json` の検証
- Skill Reference Catalog 生成
- flow 固有 classification
- invocation resolution
- Flow Profile 生成
- validation report 生成
- readable Markdown sidecar 生成
- `sdp scan` / `sdp infer` / `sdp profile` / `sdp validate` / `sdp query` CLI

### Out of Scope for MVP

- runtime skill activation の実行
- remote skill installation
- LLM API による自動推論の実行そのもの
- 複数 adapter の priority-based conflict resolution

## 設計原則

- **flow 非依存**: catalog は特定 flow の slot や分類結果を持たない
- **標準 SKILL.md 前提**: `SKILL.md` に独自フィールドを要求しない
- **scan と推論の分離**: scan は全文収集、inference は能力推論、catalog は正規化を担当する
- **adapter 分離**: flow 固有ロジックは adapter YAML に閉じ込める
- **script-only**: 成果物の生成・更新・検証は script 経由で行う
- **機械可読優先**: JSON を正規成果物とし、Markdown は派生物として扱う

## 成果物モデル

```text
skill-scan-list.json
  - scan で見つかった各 SKILL.md の name / description / body / skill_path / scope
  - エージェント推論の入力

skill-reference-inferences.json
  - エージェントが SKILL.md 全文から推論した provides / uses / execution_policy / tags
  - catalog 化の入力

skill-reference-catalog.json
  - scan と inference を結合した flow 非依存の能力 catalog
  - invocation slot や分類結果は持たない

*-profile.json
  - adapter に基づく flow 固有成果物
  - flow_stack.slots[] / resolved_invocations / runtime_guidance を持つ

validation-report.json
  - schema / staleness / deterministic / blocking の検証結果
```

## Canonical Steps

```text
load_adapter -> scan_skills -> write_scan_list
-> read_skill_reference_inferences -> build_skill_reference_catalog
-> classify_skills -> resolve_invocations -> build_flow_profile
-> render_outputs -> validate_outputs
```

| Step | Input | Output |
| --- | --- | --- |
| `load_adapter` | adapter YAML | merged config |
| `scan_skills` | scopes + roots | raw skill list |
| `write_scan_list` | raw skill list | `skill-scan-list.json` |
| `read_skill_reference_inferences` | `skill-reference-inferences.json` | inferred skill capabilities |
| `build_skill_reference_catalog` | scan list + inferences | Skill Reference Catalog JSON |
| `classify_skills` | catalog + taxonomy | classified skills |
| `resolve_invocations` | classified + overrides | resolved_invocations |
| `build_flow_profile` | all above | Flow Profile JSON |
| `render_outputs` | JSON artifacts | stable-sorted JSON + optional MD |
| `validate_outputs` | artifacts | Validation Report |

## コマンド体系

| Command | 責務 |
| --- | --- |
| `sdp scan --adapter <yaml>` | scan list を生成する |
| `sdp infer init [--scan <json>] [--out <json>]` | inference 成果物を初期化・更新する |
| `sdp profile --adapter <yaml>` | 既存の scan/inference 成果物から catalog/profile を生成する |
| `sdp validate --profile <json>` | 成果物を検証する |
| `sdp query --profile <json> <subcommand>` | 成果物から情報を抽出する |

## 成果物一覧

| Artifact | Format | Role |
| --- | --- | --- |
| `skill-scan-list.json` | JSON | scan で見つかった標準 `SKILL.md` 全文の一覧 |
| `skill-reference-inferences.json` | JSON | エージェント推論で補完された capability 情報 |
| `skill-reference-catalog.json` | JSON | flow 非依存のスキル能力 catalog |
| `skill-reference-catalog.md` | Markdown | catalog の人間レビュー用派生物 |
| `*-profile.json` | JSON | Flow Profile |
| `*-profile.md` | Markdown | profile の人間レビュー用派生物 |
| `validation-report.json` | JSON | 検証レポート |
| `validation-report.md` | Markdown | report の人間レビュー用派生物 |

## 関連仕様

- [Adapter YAML Schema](adapter-schema.md)
- [Skill Reference Catalog](skill-reference-catalog.md)
- [Flow Profile](flow-profile.md)
- [Validation Report](validation-report.md)
- [sdp CLI](sdp-cli.md)
- [Gates](gates.md)
