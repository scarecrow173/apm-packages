# Task Graph Contract

run が選択されている場合、Graph State は `build_task_graph.js` が生成する
Task Graph を含みます。選択された Execution Store run の `plan.md` と
task record が source of truth であり、Task Graph はちょうど 1 つの run の
deterministic かつ read-only の projection です — corpus の
`docs/plans/` / `docs/tasks/` Markdown は履歴であり、projection から
参照されません。

## Composition

```bash
node .apm/skills/doc-driven-dev-graph/scripts/build_task_graph.js \
  --run <run-id> [--state-root <path>] [--allow-external-root] [--cwd <path>] [--json]
```

`--run` は必須で、projection が読み取る record を持つ run を選択します。
task identity は `(runId, taskId)` です。`dependsOn` は同じ run 内の
兄弟 task id を指し、projection が run を混ぜることはありません —
run が見つからない、または壊れている場合は store の fail-closed error が
そのまま返ります。

`--state-root` は Execution Store の root 解決を上書きし、
`--allow-external-root` は checkout の外に解決される root を許可します。
同じ selector（`--run`、`--state-root`、`--allow-external-root`）が
`route_graph.js`、`inspect_graph.js`、`check_parallel.js` にも適用され、
すべての store アクセスは各 CLI ではなく共有 boundary で root を一度だけ
validate します。`--run` がない場合、Graph State は graph に bind された
active run がちょうど 1 つのときだけ暗黙に選択します — 候補が 0 または
複数の場合は fail closed します。

projection は `schemaVersion: 2`、`runId`、`plan`、`nodes`、`edges`、
および後述の status list を持ちます。`plan` は
`{ path, digest, approved }` で、`path` は state-root 相対の
`runs/<run-id>/plan.md` です。各 node は
`{ id, path, title, status, dependsOn, blocks, scope, version }` で、
`path` は state-root 相対の `runs/<run-id>/tasks/<id>.json` record、
`blocks` は `dependsOn` の派生した逆向き（独立した relation では
ありません）、`scope` は record が宣言する write-scope entry、
`version` は projection 時点の record の CAS version です。

public projection には次を含みます。

- `active`: すべての `in-progress` task を安定した ID 順に並べたもの。
- `resumableActive`: すべての predecessor が `done` の active task を安定した
  ID 順に並べたもの。issue がある場合、この list は空です。
- `runnable`: すべての predecessor が `done` の `todo` task。
- `completed`: すべての `done` task を安定した ID 順に並べたもの。
- `blocked`: 開始できない task とその理由。

downstream dependency wait と無関係な blocked task は、eligible な task を
`resumableActive` から外しません。未解決 predecessor を持つ active task は
`active` のみに残ります。dependency edge を含む完全な projection は
implementation delegate に渡され、delegate は依存する active task を
順序付け、独立した作業だけを並列化します。`wont-do` は依存関係を
満たしません。

`idle` routing predicate は completed-only の状態です。少なくとも 1 件の
task が `done` で、`runnable`、`active`、`blocked`、`issues` がすべて空の
場合に成立します。これは empty run（`plan-has-no-tasks`）、`blocked` や
`wont-do` の残件、未解決の dependency とは区別され、それらは idle では
ありません。

## Plan approval gate

runtime task graph が valid なのは、run の `plan.md` が存在し
digest-bound な承認を持つ間だけです。承認後の `save-plan` の再実行、
または store API を介さない書き込みは記録された digest を乖離させます —
`approve-plan` が現在の digest を再び bind するまで gate は fail closed
します。

## Fail-closed behavior

plan の欠落（`plan-missing`）、承認の欠落・陳腐化
（`plan-not-approved`）、manifest digest の乖離（`plan-digest-drift`）、
task ID の重複（`duplicate-task-id`）、同じ run 内の未解決参照
（`missing-task-reference`）、依存 cycle（`task-cycle`）、task record の
ない run（`plan-has-no-tasks`）は `issues` を生成し、`resumableActive` と
`runnable` を空にします。issue は Graph State の blocker と
planning gate reason に現れます。router は record の順序、名前、
部分的な DAG から readiness を推測してはなりません。

run を選択した場合、Task Graph の結果は `GraphRoute.taskGraph` に
含まれます。選択しなければこの field は `null` です。
