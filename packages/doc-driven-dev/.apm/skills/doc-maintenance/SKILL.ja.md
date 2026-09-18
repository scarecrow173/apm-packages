---
name: doc-maintenance
description: doc-status が診断した決定的な文書不整合の修復、managed index の再生成、文書パスの正規化を行う場合に使用する。preview 先行・明示的 apply のみ。
license: MIT
---

# Document Maintenance Skill

`doc-maintenance` は文書品質 contract の変更側を担当する。安全で決定的な
修復と index 再生成を行い、「診断済みの機械的な不整合をどう直すか」に
答える。`doc-status` は引き続き「現在の文書セットの何が壊れているか」を
担当する。

この skill は development orchestrator ではない。`doc-driven-dev-graph`
の lifecycle routing 権限を持たず、修復後の正しさの判定も `doc-status`
に委ねる。

## Preview-First Contract

すべての呼び出しは次のパイプラインに従う:

```text
scan → plan → preview → explicit apply → rescan → doc-status validation
```

- `plan` は変更セットを計算し、何も書き込まない。
- `apply` は whitelist 済み action のみを実行し、その後リポジトリを
  再scanして残りの `doc-status` finding を報告する。
- `apply` を伴わない呼び出しはプロジェクトファイルを一切変更しない。

## Safe Repair Whitelist

意味を変えないことが機械的に証明できる変更のみが自動適用される:

- `rebuild-index` — 文書型の managed index テーブル
  （`<!-- doc-suite:generated-index -->`）を再生成する。missing entry の
  追加、stale entry の除去、ID / title / status / file cell の同期、
  deterministic ordering の復元を行う。marker のない手書き README は
  `--force-index` を指定しない限り上書きしない。
- `fix-link-case` — 実際のファイルと大文字小文字のみ異なる link target
  を、実際のディレクトリエントリに合わせて書き換える。

自動修復しないもの（意味推論を拒否）:

- relation・status・owner・source の欠落
- upstream 文書の欠落
- 壊れた link の意味的 target
- orphan 文書の削除
- hand-curated index ファイル（`--force-index` なし）

whitelist 外の finding は `manual` または `migration` 理由付きの skipped
として報告され、呼び出し側が人間または migration へ振り分けられる。

## コマンド

```bash
node scripts/doc_maintenance.js plan --type spec
node scripts/doc_maintenance.js plan --json
node scripts/doc_maintenance.js apply --type spec
node scripts/doc_maintenance.js apply --force-index --json
```

- `plan` — action と skipped finding を preview する。書き込まない。
- `apply` — whitelist 済み action を適用し、再scan して検証サマリ
  （`findings before` / `findings after`）を出力する。
- オプション: `--type`, `--dir`, `--force-index`, `--json`。

## 冪等性

同じ修復を二度実行すると二度目は no-op になる。index 再生成は同じ文書
セットに対して決定的な出力を生成し、適用済みの link 正規化は finding
として再出現しない。

## Migration コマンド

`doc-maintenance` はリポジトリ migration のエントリポイントも担当する。
graph は `migrate_docs` / `scaffold_docs` delegate を名前で dispatch する。
canonical スクリプトはこの skill 配下にあり、
`doc-driven-dev-graph/scripts/` 配下の同名スクリプトは同じ実装を実行する
互換エントリポイントである。

```bash
node scripts/scaffold_docs.js --cwd <repo>
node scripts/migrate_docs.js --cwd <repo> --from <dir> [--split-h1] [--apply] [--json]
node scripts/migrate_ids.js --cwd <repo> [--apply] [--keep-filenames] [--allow-dirty] [--json]
```

3 つとも同じ preview-first contract に従う:

- `scaffold_docs` は既存ファイルを上書きせず canonical docs tree を作る。
- `migrate_docs` は canonical docs への import を plan し、`--apply` で
  書き込む。
- `migrate_ids` は legacy `TYPE-NNNN` id と numbered filename を書き換える
  前に discover / mapping / preflight を行う。blocker があれば mutation
  前に停止し、`apply` は `doc-status` audit（duplicate id、未解決
  relation、壊れた link、index 整合性）でリポジトリを再検証する。

## Read-Write Boundary

- `doc-status`（`list` / `lint` / `audit` / `health`）はファイルを
  一切変更しない。
- managed index の書き換え、link パス正規化、文書 migration ができるのは
  `doc-maintenance` のみで、明示的な `apply` コマンド経由に限られる。
- migration も同じ preview-first contract で plan / apply されるが、
  repair コマンドが暗黙に実行することはない。

## リソース

- `scripts/doc_maintenance.js`: safe repair と managed index 再生成の
  plan / apply エントリポイント。
- `scripts/migrate_docs.js`、`scripts/migrate_ids.js`、
  `scripts/scaffold_docs.js`: この skill が所有する migration /
  bootstrap エントリポイント（`doc-driven-dev-graph/scripts/` 配下の
  互換スクリプト経由でも実行可能）。
