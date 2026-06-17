# Plan Conventions

この規約は、`plan-doc` が実装 plan を作成・監査・索引化・ルーティングするときの
基準を定めます。

`plan-doc` は作成前に `design-doc` の承認ゲートを要求します。

plan は、承認済みの spec または受け入れ済み ADR を、実装順序、リスク、
依存関係、検証 checkpoint、そして上流文書を再解釈しなくても実行できる
小さな task 分解へ変換します。

## 計画スコープ

変更が複数の独立したサブシステムにまたがる場合は、同じクリティカルパスと
リリース意図を共有していない限り、plan を分割します。1 つの plan は、
複数の無関係な案件の束ではなく、1 つの実装ストリームとして読めるべきです。

## ディレクトリ

リポジトリに既存の plan ディレクトリがある場合は、それを維持します。
パッケージ既定に合わせるためだけに既存 plan を移動しないでください。

plan ディレクトリがない場合は、既定で `docs/plans/` を使います。

スクリプトの検出順:

1. `docs/plans/`
2. `docs/implementation-plans/`
3. `plans/`
4. `implementation-plans/`

複数候補がある場合は、番号付き plan ファイルと index ファイルを持つ
ディレクトリを優先します。`--dir` は、検出リストにない明示的な規約が
リポジトリにある場合だけ使います。

## ファイル名

既定のファイル名パターン:

```text
NNNN-title-with-dashes.md
```

ルール:

- `NNNN` は plan ディレクトリ内で連番になるゼロ埋め番号です。
- title slug は小文字 ASCII で、単語をダッシュで区切ります。
- `implement-checkout-flow` や `migrate-session-storage` のような、
  命令形または実装志向の表現を優先します。
- plan 名は spec のタイトルそのものではなく、作業順序に合わせて付けます。
- 例: `0001-implement-checkout-flow.md`、`0002-migrate-session-storage.md`

リポジトリが slug-only の命名規約を既に使っている場合は、連番を新設せず
その規約に従います。

## 必須 front matter

plan は共通の document front matter を使います。

```yaml
---
id: "PLAN-0001"
type: "plan"
status: "draft"
title: "Implement checkout flow"
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

必須 field:

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | 安定した document identifier。通常は `PLAN-NNNN`。 |
| `type` | Yes | `plan` であること。 |
| `status` | Yes | 現在の lifecycle state。 |
| `title` | Yes | 人が読める実装 plan の題名。 |
| `created` | Yes | 作成日。`YYYY-MM-DD` 形式。 |
| `updated` | Yes | 最終更新日。`YYYY-MM-DD` 形式。 |
| `owners` | Yes | 実行責任を持つ人または group。 |
| `relations` | Yes | upstream / downstream 文書への意味のある link。 |

## Status Values

使用する lifecycle status:

| Status | Meaning |
| --- | --- |
| `draft` | 作成中。 |
| `approved` | 実装可能。 |
| `in-progress` | 実装中。 |
| `blocked` | 依存関係の解消待ち。 |
| `completed` | 実装済みで検証済み。 |
| `superseded` | 新しい plan に置き換えられた。 |

`status` は実行状態だけに使います。blocking prerequisite には
`relations.depends-on` を、置き換えには `relations.superseded-by` を使います。

## Relations

relation field は document type ではなく意味のために使います。

| Field | Meaning |
| --- | --- |
| `implements` | この plan が実装する spec または ADR。 |
| `implemented-by` | この plan を実行する task。 |
| `derives-from` | この plan を生んだ上流 spec / ADR / idea / brainstorm。 |
| `derived-by` | この plan から派生した task または follow-up plan。 |
| `depends-on` | 先に解決されるべき plan / task / spec / ADR。 |
| `blocks` | この plan によって blocked される plan / task。 |
| `source` | 実装アプローチに実質的な影響を与える外部 source。 |
| `references` | 補足の実装メモや doc。 |
| `defers` | この文書から意図的に据え置いた将来作業（draft の spec/design を指す）。 |
| `deferred-by` | この draft 将来作業を後続フェーズへ据え置いた文書。 |
| `supersedes` | この plan に置き換えられる古い plan。 |
| `superseded-by` | この plan を置き換える新しい plan。 |
| `related` | 方向性のない関連文書。 |
| `verifies` | この plan が検証する spec / ADR / acceptance criteria。 |
| `verified-by` | この plan を検証する test plan / task doc / review note。 |

内部 document には相対 path を使います。外部 source には URL を使います。

## 必須内容

plan には次を含めます。

1. Goal と non-goals。
2. スコープ境界と、複数 plan に分割すべきかどうか。
3. plan が触る file、module、ownership boundary。
4. 実装対象の upstream spec または ADR。
5. 順序付き phase を含む implementation sequence。
6. 1 action ずつに分解された task。
7. dependency、blocker、risk、mitigation。
8. 検証 command または manual check。
9. リスクが高い場合の rollback または follow-up note。
10. spec coverage、placeholder cleanup、用語整合を確認する self-review。

## タスク粒度

task は 1 つの action になるように書きます。

- 良い: 失敗する test を書く。
- 良い: 対象 test を実行して失敗を確認する。
- 良い: 最小限の code change を入れる。
- 良い: 対象 test を再実行して成功を確認する。
- 良い: change を commit する。
- 悪い: 機能を実装して動作確認する。
- 悪い: validation と edge case を対応する。

複数の分離可能な action があるなら分割します。

## Design Gate (Mandatory)

plan 作成前に次を満たします。

- `docs/designs/overview.md` が存在すること。
- overview 以外の design file が少なくとも 1 つ存在し、front matter
  `status: "approved"` が exact match であること。

gate に失敗した場合、`new_plan` は次を返します。

`PLAN-DOC-GATE-001: approved design-doc is required before creating a plan. Ensure docs/designs/overview.md exists and provide at least one design doc with front matter status: "approved".`

推奨作成コマンド:

```bash
node scripts/new_plan.js --title "Implement checkout flow" --implements docs/specs/0001-define-checkout-flow.md --design docs/designs/0001-design-checkout-orchestration.md
```

plan は、既知なら具体的な file、module、command、ownership boundary を書きます。
不明な detail は、実装可能であるふりをせず gap として明記します。

## プレースホルダ禁止

plan は、具体的な内容の代わりにプレースホルダ language に依存すると失敗です。

- `TBD`、`TODO`、`implement later`、または類似の filler は使わない。
- 何を validation するのか、どの edge case なのかを示さずに
  "add validation" や "handle edge cases" と書かない。
- test 名や behavior を書かずに "write tests for the above" と書かない。
- plan でまだ導入していない function / file / module を参照しない。

不明点は明示的な gap として記録します。

## 可変性

plan は実行 artifact であり、作業中は変化してかまいません。

- `draft` plan は自由に編集できます。
- `approved` plan は作業開始前なら説明を補足できます。
- `in-progress` plan は実装 reality を反映する dated update を受け入れますが、
  元の順序は説明なく消さないでください。
- `completed` plan は実際に行ったことと検証結果を残すべきです。
- 大きな再計画は、元の plan が作業を表さなくなったら superseding plan を
  作ってください。
- status / owner / relation の更新は in-place で問題ありません。

## インデックス

既定の plan index は `README.md` です。リポジトリがすでに `index.md` を
使っている場合は、それを維持します。

index には filename 順で plan を並べ、title、status、upstream document、owner を
素早く読めるだけの metadata を含めます。

## カテゴリ

### カテゴリ別

大きなリポジトリでは、execution area、team、release、migration stream などで
plan をサブディレクトリに分けてもかまいません。

```text
docs/plans/
  frontend/
    0001-implement-checkout-flow.md
  backend/
    0001-add-invitation-api.md
  migrations/
    0001-migrate-session-storage.md
```

番号はカテゴリごとにローカルです。分類スキームは索引に先に書きます。
フラットなディレクトリが見づらくなった場合だけ使います。

### 機能別

1つの機能の実装に複数の plan が必要になる場合は、機能単位でサブディレクトリを
切っても構いません。

```text
docs/plans/
  checkout/
    0001-implement-checkout-flow.md
    0002-checkout-api-integration.md
```

同じ機能に属する plan をまとめてレビューすべき場合に使います。番号は機能
ディレクトリ内でローカルに管理します。

## レビュー用ハンドオフ

plan が完成したら、レビュー担当が stylistic changes ではなく本質的な gap に
集中できるだけの情報を残します。

- 明示した assumption を列挙する。
- 未解決の dependency や不足情報を列挙する。
- 重要な upstream spec、design docs、ADR を示す。
