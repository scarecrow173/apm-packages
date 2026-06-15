# doc-driven-dev-lifecycle Bootstrap 契約

本文書は、`scaffold_docs` が Briefing 開始前に作成する canonical な docs tree を定義する。

## Canonical Tree

- `docs/ideas/README.md`
- `docs/discovery/README.md`
- `docs/specs/README.md`
- `docs/designs/README.md`
- `docs/plans/README.md`
- `docs/tasks/README.md`
- `docs/adr/README.md`
- `docs/impl/ir/README.md`
- `docs/impl/exp/README.md`

## ルール

- 不足しているディレクトリと `README.md` のみを作成する。
- 対象リポジトリ内の既存ファイルを保持する。
- `docs/designs/overview.md` は作成しない。`design-doc` がこのファイルを所有する。
- 繰り返し実行しても idempotent であること。

## 完了条件

- canonical ディレクトリが存在する。
- 各 canonical ディレクトリに `README.md` がある。
- 既存ファイルが変更されていない。
- `docs/designs/overview.md` は `design-doc` が作成するまで存在しない。
