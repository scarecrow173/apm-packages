# Briefing スキル発見プロトコル

`briefing-profile.md` が存在しないか、陳腐化が検出された場合にこのプロトコルを実行する。
出力はリポジトリルートに生成された `briefing-profile.md` である。

## ステップ 1: すべてのスキルソースをスキャン

次の場所を順番にスキャンする。各場所について、スキル名、説明（フロントマターまたは
最初の見出しから）、およびソースパスを収集する。

| 優先度 | ソース | 探すもの |
| ------ | ------ | ------ |
| 1 | `.apm/skills/` | `SKILL.md` を含むディレクトリ |
| 2 | `.agents/skills/` | `SKILL.md` を含むディレクトリ |
| 3 | `.github/skills/` | スキルマークダウンファイル（GitHub Copilot） |
| 3 | `.github/agents/` | エージェントペルソナファイル `*.agent.md` |
| 3 | `.cursor/rules/` | ルールマークダウンファイル（Cursor） |
| 3 | `.claude/commands/` | コマンドファイル（Claude Code） |
| 3 | `.gemini/skills/` | スキルファイル（Gemini CLI） |
| 3 | `.gemini/commands/` | コマンド TOML ファイル（Gemini CLI） |
| 3 | `.opencode/skills/` | スキルファイル（OpenCode） |
| 4 | システムスキル | エージェントコンテキスト/命令にリストされたスキル |
| 5 | `apm_modules/` | スキルを持つインストール済みパッケージ |
| 6 | `AGENTS.md`、`CLAUDE.md`、`GEMINI.md` | ルート命令ファイルで参照されているスキル |
| 6 | `.cursorrules`、`.windsurfrules` | インラインスキルコンテンツ |
| 6 | `.github/copilot-instructions.md` | 参照されているスキル |

**注:** スキャンソースは `implementation-flow` のスキル発見プロトコルと同一。
差異は分類カテゴリにある。

## ステップ 2: 発見されたスキルを分類

説明と目的に基づいて、各スキルを Briefing カテゴリに割り当てる。
1 つのスキルは正確に 1 つのカテゴリに属する。

| カテゴリ | 割り当てルール | 例 |
| -------- | ------------ | -- |
| Frame | スキルが*問題・選択肢を構造化*する（問題定義、発散思考、選択肢整理） | `idea-refine`, `brainstorming`, `interview-me` |
| Discover | スキルが*情報を探索・発見*する（外部検索、情報収集） | `steer-web-research`, Web リサーチ系 |
| Research | スキルが*深掘り調査*を行う（一次情報参照、ドキュメント検証） | `source-driven-development` |
| Validate | スキルが*情報の正確性・完全性を検証*する（対抗的分析、前提の確認） | `doubt-driven-development` |
| Document | スキルが*正式な文書を生成*する（仕様書、ADR） | `spec-doc`, `adr-doc` |
| Meta | スキルが*他のスキルをオーケストレーション*する（このスキル自身） | `briefing-flow`, `doc-driven-dev-flow` |

**分類の判断基準:**

- スキルの description に「探す」「調べる」「検索」が含まれる → Discover
- スキルの description に「構造化」「整理」「定義」「磨く」が含まれる → Frame
- スキルの description に「検証」「確認」「対抗」が含まれる → Validate
- スキルの description に「仕様」「ADR」「文書」が含まれる → Document
- スキルの description に「調査」「参照」「根拠」が含まれる → Research
- 上記に当てはまらない場合 → Briefing には無関係として `excluded`

**注:** Implementation カテゴリ（Process, Build, Domain, Tooling, Review）に
該当するスキルは Briefing フェーズでは通常 `excluded` とする。
ただし、Frame や Validate に二次的に適用可能な場合は `conditional` とする。

## ステップ 3: アクティベーションモードを決定

各スキルにアクティベーションモードを割り当てる:

| モード | 意味 | 基準 |
| ------ | ---- | ---- |
| always-on | すべてのブリーフィングに適用 | Document カテゴリ（spec-doc, adr-doc）は常時必要 |
| conditional | 情報状態が条件に一致する場合に適用 | Entry Decision やタスク特性によってトリガー |
| excluded | このリポジトリの Briefing では使用されない | 実装フェーズ専用スキル、無関連ドメイン |

**Briefing 固有の活性化ルール:**

| 条件 | 活性化されるスキル |
| ---- | ---------------- |
| Entry Decision = A-1（Problem Framing） | Frame カテゴリの全 always-on + conditional |
| Entry Decision = A-2（Option Framing） | Frame カテゴリ（特に比較・評価系） |
| Entry Decision = A-3（Combined Discovery） | 全カテゴリの conditional を評価 |
| Entry Decision = A-5（Research Required） | Discover + Research カテゴリ |
| 外部 API/ライブラリが関係する | Discover + Research カテゴリ |
| 複数の実現方法が存在する | Frame + Validate カテゴリ |
| 前例のないアーキテクチャ判断 | Research + Validate カテゴリ |

## ステップ 4: 実行モードを分類（Rigid vs Flexible）

各スキルについて、そのプロセスにどの程度厳密に従う必要があるかを決定する:

| モード | 定義 | 適用方法 | 例 |
| ------ | ---- | -------- | -- |
| Rigid | 厳密なステップバイステップのプロセスを指定 | 正確に従う; ステップを飛ばしたり順序を変えない | `spec-doc`（テンプレート必須）、`adr-doc`（MADR 形式必須） |
| Flexible | 手順より原則を指定 | 精神を適用; 文脈に合わせる | `idea-refine`（発散→収束の原則）、`brainstorming`（対話型探索） |

**分類基準:**

- スキルが番号付きステップ、明示的なフェーズ、または必須テンプレートを定義している場合 → **Rigid**
- スキルが厳密な順序なしに目標、原則、またはチェックリストを定義している場合 → **Flexible**

## ステップ 5: デフォルトスタックを定義

すべてのブリーフィングの基盤となる `always-on` スキルを選択する。次の順序で:

1. **Frame** スキルが最初（問題を構造化）
2. **Document** スキルが最後（文書を生成）

Discover、Research、Validate は常に `conditional` — Entry Decision と情報状態によってアクティベーション。

**最小デフォルトスタック例:**

```text
1. [Document] spec-doc — always-on（全ブリーフィングで仕様書を生成）
2. [Document] adr-doc — always-on（全ブリーフィングで ADR を生成）
```

Frame カテゴリは Entry Decision が A-4（Direct Start）以外の場合に活性化される。

## ステップ 6: `briefing-profile.md` を生成

プロファイルをリポジトリルートに書き込む。
`assets/templates/briefing-profile-template.ja.md` のテンプレートを使用し、
`references/briefing-profile-schema.ja.md` に対して検証する。
生成されたプロファイルをユーザーに提示してから続行する。

## ステップ 7: 陳腐化チェック（プロファイルが存在する場合）

`briefing-profile.md` が既に存在する場合、検証する:

1. リストされたすべてのスキルソースが引き続き存在する。
2. リストされていない新しいスキルディレクトリが表示されていない。
3. `last_validated` の日付が 30 日以内である。

いずれかに違反する場合、ステップ 1 から再実行する。
