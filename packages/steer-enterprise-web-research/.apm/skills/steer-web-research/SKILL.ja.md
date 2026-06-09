---
name: steer-web-research
description: Web 調査、深掘り調査、最新情報の調査、情報源比較、ツールや論文の探索、技術動向調査、根拠付きレポート、または反復的な検索・監査・内省・再検索を求められたときに使うスキルです。SteER / Enterprise Deep Research 型のループ、つまりタスク分解、多様性を考慮した検索計画、適応的な停止・確認判断、証拠台帳、内省、十分性に基づく終了判定を実装します。
license: MIT
---

# SteER Web Research Skill

## 目的

単発検索ではなく、反復的なループを通じて根拠付き調査を行う。ユーザーが最新情報、公開 Web 調査、学術・ツール探索、技術・市場動向調査、または出典と情報源品質評価を含むレポートを求めた場合に使う。

このスキルは、既定では instruction-only である。ホスト側エージェントが、次の能力の一部または全部を持っていることを想定する。

- Web 検索
- ページ取得・読解
- 学術検索
- GitHub / リポジトリ検索
- ファイル / ドキュメント検索
- MCP ツール
- シェル / スクリプト

検索または取得ツールがない場合、調査結果を捏造してはならない。その環境に取得手段がないことを説明し、調査計画だけを作成する。

## コアモデル

### ベースディレクトリの決定

ユーザーが別のディレクトリを明示的に指定しない限り、次の優先順位でリポジトリ内の既存ディレクトリを検出し、最初に見つかったものをベースディレクトリとして使う。

1. `docs/research/`
2. `research/`
3. `docs/researchs/`
4. `researchs/`

いずれも存在しない場合は `doc/research/` を新規作成して使う。

以降、検出または作成されたベースディレクトリを `<BASE>` と表記する。

### トピックディレクトリ

`<BASE>` 直下にトピック名（調査テーマを短い英語スラッグにしたもの）のサブディレクトリを作成し、その中に作業成果物を配置する。

```
<BASE>/<topic>/
├── todo.md              # タスク計画と状態
├── persona.md           # 推定したユーザー目的、制約、好み、未解決の不確実性
├── query-log.md         # 実行した検索クエリとその理由
├── evidence-ledger.md   # 情報源ごとに抽出した証拠
├── running-summary.md   # 各ループ後の圧縮された統合メモ
├── audit.md             # 網羅性、矛盾、鮮度、引用の監査
└── final-report.md      # 最終回答 / レポート
```

例: ベースディレクトリが `research/` でトピックが `llm-cost-optimization` の場合、ファイルは `research/llm-cost-optimization/todo.md` のように配置される。

小さなチャットのみのタスクでは、この状態を内部的に保持してよい。ただし、回答内では同じ観点に従う。

## アルゴリズム

### 0. スコープとペルソナの初期化

次を抽出する。

- ユーザーの目的
- 必要な出力形式
- 時間的な鮮度要求
- 地域または法域
- ドメイン上の制約
- 情報源の好み
- 除外条件
- リスクレベル
- ユーザーが行おうとしている意思決定

軽量なペルソナモデルを作成する。

```markdown
# Persona / Intent Model

- User objective:
- Audience:
- Must-cover aspects:
- Nice-to-have aspects:
- Recency requirement:
- Source quality bar:
- Known constraints:
- Unknowns:
- Steering preference:
  - Ask early for high-level forks.
  - Do not interrupt for low-risk detail.
```

次のいずれかに該当する場合だけ、確認質問を行う。

- 複数の解釈があり、検索方向が大きく変わる。
- ユーザーの意思決定に必要な情報を推定できない。
- 法域、日付、製品 / バージョン、対象読者が不可欠である。
- そのまま進めると大きな検索コストを浪費しそうである。

それ以外の場合は、前提を明示して進める。

### 1. todo 駆動の分解

初期タスクを 3〜7 個作る。各タスクには次を持たせる。

- ID
- Status: `pending`, `in-progress`, `completed`, `canceled`
- Priority: 5〜10
- Domain: `official`, `general_web`, `academic`, `github`, `docs`, `enterprise`, `other`
- Evidence target
- Dependencies
- Provenance: `initial_query`, `knowledge_gap`, `steering`

このテンプレートを使う。

```markdown
| ID | Status | Priority | Domain | Task | Evidence target | Dependency | Provenance |
|---|---|---:|---|---|---|---|---|
| T1 | pending | 9 | official | ... | ... | - | initial_query |
```

### 2. 多様性を考慮した検索計画

各反復で、候補となる検索方向を生成する。次を含める。

- 直接的なキーワード検索
- 公式情報源検索
- 代替用語による検索
- 批判的 / 否定的検索
- 時間依存性がある場合の最新更新検索
- 技術的な場合の実装 / GitHub 検索
- 研究志向の場合の学術検索

多様なサブセットを選ぶ。ほぼ同じクエリを避ける。細かな変種を多数並べるより、相互補完的な観点を優先する。

この検索計画テンプレートを使う。

```markdown
| Query ID | Task ID | Query | Domain/tool | Rationale | Expected evidence | Freshness need |
|---|---|---|---|---|---|---|
```

### 3. 適応的な停止・確認判断

大きな分岐ごとに、ユーザーに確認するべきか判断する。実用上は次のスコアを使う。

```text
pause_gain =
  alignment_gain
+ ambiguity_risk
+ contradiction_risk
+ cost_of_wrong_branch
+ user_control_value
- interruption_cost
```

`pause_gain` が高い場合は確認する。不確実性が低い、または容易に戻せる場合は自律的に進める。

確認すべきトリガー:

- 出力が変わる複数の有力な調査方向がある。
- 高品質な証拠同士が矛盾している。
- 2 ループ後も証拠が不足している。
- ユーザーの好みが関連性を左右する。
- 検索コストが大きく増える直前である。
- 機密性のある enterprise / private data の境界が不明である。
- 情報源がログイン、支払い、スクレイピング、またはポリシー上注意が必要なアクセスを要求する。

確認する場合は、2〜5 個の具体的な選択肢と推奨デフォルトを提示する。曖昧な自由回答の質問は避ける。

### 4. 取得と証拠台帳

各情報源について次を記録する。

```markdown
| Source ID | URL/Location | Title | Publisher/Owner | Date | Source type | Reliability | Key evidence | Supports task | Limitations |
|---|---|---|---|---|---|---|---|---|---|
```

信頼性ラベル:

- `primary`: 公式ドキュメント、原論文、ソースリポジトリ、標準化団体、法規制当局
- `high`: 信頼できる報道、よく保守されたプロジェクトドキュメント、確立された分析 / 調査組織
- `medium`: 専門家ブログ、コミュニティドキュメント、パッケージメタデータ
- `low`: フォーラム / SNS 投稿、SEO コンテンツ、出典のない主張

ルール:

- 事実主張には一次情報源を優先する。
- 現在の製品 / ツール挙動については、公式ドキュメント、変更履歴、ソースリポジトリ、リリースノートを優先する。
- 論争のある主張では、少なくとも 2 つの独立した観点を含める。
- 否定的証拠、つまり失敗した検索や先行仮定と矛盾した情報源も記録する。
- 実際に確認していない情報源を引用してはならない。
- 長い引用を避ける。要約して出典を示す。

### 5. 内省ループ

各反復後に `running-summary.md` を更新する。

- 確認済みの発見
- 未裏付けだが有望な手掛かり
- 矛盾
- 残るギャップ
- 次の検索
- キャンセルまたは優先度変更するタスク

内省チェックリスト:

```markdown
## Coverage
- [ ] All must-cover aspects have evidence.
- [ ] Each high-priority task is completed or explicitly marked unresolved.

## Evidence
- [ ] Important factual claims have sources.
- [ ] Current/changing facts are supported by recent or official sources.
- [ ] Primary sources were preferred where available.

## Contradictions
- [ ] Conflicting claims are identified.
- [ ] Source quality explains which claim is more credible.

## Search Quality
- [ ] At least one official/primary-source search was attempted where applicable.
- [ ] At least one critical/negative search was attempted.
- [ ] Duplicates were removed.

## User Alignment
- [ ] Assumptions are explicit.
- [ ] The answer format matches the user's requested decision.
```

監査に失敗した場合は、次のいずれかに該当しない限り、追加の対象検索ループを行う。

- 環境に検索アクセスがない。
- 未解決ギャップを明示的に入手不能として記録した。
- さらに検索しても信頼度が改善しそうにない。

### 6. 終了条件

次のいずれかを満たした場合だけ停止する。

- 高優先度タスクがすべて完了し、主要な結論がそれぞれ証拠で支えられている。
- 残るギャップの影響が小さく、明示済みである。
- 少なくとも 2 つの異なる検索戦略を試したうえで、情報源を探し尽くした。
- ユーザーが停止を求めた。

もっともらしい回答が存在するという理由だけで停止してはならない。証拠の十分性を満たしたときに停止する。

### 7. 最終レポート形式

ユーザーが別形式を求めない限り、次の構造を使う。

```markdown
# Research Report: <topic>

## Scope and Assumptions

## Executive Summary

## Key Findings

## Evidence Matrix

| Claim | Support | Source IDs | Confidence | Notes |
|---|---|---|---|---|

## Analysis

## Gaps / Uncertainties

## Recommendations or Next Actions

## Source List
```

信頼度ラベル:

- `High`: 一次情報源または複数の独立した強い情報源がある。
- `Medium`: 信頼できるが、不完全または間接的である。
- `Low`: 限定的、古い、または単一情報源に依存している。

## 検索ドメインの指針

### 公式情報源

製品挙動、API 機能、価格、ポリシー、標準、法律、リリース変更、ベンダー機能について最初に使う。

### 学術情報源

論文、ベンチマーク、方法論、実証的主張、科学的 / 技術的新規性について使う。

### GitHub / リポジトリ情報源

実装状況、インストール可能性、ライセンス、コミット活動、issue、release、例について使う。ソースコード、release、issue が README の主張と矛盾する場合、README の主張だけで十分とみなしてはならない。

### Enterprise / 内部情報源

ユーザーが明示的に求めた場合、またはタスクが内部ドキュメント / プロジェクトに関する場合だけ使う。権限を尊重する。ユーザーが必要として明示的に求めていない限り、機密データを最終レポートに露出しない。

### ソーシャル / 専門家情報源

許可されたツールと公開・合法的なアクセス経路を通じてのみ使う。保護されたコンテンツをスクレイピングしたり、ログイン壁を迂回したりしない。ソーシャル上の主張は、裏付けがない限り低信頼として扱う。

## 避けるべき失敗モード

- 証拠監査なしの単発レポート
- 似た検索を過剰に繰り返す
- 早すぎる終了
- 矛盾を隠す
- 情報源の人気と信頼性を混同する
- 古いドキュメントを現在の情報として扱う
- 生成された要約を一次情報として扱う
- 低価値な選択でユーザーに頻繁に質問する
- 影響の大きい曖昧さがあるのに自律的に進める
