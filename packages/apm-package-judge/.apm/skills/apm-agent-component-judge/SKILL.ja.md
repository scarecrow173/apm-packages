---
name: apm-agent-component-judge
description: 個別の custom agent または subagent component を、delegation trigger quality、persona
  boundary、tool permissions、preloaded skills、output contract、isolation value、safety
  limits、skills や instructions との overlap の観点で評価する。`.apm/agents/*.agent.md`、Claude
  Code subagents、Copilot/Cursor/Codex agent files、APM semantic review 内の package agent
  personas をレビューするときだけ使う。
license: MIT

---

# APM Agent Component Judge 日本語版

個別の custom agent/subagent component を評価する。package-level quality の統合評価は行わない。

Agent は、model に well-bounded role、clear delegation trigger、appropriate tools、return contract を与えるとき価値がある。曖昧な persona に過ぎない場合や skill を重複するだけの場合は弱い。

## Trigger contract（発火契約）

この judge を使う対象:

- `.apm/agents/*.agent.md`
- Claude Code custom subagents
- plugins 由来の agent personas
- Copilot、Cursor、Codex、OpenCode などの harness 向けに変換された agent definitions
- judge skills を preload する reviewer subagents

使わない対象:

- skill または prompt にすべき reusable task instructions には使わない。

## Calibration reference（キャリブレーション参照）

採点前に `../../../references/judge-calibration-guide.ja.md` を読む。trigger-quality expectations、evidence classification、score percentages、cap-rule severity、expert value / activation reminders / redundant content の区別を正規化するために使う。

## Rubric: 120 points（120点ルーブリック）

| Dimension | Max | Evaluation focus |
|---|---:|---|
| A1 Delegation Trigger | 20 | description がいつ delegate するかを正確に示し、task/domain keywords を含む。 |
| A2 Role Boundary & Expertise | 15 | persona が狭く、expert で、非汎用的。責務が明示されている。 |
| A3 Tool & Permission Calibration | 20 | tools が least-privilege で task に合っている。dangerous capabilities が正当化されている。 |
| A4 Skill Preload & Knowledge Fit | 10 | preloaded skills が必要で過剰ではなく、agent role と整合している。 |
| A5 Workflow & Decision Protocol | 15 | 曖昧な behavior ではなく、具体的な review/decision workflow がある。 |
| A6 Output Contract | 10 | return format が明確で簡潔、parent conversation に有用。 |
| A7 Isolation & Context Economy | 10 | separate context の理由があり、main-context flooding を防ぐ。 |
| A8 Safety Boundaries & Non-Goals | 20 | 何をしてはいけないか、いつ escalate するか、不確実性をどう扱うかを示す。 |

## Cap rules（上限ルール）

- description 欠落または delegation trigger 不明瞭: max C、A1 <= 10。
- justification なしの broad tool access: max C。tools が files/network/state を mutate できる場合は D。
- distinct isolation または tool-boundary 理由なしに既存 skill を duplicate する agent: max C。
- useful summary ではなく raw dumps を返す agent: A6 <= 5、A7 <= 6。
- user/system/package rules を override する authority-expanding language がある: max F。

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
- Type: custom-agent
- Score: <0-120> (<percent>%)
- Grade: <A-F>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

### Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|

### Trigger Assessment
- Delegate when:
- Do not delegate when:
- Potential collisions:

### Tool Boundary Assessment
- Allowed tools:
- Excessive or missing tools:
- Recommended change:

### Findings
- ...

### Top Fixes
1. ...
2. ...
3. ...
```
