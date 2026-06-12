---
name: apm-hook-command-component-judge
description: hook、command、script component を、lifecycle trigger precision、deterministic
  behavior、matcher scope、side effects、permission boundaries、idempotency、failure handling、semantic
  fit の観点で評価する。`.apm/hooks/*.json`、hook declarations、scripts、command-like automation、APM
  semantic package review 内の lifecycle handlers をレビューするときだけ使う。
license: MIT

---

# APM Hook/Command Component Judge 日本語版

hook/command/script component だけを評価する。package-level quality の統合評価は行わない。

Hooks と commands は deterministic automation として有用だが、matcher が広すぎる、silent mutation を行う、secret や network に触れる場合は、自然言語 component よりも強い safety boundary が必要である。

## Trigger contract（発火契約）

この judge を使う対象:

- `.apm/hooks/*.json`
- agents、skills、settings、plugin metadata に埋め込まれた hook declarations
- hooks または package workflows から呼ばれる scripts
- lifecycle commands と deterministic automation
- state を mutate する、または tools を実行する command-like files

使わない対象:

- lifecycle automation として実行されない natural-language prompt workflows には使わない。

## Calibration reference（キャリブレーション参照）

採点前に `../../../references/judge-calibration-guide.ja.md` を読む。trigger-quality expectations、evidence classification、score percentages、cap-rule severity、expert value / activation reminders / redundant content の区別を正規化するために使う。

## Rubric: 120 points（120点ルーブリック）

| Dimension | Max | Evaluation focus |
|---|---:|---|
| H1 Lifecycle Trigger & Matcher Precision | 20 | event、matcher、conditions、scope が narrow で intentional。 |
| H2 Determinism & Idempotency | 15 | behavior が predictable、repeatable で、複数回実行しても安全。 |
| H3 Side-Effect Disclosure | 20 | file writes、command execution、network calls、approvals、mutations が explicit。 |
| H4 Permission & Safety Boundary | 20 | least privilege、protected-file handling、confirmation/escalation、secret safety がある。 |
| H5 Failure Handling & Observability | 15 | timeouts、nonzero exits、logs、user-facing errors が明確。 |
| H6 Semantic Fit | 10 | LLM judgment ではなく deterministic enforcement/automation problem を解く。 |
| H7 Cross-Harness Portability | 10 | shell/platform/target assumptions が explicit。 |
| H8 Package Composition Risk | 10 | dependencies 経由で users を surprise せず、prompts/agents/instructions と conflict しない。 |

## Cap rules（上限ルール）

- permission または tool approval に `.*` のような broad matcher を使い、強い justification がない: max D。
- silent state mutation: max D、H3 <= 8。
- 明示的 purpose と safeguards なしに secrets を読む、または露出する: max F。
- 複数 hooks が同じ input/order-sensitive data を determinism なしに modify する: max C。
- timeout/error contract のない long-running または network hook: max C。
- prompt/agent hook の方が安全な model judgment に lifecycle automation を使う: H6 <= 5。

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
- Type: hook-command
- Score: <0-120> (<percent>%)
- Grade: <A-F>
- Lifecycle/event: <event|unknown>
- Capability class: <read|write|execute|network|approval|unknown>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

### Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|

### Trigger and Side-Effect Assessment
- Event/matcher:
- Side effects:
- Failure behavior:
- Recommended scope change:

### Findings
- ...

### Top Fixes
1. ...
2. ...
3. ...
```
