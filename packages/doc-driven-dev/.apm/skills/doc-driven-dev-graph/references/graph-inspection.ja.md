# Graph Inspection と Route Explanation

この reference は graph-first entrypoint の read-only inspection と
explanation contract を定義します。node、edge、condition、delegate、audit の
authority は Graph Definition です。

## Command

選択した definition を JSON または Mermaid として inspect します:

```bash
node .apm/skills/doc-driven-dev-graph/scripts/inspect_graph.js \
  [--graph <path>] [--format json|mermaid] [--cwd <path>] \
  [--focus <artifact>] [--task-dir <path>]
```

通常 route を envelope に保持したまま 1 回の route 判断を説明します:

```bash
node .apm/skills/doc-driven-dev-graph/scripts/route_graph.js \
  [route options] --explain --json
```

`inspect_graph.js` は route condition を評価しません。edge、terminal 結果、または
blocked 結果を選ぶ command は `route_graph.js` だけです。

## Inspection JSON

`--format json` は top-level の `definition` object を常に返します。inspection
schema は現在 `1` であり、Graph Definition schema version とは独立しています。

| Field | 意味 |
| --- | --- |
| `schemaVersion` | inspection schema version。現在は `1`。 |
| `graphId` / `entry` | definition ID と entry node。 |
| `nodeCount` / `edgeCount` / `conditionCount` | 選択した definition の count。 |
| `terminalNodes` | sort 済み terminal node ID。 |
| `reachableNodes` | 宣言 edge を辿って `entry` から到達できる node。 |
| `unreachableNodes` | `entry` から到達できない node ID。 |
| `reachableTerminalNodes` | `entry` から到達できる terminal node。 |
| `unusedConditions` | `referencedConditions` に含まれない宣言済み condition key。 |
| `referencedConditions` | edge の `when` key、prerequisite-gate condition key、宣言済み signal condition key。 |
| `delegates` | delegate を持つ node の `{ nodeId, delegate }` entry。 |
| `audits` | audit 宣言を持つ node の `{ nodeId, audits }` entry。 |
| `issues` | sort 済み inspection finding。下の issue table を参照。 |
| `nodes` | serializable node data。`nodeId`、`kind`、optional `delegate`、sort 済み `audits`。 |
| `edges` | serializable edge data。`id`、`from`、`to`、`when`、`priority`。 |

### Reachability は topology-only

Reachability は `entry` から始まり、宣言された全 edge endpoint を辿ります。signal
値、gate status、task-graph state、focus、その他の runtime evidence は評価しません。
したがって、現在の runtime state では match できない condition の edge でも、node を
topology 上 reachable にできます。

inspection は到達不能な non-terminal node に `unreachable-node` error、到達不能な
terminal に `unreachable-terminal` warning、terminal に到達できない場合に
`no-reachable-terminal` error を報告します。inspection は routing を変更せず、finding
を修復もしません。

### Issue

各 issue は `severity`（`error` または `warning`）、`code`、optional な `nodeId` または
`condition` を持ちます:

| Code | Severity | 意味 |
| --- | --- | --- |
| `unreachable-node` | `error` | non-terminal node が `entry` から到達不能。 |
| `unreachable-terminal` | `warning` | terminal node が `entry` から到達不能。 |
| `no-reachable-terminal` | `error` | `entry` から terminal に到達不能。 |
| `unused-condition` | `warning` | 宣言 condition が inspect 対象 definition から参照されていない。 |

issue は code、node ID、condition の順で sort され、同じ definition の再 inspect で
安定します。

## Route explanation

`route_graph.js --explain --json` は top-level に `route`（通常の `GraphRoute`）と
`explanation` の 2 key だけを返します。`route` object は通常の `--json` invocation
と同一です。`explanation` は次を含みます:

| Field | 意味 |
| --- | --- |
| `currentNode` | 判断に使った current node。 |
| `hardBlockers` | edge 選択前に停止させる sort 済み blocker。 |
| `prerequisiteGates` | required gate の status と sort 済み reason。 |
| `evaluatedEdges` | ここまで評価した edge。priority、condition kind、match、`repair` または `normal` phase を含む。 |
| `selectedEdgeId` | 選択 edge ID。terminal/blocked は `null`。 |
| `selectedDestinationAudits` | 選択 destination が宣言する sort 済み audit。 |
| `blockedReasons` | route を選択しない場合の sort 済み reason。 |

評価順序は決定的です:

1. terminal node は edge を評価せず idempotent terminal 結果を返します。
2. hard blocker があれば edge を評価せず blocked 結果を返します。
3. 宣言された prerequisite repair edge を priority、次に edge ID の順で先に評価します。
4. required gate が未達のままなら、安定した gate blocker と reason を付けて blocked になります。
5. 残りの outgoing edge を priority、次に edge ID の順で評価し、最初に match したものを選びます。
6. match する edge がなければ `no-matching-edge` で blocked になります。

command は選択 destination を再帰的に評価しません。1 回の判断に使った evidence を
記録し、caller が Markdown evidence を保存し、required audit を実行してから次の turn
を呼び出します。

## Runtime projection の包含

JSON inspection は既定では `definition` だけを含みます。runtime selector（`--cwd`、
`--focus`、`--task-dir` のいずれか）を渡すと、新しい projection の `state`、
`artifactGraph`、`taskGraph` が追加されます。projection は read-only で、route、delegate
dispatch、並行 state store の作成を行いません。明示的 focus が invalid または required
に解決される場合は推測せず fail-closed になります。

runtime selector を渡しても Mermaid format は definition-only です。

## Mermaid output

`--format mermaid` は `flowchart TD` で始まる決定的な text を返します。node 行は node
ID で sort されます。Mermaid-safe な node ID は可能な限りそのまま使い、それ以外は
決定的な `node_N` alias に置き換えますが、元の ID は label に残します。node label
には ID と `kind`、宣言されていれば `delegate`、`terminal`、`audits` label が含まれます。
edge 行は `from`、priority、edge ID の順で sort され、label には condition key と
priority（`<condition> · p<priority>`）が含まれます。Mermaid label の `&` と `"` は
escape されます。

Mermaid rendering は text-only で、routing、delegate dispatch、Markdown、persistence への
副作用はありません。
