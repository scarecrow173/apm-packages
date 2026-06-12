---
name: apm-dependency-graph-judge
description: APM パッケージの dependency / provenance / interaction / capability graph を評価し、transitive capability surprise、instruction conflict、activation collision、context bloat、dependency-depth risk、provenance ambiguity、安全でない tool/hook/MCP exposure などの意味論的品質リスクを判定する。apm-dependency-graph-builder の後に使う。
license: MIT
metadata:
  version: 0.3.0
  category: apm-semantic-review
  locale: ja
  localized_from: SKILL.md
---

# APM 依存グラフ Judge

graph 由来の意味論的リスクを評価する。このスキルは、graph を package-level semantic quality の証拠として判定するものであり、機械的な install integrity は評価しない。

## スコープ

`apm-dependency-graph-builder` が生成した graph data をレビューする。

- package dependency graph
- component provenance graph
- semantic interaction graph
- capability exposure graph
- Mermaid または表形式の graph summaries
- component inventory。提供されている場合

## ルーブリック: 100点

| 評価軸 | 最大 | 意味 |
|---|---:|---|
| G1 Graph Coverage & Evidence Quality | 10 | node、edge、evidence、confidence notes が十分に含まれている。 |
| G2 Dependency Clarity | 15 | direct、transitive、local、plugin-like、MCP dependencies が理解できる。 |
| G3 Provenance Attribution | 15 | components を root または dependency package source へ追跡できる。 |
| G4 Semantic Interaction Accuracy | 15 | overlap、conflict、constraint、delegation、bypass edges が有用で証拠に基づいている。 |
| G5 Capability Exposure Clarity | 15 | tool、MCP、hook、command、script、permission exposure が見える。 |
| G6 Risk Detection | 15 | surprise capabilities、activation collisions、instruction conflicts、unsafe paths を graph が明らかにしている。 |
| G7 Synthesis Utility | 10 | package-level scoring と修正に使える所見になっている。 |
| G8 Visualization & Communication | 5 | graph summary が reviewer に読める程度に明確である。 |

## 検出すべき所見

### Transitive capability surprise

dependency が、root package に開示されていない MCP、hook、command、script、tool permission behavior を導入している。

影響:

- P5 Semantic Safety は 10 以下に cap するべきである。
- state-changing behavior が未開示なら、最終 grade は D に cap するべきである。

### Activation collision

2つ以上の skills、prompts、agents が、precedence や delegation なしに同じ user intent を取り合っている。

影響:

- 通常利用に影響する場合、P3 Activation Architecture は 10 以下に cap するべきである。

### Instruction conflict

重複する instruction scope に、矛盾または混乱を招く requirement が含まれている。

影響:

- P4 Cross-Component Coherence は 10 以下に cap するべきである。

### Context bloat path

dependency graph が、package value が明確でない always-on または broad-scope instructions を追加している。

影響:

- P6 Context Efficiency は 12 以下に cap するべきである。

### Provenance ambiguity

behavior-relevant component を root、direct dependency、transitive dependency のどれにも追跡できない。

影響:

- Confidence は high にできない。
- P8 Maintainability を下げるべきである。

### Deep dependency dominance

root package ではなく transitive dependency が package の中核動作を提供している。

影響:

- root package が composition role を明確に説明していない限り、P1 Package Intent と P2 Role Separation を下げるべきである。

### hooks/commands/scripts を通る safety path

prompt、agent、skill が、明確な user-facing trust boundary なしに、file、git state、network、secret を変更する hook、command、script へ至る。

影響:

- P5 は 8 以下に cap するべきである。
- recommendation は hold または block にするべきである。

## 出力

`Dependency Graph Semantic Review Report` を出力する。

```markdown
# Dependency Graph Semantic Review Report

## Summary
- Score: <0-100>
- Grade: <A-F>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

## Graph Coverage
| View | Status | Evidence | Unknowns |
|---|---|---|---|

## Graph Metrics
- Package nodes:
- Component nodes:
- Capability nodes:
- Edge count:
- Highest dependency depth:
- Highest-risk edge:

## Findings
| Severity | Finding | Evidence | Package synthesis impact | Fix |
|---|---|---|---|---|

## Cap Recommendations
synthesizer が適用すべき package-level score caps を列挙する。

## Mermaid Overview
任意の compact graph。
```

structured output が求められた場合は `references/graph-report.schema.json` を使う。
