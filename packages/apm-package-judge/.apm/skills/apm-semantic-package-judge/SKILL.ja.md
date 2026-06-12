---
name: apm-semantic-package-judge
description: APM package または Claude-plugin-like bundle 全体の semantic quality evaluation
  の entry-point orchestrator。package components を inventory し、dependency/provenance/interaction/capability
  graphs を構築し、skills、agents、prompts、instructions、MCP、hooks を specialist reviewer subagents
  へ dispatch し、reports を収集して overall verdict を synthesis する。APM package の evaluate、judge、review、semantic
  audit、improve、certify、compare、approve を求められたときに使う。apm.yml、.apm package、agent package、package-level
  quality、component judge、dependency graph、semantic package review に反応する。apm audit
  や mechanical integrity checks は実行しない。
license: MIT

---

# APM Semantic Package Judge 日本語版

APM package 全体を評価する entrypoint skill。component specialist reviews と dependency-graph-aware package synthesis を組み合わせる。

Mechanical audit checks は行わない。`apm audit --ci` に依存しない。この skill が評価するのは semantic quality、つまりこの package を読んだ agent が正しく、安全に、有用に、不要 context cost なしで振る舞えるかである。

## Trigger contract（発火契約）

次の場合にこの entrypoint を使う:

- APM package を評価する。
- package-level semantic quality をレビューする。
- agent package を採用してよいか判断する。
- skills、agents、prompts、instructions、MCP、hooks、commands、plugins を含む package を改善する。
- APM package の 2 version を意味論的に比較する。
- modular judge workflow を実行する。
- component reviewers から package-level report を作る。

単一 isolated `SKILL.md` のレビューには使わない。package-level review を明示された場合を除き、specialist component judge を使う。

## Calibration reference（キャリブレーション参照）

dispatch の前に `../../../references/judge-calibration-guide.ja.md` と `../../../references/dispatch-matrix.ja.md` を読む。calibration guide は component reports の粒度を揃えるため、dispatch matrix は正しい reviewer を選ぶために使う。

## Inputs（入力）

受け取れる evidence:

- package root
- `apm.yml` excerpt
- `apm.lock.yaml` excerpt。ただし dependency/provenance/depth evidence としてだけ扱う
- directory tree
- package files
- `.apm/skills`、`.apm/prompts`、`.apm/instructions`、`.apm/agents`、hooks、commands、MCP declarations
- `apm_modules/` excerpts または dependency package trees
- Claude-plugin-like bundle
- prior component reports
- prior dependency graph report

files がない場合は、提供された evidence のみで評価し、unknowns を明記する。

## Orchestration model（オーケストレーションモデル）

subagents が使える環境では specialist reviewers を使う。main agent は dispatch と final synthesis に責任を持つ。

| Artifact | Reviewer subagent | Required skill |
|---|---|---|
| Dependency/provenance/interaction/capability graph | `apm-dependency-graph-reviewer` | `apm-dependency-graph-builder`, `apm-dependency-graph-judge` |
| Skill / `SKILL.md` | `apm-skill-reviewer` | `apm-skill-component-judge` |
| Custom agent / subagent | `apm-agent-reviewer` | `apm-agent-component-judge` |
| Prompt / slash command prompt | `apm-prompt-reviewer` | `apm-prompt-component-judge` |
| Instruction / rules file | `apm-instruction-reviewer` | `apm-instruction-component-judge` |
| MCP / tool / resource / prompt declaration | `apm-mcp-reviewer` | `apm-mcp-component-judge` |
| Hook / command / script | `apm-hook-command-reviewer` | `apm-hook-command-component-judge` |
| Final synthesis | `apm-package-synthesizer` | `apm-package-synthesis-judge` |

## Workflow（ワークフロー）

### 1. Inventory（棚卸し）

すべての package evidence を列挙し、次の type に分類する:

- package
- skill
- custom-agent
- prompt
- instruction
- MCP
- hook-command
- package-doc
- generated-output
- dependency-package
- unknown

各 item について可能な限り以下を記録する:

- path
- type
- source: local、direct dependency、transitive dependency、generated、unknown
- likely activation trigger
- intended user task
- target harnesses
- safety-sensitive capabilities
- review 対象にすべきか

### 2. Build dependency and semantic graph first（先に依存・意味グラフを構築する）

component synthesis の前に `apm-dependency-graph-reviewer` を使う。Graph は以下を含む必要がある:

- package dependency graph
- component provenance graph
- semantic interaction graph
- capability exposure graph

Graph が partial なら、partial であることと unknowns を明記する。

### 3. Dispatch component reviews（component review の dispatch）

`references/dispatch-matrix.ja.md` に従って、各 artifact を専門 reviewer に送る。

subagents が使えない場合は、main conversation 内で同じ judge skills を sequential に実行し、section label に reviewer role を明記する。実行していない subagent execution を主張してはいけない。

### 4. Collect and normalize reports（report の収集と正規化）

各 component report から次を抽出する:

- component path/id
- type
- package/provenance
- source depth if known
- score and percentage
- grade
- verdict
- trigger/activation quality
- output-contract quality
- safety findings
- context-efficiency findings
- conflicts or overlap
- top fixes
- confidence

### 5. Synthesize final package verdict（最終 package verdict の統合）

`apm-package-synthesizer` と `apm-package-synthesis-judge` を使う。component score を単純平均して final score にしてはいけない。graph findings、cap rules、cross-component conflicts、semantic safety、context efficiency を使って package-level quality を評価する。

## Required final output（必須最終出力）

最終 response は以下を含む:

- package score and grade
- recommended action
- evidence coverage and unknowns
- component score summary
- dependency / interaction graph findings
- cross-component conflicts
- semantic safety findings
- context efficiency findings
- top fixes
- suggested runtime eval tasks
- final recommendation

## Never do（禁止事項）

- `apm audit --ci` の実行や結果を前提にしない。
- component score を単純平均して final score にしない。
- subagents を実行していないのに実行したと書かない。
- graph を作らずに transitive capability や provenance を断定しない。
- `.ja.md` は参照用 localization として扱い、runtime entrypoint は標準の `SKILL.md` とする。
