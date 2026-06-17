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

複数の候補がある場合は、番号付き spec ファイルと索引ファイルを持つ
ディレクトリを優先します。検出リストにない明示的なリポジトリ規約がある場合
だけ `--dir` を使います。

## ファイル名

既定のファイル名:

```text
NNNN-title-with-dashes.md
```

ルール:

- `NNNN` は spec ディレクトリ内で連番になるゼロ埋め番号です。
- title slug は小文字 ASCII にし、単語をダッシュで区切ります。
- 機能、ワークフロー、外部から見える挙動を表す短い動詞句または名詞句を
  優先します。
- `feature.md`, `updates.md`, `misc.md` のような曖昧な名前は避けます。
- 例: `0001-define-checkout-flow.md`,
  `0002-add-team-invitations.md`。

リポジトリが slug-only のファイル名を既に使っている場合は、番号付けを
導入せず既存規約に従います。

## 必須フロントマター

spec は共通 document front matter を使います。

```yaml
---
id: "SPEC-0001"
type: "spec"
status: "draft"
title: "Define checkout flow"
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

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | 安定した文書 ID。通常は `SPEC-NNNN`。 |
| `type` | Yes | `spec` 固定。 |
| `status` | Yes | 現在のライフサイクル状態。 |
| `title` | Yes | 文書の意図に合う人間向けタイトル。 |
| `created` | Yes | 作成日。`YYYY-MM-DD` 形式。 |
| `updated` | Yes | 最後に実質更新した日。`YYYY-MM-DD` 形式。 |
| `owners` | Yes | spec に責任を持つ人またはグループ。 |
| `relations` | Yes | 出典や関連文書への意味付きリンク。 |

## ステータス値

次のライフサイクル状態を使います。

| Status | Meaning |
| --- | --- |
| `draft` | 作成・整理中。 |
| `proposed` | レビュー可能だが未承認。 |
| `approved` | 実装計画の根拠として承認済み。 |
| `implemented` | 実装・検証済み。 |
| `superseded` | 新しい spec に置き換え済み。 |
| `rejected` | 明示的に追わない。 |

`status` はライフサイクル状態に集中させます。置き換え先は
`relations.superseded-by`、実装 plan や task は `relations.implemented-by`
で表します。

## Relations

relation は文書種別ではなく意味で選びます。

| Field | Meaning |
| --- | --- |
| `source` | 外部の一次情報、要求、issue、ユーザー提供資料。 |
| `references` | spec の根拠ではない補助的な参考文脈。 |
| `defers` | この文書から意図的に据え置いた将来作業（draft の spec/design を指す）。 |
| `deferred-by` | この draft 将来作業を後続フェーズへ据え置いた文書。 |
| `derives-from` | spec を生んだ brainstorming、idea-refine note、ADR、上流文書。 |
| `derived-by` | この spec から派生した plan、task、より狭い spec。 |
| `refines` | この spec が狭める、または詳細化する広い spec や ADR。 |
| `refined-by` | この spec を狭める後続 spec。 |
| `depends-on` | この spec が成立するために必要な文書。 |
| `blocks` | この spec の承認まで進められない文書や task。 |
| `supersedes` | この spec が置き換える古い spec。 |
| `superseded-by` | この spec を置き換える新しい spec。 |
| `related` | 方向性のない関連文書。 |
| `implemented-by` | この spec を実装する plan や task。 |
| `verifies` | 必要に応じて、この spec が検証する文書や check。 |
| `verified-by` | この spec を検証する test plan、review note、task。 |

内部文書は相対パスを使います。外部出典は URL を使います。置き換えでは可能な
限り双方向にリンクします。

- 新 spec: `relations.supersedes` が古い spec を指す。
- 旧 spec: `relations.superseded-by` が新 spec を指す。

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

## 可変性

spec は計画入力であり、ADR のような不変の決定記録ではありません。

- `draft` と `proposed` の spec は自由に編集できます。
- `approved` の spec は、範囲を変えない明確化であれば追記できます。
- 承認後に範囲、挙動、受け入れ基準を大きく変える場合は、新しい spec を作るか
  古い spec を明示的に supersede します。
- `implemented` の spec は履歴証拠として扱います。実装済みの意図を書き換える
  より、日付付き note または superseding spec を優先します。
- status、owner、relation の更新は同一ファイル内で許容します。
- audit report は、不足している要求、出典、受け入れ基準を作り出してはいけません。

## 索引

既定の spec 索引は `README.md` です。リポジトリが既に `index.md` を
使っている場合はそれを維持します。

索引は spec をファイル名順で並べ、title、status、owner をすばやく確認できる
だけのメタデータを残します。

## カテゴリ

### 領域別

大きなリポジトリでは、product area、platform area、documentation area、team
などで spec をサブディレクトリに分けても構いません。

```text
docs/specs/
  product/
    0001-team-invitations.md
  platform/
    0001-api-rate-limits.md
  docs/
    0001-document-lifecycle.md
```

番号はカテゴリごとにローカルです。構造が大きくなる前に、カテゴリ分けの方針を
索引に記録します。フラットなディレクトリが読みにくくなった場合だけ使います。

### 機能別

1つの機能に関連 spec が複数必要になる場合は、機能単位でサブディレクトリを
切っても構いません。

```text
docs/specs/
  checkout/
    0001-define-checkout-flow.md
    0002-checkout-api-contract.md
    0003-checkout-edge-cases.md
```

まとめて読むべき spec 群がある場合に使います。番号は機能ディレクトリ内で
ローカルに管理します。
