# Design Conventions

この規約は、`design-doc` が設計成果物を作成・維持する方法を定義します。

## ディレクトリ

既定は `docs/designs/` を使います。

スクリプトの検出順序:

1. `docs/designs/`
2. `docs/design/`
3. `designs/`
4. `design/`

ディレクトリには次を含めます。

- `overview.md`（必須の全体設計マップ）
- 番号付き詳細設計ファイル（`NNNN-<slug>.md`）または既存 slug-only 形式
- `README.md` 索引

## ファイル名

既定の詳細設計ファイル名:

```text
NNNN-title-with-dashes.md
```

ルール:

- `NNNN` は設計ディレクトリ内のゼロ埋め連番。
- slug は小文字 ASCII とダッシュ。
- `overview.md` は予約名で、詳細設計ファイルとして扱わない。

## 可変性

- `draft` の design 文書は自由に更新できます。
- `approved` の design 文書は、意図を残しつつ差分理由を明示して更新します。
- 大きな再設計は履歴を消すのではなく superseding design 文書で表現します。

## サブディレクトリ管理

### カテゴリ別サブディレクトリ

大規模リポジトリでは設計文書を領域別に分割できます。

```text
docs/designs/
  payments/
    0001-design-checkout-orchestration.md
  identity/
    0001-design-login-sessions.md
```

分割時の番号はカテゴリ内ローカルで管理します。

### 機能別サブディレクトリ

1つの機能に関連設計文書が複数必要になる場合は、機能単位でサブディレクトリを
切っても構いません。

```text
docs/designs/
  checkout/
    0001-design-checkout-flow.md
    0002-design-checkout-api.md
```

まとめて読むべき design 群がある場合に使います。番号は機能ディレクトリ内で
ローカルに管理します。

## 必須フロントマター

詳細設計文書は共通 YAML front matter を使い、`type: "design"` とします。

## ステータス値

| Status | Meaning |
| --- | --- |
| `draft` | 設計中・レビュー中。 |
| `approved` | 実装入力として承認済み。 |
| `superseded` | 新しい設計文書に置き換え済み。 |
| `rejected` | 却下済み（追跡目的で保持）。 |

## plan-doc の gate ルール

`plan-doc` 作成には次が必須です。

- `docs/designs/overview.md` が存在する。
- overview 以外の設計文書で front matter `status: "approved"` が
  厳密一致するファイルが 1 件以上ある。

どちらかを満たさない場合、`plan-doc` は次の固定文言で失敗します。

`PLAN-DOC-GATE-001: approved design-doc is required before creating a plan. Ensure docs/designs/overview.md exists and provide at least one design doc with front matter status: "approved".`

## Relations

- 上流 spec/ADR/discovery は `relations.derives-from` を使う。
- 設計同士の関連は `relations.related` を使う。
- 補助資料は `relations.references` を使う。
- この設計から意図的に据え置いた将来作業（draft の spec/design）は `relations.defers` で指す。据え置かれた側は `relations.deferred-by` で指し返す。

## 索引

`README.md` には `overview.md` と詳細設計の両方を掲載します。
