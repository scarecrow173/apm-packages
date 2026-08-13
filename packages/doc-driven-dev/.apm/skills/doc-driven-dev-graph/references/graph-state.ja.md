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

## Gate と signal

projection は bootstrap、briefing、design、planning、implementation、follow-up
triage、exit-audit の証跡を評価します。gate failure と壊れた graph/relation
fact は deterministic な sort 済み blocker として残ります。caller signal は、
state projector が fact から確認できる derived signal と統合します。CLI が
受け付ける signal は、選択した Graph Definition が宣言した値だけです。

implementation 完了には、選択 task の lifecycle-resolved と caller による
`implementation-verified` が必要です。follow-up triage は型付き signal が正確に
1 つ必要です。exit audit は `exit-audit-pass` を必要とします。証跡が欠落または
矛盾する場合は、黙って進めず routing を block します。
