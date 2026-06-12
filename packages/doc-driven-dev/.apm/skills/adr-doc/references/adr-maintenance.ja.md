# ADR 保守ガイド

ADR の方針と規約は `adr-conventions.ja.md` に従います。このファイルは
ツール固有の保守動作を扱います。

## 安全な既定動作

- レポートは繰り返し安全に実行できる。
- `audit_adr.js` はファイルを書き込まない。
- `review_adr.js` はファイルを書き込まない。
- `list_adrs.js` はファイルを書き込まない。
- `check_code_links.js` はファイルを書き込まない。
- `migrate_report.js` はファイルを書き込まない。
- `update_index.js` は `--write` が指定された場合だけ書き込む。
- `relate_adr.js` は `--write` が指定された場合だけ書き込む。

## レビュー観点

- MADR セクション不足。
- `gray-matter` で解析し、`zod` で検証するメタデータ不足または形式不備。
- ADR ファイル間の壊れた `relations` リンク。
- 未解決のテンプレートプレースホルダー。
- 解決できなくなったローカルリンク。
- ADR ファイルと一致しない索引エントリ。
- Implementation Plan と Verification にあるエージェント対応上の不足。
- Implementation Plan が参照する存在しない affected paths。

## 移行レポート

移行レポートは、人間のレビューが必要な箇所を特定するべきです。
可変性に関するルールは `adr-conventions.ja.md` に従います。

## 運用ワークフロー

### 既存 ADR を参照する

アーキテクチャ、データフロー、API、インフラ、依存関係、横断的規約に触れる
変更を実装する前に既存 ADR を読む。

1. `scripts/list_adrs.js` または `adr-conventions.ja.md` で ADR ディレクトリと
   index を見つける。
2. タイトル、ステータス、relations を見て、`accepted` ADR を優先する。
3. 関連 ADR は Implementation Plan と Verification を含めて全文読む。
4. ADR とコードの矛盾は黙って解釈せず報告する。
5. 発見性向上に有効な箇所だけ、コードコメントや PR 説明に軽量な ADR 参照を加える。

### accepted ADR を更新する

変更は狭く保つ。

- Accept / reject: status を更新し、必要なら最終文脈を追加する。
- Deprecate: status を `deprecated` にし、置き換え先を説明する。
- Supersede: 新しい ADR を作り、`relations` で双方向にリンクする。
- Refine: 関連 ADR を作成または更新し、`relations.refines` を使う。
- Add learnings: `## More Information` に日付付きで追記する。

編集後は検証する。

```bash
node scripts/audit_adr.js --dir docs/adr
node scripts/review_adr.js --dir docs/adr
node scripts/update_index.js --dir docs/adr --write
node scripts/relate_adr.js --from 0002-new.md --to 0001-old.md --relation supersedes --write
```

### 承認後のライフサイクル

ADR が accepted になった後:

1. Implementation Plan の項目と follow-up consequence を追跡可能な task に落とす。
2. PR で ADR を参照する。例: `Implements ADR-0004`。
3. 主要な実装入口にだけ、少数のコード参照を追加する。
4. 実装後に Verification を確認する。
5. ADR に書かれた再検討条件が発火したら見直す。

### Index・Bootstrap・Categories

- ADR index は `node scripts/update_index.js --dir docs/adr --write` で更新する。
- まだ ADR がない repo では、最初の ADR として
  `Adopt architecture decision records` のような bootstrap ADR を作り、
  boilerplate を repo 固有の文脈に置き換える。
- flat な ADR ディレクトリが見通しにくくなった場合だけサブディレクトリ分類を使い、
  番号はカテゴリごとにローカル管理し、その方式を index に記録する。

## Script Examples

対象リポジトリの root から実行する。

```bash
node /path/to/adr-doc/scripts/new_adr.js --title "Choose database" --status proposed
node /path/to/adr-doc/scripts/new_adr.js --title "Use local cache" --template minimal
node /path/to/adr-doc/scripts/new_adr.js --title "Choose database" --template full --dir docs/decisions
node /path/to/adr-doc/scripts/list_adrs.js --dir docs/adr
node /path/to/adr-doc/scripts/audit_adr.js --dir docs/adr
node /path/to/adr-doc/scripts/review_adr.js --dir docs/adr
node /path/to/adr-doc/scripts/check_code_links.js --dir docs/adr
node /path/to/adr-doc/scripts/update_index.js --dir docs/adr --write
node /path/to/adr-doc/scripts/relate_adr.js --from 0002-new.md --to 0001-old.md --relation supersedes --write
node /path/to/adr-doc/scripts/migrate_report.js --dir docs/adr
```

補足:

- スクリプトは ADR ディレクトリとファイル名戦略を自動検出する。
- `--dir` でディレクトリ検出を上書きできる。
- 機械可読出力が必要なら reporting script に `--json` を使う。
- reporting script は既定ではファイルを書き換えない。
