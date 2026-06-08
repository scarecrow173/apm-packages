# impl-doc スキル実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `doc-driven-dev-apm` に新しい `impl-doc` 文書生成スキルを追加し、既存 doc-suite の規約と整合した Implementation Record と Experiment Log の作成・追記・編集・監査を CLI 経由で扱えるようにする。

**Architecture:** `impl-doc` は `adr-doc` / `spec-doc` / `plan-doc` / `task-doc` と同列の文書生成スキルとして実装し、実装フェーズのワークフロースキルとしては扱わない。Implementation Record は既存 doc-suite の命名規約と front matter 規約を継承し、`relations.changes` は全ドキュメント共通の relation として共通層へ昇格する。Implementation Record も Experiment Log も手編集前提ではなく CLI 経由を正規経路とし、Implementation Record には作成 CLI と監査 CLI、Experiment Log には作成 CLI、追記 CLI、編集 CLI、最低限の監査 CLI を責務分離して実装する。

**Tech Stack:** Markdown テンプレート、日英両対応の配布スキル文書、`src/skills` 配下の TypeScript CLI、生成される `.apm` JavaScript、Node.js test runner、`gray-matter`、`zod`

---

## Task 1: `relations.changes` を共通 doc-suite 契約へ追加する

**Files:**

- Modify: `packages/doc-driven-dev-apm/src/skills/lib/doc_suite_utils.ts`
- Modify: `packages/doc-driven-dev-apm/tests/doc-suite.test.ts`
- Modify: `packages/doc-driven-dev-apm/README.md`
- Modify: `packages/doc-driven-dev-apm/README.ja.md`

- [ ] **Step 1: 全ドキュメント共通の `changes` スキーマを relation 契約に追加する**

既存の relation 配列を壊さずに、すべての doc-suite 文書が `relations.changes` object を持てるように共通スキーマを拡張する。

```ts
const changeEntrySchema = z.object({
  type: z.string().min(1),
}).passthrough();

const changesSchema = z.object({
  added: z.array(changeEntrySchema).default([]),
  modified: z.array(changeEntrySchema).default([]),
  deleted: z.array(changeEntrySchema).default([]),
  renamed: z.array(changeEntrySchema).default([]),
  moved: z.array(changeEntrySchema).default([]),
  generated: z.array(changeEntrySchema).default([]),
}).default({});
```

- [ ] **Step 2: 既存文書生成の安定性を保ったまま空の `changes` ブロックを出力する**

既存の `spec` / `design` / `plan` / `task` 生成結果に、従来の relation 配列に加えて空の `changes` ブロックが入るよう front matter 描画を調整する。

```yaml
relations:
  source: []
  changes:
    added: []
    modified: []
    deleted: []
    renamed: []
    moved: []
    generated: []
  implements: []
  implemented-by: []
```

- [ ] **Step 3: 共通テストを拡張して新しい relation 形状を固定する**

`spec` / `plan` / `task` / `design` の生成テストで、`relations.changes` の 6 フィールドがすべて空配列で出力されることを確認する。

```bash
pnpm -s exec tsx --test tests/doc-suite.test.ts
```

期待結果: exit `0`

- [ ] **Step 4: README を日英両方更新して共通 relation 契約を明記する**

パッケージ README の shared relations 例に `changes` を追加し、`impl-doc` が変更対象ファイルの追跡にこの共通フィールドを使うことを説明する。

```md
relations:
  source: []
  changes:
    added: []
    modified: []
    deleted: []
    renamed: []
    moved: []
    generated: []
```

## Task 2: `impl-doc` の配布スキル、参照文書、テンプレートを日英で追加する

**Files:**

- Create: `packages/doc-driven-dev-apm/.apm/skills/impl-doc/SKILL.md`
- Create: `packages/doc-driven-dev-apm/.apm/skills/impl-doc/SKILL.ja.md`
- Create: `packages/doc-driven-dev-apm/.apm/skills/impl-doc/references/impl-conventions.md`
- Create: `packages/doc-driven-dev-apm/.apm/skills/impl-doc/references/impl-conventions.ja.md`
- Create: `packages/doc-driven-dev-apm/.apm/skills/impl-doc/assets/templates/implementation-record.md`
- Create: `packages/doc-driven-dev-apm/.apm/skills/impl-doc/assets/templates/implementation-record.ja.md`
- Create: `packages/doc-driven-dev-apm/.apm/skills/impl-doc/assets/templates/experiment-log.jsonl`
- Create: `packages/doc-driven-dev-apm/.apm/skills/impl-doc/assets/templates/experiment-log.ja.jsonl`

- [ ] **Step 1: `impl-doc` を兄弟の文書生成スキルとして定義する**

配布 `SKILL.md` では、`impl-doc` を 2 つの責務を持つ文書生成スキルとして説明する。

```md
---
name: impl-doc
description: Use when recording implemented outcomes and machine-readable implementation experiments under docs/impl/.
license: MIT
---
```

責務:

```text
1. Implementation Record を作成する
2. Implementation Record を監査する
3. Experiment Log を作成する
4. Experiment Log に安全にイベント追記する
5. 既存 Experiment Log を必要時に編集する
6. Experiment Log を最低限監査する
```

- [ ] **Step 2: 修正済み v1 仕様を `impl-conventions` に落とし込む**

以下の合意内容を日英の conventions 文書に明記する。

```text
- 既存 doc-suite front matter に合わせる
- relations.changes は全ドキュメント共通
- Implementation Record は metadata.record-type を持たない
- v1 では metadata.validation を持たない
- Experiment Log は create と minimum audit を持つ
- start イベントは作成時必須ではない
```

- [ ] **Step 3: Implementation Record テンプレートを v1 仕様で作成する**

`metadata.record-type` と `metadata.validation` は入れず、`metadata.experiments` のみ持つテンプレートを作成する。

```yaml
---
id: "IMPL-0001"
type: "impl"
status: "completed"
title: "Extract foo service"
created: "2026-06-08"
updated: "2026-06-08"
owners: []
relations:
  source: []
  changes:
    added: []
    modified: []
    deleted: []
    renamed: []
    moved: []
    generated: []
  implements: []
  implemented-by: []
  depends-on: []
  blocks: []
  supersedes: []
  superseded-by: []
  related: []
  refines: []
  refined-by: []
  derives-from: []
  derived-by: []
  verifies: []
  verified-by: []
  references: []
metadata:
  experiments:
    adopted: []
    rejected: []
---
```

- [ ] **Step 4: `start` 非必須の JSONL 例をテンプレートとして同梱する**

Experiment Log のサンプルは `start` を必須にせず、最初のイベントが `hypothesis` / `change` / `observation` のいずれでも成立する例にする。`implementation` は後から追記可能とする。

```jsonl
{"schema":"experiment_event.v1","experiment":"docs/impl/exp/0001-try-foo-service-extraction.jsonl","seq":1,"type":"hypothesis","ts":"2026-06-08T10:03:00+09:00","summary":"FooServiceに分離すれば責務を単純化できる"}
```

## Task 3: `impl-doc` の TypeScript CLI を実装する

**Files:**

- Create: `packages/doc-driven-dev-apm/src/skills/impl-doc/scripts/new_impl_record.ts`
- Create: `packages/doc-driven-dev-apm/src/skills/impl-doc/scripts/audit_impl_record.ts`
- Create: `packages/doc-driven-dev-apm/src/skills/impl-doc/scripts/new_experiment_log.ts`
- Create: `packages/doc-driven-dev-apm/src/skills/impl-doc/scripts/append_experiment_event.ts`
- Create: `packages/doc-driven-dev-apm/src/skills/impl-doc/scripts/edit_experiment_log.ts`
- Create: `packages/doc-driven-dev-apm/src/skills/impl-doc/scripts/audit_experiment_log.ts`
- Create: `packages/doc-driven-dev-apm/src/skills/impl-doc/scripts/lib/impl_doc_utils.ts`
- Modify: `packages/doc-driven-dev-apm/package.json`

- [ ] **Step 1: `ir/` と `exp/` 専用のディレクトリ検出と採番ヘルパーを作る**

`impl-doc` は現在の Markdown 専用 `createDocument()` に無理に載せず、専用 helper で以下を解決する。

```text
docs/impl/ir
docs/impl/exp
```

要件:

```text
- ir と exp は別系列で採番する
- slug 化は既存 document_utils と整合させる
- README.md / index 的な補助出力は ir と exp で必要な範囲に限定する
```

- [ ] **Step 2: `new_impl_record.ts` をテンプレート駆動で実装する**

CLI は兄弟スキルと同じ使い方に寄せる。

```bash
node scripts/new_impl_record.js --title "Extract foo service" --task docs/tasks/0003-implement-foo-service.md
```

生成物:

```text
docs/impl/ir/0001-extract-foo-service.md
docs/impl/ir/README.md
```

要件:

```text
- relations.implements を初期化する
- metadata.experiments.adopted / rejected を空配列で初期化する
- metadata.record-type は出力しない
- metadata.validation は出力しない
```

- [ ] **Step 3: `audit_impl_record.ts` を report-only 監査 CLI として実装する**

Implementation Record も正規経路を CLI に揃えるため、兄弟スキルの監査 CLI に寄せた最低限の Markdown 監査を追加する。

```bash
node scripts/audit_impl_record.js --dir docs/impl/ir --json
```

監査項目:

```text
- front matter の必須項目が存在する
- type が impl である
- status が許可値に含まれる
- relations.changes が required shape を満たす
- metadata.experiments.adopted / rejected が配列である
- relations のローカル参照先が存在する
- 必須本文セクションが存在する
```

- [ ] **Step 4: `new_experiment_log.ts` を作成専用 CLI として実装する**

作成時点では `start` も `implementation` も必須にしない。

```bash
node scripts/new_experiment_log.js --title "Try foo service extraction" --task docs/tasks/0003-implement-foo-service.md
```

生成物:

```text
docs/impl/exp/0001-try-foo-service-extraction.jsonl
```

要件:

```text
- 空 JSONL または seed event ありのどちらかで生成できる
- task 参照は持てる
- implementation は後から追記可能
```

- [ ] **Step 5: `append_experiment_event.ts` を通常運用の標準経路として実装する**

Experiment Log への日常的な記録追加は手編集ではなく CLI 経由を基本にする。追記 CLI は末尾追加のみを許可し、構造整合を維持する。

```bash
node scripts/append_experiment_event.js \
  --file docs/impl/exp/0001-try-foo-service-extraction.jsonl \
  --type hypothesis \
  --summary "FooServiceに分離すれば責務を単純化できる"
```

要件:

```text
- seq を自動採番する
- ts を未指定時に自動補完する
- schema を既定値で補完する
- experiment の値を対象ファイルへ正規化する
- start イベントを前提にしない
- implementation の後付けを許可する
```

- [ ] **Step 6: `edit_experiment_log.ts` を例外運用の編集 CLI として実装する**

既存ログの誤記修正や後付け参照追加は、追記 CLI と分けた編集 CLI に集約する。通常運用の追記と混ぜず、変更対象イベントを明示させる。

```bash
node scripts/edit_experiment_log.js \
  --file docs/impl/exp/0001-try-foo-service-extraction.jsonl \
  --seq 4 \
  --set implementation=docs/impl/ir/0001-extract-foo-service.md \
  --set reason="採用実装に関連付け"
```

要件:

```text
- 対象イベントは seq で特定する
- 既存イベントの部分更新のみ許可する
- seq の再採番はしない
- experiment パス整合を維持する
- 変更後に audit 可能な JSONL を保つ
```

- [ ] **Step 7: `audit_experiment_log.ts` を最低限監査 CLI として実装する**

兄弟スキルの report-only スタイルに合わせ、最低限の構造監査のみ行う。

```bash
node scripts/audit_experiment_log.js --dir docs/impl/exp --json
```

監査項目:

```text
- ファイルが存在し .jsonl で終わる
- 各行が JSON として parse できる
- 各イベントが schema / experiment / seq / type / ts を持つ
- seq が一意かつ昇順である
- experiment の値が現在のファイルパスと一致する
- type が許可されたイベント種別に含まれる
```

- [ ] **Step 5: 既存 build:scripts で配布 JavaScript が生成されるようにする**
- [ ] **Step 8: 既存 build:scripts で配布 JavaScript が生成されるようにする**

新規スクリプトを既存ビルドへ乗せ、追加のビルドコマンドは導入しない。

```bash
pnpm run build:scripts
```

期待生成物:

```text
.apm/skills/impl-doc/scripts/new_impl_record.js
.apm/skills/impl-doc/scripts/audit_impl_record.js
.apm/skills/impl-doc/scripts/new_experiment_log.js
.apm/skills/impl-doc/scripts/append_experiment_event.js
.apm/skills/impl-doc/scripts/edit_experiment_log.js
.apm/skills/impl-doc/scripts/audit_experiment_log.js
```

## Task 4: `impl-doc` のテストと共通 relation 回帰テストを追加する

**Files:**

- Create: `packages/doc-driven-dev-apm/tests/impl-doc.test.ts`
- Modify: `packages/doc-driven-dev-apm/tests/doc-suite.test.ts`

- [ ] **Step 1: Implementation Record 作成の正常系テストを追加する**

`new_impl_record.js` の正常系で以下を確認する。

```text
- docs/impl/ir/0001-*.md が作成される
- README.md が更新される
- front matter に type / status / title / owners / relations.changes が含まれる
- metadata.experiments.adopted / rejected が存在する
- metadata.record-type は存在しない
- metadata.validation は存在しない
```

- [ ] **Step 2: Implementation Record 監査 CLI の正常系・異常系テストを追加する**

`audit_impl_record.js` に対して以下を検証する。

```text
- 正常な impl record は警告なしまたは期待どおりの結果で通る
- front matter 欠落を検出する
- invalid status を検出する
- 壊れた relations.changes shape を検出する
- 欠落した local relation target を検出する
- 必須本文セクション不足を検出する
```

- [ ] **Step 3: Experiment Log 作成テストを追加する**

以下を検証する。

```text
- docs/impl/exp/0001-*.jsonl が作成される
- ir と exp の採番が独立している
- 空ファイルまたは start 以外の seed event でも作成できる
- implementation は作成時必須ではない
```

- [ ] **Step 4: イベント追記 CLI の安全性テストを追加する**

`append_experiment_event.js` に対して以下を検証する。

```text
- 末尾に 1 イベントだけ追加される
- seq が自動採番される
- ts / schema / experiment が補完される
- start が無くても追記できる
- implementation の後付けイベントを追加できる
```

- [ ] **Step 5: 既存ログ編集 CLI の部分更新テストを追加する**

`edit_experiment_log.js` に対して以下を検証する。

```text
- seq 指定で対象イベントを 1 件だけ更新できる
- implementation / reason / summary などを部分更新できる
- seq 自体は変更されない
- 壊れた更新要求はエラーになる
```

- [ ] **Step 6: 最低限監査 CLI の正常系・異常系テストを追加する**

正常な JSONL と壊れた JSONL を作り、次で監査する。

```bash
pnpm -s exec tsx --test tests/impl-doc.test.ts
```

期待 finding:

```text
- invalid-json
- invalid-event-shape
- non-monotonic-seq
- invalid-event-type
```

- [ ] **Step 7: 既存 doc-suite 生成テストへ `relations.changes` の回帰確認を追加する**

既存スキルの生成結果が壊れず、共通の空 `changes` object が入ることを確認する。

## Task 5: パッケージ文書を更新し、全体検証を行う

**Files:**

- Modify: `packages/doc-driven-dev-apm/README.md`
- Modify: `packages/doc-driven-dev-apm/README.ja.md`
- Test: `packages/doc-driven-dev-apm/src/skills/impl-doc/scripts/*.ts`
- Test: `packages/doc-driven-dev-apm/.apm/skills/impl-doc/scripts/*.js`
- Test: `packages/doc-driven-dev-apm/tests/*.test.ts`

- [ ] **Step 1: パッケージのスキル一覧へ `impl-doc` を日英で追加する**

位置付けは artifact progression として次のように説明する。

```text
task-doc -> impl-doc -> implementation-flow
```

ただし説明文では、`impl-doc` を workflow skill ではなく doc-generation skill と明記する。

- [ ] **Step 2: 配布 JavaScript を再生成する**

```bash
pnpm run build:scripts
```

期待結果: `.apm/skills/impl-doc/scripts/*.js` が新しい TypeScript 実装から生成される

- [ ] **Step 3: パッケージのテスト一式を実行する**

```bash
pnpm test
```

期待結果: exit `0`

- [ ] **Step 4: 日本語文書を含めた Markdown lint を実行する**

```bash
pnpm run lint:md
```

期待結果: exit `0`

- [ ] **Step 5: v1 で意図的に先送りする項目を完了報告へ残す**

完了報告では以下のみを意図的な非実装として明記する。

```text
- v1 では metadata.validation を持たない
- v1 では metadata.record-type を持たない
- Implementation Record 作成時の自動 log 追記は v1 では持たない
- v1 では Implementation Record / Experiment Log の index 更新を最小限に留める
```

## Self-Review

1. **Spec coverage:** この計画は、doc-suite 準拠、`relations.changes` の全体昇格、Implementation Record の create + audit CLI、Experiment Log の create + append + edit + minimum audit CLI、`start` 非必須、`metadata.validation` と `record-type` の除外、日本語同期、の全要件をカバーしている。
2. **Placeholder scan:** `TBD`、`TODO`、`implement later` のような曖昧な記述は含めていない。未実装項目は v1 の意図的なスコープ外としてのみ記述している。
3. **Type consistency:** `impl-doc`、Implementation Record、Experiment Log、`relations.changes`、`metadata.experiments`、`new_impl_record`、`audit_impl_record`、`new_experiment_log`、`append_experiment_event`、`edit_experiment_log`、`audit_experiment_log` を計画全体で同じ意味で使っている。

## Execution Handoff

Plan complete and saved to `packages/doc-driven-dev-apm/docs/superpowers/plans/2026-06-08-impl-doc-skill.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
