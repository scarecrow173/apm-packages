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
NNNN-タイトル-をダッシュ区切りで.md
```

ルール:

- `NNNN` は ideas ディレクトリ内でのゼロパディング連番です。
- タイトルスラグは英小文字 ASCII でダッシュ区切りにします。
- アイデアのテーマを表す短い名詞句を優先します。
- `idea.md` や `notes.md` のような曖昧な名前は避けます。
- 例: `0001-support-offline-mode-for-mobile.md`,
  `0002-introduce-event-sourcing.md`

## 必須フロントマター

idea 文書は共有文書フロントマターを使います。

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

必須フィールド:

| フィールド | 必須 | 説明 |
| --- | --- | --- |
| `id` | 必須 | 安定した文書識別子。常に `IDEA-NNNN` の形式。 |
| `type` | 必須 | `idea` 固定。 |
| `status` | 必須 | 現在のライフサイクル状態。 |
| `title` | 必須 | アイデアのテーマに対応した人間が読めるタイトル。 |
| `created` | 必須 | `YYYY-MM-DD` 形式の作成日。 |
| `updated` | 必須 | 実質的な最終更新日を `YYYY-MM-DD` 形式で。 |
| `owners` | 必須 | アイデアのフォローアップに責任を持つ人。 |
| `relations` | 必須 | 出典・関連文書へのリンク。 |

## ステータス値

以下のライフサイクルステータスを使います。

| ステータス | 意味 |
| --- | --- |
| `draft` | 捉えたばかり。次のアクションがまだ決まっていない。 |
| `exploring` | 積極的に考えている。初期の証拠収集中かもしれない。 |
| `promoted` | discovery-doc または spec-doc へ引き継ぎ済み。この文書での追加作業は不要。 |
| `parked` | 後回しにした。保持はするが現在は非アクティブ。 |
| `archived` | 評価して追わないことにした。参考資料として保持。 |
| `superseded` | より新しい idea 文書に置き換え済み。 |

下流文書を作成して `relations.derived-by` でリンクした後に `promoted` を
設定してください。

## リレーション

| フィールド | 意味 |
| --- | --- |
| `source` | このアイデアのきっかけになった外部リンク・issue・会話・観察。 |
| `derived-by` | このアイデアから生まれた下流の discovery-doc または spec-doc。 |
| `supersedes` | この文書が置き換える古い idea 文書。 |
| `superseded-by` | この文書を置き換えた新しい idea 文書。 |
| `related` | 方向依存のない文脈的な関連文書。 |

リレーションは最小限に保ちます。idea 文書はリレーション全項目を埋める
必要はありません。`source` と `derived-by` が主要な使用箇所です。

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

## 昇華ルール

アイデアが深掘りや正式化の準備が整ったら:

1. 下流文書（`discovery-doc` または `spec-doc`）を作成する。
2. `relations.derived-by` でリンクする。
3. ステータスを `promoted` に更新する。
4. idea 文書を上流の監査証跡として保持する。

idea の内容を spec や discovery 文書に移動させないでください。idea 文書は
軽量な事前記録として機能します。正式な作業は下流文書型に属します。

## 索引

`README.md` を既定の ideas 索引として使います。

idea 文書をファイル名順に4列の Markdown テーブルで列挙します。

| ID | Title | Status | File |
| --- | --- | --- | --- |
| IDEA-0001 | Support offline mode for mobile | promoted | [0001-support-offline-mode-for-mobile.md](0001-support-offline-mode-for-mobile.md) |

索引ルール:

- 正確に `ID`、`Title`、`Status`、`File` の4列を使います。`ID`・`Title`・`Status`
  は文書フロントマターから取得し、`File` 列は索引ディレクトリ内の相対リンクです。
  値が欠損している場合は `—` と書きます。
- ファイル名の昇順で行をソートします。
- idea 文書が追加されるたびに索引を更新します。

## サブディレクトリのグループ化

大規模なリポジトリでは、プロダクトエリアやチームごとにサブディレクトリに
分割することができます。

```text
docs/ideas/
  mobile/
    0001-support-offline-mode.md
  platform/
    0001-introduce-event-sourcing.md
```

フラットなディレクトリが探しにくい場合にのみこのパターンを使います。
番号付けは各サブディレクトリ内でローカルに管理します。
