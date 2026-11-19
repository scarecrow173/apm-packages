---
name: task-doc
description: Execution Store run の task レコード契約 — 承認済み run plan を実行可能な単位に分解するとき、task の依存関係と完了条件を定義するとき、または v3 以前の docs/tasks corpus を移行するときに使います。task は durable な Markdown 文書ではなく (runId, taskId) のレコードです。
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
書き込みを受け付けない *former* ディレクトリです。`new_task.js` creator は
配布されていません(Issue #249 で削除) — `task` を解釈するのは registry
だけであり、その型名は共有クエリ面で拒否します:

`Document type "task" is execution-bound (persistence: ephemeral): it has no durable Git form under Document Registry 3 — plan/task state lives in the Execution Store`

以下の前提条件、依存関係、完了条件の契約は引き続き Execution Store
レコードの task モデル契約であり、Registry 2 以前の `docs/tasks` corpus
の移行(doc-maintenance の `migrate_docs` / `migrate_ids`)にも適用され
ます。この skill が Git 文書を mint する話ではなくなった点に注意して
ください。

## 前提条件

<HARD-GATE>
run に task レコードを作成するには、以下のいずれかを満たす必要がある:

1. **通常パス**: run の `plan.md` が digest-bound な承認を持つこと —
   さもなければ Task Graph の `plan-not-approved` ゲートが fail-closed
   します。未承認の plan から task を派生させてはなりません。
   plan が未承認の場合は、先にレビューと `approve-plan` を完了すること。
2. **緊急修正パス**: plan が存在しない場合、以下をすべて満たすこと:
   - 緊急性の理由を task レコード本文に 1 行記載する。
   - レコードの `checks` または run plan で `approved` な spec-doc または
     `accepted` な adr-doc を参照する — durable な artifact が上流の
     アンカーです。
   - 参照する spec/ADR も存在しない場合は、先に spec-doc または
     adr-doc を作成すること（簡潔でも可）。

3. **実装後フォローアップ path**: lifecycle の Phase 4 終了ゲートから
   task を作成する場合、次のすべてを満たすこと:
   - フォローアップ分類が記録されている。
   - `bug-fix` と `doc-only` は現在の承認済み run plan、検証済み task
     レコード、または影響を受ける上流文書を参照する。
   - `decision-required` と `new-feature` は、上流の spec、ADR、design、
     plan のルートが完了するまで実装 task にしない。
   - 依存関係はレコードの `dependsOn` で明示する — 同一 run 内の兄弟
     task id のみ。

いずれのパスも満たさない場合、task を作成してはならない。
</HARD-GATE>

task の同一性は `(runId, taskId)` です。レコードは自分の run の中にだけ
存在し、`dependsOn` は同一 run の兄弟レコードを指し、`blocks` は派生した
逆向きの projection であって独立したフィールドではありません。

## ワークフロー

1. task を作成する前に、上記前提条件の通常パス、緊急修正パス、
   または実装後フォローアップ path のいずれかを満たしていることを
   確認する。
2. ひとまとまりの実装単位として task レコードを作成する。

   Document Registry 3 では `new_task.js` creator は配布されていません
   (上記 *Document Registry v3 の位置づけ* 参照)。`task` は
   execution-bound なので、レコードは `docs/tasks` のファイルではなく
   Execution Store に作成されます。
   `references/task-conventions.ja.md` がレコード契約を定義し、
   `assets/templates/task.ja.md` が本文の参照構造です。

3. 意味のある依存関係を使う。
   task レコードの `dependsOn` は、先に `done` になる必要のある同一 run
   内の兄弟 task id を列挙します — 各エントリが Task DAG に
   `dependency -> この task` の辺を作り、`blocks` は別途宣言するのでは
   なく逆向き projection として導出されます。`dependsOn` が durable な
   artifact や別 run の task を指すことはありません。上流のアンカー
   （spec、ADR、design、run の plan）は依存フィールドではなく `checks`
   の記述や plan 本文に置きます。task 作成は依存関係を記録するだけで
   DAG 全体を検証しません。解決と検証には `build_task_graph.js --run`
   を使います。
4. ステータスを更新する。
   `todo`, `in-progress`, `blocked`, `done`, `wont-do` を使います。
5. task は小さく保つ。
   無関係なファイル、挙動、検証経路が混ざる場合は分割します。下限も
   設けます: task は委譲可能な作業単位とし、一貫した 1 アクションに
   満たない項目はマイクロ task を作らず plan 自身のタスクリストに
   畳み込みます。

## 完了条件の要件

すべての task レコードは `checks` に少なくとも 1 つの機械検証可能な
エントリを宣言する必要があります — Registry 3 以前の `## 検証` 契約を
引き継ぐフィールドです。人手のみの確認は補足として許容されますが、
唯一の検証手段にしてはいけません。

**必須レコード形式:**

```json
{
  "taskId": "TASK-0001",
  "title": "…",
  "status": "todo",
  "dependsOn": [],
  "checks": [
    "`npm test -- --filter=checkout-button` が exit 0",
    "`grep -r 'CheckoutButton' src/components/` がマッチを返す",
    "手動: Storybook でボタンが描画される（補足のみ）"
  ],
  "scope": ["src/components/checkout/"]
}
```

**ルール:**

1. 少なくとも 1 つの `checks` エントリは、期待される終了コードまたは
   出力パターン付きの実行可能コマンドであること。
2. コマンドは修正なしにコピーペーストで実行できること（プレースホルダー禁止）。
3. 自動チェックが不可能な場合は理由を文書化し、自動化の
   フォローアップ task を追加する。
4. `scope` は task の書き込み境界を宣言します — 並列安全性判定が
   照合する対象なので、検証可能な repo 相対パスを保ってください。

すべての検証コマンドがパスするまで、task を `done` に移動できません。
task のステータス遷移は Execution Store の状態変更であり、Registry 3 で
再生成すべき `docs/tasks` の索引は存在しません。

## リソース

- `new_task.js`: Registry 3 で*削除*されました。`task` は
  execution-bound であり、durable な作成経路はありません。run task は
  `planning-flow` が Execution Store レコードとしてのみ mint します。
- `references/task-conventions.ja.md`: task レコードのステータス値、
  依存関係、必須内容、規約です。
- `assets/templates/task.ja.md`: task 本文テンプレートです。
  スクリプトが埋めるファイルではなく、Execution Store レコードの参照
  構造です。
