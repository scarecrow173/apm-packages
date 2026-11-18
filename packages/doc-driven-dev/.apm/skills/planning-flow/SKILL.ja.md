---
name: planning-flow
description: doc-driven-dev-graph が planning-flow delegate を返し、focused approved design から実装可能な run plan と concrete task record を作るときに使います。
license: MIT
---

# Planning Flow

`planning-flow` は、承認済み design とその plan/task evidence の間に置く graph 専用の
composition boundary です。

Document Registry 3 では `plan` と `task` は execution-bound
（`persistence: ephemeral`）: `new_plan.js`/`new_task.js` は registry gate
で拒否され、plan/task の状態は graph が選択した Execution Store run に
保持されます。`plan-doc`/`task-doc` の規約は store record contract と
v3 以前コーパスの migration を対象にします。`test-spec` はレガシーの
migration-only 形式で、durable な検証証跡は `verification-doc` が
`docs/verification` に記録します。

## ワークフロー

1. 返された `GraphRoute.delegate` が `planning-flow` の場合にだけ invocation を受け付けます。
2. 選択された approved design と、その正確な focused lineage を読みます。
3. `execution_store.js`（`create` / `show`）で focused chain に bind された
   Execution Store run を開くか作成します — 1 つの run がこの planning 単位の
   `plan.md` と task record を保有し、`manifest.focus` には focused chain 内の
   artifact path が入ります。
4. `save-plan` で実装可能な plan を run の `plan.md` に書き込むか修復します。
   plan が review 待ちなら、`EffectOutcome` の `yield` と `approval-required` を
   返し、task record は作成しません。
5. `approve-plan` が現在の plan digest を bind した後、concrete plan slice ごとに
   `put-task` で task record を 1 つ materialize します: `taskId`、`title`、
   `status`、同じ run 内の `dependsOn` id、その slice が通すべき検証可能な
   `checks`、write boundary を宣言する `scope` entry。新規 record は
   `expectedVersion: 0`（または省略）で作成し、更新は record の現在の CAS
   `version` を伴います。
6. 現在の design input と run の plan/task evidence（store path の
   `runs/<run-id>/plan.md` と `runs/<run-id>/tasks/<task-id>.json`）を含む、
   `planning-flow` 用の正確な `EffectOutcome` を 1 つ返します。
7. graph に再 projection を任せます。`planning-flow` 内で `build_task_graph` を
   呼び出したり、次の edge を選んだりしません。承認後に編集された plan は記録
   された digest を乖離させます — `approve-plan` が新しい digest を bind する
   まで task graph は fail closed します。

**段階的ロード:** この subgraph は `.sdp` profile を消費しない。同じ規律として、
呼び出す各 document skill の本文はその dispatch step で読み、references は
step が必要とするときだけ読む —
[progressive-loading-contract](../skill-discovery-protocol/references/progressive-loading-contract.ja.md) を参照。

## Graph Effect Outcome

`doc-driven-dev-graph` からこの skill が呼び出された場合、正確な
[`EffectOutcome footer`](../doc-driven-dev-graph/references/execution-outcome-contract.ja.md)
を返します。必須の `edgeId`、stage、effect identity、authoritative input scope、evidence、
proof、yield field はこの footer が定義します。

digest 承認済みの run plan と materialize された task record には `completed`、changed
plan/task repair evidence には `retry`、plan review が pending の場合は
`approval-required` を理由とする `yield`、user-owned planning choice が missing の場合は
`input-required` を理由とする `yield`、declared safe repair がない場合は
`unrecoverable-blocker` を理由とする `yield` を使います。
