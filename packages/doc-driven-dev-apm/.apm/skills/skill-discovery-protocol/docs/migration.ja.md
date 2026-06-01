# 移行ガイド: 旧プロトコル → Skill Discovery Protocol (SDP)

## 概要

Skill Discovery Protocol (SDP) は、各フロースキルに埋め込まれていた
フロー固有のインライン検出プロトコルを置き換えます。

| 側面 | 旧プロトコル | 新プロトコル (SDP) |
| ---- | ------------ | ------------------ |
| 配置 | 各フロー SKILL.md 内のインライン 7 ステップ | 共通 `skill-discovery-protocol` スキル |
| 出力形式 | Markdown (`.md`) | JSON (`.json`) |
| 操作 | 手動編集可 | スクリプト専用 (`sdp` CLI) |
| カテゴリ | フローごとにハードコード | アダプター YAML タクソノミー |
| バリデーション | 非公式チェック | 4 ゲートパイプライン (schema, staleness, deterministic, blocking) |

## 変更内容

### プロファイル形式

- `implementation-profile.md` → `implementation-profile.json` (`sdp scan` / `sdp infer` / `sdp profile` 経由)
- `briefing-profile.md` → `briefing-profile.json` (`sdp scan` / `sdp infer` / `sdp profile` 経由)

### ディスカバリー手順

- 各フロー内のインライン 7 ステッププロトコル → `sdp` CLI コマンド
- 手動プロファイル編集 → `sdp scan` / `sdp infer` / `sdp profile` によるスクリプト専用操作

### 分類

- SKILL.md にハードコードされたフロー固有カテゴリ → アダプター YAML タクソノミー
- 各フローが `general` を拡張する独自アダプターを定義

### 成果物

- 単一 `.md` ファイル → 3 つの JSON 成果物:
  - `<flow>-profile.json` — 分類済みスキル割り当て
  - `skill-reference-catalog.json` — 完全なスキルカタログ
  - `validation-report.json` — ゲート結果

## 新規スキルでの共通プロトコル採用手順

新しいフロースキルに SDP を統合するには、以下の手順に従います:

### ステップ 1: アダプター YAML を作成

フロー固有のアダプターを `<skill>/references/<name>-adapter.yaml` に配置します。

### ステップ 2: `general` を拡張

アダプターは `extends: ["general"]` を含める必要があります。
これによりスキャンルートと基本設定を継承します。

### ステップ 3: 分類タクソノミーを定義

`classification.taxonomy` エントリにフローのカテゴリを追加します。
各エントリには `id`, `label`, `description`, `match` ルールが必要です。

### ステップ 4: フロースタックスロットを定義

`flow_stack.slots` にフローのデフォルトスキル割り当てを設定します。
各スロットには `id`, `label`, `required`, `default_skill` を指定します。

### ステップ 5: 成果物を生成

```bash
sdp scan --adapter <adapter-yaml>
sdp infer init --scan .sdp/skill-scan-list.json
sdp profile --adapter <adapter-yaml>
```

プロファイル、カタログ、バリデーションレポートが生成されます。

### ステップ 6: SKILL.md で `sdp query` を参照

フローの SKILL.md で `sdp query` コマンドを使用して実行時にプロファイルデータに
アクセスします:

```bash
sdp query --profile <profile-json> flow-stack
sdp query --profile <profile-json> resolution
sdp query --profile <profile-json> execution-policy
```

### ステップ 7: バリデーションを設定

```bash
sdp validate --profile <profile-json>
sdp validate --adapter <adapter-yaml>
```

生成後および定期的にバリデーションを実行して陳腐化を検出します。

## コマンドリファレンス

| コマンド | 目的 |
| -------- | ---- |
| `sdp scan --adapter <yaml>` | スキャンリストの生成 |
| `sdp infer init --scan <json>` | 推論データの作成/更新 |
| `sdp profile --adapter <yaml>` | プロファイル、カタログ、レポートの生成/更新 |
| `sdp validate --profile <json>` | 成果物のバリデーション (4 ゲート) |
| `sdp validate --adapter <yaml>` | アダプター YAML 構造のバリデーション |
| `sdp query --profile <json> <subcommand>` | プロファイルからの情報抽出 |

### Query サブコマンド

- `categories` — 全分類カテゴリの一覧
- `category-skills` — 特定カテゴリのスキル一覧
- `flow-stack` — フロースタックスロット割り当ての表示
- `resolution` — 呼び出し解決チェーンの表示
- `execution-policy` — 実行ポリシーの表示
- `capability-skills` — ケイパビリティによるスキル検索
- `skill-detail` — 特定スキルの詳細表示
- `runtime-guidance` — スキルの実行時ガイダンス表示
- `unresolved` — 未解決の呼び出し一覧
- `validation-status` — 最終バリデーション状況の表示

## アダプターテンプレート（最小構成）

新しいフローアダプター作成時にこのテンプレートを使用します:

```yaml
schema_version: "1.0"
adapter_id: "<your-flow>-default"
extends:
  - "general"
protocol:
  name: "skill-discovery-protocol"
  min_version: "1.0"
profile:
  title: "<Your Flow> Profile"
flow_stack:
  slots: []
classification:
  unmatched:
    action: "assign"
    category: "uncategorized"
    severity: "warn"
  taxonomy:
    - id: "uncategorized"
      label: "Uncategorized"
      description: "Fallback"
      match:
        capabilities: []
        tags: []
        description_patterns: []
invocation_resolution:
  overrides:
    slots: {}
    capabilities: {}
  resolution_order:
    - "slot_override"
    - "capability_override"
    - "default_skill"
    - "provider_lookup"
  unresolved:
    required: "warn"
    optional: "warn"
  invalid_override:
    unknown_skill: "warn"
    capability_mismatch: "warn"
    override_not_allowed: "warn"
validation:
  schema: true
  staleness:
    enabled: true
    basis: "validated_at"
    max_age_days: 30
  deterministic:
    enabled: true
    compare:
      - "profile"
      - "profile+catalog-artifacts"
      - "validation-report:exclude-timestamp"
  invocation:
    enabled: true
render:
  stable_sort:
    skills: ["name"]
    invocations: ["source_skill", "slot", "capability"]
  normalize_whitespace: true
  newline: "lf"
artifacts:
  protocol:
    catalog: "skill-reference-catalog.json"
    profile: "<your-flow>-profile.json"
    report: "validation-report.json"
readable_outputs:
  enabled: true
  include:
    catalog: true
    profile: true
```

## Query サブコマンドの拡張

新しい query サブコマンドを追加するには:

1. `src/skills/skill-discovery-protocol/scripts/lib/query/<name>.ts` を作成
2. `QueryHandler` インターフェースを実装するハンドラーをエクスポート
3. `query.ts` でインポートし登録
4. `tests/skills/skill-discovery-protocol/query-regression.test.ts` にテストを追加

### ハンドラーテンプレート

```typescript
import { QueryHandler } from "./registry.js";

export const handler: QueryHandler = {
  name: "<subcommand-name>",
  description: "<what it does>",
  usage: "sdp query --profile <json> <subcommand-name> [args...]",
  execute(profile, catalog, report, args) {
    // 実装
    return { /* 結果オブジェクト */ };
  },
};
```

## 非推奨タイムライン

| フェーズ | 状況 | 説明 |
| -------- | ---- | ---- |
| 即時 | **有効** | 旧 `.md` プロファイルスキーマを非推奨として明記 |
| 移行期 | 計画中 | 旧形式と新形式が共存 |
| 削除 | 将来 | 旧 `.md` スキーマ文書を削除 |

旧プロファイルスキーマ文書は参照用としてのみ保持されます。
すべての新規作業は SDP の JSON ベースアプローチを使用する必要があります。
