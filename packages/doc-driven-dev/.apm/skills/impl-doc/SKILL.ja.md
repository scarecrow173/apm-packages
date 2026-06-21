---
name: impl-doc
description: "実際に実装したこと（ir）と実装中に試したこと（exp）を docs/impl/ 配下に記録します。
  タスクの Implementation Record または Experiment Log を作成・監査するときに使います。
  キーワード: implementation record, experiment log, ir, exp, impl 監査, docs/impl"
license: MIT
---

# 実装記録スキル

このスキルは、実際に何を実装したか、実装中に何を試したかを記録するために使います。

`impl-doc` は `adr-doc`、`spec-doc`、`design-doc`、`plan-doc`、`task-doc` と
同列の文書生成スキルです。実装フェーズのワークフロースキルではありません。

## いつ何を作るか

コマンドを実行する前に、必要なアーティファクトを決定してください:

| 状況 | 作成するもの | タイミング |
| --- | --- | --- |
| task 実装を開始する | in-progress の Implementation Record を作成または再利用する | 最初のコード変更前 に ``--status "in-progress"`` で開始する |
| アプローチが不確実 - 選択肢の調査や仮説の検証が必要 | Experiment Log | 探索的な実装の開始前または開始時に任意で作成する |
| アプローチが明確 - 既知の計画を実行するだけ | exp なし、ir のみ | Experiment Log は省略できるが、Implementation Record は task 開始時に必ず作成する |
| 複数のアプローチを試した | アプローチごとに Experiment Log 1件 | 調査中 |

### 粒度ルール

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

1. `docs/impl/ir/` に Implementation Record を作成する
2. Phase 5 の進行中に in-progress の Implementation Record 本文を更新する
3. Implementation Record の front matter、relation、本文セクションを監査する
4. `docs/impl/exp/` に Experiment Log を作成する
5. 通常運用では CLI 経由で Experiment Log にイベントを追記する
6. 例外時のみ CLI 経由で既存イベントを編集する
7. Experiment Log の最低限の JSONL 整合性を監査する

## ワークフロー

### Implementation Record の作成

**必須**: このステップの前に `references/impl-conventions.md` を読み込むこと -
必須 front matter フィールドと監査ルールが定義されています。
**読み込まないもの**: `assets/templates/experiment-log.jsonl`。

Phase 5 では task 開始時に in-progress の Implementation Record を作成または
再利用し、最初のコード変更前 に開いておきます。実装が進むにつれて record 本文を
更新してください。Implementation Record は Markdown 文書であり、CLI は初期作成と監査を担当する。
Experiment Log の JSONL は `append_experiment_event` または `edit_experiment_log` だけで更新する。

```bash
node scripts/new_impl_record.js --title "Extract foo service" --task docs/tasks/0003-implement-foo-service.md --status "in-progress"
```

### Experiment Log の作成

**必須**: このステップの前に `references/impl-conventions.md` を読み込むこと -
許可されたイベント種別と JSONL 整合性ルールが定義されています。
**読み込まないもの**: `assets/templates/implementation-record.md`。

```bash
node scripts/new_experiment_log.js --title "Try foo service extraction" --task docs/tasks/0003-implement-foo-service.md
```

### イベントの追記

```bash
node scripts/append_experiment_event.js \
  --file docs/impl/exp/0001-try-foo-service-extraction.jsonl \
  --type hypothesis \
  --summary "FooService に分離すると BarService の責務を単純化できる可能性がある"
```

### 既存イベントの編集（例外時のみ）

```bash
node scripts/edit_experiment_log.js \
  --file docs/impl/exp/0001-try-foo-service-extraction.jsonl \
  --seq 4 \
  --set implementation=docs/impl/ir/0001-extract-foo-service.md
```

### 完了前の監査

```bash
node scripts/audit_impl_record.js --json
node scripts/audit_experiment_log.js --json
```

## NEVER

- NEVER task 実装を開始する前に in-progress の ir を作成または再利用せずに
  実装へ入らない
- NEVER 解決策が既知の task だからといって ir 作成を省略しない -
  既知解でも task 開始時の Implementation Record は必須
- NEVER ir を記憶を頼りに事後に書く - ir は実装中に下された判断を記録するものであり、
  事後の叙述ではない
- NEVER JSONL ファイルを手動で編集する - `append_experiment_event` または
  `edit_experiment_log` を使うこと。直接編集すると `seq` の連続性が壊れる
- NEVER 複数タスクを1つの ir にまとめる - タスク 1件 = ir 1件。
  追跡可能性はこの 1:1 対応に依存している
- NEVER 完了報告前に監査ステップを省略する - front matter エラーが検出されないと、
  `relations.changes` を参照する下流ツールが壊れる
- NEVER タスク完了後に exp を作成する - exp はリアルタイムの観察を記録するものであり、
  事後メモではない

## 規約

- Implementation Record は既存 doc-suite の front matter 規約に従います。
- `relations.changes` は全ドキュメント共通の relation 契約です。
- v1 では `metadata.record-type` を使いません。
- v1 では `metadata.validation` を使いません。
- Phase 5 では task 開始時に Implementation Record を開くか再利用し、実装中に
  内容を継続更新します。
- Experiment Log の JSONL は `append_experiment_event` または
  `edit_experiment_log` だけで更新する。
- Experiment Log の `start` イベントは作成時必須ではありません。
- 正規経路は CLI による作成・更新であり、自由な手編集を前提にしません。
- Trust boundary: `new_*`、`append_*`、`edit_*` コマンドは state-changing
  operation であり、`--task`、`--file`、または既定の出力規約で決まる
  path に即時書き込みます。

## リソース

- `references/impl-conventions.md`: ディレクトリ、ファイル名、status、監査ルール
  - 作成・監査操作の前に必ず読み込むこと
- `assets/templates/implementation-record.md`: 既定の本文テンプレート
  - `new_impl_record.js` が自動的に使用する。手動で読み込まないこと
- `assets/templates/experiment-log.jsonl`: 既定の JSONL イベントテンプレート
  - `new_experiment_log.js` が自動的に使用する。手動で読み込まないこと
