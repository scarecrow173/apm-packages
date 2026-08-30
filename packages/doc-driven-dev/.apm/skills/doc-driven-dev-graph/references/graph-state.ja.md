# Graph State Contract

Graph State は route ごとに canonical Markdown artifact から新しく投影します。
これは派生 state であり、別の project database ではありません。

## State shape

projection は `schemaVersion: 2`、`graphId`、絶対 `cwd`、`taskDir`、正規化した
`focus`、`artifactGraph`、gate 結果、caller signal、sort 済み `blockers`、
選択した `taskGraph`（または `null`）を持ちます。artifact node には canonical
path、ID、type、status、semantic relation を保持します。

## Focus

repository に複数の active chain がある場合、`--focus` path または artifact ID
を 1 つ以上指定します。focus 解決は正確な semantic ID と canonical relation
を使います。欠落、不正、曖昧、矛盾した focus は blocker であり、basename、path
の近さ、隣接ファイルから推測しません。`focus-required` blocker がある間は、
明示的な authority を得て route を再実行するまで delegate を許可しません。

design 作成前は、正確な typed lineage が SPEC と ADR を直接結ぶか、両方が同じ
直近の discovery から派生する場合に限り、有効な SPEC と ADR を 1 つの briefing
chain として扱います。その discovery も chain の有効な focus です。該当する pair
が複数なら曖昧なまま `focus-required` となり、basename、path の近さ、より広い
lineage component の所属から artifact を結合しません。

## Gate と signal

projection は bootstrap、briefing、design、planning、implementation、follow-up
triage、exit-audit の証跡を評価します。gate failure と壊れた graph/relation
fact は deterministic な sort 済み blocker として残ります。caller signal は、
state projector が fact から確認できる derived signal と統合します。CLI が
受け付ける signal は、`runtimeSignals` に列挙されるか、選択した Graph
Definition の `kind: signal` condition が宣言した値だけです。

implementation 完了には、選択 task の graph-resolved（`done` または `wont-do`）と caller による
`implementation-verified` が必要です。follow-up triage は型付き signal が正確に
1 つ必要です。exit audit は `exit-audit-pass` を必要とします。証跡が欠落または
矛盾する場合は、黙って進めず routing を block します。
