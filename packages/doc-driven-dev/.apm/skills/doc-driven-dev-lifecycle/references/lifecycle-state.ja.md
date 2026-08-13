# doc-driven-dev-lifecycle: Lifecycle State 契約

`route_lifecycle.js` は canonical Markdown artifact と caller が指定した
signal から、毎回新しい `LifecycleState` を導出する。mutable な runtime state
は永続化しない。この state 契約は focus 選択、gate 判定、型付き loopback、
fail-closed routing の規範である。

## State shape

JSON state は `schemaVersion: 1` と次を含む。

- `cwd`: 相対 path の基準となる repository root
- `focus`: 正規化した repository-relative focus path
- `artifacts`: `id`、`path`、`type`、`status`、意味付き `relations` を持つ typed document
- `gates`: `bootstrap`、`briefing`、`design`、`planning`、`implementation`、
  `followup-triage`、`exit-audit`。各 gate は `pass`、`fail`、`blocked` と決定的な `reasons` を持つ
- `signals`: caller が観測した `LifecycleSignal` 値
- `blockers`: ソート・重複排除された fail-closed blocker

canonical directory と Markdown front matter は probe ごとに読み取る。
Relations retain raw front-matter values; resolution is unique exact artifact ID first, then owner-relative/repository-relative path; external URLs are not broken local relations. つまり relation は front matter の raw 値を保持し、
一意な完全一致 artifact ID を最初に解決し、次に owner-relative/repository-relative
path へフォールバックする。外部 URL は壊れた local relation ではない。
共有 lineage relation は `implements`、`implemented-by`、`derives-from`、
`derived-by`、`refines`、`refined-by` である。`relates-to`、`related`、
`references`、`source`、`depends-on`、`blocks` など、contextual/evidence/task
dependency 用の field は lineage 選択から除外する。壊れた local relation、
不正な relation 形、重複 ID、壊れた focus は推測せず blocker にする。

## Focus 契約

複数の active artifact chain がある場合、focus は明示必須である。plan、
design、spec、ADR、task の path/ID を `--focus` で複数指定できる。router は
path を正規化し、存在しない target や曖昧な target を拒否する。

focus がない場合:

- 空の repository は bootstrap/briefing 判定へ進める。
- active chain があれば `focus-required` になる。
- 重複 ID や曖昧な spec/ADR/design chain は `focus-required` になる。

`focus-required` は dispatch を一切許可しない。caller はユーザー権限を求め、
明示的 focus で再実行する。router は basename や path の近さで隣接 chain を選ばない。

## Gate と signal の動作

document から導出する gate は既存 lifecycle 証跡を確認する。

| Gate | 導出する証跡 |
| --- | --- |
| bootstrap | 全 canonical directory と `README.md` index が存在する。 |
| briefing | focus された spec に受け入れ条件と適切な status があり、ADR に considered options と適切な status がある。 |
| design | approved design が focus された spec と ADR に relation する。 |
| planning | approved plan が design に relation し、選択 task が有効な Task DAG を形成する。 |
| implementation | この version では status が `done` または `wont-do` の選択 task は無条件に lifecycle-resolved となり、caller は `implementation-verified` を指定する。 |

- Lifecycle implementation resolution: この version では status が `done` または `wont-do` の選択 task は無条件に resolved となり、`implementation-verified` は別途必要な signal である。
- Task-DAG predecessor satisfaction: dependency を満たすのは `done` のみであり、`wont-do` は blocked のまま dependent を unlock しない。
- operator が `wont-do` を選ぶときは理由を記録する。現在の Lifecycle state projection / Router は、その理由の有無や妥当性を機械的に検証しない。

Follow-up triage は証跡に基づく型付き gate である。6つの route signal
（`followup-bug-fix`、`followup-decision-briefing`、`followup-decision-design`、
`followup-new-feature`、`followup-doc-only`、`followup-terminal`）のうち1つだけが
存在し、`followups-unclassified` がない場合にのみ pass する。型付き signal が0個の
場合は reason `followups-unclassified` で blocked になり、型付き signal が複数、または
型付き signal と `followups-unclassified` が併存する場合は reason
`followups-conflicting` で blocked になる。旧 `followups-classified` signal は CLI
input として受け付けない。Exit audit は引き続き証跡に基づき、`exit-audit-pass` を
必要とする。`spec-gap`、`design-gap`、`constraint-gap`、`task-graph-retry`、
`implementation-incomplete` などの signal は loopback 観測であり、文書を変更したり
phase を黙って進めたりしない。

Lifecycle 完了には全 gate の pass が必要である: `bootstrap`、`briefing`、
`design`、`planning`、`implementation`、`followup-triage`、`exit-audit`。
exit-audit gate だけの pass では完了を許可しない。

Planning Task DAG の issue（`missing-task-reference`、`task-cycle`、重複 ID、
task なし）は planning を `blocked` にし、`task-graph-invalid` を追加し、
`runnable` task を返さない。これは意図した fail-closed 動作である。

## Runtime loop

state を probe し、required audit を実行し、route の delegate を dispatch し、
Markdown に証跡を記録してから、返された node と型付き signal で probe を再実行する。
handoff では route の blocker と reason を保持する。`kind` が `terminal` の graph
node、またはユーザー権限を要する blocker だけで停止し、state、signal、edge、task
readiness を推測しない。terminal node は idempotent で、
`reasonCode: lifecycle-complete` と `edgeId: null` を返す。
