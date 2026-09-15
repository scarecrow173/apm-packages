# Commit-Required Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the documented Git commit boundary an executable caller-side gate in `doc-driven-dev-graph`: nodes can declare `commitGate`, `GraphRoute` carries the declaration, and the Run-to-Yield caller yields `commit-required` when a gated checkpoint ends with new uncommitted changes.

**Architecture:** Keep commit boundaries out of routing (a graph node/edge/checkpoint is still not a commit boundary). Add `commitGate?: boolean` to the node schema, project it onto `GraphRoute`, and add a deterministic worktree check to the caller protocol: baseline `{ head, dirty }` is captured at edge start; before a gated checkpoint completes, the caller re-runs `git status --porcelain` / `git rev-parse HEAD` and yields `commit-required` when HEAD is unchanged and the dirty set grew. A declared `commit-waived` runtime signal lets the user explicitly bypass the gate. `implementation-flow`'s `completed` outcome now implies the slice is committed; otherwise it returns `yield`/`commit-required`.

**Tech Stack:** TypeScript (tsx, zod, js-yaml), Node `node:test`, generated JS via `pnpm run build:scripts`, Markdown contract docs (English + Japanese mirrors).

## Global Constraints

- Run repository-managed tools through `mise exec --` (e.g. `mise exec -- pnpm --dir scripts/doc-driven-dev test`).
- Every English doc change MUST be mirrored in the sibling `.ja.md` file in the same task (package AGENTS.md rule).
- Runtime behavior changes are made in `scripts/doc-driven-dev/src/**` (TypeScript), then `mise exec -- pnpm --dir scripts/doc-driven-dev run build:scripts` regenerates `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/*.js`. Never hand-edit generated JS.
- Validation before claiming completion: `mise exec -- pnpm --dir scripts/doc-driven-dev test` and `mise exec -- pnpm --dir scripts/doc-driven-dev run lint:md`, plus `git diff --check`.
- Commit message conventions follow existing repo history (Conventional Commits); one logical change per commit.
- The gate must not deadlock intentional WIP: `commit-waived` is a declared runtime signal that skips the gate and is recorded in the run trace.

---

### Task 1: `commitGate` node declaration — schema, router, inspector, canonical YAML

**Files:**
- Modify: `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/graph_definition.ts`
- Modify: `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/graph_router.ts`
- Modify: `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/graph_inspector.ts`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml`
- Test: `scripts/doc-driven-dev/tests/doc-driven-dev-graph-definition-contract.test.ts`
- Test: `scripts/doc-driven-dev/tests/doc-driven-dev-graph-cli.test.ts` (exact GraphRoute key/shape assertions around lines 179-266)
- Test: `scripts/doc-driven-dev/tests/doc-driven-dev-graph-inspector.test.ts`

**Interfaces:**
- Produces: `GraphNode.commitGate?: boolean`; `GraphRoute.commitGate: boolean` (true only on `status: "edge"` routes whose destination declares `commitGate: true`; false for terminal/blocked); `GraphInspection.commitGateNodes: string[]`; `InspectedNode.commitGate?: boolean`; Mermaid node label `commitGate`; canonical YAML `implementation.commitGate: true` and `runtimeSignals` gains `commit-waived`.
- Consumes: existing `GraphNode`, `GraphRoute`, `GraphInspection` shapes.

- [ ] **Step 1: Write the failing tests**

In `doc-driven-dev-graph-definition-contract.test.ts`, add to the existing `distributedGraph` test:

```ts
assert.equal(graph.nodes.implementation.commitGate, true);
assert.equal(graph.nodes.briefing.commitGate, undefined);
assert.ok(graph.runtimeSignals.includes("commit-waived"));
```

Add a new test in the same file:

```ts
test("parses commitGate on nodes and rejects non-boolean values", () => {
  const withGate = validFixture.replace(
    "  done: { kind: terminal }",
    "  done: { kind: terminal, commitGate: true }",
  );
  assert.equal(parseGraphDefinition(withGate).nodes.done.commitGate, true);
  const invalid = validFixture.replace(
    "  done: { kind: terminal }",
    "  done: { kind: terminal, commitGate: \"yes\" }",
  );
  assert.throws(() => parseGraphDefinition(invalid), /commitGate/);
});
```

In `doc-driven-dev-graph-inspector.test.ts`, add a test asserting the canonical definition reports the gate:

```ts
test("reports commitGate nodes in JSON inspection and Mermaid labels", () => {
  const definition = loadGraphDefinition(canonicalPath); // same path helper already used in this file
  const inspection = inspectGraphDefinition(definition);
  assert.deepEqual(inspection.commitGateNodes, ["implementation"]);
  const implementation = inspection.nodes.find((node) => node.nodeId === "implementation");
  assert.equal(implementation?.commitGate, true);
  const mermaid = renderGraphMermaid(inspection);
  assert.match(mermaid, /implementation<br\/>kind: delegate<br\/>delegate: implementation-flow<br\/>commitGate/);
});
```

Check the top of `doc-driven-dev-graph-inspector.test.ts` for the existing canonical-path constant name (it may be `canonicalGraphPath` or similar) and reuse it; also confirm the file already imports `loadGraphDefinition`, `inspectGraphDefinition`, `renderGraphMermaid`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-graph-definition-contract.test.ts tests/doc-driven-dev-graph-inspector.test.ts`
Expected: FAIL — `nodes.implementation.commitGate` is undefined, `commit-waived` not in runtimeSignals, `commitGateNodes` missing.

- [ ] **Step 3: Implement schema, router, inspector, and YAML changes**

`graph_definition.ts` — extend type and schema:

```ts
export type GraphNode = {
  kind: "action" | "delegate" | "audit" | "terminal";
  delegate?: string;
  audits?: string[];
  requiresGates?: string[];
  commitGate?: boolean;
};
```

```ts
const graphNodeSchema = z.object({
  kind: z.enum(["action", "delegate", "audit", "terminal"]),
  delegate: z.string().min(1).optional(),
  audits: z.array(z.string().min(1)).optional(),
  requiresGates: z.array(z.string().min(1)).optional(),
  commitGate: z.boolean().optional(),
}).strict();
```

`graph_router.ts` — add the field to `GraphRoute`, the `routeResult` pick, and all call sites:

```ts
export type GraphRoute = {
  schemaVersion: 2;
  graphId: string;
  current: GraphNodeId;
  next: GraphNodeId;
  edgeId: string | null;
  condition: GraphConditionKey | "terminal" | "blocked";
  status: "edge" | "terminal" | "blocked";
  delegate: string | null;
  requiredAudits: string[];
  blockers: string[];
  taskGraph: TaskGraphResult | null;
  commitGate: boolean;
};
```

In `routeResult`, extend the `result` parameter type to `Pick<GraphRoute, "next" | "edgeId" | "condition" | "status" | "delegate" | "requiredAudits" | "commitGate">` and emit `commitGate: result.commitGate` in the returned object.

In `selectedRoute` add `commitGate: destination?.commitGate === true` to the `routeResult` argument. In the three blocked call sites and the terminal call site add `commitGate: false`.

`graph_inspector.ts`:

```ts
type InspectedNode = {
  nodeId: string;
  kind: GraphNode["kind"];
  delegate?: string;
  audits: string[];
  commitGate?: boolean;
};
```

Add `commitGateNodes: string[];` to `GraphInspection`. In the `nodes` map add `...(node.commitGate === true ? { commitGate: true } : {})`. After `audits` is computed:

```ts
const commitGateNodes = nodes
  .filter((node) => node.commitGate === true)
  .map((node) => node.nodeId);
```

Include `commitGateNodes` in the returned object. In `renderNode`, after the delegate label line add:

```ts
if (node.commitGate === true) labels.push("commitGate");
```

`graphs/doc-driven-dev.yaml` — two edits:

```yaml
runtimeSignals: [focus-required, implementation-verified, exit-audit-pass, commit-waived]
```

```yaml
  implementation: { kind: delegate, delegate: implementation-flow, commitGate: true }
```

- [ ] **Step 4: Update existing exact-shape assertions**

`doc-driven-dev-graph-cli.test.ts` asserts the full GraphRoute key list around line 180 and full-route `deepEqual` objects around lines 184-266. Add `"commitGate"` to the sorted key list and `commitGate: false` (or `true` when the route destination is `implementation`) to each expected route literal. Run the CLI test and fix each remaining shape assertion until green:

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-graph-cli.test.ts`

- [ ] **Step 5: Run the new and updated tests**

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-graph-definition-contract.test.ts tests/doc-driven-dev-graph-inspector.test.ts tests/doc-driven-dev-graph-cli.test.ts tests/doc-driven-dev-graph-router.test.ts`
Expected: PASS.

- [ ] **Step 6: Rebuild generated JavaScript**

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev run build:scripts`
Then verify the generated output contains the field: `grep -n "commitGate" packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/route_graph.js` should print matches.

- [ ] **Step 7: Commit**

```bash
git add scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts scripts/doc-driven-dev/tests
git commit -m "feat(doc-driven-dev): declare commitGate nodes and surface it on GraphRoute"
```

---

### Task 2: Caller contract — `commit-required` yield and commit-gate protocol (EN + JA)

**Files:**
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/references/execution-contract.md` and `.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/references/execution-outcome-contract.md` and `.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/references/graph-contract.md` and `.ja.md`

**Interfaces:**
- Consumes: `GraphRoute.commitGate` and `commit-waived` signal from Task 1.
- Produces: yield reason `commit-required`; `GraphRunHandoff.pending.commitBaseline`; baseline comparison rule; delegate `yield` reason `commit-required`.

- [ ] **Step 1: Update the selected-edge protocol in `execution-contract.md`**

Insert a new step between current step 7 ("yield without claiming...") and step 8 ("Persist completion...") — renumber the list accordingly. New step text:

```markdown
8. When the selected edge's destination node declares `commitGate` and the
   caller did not receive the declared `commit-waived` signal, capture the
   worktree baseline before running audits: `head` from `git rev-parse HEAD`
   (`null` when the repository has no commits) and sorted `dirty` lines from
   `git status --porcelain`. Retain it as `commitBaseline` for this edge.
```

Then append a new step after "Mark the edge checkpoint complete..." — actually place the gate check BEFORE checkpoint completion, so insert before that step:

```markdown
10. Commit gate: when `commitBaseline` was captured, re-run the same two git
    commands. The gate passes when `head` changed since baseline, or when every
    current `dirty` entry was already present in the baseline. Otherwise yield
    `commit-required`: record the pending edge with `evidenceRecorded` as
    completed-so-far and `commitBaseline`, and stop without marking the
    checkpoint complete. If git is unavailable or `cwd` is not a repository,
    the gate cannot be evaluated; yield `authority-required` instead. A caller
    that received the declared `commit-waived` signal skips this gate and
    records the waiver in the run trace.
```

(Renumber subsequent steps.)

- [ ] **Step 2: Add the yield-table row and handoff field**

In the Phase 1 yield table add:

```markdown
| commit-gated edge checkpoint ends with new uncommitted changes and no `commit-waived` signal | `commit-required` | Never |
```

In "Checkpoint, resume, and duplicate effects" add:

```markdown
- A `commit-required` yield retains the pending edge with its
  `commitBaseline` (`{ head, dirty }`). Resume re-evaluates the gate against
  the same baseline; it passes once the caller or user has committed the new
  changes (HEAD advanced) or the new dirty entries were resolved. The gate is
  evaluated after evidence persistence, so the checkpoint evidence Markdown is
  part of the logical change being committed.
- `commitBaseline` is stored in `pending`; it is caller handoff metadata, not
  Graph State.
- Files already dirty at baseline remain the user's responsibility: a delegate
  edit that leaves the same porcelain entry is not detected by this gate. This
  is an accepted Phase 1 limitation; do not weaken it silently.
```

Update the "Git commit boundary" section's final paragraph to reference enforcement:

```markdown
Commit boundaries remain logical-change based and are not derived from graph
structure. What changed is enforcement: a node may declare `commitGate`, which
makes every edge checkpoint into that node subject to the caller-side worktree
check above, and `commit-required` is an explicit yield reason rather than
prose guidance.
```

- [ ] **Step 3: Update `execution-outcome-contract.md`**

- `GraphRunResult.reason` union: add `"commit-required"`.
- `GraphRunHandoff.pending` type: add `commitBaseline: { head: string | null; dirty: string[] } | null;`.
- Yield-status required `reason` list: add `commit-required` to `approval-required`, `input-required`, `authority-required`, `unrecoverable-blocker`.
- Delegate-meanings table, `implementation-flow` row, `yield` column: prepend "`commit-required` when its slice produced changes it cannot commit within granted authority;".

- [ ] **Step 4: Update `graph-contract.md`**

In the node bullet list add:

```markdown
- A node may declare `commitGate: true`; every edge whose destination is that
  node is subject to the caller-side commit gate defined in
  [execution-contract.md](execution-contract.md). The flag declares enforcement,
  not a commit boundary: commit boundaries remain logical-change based.
```

In the GraphRoute field table add:

```markdown
| `commitGate` | `true` when the selected destination declares `commitGate`; `false` for terminal/blocked routes. |
```

- [ ] **Step 5: Mirror all edits into the `.ja.md` siblings**

Apply the same structural changes to `execution-contract.ja.md`, `execution-outcome-contract.ja.md`, `graph-contract.ja.md` in matching sections/order. Keep technical tokens (`commitGate`, `commit-required`, `commitBaseline`, `commit-waived`, `git status --porcelain`, yield reason names) in English; prose in Japanese matching the existing style.

- [ ] **Step 6: Lint and commit**

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev run lint:md`
Expected: PASS (fix any markdownlint findings in the touched files).

```bash
git add packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/references
git commit -m "docs(doc-driven-dev): make commit-required an explicit caller yield and gate"
```

---

### Task 3: Entry-point and delegate contracts — SKILL.md, inspection doc, implementation-flow (EN + JA)

**Files:**
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/SKILL.md` and `SKILL.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/references/graph-inspection.md` and `.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md` and `SKILL.ja.md`
- Modify: `packages/doc-driven-dev/AGENTS.md` and `AGENTS.ja.md`

**Interfaces:**
- Consumes: `commitGate`, `commit-required`, `commit-waived`, `commitGateNodes` from Tasks 1-2.
- Produces: delegate rule — `implementation-flow` `completed` implies committed work; uncommittable work returns `yield`/`commit-required`.

- [ ] **Step 1: Update `SKILL.md` "Git commit boundary" section**

Replace the section body with:

```markdown
## Git commit boundary

Across every phase, the Git commit boundary is a reviewable logical change,
not a Graph node, edge, phase, checkpoint, artifact type, or Task Graph
projection. A task is an implementation scope boundary and may contain one or
more commits. The canonical boundary policy is in
[`references/execution-contract.md`](references/execution-contract.md); commit
message conventions remain owned by existing Git tooling and repository rules.

Enforcement is declared, not advisory: a node may declare `commitGate: true`.
`GraphRoute.commitGate` carries the declaration to the caller, which captures a
worktree baseline at edge start and yields `commit-required` when the gated
checkpoint would complete with new uncommitted changes. The canonical graph
declares the gate on `implementation`. The declared `commit-waived` runtime
signal is the only bypass and is recorded in the run trace.
```

- [ ] **Step 2: Update `graph-inspection.md`**

In the Inspection JSON field table add:

```markdown
| `commitGateNodes` | Sorted node IDs declaring `commitGate: true`. |
```

Extend the `nodes` row to mention `commitGate`, and the Mermaid section's label sentence to include `commitGate` among the optional node labels (after `delegate`).

- [ ] **Step 3: Update `implementation-flow/SKILL.md`**

In "Graph Effect Outcome" change the `completed`/`yield` sentence to:

```markdown
Use `completed` only for a verified task slice whose logical changes are
committed and whose Implementation Record is complete, `retry` for declared
spec/design/constraint repair, `yield` with `commit-required` when the slice
produced changes that cannot be committed within granted authority, `yield`
with `authority-required` for an irreversible effect without permission, and
`yield` with `unrecoverable-blocker` when no declared safe repair exists.
```

Add a new hard gate in the Hard Gates section:

```markdown
<HARD-GATE>
When the dispatching `GraphRoute` declares `commitGate`, a task slice is not
`completed` while its logical changes remain uncommitted. Commit through the
resolved commit tooling (`git-commit` when selected by the profile, otherwise
the repository's commit conventions); if committing is outside granted
authority, return `yield`/`commit-required` instead of `completed`.
</HARD-GATE>
```

In Phase B, note that when `route.commitGate === true` a commit-capable Tooling skill is required rather than conditional: add to step 7 ("Add Domain/Tooling skills"):

```markdown
   - **If `GraphRoute.commitGate` is true:** a commit-capable Tooling skill
     (for example `git-commit`) is mandatory in the active stack; record the
     selection in the announced stack.
```

- [ ] **Step 4: Update package `AGENTS.md` runtime contract**

In the delegate-bindings or condition/rules section add one line:

```markdown
`commitGate` nodes require the caller-side commit check before their edge
checkpoint completes; `commit-required` is an explicit yield reason and
`commit-waived` is the declared bypass signal.
```

- [ ] **Step 5: Mirror into `.ja.md` siblings**

Mirror the same edits in `SKILL.ja.md`, `graph-inspection.ja.md`, `implementation-flow/SKILL.ja.md`, and `AGENTS.ja.md`, matching section placement and keeping technical tokens in English.

- [ ] **Step 6: Lint, test residue, and commit**

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev run lint:md` and `mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-suite.test.ts tests/doc-suite-regressions.test.ts`
Expected: PASS. If the doc-suite residue assertions pin section text that changed, update those assertions in the same edit.

```bash
git add packages/doc-driven-dev
git commit -m "docs(doc-driven-dev): wire commit gate into entrypoint and implementation-flow contracts"
```

---

### Task 4: Model the gate in the run-to-yield harness and add behavior tests

**Files:**
- Modify: `scripts/doc-driven-dev/tests/doc-driven-dev-graph-run-to-yield.test.ts`

**Interfaces:**
- Consumes: `route.commitGate`, `commitBaseline` shape, `commit-required` yield reason.
- Produces: harness semantics the contract documents — baseline capture at edge start, gate evaluation before checkpoint completion, `pending.commitBaseline` resume.

- [ ] **Step 1: Extend harness types and add git helpers**

Add `"commit-required"` to `YieldReason` and to `EffectYieldReason` (so delegates can emit it), and to the allowed `outcome.reason` list in `validateEffectOutcome` (line ~429).

Add after the existing helpers:

```ts
type CommitBaseline = { head: string | null; dirty: string[] };

function git(repo: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function gitInit(repo: string): void {
  git(repo, ["init", "-q"]);
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "baseline"]);
}

function commitAll(repo: string): void {
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "checkpoint"]);
}

function captureBaseline(repo: string): CommitBaseline {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" });
  if (status.status !== 0) throw new Error(`git status failed: ${status.stderr}`);
  return {
    head: head.status === 0 ? head.stdout.trim() : null,
    dirty: status.stdout.split("\n").filter((line) => line.length > 0).sort(),
  };
}

function commitGatePasses(baseline: CommitBaseline, after: CommitBaseline): boolean {
  if (after.head !== baseline.head) return true;
  const baselineDirty = new Set(baseline.dirty);
  return after.dirty.every((entry) => baselineDirty.has(entry));
}
```

Extend `PendingEdge` with `commitBaseline: CommitBaseline | null`, and `ScenarioHandoff.pending` accordingly. Call `gitInit(repo)` at the end of `fixtureRepo` (before `return repo`) so every fixture is a commit-ready repository.

- [ ] **Step 2: Wire the gate into `runScenario`**

In `savePending`, accept and store `commitBaseline` (default `null`). In the step loop, after the resume-receipt validation and before the audit loop:

```ts
const commitBaseline = resumingPending?.commitBaseline
  ?? (route.commitGate && !signals.has("commit-waived") ? captureBaseline(options.repo) : null);
```

After the evidence-recorded block and BEFORE `pending = null; checkpoints.push(route);`:

```ts
if (commitBaseline && !signals.has("commit-waived")) {
  const after = captureBaseline(options.repo);
  if (!commitGatePasses(commitBaseline, after)) {
    yieldReason = "commit-required";
    savePending(route, edgeOutcomes, true, commitBaseline);
    expectYield(step, yieldReason);
    break;
  }
}
```

Persist `commitBaseline` through `pending` in the handoff construction (add it to the `PendingEdge` object literal).

- [ ] **Step 3: Fix existing gated-edge steps to commit**

Every step whose `expectEdge` lands on the gated `implementation` node — `task-graph-to-active-implementation`, `task-graph-to-implementation`, `implementation-retry`, `followup-triage-to-implementation-repair`, `exit-audit-to-implementation-repair` — now leaves the worktree dirty via evidence/task mutations and would yield `commit-required`. Wrap their `applyEvidence` so the mutation is committed:

```ts
applyEvidence: evidence("implementation-retry", (fixture, signals) => {
  updateArtifact(fixture, "docs/tasks/0002-task.md", { status: "done" });
  signals.add("implementation-verified");
  commitAll(fixture);
}),
```

Grep the file for the five edge IDs above and apply `commitAll(fixture)` inside each such step's `applyEvidence` mutation. Run the file to catch any missed case — a missed one fails with unexpected `commit-required`.

- [ ] **Step 4: Write the new behavior tests**

```ts
test("yields commit-required when a gated checkpoint leaves new uncommitted changes", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "task-graph",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "task-graph-to-implementation",
      yield: "commit-required",
      applyEvidence: evidence("task-graph-to-implementation", (fixture) => {
        updateArtifact(fixture, "docs/tasks/0001-task.md", { status: "done" });
      }),
    }],
  });
  assert.equal(result.yieldReason, "commit-required");
  assert.equal(result.checkpoints.length, 0);
  assert.equal(result.handoff.pending?.route.edgeId, "task-graph-to-implementation");
  assert.equal(result.handoff.pending?.evidenceRecorded, true);
  assert.ok(result.handoff.pending?.commitBaseline);

  const resumed = runScenario({
    repo,
    current: "task-graph",
    mode: "run-until-yield",
    resume: result.handoff,
    steps: [{
      expectEdge: "task-graph-to-implementation",
      applyEvidence: (fixture) => { commitAll(fixture); },
    }],
  });
  // Resume re-enters the same edge; the gate passes once HEAD advanced.
});
```

Note: on resume the evidence receipt was already recorded and the commit makes HEAD advance, so the gate passes and the checkpoint completes; assert `resumed.checkpoints.length === 1` and `resumed.current === "implementation"`. The `applyEvidence` on resume is not invoked because `evidenceRecorded` already holds — the commit must happen before resume (call `commitAll(repo)` between the two `runScenario` calls instead of inside the step). Adjust the test accordingly:

```ts
commitAll(repo);
const resumed = runScenario({ repo, current: "task-graph", mode: "run-until-yield", resume: result.handoff, steps: [{ expectEdge: "task-graph-to-implementation" }] });
assert.equal(resumed.checkpoints.length, 1);
assert.equal(resumed.current, "implementation");
```

(Verify `applyEvidence` optionality: when `evidenceRecorded` is already true and the receipt still validates, the step needs no `applyEvidence` — check `hasEvidence` path. If the receipt fails because the commit changed nothing about file contents it should pass since fingerprints hash content, not git state.)

```ts
test("commit-waived signal skips the gate and completes the checkpoint", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "task-graph",
    mode: "run-until-yield",
    signals: ["commit-waived"],
    steps: [{
      expectEdge: "task-graph-to-implementation",
      applyEvidence: evidence("task-graph-to-implementation", (fixture) => {
        updateArtifact(fixture, "docs/tasks/0001-task.md", { status: "done" });
      }),
    }],
  });
  assert.equal(result.yieldReason, null);
  assert.equal(result.checkpoints.length, 1);
});

test("non-gated destinations ignore worktree state", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [{ expectEdge: "probe-to-briefing", applyEvidence: evidence("probe-to-briefing") }],
  });
  assert.equal(result.yieldReason, null);
  assert.equal(result.checkpoints.length, 1);
});
```

- [ ] **Step 5: Run the harness test file**

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-graph-run-to-yield.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/doc-driven-dev/tests/doc-driven-dev-graph-run-to-yield.test.ts
git commit -m "test(doc-driven-dev): model commit gate in run-to-yield harness"
```

---

### Task 5: Full validation sweep

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev test`
Expected: PASS. Fix any assertion that pins the old GraphRoute shape or runtime signal list in the same commit as the fix's cause.

- [ ] **Step 2: Markdown lint**

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev run lint:md`
Expected: PASS.

- [ ] **Step 3: Whitespace/source-distributed alignment check**

Run: `git diff --check` and confirm generated `route_graph.js`/`inspect_graph.js` contain `commitGate` (Task 1 Step 6 already verified; re-check if sources changed later).

- [ ] **Step 4: Final commit (if fixes were needed)**

```bash
git add -A
git commit -m "fix(doc-driven-dev): align contract tests with commit gate"
```

---

## Self-Review Notes

- Spec coverage: declared gate (Task 1), caller yield + resume semantics (Task 2), delegate contract + waiver + inspection surface (Task 3), executable harness proof (Task 4), validation (Task 5). The "graph structure is not a commit boundary" invariant is preserved — the gate enforces checkpoints, it does not redefine boundaries.
- Known accepted limitation (documented in Task 2): files dirty at baseline are not tracked; the gate detects new porcelain entries and HEAD movement only.
- Out of scope: wiring git probing into `route_graph.js` output (would break the "Graph State projects only canonical Markdown" contract); a `commitGate: strict` mode; cross-host recovery.
