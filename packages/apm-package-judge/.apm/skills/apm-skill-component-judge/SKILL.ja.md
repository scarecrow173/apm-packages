---
name: apm-skill-component-judge
description: SKILL.md などの個別 Agent Skill 構成物を、semantic quality、activation contract、progressive disclosure、expert knowledge delta、boundaries、workflow clarity、practical usability の観点で評価する。モジュール式 APM パッケージ評価の専門 reviewer として使用する。
license: MIT
metadata:
  version: 0.2.0
  category: apm-semantic-review
  locale: ja
  localized_from: SKILL.md
---

# APM Skill 構成物 Judge

個別 skill component だけを評価する。package-level quality の統合評価は行わない。

## スコープ

以下をレビューする。

- `SKILL.md`
- skill frontmatter
- skill が参照する resources
- skill に属する examples

## ルーブリック: 100点

| 評価軸 | 最大 | 意味 |
|---|---:|---|
| S1 Activation Contract | 15 | `description` が when-to-use を明確かつ具体的にしている。 |
| S2 Knowledge Delta | 15 | base model が持たない可能性の高い expert または project-specific knowledge を追加している。 |
| S3 Workflow Quality | 15 | 曖昧な助言ではなく、実行可能な procedure を示している。 |
| S4 Progressive Disclosure | 15 | main file を簡潔に保ち、詳細を resources に分離している。 |
| S5 Boundaries & Anti-Patterns | 10 | 何をしないか、いつ使わないかを述べている。 |
| S6 Output Contracts | 10 | expected outputs、formats、examples を定義している。 |
| S7 Context Efficiency | 10 | generic、duplicated、always-loaded bloat を避けている。 |
| S8 Practical Usability | 10 | realistic tasks に低い曖昧さで適用できる。 |

## 検出すべき所見

- 曖昧な description
- generic best practices
- activation triggers の欠落
- 肥大化した `SKILL.md`
- critical instructions が埋もれている
- output format がない
- failure handling がない
- redundant examples
- unsafe または over-broad instructions

## 出力

各 skill について以下を報告する。

```markdown
## Component Semantic Review: <path>
- Type: skill
- Score: <0-100>
- Grade: <A-F>
- Verdict: <one sentence>
- Confidence: <high|medium|low>

### Scores
| Dimension | Score | Max | Evidence |
|---|---:|---:|---|

### Findings
- ...

### Top Fixes
1. ...
```
