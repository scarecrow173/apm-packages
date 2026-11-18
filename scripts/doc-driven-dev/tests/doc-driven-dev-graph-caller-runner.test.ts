import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import matter from "gray-matter";
import test from "node:test";
import {
  assertEffectOutcome, canonicalReference, captureBaseline,
  commitGatePasses, isReusableCompletedOutcome, outcomeReceiptId,
  OutcomeRejection, resolveReference, resolveReferenceSpecs, runCaller,
  type CallerEffect, type CompletedEffectOutcome,
  type DurableDocumentReference, type EffectDispatcher, type EffectProof,
  type EffectReference, type ReferenceSpec,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/caller_runner";
import {
  approvePlan,
  createRun, initStateRoot, loadRun, recordCheckpoint, recordReceipt, StoreError,
  updateTask,
  type RunSnapshot, type TaskStatus,
} from "../src/skills/lib/execution_store";
import type { GraphRoute } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_router";
import {
  buildDelegateHandoff,
  type DelegateMode,
  type PolicyFacts,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/delegate_policy";
import { readTraceFile, type EffectDispatchedEvent } from "../src/skills/doc-driven-dev-graph/scripts/lib/run_trace";

const PROOF = "docs/tasks/0001-task.md";
const RUN_ID = "RUN-0001";

/** The task record's current CAS version — store writes pin it. */
function taskVersion(repo: string, taskId: string): number | undefined {
  return loadRun(repo, RUN_ID).tasks.find((task) => task.taskId === taskId)?.version;
}

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caller-runner-unit-"));
  fs.mkdirSync(path.join(dir, "docs/tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, PROOF),
    "---\nid: TASK-0001\ntype: task\nstatus: todo\n---\n# Task\n", "utf8");
  fs.writeFileSync(path.join(dir, ".gitignore"), "/.apm/state/\n", "utf8");
  spawnSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}
function writeDoc(dir: string, rel: string, data: Record<string, unknown>, body: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), matter.stringify(body, data), "utf8");
}
function ref(dir: string, rel: string): DurableDocumentReference { return canonicalReference(dir, rel); }

function run(dir: string, runId = "unit-run"): RunSnapshot {
  try {
    return loadRun(dir, runId);
  } catch (error: unknown) {
    if (error instanceof StoreError && error.code === "run-not-found") {
      return createRun(dir, { runId, graphId: "unit" });
    }
    throw error;
  }
}

/** The canonical receipt record shape runCaller writes for a completed outcome. */
function recordOutcomeReceipt(dir: string, runId: string, outcome: CompletedEffectOutcome): void {
  recordReceipt(dir, runId, {
    receiptId: outcomeReceiptId(outcome),
    effect: `${outcome.effect.kind}:${outcome.effect.id}`,
    taskId: null,
    idempotencyKey: outcome.proof.kind === "provider" ? outcome.proof.idempotencyKey : null,
    actor: "test/scripted",
    status: "success",
    input: {
      edgeId: outcome.edgeId,
      stage: outcome.stage,
      effect: outcome.effect,
      inputs: outcome.inputs,
    },
    output: { outputs: outcome.outputs, proof: outcome.proof },
  });
}

function storeView(dir: string, runId = "unit-run") {
  const snapshot = loadRun(dir, runId);
  return { runId: snapshot.runId, tasks: snapshot.tasks, receipts: snapshot.receipts };
}

/**
 * Seed the run's Execution Store task records from the fixture's task docs:
 * under Registry 3, `execution-task` input specs resolve against task
 * records inside the bound run — never `docs/tasks` durable paths.
 */
function seedRun(dir: string, runId = RUN_ID): void {
  const taskDir = path.join(dir, "docs/tasks");
  const tasks = fs.existsSync(taskDir)
    ? fs.readdirSync(taskDir)
        .filter((file) => file.endsWith(".md") && file !== "README.md")
        .sort()
        .map((file) => {
          const data = matter(fs.readFileSync(path.join(taskDir, file), "utf8")).data;
          return { taskId: data.id as string, status: (data.status ?? "todo") as TaskStatus };
        })
    : [];
  try {
    createRun(dir, { runId, tasks });
  } catch (error) {
    if (!(error instanceof StoreError && error.code === "run-exists")) throw error;
  }
}

test("recordReceipt persists an accepted outcome; identical re-record is a no-op, same-id conflicts", () => {
  const dir = repo();
  run(dir);
  const outcome: CompletedEffectOutcome = {
    status: "completed", edgeId: "a-to-b", stage: "audit",
    effect: { kind: "audit", id: "spec" },
    inputs: [ref(dir, PROOF)], outputs: [ref(dir, PROOF)],
    proof: ref(dir, PROOF),
  };
  recordOutcomeReceipt(dir, "unit-run", outcome);
  const snapshot = loadRun(dir, "unit-run");
  assert.equal(snapshot.receipts.length, 1);
  assert.equal(snapshot.receipts[0].receiptId, outcomeReceiptId(outcome));
  // Identical content under the same id is the idempotent crash-retry case.
  recordOutcomeReceipt(dir, "unit-run", outcome);
  assert.equal(loadRun(dir, "unit-run").receipts.length, 1);
  // Same id, different content is a record-conflict, never a silent overwrite.
  const divergent = { ...outcome, outputs: [ref(dir, "docs/tasks/0001-task.md"), ref(dir, PROOF)] };
  assert.throws(
    () => recordReceipt(dir, "unit-run", {
      receiptId: outcomeReceiptId(outcome),
      effect: "audit:spec", taskId: null, idempotencyKey: null,
      actor: "test/scripted", status: "success",
      input: { edgeId: "a-to-b", stage: "audit", effect: outcome.effect, inputs: outcome.inputs },
      output: { outputs: divergent.outputs, proof: outcome.proof },
    }),
    (error: unknown) => error instanceof StoreError && error.code === "record-conflict",
  );
  // Receipts are execution-side records: the task doc's canonical content is
  // untouched by bookkeeping — its revision equals the pre-receipt content.
  assert.equal(canonicalReference(dir, PROOF).revision,
    crypto.createHash("sha256").update(matter.stringify("# Task\n", {
      id: "TASK-0001", type: "task", status: "todo",
    })).digest("hex"));
});

test("recordCheckpoint persists the edge checkpoint; re-record no-ops, different data conflicts", () => {
  const dir = repo();
  run(dir);
  const data = {
    edgeId: "a-to-b",
    receipts: ["receipt-1"],
    outputs: [ref(dir, PROOF)],
    routeHash: "0".repeat(64),
  };
  const input = {
    checkpointId: "checkpoint-a-to-b-1",
    nodeId: "b", edgeId: "a-to-b", taskId: null, data,
  };
  recordCheckpoint(dir, "unit-run", input);
  let snapshot = loadRun(dir, "unit-run");
  assert.equal(snapshot.checkpoints.length, 1);
  assert.equal(snapshot.checkpoints[0].checkpointId, "checkpoint-a-to-b-1");
  // Idempotent re-record: identical payload under the same id is a no-op.
  recordCheckpoint(dir, "unit-run", input);
  snapshot = loadRun(dir, "unit-run");
  assert.equal(snapshot.checkpoints.length, 1);
  // A different edge's checkpoint records alongside, never overwrites.
  recordCheckpoint(dir, "unit-run", { ...input, checkpointId: "checkpoint-other-1", edgeId: "other", data: { ...data, edgeId: "other" } });
  assert.equal(loadRun(dir, "unit-run").checkpoints.length, 2);
  assert.throws(
    () => recordCheckpoint(dir, "unit-run", { ...input, data: { ...data, receipts: ["receipt-2"] } }),
    (error: unknown) => error instanceof StoreError && error.code === "record-conflict",
  );
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
    inputs: [ref(dir, PROOF)], outputs: [ref(dir, PROOF)],
    proof: ref(dir, PROOF),
  };
  const inputs = good.inputs;
  assert.doesNotThrow(() => assertEffectOutcome(dir, route, good, "audit", good.effect, inputs));
  assert.throws(() => assertEffectOutcome(dir, route,
    { ...good, edgeId: "wrong" }, "audit", good.effect, inputs), OutcomeRejection);
  assert.throws(() => assertEffectOutcome(dir, route,
    { ...good, proof: {} } as CompletedEffectOutcome, "audit", good.effect, inputs), OutcomeRejection); // missing proof
  assert.throws(() => assertEffectOutcome(dir, route,
    { ...good, inputs: [] }, "audit", good.effect, inputs), OutcomeRejection);        // scope mismatch
  const stale: CompletedEffectOutcome = { ...good, outputs: [{ kind: "durable-document", path: PROOF, id: "TASK-0001", revision: "0".repeat(64) }] };
  assert.throws(() => assertEffectOutcome(dir, route, stale, "audit", good.effect, inputs), OutcomeRejection); // stale revision
});

test("isReusableCompletedOutcome requires a stored receipt with live outputs and proof", () => {
  const dir = repo();
  run(dir);
  const outcome: CompletedEffectOutcome = {
    status: "completed", edgeId: "a-to-b", stage: "audit",
    effect: { kind: "audit", id: "spec" },
    inputs: [ref(dir, PROOF)], outputs: [ref(dir, PROOF)],
    proof: ref(dir, PROOF),
  };
  const route = { edgeId: "a-to-b", taskGraph: null, requiredAudits: ["spec"] } as any;
  // No receipt yet — a pending outcome alone never proves the effect ran.
  assert.equal(isReusableCompletedOutcome(dir, route, outcome, outcome.inputs, storeView(dir)), false);
  recordOutcomeReceipt(dir, "unit-run", outcome);
  assert.equal(isReusableCompletedOutcome(dir, route, outcome, outcome.inputs, storeView(dir)), true);
  writeDoc(dir, PROOF, { id: "TASK-0001", type: "task", status: "todo" }, "# Changed\n");
  assert.equal(isReusableCompletedOutcome(dir, route, outcome, outcome.inputs, storeView(dir)), false); // stale outputs+proof
  // A receipt recorded under a different edge scope is not this outcome's
  // proof — scope matching binds edge/stage/effect/inputs, not just content.
  const fresh = repo();
  run(fresh);
  const otherEdge: CompletedEffectOutcome = { ...outcome, edgeId: "x-to-y" };
  recordOutcomeReceipt(fresh, "unit-run", otherEdge);
  assert.equal(isReusableCompletedOutcome(fresh, route, outcome, outcome.inputs, storeView(fresh)), false);
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
  "docs/knowledge",
  "docs/verification",
];
// The `test-spec` audit's Document Registry 3 successor scope — `test-spec`
// itself is legacy migration-only; verification intent is durable.
const VERIFICATION_DOC = "docs/verification/0001-graph.md";
const PROOF_TASK_ID = "TASK-0001";
// Durable corpus for `audit:all` / doc-status inputs — plan and task Markdown
// are corpus/history under Registry 3, so the run's plan.md and task records
// carry their own authority and never join this list.
const KNOWLEDGE_DOC = "docs/knowledge/0001-graph.md";
const canonicalDocumentPaths = [
  "docs/specs/0001-graph.md",
  "docs/adr/0001-graph.md",
  "docs/designs/0001-graph.md",
  VERIFICATION_DOC,
  KNOWLEDGE_DOC,
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
  fs.writeFileSync(path.join(dir, ".gitignore"), "/.apm/state/\n", "utf8");
  git(dir, ["init", "-q"]);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "baseline"]);
}

function commitAll(dir: string): void {
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "checkpoint", "--allow-empty"]);
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
    relations: { "decides-for": ["DESIGN-0001"] },
  }, "# Graph\n\n## Considered Options\n\n### A\n\n### B\n");
  writeArtifact(dir, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph",
    relations: { realizes: ["SPEC-0001"] },
  }, "# Graph\n");
  writeArtifact(dir, KNOWLEDGE_DOC, {
    id: "KNOW-0001", type: "knowledge", status: "confirmed", title: "Graph Knowledge",
    knowledge_kind: "lesson",
    relations: { informs: ["DESIGN-0001"] },
  }, "# Graph Knowledge\n");
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
  writeArtifact(dir, VERIFICATION_DOC, {
    id: "VD-0001", type: "verification", status: "approved", title: "Graph",
  }, "# Graph\n");
  writeArtifact(dir, PROOF, {
    id: "TASK-0001", type: "task", status: "todo", title: "TASK-0001",
    relations: { implements: ["docs/plans/0001-graph.md"] },
  }, "# Task\n\n## Verification\n\n- [ ] node --test\n");
  // .apm/state/ ignore coverage joins the baseline commit; the run's plan,
  // task records, and digest-bound approval are written afterwards — the
  // task graph the caller routes on projects this run (Issue #237).
  initStateRoot(dir);
  gitInit(dir);
  createRun(dir, {
    runId: RUN_ID,
    graphId: "doc-driven-dev",
    focus: ["docs/designs/0001-graph.md"],
    plan: "# Plan\n\nStore-managed run plan.\n",
    tasks: [{ taskId: "TASK-0001", title: "TASK-0001", status: "todo" }],
  });
  approvePlan(dir, RUN_ID, { actor: "caller-runner" });
  return dir;
}

/**
 * Execution-bound task scope: the run's task records keyed by the projected
 * Task Graph node ids. `plan` and `task` audit names refuse at the Registry 3
 * gate (`audit_docs.js --type <name>`), but the declared graph still lists
 * them — the scripted adapter audits the state directly and binds the task
 * records as `execution-task` refs, never `docs/tasks` durable documents.
 * The projected plan likewise has no durable form; its realized scope is the
 * same task record set. Falls back to the primary task id when the route
 * carries no Task Graph projection.
 */
function taskRefSpecs(route: GraphRoute): ReferenceSpec[] {
  const nodes = route.taskGraph?.nodes;
  if (!nodes || nodes.length === 0) return [{ kind: "execution-task", taskId: PROOF_TASK_ID }];
  return nodes.map((node): ReferenceSpec => ({ kind: "execution-task", taskId: node.id }));
}

function testResolveInputs(route: GraphRoute, effect: CallerEffect): ReferenceSpec[] {
  if (effect.kind === "audit") {
    switch (effect.id) {
      case "spec": return ["docs/specs/0001-graph.md"];
      case "adr": return ["docs/adr/0001-graph.md"];
      case "design": return ["docs/designs/0001-graph.md"];
      case "verification": return [VERIFICATION_DOC];
      case "knowledge": return [KNOWLEDGE_DOC];
      case "all": return canonicalDocumentPaths;
    }
  }
  switch (effect.id) {
    case "scaffold_docs": return ["."];
    case "build_task_graph": {
      // The delegate projects the selected Task Graph — its inputs are the
      // run's task records, and a route without a projection cannot supply
      // them. The pre-v3 plan path is intentionally not bound: the plan is
      // run state (manifest planDigest), not a durable document.
      if (!route.taskGraph || route.taskGraph.nodes.length === 0) {
        throw new Error("Missing selected Task Graph for build_task_graph");
      }
      return taskRefSpecs(route);
    }
    case "briefing-flow": return ["docs/specs/0001-graph.md", "docs/adr/0001-graph.md"];
    case "design-doc": return ["docs/specs/0001-graph.md", "docs/adr/0001-graph.md"];
    case "planning-flow": return ["docs/designs/0001-graph.md"];
    case "implementation-flow": return [...taskRefSpecs(route), "docs/designs/0001-graph.md"];
    case "knowledge-doc": return [KNOWLEDGE_DOC, VERIFICATION_DOC];
    case "doc-status": return canonicalDocumentPaths;
    default: throw new Error(`No authoritative-input mapping for ${effect.kind}:${effect.id}`);
  }
}

function testResolveEvidence(route: GraphRoute, effect: CallerEffect): ReferenceSpec {
  if (effect.kind === "audit") return testResolveInputs(route, effect)[0];
  switch (effect.id) {
    case "design-doc": return "docs/designs/0001-graph.md";
    // Registry 3 durable work product: the verification-intent document —
    // the pre-v3 plan/test-spec outputs are execution-bound, never proof.
    case "planning-flow": return VERIFICATION_DOC;
    case "implementation-flow": return "docs/impl/ir/0001-task.md";
    case "knowledge-doc": return KNOWLEDGE_DOC;
    case "doc-status": return VERIFICATION_DOC;
    default: return testResolveInputs(route, effect)[0];
  }
}

function testInputs(dir: string, runId: string, route: GraphRoute, effect: CallerEffect): EffectReference[] {
  return resolveReferenceSpecs(dir, storeView(dir, runId), testResolveInputs(route, effect));
}

function testOutput(dir: string, runId: string, route: GraphRoute, effect: CallerEffect): EffectReference {
  const reference = resolveReference(dir, storeView(dir, runId), testResolveEvidence(route, effect));
  if (reference === null) {
    throw new Error(`output spec does not resolve current state: ${effect.kind}:${effect.id}`);
  }
  return reference;
}

function completed(dir: string, runId: string, route: GraphRoute, stage: "audit" | "delegate", effect: CallerEffect): CompletedEffectOutcome {
  const output = testOutput(dir, runId, route, effect);
  const outputs: EffectReference[] = effect.id === "planning-flow"
    // Registry 3 work product: the durable verification-intent document plus
    // the run's task records — never the pre-v3 plan/test-spec durable docs.
    ? resolveReferenceSpecs(dir, storeView(dir, runId), [VERIFICATION_DOC, ...taskRefSpecs(route)])
    : [output];
  const proof: EffectProof = output.kind === "execution-task"
    // An execution-task ref can never be a proof; the store attests the
    // task-bound work through a provider-scoped idempotency key instead.
    ? { kind: "provider", provider: "execution-store", idempotencyKey: `${output.runId}:${output.taskId}@${output.version}` }
    : output;
  return {
    status: "completed",
    edgeId: route.edgeId as string,
    stage,
    effect,
    inputs: testInputs(dir, runId, route, effect),
    outputs,
    proof,
  };
}

test("runCaller drives the real CLI end-to-end and emits run-level trace events", () => {
  const dir = happyRepo();
  const tsx = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");
  const cli = path.resolve(__dirname, "../src/skills/doc-driven-dev-graph/scripts/route_graph.ts");
  const trace = path.join(dir, "trace.jsonl");
  const dispatcher: EffectDispatcher = (ctx) => ({
    outcome: completed(dir, ctx.runId, ctx.route, ctx.effect.kind, ctx.effect),
    observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
  });
  seedRun(dir);
  const result = runCaller({
    repo: dir, router: { executable: process.execPath, prefixArgs: [tsx, cli] },
    focus: ["DESIGN-0001"],
    // Caller-declared signals — the oracle injects them through mutable
    // signal callbacks; the runner contract declares them up front. The
    // implementation gate's verification authority is the auto-computed
    // Verification Summary bound to HEAD (Issue #241), never a signal.
    signals: ["knowledge-consolidated", "exit-audit-pass"],
    dispatcher,
    store: { runId: RUN_ID },
    resolveInputs: testResolveInputs, resolveOutputPath: testResolveEvidence,
    // The evidence phase performs the edge's canonical mutations first (the
    // oracle's evidence(edgeId, mutate) pattern): implementation work completes
    // TASK-0001 — the run's task RECORD is the authority (Issue #237) and the
    // corpus doc mirrors it — then the checkpoint evidence is declared on the
    // post-mutation doc.
    applyCheckpointEvidence: (repoDir, _signals, edgeId) => {
      if (edgeId === "task-graph-to-implementation") {
        // The delegate commits its canonical mutation (the committedEvidence
        // pattern): store writes are Git-ignored, so the gated edge's
        // porcelain diff is exactly the delegate's own committed work.
        updateTask(repoDir, RUN_ID, "TASK-0001", { status: "done" }, { expectedVersion: taskVersion(repoDir, "TASK-0001") });
        updateArtifact(repoDir, PROOF, { status: "done" });
        commitAll(repoDir);
      }
      return [PROOF];
    },
    trace: { file: trace, runId: "e2e-happy" },
  });
  assert.equal(result.yieldReason, "terminal");
  assert.deepEqual(
    result.routes.map((route) => route.edgeId ?? route.status),
    ["probe-to-briefing", "briefing-to-design", "design-to-planning", "planning-to-task-graph",
     "task-graph-to-implementation", "implementation-to-verification",
     "verification-to-knowledge-consolidation", "knowledge-consolidation-to-exit-audit",
     "exit-audit-to-complete", "terminal"],
  );
  // exit-audit declares audits [all] — every durable document is the audit
  // scope; the route exposes requiredAudits in sorted projection order.
  const exitAuditRoute = result.routes.find((route) => route.next === "exit-audit");
  assert.deepEqual(exitAuditRoute?.requiredAudits, ["all"]);
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
    outcome: completed(dir, ctx.runId, ctx.route, ctx.effect.kind, ctx.effect),
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
  seedRun(dir);
  const result = runCaller({
    repo: dir, router: { executable: process.execPath, prefixArgs: [tsx, cli] },
    focus: ["DESIGN-0001"],
    signals: ["knowledge-consolidated", "exit-audit-pass"],
    dispatcher,
    store: { runId: RUN_ID },
    resolveInputs: testResolveInputs, resolveOutputPath: testResolveEvidence,
    applyCheckpointEvidence: (repoDir, _signals, edgeId) => {
      if (edgeId === "task-graph-to-implementation") {
        // The delegate commits its canonical mutation (the committedEvidence
        // pattern): store writes are Git-ignored, so the gated edge's
        // porcelain diff is exactly the delegate's own committed work.
        updateTask(repoDir, RUN_ID, "TASK-0001", { status: "done" }, { expectedVersion: taskVersion(repoDir, "TASK-0001") });
        updateArtifact(repoDir, PROOF, { status: "done" });
        commitAll(repoDir);
      }
      return [PROOF];
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
  seedRun(dir);
  return {
    repo: dir,
    router: { executable: process.execPath, prefixArgs: [tsx, cli] },
    signals: ["knowledge-consolidated", "exit-audit-pass"],
    dispatcher,
    store: { runId: RUN_ID },
    resolveInputs: testResolveInputs,
    resolveOutputPath: testResolveEvidence,
    applyCheckpointEvidence: (repoDir: string, _signals: ReadonlySet<string>, edgeId: string) => {
      if (edgeId === "task-graph-to-implementation") {
        updateTask(repoDir, RUN_ID, "TASK-0001", { status: "done" }, { expectedVersion: taskVersion(repoDir, "TASK-0001") });
        updateArtifact(repoDir, PROOF, { status: "done" });
        commitAll(repoDir);
      }
      return [PROOF];
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
    outcome: completed(dir, ctx.runId, ctx.route, ctx.effect.kind, ctx.effect),
    observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: "same-context", method: "inline-skill" }],
  });
  const result = runCaller({ ...runnerArgs(dir, dispatcher, trace), executionMode: "tool", focus: ["DESIGN-0001"] });
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
          inputs: testInputs(dir, ctx.runId, ctx.route, ctx.effect),
          outputs: [ref(dir, "docs/specs/0001-graph.md")],
          reason: "authority-required",
        },
        observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: "unknown", method: "not-executed" }],
      };
    }
    return {
      outcome: completed(dir, ctx.runId, ctx.route, ctx.effect.kind, ctx.effect),
      observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
    };
  };
  const result = runCaller({ ...runnerArgs(dir, dispatcher, trace), executionMode: "subagent", focus: ["DESIGN-0001"] });
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
    outcome: completed(dir, ctx.runId, ctx.route, ctx.effect.kind, ctx.effect),
    observations: [{ target: "some-other-dispatch", requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
  });
  const result = runCaller({ ...runnerArgs(dir, dispatcher, trace), focus: ["DESIGN-0001"] });
  assert.equal(result.yieldReason, "authority-required");
});

test("a delegated policy decision attaches a handoff carrying the requested mode", () => {
  const dir = happyRepo();
  const trace = path.join(dir, "trace.jsonl");
  const seen: (string | undefined)[] = [];
  const dispatcher: EffectDispatcher = (ctx) => {
    seen.push(ctx.handoff?.executionMode);
    return {
      outcome: completed(dir, ctx.runId, ctx.route, ctx.effect.kind, ctx.effect),
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
    focus: ["DESIGN-0001"],
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
    outcome: completed(dir, ctx.runId, ctx.route, ctx.effect.kind, ctx.effect),
    observations: [{ target: ctx.effect.id, requested: "same-context", actual: "tool", method: "scripted" }],
  });
  const result = runCaller({ ...runnerArgs(dir, dispatcher, trace), executionMode: "tool", focus: ["DESIGN-0001"] });
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
    outcome: completed(dir, ctx.runId, ctx.route, ctx.effect.kind, ctx.effect),
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
    focus: ["DESIGN-0001"],
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
    outcome: completed(dir, ctx.runId, ctx.route, ctx.effect.kind, ctx.effect),
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
    focus: ["DESIGN-0001"],
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
      outcome: completed(dir, ctx.runId, ctx.route, ctx.effect.kind, ctx.effect),
      observations: [
        { target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" },
        bad,
      ] as never,
    });
    const result = runCaller({ ...runnerArgs(dir, dispatcher, trace), focus: ["DESIGN-0001"] });
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
      const inputs = testInputs(dir, ctx.runId, ctx.route, ctx.effect);
      attempt += 1;
      updateArtifact(dir, "docs/designs/0001-graph.md", { title: `Graph retry ${attempt}` });
      const output = ref(dir, "docs/designs/0001-graph.md");
      return {
        outcome: {
          status: "retry",
          edgeId: ctx.route.edgeId as string,
          stage: "audit",
          effect: ctx.effect,
          inputs,
          outputs: [output],
          retry: { changedOutputs: [output] },
        },
        observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
      };
    }
    return {
      outcome: completed(dir, ctx.runId, ctx.route, ctx.effect.kind, ctx.effect),
      observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
    };
  };
}

test("byte-distinct retry outcomes on the same pending edge exhaust the dispatch budget", () => {
  const dir = happyRepo();
  const trace = path.join(dir, "trace.jsonl");
  const dispatcher = distinctRetryDispatcher(dir);
  const result = runCaller({ ...runnerArgs(dir, dispatcher, trace), current: "design", focus: ["DESIGN-0001"] });
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
    current: "design", focus: ["DESIGN-0001"], maxDispatchesPerEdge: 3,
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
      const inputs = testInputs(dir, ctx.runId, ctx.route, ctx.effect);
      attempt += 1;
      // Flip the design gate pass/fail so routing alternates edges, and
      // change the title so every retry payload is byte-distinct.
      updateArtifact(dir, "docs/designs/0001-graph.md", {
        title: `Alternating retry ${attempt}`,
        status: attempt % 2 === 1 ? "draft" : "approved",
      });
      const output = ref(dir, "docs/designs/0001-graph.md");
      return {
        outcome: {
          status: "retry",
          edgeId: ctx.route.edgeId as string,
          stage: "audit",
          effect: ctx.effect,
          inputs,
          outputs: [output],
          retry: { changedOutputs: [output] },
        },
        observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
      };
    }
    return {
      outcome: completed(dir, ctx.runId, ctx.route, ctx.effect.kind, ctx.effect),
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
    current: "design", focus: ["DESIGN-0001"], maxTotalDispatches: 5,
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
      const inputs = testInputs(dir, ctx.runId, ctx.route, ctx.effect);
      return {
        outcome: {
          status: "yield",
          edgeId: ctx.route.edgeId as string,
          stage: "audit",
          effect: ctx.effect,
          inputs,
          outputs: [ref(dir, "docs/designs/0001-graph.md")],
          reason: "input-required",
        },
        observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
      };
    }
    return leg1Dispatcher(ctx);
  };
  const first = runCaller({
    ...runnerArgs(dir, yieldAfter, trace),
    current: "design", focus: ["DESIGN-0001"], maxDispatchesPerEdge: 3,
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
      const inputs = testInputs(dir, ctx.runId, ctx.route, ctx.effect);
      return {
        outcome: {
          status: "yield",
          edgeId: ctx.route.edgeId as string,
          stage: "audit",
          effect: ctx.effect,
          inputs,
          outputs: [ref(dir, "docs/designs/0001-graph.md")],
          reason: "input-required",
        },
        observations: [{ target: ctx.effect.id, requested: ctx.requestedMode, actual: ctx.requestedMode, method: "scripted" }],
      };
    }
    return leg1Dispatcher(ctx);
  };
  const first = runCaller({ ...runnerArgs(dir, yieldAfter, trace), current: "design", focus: ["DESIGN-0001"] });
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
