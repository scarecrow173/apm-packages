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

## 既存 delegate の意味

この contract は既存の semantics を表現するだけで、workflow state を追加しません。

| Effect | `completed` | `retry` | `yield` |
| --- | --- | --- | --- |
| `briefing-flow` | briefing gate が通過する | recoverable document gap | unresolved user-only requirement の `input-required` |
| `design-doc` | design が approved になる | — | designated reviewer を待つ `approval-required`、upstream user decision がない `input-required` |
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
