import type { GraphDefinition } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import type { GraphRoute } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_router";
import type { TaskStatus } from "../src/skills/doc-driven-dev-graph/scripts/lib/task_graph";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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

type EffectYieldReason = Extract<YieldReason,
  "approval-required" | "input-required" | "authority-required" | "unrecoverable-blocker">;

type CanonicalReference = {
  path: string;
  id: string;
  fingerprint: string;
};

type EffectIdentity = {
  kind: "audit" | "delegate";
  id: string;
};

type CompletedEffectOutcome = {
  status: "completed";
  edgeId: string;
  stage: "audit" | "delegate";
  effect: EffectIdentity;
  authoritativeInputs: CanonicalReference[];
  evidence: CanonicalReference[];
  proof: {
    canonicalEvidence?: CanonicalReference;
    providerIdempotency?: { provider: string; key: string };
  };
  reason?: never;
  retry?: never;
};

type RetryEffectOutcome = {
  status: "retry";
  edgeId: string;
  stage: "audit" | "delegate";
  effect: EffectIdentity;
  authoritativeInputs: CanonicalReference[];
  evidence: CanonicalReference[];
  retry: { changedEvidence: CanonicalReference[] };
  proof?: never;
  reason?: never;
};

type YieldEffectOutcome = {
  status: "yield";
  edgeId: string;
  stage: "audit" | "delegate";
  effect: EffectIdentity;
  authoritativeInputs: CanonicalReference[];
  evidence: CanonicalReference[];
  reason: EffectYieldReason;
  proof?: never;
  retry?: never;
};

type EffectOutcome = CompletedEffectOutcome | RetryEffectOutcome | YieldEffectOutcome;

type ScenarioStep = {
  expectEdge: string | null;
  applyEvidence?: (repo: string, signals: Set<string>) => void;
  audit?: (repo: string, signals: Set<string>, route: GraphRoute, audit: string) => EffectOutcome;
  delegate?: (repo: string, signals: Set<string>, route: GraphRoute) => EffectOutcome;
  yield?: YieldReason;
  observeOnly?: boolean;
};

type PendingEdge = {
  route: GraphRoute;
  outcomes: EffectOutcome[];
  completedAudits: string[];
  delegateComplete: boolean;
  evidenceRecorded: boolean;
};

type EdgeTrace = {
  route: GraphRoute;
  outcomes: EffectOutcome[];
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
  outcomes: EffectOutcome[];
  pending: PendingEdge | null;
  hops: number;
};

type GraphRunResult = {
  status: "yielded";
  reason: YieldReason;
  route: GraphRoute;
  outcomes: EffectOutcome[];
  trace: EdgeTrace[];
  handoff: ScenarioHandoff;
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
  outcomes: EffectOutcome[];
  handoff: ScenarioHandoff;
  graphRun?: GraphRunResult;
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

const proofRelativePath = "docs/tasks/0001-task.md";
const canonicalDocumentPaths = [
  "docs/specs/0001-graph.md",
  "docs/adr/0001-graph.md",
  "docs/designs/0001-graph.md",
  "docs/plans/0001-graph.md",
  proofRelativePath,
  "docs/impl/ir/0001-task.md",
];
const footerDelegates = new Set([
  "briefing-flow",
  "design-doc",
  "planning-flow",
  "implementation-flow",
  "doc-status",
]);
const callerNormalizedDelegates = new Set(["migrate_docs", "scaffold_docs", "build_task_graph"]);
const callerNormalizedAudits = new Set(["spec", "adr", "design", "plan", "task", "impl-record", "all"]);

function proofFile(repo: string): string {
  return path.join(repo, proofRelativePath);
}

function fingerprint(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function filesystemEntryKind(target: string): string {
  if (!fs.existsSync(target)) return "missing";
  const entry = fs.statSync(target);
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  return "other";
}

function canonicalReference(repo: string, relativePath: string): CanonicalReference {
  if (relativePath === ".") {
    const entries = canonicalTargets.flatMap((directory) => {
      const target = path.join(repo, directory);
      return [
        `${directory}:${filesystemEntryKind(target)}`,
        `${directory}/README.md:${filesystemEntryKind(path.join(target, "README.md"))}`,
      ];
    });
    return {
      path: relativePath,
      id: "WORKSPACE_ROOT",
      fingerprint: fingerprint(entries.join("\n")),
    };
  }
  const file = path.join(repo, relativePath);
  const parsed = matter(fs.readFileSync(file, "utf8"));
  const { effectOutcomes: _outcomes, checkpointEvidence: _checkpoints, ...data } = parsed.data;
  return {
    path: relativePath,
    id: data.id as string,
    fingerprint: fingerprint(matter.stringify(parsed.content, data)),
  };
}

function isCallerNormalizedEffect(stage: EffectOutcome["stage"], effectId: string): boolean {
  return stage === "audit" ? callerNormalizedAudits.has(effectId) : callerNormalizedDelegates.has(effectId);
}

function taskGraphPaths(route: GraphRoute): string[] {
  return route.taskGraph?.nodes.map((node) => node.path) ?? [proofRelativePath];
}

function selectedTaskGraphPlanPath(route: GraphRoute): string {
  const plan = route.taskGraph?.plan;
  if (typeof plan !== "string" || plan.length === 0) {
    throw new Error("Missing selected Task Graph plan for build_task_graph");
  }
  return plan;
}

function effectInputPaths(route: GraphRoute, effect: EffectIdentity): string[] {
  if (effect.kind === "audit") {
    switch (effect.id) {
      case "spec": return ["docs/specs/0001-graph.md"];
      case "adr": return ["docs/adr/0001-graph.md"];
      case "design": return ["docs/designs/0001-graph.md"];
      case "plan": return ["docs/plans/0001-graph.md"];
      case "task": return taskGraphPaths(route);
      case "impl-record": return ["docs/impl/ir/0001-task.md"];
      case "all": return canonicalDocumentPaths;
    }
  }
  switch (effect.id) {
    case "migrate_docs": return canonicalDocumentPaths;
    case "scaffold_docs": return ["."];
    case "build_task_graph": return [selectedTaskGraphPlanPath(route), ...taskGraphPaths(route)];
    case "briefing-flow": return ["docs/specs/0001-graph.md", "docs/adr/0001-graph.md"];
    case "design-doc": return ["docs/specs/0001-graph.md", "docs/adr/0001-graph.md"];
    case "planning-flow": return ["docs/designs/0001-graph.md"];
    case "implementation-flow": return [...taskGraphPaths(route), "docs/designs/0001-graph.md", "docs/plans/0001-graph.md"];
    case "doc-status": return canonicalDocumentPaths;
    default: throw new Error(`No authoritative-input mapping for ${effect.kind}:${effect.id}`);
  }
}

function effectEvidencePath(route: GraphRoute, effect: EffectIdentity): string {
  if (effect.kind === "audit") return effectInputPaths(route, effect)[0];
  switch (effect.id) {
    case "design-doc": return "docs/designs/0001-graph.md";
    case "planning-flow": return "docs/plans/0001-graph.md";
    case "implementation-flow": return "docs/impl/ir/0001-task.md";
    case "doc-status": return "docs/impl/ir/0001-task.md";
    default: return effectInputPaths(route, effect)[0];
  }
}

function authoritativeInputs(repo: string, route: GraphRoute, effect: EffectIdentity): CanonicalReference[] {
  const paths = effectInputPaths(route, effect);
  return [...new Set(paths)].sort().map((relativePath) => canonicalReference(repo, relativePath));
}

function evidenceReference(repo: string, route: GraphRoute, effect: EffectIdentity): CanonicalReference {
  return canonicalReference(repo, effectEvidencePath(route, effect));
}

function completedOutcome(
  repo: string,
  route: GraphRoute,
  stage: EffectOutcome["stage"],
  effect: EffectIdentity,
  providerIdempotency?: { provider: string; key: string },
): CompletedEffectOutcome {
  const evidence = evidenceReference(repo, route, effect);
  const evidenceReferences = effect.id === "planning-flow"
    ? [evidence, ...taskGraphPaths(route).map((relativePath) => canonicalReference(repo, relativePath))]
    : [evidence];
  return {
    status: "completed",
    edgeId: route.edgeId as string,
    stage,
    effect,
    authoritativeInputs: authoritativeInputs(repo, route, effect),
    evidence: evidenceReferences,
    proof: providerIdempotency ? { providerIdempotency } : { canonicalEvidence: evidence },
  };
}

function yieldOutcome(
  repo: string,
  route: GraphRoute,
  stage: EffectOutcome["stage"],
  effect: EffectIdentity,
  reason: EffectYieldReason,
): YieldEffectOutcome {
  return {
    status: "yield",
    edgeId: route.edgeId as string,
    stage,
    effect,
    authoritativeInputs: authoritativeInputs(repo, route, effect),
    evidence: [evidenceReference(repo, route, effect)],
    reason,
  };
}

function retryOutcome(
  repo: string,
  route: GraphRoute,
  stage: EffectOutcome["stage"],
  effect: EffectIdentity,
  changedEvidence: CanonicalReference[],
): RetryEffectOutcome {
  return {
    status: "retry",
    edgeId: route.edgeId as string,
    stage,
    effect,
    authoritativeInputs: authoritativeInputs(repo, route, effect),
    evidence: [evidenceReference(repo, route, effect)],
    retry: { changedEvidence },
  };
}

function isCanonicalReference(value: unknown): value is CanonicalReference {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as CanonicalReference).path === "string"
    && typeof (value as CanonicalReference).id === "string"
    && typeof (value as CanonicalReference).fingerprint === "string";
}

function validateEffectOutcome(
  repo: string,
  route: GraphRoute,
  outcome: EffectOutcome,
  stage: EffectOutcome["stage"],
  effect: EffectIdentity,
): void {
  assert.ok(["completed", "retry", "yield"].includes(outcome.status), "unknown EffectOutcome status");
  assert.equal(outcome.edgeId, route.edgeId);
  assert.equal(outcome.stage, stage);
  assert.deepEqual(outcome.effect, effect);
  assert.ok(outcome.authoritativeInputs.length > 0 && outcome.authoritativeInputs.every(isCanonicalReference));
  assert.deepEqual(outcome.authoritativeInputs, authoritativeInputs(repo, route, effect));
  assert.ok(outcome.evidence.length > 0 && outcome.evidence.every(isCanonicalReference));
  assert.ok(outcome.evidence.every((evidence) => canonicalEvidenceMatches(repo, evidence)), "outcome evidence must resolve current canonical content");
  if (outcome.status === "completed") {
    assert.equal("reason" in outcome, false, "completed outcome must not include reason");
    assert.equal("retry" in outcome, false, "completed outcome must not include retry");
    const proof = outcome.proof ?? {};
    const hasCanonicalEvidence = isCanonicalReference(proof.canonicalEvidence);
    const hasProviderIdempotency = typeof proof.providerIdempotency?.provider === "string"
      && proof.providerIdempotency.provider.length > 0
      && typeof proof.providerIdempotency.key === "string"
      && proof.providerIdempotency.key.length > 0;
    assert.equal(hasCanonicalEvidence !== hasProviderIdempotency, true);
    if (hasCanonicalEvidence) {
      assert.ok(canonicalEvidenceMatches(repo, proof.canonicalEvidence), "completed proof must resolve current canonical content");
    }
  } else if (outcome.status === "retry") {
    assert.equal("proof" in outcome, false, "retry outcome must not include proof");
    assert.equal("reason" in outcome, false, "retry outcome must not include reason");
    assert.ok(outcome.retry.changedEvidence.length > 0 && outcome.retry.changedEvidence.every(isCanonicalReference));
    assert.ok(outcome.retry.changedEvidence.every((evidence) => canonicalEvidenceMatches(repo, evidence)), "retry evidence must resolve current canonical content");
  } else {
    assert.equal("proof" in outcome, false, "yield outcome must not include proof");
    assert.equal("retry" in outcome, false, "yield outcome must not include retry");
    assert.ok(["approval-required", "input-required", "authority-required", "unrecoverable-blocker"].includes(outcome.reason));
  }
}

function storedOutcomes(repo: string): EffectOutcome[] {
  const parsed = matter(fs.readFileSync(proofFile(repo), "utf8"));
  return Array.isArray(parsed.data.effectOutcomes) ? parsed.data.effectOutcomes as EffectOutcome[] : [];
}

function persistOutcome(repo: string, outcome: EffectOutcome): void {
  const file = proofFile(repo);
  const parsed = matter(fs.readFileSync(file, "utf8"));
  const outcomes = storedOutcomes(repo);
  if (!outcomes.some((stored) => JSON.stringify(stored) === JSON.stringify(outcome))) outcomes.push(outcome);
  fs.writeFileSync(file, matter.stringify(parsed.content, { ...parsed.data, effectOutcomes: outcomes }), "utf8");
}

function hasStoredOutcome(repo: string, outcome: EffectOutcome): boolean {
  return storedOutcomes(repo).some((stored) => JSON.stringify(stored) === JSON.stringify(outcome));
}

function canonicalEvidenceMatches(repo: string, evidence: CanonicalReference): boolean {
  if (path.isAbsolute(evidence.path)) return false;
  const resolved = path.resolve(repo, evidence.path);
  const relative = path.relative(repo, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(resolved)) return false;
  try {
    const current = canonicalReference(repo, evidence.path);
    return current.id === evidence.id && current.fingerprint === evidence.fingerprint;
  } catch {
    return false;
  }
}

type EvidenceReceipt = { edgeId: string; evidence: CanonicalReference };

function evidenceReceipts(repo: string): EvidenceReceipt[] {
  const parsed = matter(fs.readFileSync(proofFile(repo), "utf8"));
  return Array.isArray(parsed.data.checkpointEvidence)
    ? parsed.data.checkpointEvidence as EvidenceReceipt[]
    : [];
}

function persistEvidence(repo: string, edgeId: string): void {
  const file = proofFile(repo);
  const parsed = matter(fs.readFileSync(file, "utf8"));
  const receipts = evidenceReceipts(repo);
  receipts.push({ edgeId, evidence: canonicalReference(repo, proofRelativePath) });
  fs.writeFileSync(file, matter.stringify(parsed.content, { ...parsed.data, checkpointEvidence: receipts }), "utf8");
}

function hasEvidence(repo: string, edgeId: string): boolean {
  return evidenceReceipts(repo).some((receipt) => (
    receipt.edgeId === edgeId
    && isCanonicalReference(receipt.evidence)
    && canonicalEvidenceMatches(repo, receipt.evidence)
  ));
}

function defaultEffectOutcome(
  repo: string,
  route: GraphRoute,
  stage: EffectOutcome["stage"],
  effect: EffectIdentity,
): CompletedEffectOutcome {
  assert.ok(
    isCallerNormalizedEffect(stage, effect.id)
      || (stage === "delegate" && footerDelegates.has(effect.id)),
    `No EffectOutcome producer for ${stage}:${effect.id}`,
  );
  return completedOutcome(repo, route, stage, effect);
}

function isReusableCompletedOutcome(repo: string, route: GraphRoute, outcome: EffectOutcome): boolean {
  if (outcome.status !== "completed") return false;
  const validEffect = outcome.stage === "audit"
    ? outcome.effect.kind === "audit" && route.requiredAudits.includes(outcome.effect.id)
    : outcome.effect.kind === "delegate" && outcome.effect.id === route.delegate;
  if (!validEffect) return false;
  try {
    validateEffectOutcome(repo, route, outcome, outcome.stage, outcome.effect);
  } catch {
    return false;
  }
  if (!hasStoredOutcome(repo, outcome)) return false;
  const proof = outcome.proof;
  return proof?.providerIdempotency !== undefined
    || (isCanonicalReference(proof?.canonicalEvidence)
      && canonicalEvidenceMatches(repo, proof.canonicalEvidence));
}

function evaluateEffectOutcome(outcome: EffectOutcome): EffectYieldReason | "retry" | null {
  if (outcome.status === "yield") return outcome.reason;
  if (outcome.status === "retry") return "retry";
  return null;
}

function evidence(
  edgeId: string,
  mutate?: (repo: string, signals: Set<string>) => void,
): (repo: string, signals: Set<string>) => void {
  return (repo, signals) => {
    mutate?.(repo, signals);
    persistEvidence(repo, edgeId);
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
  writeArtifact(repo, "docs/impl/ir/0001-task.md", {
    id: "IMPL-0001", type: "implementation-record", status: "complete", title: "Graph implementation",
  }, "# Implementation Record\n");
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

function graphRun(result: ScenarioResult): GraphRunResult {
  assert.ok(result.graphRun, "yielded scenarios must return GraphRunResult");
  return result.graphRun;
}

function traceKey(route: GraphRoute): string {
  return `${route.current}\u0000${route.edgeId ?? route.condition}`;
}

function recordTrace(traces: EdgeTrace[], trace: EdgeTrace): void {
  const index = traces.findLastIndex((candidate) =>
    traceKey(candidate.route) === traceKey(trace.route) && !candidate.checkpointComplete,
  );
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
  const outcomes = [...(options.resume?.outcomes ?? [])];
  const events: string[] = [];
  let pending = options.resume?.pending ? {
    route: options.resume.pending.route,
    outcomes: [...options.resume.pending.outcomes],
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
    edgeOutcomes: EffectOutcome[],
    evidenceRecorded: boolean,
  ) => {
    const completedAudits = edgeOutcomes
      .filter((outcome): outcome is CompletedEffectOutcome => outcome.status === "completed" && outcome.stage === "audit")
      .map((outcome) => outcome.effect.id)
      .sort();
    const delegateComplete = edgeOutcomes.some((outcome) => (
      outcome.status === "completed" && outcome.stage === "delegate" && outcome.effect.id === route.delegate
    ));
    pending = {
      route,
      outcomes: [...edgeOutcomes],
      completedAudits,
      delegateComplete,
      evidenceRecorded,
    };
    recordTrace(edgeTrace, {
      route,
      outcomes: [...edgeOutcomes],
      completedAudits,
      delegate: route.delegate,
      delegateComplete,
      evidenceRecorded,
      checkpointComplete: false,
    });
  };

  let state = project();
  let yieldReason: YieldReason | null = null;
  stepLoop: for (let index = 0; index < options.steps.length; index += 1) {
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
      savePending(route, [], false);
      break;
    }

    const resumingPending = pending?.route.edgeId === route.edgeId && pending.route.current === route.current
      ? pending
      : null;
    if (resumingPending) {
      const invalidReceipt = resumingPending.outcomes
        .filter((outcome): outcome is CompletedEffectOutcome => outcome.status === "completed")
        .some((outcome) => !isReusableCompletedOutcome(options.repo, route, outcome));
      const unverifiedEvidence = resumingPending.evidenceRecorded && !hasEvidence(options.repo, route.edgeId as string);
      if (invalidReceipt || unverifiedEvidence) {
        yieldReason = "authority-required";
        expectYield(step, yieldReason);
        break;
      }
    }

    const edgeOutcomes = [...(resumingPending?.outcomes ?? [])];
    const completedAudits = new Set(edgeOutcomes
      .filter((outcome): outcome is CompletedEffectOutcome => outcome.status === "completed" && outcome.stage === "audit")
      .map((outcome) => outcome.effect.id));
    for (const audit of route.requiredAudits) {
      if (completedAudits.has(audit)) continue;
      events.push(`audit:${audit}`);
      const effect: EffectIdentity = { kind: "audit", id: audit };
      const outcome = step.audit?.(options.repo, signals, route, audit)
        ?? defaultEffectOutcome(options.repo, route, "audit", effect);
      validateEffectOutcome(options.repo, route, outcome, "audit", effect);
      edgeOutcomes.push(outcome);
      outcomes.push(outcome);
      persistOutcome(options.repo, outcome);
      const evaluation = evaluateEffectOutcome(outcome);
      if (evaluation === "retry") {
        savePending(route, edgeOutcomes, false);
        if (index + 1 < options.steps.length) {
          events.push("project");
          state = project();
          continue stepLoop;
        }
        break stepLoop;
      }
      if (evaluation) {
        yieldReason = evaluation;
        savePending(route, edgeOutcomes, false);
        expectYield(step, yieldReason);
        break stepLoop;
      }
      completedAudits.add(audit);
      auditCounts[audit] = (auditCounts[audit] ?? 0) + 1;
    }

    let delegateComplete = edgeOutcomes.some((outcome) => (
      outcome.status === "completed" && outcome.stage === "delegate" && outcome.effect.id === route.delegate
    ));
    if (route.delegate && !delegateComplete) {
      events.push(`delegate:${route.delegate}`);
      const effect: EffectIdentity = { kind: "delegate", id: route.delegate };
      const outcome = step.delegate?.(options.repo, signals, route)
        ?? defaultEffectOutcome(options.repo, route, "delegate", effect);
      validateEffectOutcome(options.repo, route, outcome, "delegate", effect);
      edgeOutcomes.push(outcome);
      outcomes.push(outcome);
      persistOutcome(options.repo, outcome);
      const evaluation = evaluateEffectOutcome(outcome);
      if (evaluation === "retry") {
        savePending(route, edgeOutcomes, false);
        if (index + 1 < options.steps.length) {
          events.push("project");
          state = project();
          continue stepLoop;
        }
        break stepLoop;
      }
      if (evaluation) {
        yieldReason = evaluation;
        savePending(route, edgeOutcomes, false);
        expectYield(step, yieldReason);
        break stepLoop;
      }
      delegateCounts[route.delegate] = (delegateCounts[route.delegate] ?? 0) + 1;
      delegateComplete = true;
    }

    let evidenceRecorded = resumingPending?.evidenceRecorded === true && hasEvidence(options.repo, route.edgeId as string);
    if (!evidenceRecorded) {
      if (!step.applyEvidence) {
        yieldReason = "authority-required";
        savePending(route, edgeOutcomes, false);
        expectYield(step, yieldReason);
        break;
      }
      const evidenceBefore = evidenceReceipts(options.repo).filter((receipt) => receipt.edgeId === route.edgeId).length;
      step.applyEvidence(options.repo, signals);
      evidenceRecorded = hasEvidence(options.repo, route.edgeId as string)
        && evidenceReceipts(options.repo).filter((receipt) => receipt.edgeId === route.edgeId).length > evidenceBefore;
      if (!evidenceRecorded) {
        yieldReason = "authority-required";
        savePending(route, edgeOutcomes, false);
        expectYield(step, yieldReason);
        break;
      }
    }
    events.push(`evidence:${route.edgeId}`);
    pending = null;
    checkpoints.push(route);
    completedEdges.push(route.edgeId as string);
    seenRouteFingerprints.add(fingerprint);
    if (route.current === route.next) {
      selfLoopCounts[route.edgeId as string] = (selfLoopCounts[route.edgeId as string] ?? 0) + 1;
    }
    recordTrace(edgeTrace, {
      route,
      outcomes: [...edgeOutcomes],
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
    outcomes,
    pending,
    hops,
  };
  const finalRoute = routes[routes.length - 1];
  const graphRun: GraphRunResult | undefined = yieldReason !== null && finalRoute
    ? {
      status: "yielded",
      reason: yieldReason,
      route: finalRoute,
      outcomes: [...outcomes],
      trace: [...edgeTrace],
      handoff: JSON.parse(JSON.stringify(handoff)),
    }
    : undefined;
  return {
    routes,
    checkpoints,
    yieldReason,
    current,
    projectCalls,
    events,
    auditCounts,
    delegateCounts,
    outcomes,
    handoff: JSON.parse(JSON.stringify(handoff)),
    graphRun,
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
      delegate: (fixture, _signals, route) => yieldOutcome(
        fixture,
        route,
        "delegate",
        { kind: "delegate", id: route.delegate as string },
        "approval-required",
      ),
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
  assert.equal(resumed.delegateCounts["design-doc"], 1, JSON.stringify({ handoff: resumed.handoff, outcomes: storedOutcomes(repo) }));
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
      delegate: (fixture, _signals, route) => yieldOutcome(
        fixture,
        route,
        "delegate",
        { kind: "delegate", id: route.delegate as string },
        "authority-required",
      ),
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
  assert.equal(resumed.delegateCounts["design-doc"], 1, JSON.stringify({ handoff: resumed.handoff, outcomes: storedOutcomes(repo) }));
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

test("runs planning-flow before downstream plan and task audits", () => {
  const repo = fixtureRepo({ taskStatuses: ["todo", "todo"] });
  const result = runScenario({
    repo,
    current: "design",
    mode: "run-until-yield",
    steps: [
      { expectEdge: "design-to-planning", applyEvidence: evidence("design-to-planning") },
      { expectEdge: "planning-to-task-graph", applyEvidence: evidence("planning-to-task-graph") },
    ],
  });

  assert.deepEqual(result.events, [
    "route:design-to-planning",
    "audit:design",
    "delegate:planning-flow",
    "evidence:design-to-planning",
    "project",
    "route:planning-to-task-graph",
    "audit:plan",
    "audit:task",
    "delegate:build_task_graph",
    "evidence:planning-to-task-graph",
  ]);
  assert.equal(result.delegateCounts["planning-flow"], 1);
  assert.equal(result.delegateCounts.build_task_graph, 1);
  assert.deepEqual(result.routes.map((route) => route.edgeId), [
    "design-to-planning",
    "planning-to-task-graph",
  ]);
  const planningOutcome = result.outcomes.find((outcome) => (
    outcome.stage === "delegate" && outcome.effect.id === "planning-flow"
  ));
  assert.deepEqual(planningOutcome?.evidence, [
    canonicalReference(repo, "docs/plans/0001-graph.md"),
    canonicalReference(repo, "docs/tasks/0001-task.md"),
    canonicalReference(repo, "docs/tasks/0002-task.md"),
  ]);
  assert.deepEqual(planningOutcome?.proof, {
    canonicalEvidence: canonicalReference(repo, "docs/plans/0001-graph.md"),
  });
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
  assert.equal(graphRun(result).trace.length, 10);
  assert.deepEqual(graphRun(result).trace.map((entry) => entry.route.edgeId), steps.slice(0, 10).map((step) => step.expectEdge));
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
      delegate: (fixture, _signals, route) => yieldOutcome(
        fixture,
        route,
        "delegate",
        { kind: "delegate", id: route.delegate as string },
        "authority-required",
      ),
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

test("does not trust an audit receipt absent from canonical evidence", () => {
  const repo = fixtureRepo();
  const interrupted = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "probe-to-briefing",
      yield: "authority-required",
      audit: (fixture, _signals, route, audit) => yieldOutcome(
        fixture,
        route,
        "audit",
        { kind: "audit", id: audit },
        "authority-required",
      ),
    }],
  });
  const forged = JSON.parse(JSON.stringify(interrupted.handoff)) as ScenarioHandoff;
  forged.pending!.outcomes = [completedOutcome(
    repo,
    interrupted.handoff.pending!.route,
    "audit",
    { kind: "audit", id: "adr" },
  )];

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

test("does not reuse persisted canonical evidence after its content changes", () => {
  const repo = fixtureRepo();
  const interrupted = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "briefing-to-design",
      yield: "authority-required",
      delegate: (fixture, _signals, route) => {
        const canonicalEvidence = canonicalReference(fixture, "docs/designs/0001-graph.md");
        return {
          ...completedOutcome(
            fixture,
            route,
            "delegate",
            { kind: "delegate", id: route.delegate as string },
          ),
          evidence: [canonicalEvidence],
          proof: { canonicalEvidence },
        };
      },
    }],
  });
  updateArtifact(repo, "docs/designs/0001-graph.md", { title: "Changed Graph" });

  const resumed = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    resume: interrupted.handoff,
    steps: [{
      expectEdge: "briefing-to-design",
      yield: "authority-required",
      applyEvidence: evidence("briefing-to-design"),
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
      audit: (fixture, _signals, route, audit) => {
        auditCalls += 1;
        return auditCalls === 2
          ? yieldOutcome(fixture, route, "audit", { kind: "audit", id: audit }, "approval-required")
          : completedOutcome(fixture, route, "audit", { kind: "audit", id: audit });
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

test("records ordered typed outcomes and yields an irreversible effect without proof", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "implementation-retry",
      yield: "authority-required",
      delegate: (fixture, _signals, route) => yieldOutcome(
        fixture,
        route,
        "delegate",
        { kind: "delegate", id: route.delegate as string },
        "authority-required",
      ),
    }],
  });
  assert.equal(result.yieldReason, "authority-required");
  const outcomes = (result.handoff as unknown as { outcomes: Array<Record<string, unknown>> }).outcomes;
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ["completed", "yield"]);
  assert.equal("proof" in outcomes[1], false);
  assert.deepEqual(result.handoff.pending?.outcomes.map((outcome) => outcome.status), ["completed", "yield"]);
});

test("resumes a completed irreversible effect only with a provider idempotency receipt", () => {
  const repo = fixtureRepo();
  const first = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "implementation-retry",
      yield: "authority-required",
      delegate: (fixture, _signals, route) => completedOutcome(
        fixture,
        route,
        "delegate",
        { kind: "delegate", id: route.delegate as string },
        { provider: "deploy", key: "run-1" },
      ),
    }],
  });
  assert.equal(first.yieldReason, "authority-required");
  const delegateOutcome = (first.handoff as unknown as { outcomes: Array<Record<string, unknown>> }).outcomes
    .find((outcome) => outcome.stage === "delegate");
  assert.deepEqual(delegateOutcome.proof, { providerIdempotency: { provider: "deploy", key: "run-1" } });

  const resumed = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    resume: first.handoff,
    steps: [{ expectEdge: "implementation-retry", applyEvidence: evidence("implementation-retry") }],
  });
  assert.equal(resumed.yieldReason, null);
  assert.equal(resumed.delegateCounts["implementation-flow"], 1);
});

test("continues a typed retry only after its canonical evidence changes", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    steps: [
      {
        expectEdge: "implementation-retry",
        delegate: (fixture, signals, route) => {
          updateArtifact(fixture, "docs/tasks/0001-task.md", { status: "done" });
          signals.add("implementation-verified");
          signals.add("followup-terminal");
          return retryOutcome(
            fixture,
            route,
            "delegate",
            { kind: "delegate", id: route.delegate as string },
            [canonicalReference(fixture, "docs/tasks/0001-task.md")],
          );
        },
      },
      {
        expectEdge: "implementation-to-followup-triage",
        applyEvidence: evidence("implementation-to-followup-triage"),
      },
    ],
  });
  assert.equal(result.routes.length, 2);
  assert.equal(result.projectCalls, 2);
  const outcomes = (result.handoff as unknown as { outcomes: Array<Record<string, unknown>> }).outcomes;
  assert.equal(outcomes.some((outcome) => outcome.status === "retry"), true);
});

test("rejects a completed outcome with a forbidden yield reason", () => {
  const repo = fixtureRepo();
  assert.throws(() => runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "implementation-retry",
      delegate: (fixture, _signals, route) => ({
        ...completedOutcome(
          fixture,
          route,
          "delegate",
          { kind: "delegate", id: route.delegate as string },
        ),
        reason: "authority-required",
      } as unknown as EffectOutcome),
    }],
  }), /completed outcome must not include reason/);
});

test("returns a typed GraphRunResult with the final yielded route and resume data", () => {
  const repo = fixtureRepo();
  const yielded = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "briefing-to-design",
      yield: "authority-required",
      delegate: (fixture, _signals, route) => yieldOutcome(
        fixture,
        route,
        "delegate",
        { kind: "delegate", id: route.delegate as string },
        "authority-required",
      ),
    }],
  });
  const result = graphRun(yielded);
  assert.equal(result.status, "yielded");
  assert.equal(result.reason, "authority-required");
  assert.deepEqual(result.route, yielded.routes.at(-1));
  assert.deepEqual(result.outcomes, yielded.outcomes);
  assert.deepEqual(result.trace, yielded.handoff.edgeTrace);
  assert.deepEqual(result.handoff, yielded.handoff);

  const terminal = graphRun(runScenario({
    repo,
    current: "complete",
    mode: "run-until-yield",
    steps: [{ expectEdge: null, yield: "terminal" }],
  }));
  assert.equal(terminal.route.status, "terminal");
  assert.equal(terminal.reason, "terminal");

  const blocked = graphRun(runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    focus: [],
    steps: [{ expectEdge: null, yield: "input-required" }],
  }));
  assert.equal(blocked.route.status, "blocked");
  assert.equal(blocked.reason, "input-required");
});

test("normalizes every declared script delegate and named audit into typed outcomes", () => {
  const graph = require("js-yaml").load(fs.readFileSync(canonicalGraphPath, "utf8")) as {
    nodes: Record<string, { delegate?: string; audits?: string[] }>;
  };
  const declaredDelegates = [...new Set(Object.values(graph.nodes)
    .map((node) => node.delegate)
    .filter((delegate): delegate is string => Boolean(delegate)))].sort();
  const declaredAudits = [...new Set(Object.values(graph.nodes).flatMap((node) => node.audits ?? []))].sort();
  const scriptDelegates = ["migrate_docs", "scaffold_docs", "build_task_graph"];
  const namedAudits = ["spec", "adr", "design", "plan", "task", "impl-record", "all"];
  assert.ok(scriptDelegates.every((effect) => declaredDelegates.includes(effect)));
  assert.ok(namedAudits.every((effect) => declaredAudits.includes(effect)));
  assert.ok(scriptDelegates.every((effect) => isCallerNormalizedEffect("delegate", effect)));
  assert.ok(namedAudits.every((effect) => isCallerNormalizedEffect("audit", effect)));
  assert.ok(["briefing-flow", "design-doc", "implementation-flow", "doc-status"]
    .every((effect) => !isCallerNormalizedEffect("delegate", effect)));

  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    signals: ["migration-requested"],
    steps: [{ expectEdge: "probe-to-migration", applyEvidence: evidence("probe-to-migration") }],
  });
  assert.deepEqual(result.outcomes.map((outcome) => outcome.status), ["completed"]);
  assert.deepEqual(result.outcomes[0].effect, { kind: "delegate", id: "migrate_docs" });
});

test("rejects initial completed and retry receipts without current canonical evidence", () => {
  const missing: CanonicalReference = {
    path: "docs/impl/ir/missing.md",
    id: "IMPL-MISSING",
    fingerprint: "sha256:missing",
  };
  const repo = fixtureRepo();
  assert.throws(() => runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "probe-to-briefing",
      audit: (fixture, _signals, route, audit) => ({
        ...completedOutcome(fixture, route, "audit", { kind: "audit", id: audit }),
        evidence: [missing],
        proof: { canonicalEvidence: missing },
      }),
    }],
  }), /canonical/i);
  assert.throws(() => runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "implementation-retry",
      delegate: (fixture, _signals, route) => retryOutcome(
        fixture,
        route,
        "delegate",
        { kind: "delegate", id: route.delegate as string },
        [missing],
      ),
    }],
  }), /canonical/i);
});

test("does not reuse a non-implementation audit after its authoritative input changes", () => {
  const repo = fixtureRepo();
  const interrupted = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [{ expectEdge: "probe-to-briefing", yield: "authority-required" }],
  });
  updateArtifact(repo, "docs/specs/0001-graph.md", { title: "Changed Spec" });

  const resumed = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    resume: interrupted.handoff,
    steps: [{
      expectEdge: "probe-to-briefing",
      yield: "authority-required",
      applyEvidence: evidence("probe-to-briefing"),
    }],
  });
  assert.equal(resumed.yieldReason, "authority-required");
  assert.equal(resumed.checkpoints.length, 0);
});

test("binds script delegates to their workspace-root and plan/task inputs", () => {
  const repo = fixtureRepo();
  const graphPath = customGraph(repo, `schemaVersion: 2
id: scaffold-input-fixture
entry: start
runtimeSignals: [bootstrap]
conditions:
  bootstrap: { kind: signal, signal: bootstrap }
nodes:
  start: { kind: action }
  bootstrap: { kind: action, delegate: scaffold_docs }
  complete: { kind: terminal }
edges:
  - { id: start-to-bootstrap, from: start, to: bootstrap, when: bootstrap, priority: 10 }
  - { id: bootstrap-to-complete, from: bootstrap, to: complete, when: bootstrap, priority: 10 }
`);
  const interrupted = runScenario({
    repo,
    graphPath,
    current: "start",
    mode: "run-until-yield",
    signals: ["bootstrap"],
    steps: [{ expectEdge: "start-to-bootstrap", yield: "authority-required" }],
  });
  assert.deepEqual(effectInputPaths(interrupted.routes[0], { kind: "delegate", id: "scaffold_docs" }), ["."]);
  fs.unlinkSync(path.join(repo, "docs/specs/README.md"));
  const resumed = runScenario({
    repo,
    graphPath,
    current: "start",
    mode: "run-until-yield",
    signals: ["bootstrap"],
    resume: interrupted.handoff,
    steps: [{
      expectEdge: "start-to-bootstrap",
      yield: "authority-required",
      applyEvidence: evidence("start-to-bootstrap"),
    }],
  });
  assert.equal(resumed.yieldReason, "authority-required");

  const focusedRepo = fixtureRepo({ secondPlan: true });
  writeArtifact(focusedRepo, "docs/tasks/0002-focused.md", {
    id: "TASK-0002", type: "task", status: "todo", title: "Focused",
    relations: { implements: ["docs/plans/0002-other.md"] },
  }, "# Focused task\n");
  const taskGraph = runScenario({
    repo: focusedRepo,
    current: "planning",
    mode: "run-until-yield",
    focus: ["docs/plans/0002-other.md"],
    steps: [{ expectEdge: "planning-to-task-graph", yield: "authority-required" }],
  });
  assert.deepEqual(effectInputPaths(taskGraph.routes[0], { kind: "delegate", id: "build_task_graph" }), [
    "docs/plans/0002-other.md",
    "docs/tasks/0002-focused.md",
  ]);
});

test("fails closed when build_task_graph has no selected Task Graph plan", () => {
  assert.throws(
    () => effectInputPaths({ taskGraph: null } as unknown as GraphRoute, { kind: "delegate", id: "build_task_graph" }),
    /Missing selected Task Graph plan/,
  );
});
