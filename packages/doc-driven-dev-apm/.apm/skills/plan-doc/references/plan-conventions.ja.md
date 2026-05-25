# Plan Conventions

この規約は、`plan-doc` が実装計画を作成、監査、索引化、ルーティングする方法を
定義します。

`plan-doc` は作成前に `design-doc` の承認ゲートを必須とします。

plan は、承認済み spec または accepted ADR を、実装順序、リスク、依存関係、
検証 checkpoint に変換する文書です。上流文書を再解釈しなくても task を作れる
具体性が必要です。

## ディレクトリ

リポジトリに既存の plan ディレクトリがある場合はそれを維持します。この
パッケージの既定値に合わせるためだけに既存 plan を移動しないでください。

plan ディレクトリがない場合は、既定で `docs/plans/` を使います。

スクリプトの検出順序:

1. `docs/plans/`
2. `docs/implementation-plans/`
3. `plans/`
4. `implementation-plans/`

複数の候補がある場合は、番号付き plan ファイルと索引ファイルを持つ
ディレクトリを優先します。検出リストにない明示的なリポジトリ規約がある場合
だけ `--dir` を使います。

## ファイル名

既定のファイル名:

```text
NNNN-title-with-dashes.md
```

ルール:

- `NNNN` は plan ディレクトリ内で連番になるゼロ埋め番号です。
- title slug は小文字 ASCII にし、単語をダッシュで区切ります。
- `implement-checkout-flow` や `migrate-session-storage` のような、命令形
  または実装指向の句を優先します。
- 上流 spec のタイトルそのものではなく、実装作業の順序が分かる名前にします。
- 例: `0001-implement-checkout-flow.md`,
  `0002-migrate-session-storage.md`。

リポジトリが slug-only のファイル名を既に使っている場合は、番号付けを
導入せず既存規約に従います。

## 必須フロントマター

plan は共通 document front matter を使います。

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
---
```

必須フィールド:

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | 安定した文書 ID。通常は `PLAN-NNNN`。 |
| `type` | Yes | `plan` 固定。 |
| `status` | Yes | 現在のライフサイクル状態。 |
| `title` | Yes | 人間向けの実装計画タイトル。 |
| `created` | Yes | 作成日。`YYYY-MM-DD` 形式。 |
| `updated` | Yes | 最後に実質更新した日。`YYYY-MM-DD` 形式。 |
| `owners` | Yes | 実行に責任を持つ人またはグループ。 |
| `relations` | Yes | 上流・下流文書への意味付きリンク。 |

## ステータス値

次のライフサイクル状態を使います。

| Status | Meaning |
| --- | --- |
| `draft` | 作成中。 |
| `approved` | 実装可能。 |
| `in-progress` | 実装開始済み。 |
| `blocked` | 依存関係が解決するまで進められない。 |
| `completed` | 実装・検証済み。 |
| `superseded` | 新しい plan に置き換え済み。 |

`status` は実行状態に集中させます。前提条件は `relations.depends-on`、
置き換え先は `relations.superseded-by` で表します。

## Relations

relation は文書種別ではなく意味で選びます。

| Field | Meaning |
| --- | --- |
| `implements` | この plan が実装する spec または ADR。 |
| `implemented-by` | この plan を実行する task。 |
| `derives-from` | plan を生んだ上流 spec、ADR、idea、brainstorm。 |
| `derived-by` | この plan から派生した task または follow-up plan。 |
| `depends-on` | 先に解決すべき plan、task、spec、ADR。 |
| `blocks` | この plan によってブロックされる plan または task。 |
| `source` | 実装方針に直接影響する外部出典。 |
| `references` | 補助的な実装 note や docs。 |
| `supersedes` | この plan が置き換える古い plan。 |
| `superseded-by` | この plan を置き換える新しい plan。 |
| `related` | 方向性のない関連文書。 |
| `verifies` | この plan が検証する spec、ADR、受け入れ基準。 |
| `verified-by` | この plan を検証する test plan、task doc、review note。 |

内部文書は相対パスを使います。外部出典は URL を使います。

## 必須内容

plan は次を含めます。

1. 目標と非目標。
2. 実装する上流 spec または ADR。
3. 順序付きの実装フェーズ。
4. 依存関係、blocker、リスク、mitigation。
5. task 分解の指針。
6. 検証コマンドまたは手動確認。
7. リスクが高い場合の rollback または follow-up note。

## Design Gate（必須）

plan 作成前に次を満たします。

- `docs/designs/overview.md` が存在する。
- overview 以外の design ファイルで front matter `status: "approved"`
  が厳密一致する文書が 1 件以上ある。

ゲートに失敗した場合、`new_plan` は次の固定文言を返します。

`PLAN-DOC-GATE-001: approved design-doc is required before creating a plan. Ensure docs/designs/overview.md exists and provide at least one design doc with front matter status: "approved".`

推奨コマンド:

```bash
node scripts/new_plan.js --title "Implement checkout flow" --implements docs/specs/0001-define-checkout-flow.md --design docs/designs/0001-design-checkout-orchestration.md
```

分かっている場合は、具体的なファイル、module、command、ownership boundary を
書きます。不明な詳細は、実装可能なふりをせず gap として明示します。

## 可変性

plan は実行 artifact であり、作業中に変化しても構いません。

- `draft` の plan は自由に編集できます。
- `approved` の plan は作業開始前の明確化であれば更新できます。
- `in-progress` の plan は実装実態を反映する日付付き update を追加できますが、
  元の順序を説明なしに消してはいけません。
- `completed` の plan は実際に行った作業と検証内容を残します。
- 古い plan が作業を説明しなくなった場合は、実質的な再計画として superseding
  plan を作ります。
- status、owner、relation の更新は同一ファイル内で許容します。

## 索引

既定の plan 索引は `README.md` です。リポジトリが既に `index.md` を
使っている場合はそれを維持します。

索引は plan をファイル名順で並べ、title、status、上流文書、owner をすばやく
確認できるだけのメタデータを残します。

## カテゴリ

大きなリポジトリでは、plan をサブディレクトリに分けても構いません。

```text
docs/plans/
  frontend/
    0001-implement-checkout-flow.md
  backend/
    0001-add-invitation-api.md
  migrations/
    0001-migrate-session-storage.md
```

番号はカテゴリごとにローカルです。構造が大きくなる前に、カテゴリ分けの方針を
索引に記録します。カテゴリは execution area、team、release、migration stream
などで、フラットなディレクトリが読みにくくなった場合だけ使います。
