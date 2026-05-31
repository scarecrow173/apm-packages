# Skill Discovery Protocol — CLI リファレンス

Version: 1.0.0

本文書は Skill Discovery Protocol の CLI コマンドを記述する。

Adapter YAML スキーマ、invocation 解決ルール、検証規約については
`schema-reference.ja.md` を参照。
運用上のルールと制約については `operation-policy.ja.md` を参照。

---

## 1. CLI コマンドリファレンス

### 1.1 `sdp generate`

```text
sdp generate --adapter <adapter-yaml>
```

adapter の `artifacts.protocol` セクションで定義された全成果物を生成する。

**出力ディレクトリ:** すべての成果物はプロジェクトルート直下の `.sdp/` ディレクトリに出力される。`artifacts.protocol` のパスは `.sdp/` からの相対パスとして解決される。

例: `skill_reference_catalog: "catalog.json"` → `.sdp/catalog.json`

### 1.2 `sdp validate`

```text
sdp validate --profile <flow-profile-json>
sdp validate --adapter <adapter-yaml>
```

- `--profile`: 生成済み成果物の完全 4 ゲート検証
- `--adapter`: Adapter YAML 設定のスキーマのみ検証

### 1.3 `sdp query`

```text
sdp query --profile <flow-profile-json> <subcommand> [options]
```

サブコマンド: `categories`、`category-skills`、`resolution`、`flow-stack`、
`execution-policy`、`capability-skills`、`skill-detail`、`runtime-guidance`、
`unresolved`、`validation-status`

