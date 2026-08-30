# Graph Effect Outcome Contract

これは graph から呼び出された audit または delegate の caller 向け contract です。
public TypeScript schema や新しい Graph State object ではありません。呼び出された
effect はそれぞれ 1 つの `EffectOutcome` footer を返し、caller は yield 時に 1 つの
`GraphRunResult` を返します。

## EffectOutcome footer

すべての footer は次の scope を持ちます。完了を prose で主張せず、canonical path、ID、
fingerprint を記録します。

```yaml
status: completed
edgeId: implementation-retry
stage: delegate
effect: { kind: delegate, id: implementation-flow }
authoritativeInputs:
  - { path: docs/tasks/0001-task.md, id: TASK-0001, fingerprint: sha256:input }
evidence:
  - { path: docs/impl/ir/0001-task.md, id: IMPL-0001, fingerprint: sha256:evidence }
proof:
  canonicalEvidence: { path: docs/impl/ir/0001-task.md, id: IMPL-0001, fingerprint: sha256:evidence }
```

```yaml
status: retry
edgeId: implementation-to-design
stage: delegate
effect: { kind: delegate, id: implementation-flow }
authoritativeInputs:
  - { path: docs/tasks/0001-task.md, id: TASK-0001, fingerprint: sha256:before }
evidence:
  - { path: docs/designs/0001-graph.md, id: DESIGN-0001, fingerprint: sha256:changed }
retry:
  changedEvidence:
    - { path: docs/designs/0001-graph.md, id: DESIGN-0001, fingerprint: sha256:changed }
```

```yaml
status: yield
edgeId: implementation-retry
stage: delegate
effect: { kind: delegate, id: implementation-flow }
authoritativeInputs:
  - { path: docs/tasks/0001-task.md, id: TASK-0001, fingerprint: sha256:input }
evidence:
  - { path: docs/impl/ir/0001-task.md, id: IMPL-0001, fingerprint: sha256:checkpoint }
reason: authority-required
```

status variant ごとの required / forbidden field は次のとおりです。

| Status | Required | Forbidden |
| --- | --- | --- |
| `completed` | `proof.canonicalEvidence`（`path`、存在する場合は `id`、`fingerprint`）または `proof.providerIdempotency`（`provider`、`key`）のどちらか 1 つ | `reason`、`retry` |
| `retry` | 変更された canonical path/ID/fingerprint を持つ `retry.changedEvidence` | `proof`、`reason` |
| `yield` | `reason`: `approval-required`、`input-required`、`authority-required`、`unrecoverable-blocker` のいずれか | `proof`、`retry` |

`evidence` はすべての outcome の canonical checkpoint を記録します。`completed`
outcome は加えて、この effect 自体を証明します。canonical evidence または external
provider の idempotency key のどちらかで証明し、route fingerprint を proof に使いません。

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
}

type GraphRunHandoff = {
  current: string;
  mode: "single-step" | "run-until-yield";
  maxHops: number;
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
  } | null;
  hops: number;
}
```

`outcomes` と `trace` は caller の順序を保持します。`GraphRunTrace` は各 complete route、
順序付き outcomes、completed audits、delegate state、evidence/checkpoint flag を持ちます。
`GraphRunHandoff` は resume field を保持します。すなわち `current`、mode、`maxHops`、focus、
signals、graph path、completed edge ID、seen route fingerprint、freeze した task-budget basis、
audit/delegate counter、completed route、trace、outcome、pending edge、hop count です。`null` は
caller が explicit `maxHops` を supplied したことを表し、non-negative number は immutable な
dynamic-default basis です。

## caller が正規化する effect

footer を emit できる skill は直接返します。caller adapter は Graph Definition YAML、script、
generated JavaScript を変更せず、次の declared effect を同じ `EffectOutcome` shape に
正規化します。

| Declared effects | Footer owner |
| --- | --- |
| `migrate_docs`, `scaffold_docs`, `build_task_graph` | script delegate 用の caller adapter |
| `spec`, `adr`, `design`, `plan`, `task`, `impl-record`, `all` | named audit 用の caller adapter |
| `briefing-flow`, `design-doc`, `planning-flow`, `implementation-flow`, `doc-status` | 呼び出された skill |

adapter は `completed` または `retry` を返す前に effect 固有の canonical input と evidence を
記録します。adapter evidence が missing または malformed なら
`authority-required` で fail closed し、checkpoint や completion receipt を作成しません。

## effect 固有の canonical input

receipt scope は generic な Task Graph fallback ではなく effect を使います。standard document
graph では、`spec`、`adr`、`design`、`plan` audit は対応する canonical document を読み、`task`
は選択された Task Graph task document、`impl-record` はその Implementation Record、`all` は
declared canonical document set を読みます。`briefing-flow` は spec と ADR を読み、`design-doc`
は spec と ADR を読み design evidence を記録し、`planning-flow` は selected approved design を
読み、selected plan とすべての produced plan-linked task document を記録します。
`implementation-flow` は選択 task と design/plan を読み Implementation Record を記録し、
`doc-status` は declared document set を読みます。script-adapter input は
`migrate_docs`（declared document set）、`scaffold_docs`
（workspace-root bootstrap input）、`build_task_graph`（focused plan と選択 task document）です。すべての referenced path/ID と
fingerprint は使用前に current canonical content と照合して resolve しなければなりません。

## 既存 delegate の意味

この contract は既存の semantics を表現するだけで、workflow state を追加しません。

| Effect | `completed` | `retry` | `yield` |
| --- | --- | --- | --- |
| `briefing-flow` | briefing gate が通過する | recoverable document gap | unresolved user-only requirement の `input-required` |
| `design-doc` | design が approved になる | — | designated reviewer を待つ `approval-required`、upstream user decision がない `input-required` |
| `planning-flow` | approved/active plan と linked task evidence | changed canonical plan/task repair evidence | plan review が pending の `approval-required`、user-owned planning choice が missing の `input-required`、declared safe repair がない場合の `unrecoverable-blocker` |
| `implementation-flow` | task slice が verified され Implementation Record が complete になる | declared spec/design/constraint repair | permission のない irreversible effect の `authority-required`、declared safe repair がない場合の `unrecoverable-blocker` |
| `doc-status` | documents が Completable になる | declared repair evidence を伴う Returned | safe repair のない Returned の `unrecoverable-blocker` |

## 正確な caller evaluation

caller は最初に terminal または blocked `GraphRoute` と hop/repetition budget を
[execution contract](execution-contract.ja.md) に従って評価します。続いて
`EffectOutcome.status`、`yield` の場合は `reason` を正確に match し、free-form な
delegate prose から result を推測しません。

- `completed` は input scope と proof が validate した場合に限り、この scoped audit
  または delegate stage を skip できます。
- `retry` は canonical changed evidence を re-project し、fresh route が declared edge
  を選んだ後にだけ auto-continuable です。
- `yield` はその exact reason で停止します。

yield 時、caller は complete `GraphRoute`、順序付き `EffectOutcome` footer、bounded
counter/trace、最終 yield reason を含む `GraphRunResult` handoff を記録します。保持した
route は topology、terminal/blocked、budget evaluation に使います。receipt validity は
`edgeId`、stage、effect、authoritative input、evidence、proof だけを bind し、complete
`GraphRoute` object の byte-equivalent を要求しません。

## Resume と duplicate effect

saved receipt と比較する前に canonical Markdown を再 projection します。saved
`completed` stage を skip できるのは、`edgeId`、stage、effect identity、すべての
authoritative input path/ID/fingerprint、canonical-evidence または
provider-idempotency proof が fresh scope と match するときだけです。proof がなければ、
irreversible effect を replay せず `authority-required` を yield します。

たとえば Task Graph A に scope された `implementation-flow` receipt は、canonical
Markdown が Task Graph B を project した後に delegate を skip できません。fresh graph と
authoritative-input scope がまだ match するときだけ eligible になります。
