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

1. `sdp scan`: scan で見つかった各 `SKILL.md` の全文を `.sdp/skill-scan-list.json` に保存する。
2. エージェント推論: agent が scan list を読み、各 skill の `provides`, `uses`, `execution_policy`, `tags` を判断する。
3. `sdp infer`: agent の判断を `.sdp/skill-reference-inferences.json` に初期化・反映する。
4. `sdp profile`: scan と inference を結合し、`.sdp/skill-reference-catalog.json` と adapter-scoped flow profile を生成する。
5. `sdp validate` / `sdp query`: 生成成果物を検証・照会する。

## エージェント推論の責務

`sdp scan` の後、`.sdp/skill-scan-list.json` を読む。各スキルについて:

- `provides[]`: そのスキルが直接提供できる capability
- `uses[]`: そのスキルが依存する、または他スキルに供給してほしい capability
- `execution_policy`: スキル本文に書かれた順序、検証、ツール利用上の制約
- `tags[]`: flow 固有ルーティングではなく分類補助のヒント

を判断する。判断結果は `sdp infer` 系コマンドで
`.sdp/skill-reference-inferences.json` に反映する。

```text
sdp infer init --scan .sdp/skill-scan-list.json --out .sdp/skill-reference-inferences.json --if-exists merge
sdp infer set-skill --name <skill> --spec <skill-inference.json> --in .sdp/skill-reference-inferences.json --out .sdp/skill-reference-inferences.json
sdp infer check --in .sdp/skill-reference-inferences.json
```

生成された catalog、profile、report、Markdown sidecar は手編集しない。
inference JSON は agent-authored input だが、schema check と stable sort を
維持するため `sdp infer` 経由で更新する。

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
| `sdp infer init --scan <json>` | scan 出力から編集可能な inference 成果物を作る |
| `sdp infer set-skill --name <skill> --spec <json>` | 1 skill 分の agent-authored inference を upsert する |
| `sdp infer apply --ops <jsonl>` | 複数の inference 編集を atomic に適用する |
| `sdp infer check --in <json>` | profile 生成前に inference schema を検証する |
| `sdp profile --adapter <yaml> [--references <json>]` | 既存の scan/inference から catalog と adapter-scoped profile を生成する |
| `sdp validate --profile <json>` | 成果物を検証する |
| `sdp query --profile <json> <sub>` | 成果物を照会する |

scan 成果物がない場合は `sdp scan` を実行する。inference 成果物がない
場合は `sdp infer init --scan .sdp/skill-scan-list.json` を実行する。
その後に `sdp profile` を再実行する。
