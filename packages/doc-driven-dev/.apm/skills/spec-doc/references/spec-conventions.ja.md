# Spec Conventions

この規約は、`spec-doc` が仕様文書を作成、監査、索引化、ルーティングする方法を
定義します。

spec は、何を作るべきか、なぜ必要かを定義する上流文書です。この
パッケージでは、spec がプロダクト意図と実装向け挙動の両方を扱います。
それらを別の要求文書には分けません。

## ディレクトリ

リポジトリに既存の spec ディレクトリがある場合はそれを維持します。この
パッケージの既定値に合わせるためだけに既存 spec を移動しないでください。

spec ディレクトリがない場合は、既定で `docs/specs/` を使います。ADR、plan、
task、その他のプロジェクト文書の近くに置くためです。

スクリプトの検出順序:

1. `docs/specs/`
2. `docs/spec/`
3. `specs/`
4. `spec/`

複数の候補がある場合は、既に spec ファイルと索引ファイルを持つ
ディレクトリを優先します。検出リストにない明示的なリポジトリ規約がある場合
だけ `--dir` を使います。

## ファイル名

既定のファイル名:

```text
title-with-dashes.md
```

ルール:

- ファイル名は slug-only とし、小文字 ASCII で単語をダッシュで区切ります。
- 機能、ワークフロー、外部から見える挙動を表す短い動詞句または名詞句を
  優先します。
- `feature.md`, `updates.md`, `misc.md` のような曖昧な名前は避けます。
- 例: `define-checkout-flow.md`, `add-team-invitations.md`。

文書の同一性はファイル名やソート位置ではなく front matter の `id` に
あります。既存の `NNNN-<slug>.md` ファイル名も有効ですが、新規文書は常に
slug-only の名前を使います。既存ファイルの移行には `doc-maintenance/scripts` の `migrate_ids.js` を使います。

## 必須フロントマター

spec は共通 document front matter を使います。

```yaml
---
id: "SPEC-034qPUpBj0VYOqxmFLijD5"
type: "spec"
status: "draft"
lifecycle: "draft"
title: "Define checkout flow"
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
  supersedes: []
---
```

必須フィールド:

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | 安定した文書 ID。`SPEC-<22文字Base62>` 形式（UUIDv7由来。従来の `SPEC-NNNN` も有効）。 |
| `type` | Yes | `spec` 固定。 |
| `status` | Yes | 型固有のワークフロー状態（後述）。 |
| `lifecycle` | Yes | Registry 3 ライフサイクル。`draft` / `current` / `superseded` / `retired`。`status` と独立で、アクティブ／セットル索引区分を駆動する。 |
| `title` | Yes | 文書の意図に合う人間向けタイトル。 |
| `created` | Yes | 作成日。`YYYY-MM-DD` 形式。 |
| `updated` | Yes | 最後に実質更新した日。`YYYY-MM-DD` 形式。 |
| `owners` | Yes | spec に責任を持つ人またはグループ。 |
| `relations` | Yes | 出典や関連文書への意味付きリンク。 |

## ステータス値

次の型固有ワークフローステータスを使います（Document Registry が所有する
`lifecycle` フィールドとは別軸）。

| Status | Meaning |
| --- | --- |
| `draft` | 作成・整理中。 |
| `proposed` | レビュー可能だが未承認。 |
| `approved` | 実装計画の根拠として承認済み。 |
| `implemented` | 実装・検証済み。 |
| `superseded` | 新しい spec に置き換え済み。 |
| `rejected` | 明示的に追わない。 |

`status` は spec のワークフロー状態に集中させ、ライフサイクルは
`lifecycle` に記録します（置き換え時は `superseded`）。Knowledge Relations
v1 では置き換え側が `relations.supersedes` のみを source→target に記録
します。`superseded-by` は派生される逆投影であり、書き込みません。

## Relations

Knowledge Relations v1 では spec は宣言済みの順方向 field と出典用の
`relations.source` だけを格納します。spec は capture-layer
（`motivates`）、decision（`decides-for`）、design（`realizes`）の辺の
*target* であり、source ではありません。

| Field | Targets | Meaning |
| --- | --- | --- |
| `supersedes` | spec | この spec が置き換える古い spec。 |

逆名（`superseded-by`、および他文書がこの spec に投影する `motivated-by`、
`decided-by`、`realized-by` の内向きビュー）は派生投影であり、構造上
一貫して導かれるため保存しません。`relations.source` は外部出典（URL、
issue、出典資料）を保持し、`relations.changes` は文書リンクではなく
出典の変更セットです。

v3 以前のキー（`implements`、`implemented-by`、`depends-on`、`blocks`、
`superseded-by`、`related`、`refines`、`refined-by`、`derives-from`、
`derived-by`、`verifies`、`verified-by`、`references`、`defers`、
`deferred-by`）はマイグレーション領域の入力にすぎません。`doc-status`
はこれらを `legacy-relation-field` 指摘として報告し、変換は
マイグレーションツールが担い、現行グラフの辺として解決・走査される
ことはありません。

内部文書には相対パスまたは文書 ID を使います。外部出典には URL を
使います。置き換え関係では順方向の辺だけを保存します。

- 新 spec: `relations.supersedes` が古い spec を指す — 旧 spec 側の
  `superseded-by` ビューは派生されるもので、書き込みません。

## 必須内容

spec は次に答えます。

1. 何を作るべきか。
2. なぜ今それが必要か。
3. 誰が恩恵を受けるか。
4. 何を範囲に含め、何を範囲外にするか。
5. どの挙動、インターフェース、ワークフロー、文書成果物が必要か。
6. どの受け入れ基準で正しさを判断するか。
7. どの出典、ADR、discovery note が根拠か。

受け入れ基準は検証可能である必要があります。`うまく動く` や `直感的である`
のような基準は、観測可能な挙動で裏付けられない限り避けます。

基準は spec に保持します。個別に参照する必要がある基準には、安定した
Claim ID — クレーム本文の横に置く `<!-- claim:R-01 -->` のような HTML
コメントマーカー — を付けられます。これにより verification design と
evidence が編集や書き換えを越えて `SPEC-<id>::R-01` として参照できます
（#239/#240）。マーカーは front matter ではなく spec 本文に宣言します。

## 可変性

spec は計画入力であり、ADR のような不変の決定記録ではありません。

- `draft` と `proposed` の spec は自由に編集できます。
- `approved` の spec は、範囲を変えない明確化であれば追記できます。
- 承認後に範囲、挙動、受け入れ基準を大きく変える場合は、新しい spec を作るか
  古い spec を明示的に supersede します。supersede するときは新しい spec が
  `supersedes` で古い spec を指し（逆方向は派生）、置き換えた spec を
  参照し続ける進行中の依存文書を付け替えるかクローズします。
- `implemented` の spec は履歴証拠として扱います。実装済みの意図を書き換える
  より、日付付き note または superseding spec を優先します。
- status、owner、relation の更新は同一ファイル内で許容します。
- audit report は、不足している要求、出典、受け入れ基準を作り出してはいけません。

## 索引

既定の spec 索引は `README.md` です。リポジトリが既に `index.md` を
使っている場合はそれを維持します。

索引は spec をファイル名順に並べ、次の 4 列の Markdown テーブルで掲載します。

| ID | タイトル | Status | ファイル |
| --- | --- | --- | --- |
| SPEC-034qPUpBj0VYOqxmFLijD5 | Define checkout flow | approved | [define-checkout-flow.md](define-checkout-flow.md) |

索引ルール:

- 列は `ID` / `タイトル` / `Status` / `ファイル` の 4 列に固定します。`ID`・
  `タイトル`・`Status` は front matter から取り、`ファイル` 列は索引と同じ
  ディレクトリへの相対リンクにします。値が無い場合は `—` を入れます。
- 行は各層ごとにファイル名の昇順で並べます。in-flight の spec は先頭の
  テーブルに、settled なステータス（`implemented`、`superseded`、`rejected`）の
  spec は下段の `## Settled` テーブルにファイル名昇順で掲載します。Settled の
  行もリンクは維持され、履歴を隠さずに強調を抑える構成です。
- 文書の追加や `status` の変更時は索引を更新してください — materialize は
  `doc_maintenance.js index plan|apply` で明示的に行います（creator は索引を
  書き込みません）。実行するまでの間、`doc_status lint` がドリフト
  （`index-metadata-mismatch`、`index-ordering`）を報告します。
- managed index は in-flight テーブル 1 本と任意の `## Settled` 層だけ
  です。1 層内の 2 本目のテーブル、または他の `##` 見出し配下の
  テーブルは `doc_status lint` が `index-unparseable` として報告します。
  項目が増えてきたら索引内に見出しテーブルを増やすのではなく、
  owned ディレクトリ（それぞれが managed index を持つ）へ文書を分けて
  ください。

## サブディレクトリ管理

### カテゴリ別サブディレクトリ

大きなリポジトリでは、product area、platform area、documentation area、team
などで spec をサブディレクトリに分けても構いません。

```text
docs/specs/
  product/
    team-invitations.md
  platform/
    api-rate-limits.md
  docs/
    document-lifecycle.md
```

ファイル名はディレクトリ内で一意であればよいです。構造が大きくなる前に、
カテゴリ分けの方針を索引に記録します。フラットなディレクトリが
読みにくくなった場合だけ使います。

### 機能別サブディレクトリ

1つの機能に関連 spec が複数必要になる場合は、機能単位でサブディレクトリを
切っても構いません。

```text
docs/specs/
  checkout/
    define-checkout-flow.md
    checkout-api-contract.md
    checkout-edge-cases.md
```

まとめて読むべき spec 群がある場合に使います。
