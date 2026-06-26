# Implementation Flow Capability Slots Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) superpowers:executing-plans implement plan task-by-task. Steps use checkbox (`- [ ]`) syntax tracking.

**Goal:** Add explicit `implementation-flow` capability slots for subagent usage and cost reduction without turning `skill-discovery-protocol` into a live runtime router.

**Architecture:** Reuse the existing adapter `flow_stack.slots` contract: add two conditional layerable slots to the `implementation-flow` adapter, document how Phase A/B should evaluate them, and expose them in the profile templates. Keep `runtime_guidance` as soft ranking guidance layered over `execution_policy`; do not make cost routing or subagent dispatch a hard gate.

**Tech Stack:** Markdown skill definitions, YAML adapter config, `js-yaml`, Node test runner through `tsx`, TypeScript source tests under `scripts/doc-driven-dev`.

---

## File Structure

- Modify `packages/doc-driven-dev/.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`
  - Add `subagent_utilization` and `cost_optimization` slots under `flow_stack.slots`.
  - Extend classification taxonomy with capability vocabulary for subagent dispatch and cost-aware routing.
- Modify `packages/doc-driven-dev/.apm/skills/implementation-flow/assets/templates/implementation-profile-template.md`
  - Add English template rows so generated/refreshed profiles can display the new capability slots.
- Modify `packages/doc-driven-dev/.apm/skills/implementation-flow/assets/templates/implementation-profile-template.ja.md`
  - Add Japanese template rows matching the English profile structure.
- Modify `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md`
  - Update Phase A/B instructions so implementers evaluate and announce these capability slots.
- Modify `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.ja.md`
  - Keep the Japanese skill contract synchronized with the English one.
- Create `scripts/doc-driven-dev/tests/skills/implementation-flow-adapter-contract.test.ts`
  - Parse the real implementation adapter and assert the two slots and taxonomy capability terms are present.

No TypeScript runtime change is expected unless the test proves existing `AdapterConfigSchema` rejects the new adapter fields. Existing schema already supports conditional layerable slots.

---

### Task 1: Pin the Adapter Contract With a Failing Test

**Files:**

- Create: `scripts/doc-driven-dev/tests/skills/implementation-flow-adapter-contract.test.ts`
- Test: `scripts/doc-driven-dev/tests/skills/implementation-flow-adapter-contract.test.ts`

- [ ] **Step 1: Write failing test**

Create `scripts/doc-driven-dev/tests/skills/implementation-flow-adapter-contract.test.ts`:

```ts
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");

const adapterPath = path.resolve(
  __dirname,
  "../../../../../packages/doc-driven-dev/.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml",
);

function loadAdapter() {
  return yaml.load(fs.readFileSync(adapterPath, "utf8"));
}

test("implementation-flow adapter declares subagent and cost capability slots", () => {
  const adapter = loadAdapter();
  const slots = adapter.flow_stack.slots;

  const subagentSlot = slots.find((slot: { slot_id: string }) => slot.slot_id === "subagent_utilization");
  assert.deepEqual(subagentSlot, {
    slot_id: "subagent_utilization",
    slot_type: "layerable",
    activation: "conditional",
  });

  const costSlot = slots.find((slot: { slot_id: string }) => slot.slot_id === "cost_optimization");
  assert.deepEqual(costSlot, {
    slot_id: "cost_optimization",
    slot_type: "layerable",
    activation: "conditional",
  });
});

test("implementation-flow taxonomy exposes subagent and cost capability vocabulary", () => {
  const adapter = loadAdapter();
  const taxonomy = adapter.classification.taxonomy;

  const build = taxonomy.find((entry: { id: string }) => entry.id === "build");
  assert.ok(build, "build taxonomy entry should exist");
  assert.ok(
    build.match.capabilities.includes("subagent_dispatch"),
    "build taxonomy should classify subagent dispatch capability",
  );
  assert.ok(
    build.match.tags.includes("subagent"),
    "build taxonomy should classify subagent tags",
  );

  const tooling = taxonomy.find((entry: { id: string }) => entry.id === "tooling");
  assert.ok(tooling, "tooling taxonomy entry should exist");
  assert.ok(
    tooling.match.capabilities.includes("cost_optimization"),
    "tooling taxonomy should classify cost optimization capability",
  );
  assert.ok(
    tooling.match.tags.includes("cost"),
    "tooling taxonomy should classify cost tags",
  );
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev exec tsx --test tests/skills/implementation-flow-adapter-contract.test.ts
```

Expected: FAIL because `subagent_utilization`, `cost_optimization`, `subagent_dispatch`, and `cost_optimization` are not yet in `implementation-adapter.yaml`.

- [ ] **Step 3: Commit test checkpoint**

Do not commit yet if the repository policy requires green commits only. If checkpoint commits are allowed in this branch, use:

```powershell
git add scripts/doc-driven-dev/tests/skills/implementation-flow-adapter-contract.test.ts
git commit -m "test: pin implementation-flow capability slots"
```

---

### Task 2: Add Capability Slots to the Implementation Adapter

**Files:**

- Modify: `packages/doc-driven-dev/.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`
- Test: `scripts/doc-driven-dev/tests/skills/implementation-flow-adapter-contract.test.ts`

- [ ] **Step 1: Update `flow_stack.slots`**

In `packages/doc-driven-dev/.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`, add these slots after `build_structure` and before `implementation_documentation`:

```yaml
  - slot_id: "subagent_utilization"
    slot_type: "layerable"
    activation: "conditional"
  - slot_id: "cost_optimization"
    slot_type: "layerable"
    activation: "conditional"
```

The resulting slot order should be:

```yaml
flow_stack:
  slots:
  - slot_id: "process_diagnosis"
    slot_type: "exclusive"
    activation: "conditional"
  - slot_id: "build_structure"
    slot_type: "layerable"
    activation: "always"
  - slot_id: "subagent_utilization"
    slot_type: "layerable"
    activation: "conditional"
  - slot_id: "cost_optimization"
    slot_type: "layerable"
    activation: "conditional"
  - slot_id: "implementation_documentation"
    slot_type: "layerable"
    activation: "always"
    default:
    - skill: "impl-doc"
      reason: "Open implementation documentation before code changes begin"
  - slot_id: "verification"
    slot_type: "layerable"
    activation: "conditional"
  - slot_id: "review_gate"
    slot_type: "exclusive"
    activation: "always"
```

- [ ] **Step 2: Extend taxonomy vocabulary**

In the existing `build` taxonomy entry, include subagent vocabulary:

```yaml
    match:
      capabilities: ["incremental_implementation", "parallel_dispatch", "subagent_dispatch", "test_led_development"]
      tags: ["build", "implementation", "tdd", "parallel", "subagent"]
      description_patterns: ["implement", "incremental", "parallel", "subagent", "delegat", "test-driven"]
```

In the existing `tooling` taxonomy entry, include cost optimization vocabulary:

```yaml
    match:
      capabilities: ["git_operations", "ci_automation", "cost_optimization", "model_cost_control"]
      tags: ["tooling", "git", "ci", "cost", "model-selection"]
      description_patterns: ["git", "commit", "ci", "workflow", "cost", "cheap", "low-cost", "model"]
```

If the exact existing arrays contain additional entries, preserve them and append only the new terms above.

- [ ] **Step 3: Run focused adapter contract test**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev exec tsx --test tests/skills/implementation-flow-adapter-contract.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run existing SDP profile tests**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev exec tsx --test tests/skills/skill-discovery-protocol/generate.test.ts
```

Expected: PASS. This confirms generic `flow_stack.slots` profile generation still accepts adapter-declared slots.

- [ ] **Step 5: Commit adapter checkpoint**

```powershell
git add packages/doc-driven-dev/.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml scripts/doc-driven-dev/tests/skills/implementation-flow-adapter-contract.test.ts
git commit -m "feat: add implementation-flow capability slots"
```

---

### Task 3: Document Slot Evaluation in Implementation Flow

**Files:**

- Modify: `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.ja.md`
- Test: `pnpm --dir scripts/doc-driven-dev run lint:md`

- [ ] **Step 1: Update English Phase A classification**

In `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md`, extend the Phase A classification questions:

```markdown
- Can subtasks run in parallel or be delegated to fresh subagents with isolated context?
- Is any task simple, mechanical, low-risk, and suitable for a lower-cost execution path when the current harness exposes one?
```

Update the “Task Characteristics -> Skill Activation Mapping” table with these rows:

```markdown
| Can be broken into independent subtasks | Subagent/parallel dispatch skills | Build |
| Is simple, mechanical, low-risk work | Cost-optimization guidance skills | Tooling |
```

- [ ] **Step 2: Update English Phase B configuration**

In `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md`, add capability-slot checks after the existing runtime guidance check:

```markdown
5. **Evaluate capability slots**:
   - `subagent_utilization`: activate when independent subtasks can run with isolated context and clear acceptance checks.
   - `cost_optimization`: activate when the task is simple, mechanical, low-risk, and a lower-cost model or delegation path can still use the required tools.
   - Treat both as routing guidance. They do not override user instructions, hard gates, required tools, or verification evidence.
```

Renumber the following Phase B steps so conflict resolution remains after capability-slot evaluation.

Update the active stack announcement example to include capability slots:

```text
ACTIVE SKILL STACK FOR TASK:
1. [Category] skill-name - reason
2. [Capability Slot] subagent_utilization - reason or "not active"
3. [Capability Slot] cost_optimization - reason or "not active"
4. [Category] skill-name - reason
-> Proceeding configuration.
```

- [ ] **Step 3: Update Japanese Phase A/B with matching structure**

In `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.ja.md`, add matching Phase A questions:

```markdown
- サブタスクを、独立したコンテキストを持つ新規サブエージェントへ委譲または並列実行できるか？
- タスクが単純・機械的・低リスクで、現在のハーネスが提供する低コスト実行経路に載せても必要ツールを使えるか？
```

Add matching mapping rows:

```markdown
| 独立したサブタスクに分解できる | サブエージェント / 並列 dispatch スキル | Build |
| 単純・機械的・低リスクの作業 | コスト最適化 guidance スキル | Tooling |
```

Add matching Phase B slot evaluation:

```markdown
5. **能力スロットを評価**:
   - `subagent_utilization`: 独立したサブタスクを、明確な受け入れ条件付きで隔離コンテキストへ委譲できる場合に活性化する。
   - `cost_optimization`: タスクが単純・機械的・低リスクで、低コストモデルまたは低コスト委譲経路でも必要ツールを使える場合に活性化する。
   - どちらも routing guidance として扱う。ユーザー指示、hard gate、必須ツール、検証エビデンスを上書きしない。
```

Renumber subsequent steps.

- [ ] **Step 4: Run Markdown lint**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev run lint:md
```

Expected: PASS for `implementation-flow/SKILL.md` and `implementation-flow/SKILL.ja.md`.

- [ ] **Step 5: Commit documentation checkpoint**

```powershell
git add packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.ja.md
git commit -m "docs: describe implementation-flow capability slots"
```

---

### Task 4: Expose Slots in Profile Templates

**Files:**

- Modify: `packages/doc-driven-dev/.apm/skills/implementation-flow/assets/templates/implementation-profile-template.md`
- Modify: `packages/doc-driven-dev/.apm/skills/implementation-flow/assets/templates/implementation-profile-template.ja.md`
- Test: `pnpm --dir scripts/doc-driven-dev run lint:md`

- [ ] **Step 1: Update English profile template**

In `packages/doc-driven-dev/.apm/skills/implementation-flow/assets/templates/implementation-profile-template.md`, add rows to the skills table:

```markdown
| conditional | Build | Independent subtasks can be delegated to isolated subagents | flexible | <!-- e.g., subagent-driven-development --> | .apm/skills/ |
| conditional | Tooling | Simple low-risk work can use a lower-cost execution path with required tools preserved | flexible | <!-- e.g., cheap-action --> | .apm/skills/ |
```

Add rows to the priority/rationale table:

```markdown
| Subagent utilization | Build | 3 | <!-- repository default --> | Fans out independent subtasks when acceptance checks are clear |
| Cost optimization | Tooling | 5 | <!-- repository default --> | Routes low-risk mechanical work to lower-cost execution when supported |
```

Add rows to the overrides table:

```markdown
| Add: matching subagent-capable Build skills | Independent subtasks with isolated acceptance checks | Use fresh context for parallel work |
| Add: matching cost-optimization Tooling skills | Simple, mechanical, low-risk task | Reduce cost without weakening required tools or verification |
```

If the template is CSV-like rather than a Markdown table in the file, preserve the existing format and add equivalent rows with the same column order.

- [ ] **Step 2: Update Japanese profile template**

In `packages/doc-driven-dev/.apm/skills/implementation-flow/assets/templates/implementation-profile-template.ja.md`, add equivalent rows:

```markdown
| conditional | Build | 独立サブタスクを隔離コンテキストのサブエージェントへ委譲できる場合 | flexible | <!-- 例: subagent-driven-development --> | .apm/skills/ |
| conditional | Tooling | 単純で低リスクの作業を、必要ツールを維持したまま低コスト実行経路に載せられる場合 | flexible | <!-- 例: cheap-action --> | .apm/skills/ |
```

```markdown
| サブエージェント利用 | Build | 3 | <!-- repository default --> | 受け入れ条件が明確な独立サブタスクを分散する |
| コスト最適化 | Tooling | 5 | <!-- repository default --> | 対応環境では低リスクな機械的作業を低コスト実行に寄せる |
```

```markdown
| Add: 条件に合うサブエージェント対応 Build スキル | 隔離された受け入れ条件を持つ独立サブタスク | fresh context で並列作業する |
| Add: 条件に合うコスト最適化 Tooling スキル | 単純・機械的・低リスクの task | 必須ツールと検証を弱めずにコストを削減する |
```

If the template is CSV-like rather than a Markdown table in the file, preserve the existing format and add equivalent Japanese rows with the same column order.

- [ ] **Step 3: Run Markdown lint**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev run lint:md
```

Expected: PASS.

- [ ] **Step 4: Commit template checkpoint**

```powershell
git add packages/doc-driven-dev/.apm/skills/implementation-flow/assets/templates/implementation-profile-template.md packages/doc-driven-dev/.apm/skills/implementation-flow/assets/templates/implementation-profile-template.ja.md
git commit -m "docs: expose implementation-flow slot templates"
```

---

### Task 5: Verify Package-Level Regression Signal

**Files:**

- Test: `scripts/doc-driven-dev/tests/skills/implementation-flow-adapter-contract.test.ts`
- Test: `scripts/doc-driven-dev/tests/skills/skill-discovery-protocol/generate.test.ts`
- Test: `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md`
- Test: `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.ja.md`

- [ ] **Step 1: Run focused tests**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev exec tsx --test tests/skills/implementation-flow-adapter-contract.test.ts tests/skills/skill-discovery-protocol/generate.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full doc-driven-dev tests**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev test
```

Expected: PASS.

- [ ] **Step 3: Run Markdown lint**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev run lint:md
```

Expected: PASS.

- [ ] **Step 4: Optional compile dry-run from package directory**

Run only if local `apm` is available:

```powershell
Push-Location packages/doc-driven-dev
apm compile --dry-run
Pop-Location
```

Expected: PASS or known package housekeeping warning only. If `.apm` instruction discovery fails, record the failure and keep `pnpm --dir scripts/doc-driven-dev test` as the primary regression signal.

- [ ] **Step 5: Final commit**

If previous checkpoint commits were skipped, commit the full change:

```powershell
git add packages/doc-driven-dev/.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml packages/doc-driven-dev/.apm/skills/implementation-flow/assets/templates/implementation-profile-template.md packages/doc-driven-dev/.apm/skills/implementation-flow/assets/templates/implementation-profile-template.ja.md packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.ja.md scripts/doc-driven-dev/tests/skills/implementation-flow-adapter-contract.test.ts
git commit -m "feat: add implementation-flow capability slots"
```

---

## Self-Review

- Spec coverage: The plan covers subagent usage through `subagent_utilization`, cost reduction through `cost_optimization`, and keeps both as capability slots rather than hard runtime routing.
- Placeholder scan: No forbidden placeholder language remains. Each task includes file paths, snippets, commands, and expected results.
- Type consistency: Slot IDs are snake_case and match `AdapterSlotSchema`; both slots are `layerable` and `conditional`, which existing schema accepts.
- Localization: English and Japanese `SKILL` files and profile templates are updated together with matching structure.
- Regression strategy: Focused adapter contract test, existing SDP profile test, full doc-driven-dev test suite, and Markdown lint are included.
