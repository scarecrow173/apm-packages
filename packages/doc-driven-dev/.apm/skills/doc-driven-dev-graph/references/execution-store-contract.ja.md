# Execution Store コントラクト v1

Execution Store（Issue `#236`）は、実行単位の状態 —— Plan・Task・承認・
Checkpoint・Effect Receipt・run trace —— を Git 管理外に保持し、永続的
な知識だけが Markdown に残るようにするものです。`.apm/state/
doc-driven-dev/` 配下への唯一の書き込み元であり、永続的知識の第二の
正本ではありません。

ランタイム: `scripts/execution_store.js`（正本ソースは
`src/skills/lib/execution_store/`）。全サブコマンドは他の通常エントリ
ポイントと同様に、共有 schema preflight を最初に実行します。

## レイアウト

```text
<checkout>/.apm/state/doc-driven-dev/     state root（Git 管理外）
└── runs/<run-id>/                        run ごとのディレクトリ
    ├── manifest.json                     run manifest —— run 全体の CAS 対象
    ├── plan.md                           編集可能な Markdown plan
    ├── tasks/<task-id>.json              task record —— task ごとの CAS 対象
    ├── checkpoints/<checkpoint-id>.json  追記専用 checkpoint record
    ├── receipts/<receipt-id>.json        追記専用 effect receipt
    ├── run_trace.jsonl                   追記型診断ログ（正本ではない）
    └── writer.lock                       一時的な single-writer ロック
```

標準 root は worktree ごとです。ある worktree/clone で作成した run は、
明示的に移転しない限り他環境からは見えません。共有 root は `stateRoot`
が checkout 外を指し、かつ `allowExternalRoot` が渡された場合にのみ存在
します —— store が勝手に外部の場所を選ぶことはありません。

## レコードスキーマ

### `manifest.json`（schemaVersion 1）

| フィールド | 意味 |
| --- | --- |
| `runId` | `RUN-<22 文字 base62>` または呼び出し側指定の有効な id。ディレクトリ名と一致 |
| `revision` | 正の整数。manifest 書き込みごとに +1 —— run 全体の CAS トークン |
| `status` | `active` / `completed` / `aborted`。終了状態の run は freeze される |
| `graphId` | run が属する graph（既定 `doc-driven-dev`） |
| `focus` | 呼び出し側指定の不透明な focus 記述子 |
| `baseCommit` | 作成時の `git rev-parse HEAD`。work tree 外では `null` |
| `planDigest` | 現在の `plan.md` の SHA-256。なければ `null` |
| `approval` | `{ planDigest, actor, approvedAt }` または `null` |
| `createdAt` / `updatedAt` / `finalizedAt` | ISO-8601 タイムスタンプ |

### `tasks/<task-id>.json`（schemaVersion 1）

`{ runId, taskId, title, status, dependsOn, checks, scope, version,
createdAt, updatedAt }`。`status` は v2 の語彙（`todo`・`in-progress`・
`blocked`・`done`・`wont-do`）を継承します。`version` が task ごとの
CAS トークンです。`dependsOn` は同一 run 内の兄弟 task id のみを
列挙します —— `:`/`/`/`\` を含むエントリは cross-run 参照として拒否
され、未知の id と自己依存は fail-closed します。`checks` は修飾
Verification Check 参照（`VD-<id>::CHK-NN`）を保持します:
`create --tasks-file` と `put-task --file` は書き込み前に各エントリを
ライブな Knowledge Graph に対して解決し、生きた Verification
Design が宣言するチェックでないものは fail-closed します（`#239`）。
格納フィールドは `string[]` のままで、import された run は export 元
チェックアウトの参照をそのまま保持します。`scope` は task の
書き込み境界を repo 相対パスまたはディレクトリ接頭辞（`/`・`/*` で
終わるエントリ）で宣言します —— 並列安全性判定が読む権威であり、
未設定・空の scope は `scope-undeclared`、パスとして解釈できない
エントリは `scope-unverifiable` です。

### `checkpoints/<id>.json` と `receipts/<id>.json`（schemaVersion 1）

追記専用の種別別ファイル。Checkpoint: `{ runId, checkpointId, nodeId,
edgeId, taskId, at, data }`。Receipt: `{ runId, receiptId, effect, taskId,
idempotencyKey, actor, status: success|failure|waived, at, input, output }`。
同一内容の再記録は冪等な no-op（比較から `at` は除外）で、同 id・異内容は
`record-conflict` です。receipt は effect が「実行された」ことを証明する
ものであり、check の結果である Evidence Record（`#240`）ではありません。

## Graph caller の利用（Issue `#238`）

graph caller はこの store の最初の consumer です。受理した `completed`
`EffectOutcome` ごとに、`input` が dispatch scope —
`{ edgeId, stage, effect, inputs }` — を、`output` が結果 —
`{ outputs, proof }` — を bind する receipt を書き込みます。これらはすべて
outcome contract の型付き reference で、`actor` は adapter が報告した
dispatch mode/method を記録し、provider proof では `idempotencyKey` を
設定します。edge の evidence phase が成功すると、`data` が
`{ edgeId, receipts, outputs, routeHash }` となる checkpoint を 1 件
書き込みます。それぞれ内容から導出された receipt id、bind された全
output reference、完了 route の診断ハッシュです。caller handoff は
`runId` と pending edge の `evidenceCheckpointId` を保持します。resume
が stage を skip するのは、記録された receipt が同一 scope を証明し、
bind された output と proof がまだ current state を resolve するときだけ
です — 失われた、または偽造された outcome は記録済み evidence に成り
済ませられません。receipt と checkpoint が権威ある per-run 実行状態で
あり、`run_trace.jsonl` は診断用途に限られます。

## 整合性モデル

- **run ごとの single writer。** `writer.lock`（O_EXCL 作成、`{pid,
  hostname, acquiredAt}`）が全ての変更を直列化します。`create`/`import`
  はまず O_EXCL `mkdir` で run ディレクトリ自体をクレームするため、競合
  する作成者・インポーターが 1 つの run に書き込みを混在させることは
  ありません。同一ホストの生存 holder、または holder のホストを判定で
  きないロックは `writer-conflict` で拒否します。死んだローカル pid が
  残したロックは次の writer が回収します。
- **CAS —— atomic rename だけではない。** ロックの下で操作はレコードを
  再読し、`expectedRevision`（manifest）または `expectedVersion`（task）
  を検証してから書き込みます。古い期待値は `cas-conflict` で拒否します
  —— 更新が黙って失われることはありません。
- **atomic replace + fsync。** コミット対象の全ファイルは `*.tmp-<pid>-<n>`
  の兄弟ファイルに書き込み、fsync・rename し、対応するファイルシステム
  ではディレクトリも fsync します。manifest が常にコミットポイントです。
  書き込み途中のクラッシュは不完全なディレクトリか `*.tmp-*` の証拠を残
  すだけで、reader が採用する中途半端なファイルは生じません。
- **クラッシュ復旧。** `loadRun` は `recovery.incompleteWrites` を報告し、
  `recover` が `*.tmp-*` の残存物を除去して全レコードを再検証します。不
  完全またはスキーマ不正の JSON は `corrupt-state` です —— 報告され、そ
  のまま残され、採用・黙って削除されることはありません。

## Plan 承認

`approve-plan` は `{ planDigest, actor, approvedAt }` を現在の plan digest
に紐付けます。`save-plan` は digest が変わると承認を無効化します。有効性
は読み込み時に計算され（`approval.planDigest` が現在ファイルの SHA-256
と一致する必要）、`plan.md` が API の外で編集されても古い承認を使い回す
ことはできません。

## 境界 —— 書き込み前に拒否

- **ignore カバレッジ**: work tree 内では `git check-ignore` が state
  root の *ディレクトリ自体* をカバーしている必要があります ——
  `*.json` のようなファイル種別パターンではカバーになりません。
  `plan.md`、`run_trace.jsonl`、`writer.lock` が committable のままに
  なるからです。Git 外では `.gitignore` ファイルを直接評価します
  （`.git/info/exclude`、root `.gitignore`、パス上の入れ子
  `.gitignore`、最終一致優先、祖先除外を尊重）。カバレッジと tracked
  state のプローブは root の *real path* で評価されるため、symlink 化
  された祖先や root 自体がチェック済みルールの外へ書き込みを逃がす
  ことはありません。`init` は `/.apm/state/` を自ら書き込み、再検証し
  ます。
- **tracked state**: `git ls-files` が `.apm/state/` 配下に何も報告しな
  いこと —— tracked な実行状態は拒否します。
- **containment**: root と run dir は checkout 内に留まること（字句的・
  real path の両方）。さらに既存の `runs/` コンテナや run dir は
  *state root 自体* の内部に realpath 解決されなければならず、checkout
  内の別場所（例: `docs/` 配下）に落ちるリンクも escape として拒否し
  ます。run/task/record id は `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`（ドッ
  トは単一・内部のみ）と Windows 予約名の拒否に適合するため、id が
  path escape になったり、ディスク上で別の id に化けたりすることはあ
  りません。
- **finalize 済み run** は読み取り専用（`run-finalized`）です ——
  trace も例外ではありません。

## 破棄と移転

- `dispose` は `active` な run を `run-active` で拒否し、disposal
  inspection（最終状態、status 別 task 数、承認、レコード数）を返します
  —— 削除前に検査が行われます。`force` と明示的な `reason` で破棄できま
  す。検査不能な corrupt run は `force` のみで破棄できます。
- **引き継ぎは明示的です。** `export` は単一の JSON ドキュメント
  （`execution-run-export`、schemaVersion 1）を出力します: runId、ファイ
  ルごとの SHA-256 + content、ファイルリスト全体の `payloadDigest`。
  `export --out` は呼び出し側が指定した任意のパスに書き込みます ——
  これは意図的な引き継ぎ成果物であり、境界ゲートが守るのは state
  root であって、operator が選んだ出力先ではありません。`import` は
  エンベロープの digest を検証し、さらに内部整合性（manifest の妥当
  性、全レコードが同一 runId に束縛、ファイル名と record id の一致、
  approval → manifest → plan.md の digest チェーン）を書き込み前に検証
  します。既存の run は拒否（`import-conflict`）され、`onConflict:
  "replace"` でのみ上書きします。ACTIVE な対象の置き換えにはさらに
  `force` が必要です。corrupt した既存 run は置き換え前に検査できま
  せん —— 先に `dispose --force` してから import してください。
- 他 worktree の run は `run-not-found` で fail closed します —— 不在が
  期待される応答であり、誤魔化すべきエラーではありません。ローカル状態
  はコピーしても共有されません。宣言のないコピーは引き継ぎではありませ
  ん。

## CLI

```bash
node .apm/skills/doc-driven-dev-graph/scripts/execution_store.js <command> \
  --cwd <repo> [--state-root <path>] [--allow-external-root] [--json]
```

`init | create [run-id] | show <run-id> | list | save-plan --file |
approve-plan --actor | update --focus <json> | put-task --file
[--expect-version] | record-checkpoint --file | record-receipt --file |
trace --event <json> | finalize --status completed|aborted | dispose
[--force --reason] | recover | export --out <file> | import --file
[--on-conflict refuse|replace]`。CAS フラグ: `--expect-revision`・
`--expect-version`。

エラーは `{ "error": <code>, "message": ..., "detail": ... }` を exit 1
で出力します。preflight ゲートは exit 2 です。コードには
`boundary-gitignore`、`boundary-tracked`、`boundary-escape`、
`external-root-not-authorized`、`run-exists`、`run-not-found`、
`run-active`、`run-finalized`、`cas-conflict`、
`expected-version-required`、`writer-conflict`、`corrupt-state`、
`unsupported-version`、`record-conflict`、`no-plan`、`import-integrity`、
`import-conflict`、`task-not-found`、`invalid-argument` があります。

## ライブラリ API

`createRun / loadRun / listRuns / savePlan / approvePlan / updateRun /
updateTask / recordCheckpoint / recordReceipt / appendTrace / finalizeRun /
disposeRun / recoverRun / exportRun / importRun / initStateRoot`
（`src/skills/lib/execution_store`）—— CLI と同じセマンティクスです。
