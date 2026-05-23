---
name: adr-doc
description: MADR 4.0.0 を使って Architecture Decision Record を作成、監査、索引化、移行計画するときに使う skill です。判断履歴を保全し、既存の ADR ディレクトリ規約に適応し、明示要求なしの自動書き換えを避けます。
license: MIT
---

# ADR Documentation Skill

MADR 4.0.0 ベースの Architecture Decision Record にこの skill を使います。

## 役割

- MADR 4.0.0 テンプレートから新しい ADR を作成する。
- よく使われる ADR ディレクトリと命名規則を検出する。
- メタデータ不足、MADR セクション不足、未解決プレースホルダー、壊れたローカルリンク、索引ずれを監査する。
- YAML フロントマターに任意の `relations` リンクがある場合は検査する。
- 明示的に書き込みを求められた場合だけ ADR 索引を更新する。
- 過去の ADR ファイルを書き換えず、移行候補をレポートする。

## コマンド

インストール済み skill ディレクトリ、またはこのパッケージのソースツリーから
スクリプトを実行します。

```bash
node scripts/new_adr.ts --title "Adopt MADR"
node scripts/new_adr.ts --title "Use PostgreSQL" --template full --dir docs/decisions
node scripts/audit_adr.ts --dir docs/adr
node scripts/update_index.ts --dir docs/adr --write
node scripts/migrate_report.ts --dir docs/adr
```

## 既定値

- 既定テンプレート: `minimal`
- ディレクトリ、ファイル名、メタデータ、status、relation、可変性、
  索引の既定値は `references/adr-conventions.ja.md` で定義する。

## 運用ルール

- ADR 規約の正本として `references/adr-conventions.ja.md` を扱う。
- ツール固有の安全な挙動とレビュー観点は `references/adr-maintenance.ja.md`
  を参照する。
- MADR 4.0.0 は ADR 専用の標準として扱う。
- 将来追加される他のドキュメント種別には MADR ルールを適用しない。
- 既存 ADR があるリポジトリで `--write` を使う前に、明示的なユーザー確認を優先する。
