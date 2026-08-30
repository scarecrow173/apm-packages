---
name: planning-flow
description: doc-driven-dev-graph が planning-flow delegate を返し、focused approved design から実装可能な plan と concrete task 文書を作るときに使います。
license: MIT
---

# Planning Flow

`planning-flow` は、承認済み design とその plan/task evidence の間に置く graph 専用の
composition boundary です。ユーザーからの直接要求には引き続き `plan-doc` または
`task-doc` を使います。

## ワークフロー

1. 返された `GraphRoute.delegate` が `planning-flow` の場合にだけ invocation を受け付けます。
2. 選択された approved design と、その正確な focused lineage を読みます。
3. `plan-doc` を呼び出し、実装可能な plan を 1 つ作成または修復します。
4. plan が review 待ちなら、`EffectOutcome` の `yield` と `approval-required` を返し、task は作成しません。
5. plan status が `approved`、`in-progress`、または `completed` になった後、concrete plan slice
   ごとに `task-doc` を 1 回呼び出し、宣言された dependency を保持します。
6. 現在の design input と plan/task evidence を含む、`planning-flow` 用の正確な `EffectOutcome` を 1 つ返します。
7. graph に再 projection を任せます。`planning-flow` 内で `build_task_graph` を呼び出したり、次の edge を選んだりしません。

## Graph Effect Outcome

`doc-driven-dev-graph` からこの skill が呼び出された場合、正確な
[`EffectOutcome footer`](../doc-driven-dev-graph/references/execution-outcome-contract.ja.md)
を返します。必須の `edgeId`、stage、effect identity、authoritative input scope、evidence、
proof、yield field はこの footer が定義します。
