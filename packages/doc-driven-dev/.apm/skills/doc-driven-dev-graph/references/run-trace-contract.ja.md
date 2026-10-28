# Run Trace コントラクト

このコントラクトは、caller が [execution contract](execution-contract.ja.md)
ループを駆動する間に出力される構造化 run trace を定義します。trace は run が
行ったこと — 選択された route、artifact の読み取り、dispatch された effect、
outcome、yield — を記録し、run を決定的に計測・比較できるようにします。
これは非権威の診断データであり、Graph State でも lifecycle store でもなく、
routing・gate・status の根拠にもなりません。

## Authority の分担

- **caller** が run レベルの情報を所有します: `runId`、event の順序、effect
  dispatch、execution mode、outcome、最終 yield。リポジトリ内のプログラム
  caller は `scripts/lib/run_trace.ts`（`route_graph.js` に bundle される）
  の helper を使い、任意の caller が同じ JSONL shape を直接出力してもかまい
  ません。エージェント caller は handoff trace に同じ形状を記録します。
- `route_graph.js` は invocation ごとの情報のみを所有します。
  `--trace-file <path> --run-id <id>` を指定して呼び出すと、JSONL ファイルへ
  `artifact-scan` event を 1 件、続いて `route-selected` event を 1 件追記
  します。run・delegate・yield については何も知りません。2 つの flag は
  必ず一緒に指定します。

## ファイル形式

JSON Lines（`.jsonl`）。1 行に 1 event、UTF-8。すべての event が持つ field:

| Field | 意味 |
| --- | --- |
| `v` | schema version。常に `1` |
| `runId` | 1 回の run の全 event を相関付ける caller 指定の識別子 |
| `seq` | `runId` ごとに追記順で採番される正の整数 |
| `kind` | 後述の event kind |

順序付けは `seq` のみです。consumer は `(runId, seq)` で並び替えます。
writer は追記のみで、既存行は書き換えません。1 つの trace ファイルに複数
run が共存でき、event は `runId` でグループ化します。

## CLI が出力する event

### `artifact-scan`

invocation ごとに 1 件、`route-selected` の前に出力されます。

| Field | 意味 |
| --- | --- |
| `scans` | この invocation での artifact scan 回数（projection と gate 再評価） |
| `filesRead` | 全 scan にわたる canonical Markdown の読み取り総数（重複を含む） |
| `uniqueFiles` | scan 間で重複排除した、読み取られた canonical file の種類数 |
| `bytesRead` | 全 scan にわたる UTF-8 読み取り総バイト数 |

`filesRead` から `uniqueFiles` を引くと、1 回の invocation 内の重複取得が
分かります。

### `route-selected`

invocation ごとに 1 件、`artifact-scan` の後に出力されます。

| Field | 意味 |
| --- | --- |
| `current`, `next` | 評価した node と route の遷移先 |
| `edgeId` | 選択された edge。terminal/blocked では `null` |
| `status` | `edge`、`terminal`、`blocked` のいずれか |
| `condition` | 一致した condition key、または `terminal`/`blocked` |
| `delegate`, `requiredAudits`, `commitGate`, `blockers` | `GraphRoute` から転記 |
| `focus` | 解決済みの repo 相対 focus path |
| `tasks` | 選択された Task Graph node（`{ id, status }`） |
| `routeHash` | 完全な `GraphRoute` を key ソートした JSON の sha256 |
| `durationMs` | 任意の壁時計診断値。厳密一致で assert してはいけません |

## Caller が出力する event

caller が audit/delegate を駆動するときに記録します。`route_graph.js` は
これらを出力しません。

### `effect-dispatched`

`edgeId`、`stage`（`audit`/`delegate`）、`effectId`、`executionMode`
（`same-context`、`subagent`、`tool`、`unknown`）、`focusPaths`
（effect に渡した repo 相対 artifact path）。

### `effect-outcome`

`edgeId`、`stage`、`effectId`、`outcome`（`completed`/`retry`/`yield`）、
`evidencePaths`（repo 相対）、`reason`。`outcome` が `yield` のとき必須で、
`approval-required`、`input-required`、`authority-required`、
`unrecoverable-blocker`、`commit-required` のいずれか。

### `run-yield`

`reason`（`effect-outcome` の全 reason に `budget-exhausted`、`terminal`、
`single-step-complete` を加えたもの）、`hops`、順序付き `completedEdges`。

### Resume の意味

resume された run は同じ `runId` で追記を続けます。`seq` は増え続け、未完了
だった stage は新しい `effect-dispatched` / `effect-outcome` event を出力
します。resume event kind は存在しません — 連続性は `runId` ごとの seq と
`run-yield.completedEdges` に蓄積される completed edge ID で表されます。

## 決定性と正規化

- タイムスタンプ、PID、絶対パス、乱数 ID、環境依存パスは記録しません。
  fixture の run は固定 `runId` を使います。
- `focusPaths`/`evidencePaths`/`focus` は repo 相対パスのみです。正規化は
  絶対パス（POSIX、Windows drive、UNC、`~`）を拒否します。
- `normalizeTraceEvent` はこのコントラクト外の field を落とすため、新しい
  producer から予期しない内容が漏れません。
- `durationMs` は壁時計の診断値のみです。`normalizeForCompare` は fixture
  比較の前にこれを除去し、consumer は厳密一致で assert してはいけません。

## 計測と非対象

`summarizeTrace` は run ごとに集計します: route 選択数、順序付き edge ID、
blocked/terminal 数、audit・delegate の dispatch 数、execution mode 数、
outcome 数、yield reason、scan 合計（`scans`、`filesRead`、`bytesRead`、
`uniqueFilesMax`）。

trace は LLM token、cost、provider 名、prompt、文書本文、secret を一切記録
しません — schema にそれらを保持できる field が存在しません。生データが
必要な caller は trace の外で各自の管理下に保持します。将来のコントラクト
改定で field を追加する場合は `v` を上げます。

trace が無効（`--trace-file` なし）でも routing、evidence、gate は変わり
ません。trace 追記が失敗しても stderr に警告するだけで、route は失敗
させません。
