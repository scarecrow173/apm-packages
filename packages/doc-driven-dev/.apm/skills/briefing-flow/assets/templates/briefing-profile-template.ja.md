---
type: briefing-profile
version: "1.0"
generated: "YYYY-MM-DD"
last_validated: "YYYY-MM-DD"
repository: "<repository-name>"
---

# Briefing Profile

このファイルは、このリポジトリの briefing スキル構成を定義する。`briefing-flow` が skill discovery protocol を通じて生成する。

`runtime_guidance` は、`execution_policy` の確認後に参照する soft ranking metadata として扱う。

## Available Skills

| Name | Category | Source | Activation | Execution | Condition |
| ---- | -------- | ------ | ---------- | --------- | --------- |
| spec-doc | Document | .apm/skills/ | always-on | rigid | — |
| adr-doc | Document | .apm/skills/ | always-on | rigid | — |
| deep-dive | Frame | .apm/skills/ | conditional | flexible | 曖昧な要求を深掘りする必要がある |
| <!-- Add discovered skills below --> | | | | | |

## Category Assignments

### Frame

問題や選択肢を構造化するスキル。

- deep-dive — 意図、制約、判断軸を深掘りする
- <!-- 例: option-analysis skill — アプローチとトレードオフを比較する -->
- <!-- 例: interview-me — 質問を通じて意図を引き出す -->

### Discover

情報を探索し、見つけるスキル。

- <!-- 例: steer-web-research — 体系的な外部調査 -->
- <!-- 例: steer-enterprise-web-research — エンタープライズ向けの深掘り調査 -->

### Research

深掘り調査を行うスキル。

- <!-- 例: steer-web-research — 体系的な外部調査 -->
- <!-- 例: ドメイン固有の調査スキル -->

### Document

正式文書を作成するスキル。

- spec-doc — YAML front matter + Markdown の仕様書
- adr-doc — MADR 4.0.0 形式のアーキテクチャ意思決定記録

### Meta

他のスキルをオーケストレーションするスキル（Default Stack には含めない）。

- briefing-flow — この profile の管理者
- doc-driven-dev-flow — 6 フェーズ全体のオーケストレータ

## Default Stack

標準的な briefing のベースとなるスキル組み合わせ。

| Priority | Category | Skill | Rationale |
| -------- | -------- | ----- | --------- |
| 1 | Document | spec-doc | すべての briefing は仕様を生成する |
| 2 | Document | adr-doc | すべての briefing は ADR を生成する |

## Override Rules

| Condition | Action | Reason |
| --------- | ------ | ------ |
| Entry Decision = A-1 (Problem Framing) | Add: deep-dive | 問題定義が曖昧で、深掘りが必要 |
| Entry Decision = A-2 (Option Framing) | Add: 条件に合う Frame スキル | トレードオフ分析が必要 |
| Entry Decision = A-3 (Combined Discovery) | Add: evaluate all conditional skills | 複数ソースからの収束が必要 |
| Entry Decision = A-5 (Research Required) | Add: Discover + Research categories | 外部調査が必要 |
| External API/library involved | Add: Research category | 公式ドキュメントに照らして検証する |
| Multiple implementation approaches exist | Add: 条件に合う Frame スキル | 選択肢の整理が必要 |
| Unprecedented architectural decision | Add: Research category | 証拠収集と前提検証が必要 |
| <!-- Add repository-specific overrides --> | | |

## Information State Indicators

| Indicator | Description | Suggests |
| --------- | ----------- | -------- |
| Problem clarity | 問題を 1 文で説明できるか | Low → A-1, High → A-4 |
| Direction clarity | 解決の方向性があるか | Partial → A-2 |
| External dependency | 外部情報が必要か | Yes → A-5 |
| Convergence need | 複数ソースの収束が必要か | Yes → A-3 |
| Acceptance criteria readiness | 今すぐ acceptance criteria を書けるか | Yes → A-4, No → A-1/A-2 |
