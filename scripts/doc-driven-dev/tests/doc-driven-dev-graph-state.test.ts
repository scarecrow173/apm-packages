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
import {
  approvePlan,
  createRun,
  initStateRoot,
} from "../src/skills/lib/execution_store";
import type { TaskStatus } from "../src/skills/lib/execution_store";

const RUN_ID = "RUN-0001";

const DEFINITION_PATH = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml");

/**
 * Bind an Execution Store run to the fixture's spec/adr/design chain
 * (Issues #236/#237): `state.execution.taskGraph` projects this run's
 * plan.md + records — never the durable plan/task docs. The manifest focus
 * is a chain member so implicit selection finds the run whenever the chain
 * resolves.
 */
function withRun(
  repo: string,
  tasks: Array<{ taskId: string; status?: TaskStatus; dependsOn?: string[] }> = [
    { taskId: "TASK-0001", status: "todo", dependsOn: ["TASK-0002"] },
    { taskId: "TASK-0002", status: "done" },
  ],
): void {
  initStateRoot(repo);
  createRun(repo, {
    runId: RUN_ID,
    graphId: "doc-driven-dev",
    focus: ["docs/designs/0001-graph.md"],
    plan: "# Plan\n\nStore-managed run plan.\n",
    tasks: tasks.map((task) => ({ title: task.taskId, ...task })),
  });
  approvePlan(repo, RUN_ID, { actor: "graph-state" });
}

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

/**
 * The durable fixture: spec + ADR + approved design bound by v1 Knowledge
 * Relations (#235) — `design.realizes → spec` and `adr.decides-for →
 * design`. The legacy dirs (plans/tasks/test-specs/impl) still carry
 * pre-v3 files: the projection never reads them, which is the point —
 * Graph State v3's durable corpus is `DURABLE_DOC_DIRS` only.
 */
function fixtureRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "graph-state-"));
  for (const directory of [
    "docs/ideas", "docs/discovery", "docs/specs", "docs/designs", "docs/plans",
    "docs/tasks", "docs/test-specs", "docs/adr", "docs/impl/ir", "docs/impl/exp",
    "docs/knowledge", "docs/verification",
  ]) {
    fs.mkdirSync(path.join(repo, directory), { recursive: true });
    fs.writeFileSync(path.join(repo, directory, "README.md"), `# ${directory}\n`, "utf8");
  }
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Graph",
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph state\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "Graph ADR",
    relations: { "decides-for": ["DESIGN-0001"] },
  }, "# Graph ADR\n\n## Considered Options\n\n### A\n\n### B\n");
  writeArtifact(repo, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph Design",
    relations: { realizes: ["SPEC-0001"] },
  }, "# Graph Design\n");
  // Legacy corpus — migration-owned, never scanned by the v3 projection.
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

/**
 * A spec/ADR pair with no design yet, anchored by a discovery document:
 * `discovery.motivates → spec` plus `discovery.informs → adr` — the only
 * v1 spellings that pair a spec with an ADR pre-design (#235).
 */
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
    relations: { motivates: ["SPEC-0001"], informs: ["ADR-0001"] },
  }, "# Graph Discovery\n");
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph state\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
  }, "# Graph ADR\n\n## Considered Options\n\n### A\n\n### B\n");
  return repo;
}

function removeArtifacts(repo: string, relativePaths: string[]): void {
  for (const relativePath of relativePaths) fs.rmSync(path.join(repo, relativePath));
}

test("selects a pre-design SPEC and ADR through their shared discovery", async () => {
  const repo = preDesignRepo();
  for (const focus of [["SPEC-0001", "ADR-0001"], ["DISC-0001"]]) {
    const state = await projectGraphState({ cwd: repo, focus });
    assert.equal(state.blockers.includes("focus-required"), false, focus.join(","));
    assert.deepEqual(state.gates.briefing, { status: "pass", reasons: [] }, focus.join(","));
    const route = routeGraph({
      current: "briefing",
      definition: loadGraphDefinition(DEFINITION_PATH),
      state,
    });
    assert.deepEqual({ edgeId: route.edgeId, next: route.next, status: route.status }, {
      edgeId: "briefing-to-design", next: "design", status: "edge",
    }, focus.join(","));
  }
});

test("selects a pre-design SPEC and ADR through a direct decides-for edge", async () => {
  const repo = fixtureRepo();
  removeArtifacts(repo, [
    "docs/designs/0001-graph.md",
    "docs/plans/0001-graph.md",
    "docs/tasks/0001-route.md",
    "docs/tasks/0002-prepare.md",
  ]);
  // v1 direction: the ADR declares `decides-for` on the spec — the spec
  // itself carries no ADR relation (#235).
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
    relations: { "decides-for": ["SPEC-0001"] },
  }, "# Graph ADR\n\n## Considered Options\n\n### A\n\n### B\n");
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph state\n");
  const state = await projectGraphState({ cwd: repo, focus: ["SPEC-0001", "ADR-0001"] });
  assert.deepEqual(state.gates.briefing, { status: "pass", reasons: [] });
});

test("passes the briefing gate on a spec/ADR authored with localized headings", async () => {
  const repo = preDesignRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
  }, "# Graph\n\n## 受け入れ基準\n\n- [ ] graph state\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
  }, "# Graph ADR\n\n## 検討した選択肢\n\n### 案A\n\n### 案B\n");
  const state = await projectGraphState({ cwd: repo, focus: ["SPEC-0001", "ADR-0001"] });
  assert.deepEqual(state.gates.briefing, { status: "pass", reasons: [] });
});

test("a fenced ## Acceptance Criteria or ## Considered Options cannot satisfy the briefing gate", async () => {
  const repo = preDesignRepo();
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
  }, "# Graph\n\n```md\n## Acceptance Criteria\n\n- [ ] fake\n```\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "proposed", title: "Graph ADR",
  }, "# Graph ADR\n\n```md\n## Considered Options\n\n### 案A\n\n### 案B\n```\n");
  const state = await projectGraphState({ cwd: repo, focus: ["SPEC-0001", "ADR-0001"] });
  assert.deepEqual(state.gates.briefing, {
    status: "fail",
    reasons: ["acceptance-criteria", "considered-options"],
  });
});

test("does not pair SPEC and ADR when the discovery only reaches the spec", async () => {
  const repo = preDesignRepo();
  // The anchor edge to the ADR is missing: `motivates` alone cannot pair —
  // a shared capture document must reach BOTH artifacts.
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "confirmed", title: "Graph Discovery",
    relations: { motivates: ["SPEC-0001"] },
  }, "# Graph Discovery\n");
  const state = await projectGraphState({ cwd: repo, focus: ["SPEC-0001", "ADR-0001"] });
  assert.ok(state.blockers.includes("focus-required"));
  assert.equal(state.gates.briefing.status, "blocked");
});

test("pairs a new spec with an ADR already claimed by an existing design chain", async () => {
  const repo = fixtureRepo();
  // The ADR claims the design chain AND the new spec — one ADR may decide
  // for several artifacts, so the new spec's briefing pair coexists with
  // the existing chain.
  writeArtifact(repo, "docs/specs/0002-followup.md", {
    id: "SPEC-0002", type: "spec", status: "approved", title: "Follow-up",
  }, "# Follow-up\n\n## Acceptance Criteria\n\n- [ ] reuse the accepted decision\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "Graph ADR",
    relations: { "decides-for": ["DESIGN-0001", "SPEC-0002"] },
  }, "# Graph ADR\n\n## Considered Options\n\n### A\n\n### B\n");
  for (const focus of [["SPEC-0002"], ["SPEC-0002", "ADR-0001"], ["docs/specs/0002-followup.md"]]) {
    const state = await projectGraphState({ cwd: repo, focus });
    assert.equal(state.blockers.includes("focus-required"), false, focus.join(","));
    assert.deepEqual(state.gates.briefing, { status: "pass", reasons: [] }, focus.join(","));
    const route = routeGraph({
      current: "briefing",
      definition: loadGraphDefinition(DEFINITION_PATH),
      state,
    });
    assert.deepEqual({ edgeId: route.edgeId, next: route.next, status: route.status }, {
      edgeId: "briefing-to-design", next: "design", status: "edge",
    }, focus.join(","));
  }
});

test("a spec reusing a design-claimed ADR leaves existing chains selectable", async () => {
  const repo = fixtureRepo();
  withRun(repo);
  writeArtifact(repo, "docs/specs/0002-followup.md", {
    id: "SPEC-0002", type: "spec", status: "approved", title: "Follow-up",
  }, "# Follow-up\n\n## Acceptance Criteria\n\n- [ ] reuse the accepted decision\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "Graph ADR",
    relations: { "decides-for": ["DESIGN-0001", "SPEC-0002"] },
  }, "# Graph ADR\n\n## Considered Options\n\n### A\n\n### B\n");
  // The existing design chain still resolves unchanged through its own members.
  for (const focus of [["SPEC-0001"], ["DESIGN-0001"], ["SPEC-0001", "ADR-0001"], ["ADR-0001", "DESIGN-0001"]]) {
    const state = await projectGraphState({ cwd: repo, focus });
    assert.equal(state.blockers.includes("focus-required"), false, focus.join(","));
    assert.equal(state.execution.run?.runId, RUN_ID, focus.join(","));
    assert.equal(state.execution.taskGraph?.plan?.path, `runs/${RUN_ID}/plan.md`, focus.join(","));
  }
  // The shared ADR alone no longer names a unique chain: it belongs to the
  // design chain and the new briefing pair, so focus fails closed.
  const ambiguous = await projectGraphState({ cwd: repo, focus: ["ADR-0001"] });
  assert.ok(ambiguous.blockers.includes("focus-required"));
  assert.equal(ambiguous.gates.briefing.status, "blocked");
});

test("a spec claimed by multiple ADRs still fails closed until the pair is focused", async () => {
  const repo = fixtureRepo();
  writeArtifact(repo, "docs/adr/0002-other.md", {
    id: "ADR-0002", type: "adr", status: "accepted", title: "Other ADR",
    relations: { "decides-for": ["SPEC-0002"] },
  }, "# Other ADR\n\n## Considered Options\n\n### A\n\n### B\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "Graph ADR",
    relations: { "decides-for": ["DESIGN-0001", "SPEC-0002"] },
  }, "# Graph ADR\n\n## Considered Options\n\n### A\n\n### B\n");
  writeArtifact(repo, "docs/specs/0002-followup.md", {
    id: "SPEC-0002", type: "spec", status: "approved", title: "Follow-up",
  }, "# Follow-up\n\n## Acceptance Criteria\n\n- [ ] reuse accepted decisions\n");
  const ambiguous = await projectGraphState({ cwd: repo, focus: ["SPEC-0002"] });
  assert.ok(ambiguous.blockers.includes("focus-required"));
  assert.equal(ambiguous.gates.briefing.status, "blocked");
  const focused = await projectGraphState({ cwd: repo, focus: ["SPEC-0002", "ADR-0002"] });
  assert.equal(focused.blockers.includes("focus-required"), false);
  assert.deepEqual(focused.gates.briefing, { status: "pass", reasons: [] });
});

test("a design missing its ADR claim fails the design gate, not chain selection", async () => {
  const repo = fixtureRepo();
  // No `decides-for` edge reaches the design: the chain still resolves on
  // spec+design, and the design gate reports the missing relation.
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "Graph ADR",
  }, "# Graph ADR\n\n## Considered Options\n\n### A\n\n### B\n");
  const state = await projectGraphState({ cwd: repo, focus: ["DESIGN-0001"] });
  assert.equal(state.blockers.includes("focus-required"), false);
  assert.equal(state.gates.design.status, "fail");
  assert.ok(state.gates.design.reasons.includes("design-adr-relation"));
});

test("a spec already claimed by a design does not re-pair with a new ADR", async () => {
  const repo = fixtureRepo();
  withRun(repo);
  writeArtifact(repo, "docs/adr/0002-amend.md", {
    id: "ADR-0002", type: "adr", status: "proposed", title: "Amending ADR",
    relations: { "decides-for": ["SPEC-0001"] },
  }, "# Amending ADR\n\n## Considered Options\n\n### A\n\n### B\n");
  // SPEC-0001 is owned by its design chain; the new ADR cannot pull it into a
  // second briefing chain, so the spec's chain keeps resolving uniquely.
  const focused = await projectGraphState({ cwd: repo, focus: ["SPEC-0001"] });
  assert.equal(focused.blockers.includes("focus-required"), false);
  assert.equal(focused.execution.taskGraph?.plan?.path, `runs/${RUN_ID}/plan.md`);
  // The unpaired new ADR reports its missing spec rather than a fake pair.
  const lonely = await projectGraphState({ cwd: repo, focus: ["ADR-0002"] });
  assert.equal(lonely.blockers.includes("focus-required"), false);
  assert.deepEqual(lonely.gates.briefing, {
    status: "fail",
    reasons: ["acceptance-criteria", "spec-status"],
  });
});

test("keeps a pre-design SPEC-only chain incomplete", async () => {
  const repo = fixtureRepo();
  removeArtifacts(repo, [
    "docs/adr/0001-graph.md",
    "docs/designs/0001-graph.md",
    "docs/plans/0001-graph.md",
    "docs/tasks/0001-route.md",
    "docs/tasks/0002-prepare.md",
  ]);
  const state = await projectGraphState({ cwd: repo, focus: ["SPEC-0001"] });
  assert.deepEqual(state.gates.briefing, { status: "fail", reasons: ["adr-status", "considered-options"] });
});

test("keeps a pre-design ADR-only chain incomplete", async () => {
  const repo = fixtureRepo();
  removeArtifacts(repo, [
    "docs/specs/0001-graph.md",
    "docs/designs/0001-graph.md",
    "docs/plans/0001-graph.md",
    "docs/tasks/0001-route.md",
    "docs/tasks/0002-prepare.md",
  ]);
  const state = await projectGraphState({ cwd: repo, focus: ["ADR-0001"] });
  assert.deepEqual(state.gates.briefing, { status: "fail", reasons: ["acceptance-criteria", "spec-status"] });
});

test("fails closed when a discovery has multiple pre-design briefing chains", async () => {
  const repo = preDesignRepo();
  writeArtifact(repo, "docs/specs/0002-other.md", {
    id: "SPEC-0002", type: "spec", status: "proposed", title: "Other",
  }, "# Other\n\n## Acceptance Criteria\n\n- [ ] other\n");
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "confirmed", title: "Graph Discovery",
    relations: { motivates: ["SPEC-0001", "SPEC-0002"], informs: ["ADR-0001"] },
  }, "# Graph Discovery\n");
  const state = await projectGraphState({ cwd: repo, focus: ["DISC-0001"] });
  assert.ok(state.blockers.includes("focus-required"));
  assert.equal(state.gates.briefing.status, "blocked");
});

/**
 * Three chains sharing one upstream idea. Execution state in sibling
 * chains — runs, plans, task counts — can never veto the focused chain's
 * focus resolution (Issue #243): focus binds by durable IDs, not by which
 * plan happens to exist elsewhere.
 */
function sharedUpstreamRepo(): string {
  const repo = preDesignRepo();
  writeArtifact(repo, "docs/ideas/0001-root.md", {
    id: "IDEA-0001", type: "idea", status: "active", title: "Root Idea",
  }, "# Root Idea\n");
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "confirmed", title: "Graph Discovery",
    relations: { motivates: ["SPEC-0001"], informs: ["ADR-0001", "IDEA-0001"] },
  }, "# Graph Discovery\n");
  for (const index of [2, 3]) {
    const suffix = String(index).padStart(4, "0");
    writeArtifact(repo, `docs/discovery/${suffix}-chain.md`, {
      id: `DISC-${suffix}`, type: "discovery", status: "confirmed", title: `Discovery ${index}`,
      relations: { informs: ["IDEA-0001"] },
    }, `# Discovery ${index}\n`);
    writeArtifact(repo, `docs/specs/${suffix}-chain.md`, {
      id: `SPEC-${suffix}`, type: "spec", status: "proposed", title: `Spec ${index}`,
    }, `# Spec ${index}\n\n## Acceptance Criteria\n\n- [ ] chain\n`);
    writeArtifact(repo, `docs/adr/${suffix}-chain.md`, {
      id: `ADR-${suffix}`, type: "adr", status: "accepted", title: `ADR ${index}`,
      relations: { "decides-for": [`DESIGN-${suffix}`] },
    }, `# ADR ${index}\n\n## Considered Options\n\n### A\n\n### B\n`);
    writeArtifact(repo, `docs/designs/${suffix}-chain.md`, {
      id: `DESIGN-${suffix}`, type: "design", status: "approved", title: `Design ${index}`,
      relations: { realizes: [`SPEC-${suffix}`] },
    }, `# Design ${index}\n`);
    // Pre-v3 plan docs sit in the legacy dir: present on disk, never read.
    writeArtifact(repo, `docs/plans/${suffix}-chain.md`, {
      id: `PLAN-${suffix}`, type: "plan", status: "completed", title: `Plan ${index}`,
      relations: { "derives-from": [`DESIGN-${suffix}`] },
    }, `# Plan ${index}\n`);
  }
  return repo;
}

test("unique focused chain is not vetoed by plans in sibling chains sharing an upstream", async () => {
  const repo = sharedUpstreamRepo();
  for (const focus of [["SPEC-0001"], ["DISC-0001"], ["SPEC-0001", "ADR-0001"], ["docs/specs/0001-graph.md"]]) {
    const state = await projectGraphState({ cwd: repo, focus });
    assert.equal(state.blockers.includes("focus-required"), false, focus.join(","));
    assert.deepEqual(state.gates.briefing, { status: "pass", reasons: [] }, focus.join(","));
    const route = routeGraph({
      current: "briefing",
      definition: loadGraphDefinition(DEFINITION_PATH),
      state,
    });
    assert.deepEqual({ edgeId: route.edgeId, next: route.next, status: route.status }, {
      edgeId: "briefing-to-design", next: "design", status: "edge",
    }, focus.join(","));
  }
});

test("still fails closed on genuinely ambiguous focus", async () => {
  const repo = sharedUpstreamRepo();
  writeArtifact(repo, "docs/specs/0004-other.md", {
    id: "SPEC-0004", type: "spec", status: "proposed", title: "Other",
  }, "# Other\n\n## Acceptance Criteria\n\n- [ ] other\n");
  writeArtifact(repo, "docs/discovery/0001-graph.md", {
    id: "DISC-0001", type: "discovery", status: "confirmed", title: "Graph Discovery",
    relations: { motivates: ["SPEC-0001", "SPEC-0004"], informs: ["ADR-0001", "IDEA-0001"] },
  }, "# Graph Discovery\n");
  const state = await projectGraphState({ cwd: repo, focus: ["DISC-0001"] });
  assert.ok(state.blockers.includes("focus-required"));
  assert.equal(state.gates.briefing.status, "blocked");
});

test("runs competing for the same chain never auto-pick", async () => {
  const repo = fixtureRepo();
  withRun(repo);
  createRun(repo, {
    runId: "RUN-0002",
    graphId: "doc-driven-dev",
    focus: ["docs/designs/0001-graph.md"],
    plan: "# Plan\n\nA second run competing for the same chain.\n",
    tasks: [{ taskId: "TASK-0001", status: "todo" }],
  });
  approvePlan(repo, "RUN-0002", { actor: "graph-state" });
  const blocked = await projectGraphState({ cwd: repo, focus: ["DESIGN-0001"] });
  assert.ok(blocked.blockers.includes("task-graph-run-ambiguous"));
  // The explicit --run selector resolves the ambiguity — the run id is a
  // valid selector where implicit selection correctly refused.
  const focused = await projectGraphState({ cwd: repo, focus: ["DESIGN-0001"], runId: RUN_ID });
  assert.equal(focused.blockers.includes("task-graph-run-ambiguous"), false);
  assert.equal(focused.execution.run?.runId, RUN_ID);
});

test("keeps an existing focused design chain and projects only durable knowledge edges", async () => {
  const repo = fixtureRepo();
  withRun(repo);
  const state: GraphState = await projectGraphState({
    cwd: repo,
    focus: ["DESIGN-0001"],
    signals: [],
  });
  assert.equal(state.schemaVersion, 3);
  // The Knowledge Graph carries exactly the two stored v1 relations —
  // legacy plan/task fields and edges never enter the projection.
  const relations = state.knowledge.graph.edges.map((edge) => `${edge.from.id}:${edge.relation}:${edge.to?.id}`).sort();
  assert.deepEqual(relations, ["ADR-0001:decides-for:DESIGN-0001", "DESIGN-0001:realizes:SPEC-0001"]);
  assert.equal(state.knowledge.graph.nodes.some((node) => node.path.startsWith("docs/tasks") || node.path.startsWith("docs/plans")), false);
  assert.equal(state.focus.length, 1);
  assert.equal(state.execution.taskGraph?.plan?.path, `runs/${RUN_ID}/plan.md`);
  assert.equal(state.knowledge.graph.issues.length, 0);
});

test("two active runs bound to the focused chain block implicit selection as ambiguous", async () => {
  const repo = fixtureRepo();
  withRun(repo);
  createRun(repo, {
    runId: "RUN-0002",
    graphId: "doc-driven-dev",
    focus: ["docs/designs/0001-graph.md"],
    plan: "# Plan\n\nA second run competing for the same chain.\n",
    tasks: [{ taskId: "TASK-0001", status: "todo" }],
  });
  approvePlan(repo, "RUN-0002", { actor: "graph-state" });
  const state = await projectGraphState({ cwd: repo, focus: ["DESIGN-0001"] });
  assert.ok(state.blockers.includes("task-graph-run-ambiguous"));
  assert.equal(state.execution.taskGraph, null);
  assert.equal(state.execution.run, null);
  // A null taskGraph satisfies no task-graph predicate, so the router
  // stays blocked at the task-graph node — no delegate is dispatched.
  const route = routeGraph({
    current: "task-graph",
    definition: loadGraphDefinition(DEFINITION_PATH),
    state,
  });
  assert.equal(route.status, "blocked");
  assert.equal(route.delegate, null);
  assert.ok(route.blockers.includes("task-graph-run-ambiguous"));
});

test("a corrupt run dir blocks implicit selection as unreadable", async () => {
  const repo = fixtureRepo();
  withRun(repo);
  // A torn manifest leaves the listing `corrupt` — an unknown candidate
  // the selection can never silently skip.
  fs.writeFileSync(
    path.join(repo, ".apm/state/doc-driven-dev/runs", RUN_ID, "manifest.json"),
    '{"runId":',
    "utf8",
  );
  const state = await projectGraphState({ cwd: repo, focus: ["DESIGN-0001"] });
  assert.ok(state.blockers.includes("task-graph-run-unreadable"));
  assert.equal(state.execution.taskGraph, null);
  assert.equal(state.execution.run, null);
});

test("legacy contextual fields on a design produce knowledge issues, not relations", async () => {
  const repo = fixtureRepo();
  // `spec:`/`adr:` are not v1 relation fields — they surface as
  // `invalid-relation-field` knowledge issues (hard blockers), never as
  // claim edges and never as a plan/chain source.
  writeArtifact(repo, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph Design",
    relations: { spec: ["SPEC-0001"], adr: ["ADR-0001"] },
  }, "# Graph Design\n");
  const state = await projectGraphState({ cwd: repo, focus: ["DESIGN-0001"] });
  assert.ok(state.blockers.some((blocker) => blocker.startsWith("knowledge:")));
  assert.ok(state.knowledge.graph.issues.some((issue) => issue.code === "legacy-relation-field"));
  assert.equal(state.knowledge.graph.edges.some((edge) => edge.relation === "spec" || edge.relation === "adr"), false);
  assert.equal(state.execution.taskGraph, null);
  assert.notEqual(state.gates.planning.status, "pass");
});

test("duplicate IDs and ambiguous focus fail closed", async () => {
  const repo = fixtureRepo();
  // The duplicate must live in the durable corpus — legacy dirs are never
  // scanned, so a second durable spec reuses the ID.
  writeArtifact(repo, "docs/specs/0002-dup.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Duplicate",
  }, "# Duplicate\n");
  const state = await projectGraphState({ cwd: repo, focus: ["docs/designs/0001-graph.md"] });
  assert.equal(state.blockers.includes("duplicate-id"), true);
  assert.equal(state.blockers.includes("focus-required"), true);
  assert.equal(state.execution.taskGraph, null);
});

test("store-projected tasks need no durable task documents at all", async () => {
  const repo = fixtureRepo();
  fs.rmSync(path.join(repo, "docs/tasks/0001-route.md"));
  fs.rmSync(path.join(repo, "docs/tasks/0002-prepare.md"));
  // No task docs anywhere: task identity is `(runId, taskId)` in the
  // Execution Store — the projection never needs a --task-dir scan root.
  withRun(repo, [{ taskId: "TASK-CUSTOM", status: "todo" }]);
  const state = await projectGraphState({
    cwd: repo,
    focus: ["DESIGN-0001"],
  });
  assert.equal(state.execution.taskGraph?.nodes.map((node) => node.id).join(","), "TASK-CUSTOM");
  assert.equal(state.gates.planning.status, "pass");
  assert.equal(state.knowledge.graph.nodes.some((node) => node.type === "task"), false);
});

test("unresolvable and mistyped relation targets fail closed as knowledge issues", async () => {
  const repo = fixtureRepo();
  writeArtifact(repo, "docs/designs/0002-unresolved.md", {
    id: "DESIGN-0002", type: "design", status: "approved", title: "Unresolved",
    relations: { realizes: ["SPEC-9999"] },
  }, "# Unresolved\n");
  writeArtifact(repo, "docs/designs/0003-wrong-type.md", {
    id: "DESIGN-0003", type: "design", status: "approved", title: "Wrong Type",
    relations: { realizes: ["ADR-0001"] },
  }, "# Wrong Type\n");
  const state = await projectGraphState({ cwd: repo, focus: ["DESIGN-0001"] });
  assert.equal(state.gates.knowledge.status, "blocked");
  assert.ok(state.knowledge.graph.issues.some((issue) => issue.code === "unresolved-relation-target"));
  assert.ok(state.knowledge.graph.issues.some((issue) => issue.code === "invalid-relation-target-type"));
  assert.ok(state.blockers.some((blocker) => blocker.startsWith("knowledge:")));
  assert.ok(state.hardBlockers.length > 0);
});

test("a knowledge integrity issue blocks graph completion even with an otherwise valid chain", async () => {
  const repo = fixtureRepo();
  writeArtifact(repo, "docs/ideas/0001-legacy.md", {
    id: "IDEA-0001", type: "idea", status: "draft", title: "Legacy",
    relations: { "derives-from": ["SPEC-0001"] },
  }, "# Legacy\n");
  const state = await projectGraphState({
    cwd: repo,
    focus: ["DESIGN-0001"],
    signals: ["knowledge-consolidated", "exit-audit-pass"],
  });
  assert.equal(state.gates.knowledge.status, "blocked");
  assert.equal(state.signals.includes("graph-complete"), false);
  assert.ok(Object.values(state.gates).some((result) => result.status !== "pass"));
});

test("multiple valid chains fail closed even when only one has a run", async () => {
  const repo = fixtureRepo();
  writeArtifact(repo, "docs/designs/0002-second.md", {
    id: "DESIGN-0002", type: "design", status: "approved", title: "Second Design",
    relations: { realizes: ["SPEC-0001"] },
  }, "# Second Design\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "Graph ADR",
    relations: { "decides-for": ["DESIGN-0001", "DESIGN-0002"] },
  }, "# Graph ADR\n\n## Considered Options\n\n### A\n\n### B\n");
  const state = await projectGraphState({ cwd: repo, focus: ["SPEC-0001"] });
  assert.ok(state.blockers.includes("focus-required"));
  assert.equal(state.execution.taskGraph, null);
});

test("a Claim ID binds its owning document as focus", async () => {
  const repo = fixtureRepo();
  const specFile = path.join(repo, "docs/specs/0001-graph.md");
  const raw = fs.readFileSync(specFile, "utf8");
  fs.writeFileSync(specFile, raw.replace(
    "- [ ] graph state",
    "- [ ] graph state\n\n<!-- claim:R-01 -->\nThe graph must fail closed.",
  ), "utf8");
  const state = await projectGraphState({ cwd: repo, focus: ["SPEC-0001::R-01"] });
  assert.deepEqual(state.focus, ["docs/specs/0001-graph.md"]);
  assert.equal(state.blockers.includes("focus-required"), false);
  assert.deepEqual(state.gates.briefing, { status: "pass", reasons: [] });
  // An unknown claim key is invalid input — fail closed, never doc-bound.
  const invalid = await projectGraphState({ cwd: repo, focus: ["SPEC-0001::NOPE"] });
  assert.ok(invalid.blockers.includes("focus-invalid"));
});

test("a Run ID selects the run and contributes its declared focus", async () => {
  const repo = fixtureRepo();
  withRun(repo);
  const state = await projectGraphState({ cwd: repo, focus: [RUN_ID] });
  assert.equal(state.execution.run?.runId, RUN_ID);
  assert.deepEqual(state.focus, ["docs/designs/0001-graph.md"]);
  assert.equal(state.execution.taskGraph?.plan?.path, `runs/${RUN_ID}/plan.md`);
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

test("bootstrap gate ignores missing README indexes but still requires canonical dirs", async () => {
  // Every canonical durable dir exists and holds a real artifact, but no
  // README index: indexes are derived (materialized) views, so their
  // absence must not gate graph execution (Issue #195).
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "graph-state-"));
  for (const directory of [
    "docs/ideas", "docs/discovery", "docs/specs", "docs/designs",
    "docs/adr", "docs/knowledge", "docs/verification",
  ]) {
    fs.mkdirSync(path.join(repo, directory), { recursive: true });
  }
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "proposed", title: "Graph",
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph state\n");

  const state = await projectGraphState({ cwd: repo, focus: ["SPEC-0001"] });
  assert.deepEqual(state.gates.bootstrap, { status: "pass", reasons: [] });
  assert.equal(state.blockers.includes("bootstrap-incomplete"), false);
  assert.equal(state.signals.includes("bootstrap-incomplete"), false);
  assert.ok(
    state.gates.bootstrap.reasons.every((reason) => !reason.startsWith("missing-index:")),
    "no missing-index:* reason may gate the graph",
  );

  // A genuinely absent tree still triggers bootstrap through missing-directory.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "graph-state-empty-"));
  const emptyState = await projectGraphState({ cwd: empty });
  assert.equal(emptyState.gates.bootstrap.status, "fail");
  assert.ok(emptyState.gates.bootstrap.reasons.includes("missing-directory:docs/specs"));
  assert.ok(
    emptyState.gates.bootstrap.reasons.every((reason) => reason.startsWith("missing-directory:")),
    "bootstrap reasons are missing-directory only",
  );
  // The legacy corpus is migration-owned: its absence never enters
  // bootstrap reasons (Issue #234).
  assert.ok(emptyState.gates.bootstrap.reasons.every((reason) => !reason.includes("plans") && !reason.includes("tasks")));
  assert.ok(emptyState.blockers.includes("bootstrap-incomplete"));
  assert.ok(emptyState.signals.includes("bootstrap-incomplete"));
});
