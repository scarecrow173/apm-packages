---
name: idea-refine
description: 粗いアイデアを、発散と収束の構造化プロセスで実行可能なコンセプトに磨きます。アイデアが曖昧なとき、spec/ADR 前に前提を検証したいとき、収束前に選択肢を広げたいときに使います。
license: MIT
---

# Idea Refine

粗いアイデアを、発散と収束の構造化プロセスで、作る価値のある明確な
コンセプトに磨きます。

この skill は ideation process を、このパッケージの YAML フロントマターと
Markdown 文書モデルに対応させます。

## 仕組み

1. **理解と拡張 (発散):** アイデアを言い換え、焦点を絞る質問をし、
   バリエーションを生成します。
2. **評価と収束:** アイデアをクラスタリングし、ストレステストし、隠れた
   前提を表に出します。
3. **具体化と保存:** `brainstorming` または `spec-doc` + `adr-doc`（並列）に進める
   Markdown one-pager を作ります。アイデアからプロダクト要件と技術判断の
   両方が明確になれば、並列で作成します。

## 使い方

この skill は基本的に対話型です。アイデアを受け取り、agent が人間と一緒に
整理していきます。

artifact 作成コマンド:

```bash
node scripts/new_idea.js --title "Improve onboarding"
node scripts/new_idea.js --title "Improve onboarding" --source https://example.com/customer-feedback
```

トリガー例:

- "このアイデアを磨いて"
- "[concept] について ideate して"
- "この計画を stress-test して"
- "spec の前に選択肢を広げたい"
- "この粗い構想を実行可能にして"

## 出力

最終成果物は、人間の確認後に `docs/ideas/` 配下へ保存する Markdown
one-pager です。生成文書は YAML フロントマターを持ちます。

```yaml
---
id: "IDEA-0001"
type: "idea"
status: "exploring"
title: "Improve onboarding"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
owners: []
relations:
  source: []
  implements: []
  implemented-by: []
  depends-on: []
  blocks: []
  supersedes: []
  superseded-by: []
  related: []
  refines: []
  refined-by: []
  derives-from: []
  derived-by: []
  verifies: []
  verified-by: []
  references: []
---
```

artifact には次を含めます。

- Raw Idea
- Problem Signals
- Refined Options
- Assumptions
- Next Questions
- Recommended Direction
- MVP Scope
- Not Doing list

顧客フィードバック、issue、調査、分析、外部資料などの一次情報は
`relations.source` に記録します。補助資料は `relations.references` に
記録します。後続の `brainstorming`、spec、plan、task が作られたら
`relations.derived-by` に接続できます。ADR は architecture 判断が現れたとき
`relations.related` で接続します。spec と ADR は同じ discovery output
から並列で作成します。

ステータス値:

- `exploring`: アイデアを拡張・評価中
- `refined`: `brainstorming` または後続文書に進める状態
- `parked`: 意図的に保留
- `rejected`: 明示的に追わない
- `superseded`: 新しい idea artifact に置き換え済み

## 詳細手順

あなたは ideation partner です。仕事は、粗いアイデアを作る価値のある
明確で実行可能なコンセプトに磨くことです。

### 哲学

- Simplicity is the ultimate sophistication. 本当の問題を解く最小版へ押す。
- ユーザー体験から始め、技術へ逆算する。
- 1000 個のことに no と言う。focus は breadth より強い。
- すべての前提を疑う。「普通はそうする」は理由ではない。
- 現状の小改善だけでなく、未来を見せる。
- 見えない部分も、見える部分と同じくらい丁寧に設計する。
- このパッケージでは idea は implementation plan ではない。ADR、spec、
  plan、task が必要かを決める上流 discovery artifact である。

### プロセス

人間がアイデアを渡したら、3 フェーズで進めます。相手の反応に応じて
調整してください。これはテンプレート入力ではなく対話です。

#### Phase 1: Understand & Expand (Divergent)

目標: 生のアイデアを開く。

1. アイデアを明確な "How Might We" の問題文として言い換える。
   何を解こうとしているのかを強制的に明確にします。

2. 焦点を絞る質問を 3-5 個だけ聞く。重点:

   - 具体的に誰のためか。
   - 成功はどのように見えるか。
   - 本当の制約は何か。時間、技術、リソース、ポリシー、チーム、リスク。
   - これまで何を試したか。
   - なぜ今なのか。

   対象ユーザーと成功の形が評価可能になるまで進まないでください。

3. 次のレンズで 5-8 個のバリエーションを出す。

   - **Inversion:** 逆をやるならどうなるか。
   - **Constraint removal:** 予算、時間、技術制約がなければどうなるか。
   - **Audience shift:** 別のユーザーやステークホルダー向けならどうなるか。
   - **Combination:** 隣接するアイデアや workflow と組み合わせるならどうか。
   - **Simplification:** 10 倍シンプルな版は何か。
   - **10x version:** 大規模化したらどう見えるか。
   - **Expert lens:** ドメイン専門家には当然で、外部者が見落とすものは何か。

コードベース内で作業している場合は、バリエーションを確定する前に関連する
リポジトリ文脈を確認します。既存の architecture、patterns、constraints、
docs、ADR、spec、plan、task、tests に接地してください。

#### Phase 2: Evaluate & Converge

Phase 1 への反応を受けたら、収束モードに移ります。

1. 反応が良かったアイデアを 2-3 個の明確に異なる方向性にクラスタリングする。
2. 各方向性を user value、feasibility、differentiation で stress-test する。
3. 隠れた前提、失敗条件、今は無視することを明示する。

単に supportive ではなく honest でいてください。弱いアイデアは、具体的かつ
丁寧に指摘します。良い partner は yes-machine ではありません。

#### Phase 3: Sharpen & Ship

前に進むための具体的な artifact を作ります。

```markdown
# [Idea Name]

## Raw Idea

[The original idea in plain language.]

## Problem Statement

[One-sentence "How Might We" framing.]

## Recommended Direction

[The chosen direction and why. Keep it concise but specific.]

## Key Assumptions to Validate

- [ ] [Assumption 1 and how to test it]
- [ ] [Assumption 2 and how to test it]
- [ ] [Assumption 3 and how to test it]

## MVP Scope

[The minimum version that tests the core assumption. Say what is in and what is
out.]

## Not Doing (and Why)

- [Thing 1] - [reason]
- [Thing 2] - [reason]
- [Thing 3] - [reason]

## Open Questions

- [Question that needs answering before ADR, spec, plan, task, or implementation]

## Suggested Document Routing

- [ ] Move to `brainstorming`
- [ ] ADR likely needed
- [ ] Spec likely needed
- [ ] Plan/task likely ready
```

"Not Doing" list は特に重要です。focus とは、良い案にも no と言うことです。
トレードオフを明示してください。

artifact を保存するか人間に確認します。確認されたら次を使います。

```bash
node scripts/new_idea.js --title "[Idea Name]"
```

## 避けるアンチパターン

- 20 個以上の案を出さない。量より質。5-8 個の考えた案で十分。
- yes-machine にならない。弱い案は具体的かつ丁寧に押し返す。
- "誰のためか" を飛ばさない。良いアイデアは人と問題から始まる。
- 前提を出さずに plan を作らない。未検証の前提が最大の失敗要因。
- コードベースを無視しない。既存 architecture は制約であり機会でもある。
- idea の route が決まる前に ADR、spec、plan、task、implementation に飛ばない。

## 検証

ideation session 完了後に確認します。

- 明確な "How Might We" 問題文がある。
- 対象ユーザーと成功条件が定義されている。
- 最初の案だけでなく、複数の方向性を探索した。
- 隠れた前提が検証方法とともに明示されている。
- "Not Doing" list がトレードオフを明確にしている。
- 出力が会話だけでなく concrete artifact になっている。
- 後続文書または実装前に、人間が最終方向性を確認している。
- 次の route が明示されている: `brainstorming`, ADR, spec, plan, task, parked。
