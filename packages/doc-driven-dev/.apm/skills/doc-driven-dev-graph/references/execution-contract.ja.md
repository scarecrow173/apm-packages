# Graph Execution Contract

この contract は one-edge CLI の周囲にある、caller 所有の bounded
Run-to-Yield protocol を定義します。完了した edge checkpoint は yield では
ありません（`checkpoint != yield`）。router は CLI invocation ごとに完全な
`GraphRoute` を 1 つ返し、停止して checkpoint を完了するか次の判断を求めるかは
caller が所有します。

## Caller mode

- `run-until-yield` は通常の runtime mode です。fresh な state projection の
  後で selected-edge protocol を繰り返し、yield reason が適用されたら停止します。
- `single-step` は debugging、inspection、deterministic testing、または 1 つの
  checkpoint だけを実行する場合に利用できます。selected edge checkpoint の後で
  yield します。

`route_graph.js` 自体は 2 つ目の edge を再帰的に追跡しません。example は
one-edge command のままであり、継続を所有するのは router ではなく caller です。
同じ run で複数 edge を進める場合も、caller が各 checkpoint の後に新しい判断を
求めます。

## Selected-edge protocol

各 selected edge について、次の順序で実行します。

1. `current` に対して `route_graph.js` を正確に 1 回 invoke する。
2. 完全な `GraphRoute` を保持する。
3. terminal または blocked なら yield table を評価して停止する。
4. 最初の implementation-flow route を選択するときに task-aware default `maxHops` を
   freeze し、その後 `maxHops` と完全な `GraphRoute` の stable fingerprint を確認する。
5. すべての required audit を安定した順序で実行する。
6. 返された delegate だけを dispatch する。
7. audit または delegate が input、approval、authority を明示的に要求するなら、
   edge checkpoint を完了したと主張せず yield する。
8. completion、gate、follow-up evidence を canonical Markdown に保存する。
9. edge checkpoint を完了として記録し、ordered trace に追加する。
10. fresh な state projection で `next` から再入力する。
11. `single-step` mode では yield し、`run-until-yield` mode では繰り返す。

completion、gate、follow-up evidence を canonical Markdown に保存して記録します。

checkpoint は audit、delegate、evidence が記録された後にだけ完了します。run の
trace summary には mode、bounded counter、順序付き completed edge ID、route
fingerprint、最終 yield reason を記録します。

## Git commit boundary

briefing、spec、ADR、design、plan、task、implementation、follow-up、audit の全作業で、
review 可能な logical change ごとに 1 commit とします。logical change は単独で意図を
説明・review でき、可能な限り検証方法が明確で、revert した場合の意味が明確であり、
unrelated change を含まないものとします。commit 数の最小化・最大化は目的にしません。

Graph runtime の構造は Git commit boundary を定義しません。Graph node、edge、phase、
checkpoint は commit boundary ではありません。artifact type も、task document から
生成される projection である Dynamic Task Graph（`task-graph`）も commit boundary
ではありません。実行規則を `1 phase = 1 commit`、`1 graph node = 1 commit`、
`1 graph edge = 1 commit`、`1 artifact = 1 commit` と解釈してはいけません。

task は implementation の scope boundary であり、必ずしも commit boundary では
ありません。`1 task = 1..N commits` を許容し、1 task 内の独立した logical change は
別 commit に分割します。原則として unrelated な複数 task を 1 commit に混在させません。
複数 task の変更が意味的・技術的に不可分な場合は、分離できない理由を説明できるときに
限り同じ commit に含められます。task が多数の独立した logical change を含む場合は、
巨大 commit にまとめず task の分割を検討します。

変更は file type や artifact type ではなく logical intent でまとめます。関連する code、
tests、task status、Implementation Record、verification evidence、upstream artifact は、
1 つの logical change を構成する場合、同じ commit に含められます。逆に、同じ artifact
の変更でも独立して review 可能な logical change は別 commit に分割します。file type
だけを理由に code、tests、documentation を機械的に分けません。

この skill が定義するのは、変更をいつ 1 commit として区切るかだけです。commit message
の構文、type、scope、subject / description、body、footer、task / issue reference の
形式、Conventional Commits などの convention は、既存の Git commit tooling と
repository convention の責務です。

## EffectOutcome の評価

graph から呼び出された audit と delegate はすべて
[execution-outcome-contract.ja.md](execution-outcome-contract.ja.md) で定義する
正確な `EffectOutcome` footer を返します。caller は free-form semantic inference では
なく、`EffectOutcome.status` と `reason` を exact match します。terminal または blocked
`GraphRoute` と hop/retry/repetition budget は effect outcome より先に別途評価します。
yield 時には complete route と順序付き outcome を持つ 1 つの `GraphRunResult` handoff を
記録します。completed effect を再利用できるのは、receipt scope と canonical-evidence
または provider-idempotency proof が fresh projection に対して validate した場合だけです。

caller adapter は declared script delegate（`migrate_docs`、`scaffold_docs`、
`build_task_graph`）と named audit（`spec`、`adr`、`design`、`plan`、`task`、`impl-record`、
`all`）を `EffectOutcome` に正規化します。footer を emit できる skill は直接返します。
adapter evidence が missing または malformed なら `authority-required` を yield し、checkpoint
を進めません。effect 固有の canonical input/evidence mapping は
[execution-outcome-contract.ja.md](execution-outcome-contract.ja.md) に定義します。

## Phase 1 yield table

| Observation | Yield reason | Continue automatically |
| --- | --- | --- |
| `GraphRoute.status == terminal` | `terminal` | Never |
| skill または user-owned gate からの明示的な approval request | `approval-required` | Never |
| user だけが選べる focus/requirement/value の明示的な欠落 | `input-required` | Never |
| 許可の欠落、または granted scope 外の不可逆な external action | `authority-required` | Never |
| 実行可能な repair edge の宣言がない blocked route | `unrecoverable-blocker` | Never |
| hop/retry/repetition budget に到達 | `budget-exhausted` | Never |
| selected edge が完了し、fresh state が別の declared edge を公開 | none | Yes in `run-until-yield` |
| audit/delegate/evidence が成功 | none | Yes in `run-until-yield` |

## Bounded autonomy

caller は固定された run counter を使い、この protocol に policy DSL を追加しません。

```text
topologyBaseHops = 10
  現在の最長の simple entry-to-terminal path であり、最初の implementation-flow dispatch を
  すでに含む。

taskBudgetCount = 最初の implementation-flow dispatch の直前に freeze する未完了 Task Graph node 数
  focused Task Graph の todo、in-progress、blocked node だけを数え、done と wont-do は除外する。
  freeze した値を persist する。handoff にすでに値があれば再計算しない。後から追加された task は
  current run ではなく次回 run の budget にだけ寄与する。

repairAllowance = 0
  positive repair policy はこの defect fix の対象ではない。

maxHops default = topologyBaseHops
  + Math.max(0, taskBudgetCount - 1)
  + repairAllowance
  caller-supplied explicit maxHops は authoritative のままとし、
  taskBudgetCount: null を記録する。

route fingerprint = stable JSON serialization of the complete GraphRoute
  complete route は fresh Task Graph projection を含む。次の runnable task を公開する completed task は
  task status と runnable/active/resumableActive/completed を変更するため、次の declared edge は継続できる。
  同じ fingerprint を同じ run で再び観測したら budget-exhausted を yield する。

changing repair loop = frozen maxHops で境界付ける
  この limit に到達する task retry または repair は budget-exhausted を yield し、
  新しい run に control を渡す。budget exhaustion は execution error でも successful checkpoint でもない。
```

fingerprint は effects の前に計算します。`seenRouteFingerprints` への追加は edge
checkpoint が完了した後だけにします。これにより、途中で中断して未完了の edge を
resume しても、完了した loop と誤分類しません。

## Checkpoint、resume、重複 effect

- completed checkpoint は route、completed audits、completed delegate、
  `evidenceRecorded=true` を caller handoff に記録する。
- resume の前には必ず canonical Markdown を再投影してから再 routing する。
- resume は最後に完了した `route.next` から開始する。未完了 edge は未完了の
  audit/delegate/evidence stage だけを再開する。
- stage を skip できるのは、canonical evidence または side-effect provider の
  idempotency key が完了を証明するときだけである。
- どちらの proof もなければ、不可逆な effect を再実行せず
  `authority-required` を yield する。
- run counter と trace は task/thread handoff metadata に保持してよいが、Graph
  State または project authority ではない。

これは same-task crash recovery を提供します。caller handoff と task/thread
history の両方を失った cross-host recovery は Phase 1 の対象外です。canonical
Markdown だけでは、最後の runtime node やすべての external side-effect receipt
を現在は符号化していません。

## Evidence と persistence

delegate は担当領域の作業と evidence format を所有します。graph が所有するのは
宣言済み topology と汎用 state predicate だけです。upstream gap、invalid Task
Graph、focus 欠落、矛盾した signal、audit failure は明示的な blocker または
loopback signal のままにし、caller は成功として再解釈してはいけません。

Markdown が durable history と status authority です。route を完了したように見せる
ために、別の mutable state store を作成しないでください。
