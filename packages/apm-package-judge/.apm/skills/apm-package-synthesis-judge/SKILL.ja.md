---
name: apm-package-synthesis-judge
description: 専門 component-review reports と dependency/provenance/semantic-interaction/capability-graph findings を統合し、APM パッケージ全体の意味論的品質評価へまとめる。component reviewers と dependency graph reviewer が report を出した後に使う。
license: MIT
metadata:
  version: 0.3.0
  category: apm-semantic-review
  locale: ja
  localized_from: SKILL.md
---

# APM Package Synthesis Judge

component reports と graph findings を統合し、package-level semantic quality を評価する。このスキルは component reviewer ではなく、機械的監査も行わない。

## 入力

- component inventory
- specialist reviewer reports
- dependency graph JSON または graph review report
- package docs と manifest excerpts。利用可能な場合
- known target harnesses

## Package ルーブリック: 160点

| 評価軸 | 最大 | 意味 |
|---|---:|---|
| P1 Package Intent & Value Delta | 20 | package 全体に明確で非汎用的な価値がある。 |
| P2 Component Coverage & Role Separation | 20 | components が必要な役割を重複なくカバーしている。 |
| P3 Activation Architecture | 20 | users と agents が、どの component が activate するかを予測できる。 |
| P4 Cross-Component Coherence | 20 | components が矛盾なく合成される。 |
| P5 Semantic Safety & Trust Boundaries | 20 | unsafe emergent behavior と surprise capabilities を避けている。 |
| P6 Context Efficiency | 20 | context cost と dependency-induced bloat が正当化され、最小化されている。 |
| P7 Runtime Usefulness | 20 | realistic tasks を改善する。 |
| P8 Maintainability & Evolvability | 20 | structure、provenance、graph clarity、tests、ownership、docs が更新を支える。 |

## Synthesis rules

score を単純平均として計算しない。

graph findings を使って component findings を調整する。個別 component が単体では許容可能に見えても、弱い graph は package-level issues を明らかにする。

Cap rules:

- critical semantic safety blocker がある場合: max grade D。
- 未開示の state-changing MCP/hook/command/script: P5 <= 8、max grade D。
- 未開示の transitive MCP/tool/capability: P5 <= 10。
- 通常利用に影響する複数の activation collisions: P3 <= 10、max grade C。
- 重複 scope 内の contradictory instructions: P4 <= 10、max grade C。
- prompt または command が意図された skill/agent safety path を迂回する: P4 <= 12、P5 <= 12。
- dependency graph が documentation なしの transitive component dominance を示す: P1 <= 12、P8 <= 14。
- dependency-using package で dependency graph が利用不能または不十分: confidence は high にできない。
- package に明確な目的がない: P1 <= 8、max grade C。
- ほとんどの components が generic: P1 <= 10、P6 <= 10。
- runtime eval tasks が作れない: P7 <= 10。
- missing files により component coverage が不完全: confidence は high にできない。

## 必須 synthesis sections

- graph summary
- component coverage matrix
- cross-component conflict matrix
- dependency/provenance findings
- capability exposure findings
- emergent safety risks
- context efficiency assessment
- top package-level fixes
- final recommendation

## 出力

structured output が求められた場合は、`references/package-report.schema.json` の package report template を使う。
