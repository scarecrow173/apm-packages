# SDP Scan Infer Profile Docs 実装計画

> **エージェント作業者向け:** この計画を実装する時は、必ず `superpowers:subagent-driven-development`（推奨）または `superpowers:executing-plans` を使い、タスク単位で進めること。進捗管理にはチェックボックス（`- [ ]`）を使う。

**目的:** `skill-discovery-protocol` の文書群に、`sdp scan` -> エージェント推論 -> `sdp infer` -> `sdp profile` という分離済みフローを明文化する。特に、エージェントが scan 結果から各スキルの `provides` / `uses` を判断し、`infer` で反映する運用を `SKILL.md` 側にも定着させる。

**アーキテクチャ:** CLI はすでに `scan`、`infer`、`profile` に分割されているため、この計画では実装コードを変更しない。配布対象の skill 文書、protocol reference、spec docs、flow orchestrator 文書を更新し、`profile` が暗黙に scan/infer まで行うような読み方を排除する。生成済み JSON 成果物は触らない。

**技術スタック:** Markdown skill docs、SDP CLI docs、package markdown lint。

---

## スコープ確認

対象は `packages/doc-driven-dev-apm` の `skill-discovery-protocol` 文書と、それを呼び出す `implementation-flow` / `briefing-flow` 文書のみ。TypeScript CLI、生成済み JavaScript、adapter YAML、`.sdp` 配下の runtime artifact は変更しない。

## ファイル構成

- 変更: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/SKILL.md`
  - 英語の利用者向け skill contract。`scan -> infer -> profile` の明示フローとエージェント推論責務を追加する。
- 変更: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/SKILL.ja.md`
  - 日本語版。英語版と同じ運用モデルに揃える。
- 変更: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/protocol-contract.md`
  - 分離された公開コマンド contract と pre/post condition を明文化する。
- 変更: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/protocol-contract.ja.md`
  - 日本語版 contract。
- 変更: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/operation-policy.md`
  - 手動編集禁止の範囲と、inference を `sdp infer` で更新するルールを整理する。
- 変更: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/operation-policy.ja.md`
  - 日本語版 operation policy。
- 変更: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/cli-reference.md`
  - `sdp infer` を「初期化/編集」だけでなく、scan 結果を読んだエージェント推論の反映手段として説明する。
- 変更: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/cli-reference.ja.md`
  - 日本語版 CLI reference。
- 変更: `packages/doc-driven-dev-apm/docs/specs/skills/skill-discovery-protocol/overview.md`
  - spec overview を配布 skill docs と同じモデルに揃える。
- 変更: `packages/doc-driven-dev-apm/docs/specs/skills/skill-discovery-protocol/sdp-cli.md`
  - canonical operator recipe と inference 編集例を追加する。
- 変更: `packages/doc-driven-dev-apm/docs/specs/skills/skill-discovery-protocol/adapter-schema.md`
  - artifact 配置説明を、共有 artifact は `.sdp/` 直下、flow 固有 artifact は `.sdp/<adapter_id>/` に修正する。
- 変更: `packages/doc-driven-dev-apm/docs/specs/skills/skill-discovery-protocol/flow-profile.md`
  - adapter-scoped profile path に合わせて例と文言を更新する。
- 変更: `packages/doc-driven-dev-apm/.apm/skills/implementation-flow/SKILL.md`
  - 古い `.sdp/implementation-flow-profile.json` 参照を `.sdp/implementation-flow-default/implementation-flow-profile.json` に置き換える。
- 変更: `packages/doc-driven-dev-apm/.apm/skills/implementation-flow/SKILL.ja.md`
  - 日本語版。
- 変更: `packages/doc-driven-dev-apm/.apm/skills/briefing-flow/SKILL.md`
  - 古い `.sdp/briefing-profile.json` 参照を `.sdp/briefing-flow-default/briefing-profile.json` に置き換える。
- 変更: `packages/doc-driven-dev-apm/.apm/skills/briefing-flow/SKILL.ja.md`
  - 日本語版。

## 実装上の注意

- capability を提供するものは `provides` と呼ぶ。`providers` という別フィールドは使わない。
- `uses` は消費する capability を表す。依存先の既定候補が明確な場合のみ `default_skill` を含める。
- `.sdp/skill-reference-inferences.json` を手編集する案内はしない。`sdp infer init`、`sdp infer set-skill`、`sdp infer apply`、`sdp infer check` を使わせる。
- 文書と CLI の挙動がどうしても整合しないことが検証で判明しない限り、コード変更は追加しない。
- この計画では `.sdp/*.json` や `.sdp/*/*.json` を更新しない。

### Task 1: skill-discovery-protocol の SKILL.md に明示フローを追加する

**Files:**

- 変更: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/SKILL.md`
- 変更: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/SKILL.ja.md`

- [ ] **Step 1: 英語版の "The protocol uses three stages" ブロックを置き換える**

`SKILL.md` で以下の内容に置き換える。

```markdown
The protocol is operated as three explicit write phases plus validation/query:

1. `sdp scan`: writes `.sdp/skill-scan-list.json` with raw discovered skills and full `SKILL.md` bodies.
2. Agent inference: the agent reads the scan list and decides each skill's `provides`, `uses`, `execution_policy`, and `tags`.
3. `sdp infer`: initializes and applies those agent decisions to `.sdp/skill-reference-inferences.json`.
4. `sdp profile`: combines scan + inference into `.sdp/skill-reference-catalog.json` and an adapter-scoped flow profile.
5. `sdp validate` / `sdp query`: validates and reads generated artifacts.
```

- [ ] **Step 2: 英語版に "Agent Inference Responsibilities" セクションを追加する**

model section の直後に追加する。

````markdown
## Agent Inference Responsibilities

After `sdp scan`, inspect `.sdp/skill-scan-list.json`. For each scanned skill:

- infer `provides[]` from the capabilities the skill can perform directly;
- infer `uses[]` from capabilities the skill depends on or expects another skill to supply;
- infer `execution_policy` from strict ordering, verification, or tool-use requirements in the skill body;
- infer `tags[]` only as classification hints, not as flow-specific routing decisions.

Write these decisions through the `sdp infer` command family:

```text
sdp infer init --scan .sdp/skill-scan-list.json --out .sdp/skill-reference-inferences.json --if-exists merge
sdp infer set-skill --name <skill> --spec <skill-inference.json> --in .sdp/skill-reference-inferences.json --out .sdp/skill-reference-inferences.json
sdp infer check --in .sdp/skill-reference-inferences.json
```

Do not manually edit generated catalog, profile, report, or Markdown sidecar artifacts. The inference JSON is the agent-authored input, and it should still be modified through `sdp infer` so schema checks and stable sorting are preserved.
````

- [ ] **Step 3: 英語版の command table を置き換える**

```markdown
| Command | Purpose |
| ------- | ------- |
| `sdp scan --adapter <yaml>` | Generate the raw scan list |
| `sdp infer init --scan <json>` | Create the editable inference artifact from scan output |
| `sdp infer set-skill --name <skill> --spec <json>` | Upsert one agent-authored inference entry |
| `sdp infer apply --ops <jsonl>` | Apply multiple inference edits atomically |
| `sdp infer check --in <json>` | Validate inference schema before profiling |
| `sdp profile --adapter <yaml> [--references <json>]` | Generate catalog and adapter-scoped profile from existing scan + inference artifacts |
| `sdp validate --profile <json>` | Validate artifacts against gates |
| `sdp query --profile <json> <sub>` | Extract information from artifacts |
```

- [ ] **Step 4: 日本語版にも同じ責務を追加する**

`SKILL.ja.md` に以下の意味を含める。

```markdown
## エージェント推論の責務

`sdp scan` の後、`.sdp/skill-scan-list.json` を読む。各スキルについて:

- `provides[]`: そのスキルが直接提供できる capability
- `uses[]`: そのスキルが依存する、または他スキルに供給してほしい capability
- `execution_policy`: スキル本文に書かれた順序、検証、ツール利用上の制約
- `tags[]`: flow 固有ルーティングではなく分類補助のヒント

を判断する。判断結果は `sdp infer` 系コマンドで `.sdp/skill-reference-inferences.json` に反映する。
```

- [ ] **Step 5: 変更した skill docs の markdown lint を実行する**

`packages/doc-driven-dev-apm` で実行する。

```bash
pnpm exec markdownlint-cli2 ".apm/skills/skill-discovery-protocol/SKILL*.md"
```

期待結果: exit `0`。この Windows 環境で `pnpm` shim が `mise-shim` access error になる場合は、既存運用どおり bundled Node fallback で markdownlint を実行する。

- [ ] **Step 6: コミットする**

```bash
git add .apm/skills/skill-discovery-protocol/SKILL.md .apm/skills/skill-discovery-protocol/SKILL.ja.md
git commit -m "docs(sdp): clarify scan infer profile skill workflow"
```

### Task 2: protocol references に分離 contract を明文化する

**Files:**

- 変更: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/protocol-contract.md`
- 変更: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/protocol-contract.ja.md`
- 変更: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/operation-policy.md`
- 変更: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/operation-policy.ja.md`

- [ ] **Step 1: 英語版 contract に Public Command Contract を追加する**

`protocol-contract.md` の既存 canonical steps table の直前に追加する。

````markdown
## 1. Public Command Contract

The public workflow is:

```text
sdp scan -> agent inference -> sdp infer -> sdp profile -> sdp validate -> sdp query
```

The internal canonical steps below are implementation steps, not a license for
`sdp profile` to run scan or inference implicitly.
````

- [ ] **Step 2: Inference Contract の先頭段落を更新する**

`## 3. Inference Contract` の先頭を以下に置き換える。

```markdown
`skill-reference-inferences.json` is agent-authored data derived from
`skill-scan-list.json`. Agents decide `provides`, `uses`, `execution_policy`,
and `tags` by reading scanned `SKILL.md` bodies, then persist those decisions
through `sdp infer` subcommands.
```

- [ ] **Step 3: 日本語版 contract に同等の説明を追加する**

`protocol-contract.ja.md` に追加する。

````markdown
## 1. Public Command Contract

公開ワークフローは次の順序である。

```text
sdp scan -> エージェント推論 -> sdp infer -> sdp profile -> sdp validate -> sdp query
```

以下の canonical steps は内部実装手順であり、`sdp profile` が scan や inference を暗黙実行してよいという意味ではない。
````

- [ ] **Step 4: operation policy の responsibility table を更新する**

`operation-policy.md` の `sdp infer` 行を以下に置き換える。

```markdown
| `sdp infer` | Initialize, schema-check, and update agent-authored inference artifact | Write |
```

続けて追加する。

```markdown
### 2.4 Inference Editing Rule

Agents MUST use `sdp infer` subcommands for inference edits. The intended loop is:

1. `sdp infer init` creates or merges baseline entries from scan results.
2. The agent inspects scanned skill bodies and prepares per-skill inference specs or JSONL operations.
3. `sdp infer set-skill` or `sdp infer apply` records the decisions.
4. `sdp infer check` verifies the artifact before `sdp profile`.
```

- [ ] **Step 5: 日本語版 operation policy も同じ意味に更新する**

`operation-policy.ja.md` の既存 heading style を保って同等の内容を追加する。

- [ ] **Step 6: markdown lint を実行する**

`packages/doc-driven-dev-apm` で実行する。

```bash
pnpm exec markdownlint-cli2 ".apm/skills/skill-discovery-protocol/references/protocol-contract*.md" ".apm/skills/skill-discovery-protocol/references/operation-policy*.md"
```

期待結果: exit `0`。

- [ ] **Step 7: コミットする**

```bash
git add .apm/skills/skill-discovery-protocol/references/protocol-contract.md .apm/skills/skill-discovery-protocol/references/protocol-contract.ja.md .apm/skills/skill-discovery-protocol/references/operation-policy.md .apm/skills/skill-discovery-protocol/references/operation-policy.ja.md
git commit -m "docs(sdp): formalize inference editing contract"
```

### Task 3: CLI docs と spec docs を拡張する

**Files:**

- 変更: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/cli-reference.md`
- 変更: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/cli-reference.ja.md`
- 変更: `packages/doc-driven-dev-apm/docs/specs/skills/skill-discovery-protocol/overview.md`
- 変更: `packages/doc-driven-dev-apm/docs/specs/skills/skill-discovery-protocol/sdp-cli.md`
- 変更: `packages/doc-driven-dev-apm/docs/specs/skills/skill-discovery-protocol/adapter-schema.md`
- 変更: `packages/doc-driven-dev-apm/docs/specs/skills/skill-discovery-protocol/flow-profile.md`

- [ ] **Step 1: `cli-reference.md` に operator recipe を追加する**

冒頭の関連 reference 説明の後に追加する。

````markdown
## Operator Recipe

```text
sdp scan --adapter <adapter-yaml>
sdp infer init --scan .sdp/skill-scan-list.json --out .sdp/skill-reference-inferences.json --if-exists merge
sdp infer set-skill --name <skill> --spec <skill-inference.json> --in .sdp/skill-reference-inferences.json --out .sdp/skill-reference-inferences.json
sdp infer check --in .sdp/skill-reference-inferences.json
sdp profile --adapter <adapter-yaml>
sdp validate --profile .sdp/<adapter_id>/<flow-profile-json> --adapter <adapter-yaml>
```

`sdp profile` consumes existing scan and inference artifacts. It does not decide
capabilities by itself.
````

- [ ] **Step 2: `sdp infer` の説明を両言語で拡張する**

英語版の一文説明を以下に置き換える。

```markdown
Initializes, edits, and validates `skill-reference-inferences.json`. Agents use
this command family after reading scan output to record inferred `provides`,
`uses`, `execution_policy`, and `tags`.
```

`cli-reference.ja.md` には同じ意味の日本語を入れる。

- [ ] **Step 3: `overview.md` の canonical model を更新する**

`Canonical Steps` section の導入文を以下に置き換え、既存の内部 step diagram は残す。

```markdown
## 公開ワークフローと内部ステップ

公開ワークフローは `sdp scan`、エージェント推論、`sdp infer`、`sdp profile` に分かれる。
`sdp profile` は scan/inference 成果物を読むが、それらを暗黙生成しない。

内部実装の canonical steps は以下である。
```

- [ ] **Step 4: `sdp-cli.md` に inference 編集例を追加する**

`## sdp infer` の下に追加する。

````markdown
### 推論編集例

1スキル分を更新する場合:

```text
sdp infer set-skill --name test-driven-development --spec tmp/test-driven-development.inference.json --in .sdp/skill-reference-inferences.json --out .sdp/skill-reference-inferences.json
```

複数編集を JSONL で適用する場合:

```text
sdp infer apply --ops tmp/sdp-inference-ops.jsonl --in .sdp/skill-reference-inferences.json --out .sdp/skill-reference-inferences.json
```

`sdp profile` の前に必ず検証する:

```text
sdp infer check --in .sdp/skill-reference-inferences.json
```
````

- [ ] **Step 5: `adapter-schema.md` の artifact 配置説明を修正する**

`artifacts` の出力ベースディレクトリ説明を以下に置き換える。

```markdown
**出力ベースディレクトリ:**

- 共有 protocol artifact（`skill_reference_catalog`、scan、inference）は `.sdp/` 直下に配置する。
- flow 固有 artifact（`flow_profile`、`validation_report`）は `.sdp/<adapter_id>/` に配置する。
- `artifacts.protocol.flow_profile` と `artifacts.protocol.validation_report` は adapter ディレクトリからの相対ファイル名として解決する。
```

- [ ] **Step 6: `flow-profile.md` の path 説明を更新する**

file format bullets を以下に置き換える。

```markdown
- 正規: `.sdp/<adapter_id>/*-profile.json`（例: `.sdp/briefing-flow-default/briefing-profile.json`, `.sdp/implementation-flow-default/implementation-flow-profile.json`）
- 派生: `.sdp/<adapter_id>/*-profile.md`（人間レビュー用）
```

- [ ] **Step 7: spec と CLI reference の markdown lint を実行する**

`packages/doc-driven-dev-apm` で実行する。

```bash
pnpm exec markdownlint-cli2 ".apm/skills/skill-discovery-protocol/references/cli-reference*.md" "docs/specs/skills/skill-discovery-protocol/{overview,sdp-cli,adapter-schema,flow-profile}.md"
```

期待結果: exit `0`。

- [ ] **Step 8: コミットする**

```bash
git add .apm/skills/skill-discovery-protocol/references/cli-reference.md .apm/skills/skill-discovery-protocol/references/cli-reference.ja.md docs/specs/skills/skill-discovery-protocol/overview.md docs/specs/skills/skill-discovery-protocol/sdp-cli.md docs/specs/skills/skill-discovery-protocol/adapter-schema.md docs/specs/skills/skill-discovery-protocol/flow-profile.md
git commit -m "docs(sdp): document separated command workflow"
```

### Task 4: flow skills を adapter-scoped profile path に更新する

**Files:**

- 変更: `packages/doc-driven-dev-apm/.apm/skills/implementation-flow/SKILL.md`
- 変更: `packages/doc-driven-dev-apm/.apm/skills/implementation-flow/SKILL.ja.md`
- 変更: `packages/doc-driven-dev-apm/.apm/skills/briefing-flow/SKILL.md`
- 変更: `packages/doc-driven-dev-apm/.apm/skills/briefing-flow/SKILL.ja.md`

- [ ] **Step 1: implementation-flow の profile path を置換する**

英語版・日本語版の両方で以下を置換する。

```text
.sdp/implementation-flow-profile.json
```

置換後:

```text
.sdp/implementation-flow-default/implementation-flow-profile.json
```

- [ ] **Step 2: briefing-flow の profile path を置換する**

英語版・日本語版の両方で以下を置換する。

```text
.sdp/briefing-profile.json
```

置換後:

```text
.sdp/briefing-flow-default/briefing-profile.json
```

- [ ] **Step 3: 両 flow docs に infer inspection guidance を追加する**

既存の `sdp infer init` command list の後に英語版では以下を追加する。

```markdown
After `sdp infer init`, inspect `.sdp/skill-reference-inferences.json` against
the scan list. If `provides` or `uses` are incomplete for task routing, update
the inference artifact with `sdp infer set-skill` or `sdp infer apply`, then run
`sdp infer check` before `sdp profile`.
```

日本語版には以下の意味を追加する。

```markdown
`sdp infer init` の後、scan list と照合して `.sdp/skill-reference-inferences.json` を確認する。
タスクルーティングに必要な `provides` または `uses` が不足している場合は、`sdp infer set-skill` または `sdp infer apply` で inference 成果物を更新し、`sdp profile` の前に `sdp infer check` を実行する。
```

- [ ] **Step 4: validate/query examples が scoped profile path を使うことを確認する**

英語版 command block の期待形:

```text
sdp validate --profile .sdp/implementation-flow-default/implementation-flow-profile.json --adapter .apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml
sdp query --profile .sdp/implementation-flow-default/implementation-flow-profile.json <subcommand>
```

```text
sdp validate --profile .sdp/briefing-flow-default/briefing-profile.json --adapter .apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml
sdp query --profile .sdp/briefing-flow-default/briefing-profile.json <subcommand>
```

- [ ] **Step 5: 古い profile path が残っていないか検索する**

repo root で実行する。

```bash
rg -n "\.sdp/(implementation-flow-profile|briefing-profile)\.json" packages/doc-driven-dev-apm/.apm/skills/implementation-flow packages/doc-driven-dev-apm/.apm/skills/briefing-flow
```

期待結果: 出力なし。

- [ ] **Step 6: flow docs の markdown lint を実行する**

`packages/doc-driven-dev-apm` で実行する。

```bash
pnpm exec markdownlint-cli2 ".apm/skills/{implementation-flow,briefing-flow}/SKILL*.md"
```

期待結果: exit `0`。

- [ ] **Step 7: コミットする**

```bash
git add .apm/skills/implementation-flow/SKILL.md .apm/skills/implementation-flow/SKILL.ja.md .apm/skills/briefing-flow/SKILL.md .apm/skills/briefing-flow/SKILL.ja.md
git commit -m "docs(flows): use scoped sdp profile workflow"
```

### Task 5: 最終検証

**Files:**

- 検証のみ。想定される source modification はない。

- [ ] **Step 1: 古い opaque workflow 表現を検索する**

repo root で実行する。

```bash
rg -n "sdp profile.*run scan|profile.*scan/infer|implementation-flow-profile\.json|briefing-profile\.json" packages/doc-driven-dev-apm/.apm/skills packages/doc-driven-dev-apm/docs/specs/skills/skill-discovery-protocol
```

期待結果: 残る hit は historical migration docs、または `.sdp/<adapter_id>/...` の正しい例だけ。active docs では `profile` が scan/infer を暗黙実行するような説明を残さない。

- [ ] **Step 2: 変更対象 markdown lint を実行する**

`packages/doc-driven-dev-apm` で実行する。

```bash
pnpm run lint:md
```

期待結果: exit `0`。広範囲 lint が既存ノイズで失敗する場合は、Task 1-4 の targeted `markdownlint-cli2` が pass したことを記録する。

- [ ] **Step 3: APM package metadata を検証する**

repo root で実行する。

```bash
apm compile --validate
```

期待結果: exit `0`。package-local validation が `No instruction files found in .apm/ directory` を返す場合は、上記の repo root 実行結果を採用して記録する。

- [ ] **Step 4: runtime artifacts が変更されていないことを確認する**

repo root で実行する。

```bash
git status --short packages/doc-driven-dev-apm/.sdp
```

期待結果: 出力なし。

- [ ] **Step 5: 検証中に追加修正した場合のみコミットする**

追加の markdown 修正が必要だった場合のみ実行する。

```bash
git add packages/doc-driven-dev-apm/.apm/skills packages/doc-driven-dev-apm/docs/specs/skills/skill-discovery-protocol
git commit -m "docs(sdp): polish discovery protocol references"
```

## 自己レビュー

- 仕様カバレッジ: ユーザー要望である「CLI は分割済みだが、`SKILL.md` 側に scan 結果を読んで infer で埋めるフローが明文化されていない」問題を、配布 skill docs、reference、spec、flow docs の全体で扱っている。
- プレースホルダ確認: 禁止される未確定表現や、実装者に判断を丸投げする手順は含めていない。
- 用語整合性: `provides`、`uses`、`execution_policy`、`tags`、`skill-reference-inferences.json`、adapter-scoped `.sdp/<adapter_id>/<profile>` path を一貫して使っている。

計画は `docs/superpowers/plans/2026-06-02-sdp-scan-infer-profile-docs.md` に保存済み。

実行方法は次の2択。

**1. Subagent-Driven（推奨）** - タスクごとに fresh subagent を起動し、タスク間でレビューする。

**2. Inline Execution** - このセッションで `executing-plans` を使い、チェックポイントごとに実装する。

どちらで進めるかを選ぶ。
