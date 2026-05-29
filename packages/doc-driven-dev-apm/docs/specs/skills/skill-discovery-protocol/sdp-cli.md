# sdp CLI 仕様

## 概要

`sdp` は skill-discovery-protocol の成果物を操作するコマンドラインインターフェースである。
責務ごとに 3 つのサブコマンドに分離される。

## コマンド体系

```
sdp generate --adapter <adapter-yaml>
sdp validate --profile <flow-profile-json>
sdp query --profile <flow-profile-json> <subcommand> [options]
```

## `sdp generate`

成果物の生成・更新を行う。

```
sdp generate --adapter <adapter-yaml>
```

**動作:**

1. adapter YAML を読み込み（`extends` 解決含む）
2. `scan.scopes` に基づいてスキルを走査
3. Skill Reference Catalog を構築
4. classification を実行
5. invocation を解決
6. Flow Profile を生成
7. validation-report を生成
8. `readable_outputs.enabled = true` の場合、Markdown を派生生成

**出力:**

- `artifacts.protocol` で指定されたパスに JSON を出力
- `readable_outputs` 設定に応じて Markdown を出力

**冪等性:**

- 同一入力で再実行した場合、ファイル内容に差分が発生しないことを保証
- 安定ソートと固定レンダリングにより実現

**終了コード:**

- `0`: 正常完了
- `1`: 入力エラー（adapter が見つからない、パースエラー等）
- `2`: schema 検証エラー（adapter の必須キー欠落等）

---

## `sdp validate`

成果物または adapter YAML の検証を行う。

### Profile 検証

```
sdp validate --profile <flow-profile-json>
```

**動作:**

1. Flow Profile JSON を読み込み
2. Schema gate を実行
3. Staleness gate を実行
4. Deterministic gate を実行（再生成して比較）
5. Blocking validations を実行
6. Catalog 整合性検証を実行
7. validation-report.json を出力

### Adapter 単体検証

```
sdp validate --adapter <adapter-yaml>
```

**動作:**

1. adapter YAML を読み込み（`extends` 解決含む）
2. 必須キー存在・型・制約を検証
3. `extends` 循環参照検出
4. マージ後の `scan.scopes` 整合性検証
5. `classification` 矛盾検出
6. `snake_case` 強制検証
7. 結果を標準出力に表示

**用途:** adapter を本番投入する前に単体で正当性を確認する。

### 終了コード

- `0`: `overall_result = pass`（または adapter 検証成功）
- `1`: `overall_result = fail`（または adapter 検証失敗）
- `2`: 入力エラー

---

## `sdp query`

Flow Profile から情報を抽出する。

```
sdp query --profile <flow-profile-json> <subcommand> [options]
```

**入力:** 常に `*-profile.json`（Markdown は正規入力として扱わない）

### サブコマンド一覧

以下は現時点の最小提案セット。将来要件で拡張可能。

| Subcommand | Description | Options |
| --- | --- | --- |
| `categories` | カテゴリ一覧 | — |
| `category-skills` | カテゴリ内スキル一覧 | `--category <id>` |
| `resolution` | 解決関係一覧 | `--skill <name>` (optional) |
| `flow-stack` | Flow Stack 定義 | `--slot <id>` (optional) |
| `execution-policy` | 実行ポリシー | `--skill <name>` (optional) |
| `capability-skills` | capability 逆引き | `--capability <id>` |
| `skill-detail` | スキル詳細 | `--skill <name>` |
| `runtime-guidance` | 実行時ガイダンス | `--skill <name>` (optional) |
| `unresolved` | 未解決一覧 | — |
| `validation-status` | 検証状態要約 | — |

### サブコマンド詳細

#### `categories`

カテゴリ一覧を出力する。

```
sdp query --profile tasks/briefing-profile.json categories
```

出力例:

```json
[
  { "id": "architecture", "label": "Architecture", "skill_count": 3 },
  { "id": "quality", "label": "Quality", "skill_count": 2 }
]
```

#### `category-skills --category <id>`

指定カテゴリに属するスキルを出力する。

```
sdp query --profile tasks/briefing-profile.json category-skills --category architecture
```

#### `resolution [--skill <name>]`

解決関係を出力する。`--skill` で特定スキルにフィルタ可能。

```
sdp query --profile tasks/briefing-profile.json resolution --skill documentation-and-adrs
```

#### `flow-stack [--slot <id>]`

Flow Stack 定義を出力する。`--slot` で特定スロットにフィルタ可能。

```
sdp query --profile tasks/briefing-profile.json flow-stack --slot adr_authoring
```

#### `execution-policy [--skill <name>]`

実行ポリシーを出力する。`--skill` で特定スキルにフィルタ可能。

```
sdp query --profile tasks/briefing-profile.json execution-policy --skill documentation-and-adrs
```

#### `unresolved`

未解決の slot/capability を一覧する。

#### `validation-status`

schema/staleness/deterministic/overall の検証状態要約を出力する。

### エラーハンドリング

- 未知サブコマンド: 非 0 終了 + 利用可能なサブコマンド一覧を表示
- `--profile` 未指定: 非 0 終了 + usage を表示
- profile JSON パースエラー: 非 0 終了 + エラー詳細を表示

### 終了コード

- `0`: 正常（結果あり）
- `0`: 正常（結果なし — 該当データがない場合は空配列を返す）
- `1`: 入力エラー
- `2`: 未知サブコマンド

## 実装アーキテクチャ

サブコマンドはレジストリ駆動で実装する:

```typescript
// registry pattern
const handlers: Record<string, QueryHandler> = {
  "categories": categoriesHandler,
  "category-skills": categorySkillsHandler,
  "resolution": resolutionHandler,
  "flow-stack": flowStackHandler,
  "execution-policy": executionPolicyHandler,
  // ...
};
```

**拡張規約:** 新規サブコマンド追加は 1 handler ファイル追加 + レジストリ登録のみで完了する。
