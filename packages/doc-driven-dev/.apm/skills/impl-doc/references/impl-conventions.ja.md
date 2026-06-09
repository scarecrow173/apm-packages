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
