# Graph Execution Contract

この contract は one-edge CLI の周囲にある caller 所有 runtime loop を定義します。
graph topology とは分離され、delegate と audit が証跡を記録した後に caller が
新しい判断を graph に求めます。

## Turn protocol

各 turn で:

1. Graph Definition を選び、必要なら明示的 focus を指定する。
2. current node と観測 signal を付けて `route_graph.js` を 1 回実行する。
3. 完全な GraphRoute JSON を handoff に保持する。
4. dispatch 前に `requiredAudits` をすべて実行する。
5. 返された edge の `delegate` だけを dispatch し、推測した skill や隣接 skill
   は dispatch しない。
6. canonical Markdown に完了、gate、follow-up の証跡を記録する。
7. state を再投影し、`next` から再実行する。

同じ turn で CLI を再帰的に呼んだり、複数 edge を進めたりしてはなりません。
terminal route は idempotent です。blocked route は blocker が解消されるか、
必要な authority をユーザーが与えるまで fail-closed で停止します。

## 証跡と loopback

delegate は担当領域の作業と証跡形式を所有します。graph が所有するのは宣言した
topology と汎用 state predicate だけです。upstream gap、invalid Task Graph、
focus 欠落、矛盾 signal、audit failure は blocker または loopback signal として
明示し、成功として再解釈してはなりません。

Markdown が durable history です。route を完了に見せるための別の mutable state
store を作成しないでください。
