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

`index` は managed index を明示的に materialize するエントリポイント —
INDEX のみを対象とし、全オーナーを横断する。`plan`/`apply` と異なり
managed index コンテンツ以外には一切触れず（link 正規化やソース修復は
行わない）、各書き込みをオーナー writer に分派する。shared-4col
ディレクトリは共有 renderer/merge、`docs/adr` は ADR managed writer、
`docs/impl/ir`/`docs/impl/exp` は impl-doc の safe sync エンジン
（`sync_impl_index` と同じ API — 無条件 writer は使わない）経由で
書き込む。

```bash
node scripts/doc_maintenance.js index plan [--dir <path>] [--json]
node scripts/doc_maintenance.js index apply [--dir <path>] [--expect <planHash>] [--json]
```

- `index plan` — preview のみ。書き込まない。各 target の directory・
  kind・owner・verdict（`in-sync` / `sync` / `create` / `rejected`）・
  変更数・source 数・`planHash` を報告する。
- `index apply` — 再計画し、すべての drift pin（source・file list・
  index バイト列）を live filesystem と照合してから書き込む。
  `written` と `blocked` のリストを報告し、blocked target があれば
  非ゼロ終了する。`--expect <planHash>` は事前に preview した
  `planHash` に apply をピン留めし、再計算結果が異なれば全書き込みを
  拒否する。rejected target（hand-curated・malformed・symlink・
  `docs/impl` 自体のような contract 外ディレクトリ）は報告のみで
  一切書き込まれない。
- オプション: `--dir`, `--expect`, `--json`。`index` に `--type` と
  `--force-index` は存在しない（contract 上 strict）。

## 冪等性

同じ修復を二度実行すると二度目は no-op になる。index 再生成は同じ文書
セットに対して決定的な出力を生成し、適用済みの link 正規化は finding
として再出現しない。

## ステータス遷移のクローズアウト

status の編集は front matter の手作業であり、文書を遷移させるコマンドは
存在しない。しかし遷移によって行は in-flight テーブルと `## Settled`
層の間を移動し得る。`status` が変わるたびに、同じ変更の中で所属索引を
再生成する（`index plan` の後 `index apply`）。再生成までは
`doc_status lint` が古い索引を報告する。再生成は二層フォーマットへの
移行でもある。

## Migration コマンド

`doc-maintenance` はリポジトリ migration のエントリポイントも担当する。
graph は `migrate_docs` / `scaffold_docs` delegate を名前で dispatch する。
canonical スクリプトはこの skill 配下にあり、
`doc-driven-dev-graph/scripts/` 配下の同名スクリプトは同じ実装を実行する
互換エントリポイントである。

```bash
node scripts/scaffold_docs.js --cwd <repo>
node scripts/migrate_docs.js --cwd <repo> --from <dir> [--split-h1] [--apply] [--json]
node scripts/migrate_ids.js --cwd <repo> [--apply] [--keep-filenames] [--allow-dirty] [--extra-root <dir>]... [--json]
node scripts/promote_index.js --cwd <repo> [--dir <path>] [--apply] [--json]
```

`scaffold_docs` のみ即時作成のエントリポイントであり、他はすべて
preview-first に従う:

- `scaffold_docs` は既存ファイルを上書きせず canonical docs tree を作り、
  初回実行時に各ディレクトリの contract index(`docs/adr`・
  `docs/impl/ir`・`docs/impl/exp` ではオーナー形式)を書き込む。この
  書き込みは repair ではなく bootstrap の副作用であるため preview
  フェーズはない。
- `migrate_docs` は canonical docs への import を plan し、`--apply` で
  書き込む。front matter で認識された `type:` は typed route であり、
  `type: adr` は宣言済み `adr-doc` mutator 行のもとで引き続き
  `docs/adr` へ migrate する。content pattern のみで到達した route は
  オーナー dir へ一切書き込まない。本文から `docs/adr`・
  `docs/impl/ir`・`docs/impl/exp` へ推測された source は plan / apply
  ともに `unsupported-owner-route` として skip される。apply は全
  canonical target dir の containment を再検査し、checkout を逸脱
  する、または link 経由で解決される target は hard failure であり、
  link 越しの書き込みは行わない。apply が起動する scaffold bootstrap
  も、各ディレクトリ作成と index 書き込みを同じ realpath check で
  gate する。オーナー index（`docs/adr`、`docs/impl/*`）の
  materialize は `index` エントリポイントとオーナー writer に委ね
  られ、apply が再生成するのは shared-suite の managed index のみ
  である。
- `migrate_ids` は legacy `TYPE-NNNN` id と numbered filename を書き換える
  前に discover / mapping / preflight を行う。preflight blocker があれば
  mutation 前に停止し、`ok: false` かつ `failureStage: "preflight"` は
  書き込みゼロを意味する。`apply` は参照を書き換え、ファイルを
  rename し、触れた index をすべてオーナー writer 経由で再生成
  （shared 領域は managed-index writer、`docs/adr` は ADR writer、
  `docs/impl/ir` / `docs/impl/exp` は impl-doc safe sync エンジン）
  してから、`doc-status` audit（duplicate id、未解決 relation、
  壊れた link、index 整合性）でリポジトリを再検証する。各 index は
  `regenerated`、`skipped`、`blocked` のいずれかを報告し、
  skipped / blocked の entry には任意の `reason` が付く。`blocked`
  の index は validation error と同様に run を失敗させる。`ok: false` かつ
  `failureStage: "validation"` は mutation が disk に残ったまま
  rollback されないことを意味し、Git で戻す。
  参照書き換えは artifact 参照を持ち得る全 active 文書を対象とする:
  `docs/`、canonical dir、root-level Markdown（`AGENTS.md`、`README.md`
  など）、配布 agent 文書（`.apm/`、`packages/*/.apm/`）、および
  `--extra-root` で追加した任意ディレクトリ。`EXP-NNNN` experiment 参照は
  canonical な `.jsonl` パスへ書き換え、再配置できない legacy token は
  すべて `unresolved-legacy-reference` として run を停止させる。
- `promote_index` は `docs/adr`、`docs/impl/ir`、`docs/impl/exp` にある
  未編集の旧 scaffold README の取り込みを preview / apply する。適格性は
  バイト単位で判定し、旧 scaffold が生成した index と完全一致する
  ファイルのみが対象で、書き換えはオーナーの index writer に委譲される。
  hand-curated または変更済みのファイルは `rejected` として報告され、
  一切変更されない。

## Read-Write Boundary

- `doc-status`（`list` / `lint` / `audit` / `health`）はファイルを
  一切変更しない。
- managed index の書き換え、link パス正規化、文書 migration ができるのは
  `doc-maintenance` のみで、明示的な apply（whitelist 修復の `apply`、
  managed index materialization の `index apply`）経由に限られる。
- managed index materialization は `index apply` のみを通る。各書き込みは
  ディレクトリのオーナー writer に分派され、impl 索引へは
  `sync_impl_index` の safe sync API 経由でのみ到達する。
- migration も同じ preview-first contract で plan / apply されるが、
  repair コマンドが暗黙に実行することはない。

## リソース

- `scripts/doc_maintenance.js`: safe repair と managed index 再生成の
  plan / apply エントリポイント。`index plan|apply` は全オーナー横断の
  managed index materialization エントリポイント。
- `scripts/migrate_docs.js`、`scripts/migrate_ids.js`、
  `scripts/scaffold_docs.js`、`scripts/promote_index.js`: この skill が
  所有する migration / bootstrap エントリポイント（先の 3 つは
  `doc-driven-dev-graph/scripts/` 配下の互換スクリプト経由でも実行
  可能）。
