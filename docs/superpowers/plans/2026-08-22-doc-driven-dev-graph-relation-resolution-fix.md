# Doc-Driven Dev Graph Relation Resolution Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve task-document-relative relations and accept existing repository-local non-Markdown references without weakening Artifact Graph fail-closed behavior.

**Architecture:** Keep relation IDs authoritative by resolving exact IDs before paths. Add owner-aware path normalization inside the Task Graph, and separate Artifact Graph node resolution from local-file existence so only genuinely missing local targets produce `broken-relation`; then regenerate the distributed CLIs from TypeScript sources.

**Tech Stack:** TypeScript, Node.js 20, `node:test`, `gray-matter`, esbuild, pnpm, RTK.

## Global Constraints

- Run `rtk mise activate pwsh | Out-String | Invoke-Expression` once before repository commands in each implementation session.
- Prefix every command with `rtk`, including every segment of a command chain.
- Preserve ID-first resolution for Task Graph and Artifact Graph relations.
- Treat explicit `./` and `../` references as document-relative; retain repository-root canonical paths such as `docs/plans/0001-plan.md`.
- A repository-local file outside the canonical Markdown artifact set remains `external: false` with `to: null`; its existence suppresses `broken-relation` but does not create an Artifact Graph node.
- Missing local files, malformed relations, duplicate IDs, cycles, and unresolved task references must continue to fail closed.
- Edit runtime TypeScript under `scripts/doc-driven-dev/src/skills/` first; never hand-edit generated JavaScript.
- Regenerate and commit the synchronized distributed scripts under `packages/doc-driven-dev/.apm/skills/`.
- Preserve the user's existing `.codex/config.toml` and `.serena/` worktree changes.
- No public documentation change is required because the intended document-relative relation behavior is already documented; update English and Japanese docs together only if implementation reveals a contract change.

---

## File Map

- Modify `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/task_graph.ts`: normalize filesystem relations relative to their owning task document while retaining exact-ID priority.
- Modify `scripts/doc-driven-dev/tests/doc-driven-dev-graph-task-graph.test.ts`: add regressions for relative `implements`, `depends-on`, and `blocks` paths.
- Modify `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/artifact_graph.ts`: distinguish unresolved Artifact Graph nodes from existing local files.
- Create `scripts/doc-driven-dev/tests/doc-driven-dev-graph-artifact-graph.test.ts`: directly test existing and missing non-Markdown local references.
- Modify `scripts/doc-driven-dev/tests/doc-driven-dev-graph-cli.test.ts`: exercise the generated Task Graph and router bundles with the combined fixture.
- Regenerate `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/build_task_graph.js`: bundle the Task Graph fix.
- Regenerate `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/route_graph.js`: bundle both relation fixes into runtime routing.
- Regenerate `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/inspect_graph.js`: keep the inspection projection synchronized with `artifact_graph.ts` and `task_graph.ts`.

---

### Task 1: Resolve Task Graph file relations relative to their owner

**Files:**

- Modify: `scripts/doc-driven-dev/tests/doc-driven-dev-graph-task-graph.test.ts`
- Modify: `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/task_graph.ts`

**Interfaces:**

- Consumes: `normalizeRepoPath(cwd: string, target: string): string`, `ParsedTask.file`, `IndexedTasks.byId`, and `IndexedTasks.byPath`.
- Produces: private `normalizeOwnedRepoPath(cwd: string, ownerFile: string, reference: string): string`; updated private `resolveReference(cwd: string, owner: ParsedTask, reference: string, index: IndexedTasks): ParsedTask | undefined`.
- Preserves: `buildTaskGraph(options: BuildTaskGraphOptions): TaskGraphResult` and every public JSON shape.

- [ ] **Step 1: Add failing owner-relative Task Graph tests**

Append these tests to `scripts/doc-driven-dev/tests/doc-driven-dev-graph-task-graph.test.ts`:

```ts
test("buildTaskGraph resolves document-relative implements and depends-on paths", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-relative-"));
  fs.mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/plans/0001-plan.md"), "# Plan\n", "utf8");
  writeTask(repo, "TASK-0001", {
    status: "done",
    dependsOn: [],
    implements: ["../plans/0001-plan.md"],
  });
  writeTask(repo, "TASK-0002", {
    status: "todo",
    dependsOn: ["0001-task.md"],
    implements: ["../plans/0001-plan.md"],
  });

  const result = buildTaskGraph({ cwd: repo, plan: "docs/plans/0001-plan.md" });

  assert.deepEqual(result.nodes.map((node) => node.id), ["TASK-0001", "TASK-0002"]);
  assert.deepEqual(result.edges, [{ from: "TASK-0001", to: "TASK-0002" }]);
  assert.deepEqual(result.runnable, ["TASK-0002"]);
  assert.deepEqual(result.issues, []);
});

test("buildTaskGraph resolves document-relative blocks paths", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "task-graph-relative-blocks-"));
  fs.mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/plans/0001-plan.md"), "# Plan\n", "utf8");
  writeTask(repo, "TASK-0001", {
    status: "todo",
    dependsOn: [],
    blocks: ["0002-task.md"],
    implements: ["../plans/0001-plan.md"],
  });
  writeTask(repo, "TASK-0002", {
    status: "todo",
    dependsOn: [],
    implements: ["../plans/0001-plan.md"],
  });

  const result = buildTaskGraph({ cwd: repo, plan: "docs/plans/0001-plan.md" });

  assert.deepEqual(result.edges, [{ from: "TASK-0001", to: "TASK-0002" }]);
  assert.deepEqual(result.issues, []);
});
```

- [ ] **Step 2: Run the focused test and confirm the reported failure**

Run:

```powershell
rtk pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-graph-task-graph.test.ts
```

Expected: the two new tests fail. The first reports an empty node list or `plan-has-no-tasks`; the second cannot produce the expected `blocks` edge.

- [ ] **Step 3: Add owner-aware path normalization**

Add this private helper immediately after `normalizeRepoPath` in `task_graph.ts`:

```ts
function normalizeOwnedRepoPath(cwd: string, ownerFile: string, reference: string): string {
  const ownerCandidate = path.resolve(cwd, path.dirname(ownerFile), reference);
  const rootCandidate = path.resolve(cwd, reference);
  const documentRelative = reference.startsWith("./")
    || reference.startsWith("../")
    || reference === "."
    || reference === ".."
    || (!reference.includes("/") && !reference.includes("\\"));
  const chosen = documentRelative ? ownerCandidate : rootCandidate;
  return normalizeRepoPath(cwd, chosen);
}
```

Explicit relative paths and bare filenames such as `0001-task.md` resolve only from their owner document, while canonical repository paths such as `docs/plans/0001-plan.md` resolve only from the repository root. Missing declared targets remain unresolved and never fall back to the opposite base.

- [ ] **Step 4: Use the owner-aware helper for `implements`**

Replace the `implementsValues` mapping in `readTaskDocuments` with:

```ts
const implementsValues = relationValues(relationObject, "implements", parseIssues, id, relativeFile)
  .map((target) => normalizeOwnedRepoPath(cwd, relativeFile, target));
```

- [ ] **Step 5: Pass the owning task through dependency path resolution**

Replace `resolveReference` with:

```ts
function resolveReference(
  cwd: string,
  owner: ParsedTask,
  reference: string,
  index: IndexedTasks,
): ParsedTask | undefined {
  const byId = index.byId.get(reference);
  if (byId) return byId;
  const normalized = normalizeOwnedRepoPath(cwd, owner.file, reference);
  return index.byPath.get(normalized);
}
```

Update `isExistingArtifactReference` so it accepts the owner and resolves the candidate through the same helper:

```ts
function isExistingArtifactReference(
  cwd: string,
  taskDir: string,
  owner: ParsedTask,
  reference: string,
): boolean {
  const candidate = path.resolve(cwd, normalizeOwnedRepoPath(cwd, owner.file, reference));
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return false;
  const taskRoot = path.resolve(cwd, taskDir);
  const candidatePath = path.resolve(candidate);
  const insideTaskDir = candidatePath === taskRoot || candidatePath.startsWith(`${taskRoot}${path.sep}`);
  if (insideTaskDir) return false;
  try {
    const type = matter(fs.readFileSync(candidate, "utf8")).data?.type;
    return ["plan", "spec", "adr", "design"].includes(type);
  } catch {
    return false;
  }
}
```

In `resolveTaskEdges.addReference`, change the two calls to:

```ts
const target = resolveReference(cwd, task, reference, index);
if (!target || !target.id) {
  if (artifactIds.has(reference) || isExistingArtifactReference(cwd, taskDir, task, reference)) return;
```

- [ ] **Step 6: Run the Task Graph tests and confirm compatibility cases pass**

Run:

```powershell
rtk pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-graph-task-graph.test.ts
```

Expected: all tests pass, including existing repository-root paths, artifact IDs, exact task IDs, duplicate-ID checks, and the two new owner-relative tests.

- [ ] **Step 7: Commit the independently testable Task Graph fix**

```powershell
rtk git add scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/task_graph.ts scripts/doc-driven-dev/tests/doc-driven-dev-graph-task-graph.test.ts
rtk git commit -m "fix: resolve task graph relations from owner documents"
```

---

### Task 2: Separate Artifact Graph node resolution from local-file existence

**Files:**

- Create: `scripts/doc-driven-dev/tests/doc-driven-dev-graph-artifact-graph.test.ts`
- Modify: `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/artifact_graph.ts`

**Interfaces:**

- Consumes: private `localTarget(cwd: string, owner: ArtifactRecord, value: string): { path: string; exists: boolean }` and public `projectArtifactGraph(options: ArtifactGraphOptions): ArtifactGraph`.
- Produces: unchanged `ArtifactEdge` values for local non-artifact files (`to: null`, `external: false`) and no issue when `localTarget.exists` is true.
- Preserves: external URI handling, canonical Markdown ID/path edges, duplicate-ID blockers, malformed-relation blockers, and missing-file blockers.

- [ ] **Step 1: Create a focused failing Artifact Graph regression test**

Create `scripts/doc-driven-dev/tests/doc-driven-dev-graph-artifact-graph.test.ts` with:

```ts
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const matter = require("gray-matter");
const {
  projectArtifactGraph,
} = require("../src/skills/doc-driven-dev-graph/scripts/lib/artifact_graph.ts");

function writeArtifact(repo: string, relativePath: string, data: Record<string, unknown>): void {
  const file = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify("# Artifact\n", data), "utf8");
}

test("existing non-Markdown local relations are valid while missing files remain broken", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-graph-local-file-"));
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/example.py"), "VALUE = 1\n", "utf8");
  writeArtifact(repo, "docs/specs/0001-spec.md", {
    id: "SPEC-0001",
    type: "spec",
    status: "approved",
    relations: {
      source: ["../../src/example.py", "../../src/missing.py"],
    },
  });

  const graph = projectArtifactGraph({ cwd: repo });
  const sourceEdges = graph.edges.filter((edge: { relation: string }) => edge.relation === "source");

  assert.equal(sourceEdges.length, 2);
  assert.ok(sourceEdges.every((edge: { to: string | null; external: boolean }) => (
    edge.to === null && edge.external === false
  )));
  assert.equal(graph.issues.some((issue: { message: string }) => issue.message.includes("src/example.py")), false);
  assert.equal(graph.issues.some((issue: { message: string }) => issue.message.includes("src/missing.py")), true);
  assert.equal(graph.issues.filter((issue: { code: string }) => issue.code === "broken-relation").length, 1);
});
```

- [ ] **Step 2: Run the focused test and verify the existing file is misclassified**

Run:

```powershell
rtk pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-graph-artifact-graph.test.ts
```

Expected: FAIL because both `src/example.py` and `src/missing.py` currently produce `broken-relation` issues.

- [ ] **Step 3: Gate `broken-relation` on actual local-file absence**

Replace the unresolved-target block in `scanArtifactGraph` with:

```ts
const target = resolveArtifactRelation(cwd, source, value, records);
edges.push({ from: source.path, to: target?.path ?? null, relation, kind, external: false });
if (!target) {
  const local = localTarget(cwd, source, value);
  if (!local.exists) {
    issues.push({
      code: "broken-relation",
      message: `Broken ${relation} relation from ${source.path} to ${value}${local.path ? ` (${local.path})` : ""}`,
    });
  }
}
```

Do not create an `ArtifactRecord` or a graph node for the existing Python file.

- [ ] **Step 4: Run focused and existing Graph State regressions**

Run:

```powershell
rtk pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-graph-artifact-graph.test.ts tests/doc-driven-dev-graph-state.test.ts tests/doc-driven-dev-graph-routing-contract.test.ts
```

Expected: all tests pass. Existing malformed relations and genuinely unresolved artifact references still populate `broken-relation` and hard blockers.

- [ ] **Step 5: Commit the independently testable Artifact Graph fix**

```powershell
rtk git add scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/artifact_graph.ts scripts/doc-driven-dev/tests/doc-driven-dev-graph-artifact-graph.test.ts
rtk git commit -m "fix: accept existing local artifact references"
```

---

### Task 3: Prove bundled CLI parity and regenerate distributed scripts

**Files:**

- Modify: `scripts/doc-driven-dev/tests/doc-driven-dev-graph-cli.test.ts`
- Regenerate: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/build_task_graph.js`
- Regenerate: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/route_graph.js`
- Regenerate: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/inspect_graph.js`

**Interfaces:**

- Consumes: generated CLI JSON contracts from `build_task_graph.js` and `route_graph.js`.
- Produces: source/generated behavioral parity for owner-relative Task Graph relations and existing non-Markdown local references.
- Preserves: route schema version 2, Task Graph schema version 1, one-edge routing, and hard-blocker precedence for real graph issues.

- [ ] **Step 1: Add the generated Task Graph CLI path**

Near the existing `generatedCli` constant in `doc-driven-dev-graph-cli.test.ts`, add:

```ts
const generatedTaskGraphCli = path.resolve(
  __dirname,
  "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/build_task_graph.js",
);
```

- [ ] **Step 2: Add a combined generated-bundle regression test**

Append this test to `doc-driven-dev-graph-cli.test.ts`:

```ts
test("generated graph CLIs resolve owner-relative tasks and existing local files", () => {
  const repo = completeRepo(["done", "todo"]);
  writeArtifact(repo, "docs/tasks/0001-task.md", {
    id: "TASK-0001", type: "task", status: "done", title: "TASK-0001",
    relations: { implements: ["../plans/0001-graph.md"] },
  }, "# Task\n\n## Verification\n\n- [x] complete\n");
  writeArtifact(repo, "docs/tasks/0002-task.md", {
    id: "TASK-0002", type: "task", status: "todo", title: "TASK-0002",
    relations: {
      implements: ["../plans/0001-graph.md"],
      "depends-on": ["0001-task.md"],
    },
  }, "# Task\n\n## Verification\n\n- [ ] pending\n");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/example.py"), "VALUE = 1\n", "utf8");
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Graph",
    relations: { source: ["../../src/example.py"] },
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph\n");

  const taskResult = runCli(generatedTaskGraphCli, repo, [
    "--plan", "docs/plans/0001-graph.md", "--cwd", repo, "--json",
  ]);
  assert.equal(taskResult.status, 0, taskResult.stderr);
  const taskGraph = JSON.parse(taskResult.stdout);
  assert.deepEqual(taskGraph.nodes.map((node: { id: string }) => node.id), ["TASK-0001", "TASK-0002"]);
  assert.deepEqual(taskGraph.edges, [{ from: "TASK-0001", to: "TASK-0002" }]);
  assert.deepEqual(taskGraph.runnable, ["TASK-0002"]);
  assert.deepEqual(taskGraph.issues, []);

  const routeResult = runCli(generatedCli, repo, [
    "--graph", canonicalGraphPath(),
    "--current", "task-graph",
    "--focus", "PLAN-0001",
    "--cwd", repo,
    "--json",
  ]);
  assert.equal(routeResult.status, 0, routeResult.stderr);
  const route = JSON.parse(routeResult.stdout);
  assert.equal(route.status, "edge");
  assert.equal(route.next, "implementation");
  assert.equal(route.blockers.some((blocker: string) => blocker.startsWith("broken-relation:")), false);
  assert.deepEqual(route.taskGraph.edges, [{ from: "TASK-0001", to: "TASK-0002" }]);
  assert.deepEqual(route.taskGraph.runnable, ["TASK-0002"]);
});
```

- [ ] **Step 3: Run the generated-bundle test before rebuilding**

Run:

```powershell
rtk pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-graph-cli.test.ts
```

Expected: the new test fails against stale generated JavaScript with `plan-has-no-tasks` and/or the `src/example.py` `broken-relation`. Existing CLI tests remain green.

- [ ] **Step 4: Regenerate distributed JavaScript from TypeScript sources**

Run:

```powershell
rtk pnpm --dir scripts/doc-driven-dev run build:scripts
```

Expected: the build completes successfully and updates the generated Task Graph, route, and inspection scripts. Do not manually edit their bundled contents.

- [ ] **Step 5: Re-run focused source and generated tests**

Run:

```powershell
rtk pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-graph-task-graph.test.ts tests/doc-driven-dev-graph-artifact-graph.test.ts tests/doc-driven-dev-graph-state.test.ts tests/doc-driven-dev-graph-routing-contract.test.ts tests/doc-driven-dev-graph-cli.test.ts
```

Expected: all selected tests pass; the generated route selects `task-graph-to-implementation`, and only the missing-file fixture reports `broken-relation`.

- [ ] **Step 6: Run the complete package validation**

Run each command separately:

```powershell
rtk pnpm --dir scripts/doc-driven-dev test
rtk pnpm --dir scripts/doc-driven-dev run lint:md
rtk git diff --check
rtk git status --short
```

Expected:

- Full `doc-driven-dev` test suite passes with zero failures.
- Markdown lint passes; no localized documentation was changed.
- `git diff --check` reports no whitespace errors.
- Status contains only the intended TypeScript, test, and generated JavaScript changes plus the user's pre-existing `.codex/config.toml` and `.serena/` entries.

- [ ] **Step 7: Inspect generated scope and commit bundle parity**

Run:

```powershell
rtk git diff --stat
rtk git diff -- scripts/doc-driven-dev/tests/doc-driven-dev-graph-cli.test.ts packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/build_task_graph.js packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/route_graph.js packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/inspect_graph.js
```

Expected: generated changes correspond to `normalizeOwnedRepoPath`, owner-aware dependency resolution, and the `local.exists` guard. Investigate any unrelated generated delta before staging.

Commit only the intended files:

```powershell
rtk git add scripts/doc-driven-dev/tests/doc-driven-dev-graph-cli.test.ts packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/build_task_graph.js packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/route_graph.js packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/inspect_graph.js
rtk git commit -m "test: verify bundled graph relation resolution"
```

---

## Acceptance Mapping

- Relative `implements` selects its Plan: Task 1 test 1; Task 3 generated test.
- Relative filename `depends-on` produces a dependency edge: Task 1 test 1; Task 3 generated test.
- Relative filename `blocks` produces the correct direction: Task 1 test 2.
- Existing non-Markdown local file does not become broken: Task 2 focused test; Task 3 router test.
- Missing local file remains broken: Task 2 focused test.
- Existing ID and canonical Markdown path behavior does not regress: Task 1 full focused suite and Task 2 Graph State suite.
- Bundled Task Graph and router match source behavior: Task 3 generated CLI test and full CLI suite.
- Fail-closed policy remains intact: existing malformed-relation, duplicate-ID, cycle, unresolved-reference, and hard-blocker tests remain unchanged and passing.

## Self-Review Results

- Spec coverage: all six requested acceptance cases plus `blocks` owner-relative resolution and generated inspection synchronization are assigned to explicit tasks.
- Placeholder scan: no forbidden placeholder, deferred implementation, generic error-handling instruction, or unspecified test remains.
- Type consistency: `normalizeOwnedRepoPath`, `resolveReference`, `localTarget`, `ArtifactEdge`, `TaskGraphResult`, and generated CLI JSON field names match the current source contracts.
