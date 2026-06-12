---
name: apm-instruction-component-judge
description: 個別 instruction または rules component を、scope precision、applyTo/glob trigger、behavioral
  value delta、normative clarity、conflict resistance、freedom calibration、always-on
  context cost、target portability の観点で評価する。`.apm/instructions/*.instructions.md`、rules、glob-scoped
  instructions、package guardrails、target-native instruction files をレビューするときだけ使う。
license: MIT

---

# APM Instruction Component Judge 日本語版

個別の instruction/rule component を評価する。package-level quality の統合評価は行わない。

Instruction は常時または広い scope で効きやすいため、短く、scope が精密で、generic advice を避け、重なった場合に矛盾しにくい必要がある。

## Trigger contract（発火契約）

この judge を使う対象:

- `.apm/instructions/*.instructions.md`
- rules、guardrails、context files
- glob-scoped instructions または applyTo-scoped instructions
- target-native instruction files

使わない対象:

- one-shot workflow には使わない。それは prompt である。deep domain procedure には通常 skill を使う。custom role delegation には agent を使う。

## Calibration reference（キャリブレーション参照）

採点前に `../../../references/judge-calibration-guide.ja.md` を読む。trigger-quality expectations、evidence classification、score percentages、cap-rule severity、expert value / activation reminders / redundant content の区別を正規化するために使う。

## Rubric: 120 points（120点ルーブリック）

| Dimension | Max | Evaluation focus |
|---|---:|---|
| I1 Scope & Trigger Precision | 20 | `description` と `applyTo`/glob scope が specific で justified。 |
| I2 Behavioral Value Delta | 20 | rules が project/domain-specific で、generic best practices ではない。 |
| I3 Normative Clarity | 15 | 必要な箇所で明確な MUST/SHOULD/NEVER language を使う。 |
| I4 Conflict Resistance | 15 | contradictions を避け、overlap が起きそうな場合は precedence/escalation を定義する。 |
| I5 Freedom Calibration | 10 | constraint strength が mistake の consequence と合っている。 |
| I6 Context Efficiency | 15 | always-on use に十分短く、boilerplate と tutorials を除いている。 |
| I7 Cross-Harness Portability | 10 | 他 target へ compile したとき壊れる assumptions を避ける。 |
| I8 Examples & Edge Cases | 15 | 非自明な rules に minimal examples、exceptions、failure cases がある。 |

## Cap rules（上限ルール）

- always-on instructions の scope が欠落または過剰に広い: max C、I1 <= 10。
- 「clean code を書く」などの generic rules が支配的: max D、I2 <= 8。
- same package/dependency graph 内の別 instruction と contradiction: max C。safety-relevant なら max D。
- instructions 内の長い tutorial content: I6 <= 6。
- user/system/developer constraints を override すると主張する instructions: max F。

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
## Component Semantic Review: <path>
- Type: instruction
- Score: <0-120> (<percent>%)
- Grade: <A-F>
- Scope: <glob/applyTo/unknown>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

### Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|

### Scope Assessment
- Applies to:
- Should not apply to:
- Likely overlaps:

### Findings
- ...

### Top Fixes
1. ...
2. ...
3. ...
```
