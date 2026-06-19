---
name: discovery-doc
description: briefing 中の探索結果・論点整理・代替案比較・ギャップ分析・仮説メモを、構造化された正本文書として docs/discovery/ に記録するときに使います。spec-doc と adr-doc の派生元となる起点成果物を生成します。オーケストレーターである briefing-flow の代替ではなく、文書生成担当として使います。
license: MIT
---

# Discovery Documentation Skill

この skill は、`docs/discovery/` 配下に構造化された discovery 文書を作成するために
使います。discovery 文書は、briefing または探索フェーズの中間成果物として、
探索目的・論点・代替案比較・暫定結論・未解決事項・spec-doc / adr-doc への
昇華候補をまとめて記録します。

**`briefing-flow` との役割分担**: `briefing-flow` はオーケストレーターであり、
情報収集プロセスを主導してどの skill を呼ぶかを決定します。`discovery-doc` は
文書生成担当であり、学習した内容をフロントマター付き正本文書として永続化します。
まず `briefing-flow` を実行し、探索出力を正本 artifact として残すときに
`discovery-doc` を呼び出してください。

## ワークフロー

1. 新規作成前に既存文書を確認する。
   ディレクトリと命名規約は `references/discovery-conventions.ja.md` に従います。
   `docs/discovery/`、`docs/specs/`、`docs/adr/` を確認し、重複した探索や
   既存の結論との矛盾を避けます。
2. 人間と探索スコープを確認する。
   きっかけ、答えようとしている問い、検討した代替案、調査証拠を確認します。
3. discovery 文書を作成する。

   **必須**: このステップの前に `references/discovery-conventions.ja.md` を読み込むこと —
   必須フロントマターフィールド、ファイル名規約、有効なステータス値が定義されています。

   **読み込まないもの**: `assets/templates/discovery.md` — `new_discovery.js` が自動的に使用します。

   ```bash
   node scripts/new_discovery.js --title "Explore auth strategy options"
   ```

   スクリプトを実行できない場合は、`assets/templates/discovery.ja.md`（日本語版テンプレート）を
   コピーして手動で埋めます。英語版は `assets/templates/discovery.md` です。

4. YAML フロントマターに意味付き relation を記録する。
   外部証拠・調査レポート・探索のきっかけとなった issue リンクは `relations.source`
   に記録します。
   この discovery から作成した spec や ADR を `relations.derived-by` で前向きに指します。
   方向性のない文脈的な関連は `relations.related` に記録します。
5. 結論を下流文書へ昇華する。
   探索が暫定結論に達したら `spec-doc` または `adr-doc` を作成し、この文書の
   `relations.derived-by` でリンクします。昇華候補を全て対処したらステータスを
   `resolved` に更新します。

## 必須内容

discovery 文書は次に答える必要があります。

- この文書が扱う探索目的または未解決の問いは何か。
- どのような制約（技術・プロダクト・ポリシー・タイムライン）があるか。
- どの代替案を検討し、それぞれのトレードオフは何か。
- どのような暫定結論または仮説が浮かび上がったか。
- どのような未解決事項が残っているか。
- この探索から作成すべき下流文書（spec, ADR, design）はどれか。
- 結論を裏付ける調査証拠や外部資料は何か。

discovery 文書は中間推論を意図的に記録します。最終的な判断は ADR に、
最終的な要件は spec に属します。

## フロントマター

生成される discovery 文書は YAML フロントマターを持ちます。

```yaml
---
id: "DISC-0001"
type: "discovery"
status: "draft"
title: "Explore auth strategy options"
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

ステータス値: `draft`, `active`, `resolved`, `archived`, `superseded`。

## ステータスライフサイクル

| ステータス | 意味 |
| --- | --- |
| `draft` | 探索進行中。結論はまだ確定していない。 |
| `active` | 探索が活発に進行中で、随時更新されている。 |
| `resolved` | 結論を spec-doc または adr-doc へ昇華済み。追加作業不要。 |
| `archived` | 昇華なしで探索を停止。参考資料として保持。 |
| `superseded` | より新しい discovery 文書に置き換え済み。 |

discovery 文書は「承認」または「実装」されません。`resolved` は、有用な出力が
下流文書に取り込まれたことを示します。`resolved` にする前に `relations.derived-by`
で下流文書をリンクしてください。

## レビューチェックリスト

discovery 文書を `draft` から `active` または `resolved` に進める前に、以下の
全項目を確認してください。いずれかのゲートに不合格なら、spec や ADR に
昇華する前に修正が必要です。

| # | ゲート | 合格基準 |
|---|--------|----------|
| 1 | **探索目的が明文化されている** | 対象とする問いまたはきっかけが曖昧でなく具体的である。 |
| 2 | **代替案が比較されている** | トレードオフを伴う選択肢が少なくとも 2 つ記述されている。 |
| 3 | **暫定結論が存在する** | 仮説または作業上の結論が少なくとも 1 つ記録されている。 |
| 4 | **未解決事項が列挙されている** | 残課題が明示されており、追跡できる状態である。 |
| 5 | **出典証拠がリンクされている** | 外部調査、issue リンク、ユーザー入力が `relations.source` に記録されている。 |
| 6 | **昇華先が特定されている** | spec、ADR、いずれも不要のどれに進むかが明確である。 |
| 7 | **最終判断が含まれていない** | アーキテクチャ判断は ADR に、要件は spec に属する。 |
| 8 | **ステータスが正しい** | フロントマター `status` が実際の探索状態を反映している。 |

## spec-doc・adr-doc との関係

このパッケージのライフサイクルでは、discovery 文書が spec と ADR 作成の上流起点です。
すべての feature で必須ではありません。要件が既に明確な場合は discovery を省略します。
問題空間が曖昧、複数の代替案がある、または重大な調査を行った場合に discovery を使います。

- **discovery から spec を作成する場合**: 探索でプロダクト意図が明確になったら
  `spec-doc` を作成し、discovery 文書の `relations.derived-by` でリンクします。
- **discovery から ADR を作成する場合**: 探索でアーキテクチャ判断が解決したら
  `adr-doc` を作成し、`relations.derived-by` でリンクします。
- **両方作成する場合**: briefing でプロダクト要件と技術判断の両方が明らかになったら、
  spec と ADR を並列で作成し、両方をリンクします。
- **昇華不要の場合**: 探索が実行可能な出力なしに終わったら、ステータスを
  `archived` に設定します。

上流方向のリンク: spec と ADR は `relations.derives-from` で、自身を生成した
discovery 文書へ逆向きに参照します。

## NEVER

- NEVER discovery 文書に最終判断を含める — アーキテクチャ判断は `adr-doc` に、
  要件は `spec-doc` に属する。discovery は推論プロセスを記録するものであり、結論ではない。
  「X を使う」という断言はレビューチェックリストのゲート違反
- NEVER `relations.derived-by` を設定する前に status を `resolved` にする —
  `resolved` は下流文書が存在しリンク済みであることを示すシグナル。リンク前に設定すると
  spec-doc と adr-doc が依存する追跡可能性の連鎖が壊れる
- NEVER `briefing-flow` を実行せずに discovery 文書を作成する — `briefing-flow` は
  探索を構造化するオーケストレーター。discovery-doc はその出力を永続化する担当。
  直接作成すると構造化された調査フェーズをスキップすることになる
- NEVER 要件が明確な問題に discovery 文書を書く — 何を作るか既にわかっているなら
  discovery を省略して spec-doc へ直接進む。discovery は曖昧な問題空間のためのもの
- NEVER 出典証拠を省略する — `relations.source` 参照のない discovery 文書は評価・
  再現・反論できない。すべての主張に追跡可能な出所が必要

## リソース

- `scripts/new_discovery.js`: discovery 文書を作成し、索引を更新します。
- `references/discovery-conventions.ja.md`: discovery 文書のディレクトリ、ファイル名、
  ステータス、relation、必須内容、索引の規約
  — **作成操作の前に必ず読み込むこと**
- `assets/templates/discovery.md`: 既定の discovery 本文テンプレートです。
  — `new_discovery.js` が自動的に使用します。**手動で読み込まないこと**
- `assets/templates/discovery.ja.md`: 日本語で手動作成するときの discovery 本文テンプレートです。
  — スクリプトが使えない場合のみ使用します
