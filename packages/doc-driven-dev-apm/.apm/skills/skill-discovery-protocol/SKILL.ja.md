---
name: skill-discovery-protocol
description: "プロジェクト内スキルを走査・カタログ化・分類・検証する flow 中立メタスキル。使用時: スキルカタログ生成、flow プロファイル構築、成果物検証、capability 照会。キーワード: sdp, discovery, catalog, profile, validation, adapter."
version: "1.0.0"
license: MIT
---

# Skill Discovery Protocol

プロジェクト内のスキルを走査・カタログ化・検証する **メタスキル**。
flow 固有の語彙をプロトコル本体に持たず、任意の flow（implementation、briefing、
将来の flow）が共通基盤として利用できる。

## 目的

- 複数スコープにまたがるスキルソースの走査
- flow 非依存の Skill Reference Catalog 構築
- adapter 駆動の分類による flow 固有プロファイル生成
- スキーマ準拠・鮮度・決定性の検証

## 使用タイミング

- プロジェクトの Skill Reference Catalog を生成・更新するとき
- スキルルーティングを必要とする flow プロファイルを構築するとき
- スキル変更後に既存成果物を検証するとき
- カタログから capability やスロット情報を照会するとき
- スキル discovery が必要な新しい flow をオンボードするとき

## 設計原則

- **flow 中立**: プロトコル本体は特定 flow の語彙を持たない
- **adapter 分離**: flow 固有ロジックは adapter YAML のみに閉じ込める
- **script-only**: 成果物の生成・検証は必ずスクリプト経由で行う
- **冪等性保証**: 同一入力に対して同一出力を保証する
- **機械可読優先**: JSON を正規成果物とし、Markdown は派生物

---

## Canonical Steps

```text
load_adapter → scan_skills → build_skill_reference_catalog
→ classify_skills → resolve_invocations → build_flow_profile
→ render_outputs → validate_outputs
```

| ステップ | 入力 | 出力 |
| -------- | ---- | ---- |
| `load_adapter` | Adapter YAML（extends 解決含む） | マージ済み設定 |
| `scan_skills` | スコープ + roots | 未加工スキル一覧 |
| `build_skill_reference_catalog` | 未加工スキル一覧 | Skill Reference Catalog JSON |
| `classify_skills` | カタログ + taxonomy | 分類済みスキル |
| `resolve_invocations` | 分類済みスキル + overrides | 解決済み invocations |
| `build_flow_profile` | 上記すべて | Flow Profile JSON |
| `render_outputs` | JSON 成果物 | 安定ソート済み JSON + 任意 MD |
| `validate_outputs` | 成果物 | Validation Report |

---

## 2 層成果物モデル

### 第 1 層: Skill Reference Catalog（flow 非依存）

`skill-reference-catalog.json` — 発見された全スキルを収録:

- `provides[]` — スキルが提供する capability
- `uses[]` — スキルが利用する capability
- `execution_policy` — 実行ポリシー
- `slots[]` — 能力スロット定義
- `tags[]` — 分類ヒント

### 第 2 層: Flow Profile（flow 固有）

`*-profile.json` — flow 名で命名（例: `implementation-profile.json`）:

- adapter taxonomy に基づくスキル分類
- `flow_stack.slots[]` — flow 用スロット割当
- `resolved_invocations` — 完全解決済みスキルルーティング
- `runtime_guidance` — flow 実行時ヒント

### Validation Report

`validation-report.json` — 品質保証出力:

- Schema gate 結果
- Staleness gate 結果
- Deterministic gate 結果
- Blocking validation 結果
- `overall_result` — 総合 pass/fail

---

## Scan スコープ

プロトコルは 4 つの scan スコープをサポートする。既定では `project` のみ有効。

| スコープ | 既定 | 説明 |
| -------- | ---- | ---- |
| `project` | 有効 | ローカルプロジェクトのスキルディレクトリ |
| `user` | 無効 | ユーザーレベルの共有スキル |
| `organization` | 無効 | 組織全体のスキル |
| `builtin` | 無効 | エージェント組み込みスキル |

各スコープは `enabled`（boolean）と `roots`（パス文字列配列）を定義する。
`general-adapter` は全主要ハーネスの roots を集約する:

- `.apm/skills/`, `.agents/skills/`
- `.github/skills/`, `.github/agents/`
- `.cursor/rules/`, `.claude/commands/`
- `.gemini/skills/`, `.gemini/commands/`
- `.opencode/skills/`
- `apm_modules/`（インストール済みパッケージ）
- ルート指示ファイル（`AGENTS.md`, `CLAUDE.md`, `GEMINI.md` 等）

---

## Adapter による分類

分類はプロトコル本体の一部で**はない**。各 flow は adapter YAML の
`classification.taxonomy[]` で独自の taxonomy を定義する。プロトコルが提供するのは
メカニズムのみ:

- `taxonomy[]` — `match` ルール付きカテゴリの順序付きリスト
- `unmatched` — どのカテゴリにも一致しないスキルへの方針（`assign`/`warn`/`fail`/`ignore`）

この設計により、任意の flow がプロトコル本体を変更せずに独自の語彙を定義できる。

---

## コマンド

| コマンド | 目的 |
| -------- | ---- |
| `sdp generate --adapter <yaml>` | 全成果物の生成・更新 |
| `sdp validate --profile <json>` | ゲートに対する成果物検証 |
| `sdp query --profile <json> <sub>` | 成果物からの情報抽出 |

### `sdp generate`

入力: Adapter YAML パス（`--adapter` フラグ）。
出力: Skill Reference Catalog + Flow Profile + Validation Report。

### `sdp validate`

4 つの検証ゲートを実行:

1. **Schema** — 構造的正しさ
2. **Staleness** — `validated_at` 基準の鮮度
3. **Deterministic** — 再実行で同一出力
4. **Blocking** — invocation 解決の失敗

### `sdp query`

完全再生成なしにカタログ/プロファイルデータを抽出するサブコマンド群。

---

## 成果物一覧

| 成果物 | 形式 | 役割 |
| ------ | ---- | ---- |
| `skill-reference-catalog.json` | JSON | スキル能力カタログ（flow 非依存） |
| `skill-reference-catalog.md` | Markdown | 人間可読派生ビュー |
| `*-profile.json` | JSON | Flow Profile（flow 固有） |
| `*-profile.md` | Markdown | 人間可読派生ビュー |
| `validation-report.json` | JSON | 検証結果 |
| `validation-report.md` | Markdown | 人間可読派生ビュー |

---

## 参照

- [Protocol Contract](references/protocol-contract.ja.md) — 正式な契約仕様
- Adapter YAML スキーマ: flow 側 adapter references で定義
- 仕様詳細: `docs/specs/skills/skill-discovery-protocol/`
