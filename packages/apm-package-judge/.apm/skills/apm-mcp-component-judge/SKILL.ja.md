---
name: apm-mcp-component-judge
description: MCP server、tool、resource、prompt declarations を、capability disclosure、tool
  description quality、input/output schemas、trust boundary、side effects、credentials、agent
  misuse resistance、package composition の観点で評価する。APM semantic review 内で MCP dependencies、server
  declarations、tools/resources/prompts、capability exposure をレビューするときだけ使う。
license: MIT

---

# APM MCP Component Judge 日本語版

MCP-related component だけを評価する。package-level quality の統合評価は行わない。

MCP は単なる設定ではなく、agent が発見し呼び出せる capability surface である。tool description、schema、side effect、trust boundary は runtime behavior に直接影響する。

## Trigger contract（発火契約）

この judge を使う対象:

- MCP server declarations
- MCP tool/resource/prompt definitions
- `apm.yml` の MCP dependencies または MCP-related package docs
- transitive MCP capability evidence
- MCP setup/auth/failure documentation

使わない対象:

- MCP ではない plain prompt、instruction、agent、skill には使わない。tool exposure がない documentation のみの場合は、関連 package/component judge の一部として扱う。

## Calibration reference（キャリブレーション参照）

採点前に `../../../references/judge-calibration-guide.ja.md` を読む。trigger-quality expectations、evidence classification、score percentages、cap-rule severity、expert value / activation reminders / redundant content の区別を正規化するために使う。

## Rubric: 120 points（120点ルーブリック）

| Dimension | Max | Evaluation focus |
|---|---:|---|
| M1 Capability Disclosure | 20 | server/tool purpose、data access、side effects が users/reviewers に見える。 |
| M2 Tool Description Quality | 20 | tool descriptions が safe selection と argument generation に十分 precise。 |
| M3 Input/Output Schema Quality | 15 | schemas が parameters と outputs を制約し、required fields と errors が明確。 |
| M4 Trust Boundary & Provenance | 15 | source、transport、credentials、deployment boundary が理解できる。 |
| M5 Side-Effect & Permission Calibration | 20 | read/write/network/destructive operations が bounded かつ justified。 |
| M6 Agent Misuse Resistance | 10 | naming/descriptions が over-triggering、ambiguity、prompt-injection surface を避ける。 |
| M7 Composition with Package | 10 | MCP capabilities が package purpose と整合し、dependencies 経由で surprise しない。 |
| M8 Operational Usability | 10 | setup assumptions、auth、failure modes、safe test paths が document されている。 |

## Cap rules（上限ルール）

- write/destructive/network capability が未開示: max D、M5 <= 8。
- tool descriptions が曖昧で wrong tool selection を招く: max C、M2 <= 10。
- meaningful parameters の schema がない: max C、M3 <= 8。
- credentials/secrets handling が不明瞭: max D。
- top-level disclosure なしに transitive MCP が現れる: max C。state-changing なら max D。
- tool または resource content に priority-inverting instructions が含まれる: max F。

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
## Component Semantic Review: <path-or-server>
- Type: MCP
- Score: <0-120> (<percent>%)
- Grade: <A-F>
- Capability class: <read-only|write|network|destructive|unknown>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

### Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|

### Capability Disclosure
- Exposed tools/resources/prompts:
- Side effects:
- Credentials/auth assumptions:
- Trust boundary:

### Findings
- ...

### Top Fixes
1. ...
2. ...
3. ...
```
