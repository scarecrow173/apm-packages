# Discovery 規約

これらの規約は、`discovery-doc` が discovery 文書をどのように作成・監査・
索引付け・ルーティングするかを定義します。

discovery 文書は、briefing または探索フェーズの中間成果物を記録します。
探索目的・論点・代替案比較・暫定結論・未解決事項・昇華候補が対象です。
spec-doc と adr-doc が派生する上流起点であり、「承認」または「実装」される
文書ではありません。

## ディレクトリ

デフォルトは `docs/discovery/` を使います。ADR・spec・その他のプロジェクト文書と
近い場所に置きつつ、確定済み成果物と視覚的に区別できます。

既存文書をこの規約に合わせるだけのために移動しないでください。リポジトリに
discovery または brainstorm ディレクトリが既にある場合はそのまま使います。

スクリプトが使う検出順序:

1. `docs/discovery/`

検出リストと異なる明示的な規約をリポジトリが持つ場合のみ `--dir` を使います。

## ファイル名

デフォルトのファイル名パターン:

```text
NNNN-title-with-dashes.md
```

ルール:

- `NNNN` は discovery ディレクトリ内でゼロ埋めした通し番号。
- タイトルスラグは小文字 ASCII でダッシュ区切り。
- 探索トピックに名前を付けた短い名詞句を優先する。
- `research.md` や `notes.md` のような曖昧な名前は避ける。
- 例: `0001-explore-auth-strategy-options.md`,
  `0002-evaluate-event-bus-alternatives.md`。

リポジトリがスラグのみのファイル名を既に使っている場合は、その規約に従います。

## 必須フロントマター

discovery 文書は共有フロントマターを使います。

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

必須フィールド:

| フィールド | 必須 | 説明 |
| --- | --- | --- |
| `id` | Yes | 安定した文書識別子。常に `DISC-NNNN` 形式。 |
| `type` | Yes | `discovery` 固定。 |
| `status` | Yes | 現在のライフサイクル状態。 |
| `title` | Yes | 探索トピックに対応した人間向けタイトル。 |
| `created` | Yes | `YYYY-MM-DD` 形式の作成日。 |
| `updated` | Yes | `YYYY-MM-DD` 形式の最終実質的更新日。 |
| `owners` | Yes | 探索に責任を持つ人またはグループ。 |
| `relations` | Yes | 出典や関連文書への意味付きリンク。 |

## ステータス値

次のライフサイクルステータスを使います。

| ステータス | 意味 |
| --- | --- |
| `draft` | 探索進行中。結論はまだ確定していない。 |
| `active` | 探索が活発に進行中で、随時更新されている。 |
| `resolved` | 結論を spec-doc または adr-doc へ昇華済み。追加作業不要。 |
| `archived` | 昇華なしで探索を停止。参考資料として保持。 |
| `superseded` | より新しい discovery 文書に置き換え済み。 |

discovery 文書は「承認」または「実装」されません。`resolved` にするのは、
昇華候補を全て対処して `relations.derived-by` でリンクした後にしてください。

## Relations

relation フィールドは文書の型ではなく意味を表します。

| フィールド | 意味 |
| --- | --- |
| `source` | 外部の一次証拠: 調査レポート・issue リンク・ユーザーインタビュー・ベンチマーク。 |
| `derives-from` | この探索のきっかけとなった広義の文脈または上流成果物。 |
| `derived-by` | この discovery の結論から作成された下流の spec または ADR。 |
| `supersedes` | この文書に置き換えられた古い discovery 文書。 |
| `superseded-by` | この文書を置き換えた新しい discovery 文書。 |
| `related` | 方向性のない文脈的な関連。 |
| `references` | 参考にしたが一次情報ではない補助資料。 |
| `defers` | この文書から意図的に据え置いた将来の探索。 |
| `deferred-by` | この探索を後のフェーズに据え置いた文書。 |

内部文書は相対パス、外部情報は URL を使います。可能な限り双方向にリンクします。

- discovery から spec を生成した場合: discovery の `relations.derived-by` を spec に向ける；
  spec の `relations.derives-from` をこの discovery に向ける。
- discovery を別の discovery で置き換えた場合: 古い文書の `relations.superseded-by` と
  新しい文書の `relations.supersedes` を両方設定する。

## 必須内容

すべての discovery 文書は次に答える必要があります。

1. この文書が扱う探索目的または未解決の問いは何か。
2. どのような制約（技術・プロダクト・ポリシー・タイムライン）があるか。
3. どの代替案を検討し、それぞれのトレードオフは何か。
4. どのような暫定結論または仮説が浮かび上がったか。
5. どのような未解決事項が残っているか。
6. どの下流文書（spec, ADR, design）を作成すべきか。
7. 結論を裏付ける調査証拠や外部資料は何か。

結論は spec または ADR に昇華されるまで、仮説として明確にラベル付けして保持します。

## 可変性

discovery 文書は昇華されるまでの作業メモです。

- `draft` および `active` は自由に編集できます。
- `resolved` は歴史的証拠として扱います。`resolved` 済みの記録を書き直すより、
  日付付きのメモや新しい discovery 文書を優先します。
- `archived` は探索の文脈を保持します。上書きしないでください。
- ステータス・オーナー・relation の更新は、どのステータスでも in-place 編集で構いません。

## 1ファイル1テーマの原則

各 discovery 文書は単一の探索トピックを扱います。briefing が複数の独立した問いに
ついての知見を生み出した場合は、問いごとに別の discovery 文書を作成します。
単一トピックの大規模な探索は、アプローチや判断軸で分割できますが、分割は
それぞれ異なる spec または ADR 候補に対応させます。

## 昇華ルール

discovery 文書の結論が spec または ADR に取り込まれたら:

1. `relations.derived-by` で下流文書をリンクする。
2. ステータスを `resolved` に設定する。
3. 監査証跡として discovery 文書を保持する。

discovery 文書を `docs/specs/` や `docs/adr/` に移動しないでください。最終的な
判断は、固有のライフサイクルステータスを持つ独立した文書型に属します。
調査証拠は `docs/research/`（別途 research ディレクトリを使う場合）に残し、
`relations.source` でリンクします。

## 索引

デフォルト索引として `README.md` を使います。

discovery 文書をファイル名順の 4 列 Markdown テーブルとして列挙します。

| ID | Title | Status | File |
| --- | --- | --- | --- |
| DISC-0001 | Explore auth strategy options | resolved | [0001-explore-auth-strategy-options.md](0001-explore-auth-strategy-options.md) |

索引ルール:

- 列は `ID`, `Title`, `Status`, `File` の 4 列のみを使います。`ID`・`Title`・`Status`
  はフロントマターから取得し、`File` 列は索引ディレクトリ内の相対リンクです。
  値が欠如している場合は `—` と記載します。
- 行はファイル名の昇順でソートします。
- 新しい discovery 文書を追加するたびに索引を更新します。

## サブディレクトリ分類

大規模リポジトリでは、プロダクトエリアまたは調査ドメインで discovery 文書を分割できます。

```text
docs/discovery/
  auth/
    0001-explore-auth-strategy-options.md
  infrastructure/
    0001-evaluate-event-bus-alternatives.md
```

フラットなディレクトリが見づらくなったときだけ使います。採番は各サブディレクトリ内で
ローカルに管理します。
