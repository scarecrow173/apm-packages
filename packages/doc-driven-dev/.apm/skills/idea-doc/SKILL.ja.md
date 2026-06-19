---
name: idea-doc
description: discovery や spec 化の準備が整う前の、未仕様の着想・候補テーマ・保留論点を記録するときに使います。docs/ideas/ に軽量な正本記録を作成し、discovery-doc または spec-doc の起点にします。
license: MIT
---

# Idea Documentation Skill

この skill は、`docs/ideas/` 配下に軽量な idea 文書を作成するために使います。
idea 文書は、深掘り・仕様化の準備が整う前の早期の着想、候補テーマ、問題の兆候、
保留論点を記録します。

idea 文書は意図的に最小限の構成です。1ファイル1アイデアを徹底します。
目的は分析・判断ではなく、後から拾い上げるために着想を保存することです。

**役割分担:**

- `idea-doc` — 生の着想を捉える。素早く・軽量に・分析不要。
- `discovery-doc` — 探索を構造化する。代替案・トレードオフ・仮説を整理。
- `briefing-flow` — briefing プロセス全体をオーケストレーションする。
- `spec-doc` — 何を作るかを正式化する。

調べる問いを立てる前の段階で着想が生まれたときに `idea-doc` を使います。
アイデアが深掘りを必要とするなら `discovery-doc` へ進みます。
要件が既に明確なら `spec-doc` へ直接進みます。

## どのスキルをいつ使うか

| 状況 | 使うもの |
| --- | --- |
| 信号はあるが、まだ調べる問いがない | `idea-doc` |
| 問いがあり、代替案を比較したい | `discovery-doc` |
| 要件が既に明確で作り始められる | `spec-doc` へ直接進む |
| 既存の idea を更新または置き換える | 既存の `idea-doc` を更新または supersede する |
| idea にトレードオフ分析を書こうとしている | 止まって — その内容は `discovery-doc` に属する |

## ワークフロー

1. 着想を即座に捉える。
   完全に成熟していなくても構いません。不完全な記録の方が記録なしより良いです。
   `docs/ideas/` を確認し、重複を避けます。
2. idea 文書を作成する。

   **必須**: このステップの前に `references/idea-conventions.ja.md` を読み込むこと —
   必須フロントマターフィールド、ファイル名規約、有効なステータス値が定義されています。

   **読み込まないもの**: `assets/templates/idea.md` — `new_idea.js` が自動的に使用します。

   ```bash
   node scripts/new_idea.js --title "Support offline mode for mobile"
   ```

   スクリプトを実行できない場合は、`assets/templates/idea.ja.md` をコピーして手動で埋めます。

3. 出典を記録する（あれば）。
   着想のきっかけになったリンク・issue・会話を `relations.source` に記録します。
   外部 URL も有効な source 値です。
4. 次のアクションを決める。
   すぐに昇華・保留・破棄のどれかを決めます。
   テンプレートの `次のアクション` セクションを埋めます。
5. 準備が整ったら昇華する。
   探索が必要なら `discovery-doc` を、要件が明確なら `spec-doc` を作成し、
   この文書の `relations.derived-by` でリンクします。ステータスを `promoted` に更新します。

## 必須内容

idea 文書は次に答える必要があります。

- 中心的な着想を 1〜2 文で要約するとどうなるか。
- どのような問題・痛点・機会を対象にするか。
- 誰がどのように恩恵を受けるか。
- 正式化するために未解決の問いは何か。
- 即座の次のアクションは何か。

簡潔に保ちます。数段落以上かかるなら、`discovery-doc` または `spec-doc`
に進む準備ができています。

## フロントマター

生成される idea 文書は YAML フロントマターを持ちます。

```yaml
---
id: "IDEA-0001"
type: "idea"
status: "draft"
title: "Support offline mode for mobile"
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
  defers: []
  deferred-by: []
---
```

ステータス値: `draft`, `exploring`, `promoted`, `parked`, `archived`,
`superseded`。

## ステータスライフサイクル

| ステータス | 意味 |
| --- | --- |
| `draft` | 捉えたばかり。次のアクションがまだ決まっていない。 |
| `exploring` | 積極的に考えている。初期の証拠収集中かもしれない。 |
| `promoted` | discovery-doc または spec-doc へ引き継ぎ済み。この文書での追加作業は不要。 |
| `parked` | 後回しにした。保持はするが現在は非アクティブ。 |
| `archived` | 評価して追わないことにした。参考資料として保持。 |
| `superseded` | より新しい idea 文書に置き換え済み。 |

`promoted` にするのは、下流文書を作成して `relations.derived-by` でリンクした後にしてください。

## NEVER

- NEVER idea 文書を分析開始後に書く — 代替案を比較したりトレードオフを評価し始めたら
  `discovery-doc` を使うこと。idea-doc は信号を記録するものであり、分析ではない
- NEVER 複数の着想を 1 ファイルにまとめる — 1 ファイル 1 アイデアが追跡可能性の単位。
  まとめるとライフサイクル管理（park、promote、supersede）が曖昧になる
- NEVER 下流文書を作成・リンクする前に status を `promoted` にする — `promoted` は
  `relations.derived-by` が設定済みであることを示すシグナル。リンク前に設定すると
  下流ツールが復旧できない壊れた参照を生む
- NEVER アーキテクチャや実装の判断を idea に含める — 「X を使うべき、なぜなら Y」と
  書こうとしているなら、その内容は `discovery-doc` に属する
- NEVER idea-doc をスキップして新しい信号をいきなり discovery-doc にする — idea-doc は
  上流記録。なければ保留・放棄されたアイデアの置き場がなくなり、追跡可能性が失われる

## リソース

- `scripts/new_idea.js`: idea 文書を作成し、索引を更新します。
- `references/idea-conventions.ja.md`: idea 文書のディレクトリ、ファイル名、
  ステータス、relation、必須内容、索引の規約
  — **作成操作の前に必ず読み込むこと**
- `assets/templates/idea.md`: 既定の idea 本文テンプレートです。
  — `new_idea.js` が自動的に使用します。**手動で読み込まないこと**
- `assets/templates/idea.ja.md`: 日本語で手動作成するときの idea 本文テンプレートです。
  — スクリプトが使えない場合のみ使用します
