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

type ScenarioMode = "single-step" | "run-until-yield";

type ScenarioStep = {
  expectEdge: string | null;
  applyEvidence?: (repo: string, signals: Set<string>) => void;
  audit?: (repo: string, signals: Set<string>, route: GraphRoute, audit: string) => YieldReason | void;
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

type EdgeTrace = {
  route: GraphRoute;
  completedAudits: string[];
  delegate: string | null;
  delegateComplete: boolean;
  evidenceRecorded: boolean;
  checkpointComplete: boolean;
};

type ScenarioHandoff = {
  current: string;
  mode: ScenarioMode;
  maxHops: number;
  yieldReason: YieldReason | null;
  focus: string[];
  signals: string[];
  graphPath: string;
  completedEdges: string[];
  seenRouteFingerprints: string[];
  selfLoopCounts: Record<string, number>;
  auditCounts: Record<string, number>;
  delegateCounts: Record<string, number>;
  checkpoints: GraphRoute[];
  edgeTrace: EdgeTrace[];
  pending: PendingEdge | null;
  hops: number;
};

type ScenarioOptions = {
  repo: string;
  current: string;
  mode: ScenarioMode;
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

type ProofStage = string;

function proofFile(repo: string): string {
  return path.join(repo, "docs/tasks/0001-task.md");
}

function proofMap(repo: string): Record<string, Record<string, boolean | number>> {
  const parsed = matter(fs.readFileSync(proofFile(repo), "utf8"));
  return (parsed.data.callerProofs && typeof parsed.data.callerProofs === "object")
    ? parsed.data.callerProofs as Record<string, Record<string, boolean | number>>
    : {};
}

function hasProof(repo: string, edgeId: string, stage: ProofStage): boolean {
  return proofMap(repo)[edgeId]?.[stage] === true;
}

function proofRevision(repo: string, edgeId: string): number {
  const value = proofMap(repo)[edgeId]?.revision;
  return typeof value === "number" ? value : 0;
}

function receiptScope(route: GraphRoute): string {
  return JSON.stringify({
    edgeId: route.edgeId,
    effect: route.delegate,
    taskGraph: route.taskGraph,
  });
}

function routeProofStage(stage: ProofStage, route: GraphRoute): ProofStage {
  return `${stage}:${receiptScope(route)}`;
}

function hasRouteProof(repo: string, route: GraphRoute, stage: ProofStage): boolean {
  return hasProof(repo, route.edgeId as string, routeProofStage(stage, route));
}

function persistProof(repo: string, edgeId: string, stage: ProofStage): void {
  const file = proofFile(repo);
  const parsed = matter(fs.readFileSync(file, "utf8"));
  const callerProofs = proofMap(repo);
  callerProofs[edgeId] = { ...(callerProofs[edgeId] ?? {}), [stage]: true };
  callerProofs[edgeId].revision = proofRevision(repo, edgeId) + 1;
  fs.writeFileSync(file, matter.stringify(parsed.content, { ...parsed.data, callerProofs }), "utf8");
}

function evidence(
  edgeId: string,
  mutate?: (repo: string, signals: Set<string>) => void,
): (repo: string, signals: Set<string>) => void {
  return (repo, signals) => {
    mutate?.(repo, signals);
    persistProof(repo, edgeId, "evidence");
  };
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

function traceKey(route: GraphRoute): string {
  return `${route.current}\u0000${route.edgeId ?? route.condition}`;
}

function upsertTrace(traces: EdgeTrace[], trace: EdgeTrace): void {
  const index = traces.findIndex((candidate) => traceKey(candidate.route) === traceKey(trace));
  if (index < 0) traces.push(trace);
  else traces[index] = trace;
}

function runScenario(options: ScenarioOptions): ScenarioResult {
  const mode = options.resume?.mode ?? options.mode;
  const maxHops = options.resume?.maxHops ?? options.maxHops ?? 10;
  const graphPath = options.graphPath ?? options.resume?.graphPath ?? canonicalGraphPath;
  const definition = loadGraphDefinition(graphPath);
  const focus = options.focus ?? options.resume?.focus ?? ["PLAN-0001"];
  const signals = new Set(options.signals ?? options.resume?.signals ?? []);
  let current = options.resume?.current ?? options.current;
  let hops = options.resume?.hops ?? 0;
  const routes: GraphRoute[] = [];
  const checkpoints = [...(options.resume?.checkpoints ?? [])];
  const completedEdges = [...(options.resume?.completedEdges ?? [])];
  const edgeTrace = [...(options.resume?.edgeTrace ?? [])];
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
  const expectYield = (step: ScenarioStep, reason: YieldReason) => {
    if (step.yield) assert.equal(step.yield, reason);
  };
  const savePending = (
    route: GraphRoute,
    completedAudits: Set<string>,
    delegateComplete: boolean,
    evidenceRecorded: boolean,
  ) => {
    pending = {
      route,
      completedAudits: [...completedAudits].sort(),
      delegateComplete,
      evidenceRecorded,
    };
    upsertTrace(edgeTrace, {
      route,
      completedAudits: [...completedAudits].sort(),
      delegate: route.delegate,
      delegateComplete,
      evidenceRecorded,
      checkpointComplete: false,
    });
  };

  let state = project();
  let yieldReason: YieldReason | null = null;
  for (let index = 0; index < options.steps.length; index += 1) {
    const step = options.steps[index];
    const route = routeGraph({ current, definition, state });
    routes.push(route);
    events.push(`route:${route.edgeId ?? route.status}`);
    assert.equal(route.edgeId, step.expectEdge);

    if (route.status === "terminal") {
      yieldReason = "terminal";
      expectYield(step, yieldReason);
      break;
    }
    if (route.status === "blocked") {
      yieldReason = route.blockers.includes("focus-required") || route.blockers.includes("focus-invalid")
        ? "input-required"
        : "unrecoverable-blocker";
      expectYield(step, yieldReason);
      break;
    }
    if (hops >= maxHops) {
      yieldReason = "budget-exhausted";
      break;
    }

    const fingerprint = JSON.stringify(route);
    if (route.edgeId && route.current === route.next && (selfLoopCounts[route.edgeId] ?? 0) >= 1) {
      yieldReason = "budget-exhausted";
      expectYield(step, yieldReason);
      break;
    }
    if (seenRouteFingerprints.has(fingerprint)) {
      yieldReason = "budget-exhausted";
      expectYield(step, yieldReason);
      break;
    }
    if (step.observeOnly) {
      savePending(route, new Set(), false, false);
      break;
    }

    const resumingPending = pending?.route.edgeId === route.edgeId && pending.route.current === route.current
      ? pending
      : null;
    if (resumingPending) {
      const scopeChanged = receiptScope(resumingPending.route) !== receiptScope(route);
      const claimedAudits = new Set(resumingPending.completedAudits);
      const unverifiedAudit = [...claimedAudits].some((audit) => (
        !route.requiredAudits.includes(audit)
        || !hasRouteProof(options.repo, resumingPending.route, `audit:${audit}`)
      ));
      const unverifiedDelegate = resumingPending.delegateComplete && (
        !route.delegate || !hasRouteProof(options.repo, resumingPending.route, "delegate")
      );
      const unverifiedEvidence = resumingPending.evidenceRecorded
        && !hasRouteProof(options.repo, resumingPending.route, "evidence");
      if (scopeChanged || unverifiedAudit || unverifiedDelegate || unverifiedEvidence) {
        yieldReason = "authority-required";
        expectYield(step, yieldReason);
        break;
      }
    }

    const completedAudits = new Set(resumingPending?.completedAudits ?? []);
    let stageYield: YieldReason | undefined;
    for (const audit of route.requiredAudits) {
      if (completedAudits.has(audit)) continue;
      events.push(`audit:${audit}`);
      const effectYield = step.audit?.(options.repo, signals, route, audit);
      if (effectYield) {
        stageYield = effectYield;
        break;
      }
      persistProof(options.repo, route.edgeId as string, routeProofStage(`audit:${audit}`, route));
      completedAudits.add(audit);
      auditCounts[audit] = (auditCounts[audit] ?? 0) + 1;
    }
    if (stageYield) {
      yieldReason = stageYield;
      savePending(route, completedAudits, false, false);
      expectYield(step, yieldReason);
      break;
    }

    let delegateComplete = resumingPending?.delegateComplete ?? false;
    if (route.delegate && !delegateComplete) {
      events.push(`delegate:${route.delegate}`);
      const effectYield = step.delegate?.(options.repo, signals, route);
      if (effectYield) {
        yieldReason = effectYield;
        savePending(route, completedAudits, false, false);
        expectYield(step, yieldReason);
        break;
      }
      persistProof(options.repo, route.edgeId as string, routeProofStage("delegate", route));
      delegateCounts[route.delegate] = (delegateCounts[route.delegate] ?? 0) + 1;
      delegateComplete = true;
    }

    let evidenceRecorded = resumingPending?.evidenceRecorded ?? false;
    if (!evidenceRecorded) {
      if (!step.applyEvidence) {
        yieldReason = "authority-required";
        savePending(route, completedAudits, delegateComplete, false);
        expectYield(step, yieldReason);
        break;
      }
      const revisionBeforeEvidence = proofRevision(options.repo, route.edgeId as string);
      step.applyEvidence(options.repo, signals);
      evidenceRecorded = hasProof(options.repo, route.edgeId as string, "evidence")
        && proofRevision(options.repo, route.edgeId as string) > revisionBeforeEvidence;
      if (!evidenceRecorded) {
        yieldReason = "authority-required";
        savePending(route, completedAudits, delegateComplete, false);
        expectYield(step, yieldReason);
        break;
      }
      persistProof(options.repo, route.edgeId as string, routeProofStage("evidence", route));
    }
    events.push(`evidence:${route.edgeId}`);
    pending = null;
    checkpoints.push(route);
    completedEdges.push(route.edgeId as string);
    seenRouteFingerprints.add(fingerprint);
    if (route.current === route.next) {
      selfLoopCounts[route.edgeId as string] = (selfLoopCounts[route.edgeId as string] ?? 0) + 1;
    }
    upsertTrace(edgeTrace, {
      route,
      completedAudits: [...completedAudits].sort(),
      delegate: route.delegate,
      delegateComplete,
      evidenceRecorded: true,
      checkpointComplete: true,
    });
    hops += 1;
    current = route.next;

    if (mode === "single-step") {
      yieldReason = "single-step-complete";
      expectYield(step, yieldReason);
      break;
    }
    if (index + 1 < options.steps.length) {
      events.push("project");
      state = project();
    }
  }

  const handoff: ScenarioHandoff = {
    current,
    mode,
    maxHops,
    yieldReason,
    focus: [...focus],
    signals: [...signals].sort(),
    graphPath,
    completedEdges,
    seenRouteFingerprints: [...seenRouteFingerprints],
    selfLoopCounts,
    auditCounts,
    delegateCounts,
    checkpoints,
    edgeTrace,
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

test("runs a bounded partial canonical path with fresh projection between checkpoints", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [
      { expectEdge: "probe-to-briefing", applyEvidence: evidence("probe-to-briefing", (fixture) => addTask(fixture, 2)) },
      { expectEdge: "briefing-to-design", applyEvidence: evidence("briefing-to-design", (fixture) => addTask(fixture, 3)) },
      { expectEdge: "design-to-planning", applyEvidence: evidence("design-to-planning", (fixture) => addTask(fixture, 4)) },
      { expectEdge: "planning-to-task-graph", applyEvidence: evidence("planning-to-task-graph", (fixture) => addTask(fixture, 5)) },
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
  assert.equal(result.yieldReason, null); // Fixture steps exhausted; this is not a production yield.
  for (let index = 1; index < result.routes.length; index += 1) {
    assert.notDeepEqual(result.routes[index].taskGraph, result.routes[index - 1].taskGraph);
  }
});

test("observes terminal after the 10-edge migration path reaches the hop budget", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    signals: ["migration-requested", "migration-complete"],
    steps: [
      { expectEdge: "probe-to-migration", applyEvidence: evidence("probe-to-migration") },
      { expectEdge: "migration-to-bootstrap", applyEvidence: evidence("migration-to-bootstrap") },
      { expectEdge: "bootstrap-to-briefing", applyEvidence: evidence("bootstrap-to-briefing") },
      { expectEdge: "briefing-to-design", applyEvidence: evidence("briefing-to-design") },
      { expectEdge: "design-to-planning", applyEvidence: evidence("design-to-planning") },
      { expectEdge: "planning-to-task-graph", applyEvidence: evidence("planning-to-task-graph") },
      {
        expectEdge: "task-graph-to-implementation",
        applyEvidence: evidence("task-graph-to-implementation", (fixture, signals) => {
          updateArtifact(fixture, "docs/tasks/0001-task.md", { status: "done" });
          signals.add("implementation-verified");
        }),
      },
      {
        expectEdge: "implementation-to-followup-triage",
        applyEvidence: evidence("implementation-to-followup-triage", (_fixture, signals) => {
          signals.add("followup-terminal");
        }),
      },
      {
        expectEdge: "followup-triage-terminal",
        applyEvidence: evidence("followup-triage-terminal", (_fixture, signals) => {
          signals.add("exit-audit-pass");
        }),
      },
      { expectEdge: "exit-audit-to-complete", applyEvidence: evidence("exit-audit-to-complete") },
      { expectEdge: null, yield: "terminal" },
    ],
  });
  assert.equal(result.checkpoints.length, 10);
  assert.equal(result.handoff.hops, 10);
  assert.equal(result.current, "complete");
  assert.equal(result.yieldReason, "terminal");
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
      applyEvidence: evidence("briefing-to-design", () => { evidenceCalls += 1; }),
    }],
  });
  assert.equal(resumed.yieldReason, null);
  assert.equal(evidenceCalls, 1);
  assert.equal(resumed.current, "design");
  assert.equal(blocked.auditCounts.design, 1);
  assert.equal(resumed.auditCounts.design, 1);
  assert.equal(resumed.delegateCounts["design-doc"], 1, JSON.stringify({ handoff: resumed.handoff, proofs: proofMap(repo) }));
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
    steps: [{ expectEdge: "probe-to-briefing", applyEvidence: evidence("probe-to-briefing") }],
  });
  const resumed = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    resume: first.handoff,
    steps: [{ expectEdge: "briefing-to-design", applyEvidence: evidence("briefing-to-design") }],
  });
  assert.equal(first.current, "briefing");
  assert.equal(resumed.routes[0].current, "briefing");
  assert.equal(resumed.routes[0].edgeId, "briefing-to-design");
  assert.equal(resumed.delegateCounts["design-doc"], 1);
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
    steps: [{ expectEdge: "briefing-to-design", applyEvidence: evidence("briefing-to-design") }],
  });
  assert.equal(resumed.yieldReason, null);
  assert.equal(resumed.auditCounts.design, 1);
  assert.equal(resumed.delegateCounts["design-doc"], 1, JSON.stringify({ handoff: resumed.handoff, proofs: proofMap(repo) }));
  assert.equal(resumed.checkpoints.length, 1);
});

test("resume skips scope-valid pending audit and delegate receipts", () => {
  const repo = fixtureRepo();
  const interrupted = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    steps: [{ expectEdge: "briefing-to-design", yield: "authority-required" }],
  });
  assert.deepEqual(interrupted.handoff.pending?.completedAudits, ["design"]);
  assert.equal(interrupted.handoff.pending?.delegateComplete, true);

  const resumed = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    resume: interrupted.handoff,
    steps: [{ expectEdge: "briefing-to-design", applyEvidence: evidence("briefing-to-design") }],
  });
  assert.deepEqual(resumed.routes[0].taskGraph, interrupted.handoff.pending?.route.taskGraph);
  assert.equal(resumed.yieldReason, null);
  assert.equal(resumed.auditCounts.design, 1);
  assert.equal(resumed.delegateCounts["design-doc"], 1);
  assert.equal(resumed.checkpoints.length, 1);
});

test("does not skip an implementation receipt after its authoritative Task Graph changes", () => {
  const repo = fixtureRepo();
  const interrupted = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    steps: [{ expectEdge: "implementation-retry", yield: "authority-required" }],
  });
  assert.equal(interrupted.handoff.pending?.delegateComplete, true);

  addTask(repo, 2);
  const resumed = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    resume: interrupted.handoff,
    steps: [{
      expectEdge: "implementation-retry",
      applyEvidence: evidence("implementation-retry"),
    }],
  });
  assert.notDeepEqual(resumed.routes[0].taskGraph, interrupted.handoff.pending?.route.taskGraph);
  assert.equal(resumed.yieldReason, "authority-required");
  assert.equal(resumed.delegateCounts["implementation-flow"], 1);
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
        applyEvidence: evidence("implementation-retry", (fixture, signals) => {
          updateArtifact(fixture, "docs/tasks/0001-task.md", { status: "done" });
          signals.add("implementation-verified");
          signals.add("followup-terminal");
        }),
      },
      { expectEdge: "implementation-to-followup-triage", applyEvidence: evidence("implementation-to-followup-triage") },
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
      { expectEdge: "implementation-to-design", applyEvidence: evidence("implementation-to-design", (_repo, signals) => signals.delete("design-gap")) },
      { expectEdge: "design-to-planning", applyEvidence: evidence("design-to-planning") },
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
        applyEvidence: evidence("task-graph-to-planning", (fixture) => updateArtifact(fixture, "docs/tasks/0002-task.md", {
          status: "todo",
          relations: { implements: ["docs/plans/0001-graph.md"] },
        })),
      },
      { expectEdge: "planning-to-task-graph", applyEvidence: evidence("planning-to-task-graph") },
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
    steps: [{ expectEdge: "implementation-to-followup-triage", applyEvidence: evidence("implementation-to-followup-triage") }],
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
      { expectEdge: "implementation-retry", applyEvidence: evidence("implementation-retry") },
      { expectEdge: "implementation-retry", yield: "budget-exhausted" },
    ],
  });
  assert.equal(result.checkpoints.length, 1);
  assert.equal(result.handoff.selfLoopCounts["implementation-retry"], 1);
  assert.equal(result.yieldReason, "budget-exhausted");
});

test("bounds a changing multi-node repair cycle at the default maxHops", () => {
  const repo = fixtureRepo();
  const steps: ScenarioStep[] = Array.from({ length: 12 }, (_, index) => ({
    expectEdge: index % 2 === 0 ? "design-to-briefing" : "briefing-to-design",
    applyEvidence: evidence(index % 2 === 0 ? "design-to-briefing" : "briefing-to-design", (fixture) => addTask(fixture, index + 2)),
  }));
  const result = runScenario({
    repo,
    current: "design",
    mode: "run-until-yield",
    signals: ["spec-gap"],
    steps,
  });
  assert.equal(result.yieldReason, "budget-exhausted");
  assert.equal(result.checkpoints.length, 10);
  assert.equal(result.handoff.maxHops, 10);
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
      { expectEdge: "cycle-a", applyEvidence: evidence("cycle-a") },
      { expectEdge: "cycle-b", applyEvidence: evidence("cycle-b") },
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
      { expectEdge: "probe-to-briefing", applyEvidence: evidence("probe-to-briefing") },
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
      { expectEdge: "edge-a", applyEvidence: evidence("edge-a") },
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
      { expectEdge: "edge-a", applyEvidence: evidence("edge-a") },
      { expectEdge: "edge-b", observeOnly: true },
    ],
  });
  assert.deepEqual(second.routes, first.routes);
});

test("does not trust an unverified delegate-complete resume claim", () => {
  const repo = fixtureRepo();
  const interrupted = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "briefing-to-design",
      yield: "authority-required",
      delegate: () => "authority-required",
    }],
  });
  const forged = JSON.parse(JSON.stringify(interrupted.handoff)) as ScenarioHandoff;
  forged.pending!.delegateComplete = true;
  const resumed = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    resume: forged,
    steps: [{ expectEdge: "briefing-to-design", yield: "authority-required" }],
  });
  assert.equal(resumed.yieldReason, "authority-required");
  assert.equal(resumed.checkpoints.length, 0);
});

test("does not trust an audit claim proved only for another run state", () => {
  const repo = fixtureRepo();
  const interrupted = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "probe-to-briefing",
      yield: "authority-required",
      audit: () => "authority-required",
    }],
  });
  addTask(repo, 2);
  const otherRun = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [{ expectEdge: "probe-to-briefing", observeOnly: true }],
  });
  persistProof(repo, "probe-to-briefing", routeProofStage("audit:adr", otherRun.routes[0]));
  const forged = JSON.parse(JSON.stringify(interrupted.handoff)) as ScenarioHandoff;
  forged.pending!.completedAudits = ["adr"];

  const resumed = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    resume: forged,
    steps: [{
      expectEdge: "probe-to-briefing",
      yield: "authority-required",
      applyEvidence: evidence("probe-to-briefing"),
    }],
  });
  assert.equal(resumed.yieldReason, "authority-required");
  assert.equal(resumed.checkpoints.length, 0);
});

test("does not trust an evidence claim proved only for another run state", () => {
  const repo = fixtureRepo();
  const interrupted = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    steps: [{ expectEdge: "briefing-to-design", yield: "authority-required" }],
  });
  addTask(repo, 2);
  const otherRun = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    steps: [{ expectEdge: "briefing-to-design", observeOnly: true }],
  });
  persistProof(repo, "briefing-to-design", routeProofStage("audit:design", otherRun.routes[0]));
  persistProof(repo, "briefing-to-design", routeProofStage("delegate", otherRun.routes[0]));
  persistProof(repo, "briefing-to-design", routeProofStage("evidence", otherRun.routes[0]));
  const forged = JSON.parse(JSON.stringify(interrupted.handoff)) as ScenarioHandoff;
  forged.pending!.evidenceRecorded = true;

  const resumed = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    resume: forged,
    steps: [{ expectEdge: "briefing-to-design", yield: "authority-required" }],
  });
  assert.equal(resumed.yieldReason, "authority-required");
  assert.equal(resumed.checkpoints.length, 0);
});

test("does not complete an edge when its evidence callback leaves no canonical proof", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "probe-to-briefing",
      yield: "authority-required",
      applyEvidence: (fixture) => updateArtifact(fixture, "docs/tasks/0001-task.md", { title: "changed-without-proof" }),
    }],
  });
  assert.equal(result.yieldReason, "authority-required");
  assert.equal(result.checkpoints.length, 0);
  assert.equal(result.handoff.pending?.evidenceRecorded, false);
});

test("audit effects can yield and resume without repeating completed audits", () => {
  const repo = fixtureRepo();
  let auditCalls = 0;
  const interrupted = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "probe-to-briefing",
      yield: "approval-required",
      audit: () => {
        auditCalls += 1;
        return auditCalls === 2 ? "approval-required" : undefined;
      },
    }],
  });
  assert.equal(interrupted.yieldReason, "approval-required");
  assert.equal(interrupted.auditCounts.adr, 1);
  assert.equal(interrupted.auditCounts.spec, undefined);
  assert.deepEqual(interrupted.handoff.pending?.completedAudits, ["adr"]);

  const resumed = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    resume: interrupted.handoff,
    steps: [{ expectEdge: "probe-to-briefing", applyEvidence: evidence("probe-to-briefing") }],
  });
  assert.equal(resumed.yieldReason, null);
  assert.equal(resumed.auditCounts.adr, 1);
  assert.equal(resumed.auditCounts.spec, 1);
  assert.equal(resumed.checkpoints.length, 1);
});

test("handoff records caller mode, hop bound, and per-edge completion trace", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "probe",
    mode: "single-step",
    maxHops: 4,
    steps: [{ expectEdge: "probe-to-briefing", applyEvidence: evidence("probe-to-briefing") }],
  });
  assert.equal(result.handoff.mode, "single-step");
  assert.equal(result.handoff.maxHops, 4);
  assert.equal(result.handoff.yieldReason, "single-step-complete");
  assert.equal(result.handoff.edgeTrace.length, 1);
  assert.deepEqual(result.handoff.edgeTrace[0].completedAudits, ["adr", "spec"]);
  assert.equal(result.handoff.edgeTrace[0].delegate, "briefing-flow");
  assert.equal(result.handoff.edgeTrace[0].delegateComplete, true);
  assert.equal(result.handoff.edgeTrace[0].evidenceRecorded, true);
  assert.equal(result.handoff.edgeTrace[0].checkpointComplete, true);
});
