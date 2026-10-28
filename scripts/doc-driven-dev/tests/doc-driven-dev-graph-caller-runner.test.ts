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
import type { DelegateMode, PolicyFacts } from "../src/skills/doc-driven-dev-graph/scripts/lib/delegate_policy";
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
  const dispatcher: EffectDispatcher = (ctx) => completed(dir, ctx.route, ctx.effect.kind, ctx.effect);
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
  const dispatcher: EffectDispatcher = (ctx) => completed(dir, ctx.route, ctx.effect.kind, ctx.effect);
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
