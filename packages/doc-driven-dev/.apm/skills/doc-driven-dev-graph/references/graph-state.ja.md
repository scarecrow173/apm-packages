# Graph State Contract

Graph State は route ごとに canonical Markdown artifact から新しく投影します。
これは派生 state であり、別の project database ではありません。

## State shape

projection は `schemaVersion: 2`、`graphId`、絶対 `cwd`、`taskDir`、正規化した
`focus`、`artifactGraph`、gate 結果、caller signal、sort 済み `blockers`、
選択した `taskGraph`（または `null`）、`verification` フィールド
（または `null`）を持ちます。artifact node には canonical
path、ID、type、status、semantic relation を保持します。

`taskGraph` は Markdown から投影されません — `--run` または単一 active
run 規則で選択された 1 つの Execution Store run の Dynamic Task Graph
です（`task-graph-contract.ja.md` 参照）。run が選択されると state はその
`runId` を持ち、run 選択や承認の blocker も artifact blocker と同じ形で
ここに現れます。

`verification` は implementation gate が消費する Verification Summary
（Issue `#241`）と `boundToHead` —— サマリーの対象サブジェクト
ダイジェストがこの checkout の `HEAD` 内容同一性と一致するか —— を
持ちます: `true` は束縛、`false` は解決された HEAD と別の
サブジェクト、`null` は HEAD 自体が解決不能（unborn branch、非
repo）で、fail-closed するものの target mismatch ではありません。
router は live の Evidence Store から `HEAD` に対してサマリーを
自動計算します。`--verification-summary <file>` は caller が
評価したサマリーを供給します。

## Focus

repository に複数の active chain がある場合、`--focus` path または artifact ID
を 1 つ以上指定します。focus 解決は正確な semantic ID と canonical relation
を使います。欠落、不正、曖昧、矛盾した focus は blocker であり、basename、path
の近さ、隣接ファイルから推測しません。`focus-required` blocker がある間は、
明示的な authority を得て route を再実行するまで delegate を許可しません。

design 作成前は、正確な typed lineage が SPEC と ADR を直接結ぶか、両方が同じ
直近の discovery から派生する場合に限り、有効な SPEC と ADR を 1 つの briefing
chain として扱います。その discovery も chain の有効な focus です。pair 根拠は
ADR が未使用であることに依存しません。既存の design chain が参照する ADR も
新しい spec の briefing pair に加わり、その ADR は両方の chain に属するため、
共有 ADR だけを focus しても曖昧なままです。該当する pair
が複数なら曖昧なまま `focus-required` となり、basename、path の近さ、より広い
lineage component の所属から artifact を結合しません。Knowledge Relations v1
では design は上流の spec を `realizes` で、上流の ADR を `decides-for` で参照し、
参照された artifact は他で pair せずその design chain に属します。design gate は
design と spec の relation に `realizes` を、design と ADR の relation に
`decides-for` を要求します（`derives-from` が design→ADR 側を満たすのは
migration 管理下の v3 以前コーパス内のみです）。

## Gate と signal

projection は bootstrap、briefing、design、planning、implementation、follow-up
triage、exit-audit の証跡を評価します。gate failure と壊れた graph/relation
fact は deterministic な sort 済み blocker として残ります。caller signal は、
state projector が fact から確認できる derived signal と統合します。CLI が
受け付ける signal は、`runtimeSignals` に列挙されるか、選択した Graph
Definition の `kind: signal` condition が宣言した値だけです。

implementation 完了には、選択 task の graph-resolved（`done` または `wont-do`）と
`verdict: "verified"` を報告する HEAD 束縛の Verification Summary が必要です
（`verification-summary-contract.ja.md` 参照）。サマリーなしは
`verification-summary`、HEAD 解決不能は
`verification-summary-head-unreadable`、別対象を指すサマリーは
`verification-summary-target-mismatch`、verified でない verdict は
`verification-<verdict>` とサマリー自身の reasons、カバーされない
required coverage の上の `verified` verdict は
`verification-summary-inconsistent` で block します ——
gate は実際の evidence assessment を読み、caller が主張する signal を
読みません。follow-up triage は型付き signal が正確に
1 つ必要です。exit audit は `exit-audit-pass` を必要とします。証跡が欠落または
矛盾する場合は、黙って進めず routing を block します。
