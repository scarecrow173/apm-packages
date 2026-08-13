# doc-driven-dev-lifecycle: Graph 契約

この契約は `route_lifecycle.js` が利用する runtime topology を定義する。
配布ファイル `graphs/lifecycle.yaml` が lifecycle の node、edge topology、
delegate binding に関する唯一の規範である。router は宣言済み edge だけを
たどり、prose から遷移を発明したり委譲 subgraph を平坦化したりしない。

## Graph schema

Graph は `schemaVersion: 1`、`entry: probe` で始まる。

各 node は安定した ID でキー付けされ、次を持つ。

| Field | 意味 |
| --- | --- |
| `kind` | `probe`、`action`、`subgraph`、`gate`、`audit`、`terminal`。 |
| `delegate` | 配布スキルまたは CLI 名。composite/gate は `null`。 |
| `audits` | dispatch または完了前に通過すべき audit 名。 |

必須 node は `probe`、`migration`、`bootstrap`、`briefing`、`design`、
`planning`、`task-graph`、`implementation`、`followup-triage`、
`exit-audit`、`complete` である。`briefing` は `briefing-flow` に委譲する
`subgraph`、`implementation` は `implementation-flow` に委譲する
`subgraph` のままであり、`planning` は文書化された composite step である。

各 edge は一意な `id`、既知の `from`/`to` node、型付き `when` reason code
を持つ。retry と loopback edge は明示する。terminal node `complete` に
outgoing edge はない。無効な YAML、重複 edge ID、未知 endpoint、terminal
からの outgoing edge は routing 前に拒否される。

## Thin-router CLI

consumer repository から配布 router を実行する。

```bash
node .apm/skills/doc-driven-dev-lifecycle/scripts/route_lifecycle.js \
  --current <node> [--focus <path>] [--signal <signal>] \
  [--task-dir <path>] [--cwd <path>] [--json]
```

`--focus` と `--signal` は複数回指定できる。未知の node ID や signal 名は
error となる。安定した route object は `schemaVersion`、`current`、`next`、
`edgeId`、`reasonCode`、`delegate`、`requiredAudits`、`blockers`、
`taskGraph` を含む。`focus-required` は成功した fail-closed 判定であり、
明示的な focus が与えられるまで delegate を許可しない。

router は reason の precedence に従って評価し、型付き upstream gap を
forward gate より優先する。返すのは宣言済み edge のみであり、gate が未完了
なら宣言済み retry edge を使う。`complete` は terminal で、
`reasonCode: lifecycle-complete`、`edgeId: null` を返す。

## Task DAG composite

plan が選択されている場合、planning は次を実行できる。

```bash
node .apm/skills/doc-driven-dev-lifecycle/scripts/build_task_graph.js \
  --plan <path> [--task-dir <path>] [--cwd <path>] [--json]
```

結果は `nodes`、`edges`、`runnable`、`active`、`completed`、`blocked`、
`issues` を持つ。`depends-on` と `blocks` は有向 task edge に正規化される。
独立した root task は安定した ID 順で fan-out し、fan-in task は全 predecessor
が `done` の後だけ runnable になる。重複 ID、未解決 task reference、cycle、
task のない plan は `issues` を生成し、`runnable` を空にする。router は推測せず
fail-closed する。

## Delegation boundary

- `graphs/lifecycle.yaml` は topology、edge reason code、delegate binding の規範。
- [`flow-contract.ja.md`](flow-contract.ja.md) は人間の承認基準、証跡、フォローアップ分類の規範。
- [`lifecycle-state.ja.md`](lifecycle-state.ja.md) は derived state、focus、型付き signal、fail-closed 動作の規範。
- Markdown artifact は project history と status の規範。runtime state は probe ごとに artifact から導出され、state database は不要。
