import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import matter from "gray-matter";
import test from "node:test";
import {
  canonicalEvidenceMatches, canonicalReference, captureBaseline,
  commitGatePasses, evidenceReceipts, hasEvidence, isReusableCompletedOutcome,
  OutcomeRejection, persistEvidence, persistOutcome, storedOutcomes,
  assertEffectOutcome, runCaller,
  type CallerEffect, type CanonicalReference, type CompletedEffectOutcome,
  type EffectDispatcher,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/caller_runner";
import type { GraphRoute } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_router";
import {
  buildDelegateHandoff,
  type DelegateMode,
  type PolicyFacts,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/delegate_policy";
import { readTraceFile, type EffectDispatchedEvent } from "../src/skills/doc-driven-dev-graph/scripts/lib/run_trace";

const PROOF = "docs/tasks/0001-task.md";

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caller-runner-unit-"));
  fs.mkdirSync(path.join(dir, "docs/tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, PROOF),
    "---\nid: TASK-0001\ntype: task\nstatus: todo\n---\n# Task\n", "utf8");
  spawnSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}
function writeDoc(dir: string, rel: string, data: Record<string, unknown>, body: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), matter.stringify(body, data), "utf8");
}
function ref(dir: string, rel: string): CanonicalReference { return canonicalReference(dir, rel); }

test("persistOutcome/storedOutcomes round-trips through canonical front matter", () => {
  const dir = repo();
  const outcome: CompletedEffectOutcome = {
    status: "completed", edgeId: "a-to-b", stage: "audit",
    effect: { kind: "audit", id: "spec" },
    authoritativeInputs: [ref(dir, PROOF)], evidence: [ref(dir, PROOF)],
    proof: { canonicalEvidence: ref(dir, PROOF) },
  };
  persistOutcome(dir, PROOF, outcome);
  assert.deepEqual(storedOutcomes(dir, PROOF), [outcome]);
  // outcome bookkeeping must not perturb the artifact's own fingerprint:
  // `effectOutcomes`/`checkpointEvidence` are stripped from the fingerprinted
  // front matter, so the hash equals the pre-bookkeeping canonical content.
  assert.equal(canonicalReference(dir, PROOF).fingerprint,
    crypto.createHash("sha256").update(matter.stringify("# Task\n", {
      id: "TASK-0001", type: "task", status: "todo",
    })).digest("hex"));
});

test("evidence receipts persist per-edge and hasEvidence detects them", () => {
  const dir = repo();
  assert.equal(hasEvidence(dir, PROOF, "a-to-b"), false);
  persistEvidence(dir, PROOF, "a-to-b");
  assert.equal(hasEvidence(dir, PROOF, "a-to-b"), true);
  assert.equal(hasEvidence(dir, PROOF, "other"), false);
  assert.equal(evidenceReceipts(dir, PROOF).length, 1);
});

test("commit gate requires dirty entries ⊆ baseline — head advance alone fails", () => {
  const dir = repo();
  spawnSync("git", ["add", "-A"], { cwd: dir });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: dir });
  const baseline = captureBaseline(dir);
  fs.writeFileSync(path.join(dir, "dirty.txt"), "x");
  assert.equal(commitGatePasses(baseline, captureBaseline(dir)), false);
  spawnSync("git", ["add", "-A"], { cwd: dir });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "w"], { cwd: dir });
  assert.equal(commitGatePasses(baseline, captureBaseline(dir)), true);
});

test("assertEffectOutcome rejects malformed outcomes with OutcomeRejection", () => {
  const dir = repo();
  const route = { edgeId: "a-to-b", taskGraph: null } as any; // minimal shape used by checks
  const good: CompletedEffectOutcome = {
    status: "completed", edgeId: "a-to-b", stage: "audit",
    effect: { kind: "audit", id: "spec" },
    authoritativeInputs: [ref(dir, PROOF)], evidence: [ref(dir, PROOF)],
    proof: { canonicalEvidence: ref(dir, PROOF) },
  };
  const inputs = good.authoritativeInputs;
  assert.doesNotThrow(() => assertEffectOutcome(dir, route, good, "audit", good.effect, inputs));
  assert.throws(() => assertEffectOutcome(dir, route,
    { ...good, edgeId: "wrong" }, "audit", good.effect, inputs), OutcomeRejection);
  assert.throws(() => assertEffectOutcome(dir, route,
    { ...good, proof: {} }, "audit", good.effect, inputs), OutcomeRejection);          // missing proof
  assert.throws(() => assertEffectOutcome(dir, route,
    { ...good, authoritativeInputs: [] }, "audit", good.effect, inputs), OutcomeRejection); // scope mismatch
  const stale = { ...good, evidence: [{ path: PROOF, id: "TASK-0001", fingerprint: "0".repeat(64) }] };
  assert.throws(() => assertEffectOutcome(dir, route, stale, "audit", good.effect, inputs), OutcomeRejection); // stale fingerprint
});

test("isReusableCompletedOutcome requires stored outcome with live fingerprint", () => {
  const dir = repo();
  const outcome: CompletedEffectOutcome = {
    status: "completed", edgeId: "a-to-b", stage: "audit",
    effect: { kind: "audit", id: "spec" },
    authoritativeInputs: [ref(dir, PROOF)], evidence: [ref(dir, PROOF)],
    proof: { canonicalEvidence: ref(dir, PROOF) },
  };
  const route = { edgeId: "a-to-b", taskGraph: null } as any;
  assert.equal(isReusableCompletedOutcome(dir, route, outcome), false); // not persisted
  persistOutcome(dir, PROOF, outcome);
  assert.equal(isReusableCompletedOutcome(dir, route, outcome), true);
  writeDoc(dir, PROOF, { id: "TASK-0001", type: "task", status: "todo" }, "# Changed\n");
  assert.equal(isReusableCompletedOutcome(dir, route, outcome), false); // stale
});

// ---------------------------------------------------------------------------
// runCaller integration: fixture + adapter resolvers copied verbatim from the
// in-process oracle (doc-driven-dev-graph-run-to-yield.test.ts). Task 3 moves
// the mapping table into the e2e harness.
// ---------------------------------------------------------------------------

const canonicalDirs = [
  "docs/ideas",
  "docs/discovery",
  "docs/specs",
  "docs/designs",
  "docs/plans",
  "docs/tasks",
  "docs/test-specs",
  "docs/adr",
  "docs/impl/ir",
  "docs/impl/exp",
];
const canonicalDocumentPaths = [
  "docs/specs/0001-graph.md",
  "docs/adr/0001-graph.md",
  "docs/designs/0001-graph.md",
  "docs/plans/0001-graph.md",
  "docs/test-specs/0001-graph.md",
  PROOF,
  "docs/impl/ir/0001-task.md",
];

function writeArtifact(dir: string, relativePath: string, data: Record<string, unknown>, body: string): void {
  const file = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify(body, {
    created: "2026-08-24",
    updated: "2026-08-24",
    owners: [],
    relations: {},
    ...data,
  }), "utf8");
}

function updateArtifact(dir: string, relativePath: string, data: Record<string, unknown>): void {
  const file = path.join(dir, relativePath);
  const parsed = matter(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, matter.stringify(parsed.content, { ...parsed.data, ...data }), "utf8");
}

function git(dir: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function gitInit(dir: string): void {
  git(dir, ["init", "-q"]);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "baseline"]);
}

function happyRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caller-runner-happy-"));
  for (const directory of canonicalDirs) {
    fs.mkdirSync(path.join(dir, directory), { recursive: true });
    fs.writeFileSync(path.join(dir, directory, "README.md"), `# ${directory}\n`, "utf8");
  }
  writeArtifact(dir, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Graph",
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph\n");
  writeArtifact(dir, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "Graph",
  }, "# Graph\n\n## Considered Options\n\n### A\n\n### B\n");
  writeArtifact(dir, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph",
    relations: { "derives-from": ["SPEC-0001", "ADR-0001"] },
  }, "# Graph\n");
  writeArtifact(dir, "docs/plans/0001-graph.md", {
    id: "PLAN-0001", type: "plan", status: "approved", title: "Graph",
    relations: { "derives-from": ["DESIGN-0001"], "verified-by": ["docs/test-specs/0001-graph.md"] },
  }, "# Graph\n");
  writeArtifact(dir, "docs/test-specs/0001-graph.md", {
    id: "TSPEC-0001", type: "test-spec", status: "approved", title: "Graph",
    relations: { verifies: ["SPEC-0001"] },
  }, "# Graph\n");
  writeArtifact(dir, "docs/impl/ir/0001-task.md", {
    id: "IMPL-0001", type: "implementation-record", status: "complete", title: "Graph implementation",
  }, "# Implementation Record\n");
  writeArtifact(dir, PROOF, {
    id: "TASK-0001", type: "task", status: "todo", title: "TASK-0001",
    relations: { implements: ["docs/plans/0001-graph.md"] },
  }, "# Task\n\n## Verification\n\n- [ ] node --test\n");
  gitInit(dir);
  return dir;
}

function taskGraphPaths(route: GraphRoute): string[] {
  return route.taskGraph?.nodes.map((node) => node.path) ?? [PROOF];
}

function selectedTaskGraphPlanPath(route: GraphRoute): string {
  const plan = route.taskGraph?.plan;
  if (typeof plan !== "string" || plan.length === 0) {
    throw new Error("Missing selected Task Graph plan for build_task_graph");
  }
  return plan;
}

function testResolveInputs(route: GraphRoute, effect: CallerEffect): string[] {
  if (effect.kind === "audit") {
    switch (effect.id) {
      case "spec": return ["docs/specs/0001-graph.md"];
      case "adr": return ["docs/adr/0001-graph.md"];
      case "design": return ["docs/designs/0001-graph.md"];
      case "plan": return ["docs/plans/0001-graph.md"];
      case "task": return taskGraphPaths(route);
      case "test-spec": return ["docs/test-specs/0001-graph.md"];
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

function testResolveEvidence(route: GraphRoute, effect: CallerEffect): string {
  if (effect.kind === "audit") return testResolveInputs(route, effect)[0];
  switch (effect.id) {
    case "design-doc": return "docs/designs/0001-graph.md";
    case "planning-flow": return "docs/plans/0001-graph.md";
    case "implementation-flow": return "docs/impl/ir/0001-task.md";
    case "doc-status": return "docs/impl/ir/0001-task.md";
    default: return testResolveInputs(route, effect)[0];
  }
}

function testInputs(dir: string, route: GraphRoute, effect: CallerEffect): CanonicalReference[] {
  const paths = testResolveInputs(route, effect);
  return [...new Set(paths)].sort().map((relativePath) => canonicalReference(dir, relativePath));
}

function completed(dir: string, route: GraphRoute, stage: "audit" | "delegate", effect: CallerEffect): CompletedEffectOutcome {
  const evidence = canonicalReference(dir, testResolveEvidence(route, effect));
  const evidenceReferences = effect.id === "planning-flow"
    ? [
        evidence,
        canonicalReference(dir, "docs/test-specs/0001-graph.md"),
        ...taskGraphPaths(route).map((relativePath) => canonicalReference(dir, relativePath)),
      ]
    : [evidence];
  return {
    status: "completed",
    edgeId: route.edgeId as string,
    stage,
    effect,
    authoritativeInputs: testInputs(dir, route, effect),
    evidence: evidenceReferences,
    proof: { canonicalEvidence: evidence },
  };
}

test("runCaller drives the real CLI end-to-end and emits run-level trace events", () => {
  const dir = happyRepo();
  const tsx = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");
  const cli = path.resolve(__dirname, "../src/skills/doc-driven-dev-graph/scripts/route_graph.ts");
  const trace = path.join(dir, "trace.jsonl");
  const dispatcher: EffectDispatcher = (ctx) => ({
    outcome: completed(dir, ctx.route, ctx.effect.kind, ctx.effect),
    observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
  });
  const result = runCaller({
    repo: dir, router: { executable: process.execPath, prefixArgs: [tsx, cli] },
    focus: ["PLAN-0001"],
    // Caller-declared verification signals — the oracle injects them through
    // mutable signal callbacks; the runner contract declares them up front.
    signals: ["implementation-verified", "followup-terminal", "exit-audit-pass"],
    dispatcher,
    resolveInputs: testResolveInputs, resolveEvidence: testResolveEvidence,
    // The evidence phase performs the edge's canonical mutations first (the
    // oracle's evidence(edgeId, mutate) pattern): implementation work completes
    // TASK-0001, then the receipt is recorded on the post-mutation doc.
    applyEvidence: (repoDir, _signals, edgeId) => {
      if (edgeId === "task-graph-to-implementation") updateArtifact(repoDir, PROOF, { status: "done" });
      persistEvidence(repoDir, PROOF, edgeId);
    },
    trace: { file: trace, runId: "e2e-happy" },
  });
  assert.equal(result.yieldReason, "terminal");
  assert.deepEqual(
    result.routes.map((route) => route.edgeId ?? route.status),
    ["probe-to-briefing", "briefing-to-design", "design-to-planning", "planning-to-task-graph",
     "task-graph-to-implementation", "implementation-to-followup-triage",
     "followup-triage-terminal", "exit-audit-to-complete", "terminal"],
  );
  const events = readTraceFile(trace).filter((event) => event.runId === "e2e-happy");
  assert.deepEqual(events.map((event) => event.seq), events.map((_, i) => i + 1)); // contiguous per-runId seq
  assert.equal(events.filter((e) => e.kind === "effect-dispatched").length,
    events.filter((e) => e.kind === "effect-outcome").length);
  // Without a policy hook the additive modeReason field stays absent and the
  // caller-declared executionMode (default "unknown") is untouched.
  assert.equal(events.every((event) => event.kind !== "effect-dispatched"
    || (!("modeReason" in event) && event.executionMode === "unknown")), true);
  assert.equal(events.at(-1)?.kind, "run-yield");
  assert.equal((events.at(-1) as any).reason, "terminal");
});

test("runCaller stamps the policy's per-effect mode decision on effect-dispatched", () => {
  const dir = happyRepo();
  const tsx = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");
  const cli = path.resolve(__dirname, "../src/skills/doc-driven-dev-graph/scripts/route_graph.ts");
  const trace = path.join(dir, "trace.jsonl");
  const dispatcher: EffectDispatcher = (ctx) => ({
    outcome: completed(dir, ctx.route, ctx.effect.kind, ctx.effect),
    observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
  });
  const hostCapabilities: ReadonlySet<DelegateMode> = new Set<DelegateMode>([
    "same-context", "subagent-as-tool", "isolated-subagent",
  ]);
  // Every effect looks independent + parallel-safe except briefing-flow,
  // which carries an explicit override — exercises both the selected-mode
  // path and the override-reason path through to the trace.
  const policy = (_route: GraphRoute, effect: CallerEffect): PolicyFacts => ({
    effectId: effect.id,
    stage: effect.kind,
    independentScope: true,
    sharedJudgment: false,
    contextCost: "low",
    parallelCandidate: true,
    hostCapabilities,
    ...(effect.id === "briefing-flow"
      ? { override: { mode: "isolated-subagent" as const, reason: "eval-fixture" } }
      : {}),
  });
  const result = runCaller({
    repo: dir, router: { executable: process.execPath, prefixArgs: [tsx, cli] },
    focus: ["PLAN-0001"],
    signals: ["implementation-verified", "followup-terminal", "exit-audit-pass"],
    dispatcher,
    resolveInputs: testResolveInputs, resolveEvidence: testResolveEvidence,
    applyEvidence: (repoDir, _signals, edgeId) => {
      if (edgeId === "task-graph-to-implementation") updateArtifact(repoDir, PROOF, { status: "done" });
      persistEvidence(repoDir, PROOF, edgeId);
    },
    policy,
    trace: { file: trace, runId: "e2e-policy" },
  });
  assert.equal(result.yieldReason, "terminal");
  const events = readTraceFile(trace).filter((event) => event.runId === "e2e-policy");
  const dispatched = events.filter(
    (event): event is EffectDispatchedEvent => event.kind === "effect-dispatched",
  );
  assert.ok(dispatched.length > 0);
  for (const event of dispatched) {
    // The policy supersedes the caller-declared executionMode on the event.
    assert.equal(event.executionMode, "subagent");
    assert.equal(typeof event.modeReason, "string");
  }
  const overridden = dispatched.find(
    (event) => event.stage === "delegate" && event.effectId === "briefing-flow",
  );
  assert.equal(overridden?.modeReason, "override:eval-fixture");
  const standard = dispatched.find((event) => event.effectId !== "briefing-flow");
  assert.equal(standard?.modeReason, "independent-scope;parallel-candidate");
});

// ---------------------------------------------------------------------------
// Dispatch observation boundary (#135): the runner hands the requested mode
// to the dispatcher, records its report as dispatch-observed events, and
// rejects any self-observation that contradicts the request.
// ---------------------------------------------------------------------------

function runnerArgs(dir: string, dispatcher: EffectDispatcher, trace: string) {
  const tsx = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");
  const cli = path.resolve(__dirname, "../src/skills/doc-driven-dev-graph/scripts/route_graph.ts");
  return {
    repo: dir,
    router: { executable: process.execPath, prefixArgs: [tsx, cli] },
    signals: ["implementation-verified", "followup-terminal", "exit-audit-pass"],
    dispatcher,
    resolveInputs: testResolveInputs,
    resolveEvidence: testResolveEvidence,
    applyEvidence: (repoDir: string, _signals: ReadonlySet<string>, edgeId: string) => {
      if (edgeId === "task-graph-to-implementation") updateArtifact(repoDir, PROOF, { status: "done" });
      persistEvidence(repoDir, PROOF, edgeId);
    },
    trace: { file: trace, runId: "obs-boundary" },
  };
}

test("a self-observation reporting a different actual mode rejects the dispatch", () => {
  const dir = happyRepo();
  const trace = path.join(dir, "trace.jsonl");
  // The first spec audit reports it ran same-context while the declared
  // requested mode is "tool" — a silent switch, rejected like any violation.
  const dispatcher: EffectDispatcher = (ctx) => ({
    outcome: completed(dir, ctx.route, ctx.effect.kind, ctx.effect),
    observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: "same-context", method: "inline-skill" }],
  });
  const result = runCaller({ ...runnerArgs(dir, dispatcher, trace), executionMode: "tool", focus: ["PLAN-0001"] });
  assert.equal(result.yieldReason, "authority-required");
  const events = readTraceFile(trace);
  const observed = events.filter((event) => event.kind === "dispatch-observed");
  assert.equal(observed.length, 1);
  assert.equal(observed[0].kind === "dispatch-observed" && observed[0].actual, "same-context");
  // The rejected dispatch left no effect-outcome — the observation is the
  // forensic record of what the adapter claimed it did.
  assert.equal(events.some((event) => event.kind === "effect-outcome"), false);
});

test("a declined dispatch yields honestly; an executing dispatch may not claim not-executed", () => {
  const dir = happyRepo();
  const trace = path.join(dir, "trace.jsonl");
  // The spec audit declines (unsupported mode simulation): not-executed +
  // yield is the honest refusal shape and flows to the run yield.
  const dispatcher: EffectDispatcher = (ctx) => {
    if (ctx.effect.kind === "audit" && ctx.effect.id === "spec") {
      return {
        outcome: {
          status: "yield",
          edgeId: ctx.route.edgeId as string,
          stage: "audit",
          effect: ctx.effect,
          authoritativeInputs: testInputs(dir, ctx.route, ctx.effect),
          evidence: [ref(dir, "docs/specs/0001-graph.md")],
          reason: "authority-required",
        },
        observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: "unknown", method: "not-executed" }],
      };
    }
    return {
      outcome: completed(dir, ctx.route, ctx.effect.kind, ctx.effect),
      observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
    };
  };
  const result = runCaller({ ...runnerArgs(dir, dispatcher, trace), executionMode: "subagent", focus: ["PLAN-0001"] });
  assert.equal(result.yieldReason, "authority-required");
  const observed = readTraceFile(trace).filter((event) => event.kind === "dispatch-observed");
  // Audits dispatch in graph order — whichever ran before spec recorded an
  // executed observation; the spec decline is the not-executed record.
  const declined = observed.filter((event) => event.kind === "dispatch-observed" && event.method === "not-executed");
  assert.equal(declined.length, 1);
  if (declined[0].kind === "dispatch-observed") {
    assert.equal(declined[0].effectId, "spec");
    assert.equal(declined[0].requested, "subagent");
    assert.equal(declined[0].actual, "unknown");
  }
  // The declining dispatch produced a yield outcome, never a completed one.
  const outcomes = readTraceFile(trace).filter((event) => event.kind === "effect-outcome");
  assert.equal(outcomes.some(
    (event) => event.kind === "effect-outcome" && event.effectId === "spec" && event.outcome === "yield",
  ), true);
  assert.equal(outcomes.some(
    (event) => event.kind === "effect-outcome" && event.effectId === "spec" && event.outcome === "completed",
  ), false);
});

test("a dispatcher reporting no self-observation is rejected", () => {
  const dir = happyRepo();
  const trace = path.join(dir, "trace.jsonl");
  const dispatcher: EffectDispatcher = (ctx) => ({
    outcome: completed(dir, ctx.route, ctx.effect.kind, ctx.effect),
    observations: [{ target: "some-other-dispatch", requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
  });
  const result = runCaller({ ...runnerArgs(dir, dispatcher, trace), focus: ["PLAN-0001"] });
  assert.equal(result.yieldReason, "authority-required");
});

test("a delegated policy decision attaches a handoff carrying the requested mode", () => {
  const dir = happyRepo();
  const trace = path.join(dir, "trace.jsonl");
  const seen: (string | undefined)[] = [];
  const dispatcher: EffectDispatcher = (ctx) => {
    seen.push(ctx.handoff?.executionMode);
    return {
      outcome: completed(dir, ctx.route, ctx.effect.kind, ctx.effect),
      observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
    };
  };
  const policy = (_route: GraphRoute, effect: CallerEffect): PolicyFacts => ({
    effectId: effect.id,
    stage: effect.kind,
    independentScope: effect.id === "spec",
    sharedJudgment: false,
    contextCost: "low",
    parallelCandidate: false,
    hostCapabilities: new Set<DelegateMode>(["same-context", "subagent-as-tool", "isolated-subagent"]),
  });
  const result = runCaller({
    ...runnerArgs(dir, dispatcher, trace),
    focus: ["PLAN-0001"],
    policy,
  });
  assert.equal(result.yieldReason, "terminal");
  // The spec audit ran delegated (subagent-as-tool → "tool") and received a
  // handoff; same-context dispatches saw none.
  assert.equal(seen.includes("tool"), true);
  assert.equal(seen.includes(undefined), true);
});

test("a self-observation echoing a different requested mode rejects the dispatch", () => {
  const dir = happyRepo();
  const trace = path.join(dir, "trace.jsonl");
  // The adapter ran honestly (actual === requested-mode "tool") but echoes
  // the wrong request in `requested` — a self-report that misattributes the
  // request is rejected exactly like a mismatched actual.
  const dispatcher: EffectDispatcher = (ctx) => ({
    outcome: completed(dir, ctx.route, ctx.effect.kind, ctx.effect),
    observations: [{ target: ctx.effect.id, requested: "same-context", actual: "tool", method: "scripted" }],
  });
  const result = runCaller({ ...runnerArgs(dir, dispatcher, trace), executionMode: "tool", focus: ["PLAN-0001"] });
  assert.equal(result.yieldReason, "authority-required");
  assert.equal(
    readTraceFile(trace).some((event) => event.kind === "effect-outcome"),
    false,
  );
});

test("a handoff whose executionMode mismatches the request rejects the dispatch", () => {
  const dir = happyRepo();
  const trace = path.join(dir, "trace.jsonl");
  const dispatcher: EffectDispatcher = (ctx) => ({
    outcome: completed(dir, ctx.route, ctx.effect.kind, ctx.effect),
    observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
  });
  const policy = (_route: GraphRoute, effect: CallerEffect): PolicyFacts => ({
    effectId: effect.id,
    stage: effect.kind,
    independentScope: effect.id === "spec",
    sharedJudgment: false,
    contextCost: "low",
    parallelCandidate: false,
    hostCapabilities: new Set<DelegateMode>(["same-context", "subagent-as-tool", "isolated-subagent"]),
  });
  const result = runCaller({
    ...runnerArgs(dir, dispatcher, trace),
    focus: ["PLAN-0001"],
    policy,
    // The spec audit is delegated ("tool"), but the builder pins a
    // "subagent" handoff — the delegate would run under a different
    // contract than the runner recorded.
    buildHandoff: ({ inputs }) => buildDelegateHandoff({ mode: "subagent", focus: [], inputs }),
  });
  assert.equal(result.yieldReason, "authority-required");
});

test("a delegated decision producing no handoff rejects the dispatch", () => {
  const dir = happyRepo();
  const trace = path.join(dir, "trace.jsonl");
  const dispatcher: EffectDispatcher = (ctx) => ({
    outcome: completed(dir, ctx.route, ctx.effect.kind, ctx.effect),
    observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
  });
  const policy = (_route: GraphRoute, effect: CallerEffect): PolicyFacts => ({
    effectId: effect.id,
    stage: effect.kind,
    independentScope: effect.id === "spec",
    sharedJudgment: false,
    contextCost: "low",
    parallelCandidate: false,
    hostCapabilities: new Set<DelegateMode>(["same-context", "subagent-as-tool", "isolated-subagent"]),
  });
  const result = runCaller({
    ...runnerArgs(dir, dispatcher, trace),
    focus: ["PLAN-0001"],
    policy,
    // Falsy return = no scope to delegate — running anyway would be an
    // unbounded dispatch.
    buildHandoff: () => undefined as never,
  });
  assert.equal(result.yieldReason, "authority-required");
});

test("malformed observation entries reject like a malformed outcome — no trace drop, no TypeError", () => {
  for (const bad of [null, "research", { target: 7, requested: "same-context", actual: "same-context", method: "scripted" }, { target: "x", requested: "sideways", actual: "same-context", method: "scripted" }, { target: "x", requested: "same-context", actual: "same-context", method: "teleport" }]) {
    const dir = happyRepo();
    const trace = path.join(dir, "trace.jsonl");
    const dispatcher: EffectDispatcher = (ctx) => ({
      outcome: completed(dir, ctx.route, ctx.effect.kind, ctx.effect),
      observations: [
        { target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" },
        bad,
      ] as never,
    });
    const result = runCaller({ ...runnerArgs(dir, dispatcher, trace), focus: ["PLAN-0001"] });
    assert.equal(result.yieldReason, "authority-required", `entry ${JSON.stringify(bad)} must reject`);
    // Entries are validated before ANY is emitted — a malformed report is an
    // all-or-nothing breach, so no dispatch-observed event reaches the trace
    // (and no normalize-drop can hide it).
    assert.equal(
      readTraceFile(trace).filter((event) => event.kind === "dispatch-observed").length,
      0,
    );
  }
});

// ---------------------------------------------------------------------------
// Per-edge dispatch budget (#131): a dispatcher that returns a BYTE-DISTINCT
// retry outcome on every call defeats repeatedRetry (identical-payload only),
// never completes an edge for hops/fingerprint bounds — only the dispatch
// count against the pending edge can stop it.
// ---------------------------------------------------------------------------

/**
 * The `design` audit on design-to-planning retries forever, mutating its own
 * evidence doc each call so every retry payload differs by content hash.
 * All other effects complete normally.
 */
function distinctRetryDispatcher(dir: string): EffectDispatcher {
  let attempt = 0;
  return (ctx) => {
    if (ctx.effect.kind === "audit" && ctx.effect.id === "design") {
      // Snapshot authoritative inputs before mutating — the runner resolved
      // the same live refs when it dispatched.
      const inputs = testInputs(dir, ctx.route, ctx.effect);
      attempt += 1;
      updateArtifact(dir, "docs/designs/0001-graph.md", { title: `Graph retry ${attempt}` });
      const evidence = ref(dir, "docs/designs/0001-graph.md");
      return {
        outcome: {
          status: "retry",
          edgeId: ctx.route.edgeId as string,
          stage: "audit",
          effect: ctx.effect,
          authoritativeInputs: inputs,
          evidence: [evidence],
          retry: { changedEvidence: [evidence] },
        },
        observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
      };
    }
    return {
      outcome: completed(dir, ctx.route, ctx.effect.kind, ctx.effect),
      observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
    };
  };
}

test("byte-distinct retry outcomes on the same pending edge exhaust the dispatch budget", () => {
  const dir = happyRepo();
  const trace = path.join(dir, "trace.jsonl");
  const dispatcher = distinctRetryDispatcher(dir);
  const result = runCaller({ ...runnerArgs(dir, dispatcher, trace), current: "design", focus: ["PLAN-0001"] });
  assert.equal(result.yieldReason, "budget-exhausted");
  assert.equal(result.hops, 0);
  assert.deepEqual(result.completedEdges, []);
  // The default budget admits exactly 10 dispatches against the pending
  // edge — all retries, every payload distinct (JSON.stringify unique),
  // so repeatedRetry never fired.
  assert.equal(result.outcomes.length, 10);
  assert.equal(new Set(result.outcomes.map((outcome) => JSON.stringify(outcome))).size, 10);
  assert.equal(result.handoff.pending?.route.edgeId, "design-to-planning");
  assert.equal(result.handoff.pending?.dispatches, 10);
  assert.equal(result.handoff.maxDispatchesPerEdge, 10);
  const events = readTraceFile(trace);
  assert.equal(events.filter((event) => event.kind === "effect-dispatched").length, 10);
  const last = events.at(-1);
  assert.equal(last?.kind, "run-yield");
  assert.equal(last?.kind === "run-yield" && last.reason, "budget-exhausted");
});

test("the per-edge dispatch budget is configurable via maxDispatchesPerEdge", () => {
  const dir = happyRepo();
  const trace = path.join(dir, "trace.jsonl");
  const dispatcher = distinctRetryDispatcher(dir);
  const result = runCaller({
    ...runnerArgs(dir, dispatcher, trace),
    current: "design", focus: ["PLAN-0001"], maxDispatchesPerEdge: 3,
  });
  assert.equal(result.yieldReason, "budget-exhausted");
  assert.equal(result.outcomes.length, 3);
  assert.equal(result.handoff.pending?.dispatches, 3);
  assert.equal(result.handoff.maxDispatchesPerEdge, 3);
  const events = readTraceFile(trace);
  assert.equal(events.filter((event) => event.kind === "effect-dispatched").length, 3);
  assert.equal(events.at(-1)?.kind, "run-yield");
});

/**
 * The `design` audit retries forever and flips the design doc's `status`
 * between draft and approved on every call, so the design gate alternates
 * pass/fail and routing rotates between `design-to-planning` and
 * `design-retry` — each pending edge is replaced before its per-edge count
 * can accumulate. Only the run-level total bound can stop this loop.
 */
function alternatingEdgeRetryDispatcher(dir: string): EffectDispatcher {
  let attempt = 0;
  return (ctx) => {
    if (ctx.effect.kind === "audit" && ctx.effect.id === "design") {
      const inputs = testInputs(dir, ctx.route, ctx.effect);
      attempt += 1;
      // Flip the design gate pass/fail so routing alternates edges, and
      // change the title so every retry payload is byte-distinct.
      updateArtifact(dir, "docs/designs/0001-graph.md", {
        title: `Alternating retry ${attempt}`,
        status: attempt % 2 === 1 ? "draft" : "approved",
      });
      const evidence = ref(dir, "docs/designs/0001-graph.md");
      return {
        outcome: {
          status: "retry",
          edgeId: ctx.route.edgeId as string,
          stage: "audit",
          effect: ctx.effect,
          authoritativeInputs: inputs,
          evidence: [evidence],
          retry: { changedEvidence: [evidence] },
        },
        observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
      };
    }
    return {
      outcome: completed(dir, ctx.route, ctx.effect.kind, ctx.effect),
      observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
    };
  };
}

test("retries alternated across different edges trip the run-level total dispatch bound", () => {
  const dir = happyRepo();
  const trace = path.join(dir, "trace.jsonl");
  const dispatcher = alternatingEdgeRetryDispatcher(dir);
  const result = runCaller({
    ...runnerArgs(dir, dispatcher, trace),
    current: "design", focus: ["PLAN-0001"], maxTotalDispatches: 5,
  });
  assert.equal(result.yieldReason, "budget-exhausted");
  // The gate flip rotated the route on every pass: design-to-planning and
  // design-retry strictly alternate, and every retry payload was distinct —
  // so neither the per-edge budget nor repeatedRetry could have fired.
  assert.deepEqual(
    result.routes.map((route) => route.edgeId),
    ["design-to-planning", "design-retry", "design-to-planning", "design-retry", "design-to-planning", "design-retry"],
  );
  assert.equal(result.outcomes.length, 5);
  assert.equal(new Set(result.outcomes.map((outcome) => JSON.stringify(outcome))).size, 5);
  // The last saved pending edge carries 0 dispatches — the per-edge count
  // never accumulated because the pending slot rotated every pass.
  assert.equal(result.handoff.pending?.dispatches, 0);
  assert.equal(result.handoff.totalDispatches, 5);
  assert.equal(result.handoff.maxTotalDispatches, 5);
  const last = readTraceFile(trace).at(-1);
  assert.equal(last?.kind, "run-yield");
  assert.equal(last?.kind === "run-yield" && last.reason, "budget-exhausted");
});

test("the pending-edge dispatch count survives a mid-edge yield and resume", () => {
  const dir = happyRepo();
  const trace = path.join(dir, "trace.jsonl");
  let calls = 0;
  // Leg 1: first dispatch retries, second yields input-required — the
  // pending edge already consumed 2 of its 3 dispatches when the run stops.
  const leg1Dispatcher = distinctRetryDispatcher(dir);
  const yieldAfter: EffectDispatcher = (ctx) => {
    calls += 1;
    if (calls === 2) {
      const inputs = testInputs(dir, ctx.route, ctx.effect);
      return {
        outcome: {
          status: "yield",
          edgeId: ctx.route.edgeId as string,
          stage: "audit",
          effect: ctx.effect,
          authoritativeInputs: inputs,
          evidence: [ref(dir, "docs/designs/0001-graph.md")],
          reason: "input-required",
        },
        observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
      };
    }
    return leg1Dispatcher(ctx);
  };
  const first = runCaller({
    ...runnerArgs(dir, yieldAfter, trace),
    current: "design", focus: ["PLAN-0001"], maxDispatchesPerEdge: 3,
  });
  assert.equal(first.yieldReason, "input-required");
  assert.equal(first.handoff.pending?.dispatches, 2);
  // Leg 2: resume — the handoff carries both the count and the configured
  // budget, so one more retry (3) hits the budget on the next re-route.
  const second = runCaller({ ...runnerArgs(dir, distinctRetryDispatcher(dir), trace), resume: first.handoff });
  assert.equal(second.yieldReason, "budget-exhausted");
  assert.equal(second.handoff.pending?.dispatches, 3);
  // outcomes accumulate across the resumed run: retry, yield, retry.
  assert.equal(second.outcomes.length, 3);
});

test("a handoff written before the run-level bound seeds totalDispatches from outcomes", () => {
  const dir = happyRepo();
  const trace = path.join(dir, "trace.jsonl");
  let calls = 0;
  // Leg 1: retry then input-required yield — the run consumed 2 dispatches.
  const leg1Dispatcher = distinctRetryDispatcher(dir);
  const yieldAfter: EffectDispatcher = (ctx) => {
    calls += 1;
    if (calls === 2) {
      const inputs = testInputs(dir, ctx.route, ctx.effect);
      return {
        outcome: {
          status: "yield",
          edgeId: ctx.route.edgeId as string,
          stage: "audit",
          effect: ctx.effect,
          authoritativeInputs: inputs,
          evidence: [ref(dir, "docs/designs/0001-graph.md")],
          reason: "input-required",
        },
        observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
      };
    }
    return leg1Dispatcher(ctx);
  };
  const first = runCaller({ ...runnerArgs(dir, yieldAfter, trace), current: "design", focus: ["PLAN-0001"] });
  assert.equal(first.yieldReason, "input-required");
  // Simulate a handoff serialized by the pre-total-bound caller: it carries
  // maxDispatchesPerEdge and pending.dispatches but neither new field.
  const oldHandoff = first.handoff as Partial<typeof first.handoff>;
  delete oldHandoff.totalDispatches;
  delete oldHandoff.maxTotalDispatches;
  // Leg 2: resume the old handoff with a tight total bound. The seed comes
  // from outcomes.length (2), the bound from the option (3) — so exactly one
  // more dispatch runs before budget-exhausted.
  const second = runCaller({
    ...runnerArgs(dir, distinctRetryDispatcher(dir), trace),
    resume: first.handoff, maxTotalDispatches: 3,
  });
  assert.equal(second.yieldReason, "budget-exhausted");
  assert.equal(second.handoff.totalDispatches, 3);
  // 2 resumed outcomes + 1 new dispatch — proves the count seeded at 2, not 0.
  assert.equal(second.outcomes.length, 3);
  // The per-edge count (3) stayed under the resumed budget (10), so the
  // total bound was the one that fired.
  assert.equal(second.handoff.maxDispatchesPerEdge, 10);
  assert.equal(second.handoff.pending?.dispatches, 3);
});
