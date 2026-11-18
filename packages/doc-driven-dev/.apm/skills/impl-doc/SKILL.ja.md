---
name: impl-doc
description: "docs/impl/ 配下の legacy Implementation Record (ir) と Experiment Log (exp)
  corpus を migration 向けに監査します。Document Registry 3 では migration 専用 —
  通常実行の作成経路はなく、永続的な知見は knowledge-doc で統合します。
  キーワード: implementation record, experiment log, ir, exp, impl 監査, docs/impl"
license: MIT
---

# 実装記録スキル

このスキルは、Registry 2 以前の corpus に残る「実際に何を実装したか、
実装中に何を試したか」を監査するために使います —— migration の入力としてのみ。

`impl-doc` は `adr-doc`、`spec-doc`、`design-doc`、`plan-doc`、`task-doc` と
同列の文書生成スキルです。実装フェーズのワークフロースキルではありません。

## Document Registry v3 の位置づけ

Document Registry 3 では `impl`(Implementation Record)と `exp`(Experiment
Log)は **legacy 形式**です。migration ツーリングのみが解釈し、durable
文書としての作成・lint はできません。`docs/impl/ir`、`docs/impl/exp`、
および `docs/impl` コンテナは migration-owned scope です。

すべての書き込みエントリポイントが registry ゲートで拒否されます —
あらゆるゲートチェック、scope チェック、書き込みより先に:

`Document type "impl" is a legacy format under Document Registry 3: it is interpreted only by migration tooling and cannot be created or linted as a durable document`

- **拒否される mutator**: `new_impl_record.js`、`new_experiment_log.js`、
  `append_experiment_event.js`、`edit_experiment_log.js`、
  `sync_impl_index.js`。
- **読み取り専用の監査は引き続き利用可能**: `audit_impl_record.js` と
  `audit_experiment_log.js` は既存 corpus を検査します(索引ドリフト
  finding を含む)。
- **migration 専用の同期**: `impl-4col` / `exp-1col` の index エンジンは
  `migrate_ids` の内部(同期ライブラリの直接呼び出し)でのみ動作します。
  `doc_maintenance index` はこれらのディレクトリを拒否対象(`... index is
  migration-owned`)として報告し、一切書き込みません。
- Evidence relation(Check → Claim → Evidence)は stored front matter
  relation ではなく Evidence Store に属します。durable な検証意図は
  `verification` 文書(`docs/verification`、verification-doc)です。

以下の規約とワークフローは Registry 2 以前の `docs/impl` corpus を読み取り
・移行するための契約であり、この skill が Git 文書を mint する話では
なくなりました。

## 廃止された既定生成契約

旧契約は、すべての task の最初のコード変更前に in-progress の
Implementation Record を開くことを強制し、IR/EXP を必須の完了証跡と
していました。**その契約は廃止されました** —— 通常の修正は IR も EXP も
強制されるナレッジドキュメントもなく完了し、永続的な知見は
`knowledge-doc` で条件付きに統合します。

## Legacy corpus の形 (migration リファレンス)

以下の表は *Registry 2 以前の corpus の形* —— 旧契約が産んだものと
migration ツーリングが読むもの —— を説明します。legacy な `docs/impl`
ツリーの形式リファレンスであり、新しい作業への作成指示ではありません。

Registry 2 以前の契約は task ごとにこれらのアーティファクトを産みました:

| 状況 (Registry 2 以前) | 産まれたアーティファクト | タイミング (Registry 2 以前) |
| --- | --- | --- |
| task 実装を開始する | in-progress の Implementation Record を作成または再利用する | 最初のコード変更前 に ``--status "in-progress"`` で開始する |
| アプローチが不確実 - 選択肢の調査や仮説の検証が必要 | Experiment Log | 探索的な実装の開始前または開始時に任意で作成する |
| アプローチが明確 - 既知の計画を実行するだけ | exp なし、ir のみ | Experiment Log は省略できるが、Implementation Record は task 開始時に必ず作成する |
| 複数のアプローチを試した | アプローチごとに Experiment Log 1件 | 調査中 |

### Legacy 粒度ルール

- **task-doc 1件 -> ir 1件**: タスクごとに Implementation Record を1件作成する。
  サブタスクは `relations.changes` でリンクする。
- **ir は task 開始時に開く**: task 実装を開始する前、最初のコード変更前 に
  in-progress の Implementation Record を作成または再利用し、実装が進む間に
  本文を更新し続ける。
- **exp は任意**: 本当に探索している場合のみ Experiment Log を作成する。
  解決策が既知の機械的なタスクでも Implementation Record は必須であり、
  Experiment Log だけが不要になる。
- **exp と ir が両方ある場合のリンクは必須**: exp を作成した場合、生成される ir は
  `metadata.experiments.adopted` または `.rejected` でそれを参照しなければならない。

## 責務

1. Implementation Record の front matter、relation、本文セクションを監査
   する(Registry 2 以前の corpus に対する読み取り専用)
2. Experiment Log の最低限の JSONL 整合性を監査する(読み取り専用)
3. migration ツーリングのために `docs/impl/ir` と `docs/impl/exp` の索引を
   解釈する — 同期エンジンは `migrate_ids` の内部でのみ動作する

## ワークフロー

### 拒否される書き込み経路(Registry 3)

`new_impl_record.js`、`new_experiment_log.js`、
`append_experiment_event.js`、`edit_experiment_log.js` はすべて registry
ゲートで拒否されます。`impl` と `exp` は legacy 形式であり、durable な
作成・変更経路はありません。durable な検証意図は `verification-doc` を、
evidence relation は Evidence Store を使います。

### Registry 2 以前 corpus の監査

```bash
node scripts/audit_impl_record.js --json
node scripts/audit_experiment_log.js --json
```

### migration-owned なディレクトリ索引

`docs/impl/ir/README.md` と `docs/impl/exp/README.md` は管理索引であり、
Registry 3 ではその再同期は **migration-owned** です。
`sync_impl_index.js` は他の impl writer と同様に registry ゲートで拒否
されます。safe sync エンジン(`planImplIndexSync` /
`applyImplIndexSync`)は `migrate_ids` の内部(ライブラリ直接呼び出し)
でのみ動作します。

- エンジンが報告する verdict: `in-sync`(no-op)、`sync`(ドリフト解消)、
  `create`(README 欠落)、`rejected`(fail-closed)。手作業でキュレート
  された索引、曖昧・不正・競合した索引、シンボリックリンクの README や
  ディレクトリ外へ出るリンクなど安全でない索引は `rejected` となり、
  絶対に書き込みません。
- apply は再計画し、全ソースファイル・ファイル一覧・README の SHA-256
  ピンを検証してから、temp ファイル + rename でアトミックに書き込みます。
  生成領域の前後にある手書きの preamble / tail はバイト単位で保持され
  ます。
- `doc_status` と `doc_maintenance` の修復 verb は impl 索引を修復
  しません。`doc_maintenance index` はこれらのディレクトリを拒否
  (`... index is migration-owned`)として報告し、同期エンジンへ分派
  しません — migration-owned scope では通常の index 操作が fail-closed
  します。

両監査は読み取り専用で、索引ドリフトを finding として報告します:

- `missing-index` — `README.md` が無い(warning)
- `index-not-managed` — README に生成マーカーが無い、シンボリック
  リンクである、または通常の管理ファイルでない(warning)
- `index-missing-entry` / `index-stale-entry` /
  `index-duplicate-entry` — 行の所属ドリフト(warning)
- `index-metadata-mismatch` / `index-tier-mismatch` — 行セルまたは
  active/settled 層がソースの真実と一致しない(warning)
- `index-ordering` — 行順が決定的順序と異なる(info)
- `index-unparseable` / `index-escapes-root` — 構造が不正、または索引
  ディレクトリ外へ出るリンク(error)

## NEVER

- NEVER Registry 3 で `impl`/`exp` ドキュメントを作成・変更しようとしない —
  すべての mutator が registry ゲートで拒否します; 永続的な知見は
  `knowledge-doc` で統合します
- NEVER legacy corpus 表を通常実行の指示として扱わない — コード変更前に
  Implementation Record は開きません; 常時生成契約は廃止されました
- NEVER 記録量の削減を検証結果の消去と混同しない —
  migration は corpus をそのまま読みます; 減量のために何も削除しません
- NEVER migration や監査対象の corpus 内の JSONL ファイルを手動で編集する -
  Registry 2 以前のツリーでは `append_experiment_event` または
  `edit_experiment_log` を使うこと。直接編集すると `seq` の連続性が壊れる
- NEVER corpus の解釈で複数タスクを1つの ir にまとめる - タスク 1件 = ir 1件。
  追跡可能性はこの 1:1 対応に依存している
- NEVER migration 向けに corpus を読み取れると報告する前に監査ステップを
  省略する - front matter エラーが検出されないと、
  `relations.changes` を参照する下流ツールが壊れる

## 規約

- Implementation Record は legacy doc-suite の front matter 規約に従います。
- `relations.changes` は全ドキュメント共通の relation 契約です。
- v1 では `metadata.record-type` を使いません。
- v1 では `metadata.validation` を使いません。
- Experiment Log の `start` イベントは(legacy corpus において)作成時必須
  ではありません。
- Registry 3 では `new_*`、`append_*`、`edit_*`、`sync_impl_index` の
  すべてが registry ゲートで拒否されます。これらの形式に触れる
  エントリポイントは監査と migration ツーリングだけです。

## リソース

- `references/impl-conventions.md`: ディレクトリ、ファイル名、status、監査
  ルール — 監査または migration 操作の前に必ず読み込むこと
- `assets/templates/implementation-record.md`: legacy 本文テンプレート —
  参照構造のみ。Registry 3 の作成経路で埋めるものではありません
- `assets/templates/experiment-log.jsonl`: legacy JSONL イベントテンプレート —
  参照構造のみ
