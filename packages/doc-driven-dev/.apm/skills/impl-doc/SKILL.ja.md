---
name: impl-doc
description: `docs/impl/` 配下に実装結果と機械可読な実装試行ログを記録するときに使います。
license: MIT
---

# 実装記録スキル

このスキルは、実際に何を実装したか、実装中に何を試したかを記録するために使います。

`impl-doc` は `adr-doc`、`spec-doc`、`design-doc`、`plan-doc`、`task-doc` と
同列の文書生成スキルです。実装フェーズのワークフロースキルではありません。

## 責務

1. `docs/impl/ir/` に Implementation Record を作成する
2. Implementation Record の front matter、relation、本文セクションを監査する
3. `docs/impl/exp/` に Experiment Log を作成する
4. 通常運用では CLI 経由で Experiment Log にイベントを追記する
5. 例外時のみ CLI 経由で既存イベントを編集する
6. Experiment Log の最低限の JSONL 整合性を監査する

## ワークフロー

1. Implementation Record を作成する:

   ```bash
   node scripts/new_impl_record.js --title "Extract foo service" --task docs/tasks/0003-implement-foo-service.md
   ```

2. Experiment Log を作成する:

   ```bash
   node scripts/new_experiment_log.js --title "Try foo service extraction" --task docs/tasks/0003-implement-foo-service.md
   ```

3. 通常のイベント追加は CLI 経由で行う:

   ```bash
   node scripts/append_experiment_event.js \
     --file docs/impl/exp/0001-try-foo-service-extraction.jsonl \
     --type hypothesis \
     --summary "FooService に分離すると BarService の責務を単純化できる可能性がある"
   ```

4. 既存イベントの修正が必要な場合のみ編集 CLI を使う:

   ```bash
   node scripts/edit_experiment_log.js \
     --file docs/impl/exp/0001-try-foo-service-extraction.jsonl \
     --seq 4 \
     --set implementation=docs/impl/ir/0001-extract-foo-service.md
   ```

5. 完了報告前に両方を監査する:

   ```bash
   node scripts/audit_impl_record.js --json
   node scripts/audit_experiment_log.js --json
   ```

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
- `assets/templates/implementation-record.md`: 既定の本文テンプレート
- `assets/templates/experiment-log.jsonl`: 既定の JSONL イベントテンプレート
