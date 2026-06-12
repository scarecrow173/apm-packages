---
name: apm-semantic-package-judge
description: component inventory を作成し、dependency/provenance/interaction/capability graph を構築し、component type ごとに専門 reviewer subagents へ委譲し、component reports と graph reports を収集し、最終的な package-quality verdict を統合することで、APM パッケージを意味論的に評価する。apm audit や機械的整合性チェックなしで package-level semantic quality evaluation を行うときに使う。
license: MIT
metadata:
  version: 0.3.0
  category: apm-semantic-review
  locale: ja
  localized_from: SKILL.md
---

# APM Semantic Package Judge

component specialist reviews と dependency-graph-aware package synthesis を組み合わせ、APM パッケージを composed agent capability bundle として評価する。

機械的監査チェックは行わない。`apm audit --ci` を要求したり、それに依存したりしない。このスキルは semantic quality だけを評価する。

## 入力

以下のいずれかを受け付ける。

- package root
- `apm.yml` excerpt
- `apm.lock.yaml` excerpt。利用可能な場合のみ、dependency/provenance/depth の証拠として使う
- directory tree
- package files
- `.apm/skills`、`.apm/prompts`、`.apm/instructions`、`.apm/agents`、hooks、commands、MCP declarations
- `apm_modules/` excerpts または dependency package trees
- Claude-plugin-like bundle
- 既存の component reports
- 既存の dependency graph report

ファイルが利用できない場合は、提供された証拠だけを評価し、unknowns を明示する。

## Orchestration model

環境が subagents をサポートする場合は specialist reviewers を使う。main agent は dispatch と final synthesis に責任を持つ。

Specialist mapping:

| Artifact | Reviewer subagent | Required skill |
|---|---|---|
| Dependency/provenance/interaction/capability graph | `apm-dependency-graph-reviewer` | `apm-dependency-graph-builder`, `apm-dependency-graph-judge` |
| Skill / `SKILL.md` | `apm-skill-reviewer` | `apm-skill-component-judge` |
| Custom agent / subagent | `apm-agent-reviewer` | `apm-agent-component-judge` |
| Prompt / slash command prompt | `apm-prompt-reviewer` | `apm-prompt-component-judge` |
| Instruction / rules file | `apm-instruction-reviewer` | `apm-instruction-component-judge` |
| MCP server/tool/resource/prompt declaration | `apm-mcp-reviewer` | `apm-mcp-component-judge` |
| Hook / command / script | `apm-hook-command-reviewer` | `apm-hook-command-component-judge` |
| Package synthesis | `apm-package-synthesizer` | `apm-package-synthesis-judge` |

subagents が利用できない場合は、main conversation で同じ specialist skills を順番に実行し、各 report に review type を明示する。

## Workflow

### 1. Inventory

package tree から component inventory を作成する。各 item を分類する。

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

各 component record には以下を含める。

- path
- type
- source: local、direct dependency、transitive dependency、generated、unknown
- likely activation trigger
- intended user task
- target harnesses
- safety-sensitive capabilities
- review すべきかどうか

### 2. Build semantic dependency graph

component dispatch の前に graph report を作成する。可能なら `apm-dependency-graph-reviewer` を使う。

graph は package edges だけに限定してはならない。証拠が許す場合は4つの view を作る。

1. Package dependency graph: root package、direct dependencies、transitive dependencies、local dependencies、declared MCP dependencies。
2. Component provenance graph: 各 skill、agent、prompt、instruction、hook、command、MCP declaration、generated output をどの package/dependency が提供しているか。
3. Semantic interaction graph: activation overlaps、instruction-scope overlaps、agent-skill handoffs、prompt bypasses、component conflicts。
4. Capability exposure graph: tools、MCP servers、hooks、scripts、commands、network access、file writes、その他 safety-sensitive capabilities。

`apm.lock.yaml` が利用できる場合は、dependency depth と resolved package provenance の証拠として使う。lock correctness や drift は評価しない。

graph reviewer には以下を出力させる。

- `references/dependency-graph.schema.json` に従う JSON graph
- 有用な場合の Mermaid overview
- `references/graph-report.schema.json` に従う `Dependency Graph Semantic Review Report`
- package synthesis が消費できる findings

### 3. Dispatch component reviews

component type ごとに files をグループ化し、対応する reviewer subagent へ委譲する。

dependency graph が利用できる場合は、各 reviewer prompt に関連 graph context を含める。

- component provenance
- direct/transitive dependency source
- overlapping components
- capability exposure
- known interaction/conflict edges

Delegation prompt template:

```text
Review these <component-type> components for semantic quality only.
Use <required-skill-name>.
Use the dependency graph context only for provenance, overlap, and capability context.
Return one component report per component plus an aggregate type summary.
Do not evaluate lockfiles, hashes, hidden Unicode, install drift, or package authenticity.
Evidence must cite paths and excerpts when available.
```

structured output が求められた場合、各 reviewer には `references/component-report.schema.json` を使った `Component Semantic Review Report` を出力させる。

### 4. Collect reports

各 component report を以下に正規化する。

- component id/path
- component type
- package/provenance
- source depth。分かる場合
- score out of 100
- grade
- verdict
- activation quality
- output-contract quality
- safety-boundary quality
- context efficiency
- conflicts
- graph-related findings
- top fixes
- confidence

graph report を以下に正規化する。

- graph coverage
- node counts by type
- edge counts by type
- dependency depth summary
- capability exposure summary
- cross-component conflict findings
- surprise capability findings
- graph confidence

### 5. Synthesize

`apm-package-synthesis-judge` を使って package-level findings を生成する。

synthesis は component scores を単純平均してはならない。reports と graph analysis から発見された system-level issues を penalize する。

- conflicting activation domains
- contradictory instructions
- duplicated responsibilities
- agents と skills の間の handoff 欠落
- prompts bypassing skills or agents
- semantic disclosure なしに導入された MCP/tools
- hooks/commands changing behavior invisibly
- transitive capability surprise
- package behavior を支配する深い、または説明不足の dependency chains
- 多数の always-on instructions による context bloat
- 無関係な components に分断された package purpose

### 6. Final report

以下を出力する。

```markdown
# APM Semantic Package Evaluation Report: <package>

## Summary
- Score: <0-160>
- Grade: <A-F>
- Recommendation: <approve | approve with fixes | hold | block | redesign>
- Confidence: <high | medium | low>
- Evaluation mode: specialist subagents | sequential specialist review | partial evidence

## Graph Summary
- Graph built: <yes | partial | no>
- Package nodes:
- Component nodes:
- Capability nodes:
- Highest dependency depth:
- Most important graph finding:

## Component Review Coverage
| Type | Count | Reviewer | Avg Score | Worst Finding |
|---|---:|---|---:|---|

## Component Findings
各 specialist report を要約する。

## Dependency / Interaction Graph Findings
依存深度、provenance、interaction、capability-exposure findings を列挙する。

## Cross-Component Findings
package-level conflicts、gaps、emergent behavior を列挙する。

## Package Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|
| P1 Package Intent & Value Delta | | 20 | |
| P2 Component Coverage & Role Separation | | 20 | |
| P3 Activation Architecture | | 20 | |
| P4 Cross-Component Coherence | | 20 | |
| P5 Semantic Safety & Trust Boundaries | | 20 | |
| P6 Context Efficiency | | 20 | |
| P7 Runtime Usefulness | | 20 | |
| P8 Maintainability & Evolvability | | 20 | |

## Blockers

## Top Fixes

## Final Recommendation
```

## Rules

- 強い個別 component によって package-level incoherence を隠してはならない。
- package-level intent によって unsafe または unclear components を補償してはならない。
- subagent または同等の specialist pass を実行していない限り、subagent review が行われたと主張してはならない。
- graph evidence が実際に収集または提供されていない限り、graph を構築したと主張してはならない。
- mechanical integrity を評価してはならない。
- ファイル読取に明示的に必要で、user が許可した場合を除き、code execution を行ってはならない。
- inference より explicit evidence を優先する。
