---
name: impl-doc
description: |
  `docs/impl/` 配下に Implementation Record（ir）と Experiment Log（exp）を
  作成・管理し、実際に実装したことと試したことを追跡可能にします。

  使うとき:
  (1) アプローチが不確実なタスク開始時 — 仮説・観察を記録する Experiment Log を
      解決策を決める前に作成する
  (2) タスク完了時 — 実装内容・意思決定・採用／却下した実験を記録する
      Implementation Record を作成する
  (3) タスクや PR をクローズする前に impl ドキュメントを監査する

  キーワード: implementation record, experiment log, ir, exp, タスク文書,
  実装追跡, 仮説, 観察, impl 監査, docs/impl
license: MIT
---

# 実装記録スキル

このスキルは、実際に何を実装したか、実装中に何を試したかを記録するために使います。

`impl-doc` は `adr-doc`、`spec-doc`、`design-doc`、`plan-doc`、`task-doc` と
同列の文書生成スキルです。実装フェーズのワークフロースキルではありません。

## いつ何を作るか

コマンドを実行する前に、必要なアーティファクトを決定してください:

| 状況 | 作成するもの | タイミング |
|------|------------|-----------|
| アプローチが不確実 — 選択肢の調査や仮説の検証が必要 | Experiment Log | 実装開始前または開始時 |
| アプローチが明確 — 既知の計画を実行するだけ | exp なし、ir のみ | タスク完了時 |
| タスクが完了してクローズ準備ができた | Implementation Record | タスクをクローズする前 |
| 複数のアプローチを試した | アプローチごとに Experiment Log 1件 | 調査中 |

### 粒度ルール

- **task-doc 1件 → ir 1件**: タスクごとに Implementation Record を1件作成する。
  サブタスクは `relations.changes` でリンクする。
- **exp は任意**: 本当に探索している場合のみ Experiment Log を作成する。
  解決策が既知の機械的なタスクには不要。
- **exp と ir が両方ある場合のリンクは必須**: exp を作成した場合、生成される ir は
  `metadata.experiments.adopted` または `.rejected` でそれを参照しなければならない。

## 責務

1. `docs/impl/ir/` に Implementation Record を作成する
2. Implementation Record の front matter、relation、本文セクションを監査する
3. `docs/impl/exp/` に Experiment Log を作成する
4. 通常運用では CLI 経由で Experiment Log にイベントを追記する
5. 例外時のみ CLI 経由で既存イベントを編集する
6. Experiment Log の最低限の JSONL 整合性を監査する

## ワークフロー

### Implementation Record の作成

**必須**: このステップの前に `references/impl-conventions.md` を読み込むこと —
必須 front matter フィールドと監査ルールが定義されています。
**読み込まないもの**: `assets/templates/experiment-log.jsonl`。

```bash
node scripts/new_impl_record.js --title "Extract foo service" --task docs/tasks/0003-implement-foo-service.md
```

### Experiment Log の作成

**必須**: このステップの前に `references/impl-conventions.md` を読み込むこと —
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

- NEVER ir を記憶を頼りに事後に書く — ir は実装中に下された判断を記録するものであり、
  事後の叙述ではない
- NEVER JSONL ファイルを手動で編集する — `append_experiment_event` または
  `edit_experiment_log` を使うこと。直接編集すると `seq` の連続性が壊れる
- NEVER 複数タスクを1つの ir にまとめる — タスク 1件 = ir 1件。
  追跡可能性はこの 1:1 対応に依存している
- NEVER 完了報告前に監査ステップを省略する — front matter エラーが検出されないと、
  `relations.changes` を参照する下流ツールが壊れる
- NEVER タスク完了後に exp を作成する — exp はリアルタイムの観察を記録するものであり、
  事後メモではない

## 規約

- Implementation Record は既存 doc-suite の front matter 規約に従います。
- `relations.changes` は全ドキュメント共通の relation 契約です。
- v1 では `metadata.record-type` を使いません。
- v1 では `metadata.validation` を使いません。
- Experiment Log の `start` イベントは作成時必須ではありません。
- 正規経路は CLI による作成・更新であり、自由な手編集を前提にしません。
- Trust boundary: `new_*`、`append_*`、`edit_*` コマンドは state-changing
  operation であり、`--task`、`--file`、または既定の出力規約で決まる
  path に即時書き込みます。

## リソース

- `references/impl-conventions.md`: ディレクトリ、ファイル名、status、監査ルール
  — 作成・監査操作の前に必ず読み込むこと
- `assets/templates/implementation-record.md`: 既定の本文テンプレート
  — `new_impl_record.js` が自動的に使用する。手動で読み込まないこと
- `assets/templates/experiment-log.jsonl`: 既定の JSONL イベントテンプレート
  — `new_experiment_log.js` が自動的に使用する。手動で読み込まないこと
