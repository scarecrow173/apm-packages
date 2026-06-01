---
name: skill-discovery-protocol
description: "インストール済みスキルを走査し、SKILL.md 全文から推論された skill reference を使って capability catalog、flow profile、検証成果物を生成する flow 非依存メタスキル。Keywords: sdp, discovery, catalog, profile, validation, adapter."
version: "1.0.0"
license: MIT
---

# Skill Discovery Protocol

外部からインストールされたスキルを対象に、標準的な `SKILL.md` を走査し、
エージェント推論で capability 情報を補完して、flow 非依存の catalog と
flow 固有 profile を生成するメタスキル。

## 重要な前提

`SKILL.md` に `provides` / `uses` / `tags` / `execution_policy` のような
独自メタデータがあることを期待しない。scan は見つかった各 `SKILL.md`
の全文を保存し、エージェントがそれを読んで推論成果物を作る。

## 成果物フロー

1. `skill-scan-list.json`: scan で見つかった各 `SKILL.md` の全文。
2. `skill-reference-inferences.json`: エージェントが推論した capability 情報。
3. `skill-reference-catalog.json`: scan と inference を結合した正規 catalog。
4. `*-profile.json`: adapter に基づく flow 固有 profile。
5. `validation-report.json`: schema / staleness / deterministic / blocking の結果。

## Canonical Steps

```text
load_adapter -> scan_skills -> write_scan_list
-> read_skill_reference_inferences -> build_skill_reference_catalog
-> classify_skills -> resolve_invocations -> build_flow_profile
-> render_outputs -> validate_outputs
```

## Catalog と Flow Profile の分離

Catalog は flow 非依存で、各 skill の `provides`, `uses`,
`execution_policy`, `tags` を保持する。

Catalog は `slots`, `slot_count`, `resolved_invocations`, flow 固有分類を
持ってはならない。invocation slot は Flow Profile の `flow_stack.slots[]`
が保持する。

## コマンド

| Command | Purpose |
| ------- | ------- |
| `sdp scan --adapter <yaml>` | scan list を生成する |
| `sdp infer init --scan <json>` | inference 成果物を生成/編集する |
| `sdp profile --adapter <yaml> [--references <json>]` | catalog と profile を生成する |
| `sdp validate --profile <json>` | 成果物を検証する |
| `sdp query --profile <json> <sub>` | 成果物を照会する |

scan 成果物がない場合は `sdp scan` を実行する。inference 成果物がない
場合は `sdp infer init --scan .sdp/skill-scan-list.json` を実行する。
その後に `sdp profile` を再実行する。
