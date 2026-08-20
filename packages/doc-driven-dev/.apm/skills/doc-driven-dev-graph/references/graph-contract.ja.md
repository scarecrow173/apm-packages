# Graph Definition と GraphRoute Contract

この contract はグラフ優先公開 entrypoint の規範です。配布される
`graphs/doc-driven-dev.yaml` が具体的な node、edge、condition、delegate の
宣言に対する authority です。文章で遷移を発明したり、委譲された subgraph を
flatten したりしてはなりません。

## Graph Definition v2

definition は `schemaVersion: 2`、安定した `id`、`entry` node ID、名前付きの
`conditions`、`nodes`、`edges` を持ちます:

- condition は `signal`、`gate`、`task-graph` predicate のいずれかです。
- node は `action`、`delegate`、`audit`、`terminal` のいずれかです。
- edge は一意な ID、既知の endpoint、宣言された condition key、source node
  ごとに一意な priority を持ちます。
- terminal node に outgoing edge はありません。terminal 以外の node には
  少なくとも 1 つの outgoing edge が必要です。

parser は routing 前に未知の endpoint/condition、重複 ID/route selector、
不正な prerequisite gate、terminal topology を拒否します。

## One-edge routing

`route_graph.js` は選択した definition を load し、Graph State を投影し、
`evaluateRouteDecision()` を正確に 1 回呼びます。CLI は decision の安定した
`GraphRoute`（`decision.route`）を通常の JSON output に投影します。`--explain`
を指定した場合も同じ route を `route` key に保持し、`explanation` を併記します。
outgoing edge は priority の昇順、次に ID の順で評価します。結果は宣言済み edge
1 つ、terminal 結果、または blocked 結果であり、CLI は destination を再帰的に
辿りません。

`--current` の既定値は `definition.entry` で、選択した definition の node で
なければなりません。各 `--signal` は同 definition の `kind: signal`
condition が参照する値でなければなりません。この検証により別の graph
vocabulary に対する routing を防ぎます。

## GraphRoute JSON

安定した JSON object は次のフィールドだけを含みます:

| Field | 意味 |
| --- | --- |
| `schemaVersion` | 公開 route schema。現在は `2`。 |
| `graphId` | 選択した definition ID。 |
| `current` / `next` | 現在の node と 1 段階先。 |
| `edgeId` | 選択 edge ID。terminal/blocked は `null`。 |
| `condition` | 選択 condition key、`terminal`、または `blocked`。 |
| `status` | `edge`、`terminal`、または `blocked`。 |
| `delegate` | destination/terminal delegate、なければ `null`。 |
| `requiredAudits` | 選択先 node の `audits` 宣言を sort して投影した audit。blocked route または選択先に宣言がない場合は空。 |
| `blockers` | sort 済み fail-closed state blocker。node の `requiresGates` が未達の場合は、安定した `required-gate:<gate>` blocker と各 gate の失敗理由も含め、前提 evidence を可視化する。 |
| `taskGraph` | 選択 Task Graph projection。なければ `null`。 |
