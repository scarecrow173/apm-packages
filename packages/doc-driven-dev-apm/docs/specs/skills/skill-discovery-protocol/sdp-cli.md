# sdp CLI 仕様

## 概要

`sdp` は skill-discovery-protocol の成果物を生成・検証・照会する CLI である。

## コマンド体系

```text
sdp generate --adapter <adapter-yaml> [--references <json>] [--cwd <dir>]
sdp infer [--scan <json>] [--out <json>] [--cwd <dir>]
sdp validate --profile <flow-profile-json>
sdp query --profile <flow-profile-json> <subcommand> [options]
```

## `sdp generate`

成果物の生成・更新を行う。

```text
sdp generate --adapter <adapter-yaml> [--references <json>]
```

### 動作

1. adapter YAML を読み込む（`extends` 解決を含む）
2. `scan.scopes` に基づいてスキルを走査する
3. 見つかった各スキルの `SKILL.md` 全文を読み、`.sdp/skill-scan-list.json` に保存する
4. `--references` または `.sdp/skill-reference-inferences.json` から inference 成果物を読む
5. scan 成果物と inference 成果物を結合して Skill Reference Catalog を構築する
6. classification を実行する
7. invocation を解決する
8. Flow Profile を生成する
9. validation-report を生成する
10. `readable_outputs.enabled = true` の場合、Markdown sidecar を生成する

### 入力

- `--adapter <adapter-yaml>`: 必須。adapter YAML のパス。
- `--references <json>`: 任意。agent inference 成果物のパス。未指定時は `.sdp/skill-reference-inferences.json` を読む。
- `--cwd <dir>`: 任意。基準ディレクトリ。

### 出力

- `.sdp/skill-scan-list.json`
- `.sdp/skill-reference-catalog.json`
- `.sdp/*-profile.json`
- `.sdp/validation-report.json`
- 設定に応じた Markdown sidecar

inference 成果物が存在しない場合、`sdp generate` は scan list を保存したうえで終了コード `2` を返す。エージェントは `skill-scan-list.json` の各 `body` を読み、`skill-reference-inferences.json` を作成してから再実行する。

### 終了コード

- `0`: 正常完了
- `1`: 入力エラー
- `2`: schema 検証エラー、または inference 成果物不足

## `sdp infer`

scan 成果物から inference 成果物を生成する。

```text
sdp infer [--scan <json>] [--out <json>] [--cwd <dir>]
```

### 動作

1. `--scan` または既定の scan 成果物を読み込む
2. inference ドキュメントを構築する
3. schema 検証を実施する
4. `--out` または既定の出力先へ書き込む

### 入力

- `--scan <json>`: 任意。scan 成果物のパス。
	未指定時の既定値は `.sdp/skill-scan-list.json`。
- `--out <json>`: 任意。inference 成果物の出力パス。
	未指定時の既定値は `.sdp/skill-reference-inferences.json`。
- `--cwd <dir>`: 任意。基準ディレクトリ。

### 出力

- `.sdp/skill-reference-inferences.json`（既定）

### 終了コード

- `0`: 正常完了
- `1`: 生成後の schema 検証失敗
- `2`: 入力エラー（引数不正、scan 未存在、scan 不正）

## `sdp validate`

成果物または adapter YAML の検証を行う。

### Profile 検証

```text
sdp validate --profile <flow-profile-json>
```

### 動作

1. Flow Profile JSON を読み込む
2. Schema gate を実行する
3. Staleness gate を実行する
4. Deterministic gate を実行する
5. Blocking validations を実行する
6. Catalog 整合性を検証する
7. validation-report.json を出力する

Deterministic gate は再生成時に scan list と inference 成果物を使う。既定では `.sdp/skill-reference-inferences.json` が必要である。

### Adapter 単体検証

```text
sdp validate --adapter <adapter-yaml>
```

adapter YAML の構造、`extends`、`scan.scopes`、classification、`snake_case` 制約を検証する。

### 終了コード

- `0`: `overall_result = pass`、または adapter 検証成功
- `1`: `overall_result = fail`、または adapter 検証失敗
- `2`: 入力エラー

## `sdp query`

Flow Profile から情報を抽出する。

```text
sdp query --profile <flow-profile-json> <subcommand> [options]
```

### サブコマンド

| Subcommand | Description | Options |
| --- | --- | --- |
| `categories` | カテゴリ一覧 | - |
| `category-skills` | カテゴリ内スキル一覧 | `--category <id>` |
| `resolution` | 解決関係一覧 | `--skill <name>` (optional) |
| `flow-stack` | Flow Stack 定義 | `--slot <id>` (optional) |
| `execution-policy` | 実行ポリシー | `--skill <name>` (optional) |
| `capability-skills` | capability 逆引き | `--capability <id>` |
| `skill-detail` | スキル詳細 | `--skill <name>` |
| `runtime-guidance` | 実行時ガイダンス | `--skill <name>` (optional) |
| `unresolved` | 未解決一覧 | - |
| `validation-status` | 検証状態要約 | - |
