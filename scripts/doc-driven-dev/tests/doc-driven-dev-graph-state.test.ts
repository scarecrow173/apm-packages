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
