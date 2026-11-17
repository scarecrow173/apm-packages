# Idea 規約

この規約は、`idea-doc` が idea 文書を作成・監査・索引・ルーティングする方法を定義します。

idea 文書は、探索や仕様化の準備が整う前の、未仕様の早期の着想を記録します。
ライフサイクルの中で最も軽量な文書型です。1ファイル1アイデアを原則とし、
内容は簡潔に保ちます。

## ディレクトリ

既定では `docs/ideas/` を使います。他のプロジェクトドキュメントと並んで
アイデアを可視化できます。

スクリプトが使用する検出順序:

1. `docs/ideas/`

この規約に合わせるためだけに既存ファイルを移動しないでください。
リポジトリに明示的に異なる規約がある場合のみ `--dir` を使います。

## ファイル名

既定のファイル名パターン:

```text
タイトル-をダッシュ区切りで.md
```

ルール:

- ファイル名は slug-only とし、小文字 ASCII で単語をダッシュで区切ります。
- アイデアのテーマを表す短い名詞句を優先します。
- `idea.md` や `notes.md` のような曖昧な名前は避けます。
- 例: `support-offline-mode-for-mobile.md`,
  `introduce-event-sourcing.md`

文書の同一性はファイル名やソート位置ではなく front matter の `id` に
あります。既存の `NNNN-<slug>.md` ファイル名も有効ですが、新規文書は常に
slug-only の名前を使います。既存ファイルの移行には `doc-maintenance/scripts` の `migrate_ids.js` を使います。

## 必須フロントマター

idea 文書は共有文書フロントマターを使います。

```yaml
---
id: "IDEA-4MnBvCxZaSdFgHjKlPoIuY"
type: "idea"
status: "draft"
lifecycle: "draft"
title: "Support offline mode for mobile"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
owners: []
relations:
  source: []
  changes:
    added: []
    modified: []
    deleted: []
    renamed: []
    moved: []
    generated: []
  motivates: []
  supersedes: []
---
```

必須フィールド:

| フィールド | 必須 | 説明 |
| --- | --- | --- |
| `id` | 必須 | 安定した文書識別子。`IDEA-<22文字Base62>` 形式（UUIDv7由来。従来の `IDEA-NNNN` も有効）。 |
| `type` | 必須 | `idea` 固定。 |
| `status` | 必須 | 型固有のワークフロー状態（後述のステータス値を参照）。 |
| `lifecycle` | 必須 | Registry 3 ライフサイクル。`draft` / `current` / `superseded` / `retired`。`status` と独立で、アクティブ／セットル索引区分を駆動する。 |
| `title` | 必須 | アイデアのテーマに対応した人間が読めるタイトル。 |
| `created` | 必須 | `YYYY-MM-DD` 形式の作成日。 |
| `updated` | 必須 | 実質的な最終更新日を `YYYY-MM-DD` 形式で。 |
| `owners` | 必須 | アイデアのフォローアップに責任を持つ人。 |
| `relations` | 必須 | 出典・関連文書へのリンク。 |

## ステータス値

以下の型固有ワークフローステータスを使います（Document Registry が所有する
`lifecycle` フィールドとは別軸）。

| ステータス | 意味 |
| --- | --- |
| `draft` | 捉えたばかり。次のアクションがまだ決まっていない。 |
| `exploring` | 積極的に考えている。初期の証拠収集中かもしれない。 |
| `promoted` | discovery-doc または spec-doc へ引き継ぎ済み。この文書での追加作業は不要。 |
| `parked` | 後回しにした。保持はするが現在は非アクティブ。 |
| `archived` | 評価して追わないことにした。参考資料として保持。 |
| `superseded` | より新しい idea 文書に置き換え済み。 |

下流文書を作成した後に `promoted` を設定してください。Knowledge Relations
v1 では idea は `relations.motivates` に source→target で動機付けた spec を
記録します。下流側は逆リンクを保存しません — spec 側の `motivated-by` は
派生投影です。

## リレーション

Knowledge Relations v1 では idea は宣言済みの順方向 field と出典用の
`relations.source` だけを格納します。

| フィールド | 対象 | 意味 |
| --- | --- | --- |
| `motivates` | spec | このアイデアが動機づける spec — idea 側に source→target で記録。 |
| `supersedes` | idea | この文書が置き換える古い idea 文書。 |

逆名（`motivated-by`、`superseded-by`）は派生投影であり、構造上一貫して
導かれるため保存しません。`relations.source` は外部出典（リンク・issue・
会話・観察）を保持し、`relations.changes` は文書リンクではなく出典の
変更セットです。

v3 以前のキー（`implements`、`implemented-by`、`depends-on`、`blocks`、
`superseded-by`、`related`、`refines`、`refined-by`、`derives-from`、
`derived-by`、`verifies`、`verified-by`、`references`、`defers`、
`deferred-by`）はマイグレーション領域の入力にすぎません。`doc-status`
はこれらを `legacy-relation-field` 指摘として報告し、現行グラフの辺として
解決・走査されることはありません。

リレーションは最小限に保ちます。idea 文書はリレーション全項目を埋める
必要はありません。`source` と `motivates` が主要な使用箇所です。

何かがきっかけで生まれた idea では、作成時に `source` を記録します —
供給先の上流 spec・plan・問い、またはきっかけとなったリンク・issue・
会話が該当します。出典が記録されない idea は出所を追跡できません。

## 必須内容

すべての idea 文書は次の問いに答える必要があります。

1. 中心的な着想を 1〜2 文で要約するとどうなるか。
2. どのような問題・痛点・機会を対象にするか。
3. 誰がどのように恩恵を受けるか。
4. 正式化するために未解決の問いは何か。
5. 即座の次のアクションは何か。

簡潔に保ちます。良い idea 文書は1画面に収まります。それより長くなるなら、
`discovery-doc` へ進む準備ができています。

## 1ファイル1アイデア

各 idea 文書は、1つの独立したアイデアを記録します。会議や会話で
複数のアイデアが生まれた場合は、それぞれ別ファイルを作成します。
無関係なアイデアを1つの文書にまとめないでください。

同じ idea の絞り込み・スコープ調整・park は既存ファイルのその場更新
（書き直す場合は `supersedes` リンク）で行い、新規ファイルが意味を持つのは
真に異なる idea のときだけです。

## 昇華ルール

アイデアが深掘りや正式化の準備が整ったら:

1. 下流文書（`discovery-doc` または `spec-doc`）を作成する。
2. 下流文書が spec の場合は `relations.motivates` でリンクする
   （供給先の discovery についてはその discovery 自身の relations
   がリンクを持つ）。
3. ステータスを `promoted` に更新する。
4. idea 文書を上流の監査証跡として保持する。

idea の内容を spec や discovery 文書に移動させないでください。idea 文書は
軽量な事前記録として機能します。正式な作業は下流文書型に属します。

## 索引

`README.md` を既定の ideas 索引として使います。

idea 文書をファイル名順に4列の Markdown テーブルで列挙します。

| ID | Title | Status | File |
| --- | --- | --- | --- |
| IDEA-4MnBvCxZaSdFgHjKlPoIuY | Support offline mode for mobile | promoted | [support-offline-mode-for-mobile.md](support-offline-mode-for-mobile.md) |

索引ルール:

- 正確に `ID`、`Title`、`Status`、`File` の4列を使います。`ID`・`Title`・`Status`
  は文書フロントマターから取得し、`File` 列は索引ディレクトリ内の相対リンクです。
  値が欠損している場合は `—` と書きます。
- 行は各層ごとにファイル名の昇順で並べます。in-flight の idea は先頭の
  テーブルに、settled なステータス（`promoted`、`parked`、`archived`、
  `superseded`）の idea は下段の `## Settled` テーブルにファイル名昇順で
  掲載します。Settled の行もリンクは維持され、履歴を隠さずに強調を抑える
  構成です。
- idea 文書の追加や `status` の変更時は索引を更新してください — materialize は
  `doc_maintenance.js index plan|apply` で明示的に行います（creator は索引を
  書き込みません）。実行するまでの間、`doc_status lint` がドリフト
  （`index-metadata-mismatch`、`index-ordering`）を報告します。

## サブディレクトリのグループ化

大規模なリポジトリでは、プロダクトエリアやチームごとにサブディレクトリに
分割することができます。

```text
docs/ideas/
  mobile/
    support-offline-mode.md
  platform/
    introduce-event-sourcing.md
```

フラットなディレクトリが探しにくい場合にのみこのパターンを使います。
