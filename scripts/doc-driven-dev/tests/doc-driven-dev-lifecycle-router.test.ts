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
