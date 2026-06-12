---
name: apm-skill-component-judge
description: SKILL.md などの個別 Agent Skill component を、expert knowledge delta、activation
  description quality、progressive disclosure、anti-patterns、freedom calibration、output
  contracts、practical usability の観点で評価する。APM package または Claude-plugin-like bundle
  内の skill component をレビューするときだけ使う。SKILL.md、skill package、Agent Skill、progressive
  disclosure、skill activation、skill description、skill resources、skill quality review
  に反応する。
license: MIT

---

# APM Skill Component Judge 日本語版

個別の Agent Skill component を評価する。package-level quality の統合評価は行わない。

Skill は tutorial ではない。Skill は expert knowledge と decision criteria を外部化する仕組みである。中心となる問いは、その skill がなければ base model が正しく適用しにくい expert-level knowledge と判断基準を捕捉しているかである。

## Trigger contract（発火契約）

この judge を使う対象:

- `.apm/skills/<name>/SKILL.md`
- Agent Skill を表す root `SKILL.md`
- `SKILL.md` から参照される skill-local references、templates、scripts、examples、assets
- skill description、activation behavior、progressive disclosure のレビュー

使わない対象:

- prompt、agent、instruction、hook、MCP server、package synthesis には使わない。ただしそれらが skill package 内に埋め込まれ、skill behavior に実質的に影響する場合は除く。

## Calibration reference（キャリブレーション参照）

採点前に `../../../references/judge-calibration-guide.ja.md` を読む。trigger-quality expectations、evidence classification、score percentages、cap-rule severity、expert value / activation reminders / redundant content の区別を正規化するために使う。

## Rubric: 120 points（120点ルーブリック）

| Dimension | Max | Evaluation focus |
|---|---:|---|
| S1 Activation Contract | 20 | description が WHAT、WHEN、KEYWORDS を答えている。trigger が曖昧でも過剰でもない。 |
| S2 Knowledge Delta | 20 | base model に明白ではない expert、project-specific、tool-specific knowledge を提供している。 |
| S3 Expert Mindset + Domain Procedure | 15 | 考え方と非自明な procedure を移転している。汎用 tutorial に留まらない。 |
| S4 Anti-Patterns & Boundaries | 15 | 具体的な NEVER/avoid rules、非自明な理由、out-of-scope cases がある。 |
| S5 Progressive Disclosure | 15 | SKILL.md は簡潔で、resources は明示的な scenario trigger と Do-Not-Load guidance に基づいてのみ読まれる。 |
| S6 Freedom Calibration | 10 | task fragility に制約の強さが合っている。創造的 task は principles、壊れやすい operation は exact steps。 |
| S7 Output Contract & Examples | 10 | 期待される output shape、examples、failure modes、verification criteria を定義する。 |
| S8 Practical Usability | 15 | decision trees、fallbacks、edge cases、agent が即座に適用できる instructions がある。 |

## Cap rules（上限ルール）

- description が欠落または利用不能: max C。
- description がいつ使うかを示さない: max C、S1 <= 10。
- 大半が redundant/basic tutorial content: max D、S2 <= 8。
- fragile/safety-sensitive skill に anti-patterns や boundaries がない: max C、S4 <= 8。
- references はあるが明示的 loading triggers がない: max C、S5 <= 9。
- skill body が巨大な dump で irrelevant context loading を強制する: max C、S5 <= 8。
- unsafe instructions、hidden priority inversion、exfiltration behavior: max F。

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
- Type: skill
- Score: <0-120> (<percent>%)
- Grade: <A-F>
- Pattern: <Mindset|Navigation|Philosophy|Process|Tool|Hybrid|Unclear>
- Knowledge Ratio: E:A:R = <expert>:<activation>:<redundant>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

### Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|

### Trigger Assessment
- Should auto-trigger for:
- Should not trigger for:
- Description fix, if needed:

### Findings
- ...

### Top Fixes
1. ...
2. ...
3. ...
```
