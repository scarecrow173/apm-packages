# Skill Discovery Protocol — CLI リファレンス

Version: 1.0.0

本文書は Skill Discovery Protocol の CLI コマンドを記述する。

Adapter YAML スキーマ、invocation 解決ルール、検証規約については
`schema-reference.ja.md` を参照。
運用上のルールと制約については `operation-policy.ja.md` を参照。

---

## Operator Recipe

> **注記:** `sdp` はグローバルにインストールされたバイナリではない。runtime manager 経由で呼び出す:
>
> ```powershell
> # 例: mise (推奨)
> mise exec -- node <skill-root>/skill-discovery-protocol/scripts/sdp.js <subcommand>
> ```
>
> `<skill-root>` は インストール済みスキルを含むディレクトリ
> （例: `.agents/skills/`、`.apm/skills/`、`.claude/skills/` など）。
> 以下の例では `sdp` は上記の完全な呼び出しの省略形として使われている。

```text
sdp scan --adapter <adapter-yaml>
sdp infer init --scan .sdp/skill-scan-list.json --out .sdp/skill-reference-inferences.json --if-exists merge
sdp infer set-skill --name <skill> --spec <skill-inference.json> --in .sdp/skill-reference-inferences.json --out .sdp/skill-reference-inferences.json
sdp infer check --scan .sdp/skill-scan-list.json --in .sdp/skill-reference-inferences.json
sdp profile --adapter <adapter-yaml>
sdp validate --profile .sdp/<adapter_id>/<flow-profile-json> --adapter <adapter-yaml>
```

`sdp profile` は既存の scan 成果物と inference 成果物を消費する。
capability を自分では判断しない。

## 1. CLI コマンドリファレンス

### 1.1 `sdp scan`

```text
sdp scan --adapter <adapter-yaml> [--cwd <dir>]
```

adapter の `scan.scopes` に従ってスキルを走査し、`.sdp/skill-scan-list.json` を生成する。

### 1.2 `sdp infer`

```text
sdp infer init [--scan <json>] [--out <json>] [--cwd <dir>] [--if-exists <fail|overwrite|merge>]
sdp infer apply --ops <jsonl> --in <json> [--out <json>] [--cwd <dir>] [--dry-run]
sdp infer check [--scan <json>] --in <json> [--cwd <dir>]
sdp infer set-skill --name <skill> --spec <json> --in <json> [--out <json>] [--cwd <dir>] [--dry-run]
sdp infer delete-skill --name <skill> --in <json> [--out <json>] [--cwd <dir>] [--dry-run]
```

`skill-reference-inferences.json` を初期化・編集・検証する。agent は
scan output を読んだ後、この command family で推論した `provides`、
`uses`、`execution_policy`、`tags` に加えて `review_status` を記録する。

### 1.3 `sdp profile`

```text
sdp profile --adapter <adapter-yaml> [--references <json>] [--cwd <dir>]
```

既存の scan 成果物と inference 成果物を読み込み、以下を生成する。

- 共有 catalog: `.sdp/skill-reference-catalog.json`
- flow profile: `.sdp/<adapter_id>/<flow_profile>`

`sdp profile` は scan / infer を実行しない。事前に `sdp scan` を実行し、
inference を review したうえで `sdp infer check` を通してから profile 化する。

### 1.4 `sdp validate`

```text
sdp validate --profile <flow-profile-json> --adapter <adapter-yaml>
sdp validate --profile <flow-profile-json>
sdp validate --adapter <adapter-yaml>
```

- `--profile --adapter` (両方): 完全 4 ゲート検証（Schema、Staleness、Deterministic、Blocking）
- `--profile` のみ: Schema と Staleness ゲートが実行；Deterministic と Blocking ゲートは **スキップ**
- `--adapter` のみ: Adapter YAML 設定のスキーマのみ検証

### 1.5 `sdp query`

```text
sdp query --profile <flow-profile-json> <subcommand> [options]
```

サブコマンド: `categories`、`category-skills`、`resolution`、`flow-stack`、
`execution-policy`、`capability-skills`、`skill-detail`、`runtime-guidance`、
`unresolved`、`validation-status`

---

## Windows PowerShell 注記

PowerShell から `sdp infer set-skill` 用の JSON を生成する際、2つの落とし穴がある。

### BOM 付き UTF-8

PowerShell の `Out-File -Encoding utf8` は UTF-8 with BOM を出力する。Node.js の `JSON.parse` は BOM 付き JSON を読めず、以下をスローする:

```
Unexpected token '﻿', "﻿{..." is not valid JSON
```

BOM なしで書き込むには `System.Text.UTF8Encoding($false)` を使う:

```powershell
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tempFile, $json, $utf8NoBom)
```

### 単一要素配列の object へのシリアライズ

`ConvertTo-Json` は単一要素配列を bare object に展開することがある:

```powershell
# 出力: {"capability":"problem_framing"}  ← 配列ではない
@(@{capability="problem_framing"}) | ConvertTo-Json
```

JSON を文字列として直接組み立てる:

```powershell
$prov = '[{"capability":"problem_framing"}]'
$json = "{`"review_status`":`"reviewed`",`"provides`":$prov,...}"
```
