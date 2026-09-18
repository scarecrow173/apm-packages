# Test Spec 規約

この規約は、`test-spec-doc` が test specification 文書を作成、audit、index、
リンクする方法を定義します。

test spec は検証の意図を記録します。テストが何を保証するか、なぜ存在するか、
いつ廃止してよいかを記録する文書です。実行可能な Gherkin でもテスト結果ログ
でもありません。spec や design の大きな変更の際に「どの振る舞いを守るべきか」
「そのテストはまだ必要か」を coding agent が判断するための、永続的な契約です。

## ディレクトリ

リポジトリに既存の test spec ディレクトリがある場合はそれを維持します。
このパッケージのデフォルトに合わせるためだけに既存の test spec を
移動しません。

test spec ディレクトリがない場合は、デフォルトで `docs/test-specs/` を使います。

スクリプトが使う検出順序:

1. `docs/test-specs/`
2. `docs/test-spec/`
3. `test-specs/`
4. `test-spec/`

## ファイル名

デフォルトのファイル名パターン:

```text
title-with-dashes.md
```

規則:

- ファイル名は slug-only とし、小文字 ASCII で単語をダッシュで区切ります。
- テストファイルやスイートではなく、保証する振る舞いを名付けます。
- 例: `checkout-total-calculation.md`、`session-expiry.md`。

文書の同一性はファイル名やソート位置ではなく front matter の `id` に
あります。既存の `NNNN-<slug>.md` ファイル名も有効ですが、新規文書は常に
slug-only の名前を使います。

## 必須 Front Matter

test spec は共有 document front matter を使い、`type: "test-spec"` と
`TSPEC-` prefix の ID を持ちます。

```yaml
---
id: "TSPEC-6NbVcXzAsDfGhJkLpOiUyT"
type: "test-spec"
status: "draft"
title: "Checkout total calculation"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
owners: []
relations:
  verifies: []
  verified-by: []
  derives-from: []
---
```

共有の relation フィールドはすべて利用できます。上記はこの契約の中核となる
意味を持つものです。

## Status 値

| Status | 意味 |
| --- | --- |
| `draft` | 作成中または修正中。 |
| `proposed` | review 可能だが未承認。 |
| `approved` | 実装のための検証意図として承認済み。 |
| `deprecated` | もはや不要。存在理由の記録として保持。 |
| `superseded` | 新しい test spec に置き換えられた。 |

runtime の pass/fail を `status` に記録しません。テスト結果は揮発的なので、
`impl-doc` の experiment log や CI の証跡に記録します。

## Relations

| フィールド | 意味 |
| --- | --- |
| `verifies` | この test spec が検証する spec、design、ADR。少なくとも 1 件必須（TEST-SPEC-DOC-GATE-001）。 |
| `verified-by` | 必要に応じて、この文書を検証する task や test spec。 |
| `derives-from` | この test spec が検証可能な保証へ詳細化した spec や design。 |
| `depends-on` | この test spec が成立するために有効であり続ける必要のある文書。 |
| `supersedes` / `superseded-by` | test spec 間の置き換えリンク。 |
| `related` | 方向性のある依存を持たない文脈上の文書。 |

その振る舞いを実装する task は、自身の `verified-by` relation でこの test
spec を指し戻します。

relation の対象はリポジトリ相対パスまたはドキュメント ID（`TSPEC-<id>`
形式）で記述できます。`doc-status` の監査は、`verifies` の対象が spec、
design、ADR 以外の型に解決される場合（`test-spec-invalid-verifies-target`）、
および approved / in-progress / completed の plan が `verified-by` で
test spec をリンクせず `test-spec-skip` も記録していない場合
（`plan-missing-test-spec-evidence`）に警告を報告します。

## 必須コンテンツ

すべての test spec は template の固定セクションを使います。

| セクション | 答えるべき内容 |
| --- | --- |
| `Purpose` | この test spec がなぜ存在し、どの意図を維持し、いつ廃止してよいか。 |
| `Feature` | 仕様対象の振る舞い。Gherkin の Feature のように名付ける。 |
| `Rules` | feature が満たすべき不変条件または契約。 |
| `Examples` | rule を具体的に固定するシナリオ。Given/When/Then 形式も可だが必須ではない。step definition としての実行可能性は目的ではない。 |
| `Guarantees` | 正しい実装が保証すべきこと。 |
| `Non-goals` | この spec が意図的に検証しない振る舞いや範囲。 |
| `Risk` | これらの保証を失った場合に何が壊れ、何が失われるか。 |

`Purpose`、`Non-goals`、`Risk` は、大きな design や spec の変更後に未来の
agent がそのテストがまだ必要かを判断するための材料です。空のままに
しないでください。

## 他文書との境界

検証に関する内容は文書型ごとに分担されています。test spec が持つのは検証の
*意図*であり、他の文書はそれぞれの領域を持ちます。

| 文書 | 持つもの | 持たないもの |
| --- | --- | --- |
| `spec` | acceptance criteria——何が真であるべきか。 | 特定の保証がなぜ重要か、いつ廃止できるか。 |
| `plan` | step ごとの検証 command（Verification Matrix）。 | step 分割に依存しない振る舞いレベルの保証。 |
| `task` | その slice の実行可能な `## Verification` command。 | 保証の背後にある永続的な意図。 |
| `design` | design 自体を検証する Verification Notes。 | 実装後の振る舞いの保証。 |
| `adr` | 決定の確認 check。 | 継続的な振る舞いの検証。 |
| `impl-doc` | 何を試し結果がどうだったか（ir/exp）。 | 事前に成立すべきだった契約。 |
| `test-spec` | テストがなぜ存在し、何を保証し、いつ廃止できるか。 | 実行可能 command と実行結果。 |

意図の保存を必要としない保証——自明な acceptance criterion、一度きりの
manual check——は test spec を作らず spec や task に留めます。

## 変更可能性

- `draft` と `proposed` の test spec は自由に編集できます。
- `approved` の test spec は、保証する振る舞いを変えない範囲の明確化を
  受け付けます。
- 保証そのものが変わる場合は、approved の意図を書き換えるより新しい test
  spec または明示的な `supersedes`/`superseded-by` のペアを優先します。
- 保証をやめる場合は削除せず `deprecated` にします。なぜ存在したかの記録
  そのものが目的だからです。

## Index

デフォルトの index には `README.md` を使います。test spec をファイル名順の
Markdown テーブルで、共有の 4 列で列挙します。

| ID | Title | Status | File |
| --- | --- | --- | --- |
| TSPEC-6NbVcXzAsDfGhJkLpOiUyT | Checkout total calculation | approved | [checkout-total-calculation.md](checkout-total-calculation.md) |
