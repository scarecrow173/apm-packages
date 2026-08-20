# Doc-Driven Dev Lifecycle Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `doc-driven-dev-lifecycle` を既存の文書契約と承認ゲートを維持したまま、静的 Lifecycle Graph、動的 Task DAG、再生成可能な Shared State を使う決定的ルーターへ移行する。

**Architecture:** Markdown/YAML front matter を唯一の永続的な正本とし、ランタイムDBや外部Graphフレームワークは追加しない。配布パッケージ内の `lifecycle.yaml` がノードと型付きエッジを定義し、TypeScript製の読み取り専用ルーターが対象文書から状態を再構築する。`briefing-flow` と `implementation-flow` は既存責務を保ったサブグラフとして委譲し、task-doc の `relations.depends-on` / `relations.blocks` から実行DAGだけを動的生成する。

**Tech Stack:** Node.js 20、TypeScript 5.6、`node:test`、`gray-matter`、`js-yaml`、Zod 4、esbuild、Markdown/YAML

## Global Constraints

- `doc-driven-dev-lifecycle` は引き続き唯一の end-to-end entrypoint とし、`briefing-flow` / `implementation-flow` の独立した起動境界を壊さない。
- Phase 3 は `plan-doc` 承認後にだけ `task-doc` を作成する。`TASK-DOC-GATE-001` の許可statusは `approved`、`in-progress`、`completed` のままとする。
- Markdown文書とsemantic relationsを正本とし、Shared Stateは毎回再構築できる派生データに限定する。
- Graphルーターは読み取り専用とし、文書作成、status更新、skill dispatch、コード変更を自動実行しない。
- 既存の `briefing-flow` と `implementation-flow` の内部処理をLifecycle Graphへflattenしない。
- task依存を解決できない、task IDが重複する、またはcycleがある場合は fail closed とし、実装taskをrunnableにしない。
- English / Japanese の `README`、`SKILL`、reference、package `AGENTS` は意味と構造を同期する。
- TypeScriptを変更したtaskでは `pnpm --dir scripts/doc-driven-dev run build:scripts` を実行し、配布JavaScriptを同じcommitに含める。
- 新しい外部依存、永続ランタイムDB、Graph UI、task自動並列実行はこの計画の対象外とする。

---

## Design Choice

採用案は「package-local declarative graph + deterministic router」である。

| 案 | 判断 | 理由 |
| --- | --- | --- |
| package-local YAML + TypeScript router | 採用 | 既存依存だけで検証でき、文書正本・配布形態・skill dispatch境界を維持できる |
| LangGraph等の外部runtime | 不採用 | 新依存、checkpoint store、provider bindingが先に必要になり、現在のskill packageに対して過剰 |
| 文書上のMermaid/YAMLだけ | 不採用 | 可視化はできるが、cycle検出、runnable task判定、typed loopbackを実行時に保証できない |

Graph化は次の二層に限定する。

```text
Artifact Graph (source of truth)       Execution Graph (derived)
spec/ADR -> design -> plan -> task     probe -> phase/subgraph -> gate
                         |                              |
                         +-> relations                  +-> Task DAG
```

## File Map

### New source and tests

- `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/lib/task_graph.ts` — task文書を検証済みDAGへ投影する純粋ロジック。
- `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/build_task_graph.ts` — Task DAGをJSON出力する読み取り専用CLI。
- `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_graph.ts` — `lifecycle.yaml` のschema、loader、edge lookup。
- `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_state.ts` — focus文書、status、relations、signalからShared Stateを再構築。
- `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_router.ts` — gate優先順位とtyped edgeを決定する純粋ロジック。
- `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/route_lifecycle.ts` — Lifecycle Graphの次ノードをJSON出力する読み取り専用CLI。
- `scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-task-graph.test.ts` — dependency解決、runnable判定、cycle、unknown ref、plan filter。
- `scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-graph-contract.test.ts` — YAML schema、node/edge、delegate境界、loopback網羅性。
- `scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-router.test.ts` — state probe、gate、resume、loopback、CLI統合。

### New distributed assets

- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/graphs/lifecycle.yaml` — 実行トポロジーの正本。
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/graph-contract.md` — Graphの責務、node/edge/state契約。
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/graph-contract.ja.md` — 同契約の日本語版。
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/lifecycle-state.md` — Shared Stateとsignal契約。
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/lifecycle-state.ja.md` — 同契約の日本語版。
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/build_task_graph.js` — build生成物。
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/route_lifecycle.js` — build生成物。

### Existing files to modify

- `scripts/doc-driven-dev/src/skills/task-doc/scripts/new_task.ts` — repeatable `--depends-on` / `--blocks` flags。
- `scripts/doc-driven-dev/tests/doc-suite.test.ts` — task authoring regression。
- `packages/doc-driven-dev/.apm/skills/task-doc/SKILL.md` / `SKILL.ja.md` — dependency flagsとDAG semantics。
- `packages/doc-driven-dev/.apm/skills/task-doc/references/task-conventions.md` / `.ja.md` — task edge解決規則。
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md` / `SKILL.ja.md` — thin router loop。
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.md` / `.ja.md` — prose gateとYAML topologyのownership分離。
- `packages/doc-driven-dev/README.md` / `README.ja.md` — current/graph model、CLI例、互換性。
- `packages/doc-driven-dev/AGENTS.md` / `AGENTS.ja.md` — lifecycle skillがTypeScript runtimeを持つ例外を記録。
- `scripts/doc-driven-dev/package.json` — 新しいEnglish/Japanese referenceをMarkdown lint対象へ追加。

## Public Contracts

```ts
type TaskStatus = "todo" | "in-progress" | "blocked" | "done" | "wont-do";

type TaskGraphNode = {
  id: string;
  path: string;
  status: TaskStatus;
  dependsOn: string[];
  blocks: string[];
};

type TaskGraphIssueCode =
  | "duplicate-task-id"
  | "missing-task-reference"
  | "task-cycle"
  | "plan-has-no-tasks";

type TaskGraphResult = {
  schemaVersion: 1;
  plan: string;
  nodes: TaskGraphNode[];
  edges: Array<{ from: string; to: string }>;
  runnable: string[];
  active: string[];
  completed: string[];
  blocked: Array<{ id: string; reasons: string[] }>;
  issues: Array<{ code: TaskGraphIssueCode; message: string; tasks: string[] }>;
};

function buildTaskGraph(options: {
  cwd: string;
  plan: string;
  taskDir?: string;
}): TaskGraphResult;
```

Task edge rules are exact:

1. `relations.depends-on` resolving to another selected task creates `dependency -> task`.
2. `relations.blocks` resolving to another selected task creates `task -> blocked task`.
3. The same edge appearing in both fields is deduplicated.
4. A relation to plan/spec/ADR/design is an upstream artifact relation and is not a Task DAG edge.
5. A value looking like `TASK-NNNN` or a path under the selected task directory that cannot resolve is a blocking issue.
6. Only `todo` with every predecessor at `done` is runnable. `in-progress` is active. `wont-do` never satisfies a predecessor.
7. Duplicate IDs or a directed cycle makes `runnable` empty.

```ts
type LifecycleNodeId =
  | "probe"
  | "migration"
  | "bootstrap"
  | "briefing"
  | "design"
  | "planning"
  | "task-graph"
  | "implementation"
  | "followup-triage"
  | "exit-audit"
  | "complete";

type LifecycleSignal =
  | "migration-requested"
  | "migration-complete"
  | "spec-gap"
  | "design-gap"
  | "constraint-gap"
  | "implementation-verified"
  | "followups-classified"
  | "exit-audit-pass";

type LifecycleRoute = {
  schemaVersion: 1;
  current: LifecycleNodeId;
  next: LifecycleNodeId;
  edgeId: string | null;
  reasonCode: string;
  delegate: string | null;
  requiredAudits: string[];
  blockers: string[];
  taskGraph: TaskGraphResult | null;
};
```

`route_lifecycle.js` accepts `--current`, repeatable `--focus`, repeatable `--signal`, optional `--task-dir`, and `--json`. After bootstrap, an existing repository with lifecycle artifacts but no focus fails closed with `reasonCode: focus-required`; it never guesses between unrelated feature chains.

---

### Task 1: Project task documents into a validated execution DAG

**Files:**

- Create: `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/lib/task_graph.ts`
- Create: `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/build_task_graph.ts`
- Create: `scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-task-graph.test.ts`
- Generate: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/build_task_graph.js`

**Interfaces:**

- Consumes: task front matter `id`, `type`, `status`, `relations.implements`, `relations.depends-on`, `relations.blocks`.
- Produces: `buildTaskGraph(options): TaskGraphResult` and JSON CLI output matching `Public Contracts`.

- [ ] **Step 1: Write the failing unit tests**

Create fixtures in temporary repositories and assert the exact graph:

```ts
import type {
  TaskGraphResult,
  TaskStatus,
} from "../src/skills/doc-driven-dev-lifecycle/scripts/lib/task_graph";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const matter = require("gray-matter");
const {
  buildTaskGraph,
} = require("../src/skills/doc-driven-dev-lifecycle/scripts/lib/task_graph.ts");

function writeTask(
  repo: string,
  id: string,
  input: { status: TaskStatus; dependsOn: string[] },
): void {
  const number = id.slice("TASK-".length);
  const file = path.join(repo, "docs/tasks", `${number}-task.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify("# Task\n\n## Verification\n\n- [ ] node --test\n", {
    id,
    type: "task",
    status: input.status,
    title: id,
    created: "2026-08-13",
    updated: "2026-08-13",
    owners: [],
    relations: {
      implements: ["docs/plans/0001-plan.md"],
      "depends-on": input.dependsOn,
      blocks: [],
    },
  }), "utf8");
}

function buildFixtureGraph(
  tasks: Record<string, { status: TaskStatus; dependsOn: string[] }>,
): TaskGraphResult {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-"));
  fs.mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/plans/0001-plan.md"), "# Plan\n", "utf8");
  for (const [id, input] of Object.entries(tasks)) writeTask(repo, id, input);
  return buildTaskGraph({ cwd: repo, plan: "docs/plans/0001-plan.md" });
}

test("buildTaskGraph returns parallel roots and a fan-in task", () => {
  const result = buildFixtureGraph({
    "TASK-0001": { status: "todo", dependsOn: [] },
    "TASK-0002": { status: "todo", dependsOn: [] },
    "TASK-0003": { status: "todo", dependsOn: ["TASK-0001", "TASK-0002"] },
  });
  assert.deepEqual(result.edges, [
    { from: "TASK-0001", to: "TASK-0003" },
    { from: "TASK-0002", to: "TASK-0003" },
  ]);
  assert.deepEqual(result.runnable, ["TASK-0001", "TASK-0002"]);
  assert.deepEqual(result.issues, []);
});

test("buildTaskGraph unlocks a dependent task only after every predecessor is done", () => {
  const result = buildFixtureGraph({
    "TASK-0001": { status: "done", dependsOn: [] },
    "TASK-0002": { status: "done", dependsOn: [] },
    "TASK-0003": { status: "todo", dependsOn: ["TASK-0001", "TASK-0002"] },
  });
  assert.deepEqual(result.runnable, ["TASK-0003"]);
});

test("buildTaskGraph fails closed on cycle and unresolved task reference", () => {
  const result = buildFixtureGraph({
    "TASK-0001": { status: "todo", dependsOn: ["TASK-0002"] },
    "TASK-0002": { status: "todo", dependsOn: ["TASK-0001", "TASK-9999"] },
  });
  assert.deepEqual(result.runnable, []);
  assert.deepEqual(result.issues.map((issue) => issue.code).sort(), [
    "missing-task-reference",
    "task-cycle",
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify red state**

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-task-graph.test.ts`

Expected: FAIL because `task_graph.ts` and `buildTaskGraph` do not exist.

- [ ] **Step 3: Implement the parser, resolver, cycle check, and CLI**

Implement the exported boundary exactly as follows; keep filesystem parsing inside `buildTaskGraph` and graph calculations in deterministic helper functions sorted by task ID:

```ts
export type BuildTaskGraphOptions = {
  cwd: string;
  plan: string;
  taskDir?: string;
};

export function buildTaskGraph(options: BuildTaskGraphOptions): TaskGraphResult {
  const cwd = path.resolve(options.cwd);
  const plan = normalizeRepoPath(cwd, options.plan);
  const taskDir = options.taskDir ?? "docs/tasks";
  const parsed = readTaskDocuments(cwd, taskDir)
    .filter((task) => task.implements.includes(plan));
  const indexed = indexTasks(parsed);
  const resolved = resolveTaskEdges(cwd, taskDir, indexed);
  const issues = [...indexed.issues, ...resolved.issues, ...findCycles(parsed, resolved.edges)];
  return summarizeTaskGraph(plan, parsed, resolved.edges, issues);
}
```

The CLI must print the result for valid and invalid graphs, set exit code `1` when `issues` is non-empty, and never write files. Its usage string is:

```text
Usage: node scripts/build_task_graph.js --plan <path> [--task-dir <path>] [--cwd <path>] [--json]
```

- [ ] **Step 4: Build the distributed CLI and verify green state**

Run: `pnpm --dir scripts/doc-driven-dev run build:scripts`

Expected: output contains `doc-driven-dev-lifecycle/scripts/build_task_graph.js`.

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-task-graph.test.ts`

Expected: all Task Graph tests PASS.

- [ ] **Step 5: Commit the independently usable Task DAG slice**

```bash
git add scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/lib/task_graph.ts scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/build_task_graph.ts scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-task-graph.test.ts packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/build_task_graph.js
h5i capture commit -m "feat(doc-driven-dev): derive task execution graph" --agent codex --tests
```

### Task 2: Make task dependencies authorable through task-doc

**Files:**

- Modify: `scripts/doc-driven-dev/src/skills/task-doc/scripts/new_task.ts`
- Modify: `scripts/doc-driven-dev/tests/doc-suite.test.ts`
- Modify: `packages/doc-driven-dev/.apm/skills/task-doc/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/task-doc/SKILL.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/task-doc/references/task-conventions.md`
- Modify: `packages/doc-driven-dev/.apm/skills/task-doc/references/task-conventions.ja.md`
- Generate: `packages/doc-driven-dev/.apm/skills/task-doc/scripts/new_task.js`

**Interfaces:**

- Consumes: the existing approved-plan gate and repeatable CLI task references.
- Produces: `--depends-on <task>` and `--blocks <task>` entries without changing `--plan` semantics.

- [ ] **Step 1: Add the failing CLI regression test**

```ts
const matter = require("gray-matter");

function repoWithApprovedPlanAndTasks(): string {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  fs.mkdirSync(path.join(repo, "docs/tasks"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/plans/0001-plan.md"),
    matter.stringify("# Plan\n", {
      id: "PLAN-0001", type: "plan", status: "approved", title: "Plan",
      created: "2026-08-13", updated: "2026-08-13", owners: [], relations: {},
    }),
    "utf8",
  );
  for (const [number, title] of [["0001", "schema"], ["0002", "types"], ["0004", "ui"]]) {
    fs.writeFileSync(
      path.join(repo, "docs/tasks", `${number}-${title}.md`),
      matter.stringify(`# ${title}\n`, {
        id: `TASK-${number}`, type: "task", status: "todo", title,
        created: "2026-08-13", updated: "2026-08-13", owners: [], relations: {},
      }),
      "utf8",
    );
  }
  return repo;
}

test("new_task records repeatable task dependencies and blocks relations", () => {
  const repo = repoWithApprovedPlanAndTasks();
  const created = runScript("task-doc", "new_task.js", [
    "--title", "Implement API",
    "--plan", "docs/plans/0001-plan.md",
    "--depends-on", "docs/tasks/0001-schema.md",
    "--depends-on", "TASK-0002",
    "--blocks", "docs/tasks/0004-ui.md",
  ], { cwd: repo });
  assert.equal(created.status, 0, created.stderr);
  const task = fs.readFileSync(path.join(repo, "docs/tasks/0005-implement-api.md"), "utf8");
  assert.match(task, /^    - "docs\/tasks\/0001-schema.md"$/m);
  assert.match(task, /^    - "TASK-0002"$/m);
  assert.match(task, /^  blocks:\n    - "docs\/tasks\/0004-ui.md"$/m);
});
```

- [ ] **Step 2: Run the focused regression and verify red state**

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test --test-name-pattern "records repeatable task dependencies" tests/doc-suite.test.ts`

Expected: FAIL with `Unknown argument: --depends-on`.

- [ ] **Step 3: Add repeatable arguments without weakening the plan gate**

Use initialized arrays and append each occurrence:

```ts
type CliArgs = {
  blocks: string[];
  cwd: string;
  dependsOn: string[];
  plan?: string;
  title?: string;
};

const args: CliArgs = { blocks: [], cwd: process.cwd(), dependsOn: [] };

if (arg === "--depends-on") args.dependsOn.push(argv[++i]);
else if (arg === "--blocks") args.blocks.push(argv[++i]);
```

Pass relations to `createDocument` with plan linkage preserved and user-provided values deduplicated in input order:

```ts
relations: {
  implements: linked,
  "depends-on": [...new Set([...linked, ...args.dependsOn])],
  blocks: [...new Set(args.blocks)],
},
```

Update the usage text and both language documents with the exact edge direction from `Public Contracts`. Do not claim that task creation validates the whole DAG; validation belongs to `build_task_graph.js`.

- [ ] **Step 4: Rebuild and run task authoring plus Task DAG tests**

Run: `pnpm --dir scripts/doc-driven-dev run build:scripts`

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test --test-name-pattern "new_task" tests/doc-suite.test.ts`

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-task-graph.test.ts`

Expected: all selected tests PASS and the generated `new_task.js` contains both new flags.

- [ ] **Step 5: Commit task edge authoring**

```bash
git add scripts/doc-driven-dev/src/skills/task-doc/scripts/new_task.ts scripts/doc-driven-dev/tests/doc-suite.test.ts packages/doc-driven-dev/.apm/skills/task-doc/SKILL.md packages/doc-driven-dev/.apm/skills/task-doc/SKILL.ja.md packages/doc-driven-dev/.apm/skills/task-doc/references/task-conventions.md packages/doc-driven-dev/.apm/skills/task-doc/references/task-conventions.ja.md packages/doc-driven-dev/.apm/skills/task-doc/scripts/new_task.js
h5i capture commit -m "feat(doc-driven-dev): author task graph edges" --agent codex --tests
```

### Task 3: Define and validate the static Lifecycle Graph

**Files:**

- Create: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/graphs/lifecycle.yaml`
- Create: `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_graph.ts`
- Create: `scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-graph-contract.test.ts`

**Interfaces:**

- Consumes: package-local YAML topology.
- Produces: `loadLifecycleGraph(file): LifecycleGraph` and `findEdge(graph, current, reasonCode)`.

- [ ] **Step 1: Write contract tests for hierarchy and loopbacks**

```ts
import type {
  LifecycleGraph,
} from "../src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_graph";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  findEdge,
  parseLifecycleGraph,
} = require("../src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_graph.ts");

function loadDistributedGraph(): LifecycleGraph {
  const file = path.resolve(
    __dirname,
    "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/graphs/lifecycle.yaml",
  );
  return parseLifecycleGraph(fs.readFileSync(file, "utf8"));
}

const invalidFixture = `
schemaVersion: 1
entry: probe
nodes:
  probe: { kind: probe, delegate: null, audits: [] }
  complete: { kind: terminal, delegate: null, audits: [] }
edges:
  - { id: duplicate, from: probe, to: missing, when: invalid }
  - { id: duplicate, from: probe, to: complete, when: valid }
`;

test("lifecycle graph preserves existing meta-skill boundaries", () => {
  const graph = loadDistributedGraph();
  assert.equal(graph.nodes.briefing.delegate, "briefing-flow");
  assert.equal(graph.nodes.implementation.delegate, "implementation-flow");
  assert.equal(graph.nodes.planning.delegate, null);
});

test("lifecycle graph declares required upstream loopbacks", () => {
  const graph = loadDistributedGraph();
  assert.ok(findEdge(graph, "design", "spec-gap"));
  assert.ok(findEdge(graph, "planning", "design-gap"));
  assert.ok(findEdge(graph, "implementation", "spec-gap"));
  assert.ok(findEdge(graph, "implementation", "design-gap"));
  assert.ok(findEdge(graph, "task-graph", "task-graph-invalid"));
});

test("lifecycle graph rejects unknown nodes and duplicate edge ids", () => {
  assert.throws(() => parseLifecycleGraph(invalidFixture), /Invalid lifecycle graph/);
});
```

- [ ] **Step 2: Run the graph contract test and verify red state**

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-graph-contract.test.ts`

Expected: FAIL because the graph loader and YAML file do not exist.

- [ ] **Step 3: Add the Zod schema and the complete first graph topology**

The YAML must contain these nodes in this order:

```yaml
schemaVersion: 1
entry: probe
nodes:
  probe: { kind: probe, delegate: null, audits: [] }
  migration: { kind: action, delegate: migrate_docs, audits: [] }
  bootstrap: { kind: action, delegate: scaffold_docs, audits: [] }
  briefing: { kind: subgraph, delegate: briefing-flow, audits: [spec, adr] }
  design: { kind: action, delegate: design-doc, audits: [design] }
  planning: { kind: subgraph, delegate: null, audits: [plan, task] }
  task-graph: { kind: gate, delegate: build_task_graph, audits: [task] }
  implementation: { kind: subgraph, delegate: implementation-flow, audits: [impl-record] }
  followup-triage: { kind: gate, delegate: null, audits: [task, impl-record] }
  exit-audit: { kind: audit, delegate: doc-status, audits: [all] }
  complete: { kind: terminal, delegate: null, audits: [] }
```

Edges must cover normal progression, same-node gate retry, and the five loopbacks asserted above. Every edge has unique `id`, `from`, `to`, and `when`; `when` is a non-empty typed reason code. `parseLifecycleGraph` additionally verifies that entry and every edge endpoint exist and that `complete` has no outgoing edge.

- [ ] **Step 4: Run contract tests and type checking**

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-graph-contract.test.ts`

Run: `pnpm --dir scripts/doc-driven-dev exec tsc --noEmit`

Expected: both commands PASS.

- [ ] **Step 5: Commit the declarative graph contract**

```bash
git add packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/graphs/lifecycle.yaml scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_graph.ts scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-graph-contract.test.ts
h5i capture commit -m "feat(doc-driven-dev): define lifecycle graph contract" --agent codex --tests
```

### Task 4: Reconstruct Shared State and evaluate phase gates

**Files:**

- Create: `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_state.ts`
- Create: `scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-router.test.ts`

**Interfaces:**

- Consumes: canonical doc directories, explicit focus paths, front matter relations, runtime signals, Task Graph result.
- Produces: `probeLifecycleState(options): LifecycleState` and `evaluateLifecycleGates(state): GateResults`.

- [ ] **Step 1: Write failing state and gate tests**

```ts
import type {
  LifecycleSignal,
  LifecycleState,
} from "../src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_state";
import type {
  TaskStatus,
} from "../src/skills/doc-driven-dev-lifecycle/scripts/lib/task_graph";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const matter = require("gray-matter");
const {
  probeLifecycleState,
} = require("../src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_state.ts");

function writeArtifact(
  repo: string,
  relativePath: string,
  data: Record<string, unknown>,
  body: string,
): void {
  const file = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify(body, {
    created: "2026-08-13",
    updated: "2026-08-13",
    owners: [],
    relations: {},
    ...data,
  }), "utf8");
}

function repoWithApprovedArtifactChain(taskStatus: TaskStatus = "todo"): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-state-"));
  for (const dir of [
    "docs/ideas", "docs/discovery", "docs/specs", "docs/designs", "docs/plans",
    "docs/tasks", "docs/adr", "docs/impl/ir", "docs/impl/exp",
  ]) {
    fs.mkdirSync(path.join(repo, dir), { recursive: true });
    fs.writeFileSync(path.join(repo, dir, "README.md"), `# ${dir}\n`, "utf8");
  }
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Graph",
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] Routes deterministically\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "Graph ADR",
  }, "# Graph ADR\n\n## Considered Options\n\n### Package-local runtime\n\n### External runtime\n");
  writeArtifact(repo, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph Design",
    relations: {
      "derives-from": ["docs/specs/0001-graph.md", "docs/adr/0001-graph.md"],
    },
  }, "# Graph Design\n");
  writeArtifact(repo, "docs/plans/0001-graph-lifecycle.md", {
    id: "PLAN-0001", type: "plan", status: "approved", title: "Graph Plan",
    relations: { "derives-from": ["docs/designs/0001-graph.md"] },
  }, "# Graph Plan\n");
  writeArtifact(repo, "docs/tasks/0001-route.md", {
    id: "TASK-0001", type: "task", status: taskStatus, title: "Route",
    relations: { implements: ["docs/plans/0001-graph-lifecycle.md"] },
  }, "# Route\n\n## Verification\n\n- [ ] node --test\n");
  return repo;
}

function repoWithTwoPlans(): string {
  const repo = repoWithApprovedArtifactChain();
  writeArtifact(repo, "docs/plans/0002-other.md", {
    id: "PLAN-0002", type: "plan", status: "approved", title: "Other Plan",
  }, "# Other Plan\n");
  return repo;
}

function stateWithDoneTasks(signals: LifecycleSignal[]): LifecycleState {
  const repo = repoWithApprovedArtifactChain("done");
  return probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals,
  });
}

test("probe requires focus when multiple active artifact chains exist", () => {
  const repo = repoWithTwoPlans();
  const state = probeLifecycleState({ cwd: repo, focus: [], signals: [] });
  assert.deepEqual(state.blockers, ["focus-required"]);
});

test("approved focused plan with valid tasks reaches task graph gate", () => {
  const repo = repoWithApprovedArtifactChain();
  const state = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals: [],
  });
  assert.equal(state.gates.briefing.status, "pass");
  assert.equal(state.gates.design.status, "pass");
  assert.equal(state.gates.planning.status, "pass");
  assert.deepEqual(state.blockers, []);
});

test("implementation evidence remains a signal-backed gate", () => {
  const withoutEvidence = stateWithDoneTasks([]);
  const withEvidence = stateWithDoneTasks(["implementation-verified"]);
  assert.equal(withoutEvidence.gates.implementation.status, "blocked");
  assert.equal(withEvidence.gates.implementation.status, "pass");
});
```

- [ ] **Step 2: Run the router test and verify red state**

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-router.test.ts`

Expected: FAIL because Shared State APIs do not exist.

- [ ] **Step 3: Implement fail-closed state projection**

Implement the state with these exact fields:

```ts
export type LifecycleState = {
  schemaVersion: 1;
  cwd: string;
  focus: string[];
  artifacts: Array<{
    id: string;
    path: string;
    type: string;
    status: string;
    relations: Record<string, string[]>;
  }>;
  gates: Record<string, {
    status: "pass" | "fail" | "blocked";
    reasons: string[];
  }>;
  signals: LifecycleSignal[];
  blockers: string[];
};
```

Use these gate rules:

- Bootstrap passes only when every canonical directory and index from the existing bootstrap contract exists.
- Briefing passes only when the focused component has a spec at `proposed|approved|implemented`, a non-empty Acceptance Criteria section, an ADR at `proposed|accepted`, and at least two considered options.
- Design passes only with `status: approved`, a relation to the focused spec, and a relation to the focused ADR.
- Planning passes only with a plan at `approved|in-progress|completed`, a relation to the focused design, at least one selected task, and a Task Graph without issues.
- Implementation passes only when every selected task is `done` and signal `implementation-verified` exists.
- Follow-up triage passes only with signal `followups-classified`.
- Exit passes only with signal `exit-audit-pass`.
- Missing focus with zero artifacts routes to Briefing; missing focus with one or more active components blocks with `focus-required`.

Local relation targets are normalized from repository-root-relative and document-relative forms. Broken local targets in the focused component become blockers; external URLs remain evidence references and are not traversed.

- [ ] **Step 4: Run state tests and strict type checking**

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-router.test.ts`

Run: `pnpm --dir scripts/doc-driven-dev exec tsc --noEmit`

Expected: all selected tests PASS.

- [ ] **Step 5: Commit reproducible Shared State**

```bash
git add scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_state.ts scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-router.test.ts
h5i capture commit -m "feat(doc-driven-dev): derive lifecycle shared state" --agent codex --tests
```

### Task 5: Route typed lifecycle edges through a read-only CLI

**Files:**

- Create: `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_router.ts`
- Create: `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/route_lifecycle.ts`
- Modify: `scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-router.test.ts`
- Generate: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/route_lifecycle.js`

**Interfaces:**

- Consumes: `LifecycleGraph`, `LifecycleState`, current node, typed signals.
- Produces: `routeLifecycle(input): LifecycleRoute` and stable JSON CLI output.

- [ ] **Step 1: Add failing forward, retry, resume, and loopback tests**

```ts
import type {
  LifecycleNodeId,
  LifecycleRoute,
} from "../src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_router";
import type {
  LifecycleGraph,
} from "../src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_graph";

const { spawnSync } = require("node:child_process");
const {
  parseLifecycleGraph,
} = require("../src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_graph.ts");
const {
  routeLifecycle,
} = require("../src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_router.ts");

function loadDistributedGraph(): LifecycleGraph {
  const file = path.resolve(
    __dirname,
    "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/graphs/lifecycle.yaml",
  );
  return parseLifecycleGraph(fs.readFileSync(file, "utf8"));
}

function routeFixture(input: {
  current: LifecycleNodeId;
  taskStatuses?: TaskStatus[];
  signals?: LifecycleSignal[];
}): LifecycleRoute {
  const statuses = input.taskStatuses ?? ["done"];
  const repo = repoWithApprovedArtifactChain(statuses[0]);
  for (let index = 1; index < statuses.length; index += 1) {
    writeArtifact(repo, `docs/tasks/${String(index + 1).padStart(4, "0")}-route.md`, {
      id: `TASK-${String(index + 1).padStart(4, "0")}`,
      type: "task",
      status: statuses[index],
      title: `Route ${index + 1}`,
      relations: { implements: ["docs/plans/0001-graph-lifecycle.md"] },
    }, `# Route ${index + 1}\n\n## Verification\n\n- [ ] node --test\n`);
  }
  const state = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals: input.signals ?? [],
  });
  return routeLifecycle({ current: input.current, graph: loadDistributedGraph(), state });
}

function routeCompiledCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [
    path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/route_lifecycle.js"),
    "--cwd", cwd,
    ...args,
  ], { cwd, encoding: "utf8", windowsHide: true });
}

test("router sends independent root tasks to implementation-flow", () => {
  const route = routeFixture({ current: "task-graph", taskStatuses: ["todo", "todo"] });
  assert.equal(route.next, "implementation");
  assert.equal(route.delegate, "implementation-flow");
  assert.deepEqual(route.taskGraph?.runnable, ["TASK-0001", "TASK-0002"]);
});

test("router uses typed upstream loopbacks before forward gates", () => {
  const specGap = routeFixture({ current: "implementation", signals: ["spec-gap"] });
  const designGap = routeFixture({ current: "implementation", signals: ["design-gap"] });
  assert.equal(specGap.next, "briefing");
  assert.equal(designGap.next, "design");
});

test("router resumes from documents without persisted runtime state", () => {
  const repo = repoWithApprovedArtifactChain();
  const route = routeCompiledCli([
    "--current", "probe",
    "--focus", "docs/plans/0001-graph-lifecycle.md",
    "--json",
  ], repo);
  assert.equal(route.status, 0);
  assert.equal(JSON.parse(route.stdout).next, "implementation");
});
```

- [ ] **Step 2: Run the focused tests and verify red state**

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-router.test.ts`

Expected: FAIL because router and CLI are missing.

- [ ] **Step 3: Implement deterministic precedence and stable output**

`routeLifecycle` uses this precedence, first match wins:

```ts
const routingPrecedence = [
  "focus-required",
  "migration-requested",
  "bootstrap-incomplete",
  "spec-gap",
  "design-gap",
  "constraint-gap",
  "briefing-incomplete",
  "design-incomplete",
  "planning-incomplete",
  "task-graph-invalid",
  "tasks-runnable",
  "implementation-incomplete",
  "followups-unclassified",
  "exit-audit-required",
  "lifecycle-complete",
] as const;
```

The result must always include `current`, `next`, `reasonCode`, `blockers`, `requiredAudits`, and `taskGraph`; `edgeId` is null only for `focus-required` because no transition is authorized. CLI validation rejects unknown current nodes/signals and prints usage to stderr with exit code `1`. A valid blocked state is successful JSON output with exit code `0`, allowing agents to inspect the reason without treating it as a crashed tool.

- [ ] **Step 4: Build and verify source plus distributed CLI**

Run: `pnpm --dir scripts/doc-driven-dev run build:scripts`

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-router.test.ts tests/doc-driven-dev-lifecycle-graph-contract.test.ts tests/doc-driven-dev-lifecycle-task-graph.test.ts`

Expected: all Graph tests PASS and `route_lifecycle.js --help` exits `0`.

- [ ] **Step 5: Commit the executable lifecycle router**

```bash
git add scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/lib/lifecycle_router.ts scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/route_lifecycle.ts scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-router.test.ts packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/route_lifecycle.js
h5i capture commit -m "feat(doc-driven-dev): route lifecycle graph state" --agent codex --tests
```

### Task 6: Cut the lifecycle skill over to the graph router and synchronize documentation

**Files:**

- Create: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/graph-contract.md`
- Create: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/graph-contract.ja.md`
- Create: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/lifecycle-state.md`
- Create: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/lifecycle-state.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.ja.md`
- Modify: `packages/doc-driven-dev/README.md`
- Modify: `packages/doc-driven-dev/README.ja.md`
- Modify: `packages/doc-driven-dev/AGENTS.md`
- Modify: `packages/doc-driven-dev/AGENTS.ja.md`
- Modify: `scripts/doc-driven-dev/package.json`
- Modify: `scripts/doc-driven-dev/tests/doc-suite.test.ts`

**Interfaces:**

- Consumes: stable router JSON and existing delegated skills.
- Produces: an agent-facing loop of probe → dispatch → verify → signal → reroute, plus synchronized user documentation.

- [ ] **Step 1: Add failing distributed-contract assertions**

```ts
test("lifecycle docs bind the graph runtime without flattening subgraphs", () => {
  const root = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");
  const skill = fs.readFileSync(path.join(root, "doc-driven-dev-lifecycle/SKILL.md"), "utf8");
  const skillJa = fs.readFileSync(path.join(root, "doc-driven-dev-lifecycle/SKILL.ja.md"), "utf8");
  for (const text of [skill, skillJa]) {
    assert.match(text, /route_lifecycle\.js/);
    assert.match(text, /build_task_graph\.js/);
    assert.match(text, /briefing-flow/);
    assert.match(text, /implementation-flow/);
    assert.match(text, /focus-required/);
  }
});
```

- [ ] **Step 2: Run the contract assertion and verify red state**

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test --test-name-pattern "bind the graph runtime" tests/doc-suite.test.ts`

Expected: FAIL because the distributed skill does not mention the new CLIs or state contract.

- [ ] **Step 3: Document and activate the thin router loop**

Add this operational sequence, with equivalent Japanese text, near the top of the lifecycle skill:

```text
1. Select the active artifact chain with one or more --focus paths.
2. Run route_lifecycle.js with the current node and observed signals.
3. If reasonCode is focus-required, stop and obtain an explicit focus; do not guess.
4. Run every required audit reported by the route.
5. Dispatch only the returned delegate or the documented composite planning step.
6. Record completion evidence in the canonical documents.
7. Rerun the router from the returned node with any typed signal.
8. Stop only at complete or at a reported blocker requiring user authority.
```

Ownership language must state:

- `graphs/lifecycle.yaml` is normative for node/edge topology and delegate bindings.
- `flow-contract.md` is normative for human approval criteria, evidence, and follow-up classification.
- `lifecycle-state.md` is normative for derived state, focus, signals, and fail-closed behavior.
- Markdown artifacts remain normative for project history and status.

Update README diagrams to show current phase labels wrapping the hierarchical graph, Task DAG fan-out/fan-in, continuous per-node audit observations, and Phase 5 final audit. Update package `AGENTS` because `doc-driven-dev-lifecycle` is no longer a pure-Markdown workflow skill. Extend `lint:md` with the four new reference files.

- [ ] **Step 4: Run complete package verification**

Run: `pnpm --dir scripts/doc-driven-dev run build:scripts`

Expected: both lifecycle CLIs and all existing distributed scripts build successfully.

Run: `h5i capture run -- pnpm --dir scripts/doc-driven-dev test`

Expected: complete test suite PASS; preserve raw output if any failure occurs.

Run: `pnpm --dir scripts/doc-driven-dev run lint:md`

Expected: `0 error(s)`.

Run: `pnpm --dir scripts/doc-driven-dev exec tsc --noEmit`

Expected: exit code `0`.

Run: `apm compile --dry-run`

Workdir: `packages/doc-driven-dev`

Expected: dry-run includes `graphs/lifecycle.yaml`, both lifecycle CLIs, and the four new references.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 5: Commit the cutover documentation and contract**

```bash
git add packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/graph-contract.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/graph-contract.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/lifecycle-state.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/lifecycle-state.ja.md packages/doc-driven-dev/README.md packages/doc-driven-dev/README.ja.md packages/doc-driven-dev/AGENTS.md packages/doc-driven-dev/AGENTS.ja.md scripts/doc-driven-dev/package.json scripts/doc-driven-dev/tests/doc-suite.test.ts
h5i capture commit -m "docs(doc-driven-dev): adopt lifecycle graph routing" --agent codex --tests
```

## End-to-End Acceptance

- A repository with no canonical docs routes to `bootstrap`, then to `briefing`.
- A repository with multiple unrelated active plans and no focus returns `focus-required` and authorizes no dispatch.
- A focused chain with approved design but draft plan routes to `planning`.
- An approved plan with two independent root tasks returns both task IDs in `runnable`.
- Completing both root tasks unlocks their fan-in dependent task without editing runtime state.
- A task cycle or unresolved task reference returns no runnable task.
- `spec-gap` during implementation routes to `briefing-flow`; `design-gap` routes to `design-doc`.
- `implementation-verified`, `followups-classified`, and `exit-audit-pass` remain explicit evidence-backed signals.
- Existing manual phase workflow remains understandable from the phase labels and flow contract, while the router becomes the execution decision source.
- English and Japanese documentation describe the same nodes, signals, CLI flags, and fail-closed behavior.

## Rollout and Compatibility

1. Land Task DAG support first; it is usable independently through `build_task_graph.js`.
2. Land Graph YAML and router behind explicit lifecycle invocation; direct `briefing-flow` and `implementation-flow` calls remain unchanged.
3. Switch `doc-driven-dev-lifecycle` instructions to the router only after compiled CLI integration tests pass.
4. Keep prose phase tables for one compatibility cycle; remove duplicated routing prose only in a later, separately reviewed cleanup.
5. If rollback is required, restore lifecycle `SKILL` dispatch instructions to prose routing. Markdown artifacts and task relations need no migration because no new persistent state format was introduced.

## Self-Review Result

- Spec coverage: Task DAG, Shared State, typed loopbacks, continuous audit guidance, and thin lifecycle router each map to Tasks 1–6.
- Scope: Graph visualization UI, automatic agent dispatch, checkpoint database, and external graph framework are explicitly excluded.
- Type consistency: `TaskGraphResult`, `LifecycleSignal`, `LifecycleState`, and `LifecycleRoute` names are stable across producer and consumer tasks.
- Gate consistency: Phase 3 approval statuses and `TASK-DOC-GATE-001` match the live package contract.
- Placeholder scan: no implementation placeholder remains; every task has exact files, test command, expected result, public interface, and commit scope.
