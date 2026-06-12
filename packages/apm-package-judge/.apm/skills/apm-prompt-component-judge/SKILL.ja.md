---
name: apm-prompt-component-judge
description: 個別 prompt または slash-command workflow component を、invocation trigger quality、task
  contract、parameter handling、workflow robustness、output schema、safety boundaries、skills
  や agents との非重複性の観点で評価する。`.apm/prompts/*.prompt.md`、slash commands、reusable workflows、APM
  semantic review 内の prompt primitives をレビューするときだけ使う。
license: MIT

---

# APM Prompt Component Judge 日本語版

個別の prompt/workflow component を評価する。package-level quality の統合評価は行わない。

Prompt は、繰り返し使う callable workflow にすべきである。単なる長期 behavioral rule なら instruction、深い domain knowledge なら skill の方が適している。

## Trigger contract（発火契約）

この judge を使う対象:

- `.apm/prompts/*.prompt.md`
- slash-command prompts
- plugins 由来の prompt-like workflows
- harness 向け command に compile される prompts

使わない対象:

- long-lived behavioral rules には使わない。それらは instructions である。deep domain knowledge にも使わない。それは通常 skill である。

## Calibration reference（キャリブレーション参照）

採点前に `../../../references/judge-calibration-guide.ja.md` を読む。trigger-quality expectations、evidence classification、score percentages、cap-rule severity、expert value / activation reminders / redundant content の区別を正規化するために使う。

## Rubric: 120 points（120点ルーブリック）

| Dimension | Max | Evaluation focus |
|---|---:|---|
| P1 Invocation Contract | 20 | name/description/arguments が invocation scenarios と keywords を明確にする。 |
| P2 Task Specificity & Value | 15 | 汎用助言ではなく、repeatable concrete workflow を実行する。 |
| P3 Input & Parameter Handling | 15 | required arguments、defaults、missing-input behavior、assumptions が明示されている。 |
| P4 Workflow Robustness | 15 | steps が順序化され、条件分岐し、必要な checks/fallbacks を含む。 |
| P5 Output Contract | 20 | expected output format、sections、schemas、examples が指定されている。 |
| P6 Safety & Side-Effect Boundaries | 15 | permission、command、write、network、approval boundaries を記述する。 |
| P7 Non-Duplication & Composition | 10 | skills/agents/instructions と重複せず、きれいに compose する。 |
| P8 Context Efficiency | 10 | 簡潔で、generic preamble や irrelevant explanation がない。 |

## Cap rules（上限ルール）

- clear invocation scenario がない: max C、P1 <= 10。
- workflow prompt に output contract がない: max C、P5 <= 10。
- unsafe auto-execution または review/approval bypass を指示する prompt: max D または F。
- prompt が generic instructions に過ぎない: max D、P2 <= 6。
- package-level safety/instructions と conflict する prompt: max C、synthesis へ flag。

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
- Type: prompt
- Score: <0-120> (<percent>%)
- Grade: <A-F>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

### Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|

### Invocation Assessment
- Invoke when:
- Required inputs:
- Missing-input behavior:

### Findings
- ...

### Top Fixes
1. ...
2. ...
3. ...
```
