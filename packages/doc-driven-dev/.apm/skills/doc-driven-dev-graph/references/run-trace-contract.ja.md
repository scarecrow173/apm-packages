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
run が共存でき、event は `runId` でグループ化します。各 trace ファイルは
常に単一の writer が書き込みます — 並行追記は行がインターリーブし、
`seq` の順序を壊す可能性があります。

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
| `delegate`, `requiredAudits`, `commitGate` | `GraphRoute` から転記 |
| `blockers` | `GraphRoute` の blocker。自由文を含む項目は `<kind>:sha256:<12hex>` トークンに正規化されます（後述） |
| `focus` | 解決済みの repo 相対 focus path |
| `tasks` | 選択された Task Graph node。`{ id, status }` は task front matter の識別子をそのまま転記する相関キーです |
| `routeHash` | 完全な `GraphRoute` を key ソートした JSON の sha256 |
| `durationMs` | 任意の壁時計診断値。厳密一致で assert してはいけません |

## Caller が出力する event

caller が audit/delegate を駆動するときに記録します。`route_graph.js` は
これらを出力しません。

### `effect-dispatched`

`edgeId`、`stage`（`audit`/`delegate`）、`effectId`、`executionMode`
（`same-context`、`subagent`、`tool`、`unknown`）、`focusPaths`
（effect に渡した repo 相対 artifact path）。`modeReason` は任意です。
caller 側の execution-mode policy が mode を決定した場合、policy の選択
理由を `;` 連結したトークン列を記録します。正規化では空でない文字列の
場合のみ保持されます（理由リストであり、パスではありません）。
ここでの `executionMode` は dispatcher に渡された *要求された* mode であり、
dispatcher が実際に実行した内容は `dispatch-observed` が記録します。

### `dispatch-observed`

dispatcher が実行したと報告する dispatch 1 件につき 1 event。
`DispatchResult` が返った直後、`effect-outcome` の前に出力されます。
`edgeId`、`stage`、`effectId` は生成元の `effect-dispatched` と対応します。
残りの field は dispatcher 自身が報告した実行内容です。

| Field | 意味 |
| --- | --- |
| `target` | dispatch が実行した対象 — self-observation では `effectId` と等しく、composite delegate 内の作業（`briefing-flow` 内の `spec-doc`、`adr-doc`、`research` など）では adapter 内部の dispatch 名 |
| `requested` | dispatch に要求された mode（`same-context`/`subagent`/`tool`/`unknown`） |
| `actual` | dispatcher が実際に実行したと報告する mode（拒否時は `unknown`） |
| `method` | 実行の仕組み — `scripted`（決定的 adapter）、`inline-skill`（caller の context で実行）、`subagent-spawn`（独立した bounded subagent）、`tool-call`（bounded な tool 型 delegation）、`not-executed`（拒否） |

受理されたすべての dispatch はちょうど 1 件の self-observation
（`target === effectId`）を持ち、その `requested` は生成元の
`effect-dispatched.executionMode` と一致し、実行された dispatch の `actual`
もそれと一致します（`requested === "unknown"` の場合は `actual` チェックを
免除）。要求と矛盾する self-report、または self-observation を持たない
dispatch は、malformed な outcome と同様に拒否されます — trace にはその
observation が forensic な記録として残り、`effect-outcome` は出力されま
せん。`method: "not-executed"` が正直であるのは `yield` outcome と組み
合わせた場合のみです。internal observation（`target !== effectId`）は
adapter 自身の報告であり、same-context の audit を delegated な作業と読み
替えただけではなく独立した spawn が実際に行われたことを trace が証明する
手段です — 新しい graph effect を表すものではありません。

### `effect-outcome`

`edgeId`、`stage`、`effectId`、`outcome`（`completed`/`retry`/`yield`）、
`evidencePaths`（repo 相対）、`reason`。`outcome` が `yield` のとき必須、
`completed`/`retry` では拒否されます（validator が両方を強制します）。
値は `approval-required`、`input-required`、`authority-required`、
`unrecoverable-blocker`、`commit-required` のいずれかです。

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
- `route-selected.blockers` は bounded なトークンのみを記録します。
  `<kind>:` プレフィックスの後に自由文を持つ blocker（relation target を
  埋め込んだ `broken-relation:` メッセージなど）は
  `<kind>:sha256:<12hex>` に正規化されます — 対応可能な kind を残しつつ、
  埋め込まれたパスや機密を落とす決定的な内容ハッシュです。kind を持たない
  blocker（`focus-required`、`duplicate-id` など）はそのまま転記され、
  `tasks[].id`/`status` も同様です — これらは trace が保持するための
  相関識別子です。
- `normalizeTraceEvent` はこのコントラクト外の field を落とすため、新しい
  producer から予期しない内容が漏れません。
- `durationMs` は壁時計の診断値のみです。`normalizeForCompare` は fixture
  比較の前にこれを除去し、consumer は厳密一致で assert してはいけません。

## 計測と非対象

`summarizeTrace` は run ごとに集計します: route 選択数、順序付き edge ID、
blocked/terminal 数、audit・delegate の dispatch 数、execution mode 数、
outcome 数、yield reason、dispatch-observation 合計（`dispatchObservations`:
`total`、`byActual`、`byMethod`）、scan 合計（`scans`、`filesRead`、
`bytesRead`、`uniqueFilesMax`）。

trace は LLM token、cost、provider・model 名、prompt、文書本文、secret を
一切記録しません — schema にそれらを保持できる field が存在しません。
生データが必要な caller は trace の外で各自の管理下に保持します。
コントラクト改定での field 追加は、additive-optional な拡張（未知の
field は読み取り時に落とされます）または `v` の increment のみで
行われます。

trace が無効（`--trace-file` なし）でも routing、evidence、gate は変わり
ません。trace 追記が失敗しても stderr に警告するだけで、route は失敗
させません。
