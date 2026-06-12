---
name: apm-package-synthesis-judge
description: component reviewer reports と dependency graph report を統合して、APM package
  全体の semantic quality に対する final verdict を作る。component score の単純平均ではなく、entrypoint
  quality、composition、graph-derived cap rules、semantic safety、context efficiency、runtime
  usefulness を使う。component reports と graph report が揃った後だけ使い、最初の reviewer としては使わない。
license: MIT

---

# APM Package Synthesis Judge 日本語版

Component reports と dependency graph report を統合し、final package-level semantic quality report を作成する。最初の reviewer として使ってはいけない。

## Trigger contract（発火契約）

この judge は以下が揃った後に使う:

- package inventory
- dependency graph JSON または graph findings
- skill / agent / prompt / instruction / MCP / hook-command component reports
- package docs または manifest excerpts

使わない対象:

- component 単体評価の代替
- subagent dispatch 前の初回レビュー
- mechanical audit / lockfile correctness check

## Calibration references（キャリブレーション参照）

採点前に `../../../references/judge-calibration-guide.ja.md` と `../../../references/graph-aware-synthesis.ja.md` を読む。前者は score normalization、evidence classification、cap-rule severity の統一に使う。後者は graph-derived findings を package dimensions と cap rules へ反映するために使う。この section を正準とし、他の calibration 指示を重複させない。

## Rubric: 160 points（160点ルーブリック）

| Dimension | Max | Evaluation focus |
|---|---:|---|
| P1 Package Intent & Value Delta | 20 | Package に coherent purpose があり、generic context を超える capability を追加する。 |
| P2 Semantic Scope & Manifest Clarity | 20 | Package scope、primitives、dependencies、target assumptions が理解できる。 |
| P3 Activation Architecture | 20 | Entrypoint skill、reviewer agents、component triggers、prompts、instructions が予測可能に発火する。 |
| P4 Cross-Component Coherence | 25 | Components が相互に補強し、危険な duplication、shadowing、contradictions がない。 |
| P5 Semantic Safety & Trust Boundaries | 25 | MCP/tools/hooks/scripts/agents が capabilities を開示し、boundaries を守る。 |
| P6 Context Efficiency & Progressive Disclosure | 20 | Always-on bloat を避け、resources/reviewers を必要時だけ読む。 |
| P7 Portability & Target Fit | 15 | APM primitives が正しい場所にあり、target differences を認識している。 |
| P8 Runtime Usefulness & Eval Readiness | 15 | realistic tasks と明確な success/failure signals で検証できる。 |

## Synthesis method（統合方法）

1. すべての component score を percentage に正規化する。
2. component findings を type と severity で grouping する。
3. package-level conclusions の前に graph report を読む。
4. failure が isolated component issue か package-architecture issue かを分ける。
5. cap rules を適用する。
6. final score、grade、verdict、fixes を出す。

Component scores は evidence であり、単純平均ではない。

## Cap rules（上限ルール）

- clear entrypoint skill または package-level activation route がない: max C、P3 <= 10。
- undisclosed transitive MCP/tool capability: P5 <= 10。write/destructive/network-sensitive なら max D。
- state-changing hook/command surprise: P5 <= 8、max D。
- runtime activation collision: P3 <= 10、max C。
- contradictory instruction overlap: P4 <= 10、max C。
- prompt が intended safety path を bypass する: P4 <= 12、P5 <= 12。
- dependency-induced context bloat: P6 <= 12。
- core behavior の provenance ambiguity: confidence cannot be high。
- component reviewers が必要な primitive types を inspect していない: confidence cannot be high。

## Output（出力）

```markdown
# APM Semantic Package Evaluation Report: <package>

## Summary
- Score: <0-160> (<percent>%)
- Grade: <A-F>
- Verdict: <one sentence>
- Recommended action: <approve|approve with fixes|hold|block|redesign>
- Confidence: <high|medium|low>

## Entrypoint and Trigger Architecture
- Entrypoint skill:
- Expected user trigger phrases:
- Reviewer dispatch path:
- Synthesis path:

## Evidence Reviewed
- Component reports:
- Graph report:
- Inventory coverage:
- Unknowns:

## Dimension Scores
| Dimension | Score | Max | Key evidence |
|---|---:|---:|---|

## Component Score Summary
| Type | Count | Median/Range | Main issue |
|---|---:|---|---|

## Graph-Derived Constraints
- ...

## Blockers
- ...

## High-Risk Findings
- ...

## Cross-Component Conflicts
- ...

## Context and Trigger Efficiency
- ...

## Top Improvements
1. ...
2. ...
3. ...

## Suggested Runtime Eval Tasks
| Task | Expected activation | Expected output | Failure signal |
|---|---|---|---|

## Final Recommendation
<clear conclusion>
```
