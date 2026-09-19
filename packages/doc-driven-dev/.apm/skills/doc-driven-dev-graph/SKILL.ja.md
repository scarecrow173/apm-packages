---
name: doc-driven-dev-graph
description: "ドキュメント駆動開発のグラフ優先ルーター。正規 Markdown artifact を Graph State に投影し、宣言済み Graph Definition を評価して、宣言済み edge を最大 1 つ、または明示的な terminal/blocked 結果を返す。"
license: MIT
---

# Doc-Driven Development Graph

`doc-driven-dev-graph` は公開された graph-first entrypoint です。実行の
authority は Graph Definition であり、人間向けの phase label は概念上の
分類にすぎず、node・edge・condition・delegate の宣言を置き換えません。

人間向けの phase label は概念上かつ非規範的であり、Graph Definition が実行
authority です。

## 4 つの layer

- **Execution Graph**: `graphs/doc-driven-dev.yaml` にある node、1 エッジ
  route、condition、priority、delegate、audit の宣言。
- **Artifact Graph**: 正規 Markdown 文書と、その ID、type、status、relation。
- **Graph State**: Artifact Graph を毎回投影した focus、gate、signal、blocker、
  route evidence を含む状態。
- **Dynamic Task Graph**: focus された plan と task dependency の決定的な
  投影。planning と implementation delegate が利用します。

## Canonical command

```bash
node .apm/skills/doc-driven-dev-graph/scripts/route_graph.js \
  [--graph <path>] [--current <node>] [--signal <condition-signal>] \
  [--focus <artifact>] [--task-dir <path>] [--cwd <path>] --json
```

JSON 結果は `GraphRoute` contract です。`current`、1 つの `next`、`edgeId`、
`condition`、`status`、`delegate`、`requiredAudits`、`commitGate`、`blockers`、
選択した `taskGraph` を含みます。terminal と blocked は明示的な結果であり、
遷移先を推測しません。

成功する遷移は宣言済み edge を 1 つだけ選択します。condition を満たす edge が
ない場合、router は edge を持たない fail-closed の同一 node blocked 結果を返し、
terminal 結果も edge を持ちません。caller が暗黙の edge や隣接 node を追加する
ことはありません。

## Condition DSL と priority

edge は condition key を参照します。汎用 condition DSL は `signal`、`gate`
（`pass` / `not-pass`）、`task-graph`（`active`、`runnable`、`invalid`、
`idle`）predicate をサポートします。宣言されていない signal は受け付けません。
current node の eligible edge は昇順の `priority`、次に安定した edge ID で並べ、
最初の 1 つだけを返します。`route_graph.js` 自体は 2 つ目の edge を再帰的に
追跡せず、継続は caller が所有します。

`tasks-active` は、Task Graph に構造上の issue がなく、全 predecessor が
`done` の `in-progress` task を ID 順に並べた `resumableActive` が 1 件以上
あることを意味します。active edge は runnable edge より先に評価されるため、
新規作業を開始する前に既存 task を再開します。route が選ぶ edge は引き続き
1 件だけで、完全な Task Graph を `implementation-flow` に渡します。delegate は
安定した task ID と dependency edge に基づき、依存する active task を順序付け、
独立した作業だけを並列化します。

## Delegate と subgraph

Graph Definition の binding は明示的です。

- migration は `migrate_docs`、bootstrap は `scaffold_docs`。両方とも名前で
  migration を所有する `doc-maintenance` のスクリプトへ dispatch される。
- briefing は `briefing-flow`、design は `design-doc` に委譲。
- planning node は approved design を audit して `planning-flow` を dispatch し、
  `plan-doc` -> approval yield -> `test-spec-doc` -> `task-doc` の順に実行。
- task-graph node は `plan`、`task`、`test-spec` を audit して `build_task_graph` を dispatch し、
  `build_task_graph.js` が実行。
- implementation は `implementation-flow`、exit 検証は `doc-status` audit。

delegate は briefing / planning / implementation subgraph と証跡を担当します。
caller は返された audit を先に実行し、返された delegate だけを dispatch します。
`focus-required` blocker は明示的 focus が渡されるまで hard stop です。

## Graph runtime の 10 ステップ

`run-until-yield` が通常の caller mode です。user が debugging、inspection、
deterministic testing、または 1 checkpoint の実行を求めた場合は `single-step`
を使います。どちらの mode でも `route_graph.js` は invocation ごとに route を
1 つ返し、継続は caller が所有します。順序付き protocol、yield table、budget、
trace summary、resume rule の詳細は
[`references/execution-contract.ja.md`](references/execution-contract.ja.md) にあります。

1. Graph Definition、current node、caller mode を選択する。
2. 正規 Markdown artifact と semantic relation を確認する。
3. Artifact Graph を新しい Graph State に投影する。
4. 複数 chain があれば明示的 focus を解決する。
5. gate、caller signal、決定的 blocker を評価する。
6. 汎用 condition DSL で outgoing edge を評価する。
7. priority（次に edge ID）の順で最大 1 エッジを選択する。router 自体は 2 つ目の
   edge を再帰的に追跡しない。
8. route 全体を保持し、bounded counter と fingerprint を確認して、返された
   audit を安定した順序ですべて実行する。
9. 宣言された delegate と、その briefing / planning / implementation subgraph だけを
   dispatch する。input、approval、authority が明示的に必要なら yield する。
10. Markdown 証跡 checkpoint と ordered trace を記録し、再投影して返された `next`
    node から再入力する。`single-step` では yield し、`run-until-yield` では
    繰り返す。

caller は [`references/execution-contract.ja.md`](references/execution-contract.ja.md)
の完全な Phase 1 yield table を適用します。`terminal`、
`approval-required`、`input-required`、`authority-required`、
`unrecoverable-blocker`、`budget-exhausted`、または `commit-required` では
yield し、table が automatic continuation を許す場合だけ繰り返します。`wont-do` task は
dependency を満たさず、未解決 task は Dynamic Task Graph で blocked のままです。

implementation 後の `フォローアップ分類` node は、
`implementation-verified` と型付き signal 1 つを要求してから repair、planning、
briefing、exit audit のいずれかへ進みます。

## Git commit boundary

全 phase を通じて、Git commit boundary は review 可能な logical change であり、
Graph node、edge、phase、checkpoint、artifact type、Task Graph projection では
ありません。task は implementation の scope boundary であり、1 つ以上の commit を
含められます。canonical な boundary policy は
[`references/execution-contract.ja.md`](references/execution-contract.ja.md) に置き、
commit message convention は既存の Git tooling と repository rule に委譲します。

enforcement は advisory ではなく宣言です。node は `commitGate: true` を宣言
できます。`GraphRoute.commitGate` は宣言を caller に伝え、caller は edge 開始時に
worktree baseline を取得し、gated checkpoint が未 commit の新規変更を残して
完了しようとしたとき `commit-required` を yield します。canonical graph は
`implementation` にこの gate を宣言しています。宣言済み `commit-waived`
runtime signal が唯一の bypass であり、run trace に記録されます。

## Persistence boundary

Markdown artifact が durable history と status の authority です。Graph State
と Dynamic Task Graph は turn ごとの projection であり、runtime は並行する
database を作成・要求しません。

## 公開 command

次の 4 つの routing command は目的が異なります。`route_graph.js` は 1 回の
route 判断を行い、`inspect_graph.js` は選択した definition と、明示的に
要求した場合だけ runtime projection を説明します。別の `doc-maintenance`
script である `migrate_ids.js` はこの後で説明します。

### 1. 通常 route

次に進む宣言済み edge、または明示的な terminal/blocked 結果が必要な場合は
canonical router を実行します:

```bash
node .apm/skills/doc-driven-dev-graph/scripts/route_graph.js \
  --current followup-triage --signal followup-terminal --json
```

この command は選択した node を評価して 1 つの `GraphRoute` を返します。
同じ invocation の中で返された destination をさらに辿ることはありません。

### 2. route を説明

JSON route command に `--explain` を加えると、通常の route と選択根拠を同じ
結果に保持できます:

```bash
node .apm/skills/doc-driven-dev-graph/scripts/route_graph.js \
  --current followup-triage --signal followup-terminal --explain --json
```

結果は `{ "route": GraphRoute, "explanation": ... }` です。explanation には
hard blocker、prerequisite gate、順序付き repair/normal edge 評価、選択 edge、
destination audit、blocked reason が記録されます。Explain mode には `--json`
が必要で、routing や persistence の挙動は変わりません。評価順序と field
contract は [`references/graph-inspection.ja.md`](references/graph-inspection.ja.md)
を参照してください。

### 3. JSON を inspect

`inspect_graph.js` は route condition を評価せず、topology と宣言を inspect
します:

```bash
node .apm/skills/doc-driven-dev-graph/scripts/inspect_graph.js \
  --format json
```

JSON は counts、topology reachability、delegate、audit、決定的な issue を含む
`definition` を常に返します。`state`、`artifactGraph`、`taskGraph` は明示的な
`--cwd`、`--focus`、または `--task-dir` selector が runtime projection を要求
した場合だけ含まれます。Inspection は route、delegate dispatch、Markdown/
persistence state の書き込みを行いません。
`referencedConditions` は edge の `when` key の重複を除いた集合であり、
`unusedConditions` はその edge の `when` key にない宣言済み condition key です。
JSON はこれらの selector を runtime projection 用に受け付けます。

### 4. Mermaid を inspect

同じ topology を review や diagram 用の決定的 Mermaid text として出力します:

```bash
node .apm/skills/doc-driven-dev-graph/scripts/inspect_graph.js \
  --format mermaid
```

node と edge は安定した順序で sort されます。すべての node は Mermaid syntax では
決定的な `nN` alias を使い、元の node ID の sort 順に割り当てます。元の ID は escape
済み label に残ります。node label には node ID と kind、宣言されている場合は delegate、
commitGate、terminal、audit label が含まれ、edge label には
condition key と priority が含まれます。
Mermaid rendering は text-only で、routing や persistence への副作用はありません。
Mermaid は definition-only であり、`--cwd`、`--focus`、`--task-dir` を拒否します。
元の node、delegate、audit、condition text は escape され、`|` が edge label を終了
させることはありません。

### 5. legacy artifact id の migration

`migrate_ids.js` は既存 repository の連番 `TYPE-NNNN` id と
`NNNN-<slug>` ファイル名を、不透明な `<PREFIX>-<22文字Base62>` id
contract と slug のみのファイル名へ移行します。これは maintenance script
であり、route command ではなく、graph から dispatch されることもありません。
実装は `doc-maintenance` が所有し、canonical script はその `scripts/` 配下に
あります。graph 側の同名スクリプトは同じ実装を実行する互換エントリ
ポイントです。

```bash
node .apm/skills/doc-maintenance/scripts/migrate_ids.js \
  --cwd <repo> --json            # dry-run plan（既定、書き込みなし）
node .apm/skills/doc-maintenance/scripts/migrate_ids.js \
  --cwd <repo> --apply --json    # id・参照・ファイル名を書き換え
```

実行は段階的で fail-closed です: 存在するすべての canonical docs dir
（`specs/` や `adr/` のような root 直下の dir も含む）から artifact を
discover し、各 legacy id を新しい id へ map し（`slug.md`/`slug.ja.md`
のような locale sibling は同じ id を共有）、blocker を preflight した
うえで、front matter の `id`、relation field、metadata、本文、index 表、
experiment の `.jsonl` path を書き換え、番号付きファイルを、連鎖する
rename 先を上書きしない 2 段階 move で rename し、generated index を
再生成して validate します。参照の書き換えと未解決参照の検査は
`docs/` だけでなく、artifact 参照を持ち得る全 active 文書を対象とします:
root-level Markdown（`AGENTS.md`、`README.md`）、`.apm/` および
`packages/*/.apm/` 配下の配布 agent 文書、コマンドラインの
`--extra-root <dir>` で追加した任意ディレクトリ。experiment log は
artifact id を持たないため、`EXP-NNNN` 参照は canonical な `.jsonl`
パスへ書き換えられます。blocker — sibling でない複数ファイル間の
legacy id 重複、未解決の legacy 参照、曖昧な experiment 参照、rename 先または一時
`.migrate-tmp` path の衝突、番号付き文書の front matter 欠落または
parse 失敗、不明な document type、無効な `--extra-root`、dirty な Git
worktree — が 1 つでもあれば、変更を行う前に停止します。
`--allow-dirty` は worktree チェックだけを回避し、`--keep-filenames`
は id を書き換えつつ番号付きファイル名を保持します。`--apply` 後は残存
legacy id、重複 id、未解決参照、doc-suite audit error を再検査し、
いずれかがあれば report を `ok: false` として非 0 で終了します。clean な
Git worktree が rollback 経路です: 適用結果が誤っていれば Git で戻して
ください。適用成功後の再実行は no-op です。

## References

- [`graphs/doc-driven-dev.yaml`](graphs/doc-driven-dev.yaml) — topology と
  delegate binding。
- [`references/graph-contract.ja.md`](references/graph-contract.ja.md) — Graph
  Definition と GraphRoute schema。
- [`references/graph-state.ja.md`](references/graph-state.ja.md) — projection、
  focus、gate、signal、blocker。
- [`references/execution-contract.ja.md`](references/execution-contract.ja.md) —
  evidence に基づく caller loop。
- [`references/execution-outcome-contract.ja.md`](references/execution-outcome-contract.ja.md) —
  typed audit/delegate outcome と scope-valid な resume proof。
- [`references/task-graph-contract.ja.md`](references/task-graph-contract.ja.md) —
  Task Graph 合成と fail-closed dependency 規則。
- [`references/graph-inspection.ja.md`](references/graph-inspection.ja.md) — inspection
  field、topology reachability、route explanation、Mermaid の決定性。
