# Skill Discovery Protocol — 仕様全体像

## 推奨読書順

1. 本ドキュメント（全体像）
2. [Adapter YAML Schema](adapter-schema.md)
3. [Skill Reference Catalog](skill-reference-catalog.md)
4. [Flow Profile](flow-profile.md)
5. [Validation Report](validation-report.md)
6. [sdp CLI](sdp-cli.md)
7. [Gates](gates.md)

## 目的

`skill-discovery-protocol` は、プロジェクト内のスキルを自動走査・分類し、
flow 実行時の解決情報を構造化成果物として出力する共通プロトコルである。

## Scope

### In Scope

- adapter YAML の読み込みと extends 合成
- skill scan（project/user/organization/builtin スコープ）
- Skill Reference Catalog 生成
- flow 固有 classification
- invocation resolution
- Flow Profile 生成
- validation report 生成
- readable Markdown sidecar 生成
- `sdp generate` / `sdp validate` / `sdp query` CLI
- implementation-flow / briefing-flow の置換

### Out of Scope for MVP

- runtime skill activation の実行
- remote skill installation
- LLM API による skill selection
- 複数 adapter の priority-based conflict resolution
- `default.capability`（provider lookup 規約確定後に拡張）

## 設計原則

- **flow 非依存**: プロトコル本体は特定 flow の語彙や分類を持たない
- **adapter 分離**: flow 固有ロジックは adapter YAML に閉じ込める
- **script-only**: 成果物の生成・更新・検証は必ずスクリプト経由で行う
- **冪等性保証**: 同一入力に対して同一出力を保証する
- **機械可読優先**: JSON を正規成果物とし、Markdown は派生物として扱う

## 2 層成果物モデル

```
┌─────────────────────────────────────────────────┐
│ Skill Reference Catalog (skill-reference-catalog.json)  │
│ - スキル一覧と provides/uses                      │
│ - execution_policy                               │
│ - flow 非依存                                     │
└─────────────────────────────────────────────────┘
          │ 参照
          ▼
┌─────────────────────────────────────────────────┐
│ Flow Profile (*-profile.json)                     │
│ - flow 固有 classification                        │
│ - flow_stack.slots[]                             │
│ - resolved_invocations                           │
│ - runtime_guidance                               │
└─────────────────────────────────────────────────┘
          │ 検証
          ▼
┌─────────────────────────────────────────────────┐
│ Validation Report (validation-report.json)        │
│ - schema / staleness / deterministic / blocking   │
│ - overall_result                                 │
└─────────────────────────────────────────────────┘
```

## Canonical Steps（処理フロー）

```
load_adapter → scan_skills → build_skill_reference_catalog
→ classify_skills → resolve_invocations → build_flow_profile
→ render_outputs → validate_outputs
```

| Step | Input | Output |
| --- | --- | --- |
| `load_adapter` | adapter YAML（extends 解決含む） | merged config |
| `scan_skills` | scopes + roots | raw skill list |
| `build_skill_reference_catalog` | raw skill list | Skill Reference Catalog JSON |
| `classify_skills` | catalog + taxonomy | classified skills |
| `resolve_invocations` | classified + overrides | resolved_invocations |
| `build_flow_profile` | all above | Flow Profile JSON |
| `render_outputs` | JSON artifacts | stable-sorted JSON + optional MD |
| `validate_outputs` | artifacts | Validation Report |

## コマンド体系（sdp CLI）

| Command | 責務 |
| --- | --- |
| `sdp generate --adapter <yaml>` | 成果物の生成・更新 |
| `sdp validate --profile <json>` | 成果物の検証 |
| `sdp query --profile <json> <subcommand>` | 情報の抽出 |

詳細: [sdp-cli.md](sdp-cli.md)

## 成果物一覧

| Artifact | Format | Role |
| --- | --- | --- |
| `skill-reference-catalog.json` | JSON | スキル能力カタログ（flow 非依存） |
| `skill-reference-catalog.md` | Markdown | 上記の人間レビュー用派生物 |
| `*-profile.json` | JSON | Flow Profile（正規成果物） |
| `*-profile.md` | Markdown | 上記の人間レビュー用派生物 |
| `validation-report.json` | JSON | 検証レポート |
| `validation-report.md` | Markdown | 上記の人間レビュー用派生物 |

## 検証ゲート

3 層 + blocking で構成:

1. **Schema gate**: 必須キー・型・制約の検証
2. **Staleness gate**: `validated_at` 基準での鮮度チェック
3. **Deterministic gate**: 再実行時の出力一致確認
4. **Blocking validations**: adapter で `fail` 指定された invocation 検証

`overall_result = schema && staleness && deterministic && blocking_validations`

詳細: [gates.md](gates.md)

## 関連仕様

- [Adapter YAML Schema](adapter-schema.md)
- [Skill Reference Catalog](skill-reference-catalog.md)
- [Flow Profile](flow-profile.md)
- [Validation Report](validation-report.md)
- [sdp CLI](sdp-cli.md)
- [Gates](gates.md)
