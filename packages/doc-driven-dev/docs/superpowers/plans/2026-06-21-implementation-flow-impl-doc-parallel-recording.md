# implementation-flow impl-doc parallel recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `implementation-flow` が全作業完了後ではなく、各 task の実装中に `impl-doc` の記録を開始・維持するようにする。

**Architecture:** `impl-doc` を実装後の片付けではなく、Phase 5 の必須 documentation layer として扱う。implementation documentation 用の profile slot を追加し、`implementation-flow` と `doc-driven-dev-lifecycle` の Phase 5 契約を締め直し、Implementation Record がコード変更前に `in-progress` として作成されるよう `impl-doc` 側の手順も揃える。

**Tech Stack:** Markdown workflow skills, YAML adapter configuration, Node.js `node:test`, `tsx`, existing `doc-driven-dev` package docs

---

## Scope

この計画は、Phase 5 における実装記録のタイミングを workflow contract と回帰テストの両方で固定する。

含めるもの:

- `implementation-flow` が task 実行前に `impl-doc` を明示的に開く。
- `implementation-flow` の active stack/profile に、always-on documentation slot 経由で `impl-doc` が入る。
- `doc-driven-dev-lifecycle` Phase 5 が、Phase 6 へ進む前に実装中の `impl-doc` 記録を要求する。
- `impl-doc` は、Implementation Record を task 開始時に作成し、実装中は Markdown として更新することを明確化する。Experiment Log は引き続き CLI で JSONL 更新する。
- 英語版と日本語版の skill docs は意味と構造を同期する。
- 将来の変更で `impl-doc` が再び「完了後だけ」の扱いに戻らないよう、テストで契約を固定する。

含めないもの:

- 新しい `update_impl_record` CLI の追加。
- 既存の `--status in-progress` 利用手順を文書化する範囲を超える `new_impl_record.js` の挙動変更。
- 生成済み JavaScript scripts の変更。
- このリポジトリで track されていない `.agents/skills/**` の変更。
- 既存の無関係な `apm.lock.yaml` 変更や、既存の未追跡 follow-up-gate plan の変更。

---

## Current Diagnosis

現状には 3 つの契約上の隙間がある。

1. `implementation-flow` は Phase C の探索的 Experiment Log についてだけ `impl-doc` を強く示しており、Implementation Record は Phase D/E の完了時作成に寄っている。
2. `doc-driven-dev-lifecycle` は Phase 5 で `implementation-flow` を呼ぶが、実装開始前に `impl-doc` を開く義務を明記していない。
3. `implementation-adapter.yaml` に documentation slot がないため、profile-driven active stack から `impl-doc` が自然に漏れる。

最小で持続する修正は、`impl-doc` を Phase 5 の実行契約と profile の一部にし、lifecycle と impl-doc の文言をそれに合わせること。

---

## File Map

| Path | Responsibility |
| --- | --- |
| `scripts/doc-driven-dev/tests/doc-suite.test.ts` | `implementation-flow`, `doc-driven-dev-lifecycle`, `impl-doc` の documentation contract を固定する回帰テスト。 |
| `scripts/doc-driven-dev/tests/skills/skill-discovery-protocol/integration.test.ts` | 生成される implementation profile に implementation documentation slot が入ることを検証する回帰テスト。 |
| `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md` | 英語版 Phase 5 implementation orchestrator contract。 |
| `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.ja.md` | 日本語版 Phase 5 implementation orchestrator contract。 |
| `packages/doc-driven-dev/.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml` | implementation-flow profile 生成の flow stack / taxonomy source。 |
| `packages/doc-driven-dev/.apm/skills/implementation-flow/assets/templates/implementation-profile-template.md` | 英語版 profile template。documentation category/default stack を説明する。 |
| `packages/doc-driven-dev/.apm/skills/implementation-flow/assets/templates/implementation-profile-template.ja.md` | 日本語版 profile template。documentation category/default stack を説明する。 |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md` | 英語版 lifecycle Phase 5 entry/completion contract。 |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.ja.md` | 日本語版 lifecycle Phase 5 entry/completion contract。 |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.md` | 英語版 canonical lifecycle flow contract。 |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.ja.md` | 日本語版 canonical lifecycle flow contract。 |
| `packages/doc-driven-dev/.apm/skills/impl-doc/SKILL.md` | 英語版 implementation documentation の利用タイミングと更新ルール。 |
| `packages/doc-driven-dev/.apm/skills/impl-doc/SKILL.ja.md` | 日本語版 implementation documentation の利用タイミングと更新ルール。 |
| `packages/doc-driven-dev/.apm/skills/impl-doc/references/impl-conventions.md` | 英語版 in-progress IR 更新・監査規約。 |
| `packages/doc-driven-dev/.apm/skills/impl-doc/references/impl-conventions.ja.md` | 日本語版 in-progress IR 更新・監査規約。 |
| `packages/doc-driven-dev/README.md` | Phase 5 を implementation + in-flight impl-doc として示す英語版 package overview。 |
| `packages/doc-driven-dev/README.ja.md` | Phase 5 を implementation + in-flight impl-doc として示す日本語版 package overview。 |

---

## Dependency Graph

| Task | Depends on | Blocks |
| --- | --- | --- |
| 1. Add failing contract tests | Existing test fixtures | 2, 3, 4, 5 |
| 2. Update implementation-flow profile and docs | Task 1 red tests | 3, 5 |
| 3. Update lifecycle Phase 5 contract | Task 1 red tests, Task 2 contract terms | 5 |
| 4. Update impl-doc timing/conventions | Task 1 red tests | 5 |
| 5. Update README and verify | Tasks 2, 3, 4 | Completion |

---

## Task 1: 回帰テストを追加する

**Files:**

- Modify: `scripts/doc-driven-dev/tests/doc-suite.test.ts`
- Modify: `scripts/doc-driven-dev/tests/skills/skill-discovery-protocol/integration.test.ts`

- [ ] **Step 1: documentation contract assertion を doc-suite.test.ts に追加する**

`scripts/doc-driven-dev/tests/doc-suite.test.ts` の既存 doc-driven-dev lifecycle tests 付近に、次の test を追加する:

```ts
test("implementation-flow opens impl-doc before task execution", () => {
  const implementationRoot = path.join(skillRoot, "implementation-flow");
  const lifecycleRoot = path.join(skillRoot, "doc-driven-dev-lifecycle");
  const implDocRoot = path.join(skillRoot, "impl-doc");

  const flow = fs.readFileSync(path.join(implementationRoot, "SKILL.md"), "utf8");
  const flowJa = fs.readFileSync(path.join(implementationRoot, "SKILL.ja.md"), "utf8");
  const adapter = fs.readFileSync(
    path.join(implementationRoot, "assets", "adapters", "implementation-adapter.yaml"),
    "utf8",
  );
  const lifecycle = fs.readFileSync(path.join(lifecycleRoot, "SKILL.md"), "utf8");
  const lifecycleJa = fs.readFileSync(path.join(lifecycleRoot, "SKILL.ja.md"), "utf8");
  const contract = fs.readFileSync(path.join(lifecycleRoot, "references", "flow-contract.md"), "utf8");
  const implDoc = fs.readFileSync(path.join(implDocRoot, "SKILL.md"), "utf8");

  assert.match(flow, /Phase C0: Open Implementation Documentation/);
  assert.match(flow, /new_impl_record\.js --title/);
  assert.match(flow, /--status "in-progress"/);
  assert.match(flow, /Implementation Record is opened before code changes begin/);
  assert.match(flowJa, /Phase C0: Implementation Documentation を開く/);
  assert.match(flowJa, /--status "in-progress"/);

  assert.match(adapter, /slot_id: "implementation_documentation"/);
  assert.match(adapter, /skill: "impl-doc"/);
  assert.match(adapter, /description_patterns: \["impl-doc", "implementation record", "experiment log", "docs\/impl"\]/);

  assert.match(lifecycle, /Before the first code change for each task/);
  assert.match(lifecycle, /in-progress Implementation Record/);
  assert.match(lifecycleJa, /各 task の最初のコード変更前/);
  assert.match(contract, /5-1 Open implementation documentation/);

  assert.match(implDoc, /Task implementation is starting/);
  assert.match(implDoc, /Create or reuse an in-progress Implementation Record/);
});
```

- [ ] **Step 2: implementation-flow integration fixture に mock impl-doc skill を追加する**

`scripts/doc-driven-dev/tests/skills/skill-discovery-protocol/integration.test.ts` の `MOCK_SKILLS` に次の entry を追加する:

```ts
  "mock-impl-doc": `---
name: mock-impl-doc
description: "Implementation record and experiment log documentation"
version: "1.0.0"
---

# Mock Impl Doc

A mock skill for implementation records and experiment logs.
`,
```

- [ ] **Step 3: mock impl-doc skill の inference metadata を追加する**

`MOCK_INFERENCE_SKILLS` に次の object を追加する:

```ts
  {
    name: "mock-impl-doc",
    review_status: "reviewed",
    provides: [
      {
        capability: "implementation_documentation",
        description: "Create and maintain Implementation Records and Experiment Logs",
      },
    ],
    uses: [],
    execution_policy: {
      strictness: "rigid",
      sequence_required: true,
      allow_step_reordering: false,
      allow_partial_application: false,
      guidance: "Open implementation documentation before code changes",
    },
    tags: ["documentation", "impl-doc"],
  },
```

- [ ] **Step 4: test implementation adapter fixture に documentation slot を追加する**

`IMPLEMENTATION_ADAPTER` YAML string で、`build_structure` の後、`review_gate` の前に次の slot を追加する:

```yaml
    - slot_id: "implementation_documentation"
      slot_type: "layerable"
      activation: "always"
      default:
        - skill: "mock-impl-doc"
          reason: "Implementation documentation must be opened before task execution"
```

さらに `build` category の後に次の taxonomy entry を追加する:

```yaml
    - id: "documentation"
      label: "Documentation"
      description: "Skills that record implementation progress and evidence"
      match:
        capabilities: ["implementation_documentation"]
        tags: ["documentation", "impl-doc"]
        description_patterns: ["implementation record", "experiment log", "docs/impl"]
```

- [ ] **Step 5: generated profile の integration assertion を更新する**

test `"integration: impl-flow adapter generates valid profile"` で slot count を更新し、新 slot の直接 assertion を追加する:

```ts
  assert.ok(profile.flow_stack.slots.length >= 4);
  const documentationSlot = profile.flow_stack.slots.find(
    (slot: { slot_id: string }) => slot.slot_id === "implementation_documentation",
  );
  assert.ok(documentationSlot, "implementation documentation slot should exist");
  assert.deepEqual(documentationSlot.default, [
    {
      skill: "mock-impl-doc",
      reason: "Implementation documentation must be opened before task execution",
    },
  ]);
```

既存の `build_structure` assertion は維持する。ただし固定 index ではなく `slot_id` で探す:

```ts
  const buildSlot = profile.flow_stack.slots.find(
    (slot: { slot_id: string }) => slot.slot_id === "build_structure",
  );
  assert.ok(buildSlot, "build structure slot should exist");
  assert.deepEqual(buildSlot.default, [
    { skill: "mock-impl-skill", reason: "All implementation uses incremental delivery" },
    { skill: "mock-review-skill", reason: "Implementation should remain reviewable" },
  ]);
```

- [ ] **Step 6: test を実行し、期待理由で失敗することを確認する**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-suite.test.ts tests/skills/skill-discovery-protocol/integration.test.ts
```

Expected: 新しい Phase C0 と adapter 文言がまだ存在しないため、`doc-suite.test.ts` が失敗する。profile fixture 更新が完了するまでは integration test も失敗してよい。

---

## Task 2: implementation-flow contract と profile を更新する

**Files:**

- Modify: `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`
- Modify: `packages/doc-driven-dev/.apm/skills/implementation-flow/assets/templates/implementation-profile-template.md`
- Modify: `packages/doc-driven-dev/.apm/skills/implementation-flow/assets/templates/implementation-profile-template.ja.md`

- [ ] **Step 1: 英語版 implementation-flow phase overview に Phase C0 を追加する**

`packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md` の flow overview を次のように変更する:

```text
Phase A: Assess  ->  Phase B: Configure  ->  Phase C0: Open Implementation Documentation  ->  Phase C: Execute  ->  Phase D: Verify  ->  Phase E: Review
```

phase table では Configure の後に次の row を追加する:

```markdown
| C0. Open Implementation Documentation | Create or locate in-flight `impl-doc` records before code changes | `in-progress` Implementation Record, plus Experiment Log when needed |
```

- [ ] **Step 2: 英語版 Phase C0 section を追加する**

Phase B と Phase C の間に次の section を追加する:

```markdown
## Phase C0: Open Implementation Documentation

Before the first code change for each task, open implementation documentation
through `impl-doc`.

1. Read the `impl-doc` SKILL and `references/impl-conventions.md`.
2. Create or reuse an `in-progress` Implementation Record for the task:

```bash
node scripts/new_impl_record.js --title "Implement task title" --task docs/tasks/0003-implement-task.md --status "in-progress"
```

3. If Phase A classified the approach as uncertain or exploratory, create an
   Experiment Log before exploration begins:

```bash
node scripts/new_experiment_log.js --title "Try implementation approach" --task docs/tasks/0003-implement-task.md
```

4. Record the chosen IR and optional exp path in the task working notes before
   Phase C begins.

The Implementation Record is opened before code changes begin, updated as the
task proceeds, and completed only after Phase D/E verification and review
evidence are known.
```

- [ ] **Step 3: 英語版 Phase C/D/completion wording を締める**

Phase C では、探索時だけに見える既存の `impl-doc` bullet を次に置き換える:

```markdown
4. Keep `impl-doc` current while implementing:
   - Update the in-progress Implementation Record when implementation-time
     decisions, validation evidence, risks, or follow-ups become known.
   - If the approach is exploratory, append hypotheses, observations, errors,
     validations, decisions, and summaries to the Experiment Log as they happen.
```

Phase D には次を追加する:

```markdown
4. Add verification evidence to the task's Implementation Record before moving
   to review or the next task.
```

Completion Conditions では、既存の Implementation Record bullet を次に置き換える:

```markdown
- An Implementation Record (`impl-doc` ir) was opened before code changes for
  each task unit, updated during implementation, completed before task closure,
  and audited alongside any Experiment Logs created during implementation.
```

- [ ] **Step 4: documentation timing の hard gate を追加する**

既存 evidence gate の後に次の hard gate を追加する:

```markdown
<HARD-GATE>
Do not start code changes for a task until Phase C0 has opened the task's
implementation documentation. A clear task with a known solution still needs an
`in-progress` Implementation Record. Only the Experiment Log is optional.
</HARD-GATE>
```

- [ ] **Step 5: 同じ構造を日本語版へ反映する**

`SKILL.ja.md` に同じ構造変更を入れる。test が検証できるよう、次の anchor phrase を含める:

```markdown
Phase C0: Implementation Documentation を開く
```

```markdown
各 task の最初のコード変更前に、`impl-doc` を通じて実装記録を開く。
```

```markdown
node scripts/new_impl_record.js --title "Implement task title" --task docs/tasks/0003-implement-task.md --status "in-progress"
```

```markdown
明確な既知解の task でも `in-progress` の Implementation Record は必須であり、任意なのは Experiment Log だけである。
```

- [ ] **Step 6: 実 adapter に implementation documentation slot を追加する**

`implementation-adapter.yaml` で、`build_structure` の後に次の slot を追加する:

```yaml
    - slot_id: "implementation_documentation"
      slot_type: "layerable"
      activation: "always"
      default:
        - skill: "impl-doc"
          reason: "Open and maintain implementation documentation before and during each task"
```

`build` の後に次の taxonomy entry を追加する:

```yaml
    - id: "documentation"
      label: "Documentation"
      description: "Skills that record implementation progress, decisions, and evidence"
      match:
        capabilities: ["implementation_documentation"]
        tags: ["documentation", "impl-doc"]
        description_patterns: ["impl-doc", "implementation record", "experiment log", "docs/impl"]
```

- [ ] **Step 7: 英語版 implementation profile template を更新する**

`implementation-profile-template.md` の Available Skills に次の row を追加する:

```markdown
| <!-- e.g., impl-doc --> | Documentation | .apm/skills/ | always | rigid | Open Implementation Record before task execution |
```

Build の後に新しい category section を追加する:

```markdown
### Documentation

Skills that record implementation progress, decisions, experiments, validation,
risks, and follow-ups while the task is running.

- <!-- e.g., impl-doc - Implementation Records and Experiment Logs -->
```

Default Stack table では Verify の前に Documentation を追加する:

```markdown
| 2 | Documentation | <!-- repository default --> | Opens in-flight implementation records before code changes |
| 3 | Verify | <!-- repository default --> | Adds correctness validation when available |
| 4 | Review | <!-- repository default --> | Applies a completion gate when available |
```

- [ ] **Step 8: 日本語版 implementation profile template を更新する**

`implementation-profile-template.ja.md` に英語版と同じ構造を反映し、次の phrase を含める:

```markdown
| <!-- 例: impl-doc --> | Documentation | .apm/skills/ | always | rigid | task 実行前に Implementation Record を開く |
```

```markdown
### Documentation

task の実行中に、実装の進捗、判断、実験、検証、リスク、フォローアップを記録する skill。
```

---

## Task 3: lifecycle Phase 5 contract を更新する

**Files:**

- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.ja.md`

- [ ] **Step 1: 英語版 lifecycle Phase 5 entry instructions を更新する**

`SKILL.md` で、既存の mandatory `implementation-flow` read instructions の下に `impl-doc` を追加する:

```markdown
**MANDATORY**: Before the first code change for each task in Phase 5, read
[`impl-doc` SKILL](../impl-doc/SKILL.md) and
[`impl-doc` conventions](../impl-doc/references/impl-conventions.md). Phase 5
does not begin task execution until the task has an `in-progress`
Implementation Record.
```

Phase 5 completion criteria には次を追加する:

```markdown
- Every task opened an `in-progress` Implementation Record before code changes,
  kept it current during implementation, and completed/audited it before task
  closure.
- Any Experiment Log created during implementation is referenced by the matching
  Implementation Record and audited before Phase 6.
```

- [ ] **Step 2: 日本語版 lifecycle Phase 5 entry instructions を更新する**

`SKILL.ja.md` には対応する日本語文を追加する:

```markdown
**MANDATORY**: Phase 5 の各 task で最初のコード変更前に
[`impl-doc` SKILL](../impl-doc/SKILL.ja.md) と
[`impl-doc` 規約](../impl-doc/references/impl-conventions.ja.md) を読むこと。
task に `in-progress` の Implementation Record がない状態では、Phase 5 の
task 実行を開始しない。
```

同じ completion requirements を日本語で追加する:

```markdown
- すべての task はコード変更前に `in-progress` の Implementation Record を開き、
  実装中に更新し、task クローズ前に完了・監査している。
- 実装中に作成した Experiment Log は対応する Implementation Record から参照され、
  Phase 6 の前に監査されている。
```

- [ ] **Step 3: 英語版 flow-contract Phase 5 steps を更新する**

`flow-contract.md` の Phase 5 steps を次に置き換える:

```markdown
- 5-1 Open implementation documentation: for each task, use `impl-doc` to create
  or reuse an `in-progress` Implementation Record before code changes begin.
- 5-2 Invoke `implementation-flow`: delegate per-task execution, skill discovery,
  configuration, in-flight documentation, and verification.
- 5-3 Constraint Feedback: if `implementation-flow` reports upstream gaps, update
  `adr-doc` / `design-doc` and record loopback.
- 5-4 Completion Check: confirm all tasks pass verification and have completed,
  audited Implementation Records.
```

Implementation Completion Criteria は次のように更新する:

```markdown
- `implementation-flow` reports all tasks implemented and verified.
- Each task has an audited Implementation Record that was opened before code
  changes and completed before task closure.
- New constraints discovered are reflected in upstream documents.
- Code review is complete.
```

- [ ] **Step 4: 日本語版 flow-contract Phase 5 steps を更新する**

`flow-contract.ja.md` には英語版と同じ契約を次のように反映する:

```markdown
- 5-1 implementation documentation を開く: 各 task でコード変更を始める前に、
  `impl-doc` で `in-progress` の Implementation Record を作成または再利用する。
- 5-2 `implementation-flow` 呼び出し: task 単位の実行、スキル発見、構成、
  実装中の記録、検証を委譲する。
- 5-3 制約フィードバック: `implementation-flow` が上流の不足を報告した場合、
  `adr-doc` / `design-doc` を更新しループバックを記録する。
- 5-4 完了確認: 全 task の検証通過と、完了・監査済み Implementation Record を確認する。
```

---

## Task 4: impl-doc の timing と conventions を更新する

**Files:**

- Modify: `packages/doc-driven-dev/.apm/skills/impl-doc/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/impl-doc/SKILL.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/impl-doc/references/impl-conventions.md`
- Modify: `packages/doc-driven-dev/.apm/skills/impl-doc/references/impl-conventions.ja.md`

- [ ] **Step 1: 英語版 "When to Create What" table を更新する**

`impl-doc/SKILL.md` の table rows を次に置き換える:

```markdown
| Situation | Create | Timing |
|-----------|--------|--------|
| Task implementation is starting | Implementation Record | Before the first code change; use `--status "in-progress"` |
| Task approach is uncertain - exploring options or testing hypotheses | Experiment Log | Before or at the start of exploration |
| Task approach is clear - executing a known plan | Implementation Record only | Before the first code change; skip exp |
| Task is complete and ready to close | Update existing Implementation Record | Before closing the task; set status to `completed` and audit |
| Multiple approaches were tested | One Experiment Log per approach | During investigation |
```

- [ ] **Step 2: in-progress record 用の英語版 workflow text を追加する**

"Creating an Implementation Record" の前に次の paragraph を追加する:

```markdown
For Phase 5 execution, create or reuse an in-progress Implementation Record at
task start. The record body is normal Markdown and should be updated as
implementation decisions, validation evidence, risks, and follow-ups become
known. Experiment Log JSONL files are different: update them only through
`append_experiment_event` or `edit_experiment_log`.
```

creation example は次に変更する:

```bash
node scripts/new_impl_record.js --title "Extract foo service" --task docs/tasks/0003-implement-foo-service.md --status "in-progress"
```

- [ ] **Step 3: 英語版 NEVER rules を締める**

post-hoc IR rule を次に置き換える:

```markdown
- NEVER start task implementation without an in-progress ir - the record must
  exist early enough to capture decisions made during implementation, not a
  post-hoc narrative.
```

さらに次を追加する:

```markdown
- NEVER treat a clear mechanical task as exempt from ir creation - only exp is
  optional for known-solution tasks.
```

- [ ] **Step 4: record updates 用の英語版 conventions を更新する**

`impl-conventions.md` では Status Values の後に次の subsection を追加する:

```markdown
## Updating Implementation Records During Phase 5

Implementation Records are Markdown documents. The CLI creates the initial
record and audits final shape; the record body may be edited during
implementation to keep these sections current:

- `## Implementation`
- `## Related Experiments`
- `## Validation`
- `## Risks`
- `## Follow-ups`

Use `status: "in-progress"` while the task is being implemented. Change the
status to `completed` only after task verification and review evidence have
been recorded. If the task is paused because of an upstream gap, use
`status: "blocked"` and record the loopback target in `## Follow-ups`.
```

- [ ] **Step 5: impl-doc changes を日本語版へ反映する**

`SKILL.ja.md` と `impl-conventions.ja.md` へ英語版と同じ意味を反映する。次の phrase を含める:

```markdown
task 実装を開始する
```

```markdown
最初のコード変更前
```

```markdown
`--status "in-progress"`
```

```markdown
Implementation Record は Markdown 文書であり、CLI は初期作成と監査を担当する。
```

```markdown
Experiment Log の JSONL は `append_experiment_event` または `edit_experiment_log` だけで更新する。
```

---

## Task 5: README overview を更新し検証する

**Files:**

- Modify: `packages/doc-driven-dev/README.md`
- Modify: `packages/doc-driven-dev/README.ja.md`

- [ ] **Step 1: 英語版 README Phase 5 explanation を更新する**

`README.md` の lifecycle diagram explanation 付近に次を追加する:

```markdown
- **Phase 5 implementation documentation**: `implementation-flow` and `impl-doc`
  run together. Each task opens an `in-progress` Implementation Record before
  code changes, appends Experiment Log events when exploration is needed, and
  completes/audits the record before task closure.
```

`impl-doc` section には次を追加する:

```markdown
During `doc-driven-dev-lifecycle` Phase 5, `impl-doc` is used at task start,
not only after implementation. A known-solution task still creates an
`in-progress` Implementation Record; only the Experiment Log is optional.
```

- [ ] **Step 2: 日本語版 README Phase 5 explanation を更新する**

`README.ja.md` には同じ意味を追加する:

```markdown
- **Phase 5 の実装記録**: `implementation-flow` と `impl-doc` は並行して動く。
  各 task はコード変更前に `in-progress` の Implementation Record を開き、
  探索が必要な場合は Experiment Log にイベントを追記し、task クローズ前に
  record を完了・監査する。
```

`impl-doc` section には次を追加する:

```markdown
`doc-driven-dev-lifecycle` の Phase 5 では、`impl-doc` は実装後だけでなく
task 開始時に使う。既知解の task でも `in-progress` の Implementation Record は
作成し、任意なのは Experiment Log だけである。
```

- [ ] **Step 3: focused tests を実行する**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-suite.test.ts tests/impl-doc.test.ts tests/skills/skill-discovery-protocol/integration.test.ts
```

Expected: exit code `0`; 3 つの suite がすべて pass する。

- [ ] **Step 4: touched docs の markdown lint を実行する**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev run lint:md
```

Expected: exit code `0`。touched hunk 外の既存 markdownlint finding が出た場合は、最終実装メモに正確な output を記録し、この変更で導入した finding は必ず修正する。

- [ ] **Step 5: whitespace check を実行する**

Run:

```powershell
git diff --check
```

Expected: trailing whitespace や whitespace error output がない。

- [ ] **Step 6: changed files に無関係な drift がないか確認する**

Run:

```powershell
git diff -- packages/doc-driven-dev/.apm/skills/implementation-flow packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle packages/doc-driven-dev/.apm/skills/impl-doc packages/doc-driven-dev/README.md packages/doc-driven-dev/README.ja.md scripts/doc-driven-dev/tests
```

Expected: diff は Phase 5 の `impl-doc` timing contract、adapter/profile documentation slot、README explanation、regression tests だけを変更している。

---

## Self-Review Checklist

- [ ] 挙動契約を変える task は、実装 step の前に failing test を持っている。
- [ ] `implementation-flow` は全 task 完了後ではなく、コード変更前に `impl-doc` を要求している。
- [ ] `doc-driven-dev-lifecycle` Phase 5 entry/completion criteria が in-progress IR と exp audit に触れている。
- [ ] `impl-doc` は既知解 task でも IR 作成が必須で、任意なのは exp だけだと説明している。
- [ ] 英語版と日本語版の section structure と意味が一致している。
- [ ] IR 更新用の新 CLI を暗示していない。Markdown IR body の更新は明示的に許可し、JSONL exp updates は CLI-only のままにしている。
- [ ] 既存の無関係な worktree changes は触っていない。

---

## Execution Notes

この plan を後で実装する場合、commit scope は狭く保つ。ユーザーが明示的に同梱を求めない限り、既存の `apm.lock.yaml` 変更や無関係な `2026-06-21-doc-driven-dev-lifecycle-follow-up-gate.md` は含めない。
