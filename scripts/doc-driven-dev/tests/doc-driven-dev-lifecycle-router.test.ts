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

test("missing bootstrap index blocks bootstrap", () => {
  const repo = repoWithApprovedArtifactChain();
  fs.rmSync(path.join(repo, "docs/plans/README.md"));
  const state = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals: [],
  });
  assert.equal(state.gates.bootstrap.status, "fail");
  assert.ok(state.blockers.includes("bootstrap-incomplete"));
});

test("empty repositories leave briefing applicable without a focus blocker", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-empty-"));
  const state = probeLifecycleState({ cwd: repo, focus: [], signals: [] });
  assert.deepEqual(state.blockers, ["bootstrap-incomplete"]);
  assert.notEqual(state.gates.briefing.status, "blocked");
});

test("broken local relations block while external references remain evidence", () => {
  const repo = repoWithApprovedArtifactChain();
  writeArtifact(repo, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph Design",
    relations: {
      "derives-from": [
        "docs/specs/0001-graph.md",
        "docs/adr/0001-graph.md",
        "docs/adr/missing.md",
        "https://example.test/evidence",
      ],
    },
  }, "# Graph Design\n");
  const state = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals: [],
  });
  assert.ok(state.blockers.some((blocker: string) => blocker.startsWith("broken-relation:")));
  assert.equal(state.blockers.some((blocker: string) => blocker.includes("https://example.test")), false);
});

test("task graph issues block planning and surface a routing blocker", () => {
  const repo = repoWithApprovedArtifactChain();
  writeArtifact(repo, "docs/tasks/0001-route.md", {
    id: "TASK-0001", type: "task", status: "todo", title: "Route",
    relations: {
      implements: ["docs/plans/0001-graph-lifecycle.md"],
      "depends-on": ["TASK-9999"],
    },
  }, "# Route\n\n## Verification\n\n- [ ] node --test\n");
  const state = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals: [],
  });
  assert.equal(state.gates.planning.status, "blocked");
  assert.ok(state.gates.planning.reasons.includes("task-graph:missing-task-reference"));
  assert.ok(state.blockers.includes("task-graph-invalid"));
});

test("ambiguous focused relation chains require explicit focus", () => {
  const repo = repoWithApprovedArtifactChain();
  writeArtifact(repo, "docs/designs/0002-other.md", {
    id: "DESIGN-0002", type: "design", status: "approved", title: "Other Design",
    relations: {
      "derives-from": ["docs/specs/0001-graph.md", "docs/adr/0001-graph.md"],
    },
  }, "# Other Design\n");
  writeArtifact(repo, "docs/plans/0002-other.md", {
    id: "PLAN-0002", type: "plan", status: "approved", title: "Other Plan",
    relations: { "derives-from": ["docs/designs/0002-other.md"] },
  }, "# Other Plan\n");
  writeArtifact(repo, "docs/tasks/0002-other.md", {
    id: "TASK-0002", type: "task", status: "todo", title: "Other Task",
    relations: { implements: ["docs/plans/0002-other.md"] },
  }, "# Other Task\n\n## Verification\n\n- [ ] node --test\n");
  const state = probeLifecycleState({
    cwd: repo,
    focus: ["docs/specs/0001-graph.md"],
    signals: [],
  });
  assert.ok(state.blockers.includes("focus-required"));
});

test("follow-up and exit gates require their typed signals", () => {
  const repo = repoWithApprovedArtifactChain();
  const withoutSignals = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals: [],
  });
  const withSignals = probeLifecycleState({
    cwd: repo,
    focus: ["docs/plans/0001-graph-lifecycle.md"],
    signals: ["followups-classified", "exit-audit-pass"],
  });
  assert.equal(withoutSignals.gates["followup-triage"].status, "blocked");
  assert.equal(withoutSignals.gates["exit-audit"].status, "blocked");
  assert.equal(withSignals.gates["followup-triage"].status, "pass");
  assert.equal(withSignals.gates["exit-audit"].status, "pass");
});
