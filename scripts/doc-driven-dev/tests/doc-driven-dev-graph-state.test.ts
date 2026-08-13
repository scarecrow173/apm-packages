import type { GraphState } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_state";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const matter = require("gray-matter");
const { projectGraphState } = require("../src/skills/doc-driven-dev-graph/scripts/lib/graph_state.ts");

function writeArtifact(repo: string, relativePath: string, data: Record<string, unknown>, body: string): void {
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

function fixtureRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "graph-state-"));
  for (const directory of [
    "docs/ideas", "docs/discovery", "docs/specs", "docs/designs", "docs/plans",
    "docs/tasks", "docs/adr", "docs/impl/ir", "docs/impl/exp",
  ]) {
    fs.mkdirSync(path.join(repo, directory), { recursive: true });
    fs.writeFileSync(path.join(repo, directory, "README.md"), `# ${directory}\n`, "utf8");
  }
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Graph",
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph state\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "Graph ADR",
  }, "# Graph ADR\n\n## Considered Options\n\n### A\n\n### B\n");
  writeArtifact(repo, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph Design",
    relations: { "derives-from": ["SPEC-0001", "ADR-0001"] },
  }, "# Graph Design\n");
  writeArtifact(repo, "docs/plans/0001-graph.md", {
    id: "PLAN-0001", type: "plan", status: "approved", title: "Graph Plan",
    relations: { "derives-from": ["DESIGN-0001"] },
  }, "# Graph Plan\n");
  writeArtifact(repo, "docs/tasks/0001-route.md", {
    id: "TASK-0001", type: "task", status: "todo", title: "Route",
    relations: {
      implements: ["PLAN-0001"],
      "depends-on": ["TASK-0002"],
      "relates-to": ["UNRELATED-PLAN"],
      references: ["https://example.test/evidence"],
    },
  }, "# Route\n");
  writeArtifact(repo, "docs/tasks/0002-prepare.md", {
    id: "TASK-0002", type: "task", status: "done", title: "Prepare",
    relations: { implements: ["PLAN-0001"] },
  }, "# Prepare\n");
  return repo;
}

test("projects an explicit artifact graph and selects plans only through lineage", () => {
  const repo = fixtureRepo();
  const state: GraphState = projectGraphState({
    cwd: repo,
    focus: ["DESIGN-0001"],
    signals: [],
  });
  assert.equal(state.schemaVersion, 2);
  assert.deepEqual(state.artifactGraph.edges.map((edge) => edge.kind), [
    "lineage", "lineage", "lineage", "lineage", "lineage", "task-dependency", "contextual", "evidence",
  ]);
  assert.equal(state.focus.length, 1);
  assert.equal(state.taskGraph?.plan, "docs/plans/0001-graph.md");
  assert.equal(state.artifactGraph.edges.find((edge) => edge.relation === "relates-to")?.to, null);
  assert.equal(state.artifactGraph.edges.find((edge) => edge.relation === "references")?.external, true);
  assert.equal(state.artifactGraph.issues.some((issue) => issue.code === "broken-relation"), true);
  assert.equal(state.signals.includes("followups-unclassified"), true);
});

test("duplicate IDs and ambiguous focus fail closed", () => {
  const repo = fixtureRepo();
  writeArtifact(repo, "docs/plans/0002-other.md", {
    id: "PLAN-0001", type: "plan", status: "approved", title: "Duplicate",
  }, "# Duplicate\n");
  const state = projectGraphState({ cwd: repo, focus: ["docs/designs/0001-graph.md"] });
  assert.equal(state.artifactGraph.issues.some((issue) => issue.code === "duplicate-id"), true);
  assert.equal(state.blockers.includes("duplicate-id"), true);
  assert.equal(state.blockers.includes("focus-required"), true);
  assert.equal(state.taskGraph, null);
});

test("custom task directories remain authoritative during gate evaluation", () => {
  const repo = fixtureRepo();
  fs.rmSync(path.join(repo, "docs/tasks/0001-route.md"));
  fs.rmSync(path.join(repo, "docs/tasks/0002-prepare.md"));
  writeArtifact(repo, "docs/work-items/0001-route.md", {
    id: "TASK-CUSTOM", type: "task", status: "todo", title: "Custom Route",
    relations: { implements: ["docs/plans/0001-graph.md"] },
  }, "# Custom Route\n");
  const state = projectGraphState({
    cwd: repo,
    taskDir: "docs/work-items",
    focus: ["PLAN-0001"],
  });
  assert.equal(state.taskDir, "docs/work-items");
  assert.equal(state.taskGraph?.nodes.map((node: { id: string }) => node.id).join(","), "TASK-CUSTOM");
  assert.equal(state.gates.planning.status, "pass");
});

test("malformed relation shapes fail closed as graph issues", () => {
  const repo = fixtureRepo();
  writeArtifact(repo, "docs/designs/0002-malformed.md", {
    id: "DESIGN-0002", type: "design", status: "approved", title: "Malformed",
    relations: 42,
  }, "# Malformed\n");
  writeArtifact(repo, "docs/designs/0003-malformed-field.md", {
    id: "DESIGN-0003", type: "design", status: "approved", title: "Malformed Field",
    relations: { "derives-from": [42] },
  }, "# Malformed Field\n");
  const state = projectGraphState({ cwd: repo, focus: ["DESIGN-0002"] });
  assert.ok(state.artifactGraph.issues.some((issue) => issue.message.includes("invalid-relations:docs/designs/0002-malformed.md")));
  assert.ok(state.artifactGraph.issues.some((issue) => issue.message.includes("invalid-relation:docs/designs/0003-malformed-field.md:derives-from")));
  assert.ok(state.blockers.some((blocker: string) => blocker.startsWith("broken-relation:")));
});

test("multiple valid chains fail closed even when only one has a plan", () => {
  const repo = fixtureRepo();
  writeArtifact(repo, "docs/designs/0002-no-plan.md", {
    id: "DESIGN-0002", type: "design", status: "approved", title: "No Plan Design",
    relations: { "derives-from": ["SPEC-0001", "ADR-0001"] },
  }, "# No Plan Design\n");
  const state = projectGraphState({ cwd: repo, focus: ["SPEC-0001"] });
  assert.ok(state.blockers.includes("focus-required"));
  assert.equal(state.taskGraph, null);
});
