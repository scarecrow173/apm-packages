# Context Retrieval Contract

この contract は、caller が artifact context を段階的に取得する方法を定義します —
L0 route state、L1 metadata、L2 document body、L3 bounded traversal — により、各
delegate が必要とする context だけを受け取ります。リポジトリ内のプログラム caller は
`scripts/lib/artifact_context.ts`（`listArtifactMetadata`、
`fetchArtifactBodies`、`expandArtifactContext`）を使い、エージェント caller は
`fetch_context.js` CLI を通じて同じ関数に到達します。すべての level は Artifact
Graph の scan と relation helper を通じて解決されます — 第 2 の index も vector
DB もありません — そして拒否された lookup はすべて finding として記録され、黙って
捨てられることはありません。

## Level の概要

| Level | Channel | 取得元 | 含むもの | 含まないもの |
| --- | --- | --- | --- | --- |
| L0 | Route state | `route_graph.js` の出力 | `GraphRoute` field と解決済み focus | document body |
| L1 | Metadata | `fetch_context.js --metadata` | 各 record の `path`、`id`、`type`、`status`、`relations` | `body` |
| L2 | Body fetch | `fetch_context.js --fetch` | 検証済みの `{path, id, body}` document | 未検証の ref |
| L3 | Traversal | `fetch_context.js --expand` | 境界付き `{path, id, depth, via}` node | `body` |

## L0 — route state

`route_graph.js` は invocation ごとに完全な `GraphRoute` を 1 つ返します
（[graph-contract.ja.md](graph-contract.ja.md) 参照）。`status`、
`current`/`next`、`edgeId`、`condition`、`delegate`、`requiredAudits`、`blockers`、
`commitGate`、選択された `taskGraph` を含み、fresh な Graph State projection から
計算され、その解決済み `focus` は `route-selected` trace event に記録されます。
この route state はすべての hop で caller が常に利用でき、audit の
実行、宣言済み delegate の dispatch、yield reason の評価に十分です。L0 は
document body を持ちません — artifact を指名するだけで、内容を引用しません。

## L1 — metadata

```bash
node .apm/skills/doc-driven-dev-graph/scripts/fetch_context.js \
  [--cwd <repo>] --metadata --focus <id-or-path> [--focus <id-or-path> ...] \
  [--task-dir <dir>] [--json]
```

出力は `{ "metadata": [...], "findings": [...] }` です。各 metadata record は
`{ path, id, type, status, relations }` で、`body` は決して含みません。結果は
focus が解決した artifact chain（router と同じ `resolveArtifactFocus` /
`selectArtifactChain` の意味論 — spec、ADR、design、plan、task、anchor）、または
focus が chain member を指名しない場合は解決済み focus path に、各 included
record の解決済み typed-relation neighbor を宣言されている両方向 1 hop 分
加えたものをカバーします。external reference（URI scheme または `//` target）は
local artifact ではないため skip されます。record は `path` で決定的に sort されます。

L1 は、どの document を読むかを決めるときや、handoff の focus list を組み立てる
ときに使います — path、ID、status、relation が答えになる場面ならどこでも。target
選択は明示的な `--focus` 値と typed relation のみに従います — 近接性や file 名の
推測、focus の自動補完はしません。`focus-required` または `focus-invalid` の場合、
結果に metadata は含まれません。

| Finding code | 発生条件 |
| --- | --- |
| `focus-required` | `--focus` が指定されなかった。 |
| `focus-invalid` | 指定された focus が一意の artifact chain に解決されなかった — 不明な path、曖昧な ID、複数の candidate chain。 |
| `duplicate-id` | scan が 1 つの artifact ID を共有する 2 つの record を検出（scan 診断のパススルー）。 |
| `broken-relation` | 宣言された relation target が record に解決されない — scan または included record の未解決 neighbor が報告。 |
| `ambiguous-target` | included record の relation target が、その ID を持つ record が複数あるため解決不能。 |

## L2 — body fetch

```bash
node .apm/skills/doc-driven-dev-graph/scripts/fetch_context.js \
  [--cwd <repo>] --fetch <path> [--fetch <path> ...] \
  [--id <path>:<id> ...] [--fingerprint <path>:<fp> ...] [--json]
```

出力は `{ "level": "L2", "documents": [...], "findings": [...] }` で、各 document は
`{ path, id, body }` — `body` は front matter を除く Markdown 本文です。document は
validation を通過した ref だけについて `path` 順で出力されます。L2 は delegate の
authoritative input に必須です — handoff の canonical reference（`path`、`id`、
`fingerprint`）は `--fetch <path>` とその `--id`・`--fingerprint` pin に対応します。

Pin の意味論:

- `--id <path>:<id>` は解決済み artifact ID が `<id>` と一致することを要求します。
  不一致ならその ref を `id-mismatch` で拒否します。
- `--fingerprint <path>:<fp>` は live の `canonicalReference` fingerprint が `<fp>`
  と一致することを要求します。不一致ならその ref を `stale-fingerprint` で拒否
  します。stale fingerprint は reference 取得後に document が変わったことを意味
  します — 再投影して再取得してください。stale な内容を再利用してはいけません。
- `--fetch` で指定されていない path を指す pin、または 1 つの path に同種の pin を
  2 つ付けることは caller error（`{ "error": ... }`、exit 1）です — pin が黙って
  無効化されることはあってはなりません。

拒否された各 ref は `findings` に入り、`documents` には決して入りません。

| Finding code | 発生条件 |
| --- | --- |
| `path-escape` | ref が絶対 path、または checkout を脱出する（`..`）。 |
| `not-canonical` | ref が canonical artifact doc でない — canonical docs directory（`docs/ideas`、`docs/discovery`、`docs/specs`、`docs/designs`、`docs/plans`、`docs/tasks`、`docs/test-specs`、`docs/adr`、`docs/impl/ir`、`docs/impl/exp`）の外、`.md` でない、または `README`/`index` ファイル。 |
| `not-found` | ref がファイルとして存在しない。 |
| `unreadable` | ファイルが artifact doc として parse できない。 |
| `id-mismatch` | `--id` が解決済み artifact ID と一致しない。 |
| `stale-fingerprint` | `--fingerprint` が live の fingerprint と一致しない。 |

## L3 — bounded traversal

```bash
node .apm/skills/doc-driven-dev-graph/scripts/fetch_context.js \
  [--cwd <repo>] --expand <id-or-path> [--relations <a,b,c>] \
  [--depth <n>] [--reason "<text>"] [--json]
```

出力は `{ "nodes": [...], "findings": [...], "reason"?: <text> }` です。各 node は
`{ path, id, depth, via }` — depth 0 の expansion root（`via: null`）と、発見された各
neighbor（到達に使った relation field 名が記録される）です。node は depth、次に
`path` で決定的に sort されます。指定した `--reason` は audit trail のため出力に
echo されます。

traversal は `resolveArtifactRelation` による typed relation 上の決定的な
breadth-first です。デフォルトの relation 集合は lineage 集合 —
`implements`、`implemented-by`、`derives-from`、`derived-by`、`refines`、
`refined-by` — で、`--relations` は relation 名の comma 区切りリストを受け付け、
少なくとも 1 つを指名する必要があります。`--depth` は非負整数で walk を制限し、
デフォルトは `2` です。expansion root は一意の artifact ID で先に解決し、次に
checkout 相対 path で解決します。external reference（URI scheme または `//`
target）は非 local として skip されます。visited set が cycle 安全性を保証し、
重複する到達は抑制されます。

L3 が許されるのは、L0–L2 が提供する以上の context を判断が必要とする場合だけです
— 理由と scope（`--relations`、`--depth`）を呼び出しに記録してください。デフォルトで
expand せず、推測もしません — lookup ごとの失敗はすべて finding として報告され、
黙って skip されません。

| Finding code | 発生条件 |
| --- | --- |
| `duplicate-id` | expansion root の ID が複数の record に一致。 |
| `not-found` | expansion root が artifact に解決されない。 |
| `broken-relation` | 宣言された relation target が record に解決されない。 |
| `ambiguous-target` | relation target が、その ID を持つ record が複数あるため解決不能。 |

## Guard と invariant

- **Fail closed。** path escape、document の欠落、ambiguous target、duplicate ID、
  invalid focus、stale fingerprint はすべて finding を生成します — lookup が黙って
  捨てられたり、推測や自動修正されたりすることはありません。
- **Runtime analysis は delegate body channel ではない。** リポジトリ全体の検査を
  必要とする audit（exit-audit / `doc-status`）は full scan を維持します。この
  contract が規定するのは delegate に渡される document body であり、別の channel
  です。
- **必須 input は常に取得する。** handoff が指名する evidence と gate 必須の
  document は L2 validation を通ります — 省略は黙って要件を落とすのではなく失敗
  しなければなりません。
- **権威は 1 つ。** すべての level が `scanArtifactGraph` の record と
  `resolveArtifactFocus` / `selectArtifactChain` / `resolveArtifactRelation` の
  意味論を再利用します。vector DB も第 2 の artifact authority もありません。
- **明示的な選択のみ。** L1 と L3 の target は明示的な focus と typed relation から
  来ます — file 名の近接性や focus の自動補完は決して使いません。
- **決定的な順序。** metadata record、document、traversal node、finding はすべて
  決定的に sort されます。traversal は固定順序の BFS です。
- **再投影による refresh。** fingerprint が一致しなくなったら、caller は再投影して
  再取得します — stale な内容は再利用されません。
- **1 invocation につき mode は 1 つだけ。** `--metadata`、`--fetch`、`--expand` は
  相互排他であり、各 supporting flag は自分の mode でのみ有効です — 他 mode の
  flag は黙って捨てるのではなく caller error です。

## CLI と exit code

出力は常に stdout への JSON です。`--cwd` が checkout を選択し（デフォルト: 現在の
directory）、`--help` は usage を表示します。

| 結果 | 出力 | Exit code |
| --- | --- | --- |
| 成功、finding なし | mode の結果 | `0` |
| 成功、finding あり | 空でない `findings` を含む mode の結果 | `1` |
| CLI-level error — 不明な flag、値の欠落、mode の競合、malformed な `--id`/`--fingerprint`/`--depth`/`--relations`、または他 mode の flag | stdout に `{ "error": "..." }`、stderr に message と usage | `1` |

finding はデータです — caller が対処しなければならない fail-closed の拒否であり、
crash ではありません。finding がある場合の非 0 終了は contract です。闇雲に
retry せず `findings` を確認してください。

## Baseline 測定

`scripts/lib/context_metrics.ts`（`summarizeBaseline`）は、この contract が守る
べき channel 分離を測定します。`scan` は runtime artifact-scan の read を数えます
— `artifact-scan` trace event に集約された `filesRead` と `bytesRead` で、許容される
リポジトリ全体の projection channel です。`delegateInputs` は実際に effect へ
dispatch された一意の focus path を file size で合計したものです。`ratio` は
`delegateInputs.bytes / scan.bytes`（scan が何も読まなかった場合は `0`）です。
第 3 の channel — in-process の `canonicalReference` fingerprint read — は意図的に
`scan` に含めていません。`scan` を「run が読んだ全 byte」と読んではいけません。

e2e harness は結果を `CaseRun.baseline` に付加し、JSONL case report と text report
の `baseline` ブロックにそのまま出力します。これにより scan と delegate-input の
分離がすべての case run で決定的に検証されます。

## 非対象

- token、cost、LLM 品質の評価は行いません — contract が規定するのは決定的な
  retrieval であり、model の振る舞いではありません。
- 新しい永続 store は作りません — Graph State と metadata は canonical Markdown の
  invocation ごとの投影のままです。
- delegate 配線は行いません — どの delegate が `fetch_context.js` を呼ぶかは host
  の dispatch 判断です。この contract は level、validation、失敗の意味論を定義します。
