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
4. `maxHops`、per-self-loop budget、完全な `GraphRoute` fingerprint を確認する。
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

## EffectOutcome の評価

graph から呼び出された audit と delegate はすべて
[execution-outcome-contract.ja.md](execution-outcome-contract.ja.md) で定義する
正確な `EffectOutcome` footer を返します。caller は free-form semantic inference では
なく、`EffectOutcome.status` と `reason` を exact match します。terminal または blocked
`GraphRoute` と hop/retry/repetition budget は effect outcome より先に別途評価します。
yield 時には complete route と順序付き outcome を持つ 1 つの `GraphRunResult` handoff を
記録します。completed effect を再利用できるのは、receipt scope と canonical-evidence
または provider-idempotency proof が fresh projection に対して validate した場合だけです。

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
maxHops default = 10
  理由: 現在の Graph Definition には 10 個の non-terminal node がある。normal path は
  8 edge、migration を含む path は 10 edge である。
  terminal と blocked route はこの budget より先に評価するため、10 hop 目で
  complete に到達した場合は budget-exhausted ではなく terminal を yield する。

self-loop budget = 1 completed traversal per edge ID per run
  A second traversal of the same from == to edge yields budget-exhausted.

route fingerprint = stable JSON serialization of the complete GraphRoute
  If the same fingerprint is observed again in the same run, yield budget-exhausted.

multi-node repair loop = bounded by both repeated fingerprint detection and maxHops
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
