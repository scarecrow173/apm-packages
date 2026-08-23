import type { GraphDefinition } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import type { GraphRoute } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_router";
import type { TaskStatus } from "../src/skills/doc-driven-dev-graph/scripts/lib/task_graph";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const matter = require("gray-matter");
const {
  loadGraphDefinition,
} = require("../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition.ts");
const {
  projectGraphState,
} = require("../src/skills/doc-driven-dev-graph/scripts/lib/graph_state.ts");
const {
  routeGraph,
} = require("../src/skills/doc-driven-dev-graph/scripts/lib/graph_router.ts");

type YieldReason =
  | "approval-required"
  | "input-required"
  | "authority-required"
  | "unrecoverable-blocker"
  | "budget-exhausted"
  | "terminal"
  | "single-step-complete";

type ScenarioStep = {
  expectEdge: string | null;
  applyEvidence?: (repo: string, signals: Set<string>) => void;
  delegate?: (repo: string, signals: Set<string>, route: GraphRoute) => YieldReason | void;
  yield?: YieldReason;
  observeOnly?: boolean;
};

type PendingEdge = {
  route: GraphRoute;
  completedAudits: string[];
  delegateComplete: boolean;
  evidenceRecorded: boolean;
};

type ScenarioHandoff = {
  current: string;
  focus: string[];
  signals: string[];
  graphPath: string;
  completedEdges: string[];
  seenRouteFingerprints: string[];
  selfLoopCounts: Record<string, number>;
  auditCounts: Record<string, number>;
  delegateCounts: Record<string, number>;
  checkpoints: GraphRoute[];
  pending: PendingEdge | null;
  hops: number;
};

type ScenarioOptions = {
  repo: string;
  current: string;
  mode: "single-step" | "run-until-yield";
  steps: ScenarioStep[];
  maxHops?: number;
  focus?: string[];
  signals?: string[];
  graphPath?: string;
  resume?: ScenarioHandoff;
};

type ScenarioResult = {
  routes: GraphRoute[];
  checkpoints: GraphRoute[];
  yieldReason: YieldReason | null;
  current: string;
  projectCalls: number;
  events: string[];
  auditCounts: Record<string, number>;
  delegateCounts: Record<string, number>;
  handoff: ScenarioHandoff;
};

const canonicalGraphPath = path.resolve(
  __dirname,
  "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml",
);
const canonicalTargets = [
  "docs/ideas",
  "docs/discovery",
  "docs/specs",
  "docs/designs",
  "docs/plans",
  "docs/tasks",
  "docs/adr",
  "docs/impl/ir",
  "docs/impl/exp",
];

function writeArtifact(repo: string, relativePath: string, data: Record<string, unknown>, body: string): void {
  const file = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify(body, {
    created: "2026-08-24",
    updated: "2026-08-24",
    owners: [],
    relations: {},
    ...data,
  }), "utf8");
}

function updateArtifact(repo: string, relativePath: string, data: Record<string, unknown>): void {
  const file = path.join(repo, relativePath);
  const parsed = matter(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, matter.stringify(parsed.content, { ...parsed.data, ...data }), "utf8");
}

function fixtureRepo(options: {
  taskStatuses?: TaskStatus[];
  dependsOn?: string[][];
  secondPlan?: boolean;
} = {}): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "doc-driven-dev-graph-run-to-yield-"));
  for (const directory of canonicalTargets) {
    fs.mkdirSync(path.join(repo, directory), { recursive: true });
    fs.writeFileSync(path.join(repo, directory, "README.md"), `# ${directory}\n`, "utf8");
  }
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Graph",
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "Graph",
  }, "# Graph\n\n## Considered Options\n\n### A\n\n### B\n");
  writeArtifact(repo, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph",
    relations: { "derives-from": ["SPEC-0001", "ADR-0001"] },
  }, "# Graph\n");
  writeArtifact(repo, "docs/plans/0001-graph.md", {
    id: "PLAN-0001", type: "plan", status: "approved", title: "Graph",
    relations: { "derives-from": ["DESIGN-0001"] },
  }, "# Graph\n");
  (options.taskStatuses ?? ["todo"]).forEach((status, index) => {
    const id = `TASK-${String(index + 1).padStart(4, "0")}`;
    writeArtifact(repo, `docs/tasks/${String(index + 1).padStart(4, "0")}-task.md`, {
      id, type: "task", status, title: id,
      relations: {
        implements: ["docs/plans/0001-graph.md"],
        ...(options.dependsOn?.[index]?.length ? { "depends-on": options.dependsOn[index] } : {}),
      },
    }, "# Task\n\n## Verification\n\n- [ ] node --test\n");
  });
  if (options.secondPlan) {
    writeArtifact(repo, "docs/plans/0002-other.md", {
      id: "PLAN-0002", type: "plan", status: "approved", title: "Other",
      relations: { "derives-from": ["DESIGN-0001"] },
    }, "# Other\n");
  }
  return repo;
}

function addTask(repo: string, index: number, status: TaskStatus = "todo"): void {
  const id = `TASK-${String(index).padStart(4, "0")}`;
  writeArtifact(repo, `docs/tasks/${String(index).padStart(4, "0")}-task.md`, {
    id, type: "task", status, title: id,
    relations: { implements: ["docs/plans/0001-graph.md"] },
  }, "# Task\n\n## Verification\n\n- [ ] node --test\n");
}

function runScenario(options: ScenarioOptions): ScenarioResult {
  const maxHops = options.maxHops ?? 10;
  const graphPath = options.graphPath ?? options.resume?.graphPath ?? canonicalGraphPath;
  const definition = loadGraphDefinition(graphPath);
  const focus = options.focus ?? options.resume?.focus ?? ["PLAN-0001"];
  const signals = new Set(options.signals ?? options.resume?.signals ?? []);
  let current = options.resume?.current ?? options.current;
  let hops = options.resume?.hops ?? 0;
  const routes: GraphRoute[] = [];
  const checkpoints = [...(options.resume?.checkpoints ?? [])];
  const completedEdges = [...(options.resume?.completedEdges ?? [])];
  const seenRouteFingerprints = new Set(options.resume?.seenRouteFingerprints ?? []);
  const selfLoopCounts = { ...(options.resume?.selfLoopCounts ?? {}) };
  const auditCounts = { ...(options.resume?.auditCounts ?? {}) };
  const delegateCounts = { ...(options.resume?.delegateCounts ?? {}) };
  const events: string[] = [];
  let pending = options.resume?.pending ? {
    route: options.resume.pending.route,
    completedAudits: [...options.resume.pending.completedAudits],
    delegateComplete: options.resume.pending.delegateComplete,
    evidenceRecorded: options.resume.pending.evidenceRecorded,
  } : null;
  let projectCalls = 0;

  const project = () => {
    projectCalls += 1;
    return projectGraphState({
      cwd: options.repo,
      graphId: definition.id,
      focus,
      signals: [...signals],
    });
  };

  let state = project();
  let yieldReason: YieldReason | null = null;
  for (let index = 0; index < options.steps.length; index += 1) {
    const step = options.steps[index];
    if (hops >= maxHops) {
      yieldReason = "budget-exhausted";
      break;
    }

    const route = routeGraph({ current, definition, state });
    routes.push(route);
    events.push(`route:${route.edgeId ?? route.status}`);
    assert.equal(route.edgeId, step.expectEdge);

    if (route.status === "terminal") {
      yieldReason = "terminal";
      if (step.yield) assert.equal(step.yield, yieldReason);
      break;
    }
    if (route.status === "blocked") {
      yieldReason = route.blockers.includes("focus-required") || route.blockers.includes("focus-invalid")
        ? "input-required"
        : "unrecoverable-blocker";
      if (step.yield) assert.equal(step.yield, yieldReason);
      break;
    }

    const fingerprint = JSON.stringify(route);
    if (route.edgeId && route.current === route.next && (selfLoopCounts[route.edgeId] ?? 0) >= 1) {
      yieldReason = "budget-exhausted";
      break;
    }
    if (seenRouteFingerprints.has(fingerprint)) {
      yieldReason = "budget-exhausted";
      break;
    }
    if (step.observeOnly) {
      pending = {
        route,
        completedAudits: [],
        delegateComplete: false,
        evidenceRecorded: false,
      };
      break;
    }

    const resumingPending = pending?.route.edgeId === route.edgeId && pending.route.current === route.current
      ? pending
      : null;
    const completedAudits = new Set(resumingPending?.completedAudits ?? []);
    for (const audit of route.requiredAudits) {
      if (completedAudits.has(audit)) continue;
      events.push(`audit:${audit}`);
      completedAudits.add(audit);
      auditCounts[audit] = (auditCounts[audit] ?? 0) + 1;
    }

    let delegateComplete = resumingPending?.delegateComplete ?? false;
    if (route.delegate && !delegateComplete) {
      events.push(`delegate:${route.delegate}`);
      const effectYield = step.delegate?.(options.repo, signals, route);
      if (effectYield) {
        yieldReason = effectYield;
        pending = {
          route,
          completedAudits: [...completedAudits],
          delegateComplete: false,
          evidenceRecorded: false,
        };
        assert.equal(step.yield, effectYield);
        break;
      }
      delegateCounts[route.delegate] = (delegateCounts[route.delegate] ?? 0) + 1;
      delegateComplete = true;
    }

    step.applyEvidence?.(options.repo, signals);
    events.push(`evidence:${route.edgeId}`);
    pending = null;
    checkpoints.push(route);
    completedEdges.push(route.edgeId as string);
    seenRouteFingerprints.add(fingerprint);
    if (route.current === route.next) {
      selfLoopCounts[route.edgeId as string] = (selfLoopCounts[route.edgeId as string] ?? 0) + 1;
    }
    hops += 1;
    current = route.next;

    if (options.mode === "single-step") {
      yieldReason = "single-step-complete";
      if (step.yield) assert.equal(step.yield, yieldReason);
      break;
    }
    if (index + 1 < options.steps.length) {
      events.push("project");
      state = project();
    }
  }

  const handoff: ScenarioHandoff = {
    current,
    focus: [...focus],
    signals: [...signals].sort(),
    graphPath,
    completedEdges,
    seenRouteFingerprints: [...seenRouteFingerprints],
    selfLoopCounts,
    auditCounts,
    delegateCounts,
    checkpoints,
    pending,
    hops,
  };
  return {
    routes,
    checkpoints,
    yieldReason,
    current,
    projectCalls,
    events,
    auditCounts,
    delegateCounts,
    handoff: JSON.parse(JSON.stringify(handoff)),
  };
}

function customGraph(repo: string, text: string): string {
  const file = path.join(repo, "caller-graph.yaml");
  fs.writeFileSync(file, text, "utf8");
  return file;
}

function twoEdgeGraph(repo: string): string {
  return customGraph(repo, `schemaVersion: 2
id: caller-fixture
entry: start
runtimeSignals: [advance]
conditions:
  advance: { kind: signal, signal: advance }
nodes:
  start: { kind: action }
  briefing: { kind: delegate, delegate: briefing-flow, audits: [spec] }
  done: { kind: terminal }
edges:
  - { id: edge-a, from: start, to: briefing, when: advance, priority: 10 }
  - { id: edge-b, from: briefing, to: done, when: advance, priority: 10 }
`);
}

function cycleGraph(repo: string): string {
  return customGraph(repo, `schemaVersion: 2
id: caller-cycle
entry: start
runtimeSignals: [advance]
conditions:
  advance: { kind: signal, signal: advance }
nodes:
  start: { kind: action }
  middle: { kind: action }
edges:
  - { id: cycle-a, from: start, to: middle, when: advance, priority: 10 }
  - { id: cycle-b, from: middle, to: start, when: advance, priority: 10 }
`);
}

test("runs the fully automatic canonical path with fresh projection between checkpoints", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [
      { expectEdge: "probe-to-briefing" },
      { expectEdge: "briefing-to-design" },
      { expectEdge: "design-to-planning" },
      { expectEdge: "planning-to-task-graph" },
    ],
  });
  assert.deepEqual(result.routes.map((route) => route.edgeId), [
    "probe-to-briefing",
    "briefing-to-design",
    "design-to-planning",
    "planning-to-task-graph",
  ]);
  assert.equal(result.checkpoints.length, 4);
  assert.equal(result.projectCalls, 4);
  assert.equal(result.yieldReason, null);
});

test("yields approval exactly once before design evidence is written", () => {
  const repo = fixtureRepo();
  let evidenceCalls = 0;
  const blocked = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "briefing-to-design",
      yield: "approval-required",
      delegate: () => "approval-required",
      applyEvidence: () => { evidenceCalls += 1; },
    }],
  });
  assert.equal(blocked.yieldReason, "approval-required");
  assert.equal(evidenceCalls, 0);
  assert.equal(blocked.checkpoints.length, 0);
  assert.equal(blocked.handoff.pending?.route.edgeId, "briefing-to-design");
  assert.equal(blocked.handoff.pending?.delegateComplete, false);
  assert.equal(blocked.projectCalls, 1);

  const resumed = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    resume: blocked.handoff,
    steps: [{
      expectEdge: "briefing-to-design",
      applyEvidence: () => { evidenceCalls += 1; },
    }],
  });
  assert.equal(resumed.yieldReason, null);
  assert.equal(evidenceCalls, 1);
  assert.equal(resumed.current, "design");
  assert.equal(blocked.auditCounts.design, 1);
  assert.equal(resumed.auditCounts.design, 1);
  assert.equal(resumed.delegateCounts["design-doc"], 1);
});

test("focus input yield leaves the next route and effects untouched", () => {
  const repo = fixtureRepo({ secondPlan: true });
  let effects = 0;
  const result = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    focus: [],
    steps: [{
      expectEdge: null,
      yield: "input-required",
      applyEvidence: () => { effects += 1; },
    }],
  });
  assert.equal(result.yieldReason, "input-required");
  assert.equal(result.routes[0].condition, "blocked");
  assert.equal(effects, 0);
  assert.equal(result.projectCalls, 1);
});

test("resume after a completed edge starts at its recorded next node", () => {
  const repo = fixtureRepo();
  const first = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [{ expectEdge: "probe-to-briefing" }],
  });
  const resumed = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    resume: first.handoff,
    steps: [{ expectEdge: "briefing-to-design" }],
  });
  assert.equal(first.current, "briefing");
  assert.equal(resumed.routes[0].current, "briefing");
  assert.equal(resumed.routes[0].edgeId, "briefing-to-design");
  assert.equal(resumed.delegateCounts["briefing-flow"], 1);
});

test("resume after audit-complete delegate-pending does not repeat the audit", () => {
  const repo = fixtureRepo();
  const first = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "briefing-to-design",
      yield: "authority-required",
      delegate: () => "authority-required",
    }],
  });
  assert.equal(first.auditCounts.design, 1);
  assert.equal(first.handoff.pending?.completedAudits.length, 1);
  const resumed = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    resume: first.handoff,
    steps: [{ expectEdge: "briefing-to-design" }],
  });
  assert.equal(resumed.auditCounts.design, 1);
  assert.equal(resumed.delegateCounts["design-doc"], 1);
  assert.equal(resumed.checkpoints.length, 1);
});

test("continues implementation retry only after re-projection", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    steps: [
      {
        expectEdge: "implementation-retry",
        applyEvidence: (fixture, signals) => {
          updateArtifact(fixture, "docs/tasks/0001-task.md", { status: "done" });
          signals.add("implementation-verified");
          signals.add("followup-terminal");
        },
      },
      { expectEdge: "implementation-to-followup-triage" },
    ],
  });
  assert.deepEqual(result.routes.map((route) => route.edgeId), [
    "implementation-retry",
    "implementation-to-followup-triage",
  ]);
  assert.equal(result.projectCalls, 2);
});

test("continues implementation-to-design and then design-to-planning", () => {
  const repo = fixtureRepo({ taskStatuses: ["done"] });
  const result = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    signals: ["implementation-verified", "design-gap"],
    steps: [
      { expectEdge: "implementation-to-design", applyEvidence: (_repo, signals) => signals.delete("design-gap") },
      { expectEdge: "design-to-planning" },
    ],
  });
  assert.deepEqual(result.routes.map((route) => route.edgeId), [
    "implementation-to-design",
    "design-to-planning",
  ]);
  assert.equal(result.projectCalls, 2);
});

test("repairs an invalid task graph before returning to task-graph", () => {
  const repo = fixtureRepo({
    taskStatuses: ["in-progress", "in-progress"],
    dependsOn: [["TASK-0002"], ["TASK-0001"]],
  });
  const result = runScenario({
    repo,
    current: "task-graph",
    mode: "run-until-yield",
    steps: [
      {
        expectEdge: "task-graph-to-planning",
        applyEvidence: (fixture) => updateArtifact(fixture, "docs/tasks/0002-task.md", {
          status: "todo",
          relations: { implements: ["docs/plans/0001-graph.md"] },
        }),
      },
      { expectEdge: "planning-to-task-graph" },
    ],
  });
  assert.deepEqual(result.routes.map((route) => route.edgeId), [
    "task-graph-to-planning",
    "planning-to-task-graph",
  ]);
  assert.equal(result.projectCalls, 2);
});

test("routes completed implementation work to follow-up triage", () => {
  const repo = fixtureRepo({ taskStatuses: ["done"] });
  const result = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    signals: ["implementation-verified", "followup-terminal"],
    steps: [{ expectEdge: "implementation-to-followup-triage" }],
  });
  assert.equal(result.routes[0].edgeId, "implementation-to-followup-triage");
  assert.equal(result.checkpoints.length, 1);
});

test("allows one completed self-loop then yields budget-exhausted", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    steps: [
      { expectEdge: "implementation-retry" },
      { expectEdge: "implementation-retry", yield: "budget-exhausted" },
    ],
  });
  assert.equal(result.checkpoints.length, 1);
  assert.equal(result.handoff.selfLoopCounts["implementation-retry"], 1);
  assert.equal(result.yieldReason, "budget-exhausted");
});

test("bounds a changing multi-node repair cycle at maxHops", () => {
  const repo = fixtureRepo();
  const steps: ScenarioStep[] = Array.from({ length: 12 }, (_, index) => ({
    expectEdge: index % 2 === 0 ? "design-to-briefing" : "briefing-to-design",
    applyEvidence: (fixture) => addTask(fixture, index + 2),
  }));
  const result = runScenario({
    repo,
    current: "design",
    mode: "run-until-yield",
    signals: ["spec-gap"],
    maxHops: 10,
    steps,
  });
  assert.equal(result.yieldReason, "budget-exhausted");
  assert.equal(result.checkpoints.length, 10);
  assert.equal(result.handoff.hops, 10);
});

test("stops on a repeated complete GraphRoute fingerprint", () => {
  const repo = fixtureRepo();
  const graphPath = cycleGraph(repo);
  const result = runScenario({
    repo,
    graphPath,
    current: "start",
    mode: "run-until-yield",
    signals: ["advance"],
    steps: [
      { expectEdge: "cycle-a" },
      { expectEdge: "cycle-b" },
      { expectEdge: "cycle-a", yield: "budget-exhausted" },
    ],
  });
  assert.equal(result.yieldReason, "budget-exhausted");
  assert.equal(result.checkpoints.length, 2);
  assert.equal(result.handoff.seenRouteFingerprints.length, 2);
  assert.equal(result.routes[2].edgeId, result.routes[0].edgeId);
});

test("terminal re-entry yields one idempotent terminal result", () => {
  const repo = fixtureRepo({ taskStatuses: ["done"] });
  const first = runScenario({
    repo,
    current: "complete",
    mode: "run-until-yield",
    steps: [{ expectEdge: null, yield: "terminal" }],
  });
  const second = runScenario({
    repo,
    current: "complete",
    mode: "run-until-yield",
    steps: [{ expectEdge: null, yield: "terminal" }],
  });
  assert.equal(first.yieldReason, "terminal");
  assert.equal(first.routes.length, 1);
  assert.deepEqual(second.routes, first.routes);
});

test("fails closed for malformed graph, unknown signal, and invalid focus", () => {
  const repo = fixtureRepo();
  const malformed = path.join(repo, "malformed.yaml");
  fs.writeFileSync(malformed, "schemaVersion: 2\nid: malformed\nentry: missing\nnodes: {}\nconditions: {}\nedges: []\n", "utf8");
  assert.throws(() => loadGraphDefinition(malformed), /Invalid graph definition/);

  const tsx = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");
  const cli = path.resolve(__dirname, "../src/skills/doc-driven-dev-graph/scripts/route_graph.ts");
  const unknownSignal = spawnSync(process.execPath, [
    tsx,
    cli,
    "--graph", canonicalGraphPath,
    "--cwd", repo,
    "--focus", "PLAN-0001",
    "--signal", "not-declared",
    "--json",
  ], { encoding: "utf8" });
  assert.notEqual(unknownSignal.status, 0);
  assert.match(unknownSignal.stderr, /Unknown signal not declared/);

  const invalidFocus = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    focus: ["MISSING"],
    steps: [{ expectEdge: null, yield: "input-required" }],
  });
  assert.equal(invalidFocus.yieldReason, "input-required");
  assert.ok(invalidFocus.routes[0].blockers.includes("focus-invalid"));
});

test("blocked route without a declared edge yields unrecoverable-blocker", () => {
  const repo = fixtureRepo();
  const graphPath = customGraph(repo, `schemaVersion: 2
id: blocked-fixture
entry: blocked
runtimeSignals: [never]
conditions:
  never: { kind: signal, signal: never }
nodes:
  blocked: { kind: action }
  done: { kind: terminal }
edges:
  - { id: blocked-to-done, from: blocked, to: done, when: never, priority: 10 }
`);
  const result = runScenario({
    repo,
    graphPath,
    current: "blocked",
    mode: "run-until-yield",
    steps: [{ expectEdge: null, yield: "unrecoverable-blocker" }],
  });
  assert.equal(result.yieldReason, "unrecoverable-blocker");
  assert.equal(result.routes[0].condition, "blocked");
});

test("single-step completes exactly one checkpoint", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "probe",
    mode: "single-step",
    steps: [
      { expectEdge: "probe-to-briefing" },
      { expectEdge: "briefing-to-design" },
    ],
  });
  assert.equal(result.yieldReason, "single-step-complete");
  assert.equal(result.checkpoints.length, 1);
  assert.equal(result.routes.length, 1);
  assert.equal(result.current, "briefing");
});

test("preserves deterministic evidence ordering and full-route fingerprints", () => {
  const firstRepo = fixtureRepo();
  const first = runScenario({
    repo: firstRepo,
    graphPath: twoEdgeGraph(firstRepo),
    current: "start",
    mode: "run-until-yield",
    signals: ["advance"],
    steps: [
      { expectEdge: "edge-a" },
      { expectEdge: "edge-b", observeOnly: true },
    ],
  });
  assert.deepEqual(first.events, [
    "route:edge-a", "audit:spec", "delegate:briefing-flow", "evidence:edge-a",
    "project", "route:edge-b",
  ]);
  assert.equal(first.handoff.seenRouteFingerprints[0], JSON.stringify(first.routes[0]));

  const secondRepo = fixtureRepo();
  const second = runScenario({
    repo: secondRepo,
    graphPath: twoEdgeGraph(secondRepo),
    current: "start",
    mode: "run-until-yield",
    signals: ["advance"],
    steps: [
      { expectEdge: "edge-a" },
      { expectEdge: "edge-b", observeOnly: true },
    ],
  });
  assert.deepEqual(second.routes, first.routes);
});
