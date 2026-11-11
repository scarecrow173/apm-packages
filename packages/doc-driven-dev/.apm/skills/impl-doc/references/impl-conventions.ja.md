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
title-with-dashes.md
title-with-dashes.jsonl
```

ルール:

- ファイル名は slug-only とし、小文字 ASCII で単語をダッシュで区切ります。
- `ir/` と `exp/` の名前はそれぞれのディレクトリ内で一意であればよいです。
- 文書の同一性はファイル名やソート位置ではなく front matter の `id` に
  あります。既存の `NNNN-<slug>` ファイル名も有効ですが、新規ファイルは
  常に slug-only の名前を使います。既存ファイルの移行には `doc-driven-dev-graph/scripts` の `migrate_ids.js` を使います。

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

## Implementation Record の運用

Implementation Record は Markdown 文書であり、CLI は初期作成と監査を担当する。

- Phase 5 では task 開始時、最初のコード変更前 に Implementation Record を
  作成または再利用する。
- 実装が進む間は front matter と本文を継続的に更新する。
- 完了後に思い出して書くのではなく、進行中の実装記録として扱う。

実装中に最新化しておく本文セクション:

- Summary
- Changes Made
- Validation and Evidence
- Risks or Follow-ups

status の使い分け:

- 実装中は `status: "in-progress"` を使う。
- 検証とレビュー証跡がそろった後に `completed` へ更新する。
- ループバックや明示的な中断で作業を止める場合は `blocked` にする。

Implementation Record と Experiment Log は「何を試し、結果がどうだったか」を
記録します。保証の背後にある永続的な意図——テストがなぜ存在し、いつ廃止
できるか——は `impl-doc` ではなく `test-spec` 文書（`docs/test-specs/`）に
置きます。

## Experiment Log イベント

Experiment Log は JSONL です。

- 1 行 = 1 イベント
- `start` は作成時必須ではない
- 通常の更新は `append_experiment_event`
- 例外修正は `edit_experiment_log`
- Experiment Log の JSONL は `append_experiment_event` または `edit_experiment_log` だけで更新する。

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

両監査は管理 `README.md` 索引も読み取り専用で検査し、`index-*` の
finding を報告します(コード一覧は impl-doc スキルを参照)。

## 索引

各ディレクトリは `README.md` を索引として使います。

### Implementation Record

`docs/impl/ir/` の索引は `README.md` を使います。記録はファイル名順に並べた
次の 4 列の Markdown テーブルで掲載します。

| ID | タイトル | Status | ファイル |
| --- | --- | --- | --- |
| IMPL-5RfVgTgBnHkLmQwErTyUiO | Implement checkout flow | completed | [implement-checkout-flow.md](implement-checkout-flow.md) |

索引ルール:

- 列は `ID` / `タイトル` / `Status` / `ファイル` の 4 列に固定し、front matter
  から取ります。`ファイル` 列は索引と同じディレクトリへの相対リンクにします。
  値が無い場合は `-` を入れます。
- 行は各層ごとにファイル名の昇順で並べます。in-flight の記録は先頭の
  テーブルに、settled なステータス（`completed`、`abandoned`、`superseded`）の
  記録は下段の `## Settled` テーブルにファイル名昇順で掲載します。Settled の
  行もリンクは維持され、履歴を隠さずに強調を抑える構成です。
- 記録の追加や `status` の変更時は索引を更新してください。
  `sync_impl_index.js --kind ir` が同期内容をプレビューします
  （verdict は `in-sync` / `sync` / `create` / `rejected`）。
  `--apply` で書き込みます。適用するまでの間、
  `audit_impl_record.js` がドリフト（`index-missing-entry`、
  `index-stale-entry`、`index-metadata-mismatch`、`index-tier-mismatch`、
  `index-ordering`）を報告します。`doc_status` と `doc_maintenance` の
  修復 verb は impl 索引を修復しません。`doc_maintenance index` は同じ
  safe sync API 経由でのみ materialize します。
- 管理領域は active テーブル 1 つと任意の `## Settled` テーブルだけです。
  手書きの注記は生成領域の外（マーカーより前、またはテーブルより後）に
  置いてください。索引テーブルを追加すると曖昧とみなされ拒否されます。

### Experiment Log

`docs/impl/exp/` の索引は `README.md` を使います。Experiment Log は front matter
を持たない JSONL ファイルなので、索引はファイルリンクのみの 1 列テーブルを
ファイル名順で掲載します。

| ファイル |
| --- |
| [checkout-retry.jsonl](checkout-retry.jsonl) |

各ログの参照は Implementation Record 側の `metadata.experiments` と relations が
担うため、README はディレクトリ概覧の役割のみ持ちます。

この索引も `sync_impl_index.js --kind exp` で同様に同期します。デフォルトは
プレビュー、`--apply` で書き込み、手作業キュレートや不正な README は
`rejected` になります。

新規の Experiment Log が追加されたら、同じ変更の中で必ず索引を更新します。
