# Task Graph Contract

focus した plan がある場合、Graph State は `build_task_graph.js` が生成する
Task Graph を含みます。task document が source of truth であり、Task Graph は
planning と implementation routing に使う deterministic projection です。

## Composition

```bash
node .apm/skills/doc-driven-dev-graph/scripts/build_task_graph.js \
  --plan <path> [--task-dir <path>] [--cwd <path>] [--json]
```

Task ID は一意です。`depends-on` と `blocks` relation は有向 edge に正規化します。
public projection には次を含みます。

- `active`: すべての `in-progress` task を安定した ID 順に並べたもの。
- `resumableActive`: すべての predecessor が `done` の active task を安定した ID 順に
  並べたもの。構造上の issue がある場合、この list は空です。
- `runnable`: すべての predecessor が `done` の `todo` task。

downstream dependency wait と無関係な blocked task は、eligible な task を
`resumableActive` から外しません。未解決 predecessor を持つ active task は
`active` のみに残ります。dependency edge を含む完全な projection は implementation
delegate に渡され、delegate は依存する active task を順序付け、独立した作業だけを
並列化します。`wont-do` は依存関係を満たしません。

## Fail-closed behavior

重複 ID、解決できない task reference、cycle、不正な relation、task のない plan は
`issues` を生成し、`resumableActive` と `runnable` を空にします。issue は Graph State の blocker と
planning gate reason に現れます。router は file 順、名前、部分的な DAG から
readiness を推測してはなりません。

focus した plan を選択した場合、Task Graph の結果は `GraphRoute.taskGraph` に
含まれます。選択しなければこの field は `null` です。
