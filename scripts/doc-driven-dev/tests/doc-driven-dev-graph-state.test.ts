import type { GraphState } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_state";

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import matter from "gray-matter";
import { loadGraphDefinition } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import { projectGraphState, sectionBody } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_state";
import { routeGraph } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_router";

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
    "docs/tasks", "docs/test-specs", "docs/adr", "docs/impl/ir", "docs/impl/exp",
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

function preDesignRepo(): string {
  const repo = fixtureRepo();
  for (const relativePath of [
    "docs/designs/0001-graph.md",
    "docs/plans/0001-graph.md",
    "docs/tasks/0001-route.md",
    "docs/tasks/0002-prepare.md",
  ]) fs.rmSync(path.join(repo, relativePath));
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "confirmed", title: "Graph Discovery",
    relations: { "derived-by": ["SPEC-0001", "ADR-0001"] },
  }, "# Graph Discovery\n");
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
    relations: { "derives-from": ["DISC-0001"] },
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph state\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
    relations: { "derives-from": ["DISC-0001"] },
  }, "# Graph ADR\n\n## Considered Options\n\n### A\n\n### B\n");
  return repo;
}

function removeArtifacts(repo: string, relativePaths: string[]): void {
  for (const relativePath of relativePaths) fs.rmSync(path.join(repo, relativePath));
}

test("selects a pre-design SPEC and ADR through their shared discovery", () => {
  const repo = preDesignRepo();
  for (const focus of [["SPEC-0001", "ADR-0001"], ["DISC-0001"]]) {
    const state = projectGraphState({ cwd: repo, focus });
    assert.equal(state.blockers.includes("focus-required"), false, focus.join(","));
    assert.deepEqual(state.gates.briefing, { status: "pass", reasons: [] }, focus.join(","));
    const route = routeGraph({
      current: "briefing",
      definition: loadGraphDefinition(path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml")),
      state,
    });
    assert.deepEqual({ edgeId: route.edgeId, next: route.next, status: route.status }, {
      edgeId: "briefing-to-design", next: "design", status: "edge",
    }, focus.join(","));
  }
});

test("selects a pre-design SPEC and ADR through a direct typed relation", () => {
  const repo = fixtureRepo();
  removeArtifacts(repo, [
    "docs/designs/0001-graph.md",
    "docs/plans/0001-graph.md",
    "docs/tasks/0001-route.md",
    "docs/tasks/0002-prepare.md",
  ]);
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
    relations: { "derived-by": ["ADR-0001"] },
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph state\n");
  const state = projectGraphState({ cwd: repo, focus: ["SPEC-0001", "ADR-0001"] });
  assert.deepEqual(state.gates.briefing, { status: "pass", reasons: [] });
});

test("passes the briefing gate on a spec/ADR authored with localized headings", () => {
  const repo = preDesignRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
    relations: { "derives-from": ["DISC-0001"] },
  }, "# Graph\n\n## 受け入れ基準\n\n- [ ] graph state\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
    relations: { "derives-from": ["DISC-0001"] },
  }, "# Graph ADR\n\n## 検討した選択肢\n\n### 案A\n\n### 案B\n");
  const state = projectGraphState({ cwd: repo, focus: ["SPEC-0001", "ADR-0001"] });
  assert.deepEqual(state.gates.briefing, { status: "pass", reasons: [] });
});

test("a fenced ## Acceptance Criteria or ## Considered Options cannot satisfy the briefing gate", () => {
  const repo = preDesignRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
    relations: { "derives-from": ["DISC-0001"] },
  }, "# Graph\n\n```md\n## Acceptance Criteria\n\n- [ ] fake\n```\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
    relations: { "derives-from": ["DISC-0001"] },
  }, "# Graph ADR\n\n```md\n## Considered Options\n\n### 案A\n\n### 案B\n```\n");
  const state = projectGraphState({ cwd: repo, focus: ["SPEC-0001", "ADR-0001"] });
  assert.deepEqual(state.gates.briefing, {
    status: "fail",
    reasons: ["acceptance-criteria", "considered-options"],
  });
});

test("does not pair SPEC and ADR that only refine the same discovery", () => {
  const repo = preDesignRepo();
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "confirmed", title: "Graph Discovery",
  }, "# Graph Discovery\n");
  for (const [relativePath, id, type, body] of [
    ["docs/specs/0001-graph.md", "SPEC-0001", "spec", "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph state\n"],
    ["docs/adr/0001-graph.md", "ADR-0001", "adr", "# Graph ADR\n\n## Considered Options\n\n### A\n\n### B\n"],
  ]) writeArtifact(repo, relativePath, {
    id, type, status: "proposed", title: id, relations: { refines: ["DISC-0001"] },
  }, body);
  const state = projectGraphState({ cwd: repo, focus: ["SPEC-0001", "ADR-0001"] });
  assert.ok(state.blockers.includes("focus-required"));
  assert.equal(state.gates.briefing.status, "blocked");
});

test("keeps a pre-design SPEC-only chain incomplete", () => {
  const repo = fixtureRepo();
  removeArtifacts(repo, [
    "docs/adr/0001-graph.md",
    "docs/designs/0001-graph.md",
    "docs/plans/0001-graph.md",
    "docs/tasks/0001-route.md",
    "docs/tasks/0002-prepare.md",
  ]);
  const state = projectGraphState({ cwd: repo, focus: ["SPEC-0001"] });
  assert.deepEqual(state.gates.briefing, { status: "fail", reasons: ["adr-status", "considered-options"] });
});

test("keeps a pre-design ADR-only chain incomplete", () => {
  const repo = fixtureRepo();
  removeArtifacts(repo, [
    "docs/specs/0001-graph.md",
    "docs/designs/0001-graph.md",
    "docs/plans/0001-graph.md",
    "docs/tasks/0001-route.md",
    "docs/tasks/0002-prepare.md",
  ]);
  const state = projectGraphState({ cwd: repo, focus: ["ADR-0001"] });
  assert.deepEqual(state.gates.briefing, { status: "fail", reasons: ["acceptance-criteria", "spec-status"] });
});

test("fails closed when a discovery has multiple pre-design briefing chains", () => {
  const repo = preDesignRepo();
  writeArtifact(repo, "docs/specs/0002-other.md", {
    id: "SPEC-0002", type: "spec", status: "proposed", title: "Other",
    relations: { "derives-from": ["DISC-0001"] },
  }, "# Other\n\n## Acceptance Criteria\n\n- [ ] other\n");
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "confirmed", title: "Graph Discovery",
    relations: { "derived-by": ["SPEC-0001", "SPEC-0002", "ADR-0001"] },
  }, "# Graph Discovery\n");
  const state = projectGraphState({ cwd: repo, focus: ["DISC-0001"] });
  assert.ok(state.blockers.includes("focus-required"));
  assert.equal(state.gates.briefing.status, "blocked");
});

function sharedUpstreamRepo(planStatus: string = "completed"): string {
  const repo = preDesignRepo();
  writeArtifact(repo, "docs/ideas/0001-root.md", {
    id: "IDEA-0001", type: "idea", status: "active", title: "Root Idea",
  }, "# Root Idea\n");
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "confirmed", title: "Graph Discovery",
    relations: { "derived-by": ["SPEC-0001", "ADR-0001"], "derives-from": ["IDEA-0001"] },
  }, "# Graph Discovery\n");
  for (const index of [2, 3]) {
    const suffix = String(index).padStart(4, "0");
    writeArtifact(repo, `docs/discovery/${suffix}-chain.md`, {
      id: `DISC-${suffix}`, type: "discovery", status: "confirmed", title: `Discovery ${index}`,
      relations: { "derives-from": ["IDEA-0001"] },
    }, `# Discovery ${index}\n`);
    writeArtifact(repo, `docs/specs/${suffix}-chain.md`, {
      id: `SPEC-${suffix}`, type: "spec", status: "proposed", title: `Spec ${index}`,
      relations: { "derives-from": [`DISC-${suffix}`] },
    }, `# Spec ${index}\n\n## Acceptance Criteria\n\n- [ ] chain\n`);
    writeArtifact(repo, `docs/adr/${suffix}-chain.md`, {
      id: `ADR-${suffix}`, type: "adr", status: "accepted", title: `ADR ${index}`,
      relations: { "derives-from": [`DISC-${suffix}`] },
    }, `# ADR ${index}\n\n## Considered Options\n\n### A\n\n### B\n`);
    writeArtifact(repo, `docs/designs/${suffix}-chain.md`, {
      id: `DESIGN-${suffix}`, type: "design", status: "approved", title: `Design ${index}`,
      relations: { "derives-from": [`SPEC-${suffix}`, `ADR-${suffix}`] },
    }, `# Design ${index}\n`);
    writeArtifact(repo, `docs/plans/${suffix}-chain.md`, {
      id: `PLAN-${suffix}`, type: "plan", status: planStatus, title: `Plan ${index}`,
      relations: { "derives-from": [`DESIGN-${suffix}`] },
    }, `# Plan ${index}\n`);
  }
  return repo;
}

test("unique focused chain is not vetoed by plans in sibling chains sharing an upstream", () => {
  const repo = sharedUpstreamRepo();
  for (const focus of [["SPEC-0001"], ["DISC-0001"], ["SPEC-0001", "ADR-0001"], ["docs/specs/0001-graph.md"]]) {
    const state = projectGraphState({ cwd: repo, focus });
    assert.equal(state.blockers.includes("focus-required"), false, focus.join(","));
    assert.deepEqual(state.gates.briefing, { status: "pass", reasons: [] }, focus.join(","));
    const route = routeGraph({
      current: "briefing",
      definition: loadGraphDefinition(path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml")),
      state,
    });
    assert.deepEqual({ edgeId: route.edgeId, next: route.next, status: route.status }, {
      edgeId: "briefing-to-design", next: "design", status: "edge",
    }, focus.join(","));
  }
});

test("sibling plans sharing an upstream do not veto focus at other statuses", () => {
  const repo = sharedUpstreamRepo("in-progress");
  const state = projectGraphState({ cwd: repo, focus: ["SPEC-0001"] });
  assert.equal(state.blockers.includes("focus-required"), false);
  assert.deepEqual(state.gates.briefing, { status: "pass", reasons: [] });
});

test("still fails closed on genuinely ambiguous focus with shared upstream plans", () => {
  const repo = sharedUpstreamRepo();
  writeArtifact(repo, "docs/specs/0004-other.md", {
    id: "SPEC-0004", type: "spec", status: "proposed", title: "Other",
    relations: { "derives-from": ["DISC-0001"] },
  }, "# Other\n\n## Acceptance Criteria\n\n- [ ] other\n");
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "confirmed", title: "Graph Discovery",
    relations: { "derived-by": ["SPEC-0001", "SPEC-0004", "ADR-0001"], "derives-from": ["IDEA-0001"] },
  }, "# Graph Discovery\n");
  const state = projectGraphState({ cwd: repo, focus: ["DISC-0001"] });
  assert.ok(state.blockers.includes("focus-required"));
  assert.equal(state.gates.briefing.status, "blocked");
});

test("plans competing for the same design never auto-pick", () => {
  const repo = fixtureRepo();
  writeArtifact(repo, "docs/plans/0002-other.md", {
    id: "PLAN-0002", type: "plan", status: "approved", title: "Other Plan",
    relations: { "derives-from": ["DESIGN-0001"] },
  }, "# Other Plan\n");
  const blocked = projectGraphState({ cwd: repo, focus: ["DESIGN-0001"] });
  assert.ok(blocked.blockers.includes("focus-required"));
  const focused = projectGraphState({ cwd: repo, focus: ["PLAN-0001"] });
  assert.equal(focused.blockers.includes("focus-required"), false);
});

test("keeps an existing focused design chain and selects its plan only through lineage", () => {
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

test("contextual lineage-looking aliases cannot supply a plan or chain", () => {
  const repo = fixtureRepo();
  writeArtifact(repo, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph Design",
    relations: { spec: ["SPEC-0001"], adr: ["ADR-0001"] },
  }, "# Graph Design\n");
  writeArtifact(repo, "docs/plans/0001-graph.md", {
    id: "PLAN-0001", type: "plan", status: "approved", title: "Graph Plan",
    relations: { spec: ["DESIGN-0001"] },
  }, "# Graph Plan\n");
  const state = projectGraphState({ cwd: repo, focus: ["DESIGN-0001"] });
  assert.ok(state.artifactGraph.edges.some((edge) => edge.relation === "spec" && edge.kind === "contextual"));
  assert.equal(state.taskGraph, null);
  assert.notEqual(state.gates.planning.status, "pass");
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

test("an escaping taskDir fails closed before scanning; contained forms normalize", () => {
  const repo = fixtureRepo();
  const outsideAbsolute = path.dirname(repo);
  for (const taskDir of ["../outside", "./../outside", outsideAbsolute]) {
    assert.throws(
      () => projectGraphState({ cwd: repo, taskDir, focus: ["PLAN-0001"] }),
      /--task-dir escapes the checkout/,
      `taskDir ${taskDir} must be rejected`,
    );
  }
  // Contained task dirs project normally and state.taskDir carries the
  // canonical checkout-relative form the scan enforced.
  for (const [input, normalized] of [
    ["docs/tasks", "docs/tasks"],
    ["./docs/tasks", "docs/tasks"],
    ["docs/../docs/tasks", "docs/tasks"],
  ] as const) {
    const state = projectGraphState({ cwd: repo, taskDir: input, focus: ["PLAN-0001"] });
    assert.equal(state.taskDir, normalized, input);
    // The normalized dir joined the scan set: the task docs are records.
    assert.ok(state.artifactGraph.nodes.some((node) => node.path === "docs/tasks/0001-route.md"), input);
  }
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

test("malformed relations block graph completion even with an otherwise valid chain", () => {
  const repo = fixtureRepo();
  writeArtifact(repo, "docs/tasks/0001-route.md", {
    id: "TASK-0001", type: "task", status: "done", title: "Route",
    relations: { implements: ["docs/plans/0001-graph.md"] },
  }, "# Route\n");
  writeArtifact(repo, "docs/tasks/0002-prepare.md", {
    id: "TASK-0002", type: "task", status: "done", title: "Prepare",
    relations: { implements: ["docs/plans/0001-graph.md"] },
  }, "# Prepare\n");
  writeArtifact(repo, "docs/ideas/0001-malformed.md", {
    id: "IDEA-0001", type: "idea", status: "draft", title: "Malformed",
    relations: 42,
  }, "# Malformed\n");
  const state = projectGraphState({
    cwd: repo,
    focus: ["PLAN-0001"],
    signals: ["implementation-verified", "followup-terminal", "exit-audit-pass"],
  });
  assert.equal(state.gates["artifact-graph"].status, "blocked");
  assert.equal(state.signals.includes("graph-complete"), false);
  assert.ok(Object.values(state.gates).some((result) => result.status !== "pass"));
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

test("sectionBody matches headings containing regex metacharacters literally", () => {
  const body = [
    "# Doc",
    "",
    "## Acceptance (v2) [draft]",
    "",
    "metachar section",
    "",
    "## Spec.1: a+b",
    "",
    "dotted section",
    "",
    "## Tail",
    "",
    "tail section",
  ].join("\n");
  assert.equal(sectionBody(body, "Acceptance (v2) [draft]"), "metachar section");
  assert.equal(sectionBody(body, "Spec.1: a+b"), "dotted section");
  // A line that only satisfies the *unescaped* regex reading must not match:
  // "(v2)" as a group plus "[draft]" as a class would accept "## Acceptance v2d".
  assert.equal(sectionBody("## Acceptance v2d\n\ndecoy\n", "Acceptance (v2) [draft]"), "");
});

test("sectionBody builds a valid RegExp for headings ending in regex-significant characters", () => {
  const body = "## Foo]\n\nbracket section\n\n## Foo\\\n\nbackslash section\n";
  assert.equal(sectionBody(body, "Foo]"), "bracket section");
  assert.equal(sectionBody(body, "Foo\\"), "backslash section");
  // An unbalanced "[" reached the RegExp constructor unescaped and used to throw.
  assert.doesNotThrow(() => sectionBody(body, "["));
  assert.equal(sectionBody(body, "["), "");
});
