# Graph Effect Outcome Contract

これは graph から呼び出された audit または delegate の caller 向け contract です。
public TypeScript schema や新しい Graph State object ではありません。呼び出された
effect はそれぞれ 1 つの `EffectOutcome` footer を返し、caller は yield 時に 1 つの
`GraphRunResult` を返します。

## EffectOutcome footer

すべての footer は次の scope を持ちます。reference は型付きで live state に bind されます。
`kind` は reference の種別を、`path`/`id` は document を特定し、`revision` はその
canonical content fingerprint を示します。`provider` reference は `idempotencyKey` を
持ちます。完了を prose で主張せず、reference を記録します。

```yaml
status: completed
edgeId: implementation-retry
stage: delegate
effect: { kind: delegate, id: implementation-flow }
inputs:
  - { kind: durable-document, path: docs/tasks/example-task.md, id: TASK-0H5nCkR2mW9xVbYqZeLp3s, revision: sha256:input }
outputs:
  - { kind: durable-document, path: docs/impl/ir/example-task.md, id: IMPL-5RfVgTgBnHkLmQwErTyUiO, revision: sha256:evidence }
proof: { kind: durable-document, path: docs/impl/ir/example-task.md, id: IMPL-5RfVgTgBnHkLmQwErTyUiO, revision: sha256:evidence }
```

```yaml
status: retry
edgeId: implementation-to-design
stage: delegate
effect: { kind: delegate, id: implementation-flow }
inputs:
  - { kind: durable-document, path: docs/tasks/example-task.md, id: TASK-0H5nCkR2mW9xVbYqZeLp3s, revision: sha256:before }
outputs:
  - { kind: durable-document, path: docs/designs/graph.md, id: DESIGN-2XyZaBcDeFgHiJkLmNoPqR, revision: sha256:changed }
retry:
  changedOutputs:
    - { kind: durable-document, path: docs/designs/graph.md, id: DESIGN-2XyZaBcDeFgHiJkLmNoPqR, revision: sha256:changed }
```

```yaml
status: yield
edgeId: implementation-retry
stage: delegate
effect: { kind: delegate, id: implementation-flow }
inputs:
  - { kind: durable-document, path: docs/tasks/example-task.md, id: TASK-0H5nCkR2mW9xVbYqZeLp3s, revision: sha256:input }
outputs:
  - { kind: durable-document, path: docs/impl/ir/example-task.md, id: IMPL-5RfVgTgBnHkLmQwErTyUiO, revision: sha256:checkpoint }
reason: authority-required
```

status variant ごとの required / forbidden field は次のとおりです。

| Status | Required | Forbidden |
| --- | --- | --- |
| `completed` | `proof` が `durable-document` reference（`kind`、`path`、`id`、`revision`）または `provider` reference（`kind: provider`、`provider`、`idempotencyKey`）のどちらか | `reason`、`retry` |
| `retry` | 変更された canonical reference を持つ `retry.changedOutputs` | `proof`、`reason` |
| `yield` | `reason`: `approval-required`、`input-required`、`authority-required`、`unrecoverable-blocker`、`commit-required` のいずれか | `proof`、`retry` |

`outputs` はすべての outcome の canonical output を記録します。`completed`
outcome は加えて、この effect 自体を証明します。durable-document proof が生成した
canonical content を bind するか、provider reference が irreversible な外部 effect を
idempotency key で証明します。route fingerprint を proof に使いません。

受け入れられた `completed` outcome は run の Execution Store
（`.apm/state/doc-driven-dev/runs/<runId>/receipts/`）に Effect Receipt として永続化され、
edge checkpoint が `checkpoints/` に続きます。これらの receipt は effect が完了したことの
execution-side の証明であり、verification-side store に属する Verification Evidence とは
別物です。

## yield 時の GraphRunResult

`GraphRunResult` は caller/documentation の shape であり、public TypeScript export
ではありません。caller が返すのは yield 時だけです。`route` は receipt から導出した
subset ではなく、terminal と blocked result を含む complete な最終 `GraphRoute` です。

```ts
type GraphRunResult = {
  status: "yielded";
  reason:
    | "approval-required"
    | "input-required"
    | "authority-required"
    | "unrecoverable-blocker"
    | "commit-required"
    | "budget-exhausted"
    | "terminal"
    | "single-step-complete";
  route: GraphRoute;
  outcomes: EffectOutcome[];
  trace: GraphRunTrace[];
  handoff: GraphRunHandoff;
}

type GraphRunTrace = {
  route: GraphRoute;
  outcomes: EffectOutcome[];
  completedAudits: string[];
  delegate: string | null;
  delegateComplete: boolean;
  evidenceRecorded: boolean;
  checkpointComplete: boolean;
  commitWaived: boolean;
}

type GraphRunHandoff = {
  runId: string;
  current: string;
  mode: "single-step" | "run-until-yield";
  maxHops: number;
  maxDispatchesPerEdge: number;
  maxTotalDispatches: number;
  yieldReason: GraphRunResult["reason"] | null;
  focus: string[];
  signals: string[];
  graphPath: string;
  completedEdges: string[];
  seenRouteFingerprints: string[];
  taskBudgetCount: number | null;
  auditCounts: Record<string, number>;
  delegateCounts: Record<string, number>;
  checkpoints: GraphRoute[];
  edgeTrace: GraphRunTrace[];
  outcomes: EffectOutcome[];
  pending: {
    route: GraphRoute;
    outcomes: EffectOutcome[];
    completedAudits: string[];
    delegateComplete: boolean;
    evidenceRecorded: boolean;
    evidenceCheckpointId: string | null;
    commitBaseline: { head: string | null; dirty: string[] } | null;
    dispatches: number;
  } | null;
  totalDispatches: number;
  hops: number;
}
```

`outcomes` と `trace` は caller の順序を保持します。`GraphRunTrace` は各 complete route、
順序付き outcomes、completed audits、delegate state、evidence/checkpoint flag を持ちます。
`commitWaived` は、edge の destination が `commitGate` を宣言し、caller がその edge に
対して宣言済み `commit-waived` signal を適用した場合に `true`、それ以外は `false`
です。これが run trace に waiver を記録する仕組みです。
`GraphRunHandoff` は resume field を保持します。`runId` はすべての receipt と
checkpoint が記録された Execution Store run を bind します。すなわち `current`、mode、`maxHops`、
per-edge dispatch budget の `maxDispatchesPerEdge`、run-level dispatch bound の
`maxTotalDispatches`、focus、
signals、graph path、completed edge ID、seen route fingerprint、freeze した task-budget basis、
audit/delegate counter、累積 `totalDispatches` count、
completed route、trace、outcome、pending edge、hop count です。`null` は
caller が explicit `maxHops` を supplied したことを表し、non-negative number は immutable な
dynamic-default basis です。pending edge の `evidenceCheckpointId` はその evidence
phase が記録した Execution Store checkpoint を指し、resume は flag を鵜呑みにせず
checkpoint record を検証します。

## caller が正規化する effect

footer を emit できる skill は直接返します。caller adapter は Graph Definition YAML、script、
generated JavaScript を変更せず、次の declared effect を同じ `EffectOutcome` shape に
正規化します。

| Declared effects | Footer owner |
| --- | --- |
| `migrate_docs`, `scaffold_docs`, `build_task_graph` | script delegate 用の caller adapter |
| `spec`, `adr`, `design`, `plan`, `task`, `test-spec`, `impl-record`, `experiment-log`, `all` | named audit 用の caller adapter |
| `briefing-flow`, `design-doc`, `planning-flow`, `implementation-flow`, `doc-status` | 呼び出された skill |

この行の `plan`、`task`、`test-spec` audit effect は宣言上の名前のみです。
Document Registry 3 ではこれらの scope は registry ゲートで拒否されるため
（後述の canonical input セクション参照）、#243 で graph definition が
rewire されるまで adapter が completed outcome を正規化することはありません。

adapter は `completed` または `retry` を返す前に effect 固有の canonical input と output を
記録します。adapter output が missing または malformed なら
`authority-required` で fail closed し、caller は receipt も edge checkpoint も記録しません。

## effect 固有の canonical input

receipt scope は generic な Task Graph fallback ではなく effect を使います。standard document
graph では、`spec`、`adr`、`design` audit は対応する canonical document を読み、
`impl-record` はその Implementation Record、`experiment-log` は `docs/impl/exp` の
Experiment Log（`.jsonl`）、`all` は
declared canonical document set を読みます。graph の `audits` リストに残る
`plan`、`task`、`test-spec` の名前は Document Registry 3 では拒否される
scope であり（`plan`/`task` は execution-bound、`test-spec` は
migration 専用レガシー形式のため `audit_docs.js --type <name>` は
registry ゲートで失敗します）、canonical input を持ちません。宣言済みの
リストは Graph Definition v3 の rewire（#243）まで superseded とします。
graph から dispatch される文書型 audit は
`audit_docs.js --type <name> --profile artifact`、`all` は
`audit_docs.js --type all --profile artifact` として実行され、`impl-record` は
`impl-doc/scripts/audit_impl_record.js`、`experiment-log` は
`impl-doc/scripts/audit_experiment_log.js` として実行されます。`artifact` profile は canonical
document の整合性だけを評価するため、missing または stale な index が graph execution を
gate することはありません。`briefing-flow` は spec と ADR を読み、`design-doc`
は spec と ADR を読み design evidence を記録し、`planning-flow` は selected approved design を
読み、selected plan とすべての produced plan-linked test spec および task document を記録します。
`implementation-flow` は選択 task と design/plan と linked test spec を読み Implementation Record を記録し、
`doc-status` は declared document set を読みます。script-adapter input は
`migrate_docs`（declared document set）、`scaffold_docs`
（workspace-root bootstrap input）、`build_task_graph`（focused plan と選択 task document）です。すべての typed
reference は使用前に current state と照合して resolve しなければなりません。

## 既存 delegate の意味

この contract は既存の semantics を表現するだけで、workflow state を追加しません。

| Effect | `completed` | `retry` | `yield` |
| --- | --- | --- | --- |
| `briefing-flow` | briefing gate が通過する | recoverable document gap | unresolved user-only requirement の `input-required` |
| `design-doc` | design が approved になる | — | designated reviewer を待つ `approval-required`、upstream user decision がない `input-required` |
| `planning-flow` | approved/active plan と linked test-spec/task evidence（plan が検証可能な振る舞いを宣言しない場合は plan front matter の `test-spec-skip` に記録した理由） | changed canonical plan/test-spec/task repair evidence | plan review が pending の `approval-required`、user-owned planning choice が missing の `input-required`、declared safe repair がない場合の `unrecoverable-blocker` |
| `implementation-flow` | task slice が verified され Implementation Record が complete になる | declared spec/design/constraint repair | granted authority の範囲で commit できない変更を slice が生成した場合の `commit-required`、permission のない irreversible effect の `authority-required`、declared safe repair がない場合の `unrecoverable-blocker` |
| `doc-status` | documents が Completable になる | declared repair evidence を伴う Returned | safe repair のない Returned の `unrecoverable-blocker` |

## 正確な caller evaluation

caller は最初に terminal または blocked `GraphRoute` と hop/repetition budget を
[execution contract](execution-contract.ja.md) に従って評価します。続いて
`EffectOutcome.status`、`yield` の場合は `reason` を正確に match し、free-form な
delegate prose から result を推測しません。

- `completed` は input scope、記録済み receipt、outputs、proof が validate した場合に
  限り、この scoped audit または delegate stage を skip できます。
- `retry` は宣言された changed outputs を re-project し、fresh route が declared edge
  を選んだ後にだけ auto-continuable です。
- `yield` はその exact reason で停止します。

yield 時、caller は complete `GraphRoute`、順序付き `EffectOutcome` footer、bounded
counter/trace、最終 yield reason を含む `GraphRunResult` handoff を記録します。保持した
route は topology、terminal/blocked、budget evaluation に使います。receipt validity は
`edgeId`、stage、effect、input scope、outputs、proof だけを bind し、complete
`GraphRoute` object の byte-equivalent を要求しません。

## Resume と duplicate effect

saved receipt と比較する前に canonical Markdown を再 projection します。pending の
`completed` stage が reuse されるのは、run の Execution Store に記録された Effect
Receipt が同じ `edgeId`、stage、effect、input binding、output/proof result を証明し、
fresh route が同じ input scope（同じ typed reference の multiset）を resolve し、
bind されたすべての output と proof がまだ current state を resolve するときだけです。
proof や receipt がなければ、irreversible effect を replay せず `authority-required` を
yield します。

たとえば Task Graph A に scope された `implementation-flow` receipt は、canonical
Markdown が Task Graph B を project した後に delegate を skip できません。fresh graph と
authoritative-input scope がまだ match するときだけ eligible になります。
