# Delegate Execution-Mode Policy

この contract は、[execution contract](execution-contract.ja.md) ループ内で
dispatch されるすべての effect（audit と delegate の両方）について、caller が
execution mode をどう選択するかを定義します。リポジトリ内のプログラム caller は
`scripts/lib/delegate_policy.ts`（`selectDelegateMode`、`toExecutionMode`、
`buildDelegateHandoff`）を使い、エージェント caller は同じ選択順序と handoff
contract を適用します。この policy は決定的です — dispatch fact を mode と記録
済みの理由に対応付けるだけで、それ自体は何も起動しません。dispatch は引き続き
caller の責務です。

## Dispatch fact

選択は `PolicyFacts` を入力とします。`effectId` と `stage` は dispatch される
effect を相関付けるための識別子であり、判断そのものが読むのは
`sharedJudgment`、`independentScope`、`parallelCandidate`、`contextCost`
（`"low" | "high"`）、`hostCapabilities`（host が実行できる mode の集合）、および
任意の `override`（`{ mode, reason }`）です。

## Mode と選択基準

| Mode | 選択条件 | Dispatch handoff | Trace `executionMode` | Delegate の例 |
| --- | --- | --- | --- | --- |
| `same-context` | 判断材料を共有する — caller と effect が同じ canonical document を読み書きし、逐次依存があり、反復が頻繁な場合。**デフォルト。** | 不要 — effect は caller の context で実行される | `same-context` | named audit（`spec`、`task`、`test-spec`）、`build_task_graph` |
| `subagent-as-tool` | 独立した調査や black-box review、bounded な戻り値、または `contextCost: "high"` — 生の材料を caller の context に持ち込まない場合 | `DelegateHandoff` | `tool` | bounded な discovery/research delegate、文書の black-box review |
| `isolated-subagent` | 独立した write scope **かつ** parallel candidacy — delegate が分離された write scope を所有し、他の作業と並行して実行できる場合 | `DelegateHandoff` | `subagent` | 分離された artifact を書く delegate（独立 task 上の `implementation-flow` など） |

type や document kind の違いだけで delegation を正当化してはいけません。
mode は dispatch ごとに上記の fact から選択され、skill 名に結び付けられません —
同じ delegate でも、ある run では `same-context`、別の run では
`isolated-subagent` で実行され得ます。

`subagent-as-tool` が `tool` として記録されるのは、bounded な tool call として
呼ばれる subagent が scripted/tool dispatch の封筒を共有するためです。
`isolated-subagent` は真に独立した context への delegation を示すために
`subagent` として記録されます。policy を実行しない caller は宣言済みの
`executionMode`（デフォルト `unknown`）のままで、`modeReason` は記録されません。

## 選択順序

`selectDelegateMode` は fact を固定の順序で評価します — 最初に一致したものが
採用されます。

1. **明示的な override。** `override` が存在し、host が `override.mode` を
   サポートする場合、その mode を理由 `override:<reason>` とともに返します。
   host がサポートしない場合、override は拒否されます — `same-context` を
   理由 `host-unsupported:<mode>` と `override-refused` とともに返し、
   `fallbackFrom` に拒否された mode を設定します。
2. **Shared judgment。** `sharedJudgment` → `same-context`、理由
   `shared-judgment`。
3. **独立した parallel candidate。** `independentScope && parallelCandidate`
   → `isolated-subagent`、理由 `independent-scope`、`parallel-candidate`。
4. **独立した scope。** `independentScope` → `subagent-as-tool`、理由
   `independent-scope`。
5. **高い context cost。** `contextCost === "high"` → `subagent-as-tool`、
   理由 `context-cost`。
6. **デフォルト。** → `same-context`、理由 `default`。

ステップ 3〜5 で選択された delegated mode を host がサポートしない場合、
理由に `host-unsupported:<mode>` が追加され `fallbackFrom` が設定された上で
`same-context` にフォールバックします — policy が mode を黙って切り替えることは
ありません。`same-context` は常に host が利用可能と仮定され、gate の対象には
なりません。

## 最小 handoff contract

dispatch されるすべての delegate effect（`subagent-as-tool` または
`isolated-subagent`）は、`buildDelegateHandoff` が組み立てる
JSON-serializable な `DelegateHandoff` を受け取ります。

| Field | 内容 |
| --- | --- |
| `focus` | delegate が集中する repo 相対 path |
| `authoritativeInputs` | outcome がそのまま echo しなければならない live canonical reference |
| `sourceRefs` | context として渡す追加の live canonical reference |
| `acceptanceCriteria` | delegate の完了条件 |
| `permissions` | delegate が触れてよい `{ read, write }` の repo 相対 scope |
| `toolLimits` | delegate が使ってよい tool 識別子 |
| `budget` | `{ maxHops }` の hop 上限 — デフォルト `1`。multi-hop delegate flow では明示的に拡張する |
| `completion` | 必須の完了文 — canonical evidence を伴う completed `EffectOutcome` |

canonical reference は `path`、`id`、`fingerprint` で artifact を識別します。
verification に関係する情報を lossy な要約で代用してはいけません — handoff は
live reference を保持し、delegate がその時点の内容を解決します。`completion`
field は `EffectOutcome` footer を完了形状として宣言します — delegate はその
footer を出力して完了します。

## Return contract

compact な戻り値は
[execution-outcome-contract.ja.md](execution-outcome-contract.ja.md) が定義する
`EffectOutcome` に正規化されます。`completed`、`retry`、`yield` のいずれかで、
それぞれ canonical な `authoritativeInputs` と `evidence` を持ちます。

execution mode に関わらず、同じ `assertEffectOutcome` validation が適用されます。
`edgeId`、`stage`、effect identity の不一致、解決済み入力集合からずれた
`authoritativeInputs`、fingerprint が現在の canonical content を解決しなくなった
evidence（stale evidence）、status ごとの必須 field の欠落や禁止 field の存在は、
effect が in-context、tool、isolated subagent のどれで実行されても同じように
拒否されます。mode が contract を緩めることはありません — `permissions.write` の
外への書き込みは handoff 違反のままであり、宣言されていない edge や間違った
focus は同じ outcome チェックで失敗します。

## Fallback と override の規則

- **dispatch 前の host capability gate。** `same-context` 以外のすべての選択は、
  effect を呼び出す前に `hostCapabilities` と照合されます。gate は選択の一部で
  あり、dispatch 後の修正ではありません。
- **mode を黙って切り替えない。** サポートされない mode は、理由に
  `host-unsupported:<mode>` が追加され、`fallbackFrom` に拒否された mode が
  記録された上で `same-context` を返します。
- **override は記録済みの理由を必須とする。** 受理された override は
  `override:<reason>` を報告します。host がサポートしない override は、黙って
  適用せず `override-refused` で拒否します。
- **決定は追跡可能。** 決定の理由は `;` 連結され、trace の `effect-dispatched`
  event に `modeReason` として記録されます —
  [run-trace-contract.ja.md](run-trace-contract.ja.md) を参照。
- **evaluation は mode を固定できる。** 決定的な evaluation harness は
  `override` を使って mode を固定してかまいません。固定も依然として host
  capability で gate され、記録されます。

## 非対象

- model の品質評価は行いません — policy は dispatch fact を mode に対応付ける
  ものであり、どの model や agent が優れているかを判断しません。
- provider 固有の subagent API を要求しません — contract は mode、handoff、
  return であり、各 host が自前の仕組みに対応付けます。
- edge の増殖をしません — execution mode は graph topology を変更しません。
  mode を表現するために edge、delegate、condition を追加してはいけません。
