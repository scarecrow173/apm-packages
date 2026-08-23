# Resumable Active Task Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resume one or more dependency-ready `in-progress` tasks from the `task-graph` node through one declared implementation edge while preserving deterministic task data and fail-closed routing.

**Architecture:** Extend the public Task Graph projection with a sorted `resumableActive` field derived from task status and predecessor completion. Extend the generic task-graph condition DSL with `state: active`, bind `tasks-active` to a higher-priority implementation edge than `tasks-runnable`, and continue passing the complete Task Graph—including sorted `active`, `resumableActive`, and dependency edges—to `implementation-flow`.

**Tech Stack:** TypeScript 5.6, Node.js test runner, Zod 4, js-yaml, esbuild, pnpm 11.

## Global Constraints

- Keep `active` as every `in-progress` task in stable ID order; do not redefine it as only dependency-ready tasks.
- Define `resumableActive` as `in-progress` tasks whose every predecessor is `done`, in stable ID order.
- When `taskGraph.issues` is non-empty, `resumableActive` must be empty and active re-entry must fail closed.
- Downstream dependency waits and unrelated tasks with `status: blocked` must not suppress an otherwise resumable active task.
- When active and runnable tasks coexist, the active implementation edge must win.
- Multiple resumable active tasks still produce exactly one route edge; `implementation-flow` receives the complete sorted Task Graph and uses dependency edges to sequence or parallelize work.
- An active task with an unresolved predecessor remains in `active` but not in `resumableActive`.
- `idle` must not match while any active task exists, including an active task that is not resumable.
- Keep the unknown-state `no-matching-edge` fallback fail-closed.
- Keep English and Japanese documentation synchronized in meaning and structure.
- Preserve unrelated user changes in `.codex/config.toml` and `.serena/`.

---

## File Map

- `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/task_graph.ts`: owns Task Graph projection and the new public `resumableActive` field.
- `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/graph_definition.ts`: owns the accepted task-graph condition vocabulary.
- `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/graph_conditions.ts`: evaluates `active`, `runnable`, `invalid`, and `idle` conditions.
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml`: declares `tasks-active` and its one-edge route to implementation.
- `scripts/doc-driven-dev/tests/doc-driven-dev-graph-task-graph.test.ts`: verifies projection semantics.
- `scripts/doc-driven-dev/tests/doc-driven-dev-graph-router.test.ts`: verifies generic condition semantics.
- `scripts/doc-driven-dev/tests/doc-driven-dev-graph-definition.test.ts`: verifies parser support for `state: active`.
- `scripts/doc-driven-dev/tests/doc-driven-dev-graph-definition-contract.test.ts`: verifies the distributed edge declaration.
- `scripts/doc-driven-dev/tests/doc-driven-dev-graph-routing-contract.test.ts`: verifies source-level route behavior with real artifact fixtures.
- `scripts/doc-driven-dev/tests/doc-driven-dev-graph-cli.test.ts`: verifies source and generated CLI behavior.
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/SKILL.md` and `SKILL.ja.md`: document the condition and re-entry behavior.
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/references/task-graph-contract.md` and `task-graph-contract.ja.md`: define `active`, `resumableActive`, dependency readiness, and delegate behavior.
- `packages/doc-driven-dev/README.md`, `README.ja.md`, `AGENTS.md`, and `AGENTS.ja.md`: keep public predicate summaries synchronized.
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/*.js`: generated distributable bundles refreshed by the existing build.

### Task 1: Project Dependency-Ready Active Tasks

**Files:**

- Modify: `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/task_graph.ts`
- Test: `scripts/doc-driven-dev/tests/doc-driven-dev-graph-task-graph.test.ts`

**Interfaces:**

- Consumes: `TaskGraphNode.status`, normalized `TaskGraphEdge[]`, and `TaskGraphIssue[]` produced by `summarizeTaskGraph()`.
- Produces: `TaskGraphResult.resumableActive: string[]`, sorted by task ID and empty whenever structural issues exist.

- [ ] **Step 1: Write projection tests that distinguish active from resumable active**

Add these tests after the existing dependency-unlock test:

```ts
test("buildTaskGraph projects dependency-ready active tasks without treating downstream waits as blockers", () => {
  const result = buildFixtureGraph({
    "TASK-0001": { status: "done", dependsOn: [] },
    "TASK-0002": { status: "in-progress", dependsOn: ["TASK-0001"] },
    "TASK-0003": { status: "todo", dependsOn: ["TASK-0002"] },
    "TASK-0004": { status: "blocked", dependsOn: [] },
  });

  assert.deepEqual(result.active, ["TASK-0002"]);
  assert.deepEqual(result.resumableActive, ["TASK-0002"]);
  assert.deepEqual(result.blocked, [
    { id: "TASK-0003", reasons: ["depends-on:TASK-0002"] },
    { id: "TASK-0004", reasons: ["status:blocked"] },
  ]);
});

test("buildTaskGraph keeps unresolved active tasks active but not resumable", () => {
  const result = buildFixtureGraph({
    "TASK-0001": { status: "todo", dependsOn: [] },
    "TASK-0002": { status: "in-progress", dependsOn: ["TASK-0001"] },
  });

  assert.deepEqual(result.active, ["TASK-0002"]);
  assert.deepEqual(result.resumableActive, []);
});

test("buildTaskGraph sorts multiple resumable active tasks and suppresses them on structural issues", () => {
  const valid = buildFixtureGraph({
    "TASK-0003": { status: "in-progress", dependsOn: [] },
    "TASK-0001": { status: "in-progress", dependsOn: [] },
    "TASK-0002": { status: "done", dependsOn: [] },
  });
  assert.deepEqual(valid.resumableActive, ["TASK-0001", "TASK-0003"]);

  const invalid = buildFixtureGraph({
    "TASK-0001": { status: "in-progress", dependsOn: ["TASK-9999"] },
  });
  assert.deepEqual(invalid.active, ["TASK-0001"]);
  assert.deepEqual(invalid.resumableActive, []);
  assert.deepEqual(invalid.issues.map((issue) => issue.code), ["missing-task-reference"]);
});
```

- [ ] **Step 2: Run the focused test and verify the public field is missing**

Run from `scripts/doc-driven-dev`:

```powershell
rtk pnpm exec tsx --test tests/doc-driven-dev-graph-task-graph.test.ts
```

Expected: FAIL because `TaskGraphResult` and returned JSON do not contain `resumableActive`.

- [ ] **Step 3: Add the projection field and compute it from normalized edges**

Extend `TaskGraphResult` without changing the meaning of `active`:

```ts
export type TaskGraphResult = {
  schemaVersion: 1;
  plan: string;
  nodes: TaskGraphNode[];
  edges: TaskGraphEdge[];
  runnable: string[];
  active: string[];
  resumableActive: string[];
  completed: string[];
  blocked: Array<{ id: string; reasons: string[] }>;
  issues: TaskGraphIssue[];
};
```

In `summarizeTaskGraph()`, compute the new projection beside `active`:

```ts
const active = sortedTasks.filter((task) => task.status === "in-progress").map((task) => task.id);
const resumableActive = uniqueIssues.length > 0
  ? []
  : sortedTasks
    .filter((task) => task.status === "in-progress")
    .filter((task) => sortedEdges.filter((edge) => edge.to === task.id).every((edge) => {
      const predecessor = sortedTasks.find((candidate) => candidate.id === edge.from);
      return predecessor?.status === "done";
    }))
    .map((task) => task.id);
```

Return both stable lists:

```ts
runnable: runnable.sort(compareStrings),
active: active.sort(compareStrings),
resumableActive: resumableActive.sort(compareStrings),
completed: completed.sort(compareStrings),
```

- [ ] **Step 4: Run the focused projection tests**

Run:

```powershell
rtk pnpm exec tsx --test tests/doc-driven-dev-graph-task-graph.test.ts
```

Expected: PASS with zero failed tests.

- [ ] **Step 5: Commit the projection contract**

```powershell
rtk git add scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/task_graph.ts scripts/doc-driven-dev/tests/doc-driven-dev-graph-task-graph.test.ts
rtk git commit -m "feat: project resumable active tasks"
```

### Task 2: Extend the Generic Task-Graph Condition DSL

**Files:**

- Modify: `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/graph_definition.ts`
- Modify: `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/graph_conditions.ts`
- Test: `scripts/doc-driven-dev/tests/doc-driven-dev-graph-definition.test.ts`
- Test: `scripts/doc-driven-dev/tests/doc-driven-dev-graph-router.test.ts`

**Interfaces:**

- Consumes: `TaskGraphResult.resumableActive` from Task 1.
- Produces: `GraphCondition` support for `{ kind: "task-graph"; state: "active" }`; `evaluateCondition()` returns true only when `resumableActive` is non-empty; `idle` is false whenever `active` is non-empty.

- [ ] **Step 1: Add failing parser and evaluator tests**

In `doc-driven-dev-graph-definition.test.ts`, add `tasks-active` to `validFixture`:

```yaml
  tasks-active: { kind: task-graph, state: active }
```

Then assert:

```ts
assert.deepEqual(definition.conditions["tasks-active"], { kind: "task-graph", state: "active" });
```

In `doc-driven-dev-graph-router.test.ts`, ensure every inline Task Graph fixture includes:

```ts
resumableActive: [],
```

Replace the task-graph condition test with coverage for all four states:

```ts
test("evaluates runnable, active, invalid, and idle task-graph conditions", () => {
  const runnable: GraphCondition = { kind: "task-graph", state: "runnable" };
  const active: GraphCondition = { kind: "task-graph", state: "active" };
  const invalid: GraphCondition = { kind: "task-graph", state: "invalid" };
  const idle: GraphCondition = { kind: "task-graph", state: "idle" };
  const taskGraph = (overrides: Record<string, unknown> = {}): NonNullable<GraphState["taskGraph"]> => ({
    schemaVersion: 1,
    plan: "docs/plans/example.md",
    nodes: [],
    edges: [],
    runnable: [],
    active: [],
    resumableActive: [],
    completed: [],
    blocked: [],
    issues: [],
    ...overrides,
  } as NonNullable<GraphState["taskGraph"]>);

  assert.equal(evaluateCondition(runnable, stateWith({ taskGraph: taskGraph({ runnable: ["TASK-1"] }) })), true);
  assert.equal(evaluateCondition(active, stateWith({ taskGraph: taskGraph({ active: ["TASK-1"], resumableActive: ["TASK-1"] }) })), true);
  assert.equal(evaluateCondition(active, stateWith({ taskGraph: taskGraph({ active: ["TASK-1"] }) })), false);
  assert.equal(evaluateCondition(active, stateWith({ taskGraph: taskGraph({ resumableActive: ["TASK-1"], issues: [{ code: "task-cycle" }] }) })), false);
  assert.equal(evaluateCondition(invalid, stateWith({ taskGraph: taskGraph({ issues: [{ code: "task-cycle" }] }) })), true);
  assert.equal(evaluateCondition(idle, stateWith({ taskGraph: taskGraph() })), true);
  assert.equal(evaluateCondition(idle, stateWith({ taskGraph: taskGraph({ active: ["TASK-1"] }) })), false);
  assert.equal(evaluateCondition(idle, stateWith({ taskGraph: taskGraph({ runnable: ["TASK-1"] }) })), false);
  assert.equal(evaluateCondition(active, stateWith({ taskGraph: null })), false);
  assert.equal(evaluateCondition(idle, stateWith({ taskGraph: null })), false);
});
```

- [ ] **Step 2: Run the parser and router tests to verify red state**

Run:

```powershell
rtk pnpm exec tsx --test tests/doc-driven-dev-graph-definition.test.ts tests/doc-driven-dev-graph-router.test.ts
```

Expected: FAIL because Zod rejects `state: active` and `evaluateCondition()` has no active branch.

- [ ] **Step 3: Extend the type, Zod enum, and evaluator**

Update both condition declarations in `graph_definition.ts`:

```ts
| { kind: "task-graph"; state: "runnable" | "active" | "invalid" | "idle" };
```

```ts
state: z.enum(["runnable", "active", "invalid", "idle"]),
```

Make task-graph evaluation explicit in `graph_conditions.ts`:

```ts
if (condition.state === "runnable") return (state.taskGraph?.runnable.length ?? 0) > 0;
if (condition.state === "active") {
  return (state.taskGraph?.issues.length ?? 0) === 0
    && (state.taskGraph?.resumableActive.length ?? 0) > 0;
}
if (condition.state === "invalid") return (state.taskGraph?.issues.length ?? 0) > 0;
return state.taskGraph !== null
  && state.taskGraph.runnable.length === 0
  && state.taskGraph.active.length === 0
  && state.taskGraph.issues.length === 0;
```

- [ ] **Step 4: Run the focused DSL tests**

Run:

```powershell
rtk pnpm exec tsx --test tests/doc-driven-dev-graph-definition.test.ts tests/doc-driven-dev-graph-router.test.ts
```

Expected: PASS with zero failed tests.

- [ ] **Step 5: Commit the DSL extension**

```powershell
rtk git add scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/graph_definition.ts scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/graph_conditions.ts scripts/doc-driven-dev/tests/doc-driven-dev-graph-definition.test.ts scripts/doc-driven-dev/tests/doc-driven-dev-graph-router.test.ts
rtk git commit -m "feat: evaluate resumable active task conditions"
```

### Task 3: Declare and Verify Active Re-entry Routing

**Files:**

- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml`
- Modify: `scripts/doc-driven-dev/tests/doc-driven-dev-graph-definition-contract.test.ts`
- Modify: `scripts/doc-driven-dev/tests/doc-driven-dev-graph-routing-contract.test.ts`
- Modify: `scripts/doc-driven-dev/tests/doc-driven-dev-graph-cli.test.ts`

**Interfaces:**

- Consumes: the `active` condition from Task 2 and `resumableActive` from Task 1.
- Produces: declared edge `task-graph-to-active-implementation`; condition key `tasks-active`; active re-entry priority before `task-graph-to-implementation`.

- [ ] **Step 1: Add failing distributed-definition assertions**

In `doc-driven-dev-graph-definition-contract.test.ts`, extend the distributed graph test:

```ts
const activeEdge = findEdge(graph, "task-graph", "tasks-active");
const runnableEdge = findEdge(graph, "task-graph", "tasks-runnable");
assert.deepEqual(graph.conditions["tasks-active"], { kind: "task-graph", state: "active" });
assert.equal(activeEdge?.id, "task-graph-to-active-implementation");
assert.equal(activeEdge?.to, "implementation");
assert.ok(activeEdge && runnableEdge && activeEdge.priority < runnableEdge.priority);
```

- [ ] **Step 2: Add source-level route regressions**

In `doc-driven-dev-graph-routing-contract.test.ts`, add tests using `fixtureRepo()` and `stateFor()`:

```ts
test("resumes an active task whose predecessors are done despite downstream waits", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(
    ["done", "in-progress", "todo"],
    [[], ["TASK-0001"], ["TASK-0002"]],
  ));
  const route = routeGraph({ current: "task-graph", definition, state });

  assert.equal(route.edgeId, "task-graph-to-active-implementation");
  assert.equal(route.next, "implementation");
  assert.equal(route.delegate, "implementation-flow");
  assert.deepEqual(route.taskGraph?.active, ["TASK-0002"]);
  assert.deepEqual(route.taskGraph?.resumableActive, ["TASK-0002"]);
  assert.deepEqual(route.taskGraph?.blocked, [
    { id: "TASK-0003", reasons: ["depends-on:TASK-0002"] },
  ]);
});

test("prioritizes resumable active tasks over runnable tasks with one route edge", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(["in-progress", "todo"], [[], []]));
  const decision = evaluateRouteDecision({ current: "task-graph", definition, state });

  assert.equal(decision.route.edgeId, "task-graph-to-active-implementation");
  assert.deepEqual(decision.route.taskGraph?.active, ["TASK-0001"]);
  assert.deepEqual(decision.route.taskGraph?.resumableActive, ["TASK-0001"]);
  assert.deepEqual(decision.route.taskGraph?.runnable, ["TASK-0002"]);
  assert.equal(decision.explanation.selectedEdgeId, "task-graph-to-active-implementation");
  assert.equal(decision.explanation.evaluatedEdges.filter((edge) => edge.matched).length, 1);
});

test("passes sorted active tasks and dependency edges while only ready active tasks are resumable", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(
    ["in-progress", "in-progress", "in-progress"],
    [[], [], ["TASK-0001"]],
  ));
  const route = routeGraph({ current: "task-graph", definition, state });

  assert.equal(route.edgeId, "task-graph-to-active-implementation");
  assert.deepEqual(route.taskGraph?.active, ["TASK-0001", "TASK-0002", "TASK-0003"]);
  assert.deepEqual(route.taskGraph?.resumableActive, ["TASK-0001", "TASK-0002"]);
  assert.deepEqual(route.taskGraph?.edges, [{ from: "TASK-0001", to: "TASK-0003" }]);
});

test("fails closed when no active task has resolved predecessors", () => {
  const definition = graphDefinition();
  const state = stateFor(fixtureRepo(["todo", "in-progress"], [[], ["TASK-0001"]]));
  state.taskGraph!.runnable = [];
  const route = routeGraph({ current: "task-graph", definition, state });

  assert.equal(route.status, "blocked");
  assert.equal(route.edgeId, null);
  assert.deepEqual(route.taskGraph?.active, ["TASK-0002"]);
  assert.deepEqual(route.taskGraph?.resumableActive, []);
});
```

Import `evaluateRouteDecision` beside `routeGraph` for the one-edge assertion.

- [ ] **Step 3: Add CLI scenarios for active-only, active-plus-runnable, and invalid graphs**

Extend the CLI table with exact assertions:

```ts
{
  name: "resumable active task graph",
  setup: () => ({
    repo: completeRepo(["done", "in-progress"], [[], ["TASK-0001"]]),
    args: ["--focus", "PLAN-0001", "--current", "task-graph"],
  }),
  edgeId: "task-graph-to-active-implementation",
  next: "implementation",
  assertRoute: (route) => {
    const taskGraph = route.taskGraph as { active: string[]; resumableActive: string[] };
    assert.deepEqual(taskGraph.active, ["TASK-0002"]);
    assert.deepEqual(taskGraph.resumableActive, ["TASK-0002"]);
  },
},
{
  name: "active task takes priority over runnable task",
  setup: () => ({
    repo: completeRepo(["in-progress", "todo"]),
    args: ["--focus", "PLAN-0001", "--current", "task-graph"],
  }),
  edgeId: "task-graph-to-active-implementation",
  next: "implementation",
  assertRoute: (route) => {
    const taskGraph = route.taskGraph as { active: string[]; resumableActive: string[]; runnable: string[] };
    assert.deepEqual(taskGraph.active, ["TASK-0001"]);
    assert.deepEqual(taskGraph.resumableActive, ["TASK-0001"]);
    assert.deepEqual(taskGraph.runnable, ["TASK-0002"]);
  },
},
```

- [ ] **Step 4: Run the route tests and verify red state**

Run:

```powershell
rtk pnpm exec tsx --test tests/doc-driven-dev-graph-definition-contract.test.ts tests/doc-driven-dev-graph-routing-contract.test.ts tests/doc-driven-dev-graph-cli.test.ts
```

Expected: FAIL because `tasks-active` and `task-graph-to-active-implementation` are not declared.

- [ ] **Step 5: Add the condition and higher-priority edge to the distributed graph**

Add the condition after `task-graph-retry`:

```yaml
  tasks-active: { kind: task-graph, state: active }
  tasks-runnable: { kind: task-graph, state: runnable }
```

Replace the existing runnable edge with these ordered declarations:

```yaml
  - { id: task-graph-to-active-implementation, from: task-graph, to: implementation, when: tasks-active, priority: 30 }
  - { id: task-graph-to-implementation, from: task-graph, to: implementation, when: tasks-runnable, priority: 40 }
```

- [ ] **Step 6: Run the source-level route tests**

Run:

```powershell
rtk pnpm exec tsx --test tests/doc-driven-dev-graph-definition-contract.test.ts tests/doc-driven-dev-graph-routing-contract.test.ts tests/doc-driven-dev-graph-cli.test.ts
```

Expected: source route tests PASS; generated-CLI assertions may still fail until Task 4 rebuilds distributable scripts.

- [ ] **Step 7: Commit the declared route and source integration tests**

```powershell
rtk git add packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml scripts/doc-driven-dev/tests/doc-driven-dev-graph-definition-contract.test.ts scripts/doc-driven-dev/tests/doc-driven-dev-graph-routing-contract.test.ts scripts/doc-driven-dev/tests/doc-driven-dev-graph-cli.test.ts
rtk git commit -m "fix: route resumable active tasks to implementation"
```

### Task 4: Document, Build, and Verify the Distributed Contract

**Files:**

- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/SKILL.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/references/task-graph-contract.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/references/task-graph-contract.ja.md`
- Modify: `packages/doc-driven-dev/README.md`
- Modify: `packages/doc-driven-dev/README.ja.md`
- Modify: `packages/doc-driven-dev/AGENTS.md`
- Modify: `packages/doc-driven-dev/AGENTS.ja.md`
- Generate: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/build_task_graph.js`
- Generate: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/inspect_graph.js`
- Generate: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/route_graph.js`

**Interfaces:**

- Consumes: Tasks 1–3 source behavior and graph declarations.
- Produces: synchronized English/Japanese public contracts and generated Node 20-compatible CommonJS CLIs.

- [x] **Step 1: Update the English and Japanese skill summaries**

Change each Condition DSL list to include `active` and `idle`, and add a runtime-loop paragraph with these exact semantics:

```markdown
`tasks-active` means that the Task Graph has no structural issues and its
sorted `resumableActive` list contains at least one `in-progress` task whose
predecessors are all `done`. The active edge precedes the runnable edge, so an
existing task is resumed before new work starts. The route still selects one
edge and carries the complete Task Graph to `implementation-flow`; that
delegate uses stable task IDs and dependency edges to sequence dependent active
tasks and parallelize only independent work.
```

Use the corresponding Japanese text in `SKILL.ja.md`:

```markdown
`tasks-active` は、Task Graph に構造上の issue がなく、全 predecessor が
`done` の `in-progress` task を ID 順に並べた `resumableActive` が 1 件以上
あることを意味します。active edge は runnable edge より先に評価されるため、
新規作業を開始する前に既存 task を再開します。route が選ぶ edge は引き続き
1 件だけで、完全な Task Graph を `implementation-flow` に渡します。delegate は
安定した task ID と dependency edge に基づき、依存する active task を順序付け、
独立した作業だけを並列化します。
```

- [x] **Step 2: Define the public Task Graph projection in both contract files**

Document these fields and rules in matching sections:

```markdown
- `active`: every `in-progress` task in stable ID order.
- `resumableActive`: active tasks whose every predecessor is `done`, in stable
  ID order. Structural issues force this list to be empty.
- `runnable`: `todo` tasks whose every predecessor is `done`.
```

State explicitly that downstream dependency waits and unrelated blocked tasks do not remove an eligible task from `resumableActive`, unresolved active tasks stay in `active` only, and the full projection is passed to the implementation delegate.

- [x] **Step 3: Synchronize top-level English and Japanese predicate summaries**

In both README files and both AGENTS files, replace summaries that enumerate only `runnable` and `invalid` with `active`, `runnable`, `invalid`, and `idle`, and state that `tasks-active` has priority over `tasks-runnable`.

- [x] **Step 4: Run Markdown validation**

Run from `scripts/doc-driven-dev`:

```powershell
rtk pnpm run lint:md
```

Expected: exit code 0 and no Markdown lint failures.

- [x] **Step 5: Rebuild distributable scripts**

Run from `scripts/doc-driven-dev`:

```powershell
rtk pnpm run build:scripts
```

Expected: exit code 0, `Finished:` summary, and generated graph CLIs containing `resumableActive` plus the `active` condition enum.

- [ ] **Step 6: Verify generated CLI parity and the complete test suite**

Deferred: package-wide `pnpm test` requires explicit user permission. Focused
definition, routing, CLI parity, and active-work acceptance coverage is run in
Steps 7–8.

Run:

```powershell
rtk pnpm test
```

Expected: exit code 0 with zero failed tests, including source/generated parity and active re-entry CLI scenarios.

- [x] **Step 7: Re-run the focused acceptance command against a fixture with active work**

Use the CLI integration fixture through the focused test:

```powershell
rtk pnpm exec tsx --test --test-name-pattern "resumable active task graph|active task takes priority" tests/doc-driven-dev-graph-cli.test.ts
```

Expected: both scenarios PASS; each route has `next: "implementation"`, a non-null declared edge ID, `delegate: "implementation-flow"`, sorted `active`/`resumableActive`, and no `no-matching-edge` explanation.

- [x] **Step 8: Review the final diff for generated-only and unrelated changes**

Run from the repository root:

```powershell
rtk git status --short
rtk git diff --check
rtk git diff --stat
```

Expected: no whitespace errors; only the planned source, tests, English/Japanese docs, graph YAML, generated graph scripts, and this plan are changed. `.codex/config.toml` and `.serena/` remain untouched and unstaged.

- [x] **Step 9: Commit documentation and generated artifacts**

```powershell
rtk git add packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/SKILL.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/SKILL.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/references/task-graph-contract.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/references/task-graph-contract.ja.md packages/doc-driven-dev/README.md packages/doc-driven-dev/README.ja.md packages/doc-driven-dev/AGENTS.md packages/doc-driven-dev/AGENTS.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/build_task_graph.js packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/inspect_graph.js packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/route_graph.js docs/superpowers/plans/2026-08-23-resumable-active-task-routing.md
rtk git commit -m "docs: define resumable active task routing"
```

## Final Verification Checklist

- [ ] `resumableActive` is present in source and generated Task Graph JSON.
- [ ] One eligible active task routes through `task-graph-to-active-implementation` without changing task status.
- [ ] Downstream dependency waits and unrelated blocked tasks do not suppress active re-entry.
- [ ] An active task with an unresolved predecessor is not resumable.
- [ ] Structural issues suppress active re-entry and keep invalid routing ahead of active routing.
- [ ] Active plus runnable chooses the active edge.
- [ ] Multiple active tasks are sorted; only dependency-ready tasks appear in `resumableActive`; one edge is returned.
- [ ] The complete Task Graph, including dependency edges, reaches `implementation-flow`.
- [ ] All-done behavior, no-task behavior, runnable behavior, and unknown-state fail-closed behavior remain unchanged.
- [ ] English and Japanese docs remain synchronized.
- [ ] Markdown lint, focused tests, full tests, generated parity, and `git diff --check` pass with fresh evidence.
