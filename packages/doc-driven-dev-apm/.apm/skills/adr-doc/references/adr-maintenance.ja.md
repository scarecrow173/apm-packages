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
