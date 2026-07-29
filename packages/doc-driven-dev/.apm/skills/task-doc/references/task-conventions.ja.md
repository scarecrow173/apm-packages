# Task Conventions

この規約は、`task-doc` が実装 task を作成、監査、索引化、ルーティングする方法を
定義します。

task は、plan、spec、ADR、または他の task にリンクされた、小さくレビュー可能な
実装単位です。1 人の agent がプロジェクト全体の文脈を再発見せずに完了・検証
できる粒度にします。

## ディレクトリ

リポジトリに既存の task または work-item ディレクトリがある場合はそれを
維持します。このパッケージの既定値に合わせるためだけに既存 task を移動しないで
ください。

task ディレクトリがない場合は、既定で `docs/tasks/` を使います。

スクリプトの検出順序:

1. `docs/tasks/`
2. `docs/work-items/`
3. `tasks/`
4. `work-items/`

複数の候補がある場合は、番号付き task ファイルと索引ファイルを持つ
ディレクトリを優先します。検出リストにない明示的なリポジトリ規約がある場合
だけ `--dir` を使います。

## ファイル名

既定のファイル名:

```text
NNNN-title-with-dashes.md
```

ルール:

- `NNNN` は task ディレクトリ内で連番になるゼロ埋め番号です。
- title slug は小文字 ASCII にし、単語をダッシュで区切ります。
- 実装単位を表す命令形の句を優先します。
- 1 つの挙動、module、migration step、verification path に狭めます。
- `cleanup.md`, `fix-stuff.md`, `phase-1.md` のような範囲を隠す名前は
  避けます。
- 例: `0001-wire-checkout-button.md`,
  `0002-add-invitation-api-tests.md`。

リポジトリが slug-only のファイル名を既に使っている場合は、番号付けを
導入せず既存規約に従います。

## 必須フロントマター

task は共通 document front matter を使います。

```yaml
---
id: "TASK-0001"
type: "task"
status: "todo"
title: "Wire checkout button"
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
| `id` | Yes | 安定した文書 ID。通常は `TASK-NNNN`。 |
| `type` | Yes | `task` 固定。 |
| `status` | Yes | 現在の実行状態。 |
| `title` | Yes | 人間向けの task title。 |
| `created` | Yes | 作成日。`YYYY-MM-DD` 形式。 |
| `updated` | Yes | 最後に実質更新した日。`YYYY-MM-DD` 形式。 |
| `owners` | Yes | task に責任を持つ人またはグループ。 |
| `relations` | Yes | 上流、依存、検証文書への意味付きリンク。 |

## ステータス値

次のライフサイクル状態を使います。

| Status | Meaning |
| --- | --- |
| `todo` | 未着手。 |
| `in-progress` | 実装中。 |
| `blocked` | 依存関係または決定待ち。 |
| `done` | 実装・検証済み。 |
| `wont-do` | 明示的に追わない。 |

`status` は実行状態に集中させます。依存関係は title に埋め込まず、
`relations.depends-on` と `relations.blocks` で表します。

## Relations

relation は文書種別ではなく意味で選びます。

| Field | Meaning |
| --- | --- |
| `implements` | この task が実行する plan、spec、ADR。 |
| `derives-from` | この task を生んだ上流 plan または discovery note。 |
| `depends-on` | 先に必要な task、plan、decision、spec。 |
| `blocks` | この task によってブロックされる task または plan。 |
| `verifies` | この task が検証する spec、plan、ADR、挙動。 |
| `verified-by` | この task を検証する test note、review note、follow-up task。 |
| `source` | task を直接制約する外部出典。 |
| `references` | 補助的な実装 note や docs。 |
| `defers` | この文書から意図的に据え置いた将来作業（draft の spec/design を指す）。 |
| `deferred-by` | この draft 将来作業を後続フェーズへ据え置いた文書。 |
| `supersedes` | この task が置き換える古い task。 |
| `superseded-by` | この task を置き換える新しい task。 |
| `related` | 方向性のない関連文書。 |

内部文書は相対パスを使います。外部出典は URL を使います。

## フォローアップ分類

lifecycle の Phase 4 終了ゲートから作成される task は
`## 分類` セクションを含めます。値は次のうち 1 つだけを使います:
`normal-plan-task`, `bug-fix`, `doc-only`, `defer`, `wont-do`。
`decision-required` または `new-feature` に分類される項目は、
実装 task になる前に上流へ戻します。

- `relations.implements` は、その task が実行する承認済み plan、spec、ADR に使います。
- `relations.derives-from` は、フォローアップを発見した review note、implementation record、task に使います。
- `relations.depends-on` は、前提となる decision、上流文書、blocking task に使います。
- `relations.blocks` は、このフォローアップが解決するまで進められない task に使います。
- 分類が `defer` の場合は `relations.defers` を使います。

## 必須内容

task は次を含めます。

1. 実行する作業。
2. 実装する上流文書。
3. 依存関係と blocker。
4. 影響する file、module、docs。
5. 完了条件。
6. 検証 command、test、manual review。
7. この task の明示的な範囲外。

完了条件は検証可能である必要があります。検証経路を書けない task は、実装開始前に
plan または spec に戻します。

## 可変性

task は実行中の作業記録です。

- `todo` の task は自由に編集できます。
- `in-progress` の task は明確化や日付付き実装 note を追加できますが、
  既に試した作業を隠してはいけません。
- `blocked` の task は blocker になっている文書または task を
  `relations.depends-on` に記録します。
- `done` の task は完了証拠と検証 note を残します。
- task の範囲が大きく変わる場合は、黙って広げず、新しい task を作るか古い
  task を supersede します。
- status、owner、relation の更新は同一ファイル内で許容します。

## 索引

既定の task 索引は `README.md` です。リポジトリが既に `index.md` を
使っている場合はそれを維持します。

索引は task をファイル名順に並べ、次の 4 列の Markdown テーブルで掲載します。

| ID | タイトル | Status | ファイル |
| --- | --- | --- | --- |
| TASK-0001 | Wire checkout button | done | [0001-wire-checkout-button.md](0001-wire-checkout-button.md) |

索引ルール:

- 列は `ID` / `タイトル` / `Status` / `ファイル` の 4 列に固定します。`ID`・
  `タイトル`・`Status` は front matter から取り、`ファイル` 列は索引と同じ
  ディレクトリへの相対リンクにします。値が無い場合は `—` を入れます。
- 行はファイル名の昇順で並べます。
- 新規の対象ファイルが追加されたら、同じ変更の中で必ず索引を更新します。
- 項目が増えてきたら、可読性のために索引を複数の見出しに分け、見出しごとに
  1 つのテーブルを配置することを推奨します。見出しの分割はサブディレクトリの
  グルーピング（カテゴリ別／機能別）と整合させ、各見出しが 1 グループに
  対応するようにします。

## サブディレクトリ管理

### カテゴリ別サブディレクトリ

大きなリポジトリでは、implementation area、release、workstream などで
task をサブディレクトリに分けても構いません。

```text
docs/tasks/
  frontend/
    0001-wire-checkout-button.md
  backend/
    0001-add-checkout-endpoint.md
  verification/
    0001-add-checkout-e2e.md
```

番号はカテゴリごとにローカルです。構造が大きくなる前に、カテゴリ分けの方針を
索引に記録します。フラットなディレクトリが読みにくくなった場合だけ使います。

### 機能別サブディレクトリ

1つの機能のすべての task をまとめて追跡したい場合は、機能単位でサブディレクトリを
切っても構いません。

```text
docs/tasks/
  checkout/
    0001-wire-checkout-button.md
    0002-add-checkout-api-endpoint.md
    0003-add-checkout-e2e-tests.md
```

同じ機能に属する task で共通の上流 plan を持つ場合に使います。番号は機能
ディレクトリ内でローカルに管理します。
