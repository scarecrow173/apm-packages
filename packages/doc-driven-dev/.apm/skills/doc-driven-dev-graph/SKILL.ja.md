---
name: doc-driven-dev-graph
description: "ドキュメント駆動開発のグラフ優先ルーター。正規 Markdown artifact を Graph State に投影し、選択した Graph Definition を評価して、delegate または audit へ進む次のエッジを 1 つだけ返す。決定的な lifecycle routing、明示的 focus、型付き signal、fail-closed な task planning が必要なときに使用する。"
license: MIT
---

# Doc-Driven Development Graph

`doc-driven-dev-graph` は、ドキュメント駆動開発ワークフローの公開グラフ
優先エントリーポイントです。Markdown artifact graph を project state の
source of truth とし、選択した Graph Definition を routing topology の
source of truth とします。CLI は state を 1 回投影してエッジを 1 つだけ
route し、runtime loop は呼び出し側が担当します。

## 使用するとき

- ドキュメント駆動開発ワークフローを開始または再開するとき。
- 複数の artifact chain があるとき、chain を明示的に選択するとき。
- 検証済み Graph Definition から delegate または audit を dispatch するとき。
- blocker、gate 結果、選択された Task Graph を JSON で確認するとき。

## Canonical command

consumer repository から実行します:

```bash
node .apm/skills/doc-driven-dev-graph/scripts/route_graph.js \
  [--graph <path>] [--current <node>] [--signal <condition-signal>] \
  [--focus <artifact>] [--task-dir <path>] [--cwd <path>] --json
```

`--current` の既定値は、選択した Graph Definition の `entry` です。
必要に応じて `--signal` と `--focus` は複数回指定できます。指定した current
node は definition の `nodes` に存在しなければなりません。指定した signal は
その definition の `kind: signal` condition が参照する値でなければなりません。
未知の値は fail closed になります。

JSON 結果は公開 `GraphRoute` contract です:

- `schemaVersion`, `graphId`, `current`, `next`
- `edgeId`, `condition`, `status`, `delegate`
- `requiredAudits`, `blockers`, `taskGraph`

結果には宣言されたエッジを 1 つだけ含めます。current node が terminal なら
idempotent な terminal 結果（`edgeId: null`）を返します。満たされたエッジが
ない node は `status: blocked` となり、遷移先を推測しません。

## Runtime loop

1. projection が `focus-required` を返したら focus path を選ぶ。
2. `route_graph.js` を実行し、route と blocker を確認する。
3. 返された audit をすべて実行し、返された delegate だけを dispatch する。
4. canonical document tree に Markdown の証跡を記録する。
5. state を再投影し、返された `next` node から CLI を再実行する。
6. terminal node、またはユーザー権限が必要な blocker で停止する。

CLI は複数 node を再帰的に進めません。delegate skill が作業と証跡を担当し、
graph routing は各 turn で決定的な 1 エッジの判断を保ちます。

## Sources of truth

- `graphs/doc-driven-dev.yaml` が node、edge、condition、delegate の topology
  を宣言する。
- [`references/graph-contract.ja.md`](references/graph-contract.ja.md) が Graph
  Definition と GraphRoute schema を定義する。
- [`references/graph-state.ja.md`](references/graph-state.ja.md) が projection、
  focus、gate、signal、blocker を定義する。
- [`references/execution-contract.ja.md`](references/execution-contract.ja.md) が
  証跡に基づく runtime loop を定義する。
- [`references/task-graph-contract.ja.md`](references/task-graph-contract.ja.md) が
  Task Graph の合成と fail-closed な依存関係の動作を定義する。

Markdown artifact は project history と status の authority です。graph
runtime はそこから state を導出し、別の lifecycle database を永続化しません。
