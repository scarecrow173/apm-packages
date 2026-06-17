# ADR 規約

この規約は、`adr-doc` skill が Architecture Decision Record を作成、
監査、索引化、レポートするときのルールを定義します。このパッケージの
MADR 4.0.0 テンプレートと `relations` フロントマター拡張に合わせて
調整しています。

`adr-doc` の ADR はコーディングエージェント向けに記述します。読み手は
追加説明を求めず、ADR そのものから判断を実行できるべきです。

## ディレクトリ

リポジトリに既存の ADR ディレクトリがある場合は、それを維持します。
このパッケージの既定値に合わせるためだけに、既存 ADR を移動してはいけません。

ADR ディレクトリが存在しない場合は、既定で `docs/adr/` を使います。
これにより、ADR を他のプロジェクト文書の近くに置きつつ、ディレクトリ名を
明確にできます。

スクリプトで使う検出順:

1. `docs/adr/`
2. `docs/decisions/`
3. `adr/`
4. `docs/adrs/`
5. `decisions/`

複数候補がある場合は、番号付き ADR ファイルと索引ファイルを持つ
ディレクトリを優先します。

## ファイル名

既定のファイル名パターン:

```text
NNNN-title-with-dashes.md
```

ルール:

- `NNNN` は ADR ディレクトリ内で連番となるゼロ埋め番号です。
- title slug は小文字 ASCII とし、単語をダッシュで区切ります。
- 短い現在形の動詞句を優先します。
- 例: `0001-adopt-adrs.md`, `0002-use-postgresql.md`

リポジトリが既に slug-only のファイル名を使っている場合は、
番号付き形式を導入せず、既存規約に従います。

## 必須フロントマター

このパッケージが作成する新規 ADR には YAML フロントマターを含めます。

```yaml
---
status: "proposed"
date: "YYYY-MM-DD"
decision-makers: []
consulted: []
informed: []
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
| `status` | Yes | 現在のライフサイクル状態。 |
| `date` | Yes | 現在の status の日付。形式は `YYYY-MM-DD`。 |
| `decision-makers` | Yes | 判断を所有する人またはグループ。 |
| `consulted` | Yes | 判断前または判断中に相談した専門家。 |
| `informed` | Yes | 判断を共有されたステークホルダー。 |

`consulted` と `informed` は RACI のコミュニケーション上の区別に従います。
consulted は双方向の入力、informed は一方向の通知です。

## Status 値

以下のライフサイクル状態を使います。

| Status | Meaning |
| --- | --- |
| `proposed` | 議論中で、まだ有効な決定ではない。 |
| `accepted` | 有効で、従うべき決定。 |
| `rejected` | 検討したが明示的に採用しなかった。 |
| `deprecated` | 過去に採用したが、現在は推奨しない。 |
| `superseded` | より新しい ADR に置き換えられた。 |

`status` はライフサイクル状態に集中させます。置き換え先 ADR は
`relations.superseded-by` で示します。

## Relations 拡張

`relations` はパッケージ独自拡張であり、upstream の MADR 4.0.0
フィールドではありません。ADR グラフ生成やリンク検証を可能にするための
構造化フィールドです。

relation field は他の document skill と共通です。リンク先の文書種別ではなく、
リンクの意味で field を選びます。

| Field | Meaning |
| --- | --- |
| `source` | 判断の根拠になる外部一次情報、要求、issue、出典資料。 |
| `references` | ADR の根拠ではない補助的な参考文脈。 |
| `implements` | この ADR が実装または運用化する spec、plan、その他文書。 |
| `implemented-by` | この ADR を実装する plan、task、code-focused docs。 |
| `depends-on` | この ADR が成立するために有効である必要がある文書や判断。 |
| `blocks` | この ADR が accepted になるまで進められない文書、plan、task。 |
| `supersedes` | この ADR が置き換える古い ADR。 |
| `superseded-by` | この ADR を置き換える新しい ADR。 |
| `related` | 方向付き依存はないが関連する ADR。 |
| `refines` | この ADR が明確化または範囲縮小する ADR。 |
| `refined-by` | この ADR を明確化または範囲縮小する ADR または spec。 |
| `derives-from` | この ADR を生んだ brainstorming note、spec、ADR、上流文書。 |
| `derived-by` | この ADR から派生した spec、plan、task、ADR。 |
| `verifies` | 必要に応じて、この ADR が検証する文書、check、criteria。 |
| `verified-by` | この ADR を検証する test plan、review note、task。 |

内部文書には相対パスを使います。外部出典には URL を使います。

```yaml
relations:
  source:
    - "https://example.com/source"
  implemented-by:
    - "../plans/0002-implement-event-driven-architecture.md"
  supersedes:
    - "0003-use-rest-api.md"
  superseded-by: []
  related:
    - "0007-adopt-event-driven-architecture.md"
  refines:
    - "0005-service-boundaries.md"
  references:
    - "https://example.com/background"
```

置き換え関係では、可能であれば双方向にリンクします。

- 新しい ADR: `relations.supersedes` で古い ADR を指す。
- 古い ADR: `relations.superseded-by` で新しい ADR を指す。

## 最小 MADR 内容

すべての ADR は、少なくとも次を明確に答えるべきです。

1. **Context and Problem Statement**: なぜ今この判断が必要なのか。
2. **Considered Options**: どの意味のある代替案を検討したのか。
3. **Decision Outcome**: 何を選び、なぜ選んだのか。

コーディングエージェント向けには、すべての ADR で実装境界も明確にします。

- エージェントが何を変更し、何を維持するべきか。
- どの制約、インターフェイス、ファイル、振る舞いが対象範囲なのか。
- どの代替案を明示的に選ばなかったのか。
- エージェントが判断の実装完了をどのように確認できるのか。

より詳細な ADR では、次も記録します。

- Decision drivers。
- Consequences。
- Confirmation approach。
- Pros and cons of options。
- More information と source links。

## 可変性

ADR ファイルは判断履歴です。

- 新しいテンプレートに合わせるためだけに、過去の根拠を書き換えない。
- 古い文脈を編集するより、日付付きメモを追記する。
- 判断が置き換えられた場合は新しい ADR を作成し、`relations` で接続する。
- status と relation の更新は同一ファイル内で行ってよい。
- 監査と移行レポートは、存在しない根拠、選択肢、結論を作り出してはいけない。

## 索引

ADR 索引の既定ファイルは `README.md` とします。リポジトリが既に
`index.md` を使っている場合は、それを維持します。

索引は ADR をファイル名順に並べ、読者が判断を素早く確認できる程度の
文脈を保持するべきです。

## サブディレクトリ管理

### サブディレクトリ管理別

大きなリポジトリでは、技術領域やチーム別に ADR をサブディレクトリに
分けてもよいです。

```text
docs/adr/
  backend/
    0001-use-postgresql.md
  frontend/
    0001-use-react.md
  infrastructure/
    0001-use-terraform.md
```

番号はカテゴリごとにローカルです。構造が大きくなる前に、カテゴリ分けの
方針を索引に記録します。

### 機能別

1つの機能に関連するアーキテクチャ決定が複数ある場合は、機能単位で
サブディレクトリを切っても構いません。

```text
docs/adr/
  checkout/
    0001-payment-provider-selection.md
    0002-checkout-session-storage.md
```

決定が1つの機能に強く紐づいていてまとめてレビューすべき場合に使います。
番号は機能ディレクトリ内でローカルに管理します。
