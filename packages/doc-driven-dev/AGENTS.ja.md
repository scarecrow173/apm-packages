# Package Agent Guide

この directory は配布用 `doc-driven-dev` APM package です。英語版と日本語版の
document は構造と意味を同期させてください。

## 公開 entrypoint

graph routing には `doc-driven-dev-graph` を使います。Graph Definition が
normative な実行 authority であり、phase label は概念上の mapping に限ります。
runtime contract は次の通りです。

`Graph Definition -> Graph State -> 宣言済み route 1つ -> delegate/audit ->
Markdown 証跡 -> 再投影`

package は 4 layer で構成します。

- **Execution Graph** — `.apm/skills/doc-driven-dev-graph/graphs/` の node、edge、
  condition、priority、delegate/audit binding。
- **Artifact Graph** — canonical Markdown の ID、type、status、relation。
- **Graph State** — focus、gate、signal、blocker、選択証跡を含む毎回の projection。
- **Dynamic Task Graph** — focus された task relation の決定的 projection。

## Condition と route 規則

汎用 condition DSL は `signal`、`gate`（`pass` / `not-pass`）、`task-graph`
（`runnable` / `invalid`）predicate をサポートします。未知の signal や壊れた
definition は fail closed です。eligible な outgoing edge は昇順の `priority`、
次に安定した edge ID で並べ、turn ごとに 1 edge だけ返します。caller は返された
audit をすべて実行し、delegate だけを dispatch して Markdown 証跡を記録し、
`next` から再入力します。

`focus-required` は明示的 focus が渡されるまで dispatch を停止します。terminal
route は idempotent です。blocked route は file 名、path の近さ、隣接 node から
推測しません。

## Delegate binding

Graph Definition は次の binding を宣言します。

- 任意の migration / bootstrap: `migrate_docs` / `scaffold_docs`。
- discovery / design: `briefing-flow` / `design-doc`。
- planning: `build_task_graph`（`build_task_graph.js` が実行）。
- implementation: `implementation-flow`。
- exit audit: `doc-status`。

delegate は自分の briefing / implementation subgraph を担当します。router で
delegate の処理を重複させたり、未宣言の遷移を追加したりしないでください。

## Task Graph invariant

Task document と canonical relation が authority です。全 predecessor が `done`
のときだけ runnable であり、`wont-do` は dependency を満たしません。重複 ID、
未解決参照、cycle、壊れた relation、空の選択は blocker と空の runnable task
になります。

## Persistence boundary

Markdown が durable な project history と status の authority です。Graph State と
Dynamic Task Graph は turn ごとの projection です。並行する runtime database や
mutable lifecycle store を追加しないでください。

## Skill と ownership

document 生成 skill（`idea-doc`、`deep-dive`、`briefing-flow`、`discovery-doc`、
`adr-doc`、`spec-doc`、`design-doc`、`plan-doc`、`task-doc`、`impl-doc`、
`doc-status`）が各 document contract を担当します。orchestration skill は
`doc-driven-dev-graph`、`implementation-flow`、`skill-discovery-protocol` です。

1 つの user request で active orchestration skill は 1 つだけにします。明示的な
implementation は `implementation-flow`、discovery / decision capture は
`briefing-flow`、graph-wide routing は `doc-driven-dev-graph` を使います。委譲は
明示的に行い、activation loop を作らないでください。

## Source と配布 asset

runtime TypeScript source は `scripts/doc-driven-dev/src/skills/` にあります。
配布 Markdown、graph YAML、reference、generated script は `.apm/skills/` に
あります。runtime 挙動を変更するときは source を先に編集し、package build で
JavaScript を再生成します。公開 contract を変更するときは distributed の
`SKILL.md`、reference、graph asset を直接更新します。

生成 JavaScript の整形だけを手編集しないでください。意図した runtime 変更では
source と配布 output を同期させます。

## 検証

repository root から実行します。

```bash
pnpm --dir scripts/doc-driven-dev test
pnpm --dir scripts/doc-driven-dev run lint:md
```

document 変更を提出する前に `scripts/doc-driven-dev/tests/doc-suite.test.ts` の
public residue / contract test を実行し、`git diff --check` も確認してください。
