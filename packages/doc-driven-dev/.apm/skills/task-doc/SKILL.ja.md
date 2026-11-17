---
name: task-doc
description: plan、spec、ADR、他 task にリンクした実装単位を YAML フロントマター + Markdown で管理するときに使います。
license: MIT
---

# Task Documentation Skill

この skill は、実装とレビューが可能な小さな作業単位を管理するために使います。
task は、それが実装する plan、spec、ADR にリンクし、完了条件を具体的に
書く必要があります。

## Document Registry v3 の位置づけ

Document Registry 3 では `task` は **execution-bound**
(`persistence: ephemeral`)です。task の状態は durable な Git 文書ではなく
Execution Store にあり、`docs/tasks` / `docs/work-items` は durable な
書き込みを受け付けない *former* ディレクトリです。`new_task.js` は
registry ゲートで拒否されます — TASK-DOC-GATE チェック、scope チェック、
あらゆる書き込みより先に:

`Document type "task" is execution-bound (persistence: ephemeral): it has no durable Git form under Document Registry 3 — plan/task state lives in the Execution Store`

以下の前提条件、relation、完了条件の契約は引き続き Execution Store
レコードの task モデル契約であり、Registry 2 以前の `docs/tasks` corpus
の移行(doc-maintenance の `migrate_docs` / `migrate_ids`)にも適用され
ます。この skill が Git 文書を mint する話ではなくなった点に注意して
ください。

## 前提条件

<HARD-GATE>
task を作成するには、以下のいずれかを満たす必要がある:

1. **通常パス**: 参照する plan の `status` が `approved` 以上であること。
   `draft` の plan から task を派生させてはならない。
   plan が未承認の場合は、先に plan のレビューと承認を完了すること。
2. **緊急修正パス**: plan が存在しない場合、以下をすべて満たすこと:
   - 緊急性の理由を task 本文に 1 行記載する。
   - `relations.implements` または `relations.derives-from` で
     `approved` な spec-doc または `accepted` な adr-doc を参照する。
   - 参照する spec/ADR も存在しない場合は、先に spec-doc または
     adr-doc を作成すること（簡潔でも可）。

3. **実装後フォローアップ path**: lifecycle の Phase 4 終了ゲートから
   task を作成する場合、次のすべてを満たすこと:
   - フォローアップ分類が記録されている。
   - `bug-fix` と `doc-only` は現在の承認済み plan、検証済み task、
     または影響を受ける上流文書を参照する。
   - `decision-required` と `new-feature` は、上流の spec、ADR、design、
     plan のルートが完了するまで実装 task にしない。
   - `relations.depends-on` と `relations.blocks` で依存関係を明示する。

いずれのパスも満たさない場合、task を作成してはならない。
</HARD-GATE>

`--plan` が指定された場合、task 作成側は TASK-DOC-GATE-001 を適用する。
参照先 plan が存在し、status が `approved`、`in-progress`、または
`completed` でなければならない。

## ワークフロー

1. task を作成する前に、上記前提条件の通常パス、緊急修正パス、
   または実装後フォローアップ path のいずれかを満たしていることを
   確認する。
2. ひとまとまりの実装単位として task レコードを作成する。

   Document Registry 3 では `new_task.js` が registry ゲートで拒否
   されます(上記 *Document Registry v3 の位置づけ* 参照)。`task` は
   execution-bound なので、レコードは `docs/tasks` のファイルではなく
   Execution Store に作成されます。
   `references/task-conventions.ja.md` がレコード契約を定義し、
   `assets/templates/task.ja.md` が本文の参照構造です。

3. 意味付き relation を使う。
   生成された task は plan を `relations.implements` と
   `relations.depends-on` に記録します。`--depends-on` と `--blocks` は
   繰り返し指定でき、入力順を保ったまま重複を除去して記録します。Task DAG
   では、別の選択 task に解決される `depends-on` は
   `dependency -> この task`、`blocks` は `この task -> ブロックされる task`
   の辺を作ります。plan、spec、ADR、design への参照は上流 artifact relation
   であり、Task DAG の辺ではありません。task 作成は参照を記録するだけで
   DAG 全体を検証しません。解決と検証は `build_task_graph.js` を使います。
   `--verified-by` は繰り返し指定でき、この task が満たす test spec を
   リンクします。各対象はパスまたは ID で既存文書に解決できる必要があります
   （TASK-DOC-GATE-002）。
4. ステータスを更新する。
   `todo`, `in-progress`, `blocked`, `done`, `wont-do` を使います。
5. task は小さく保つ。
   無関係なファイル、挙動、検証経路が混ざる場合は分割します。下限も
   設けます: task ファイルは委譲可能な作業単位とし、一貫した 1 アクションに
   満たない項目はマイクロ task ファイルを作らず plan 自身のタスクリストに
   畳み込みます。

## 完了条件の要件

すべての task に `## 検証` セクションを含め、少なくとも 1 つの
機械検証可能なコマンドを記載してください。人手のみの確認は補足として
許容されますが、唯一の検証手段にしてはいけません。

**必須フォーマット:**

```markdown
## 検証

- [ ] `npm test -- --filter=checkout-button` が exit 0
- [ ] `grep -r 'CheckoutButton' src/components/` がマッチを返す
- [ ] 手動: Storybook でボタンが描画される（補足のみ）
```

**ルール:**

1. 少なくとも 1 項目は、期待される終了コードまたは出力パターン付きの
   実行可能コマンドであること。
2. コマンドは修正なしにコピーペーストで実行できること（プレースホルダー禁止）。
3. 自動チェックが不可能な場合は理由を文書化し、自動化の
   フォローアップ task を追加する。

すべての検証コマンドがパスするまで、task を `done` に移動できません。
task のステータス遷移は Execution Store の状態変更であり、Registry 3 で
再生成すべき `docs/tasks` の索引は存在しません。

## リソース

- `scripts/new_task.js`: Registry 3 では registry ゲートで拒否されます。
  `task` は execution-bound であり、durable な作成経路はありません。
- `references/task-conventions.ja.md`: task レコードのステータス、
  relation、必須内容、規約です。
- `assets/templates/task.ja.md`: task 本文テンプレートです。
  スクリプトが埋めるファイルではなく、Execution Store レコードの参照
  構造です。
