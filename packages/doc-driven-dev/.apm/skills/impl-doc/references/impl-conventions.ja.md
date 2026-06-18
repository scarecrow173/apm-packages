# impl-doc 規約

## ディレクトリ

Implementation Record は次に配置します。

```text
docs/impl/ir/
```

Experiment Log は次に配置します。

```text
docs/impl/exp/
```

リポジトリに同等の既存規約がある場合は、CLI の `--dir` でそちらを優先します。

## ファイル名

既定のファイル名パターン:

```text
NNNN-title-with-dashes.md
NNNN-title-with-dashes.jsonl
```

ルール:

- `NNNN` は各ディレクトリ内のゼロ埋め連番
- `ir/` と `exp/` は別系列で採番
- slug は小文字 ASCII のダッシュ区切り
- 既存が slug-only 規約ならその規約に従う

## Implementation Record の front matter

Implementation Record は既存 doc-suite の形を継承し、共通
`relations.changes` と `metadata.experiments` を持ちます。

必須項目:

- `id`
- `type: "impl"`
- `status`
- `title`
- `created`
- `updated`
- `owners`
- `relations`
- `metadata.experiments.adopted`
- `metadata.experiments.rejected`

v1 で使わないもの:

- `metadata.record-type`
- `metadata.validation`

## Status 値

Implementation Record で許可する status:

- `draft`
- `in-progress`
- `completed`
- `blocked`
- `abandoned`
- `superseded`

## Experiment Log イベント

Experiment Log は JSONL です。

- 1 行 = 1 イベント
- `start` は作成時必須ではない
- 通常の更新は `append_experiment_event`
- 例外修正は `edit_experiment_log`

許可するイベント種別:

- `start`
- `observation`
- `hypothesis`
- `change`
- `validation`
- `error`
- `decision`
- `summary`

必須フィールド:

- `schema`
- `experiment`
- `seq`
- `type`
- `ts`

## 監査の観点

Implementation Record の監査項目:

- 必須 front matter 項目
- `type` と `status` の妥当性
- `relations.changes` の形
- ローカル relation target の存在
- 必須本文セクション

Experiment Log の監査項目:

- 各行が正しい JSON
- 必須イベントフィールド
- 許可されたイベント種別
- `seq` が一意かつ昇順
- `experiment` パスが実ファイルと一致

## 索引

各ディレクトリは `README.md` を索引として使います。

### Implementation Record

`docs/impl/ir/` の索引は `README.md` を使います。記録はファイル名順に並べた
次の 4 列の Markdown テーブルで掲載します。

| ID | タイトル | Status | ファイル |
| --- | --- | --- | --- |
| IMPL-0001 | Implement checkout flow | completed | [0001-implement-checkout-flow.md](0001-implement-checkout-flow.md) |

索引ルール:

- 列は `ID` / `タイトル` / `Status` / `ファイル` の 4 列に固定し、front matter
  から取ります。`ファイル` 列は索引と同じディレクトリへの相対リンクにします。
  値が無い場合は `—` を入れます。
- 行はファイル名の昇順で並べます。
- 新規の Implementation Record が追加されたら、同じ変更の中で必ず索引を更新
  します。
- 項目が増えてきたら、可読性のために索引を複数の見出しに分け、見出しごとに
  1 つのテーブルを配置することを推奨します。

### Experiment Log

`docs/impl/exp/` の索引は `README.md` を使います。Experiment Log は front matter
を持たない JSONL ファイルなので、索引はファイルリンクのみの 1 列テーブルを
ファイル名順で掲載します。

| ファイル |
| --- |
| [0001-checkout-retry.jsonl](0001-checkout-retry.jsonl) |

各ログの参照は Implementation Record 側の `metadata.experiments` と relations が
担うため、README はディレクトリ概覧の役割のみ持ちます。

新規の Experiment Log が追加されたら、同じ変更の中で必ず索引を更新します。
