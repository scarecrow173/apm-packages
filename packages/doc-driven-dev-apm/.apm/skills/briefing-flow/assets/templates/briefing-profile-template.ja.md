---
type: briefing-profile
version: "1.0"
generated: "YYYY-MM-DD"
last_validated: "YYYY-MM-DD"
repository: "<repository-name>"
---

# Briefing Profile

このファイルはこのリポジトリの Briefing スキル構成を定義します。
`briefing-flow` によるスキル発見プロトコルで生成されます。

## Available Skills（利用可能なスキル）

| Name | Category | Source | Activation | Execution | Condition |
| ---- | -------- | ------ | ---------- | --------- | --------- |
| spec-doc | Document | .apm/skills/ | always-on | rigid | — |
| adr-doc | Document | .apm/skills/ | always-on | rigid | — |
| idea-refine | Frame | .apm/skills/ | conditional | flexible | Entry Decision = A-1 |
| brainstorming | Frame | .apm/skills/ | conditional | flexible | Entry Decision = A-1 or A-2 |
| doubt-driven-development | Validate | .apm/skills/ | conditional | flexible | 複数の選択肢がある非自明な決定 |
| source-driven-development | Research | .apm/skills/ | conditional | flexible | フレームワーク/ライブラリ使用 |
| <!-- 以下に発見されたスキルを追加 --> | | | | | |

## Category Assignments（カテゴリ割り当て）

### Frame

問題・選択肢を構造化するスキル。

- idea-refine — 発散→収束で問題を構造化
- brainstorming — 対話型でオプションを整理
- <!-- 例: interview-me — 意図を引き出す質問 -->

### Discover

情報を探索・発見するスキル。

- <!-- 例: steer-web-research — 外部情報の体系的調査 -->
- <!-- 例: steer-enterprise-web-research — エンタープライズ深掘りリサーチ -->

### Research

深掘り調査を行うスキル。

- source-driven-development — 公式ドキュメントに基づく検証
- <!-- 例: ドメイン固有のリサーチスキル -->

### Validate

情報の正確性・完全性を検証するスキル。

- doubt-driven-development — 対抗的分析で前提を検証
- <!-- 例: セキュリティ観点の検証スキル -->

### Document

正式な文書を生成するスキル。

- spec-doc — YAML フロントマター + Markdown の仕様書
- adr-doc — MADR 4.0.0 形式のアーキテクチャ決定記録

### Meta

他のスキルをオーケストレーションするスキル（Default Stack に含めない）。

- briefing-flow — このプロファイルの管理元
- doc-driven-dev-flow — 6フェーズフルオーケストレーター

## Default Stack

標準的なブリーフィング用の基本スキル組み合わせ。

| Priority | Category | Skill | Rationale |
| -------- | -------- | ----- | --------- |
| 1 | Document | spec-doc | 全ブリーフィングで仕様書を生成 |
| 2 | Document | adr-doc | 全ブリーフィングで ADR を生成 |

## Override Rules

| Condition | Action | Reason |
| --------- | ------ | ------ |
| Entry Decision = A-1（Problem Framing） | 追加: idea-refine | 問題定義が曖昧、構造化が必要 |
| Entry Decision = A-2（Option Framing） | 追加: brainstorming | トレードオフ整理が必要 |
| Entry Decision = A-3（Combined Discovery） | 追加: 全 conditional スキルを評価 | 複数情報源からの収束が必要 |
| Entry Decision = A-5（Research Required） | 追加: Discover + Research カテゴリ | 外部調査が必要 |
| 外部 API/ライブラリが関係する | 追加: source-driven-development | 公式ドキュメントに対して検証 |
| 複数の実現方法が存在する | 追加: brainstorming + doubt-driven-development | 選択肢の構造化と検証が必要 |
| 前例のないアーキテクチャ判断 | 追加: Research + Validate カテゴリ | 根拠の調査と前提検証が必要 |
| <!-- リポジトリ固有のオーバーライドを追加 --> | | |

## Information State Indicators

| Indicator | Description | Suggests |
| --------- | ----------- | -------- |
| Problem clarity | 問題を 1 文で説明できるか | Low → A-1, High → A-4 |
| Direction clarity | 解決の方向性があるか | Partial → A-2 |
| External dependency | 外部情報が必要か | Yes → A-5 |
| Convergence need | 複数情報源の収束が必要か | Yes → A-3 |
| Acceptance criteria readiness | 今すぐ受け入れ条件を書けるか | Yes → A-4, No → A-1/A-2 |
