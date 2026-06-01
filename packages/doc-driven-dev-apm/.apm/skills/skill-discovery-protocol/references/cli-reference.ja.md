# Skill Discovery Protocol — CLI リファレンス

Version: 1.0.0

本文書は Skill Discovery Protocol の CLI コマンドを記述する。

Adapter YAML スキーマ、invocation 解決ルール、検証規約については
`schema-reference.ja.md` を参照。
運用上のルールと制約については `operation-policy.ja.md` を参照。

---

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
sdp infer check --in <json> [--cwd <dir>]
sdp infer set-skill --name <skill> --spec <json> --in <json> [--out <json>] [--cwd <dir>] [--dry-run]
sdp infer delete-skill --name <skill> --in <json> [--out <json>] [--cwd <dir>] [--dry-run]
```

`skill-reference-inferences.json` の初期化・編集を行う。

### 1.3 `sdp profile`

```text
sdp profile --adapter <adapter-yaml> [--references <json>] [--cwd <dir>]
```

既存の scan 成果物と inference 成果物を読み込み、以下を生成する。

- 共有 catalog: `.sdp/skill-reference-catalog.json`
- flow profile: `.sdp/<adapter_id>/<flow_profile>`

`sdp profile` は scan / infer を実行しない。事前に `sdp scan` → `sdp infer init` を実行する。

### 1.4 `sdp validate`

```text
sdp validate --profile <flow-profile-json>
sdp validate --adapter <adapter-yaml>
```

- `--profile`: 生成済み成果物の完全 4 ゲート検証
- `--adapter`: Adapter YAML 設定のスキーマのみ検証

### 1.5 `sdp query`

```text
sdp query --profile <flow-profile-json> <subcommand> [options]
```

サブコマンド: `categories`、`category-skills`、`resolution`、`flow-stack`、
`execution-policy`、`capability-skills`、`skill-detail`、`runtime-guidance`、
`unresolved`、`validation-status`

