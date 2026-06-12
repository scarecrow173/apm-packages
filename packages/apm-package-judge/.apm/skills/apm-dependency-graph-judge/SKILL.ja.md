---
name: apm-dependency-graph-judge
description: APM semantic dependency graph を、capability surprise、provenance ambiguity、activation
  collisions、instruction overlap、transitive MCP または hook exposure、context bloat、cohesion
  risk、synthesis-impacting graph findings の観点で評価する。`apm-dependency-graph-builder`
  が graph evidence を生成した後に使う。
license: MIT

---

# APM Dependency Graph Judge 日本語版

dependency/provenance/interaction/capability graph 由来の semantic risk を評価する。個別 component content の詳細評価や package synthesis は行わない。

Graph finding は、単体 component だけでは見えない emergent behavior を示す。transitive capability surprise、activation collision、instruction conflict、context bloat、core behavior の provenance ambiguity を package-level synthesis に渡す。

## Trigger contract（発火契約）

この judge を使う対象:

- package dependency graph
- component provenance graph
- semantic interaction graph
- capability exposure graph

使わない対象:

- graph evidence なしに package quality を採点しない。個別 component の本文評価は specialist component judges に任せる。

## Calibration reference（キャリブレーション参照）

採点前に `../../../references/judge-calibration-guide.ja.md` を読む。trigger-quality expectations、evidence classification、score percentages、cap-rule severity、expert value / activation reminders / redundant content の区別を正規化するために使う。

## Rubric: 120 points（120点ルーブリック）

| Dimension | Max | Evaluation focus |
|---|---:|---|
| G1 Graph Coverage & Evidence Quality | 15 | conclusions を支える十分な nodes/edges/provenance が graph にある。 |
| G2 Dependency Depth & Cohesion | 15 | dependency depth と package relationships が package purpose と整合する。 |
| G3 Provenance Clarity | 15 | core behavior を local/direct/transitive sources まで trace できる。 |
| G4 Activation Collision Risk | 15 | skills、agents、prompts、instructions が同じ trigger domain を奪い合わない。 |
| G5 Instruction/Rule Overlap Risk | 15 | applyTo/glob overlaps が intentional で non-contradictory。 |
| G6 Capability Surprise | 20 | MCP/tools/hooks/scripts/commands が disclosed され、unexpected に introduced されない。 |
| G7 Context Bloat & Always-On Load | 10 | dependency composition が excessive always-on context を追加しない。 |
| G8 Synthesis Usefulness | 15 | findings が package-level scoring を constrain できるほど concrete。 |

## Cap rules（上限ルール）

- undisclosed transitive MCP/tool exposure: max C。write/destructive/network-sensitive なら max D。
- top-level disclosure なしに dependency 由来の state-changing hook/command がある: max D。
- same scope の conflicting instructions: max C。safety-relevant conflict なら max D。
- core package behavior の provenance が unknown: confidence cannot be high。
- usable graph evidence がない: max D、G1 <= 5。

## Shared evaluation protocol（共通評価プロトコル）

1. 採点前に component 全体を読む。近傍 resources が参照されている場合は、activation、output contract、safety boundaries、workflow viability の判断に必要な resources だけを確認する。
2. evidence を次のいずれかに分類する。
   - Expert: 非自明な知識、判断基準、trade-off、edge case、制約、anti-pattern。
   - Activation: 正しい workflow 選択を助ける短い reminder。
   - Redundant: base model がほぼ確実に知っている汎用助言。
3. 各 dimension は evidence に基づいて採点する。整った見た目だけで点を与えない。
4. raw score を合計した後で cap rules を適用する。
5. activation、expert knowledge density、safety boundaries、runtime usability を改善する具体的な修正を返す。

## Grade scale（グレード基準）

| Grade | Percentage | Meaning |
|---|---:|---|
| A | 90-100% | この component type として優秀で、本番利用可能。 |
| B | 80-89% | 良好。小さな targeted fix が必要。 |
| C | 70-79% | 利用可能だが、意味のある改善が必要。 |
| D | 60-69% | 品質または安全性に重大な問題がある。 |
| F | <60% | 根本的に弱い、危険、または有用でない。 |

## Report requirements（レポート要件）

すべての finding は、可能な限り path と短い excerpt、または観察可能な property を示す。evidence が不足している場合は推測せず、confidence を下げる。


## Output（出力）

```markdown
## Dependency Graph Semantic Review Report
- Score: <0-120> (<percent>%)
- Grade: <A-F>
- Graph coverage: <high|medium|low>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

### Graph Summary
- Package nodes:
- Component nodes by type:
- Capability nodes:
- Max dependency depth:
- Unknown provenance:

### Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|

### Synthesis Constraints
- ...

### Graph Findings
- ...

### Top Fixes
1. ...
2. ...
3. ...
```
