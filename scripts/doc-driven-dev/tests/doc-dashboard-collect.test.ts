import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import matter from "gray-matter";

import { collectDashboard } from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_collect";
import { loadGraphDefinition } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import { evaluateRouteDecision } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_router";
import { projectGraphState } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_state";
import { buildTaskGraph } from "../src/skills/doc-driven-dev-graph/scripts/lib/task_graph";
import {
  approvePlan,
  createRun,
  initStateRoot,
} from "../src/skills/lib/execution_store";
import type { TaskStatus } from "../src/skills/lib/execution_store";
import { documentRevisionOf, putImmutable } from "../src/skills/lib/evidence_store";
import { scanKnowledgeGraph, resolveCheckReference } from "../src/skills/lib/knowledge_graph";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

const RUN_ID = "RUN-0001";
const STATE_ROOT = ".apm/state/doc-driven-dev";

test("draft inventory survives missing focus and incomplete bootstrap", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-collect-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, "docs/specs"), { recursive: true });
  const file = path.join(cwd, "docs/specs/example.md");
  const content = "---\nid: SPEC-0001\ntype: spec\nstatus: draft\ntitle: 草案\ncreated: '2026-09-21'\nupdated: '2026-09-21'\nowners: []\nrelations: {}\n---\n# 草案\n";
  fs.writeFileSync(file, content);
  const graphPath = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml");

  const report = await collectDashboard({
    cwd,
    graphPath,
    focus: [],
    signals: [],
    now: () => "2026-09-21T00:00:00Z",
  });

  assert.equal(report.decision, null);
  assert.equal(report.requested.current, null);
  assert.equal(report.inventory.find((row) => row.path === "docs/specs/example.md")?.status, "draft");
  assert.ok(report.state.blockers.includes("bootstrap-incomplete"));
  assert.equal(fs.readFileSync(file, "utf8"), content);
  assert.ok(!report.state.signals.includes("exit-audit-pass"));
});

for (const scenario of [
  "done",
  "wont-do",
  "active",
  "active-waiting",
  "cycle",
  "duplicate",
  "orphan",
  "invalid",
  "empty",
  "unmanaged",
  "alias",
]) {
  test(`collector preserves canonical semantics: ${scenario}`, async (t) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-case-"));
    t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
    const write = (relative: string, data: Record<string, unknown>, body = "# Example\n") => {
      const file = path.join(cwd, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, matter.stringify(body, {
        title: "Example",
        created: "2026-09-21",
        updated: "2026-09-21",
        owners: [],
        relations: {},
        ...data,
      }));
    };
    const planPath = "docs/plans/example.md";
    // Durable plan/task Markdown stays in the corpus as history; the run's
    // store records — never these documents — drive the task graph (#237).
    const designPath = "docs/designs/chain.md";
    if (scenario !== "empty") {
      // Implicit run selection needs a real artifact chain: the approved
      // durable design is the chain member the run's manifest focus binds —
      // corpus plan/task records are migration inventory, never chain
      // members (Issue #243).
      write(designPath, { id: "DESIGN-0001", type: "design", status: "approved" });
      write(planPath, { id: "PLAN-0001", type: "plan", status: "in-progress" });
      write("docs/tasks/a.md", {
        id: "TASK-0001",
        type: "task",
        status: scenario.startsWith("active") ? "in-progress" : "todo",
        relations: { implements: [planPath], "depends-on": ["TASK-0002"] },
      });
      write("docs/tasks/b.md", {
        id: "TASK-0002",
        type: "task",
        status: scenario === "wont-do"
          ? "wont-do"
          : scenario === "active-waiting" || scenario === "cycle"
            ? "todo"
            : "done",
        relations: {
          implements: [planPath],
          ...(scenario === "cycle" ? { "depends-on": ["TASK-0001"] } : {}),
        },
      });
    }
    if (scenario === "duplicate") {
      write("docs/plans/second.md", { id: "PLAN-0002", type: "plan", status: "draft" });
      write("docs/tasks/duplicate.md", {
        id: "TASK-0001",
        type: "task",
        status: "todo",
        relations: { implements: [planPath] },
      });
    }
    if (scenario === "orphan") {
      write("docs/tasks/orphan.md", { id: "TASK-0003", type: "task", status: "todo" });
    }
    if (scenario === "invalid") {
      fs.writeFileSync(path.join(cwd, "docs/tasks/invalid.md"), "---\nid: [\n---\n");
    }
    if (scenario === "unmanaged") {
      fs.mkdirSync(path.join(cwd, "docs/superpowers/plans"), { recursive: true });
      fs.writeFileSync(path.join(cwd, "docs/superpowers/plans/raw.md"), "# Human plan\n");
    }
    if (scenario === "alias") {
      write("docs/spec/alias.md", { id: "SPEC-0001", type: "spec", status: "draft" });
    }

    const graphPath = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml");
    const definition = loadGraphDefinition(graphPath);

    if (scenario !== "empty") {
      // The Dynamic Task Graph reads ONE Execution Store run: records under
      // the state root, approved plan.md, same-run task ids.
      initStateRoot(cwd);
      const taskStatus = (value: TaskStatus | undefined): TaskStatus | undefined => value;
      const tasks = scenario === "cycle"
        ? [
          { taskId: "TASK-0001", dependsOn: ["TASK-0002"] },
          { taskId: "TASK-0002", dependsOn: ["TASK-0001"] },
        ]
        : [
          {
            taskId: "TASK-0001",
            status: taskStatus(scenario.startsWith("active") ? "in-progress" : "todo"),
            dependsOn: ["TASK-0002"],
          },
          {
            taskId: "TASK-0002",
            status: taskStatus(scenario === "wont-do"
              ? "wont-do"
              : scenario === "active-waiting" ? "todo" : "done"),
          },
        ];
      createRun(cwd, {
        runId: RUN_ID,
        graphId: definition.id,
        focus: [designPath],
        plan: "# Plan\n\nStore-managed plan for the run.\n",
        tasks,
      });
      approvePlan(cwd, RUN_ID, { actor: "collector-test" });
      if (scenario === "duplicate") {
        // A second record file claiming TASK-0001 — the API refuses this
        // write, so corrupt state is modeled as a raw record file.
        const stamp = new Date().toISOString();
        const recordFile = path.join(cwd, STATE_ROOT, "runs", RUN_ID, "tasks", "ZZZ-0001.json");
        fs.writeFileSync(recordFile, `${JSON.stringify({
          schemaVersion: 1,
          runId: RUN_ID,
          taskId: "TASK-0001",
          title: "duplicate claim",
          status: "todo",
          dependsOn: [],
          checks: [],
          scope: [],
          version: 1,
          createdAt: stamp,
          updatedAt: stamp,
        }, null, 2)}\n`);
      }
    }

    const focus = scenario === "empty" ? [] : [designPath];
    const report = await collectDashboard({ cwd, graphPath, focus, signals: [], current: "task-graph" });

    // Issue #243/#246: the collector now derives the HEAD-bound
    // Verification Summary itself, exactly like route_graph — a missing
    // summary can never resurface as the phantom `verification-summary`
    // blocker. Re-projecting with the collected summary must reproduce the
    // state verbatim (the same authority, bound the same way).
    assert.ok(report.state.verification !== null, "dashboard always projects a Verification Summary");
    assert.ok(!report.state.blockers.includes("verification-summary"), "no phantom missing-input blocker");
    assert.deepEqual(
      report.state,
      await projectGraphState({
        cwd, graphId: definition.id, focus, signals: [],
        verificationSummary: report.state.verification.summary,
      }),
    );
    assert.deepEqual(report.decision, evaluateRouteDecision({ current: "task-graph", definition, state: report.state }));
    if (scenario !== "empty" && scenario !== "duplicate") {
      // Exactly one active run bound to this graph's chain → implicit
      // selection projects it without a --run selector. The duplicate
      // scenario's corpus duplicate-id blocks chain selection instead.
      assert.ok(report.state.execution.taskGraph, `${scenario} run should be implicitly selected`);
      assert.equal(report.state.execution.run?.runId, RUN_ID);
    }
    if (scenario !== "empty") {
      const graph = report.runs.find((run) => run.runId === RUN_ID)?.graph;
      assert.ok(graph);
      assert.ok(graph.nodes.length > 0, `${scenario} should exercise real task records`);
      assert.deepEqual(
        graph,
        buildTaskGraph({ cwd, runId: RUN_ID }),
      );
      if (scenario === "done") assert.deepEqual(graph.runnable, ["TASK-0001"]);
      if (scenario === "wont-do") assert.deepEqual(graph.runnable, []);
      if (scenario === "active") assert.deepEqual(graph.resumableActive, ["TASK-0001"]);
      if (scenario === "active-waiting") assert.deepEqual(graph.resumableActive, []);
      if (scenario === "cycle") assert.ok(graph.issues.some((issue) => issue.code === "task-cycle"));
      if (scenario === "duplicate") assert.ok(graph.issues.some((issue) => issue.code === "duplicate-task-id"));
    } else {
      assert.equal(report.runs.length, 0);
    }
    if (scenario === "unmanaged") {
      assert.equal(report.inventory.find((row) => row.path.endsWith("raw.md"))?.kind, "unmanaged");
    }
    if (scenario === "alias") {
      assert.equal(report.inventory.find((row) => row.path.endsWith("alias.md"))?.graphCovered, false);
    }
    if (scenario === "orphan") {
      assert.ok(report.inventory.some((row) => row.path.endsWith("orphan.md")));
    }
    if (scenario === "invalid") {
      assert.ok(report.inventory.some((row) => row.parseError !== null));
    }
    await assert.rejects(
      collectDashboard({ cwd, graphPath, focus, signals: [], current: "unknown-node" }),
      /Unknown graph node/,
    );
    await assert.rejects(
      collectDashboard({ cwd, graphPath, focus, signals: ["undeclared-signal"] }),
      /Unknown signal/,
    );
  });
}

// --- Issue #246: Execution/Evidence selector parity + summary plumbing ------
//
// The dashboard accepts the same `--run`/`--state-root`/
// `--allow-external-root` selectors route_graph and the store CLIs take, and
// it projects the same HEAD-bound Verification Summary the router computes —
// never the phantom `verification-summary` blocker a missing input produced.

const GRAPH_PATH = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml");

function sha256Of(content: string): string {
  return `sha256:${crypto.createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function gitOut(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return (result.stdout ?? "").trim();
}

function writeDocFile(cwd: string, relPath: string, data: Record<string, unknown>, body = "# Doc\n"): void {
  const file = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify(body, {
    created: "2026-01-01",
    updated: "2026-01-01",
    owners: [],
    relations: {},
    ...data,
  }), "utf8");
}

test("the run selector disambiguates several active runs on one chain", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-run-select-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const designPath = "docs/designs/chain.md";
  writeDocFile(cwd, designPath, { id: "DESIGN-0001", type: "design", status: "approved", title: "Design" });
  const definition = loadGraphDefinition(GRAPH_PATH);
  initStateRoot(cwd);
  for (const runId of ["RUN-0001", "RUN-0002"]) {
    createRun(cwd, {
      runId,
      graphId: definition.id,
      focus: [designPath],
      plan: `# Plan\n\n${runId} plan.\n`,
      tasks: [{ taskId: "TASK-0001", status: "done" }],
    });
    approvePlan(cwd, runId, { actor: "collector-test" });
  }

  // Two active runs on the same chain are ambiguous without a selector.
  const implicit = await collectDashboard({ cwd, graphPath: GRAPH_PATH, focus: [designPath], signals: [] });
  assert.ok(implicit.state.blockers.includes("task-graph-run-ambiguous"));

  const picked = await collectDashboard({ cwd, graphPath: GRAPH_PATH, focus: [designPath], signals: [], run: "RUN-0002" });
  assert.equal(picked.state.execution.run?.runId, "RUN-0002");
  assert.ok(!picked.state.blockers.includes("task-graph-run-ambiguous"));
  assert.equal(picked.state.execution.taskGraph?.nodes[0]?.id, "TASK-0001");
});

test("an external state root requires allowExternalRoot and then reads runs there", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-ext-root-"));
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-ext-state-"));
  t.after(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(shared, { recursive: true, force: true });
  });
  const designPath = "docs/designs/chain.md";
  writeDocFile(cwd, designPath, { id: "DESIGN-0001", type: "design", status: "approved", title: "Design" });
  const definition = loadGraphDefinition(GRAPH_PATH);
  const external = { stateRoot: shared, allowExternalRoot: true };
  createRun(cwd, {
    runId: "RUN-EXT1",
    graphId: definition.id,
    focus: [designPath],
    plan: "# Plan\n\nExternal run.\n",
    tasks: [{ taskId: "TASK-0001", status: "done" }],
  }, external);
  approvePlan(cwd, "RUN-EXT1", { actor: "collector-test" }, external);

  // Unauthorized — the boundary refuses before any read.
  await assert.rejects(
    collectDashboard({ cwd, graphPath: GRAPH_PATH, focus: [designPath], signals: [], stateRoot: shared }),
    /external|allowExternalRoot/i,
  );

  const report = await collectDashboard({
    cwd, graphPath: GRAPH_PATH, focus: [designPath], signals: [],
    run: "RUN-EXT1", stateRoot: shared, allowExternalRoot: true,
  });
  assert.equal(report.state.execution.run?.runId, "RUN-EXT1");
  assert.ok(report.runs.some((run) => run.runId === "RUN-EXT1"), "run inventory reads the declared external root");
});

test("measured evidence flips the preview's verification gate to pass — the #243 phantom blocker is gone", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-verified-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  writeDocFile(cwd, "docs/specs/spec.md", {
    id: "SPEC-abcd", type: "spec", status: "approved", title: "Spec",
  }, "# Spec\n\n<!-- claim:R-01 --> Requirement R-01\n");
  writeDocFile(cwd, "docs/verification/vd.md", {
    id: "VD-efgh", type: "verification", status: "approved", title: "Design",
    checks: [{
      id: "CHK-01",
      target: "SPEC-abcd::R-01",
      method: "unit",
      implementation: "pnpm test",
      preconditions: ["spec exists"],
      passCriteria: { kind: "unit", expect: "criterion for CHK-01" },
      limitations: [],
      required: true,
    }],
  }, "# Verification Design\n\n## Checks\n");
  const designPath = "docs/designs/chain.md";
  writeDocFile(cwd, designPath, {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Design",
    relations: { realizes: ["SPEC-abcd"] },
  });

  git(cwd, ["init", "-q"]);
  initStateRoot(cwd);
  git(cwd, ["add", "-A"]);
  git(cwd, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline"]);
  const head = gitOut(cwd, ["rev-parse", "HEAD"]);

  // A passed record pinned to the live revisions, measured on HEAD.
  const graph = await scanKnowledgeGraph({ cwd });
  const checkResolution = resolveCheckReference(graph, "VD-efgh::CHK-01");
  assert.equal(checkResolution.status, "resolved");
  putImmutable(cwd, {
    evidenceId: "EVID-0001",
    claim: { ref: "SPEC-abcd::R-01", documentRevision: documentRevisionOf(fs.readFileSync(path.join(cwd, "docs/specs/spec.md"), "utf8")) },
    check: { ref: "VD-efgh::CHK-01", designRevision: checkResolution.check.designRevision },
    subject: { kind: "commit", commit: head },
    method: "unit",
    provider: { kind: "repository", name: null },
    runId: "RUN-0001",
    environment: { runner: "local" },
    outcome: "passed",
    retention: "release",
    artifacts: [{ uri: "file:logs/unit.txt", sha256: sha256Of("unit-log"), availability: "available", retention: "release", expiresAt: null }],
  });

  const report = await collectDashboard({ cwd, graphPath: GRAPH_PATH, focus: [designPath], signals: [] });
  assert.ok(report.state.verification !== null);
  assert.equal(report.state.verification.boundToHead, true);
  assert.equal(report.state.verification.summary.verdict, "verified");
  assert.equal(report.state.gates.verification.status, "pass");
  assert.ok(!report.state.blockers.some((blocker) => blocker.startsWith("verification")));
});

// --- Issue #246: one Evidence Store authority --------------------------------
//
// The snapshot carries the store's own marker state so the panel can tell
// an absent store from an initialized-but-empty one and from a store whose
// records can no longer be certified — and the repo-level `evidence` gate
// reads the SAME selected root the summary and run views do, never a
// silent fallback to the default (Issue #246).

test("the snapshot reports an absent store distinctly from an initialized one", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-storeless-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  writeDocFile(cwd, "docs/designs/chain.md", { id: "DESIGN-0001", type: "design", status: "approved", title: "Design" });
  git(cwd, ["init", "-q"]);
  initStateRoot(cwd);
  git(cwd, ["add", "-A"]);
  git(cwd, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline"]);

  // Nothing under `evidence/` at all: the store was never initialized. The
  // summary still computes (zero records is honest coverage), but the
  // marker state must not fabricate a store that does not exist.
  const storeless = await collectDashboard({ cwd, graphPath: GRAPH_PATH, focus: ["docs/designs/chain.md"], signals: [] });
  assert.equal(storeless.evidenceStore.integrity, "absent");
  assert.ok(storeless.state.verification !== null, "the summary is still the authority routing sees");
  assert.ok(!storeless.findings.some((finding) => finding.ruleId === "corrupt-evidence-store"
    || finding.ruleId === "unmanifested-evidence-store"));

  // First put lands the write-once manifest — an initialized store reads ok.
  const graph = await scanKnowledgeGraph({ cwd });
  const checkResolution = resolveCheckReference(graph, "VD-efgh::CHK-01");
  putImmutable(cwd, {
    evidenceId: "EVID-0001",
    claim: { ref: "SPEC-abcd::R-01", documentRevision: sha256Of("doc") },
    check: { ref: "VD-efgh::CHK-01", designRevision: checkResolution.status === "resolved" ? checkResolution.check.designRevision : sha256Of("design") },
    subject: { kind: "commit", commit: gitOut(cwd, ["rev-parse", "HEAD"]) },
    method: "unit",
    provider: { kind: "repository", name: null },
    runId: null,
    environment: { runner: "local" },
    outcome: "inconclusive",
    retention: "release",
    artifacts: [],
  });
  const initialized = await collectDashboard({ cwd, graphPath: GRAPH_PATH, focus: ["docs/designs/chain.md"], signals: [] });
  assert.equal(initialized.evidenceStore.integrity, "ok");
});

test("a torn manifest degrades every surface the same way — marker, summary, and findings agree", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-corrupt-store-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  writeDocFile(cwd, "docs/specs/spec.md", {
    id: "SPEC-abcd", type: "spec", status: "approved", title: "Spec",
  }, "# Spec\n\n<!-- claim:R-01 --> Requirement R-01\n");
  writeDocFile(cwd, "docs/verification/vd.md", {
    id: "VD-efgh", type: "verification", status: "approved", title: "Design",
    checks: [{
      id: "CHK-01", target: "SPEC-abcd::R-01", method: "unit",
      implementation: "pnpm test", preconditions: ["spec exists"],
      passCriteria: { kind: "unit", expect: "criterion" }, limitations: [], required: true,
    }],
  }, "# Verification Design\n\n## Checks\n");
  const designPath = "docs/designs/chain.md";
  writeDocFile(cwd, designPath, { id: "DESIGN-0001", type: "design", status: "approved", title: "Design" });
  git(cwd, ["init", "-q"]);
  initStateRoot(cwd);
  git(cwd, ["add", "-A"]);
  git(cwd, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline"]);

  const graph = await scanKnowledgeGraph({ cwd });
  const checkResolution = resolveCheckReference(graph, "VD-efgh::CHK-01");
  assert.equal(checkResolution.status, "resolved");
  putImmutable(cwd, {
    evidenceId: "EVID-0001",
    claim: { ref: "SPEC-abcd::R-01", documentRevision: documentRevisionOf(fs.readFileSync(path.join(cwd, "docs/specs/spec.md"), "utf8")) },
    check: { ref: "VD-efgh::CHK-01", designRevision: checkResolution.check.designRevision },
    subject: { kind: "commit", commit: gitOut(cwd, ["rev-parse", "HEAD"]) },
    method: "unit",
    provider: { kind: "repository", name: null },
    runId: "RUN-0001",
    environment: { runner: "local" },
    outcome: "passed",
    retention: "release",
    artifacts: [{ uri: "file:logs/unit.txt", sha256: sha256Of("unit-log"), availability: "available", retention: "release", expiresAt: null }],
  });
  // Tear the manifest AFTER the record lands — a marker that can no longer
  // certify the store.
  const manifest = path.join(cwd, STATE_ROOT, "evidence", "manifest.json");
  fs.writeFileSync(manifest, "{ \"schemaVersion\":", "utf8");

  const report = await collectDashboard({ cwd, graphPath: GRAPH_PATH, focus: [designPath], signals: [] });
  assert.equal(report.evidenceStore.integrity, "corrupt");
  // The findings sweep names the same boundary…
  assert.ok(report.findings.some((finding) => finding.ruleId === "corrupt-evidence-store"));
  // …the summary degrades instead of certifying unprovable coverage…
  assert.ok(report.state.verification !== null);
  assert.equal(report.state.verification.summary.verdict, "indeterminate");
  assert.ok(report.state.verification.summary.reasons.includes("evidence-store-corrupt"));
  // …and the verification gate carries that reason into routing state.
  assert.equal(report.state.gates.verification.status, "blocked");
  assert.ok(report.state.gates.verification.reasons.includes("evidence-store-corrupt"));
});

test("the findings sweep reads the same selected Evidence Store — never the default root", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-selected-store-"));
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-selected-ext-"));
  t.after(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(shared, { recursive: true, force: true });
  });
  writeDocFile(cwd, "docs/specs/spec.md", {
    id: "SPEC-abcd", type: "spec", status: "approved", title: "Spec",
  }, "# Spec\n\n<!-- claim:R-01 --> Requirement R-01\n");
  writeDocFile(cwd, "docs/verification/vd.md", {
    id: "VD-efgh", type: "verification", status: "approved", title: "Design",
    checks: [{
      id: "CHK-01", target: "SPEC-abcd::R-01", method: "unit",
      implementation: "pnpm test", preconditions: ["spec exists"],
      passCriteria: { kind: "unit", expect: "criterion" }, limitations: [], required: true,
    }],
  }, "# Verification Design\n\n## Checks\n");
  const designPath = "docs/designs/chain.md";
  writeDocFile(cwd, designPath, { id: "DESIGN-0001", type: "design", status: "approved", title: "Design" });
  git(cwd, ["init", "-q"]);
  initStateRoot(cwd);
  git(cwd, ["add", "-A"]);
  git(cwd, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline"]);

  const external = { stateRoot: shared, allowExternalRoot: true };
  const graph = await scanKnowledgeGraph({ cwd });
  const checkResolution = resolveCheckReference(graph, "VD-efgh::CHK-01");
  assert.equal(checkResolution.status, "resolved");
  // The ONLY record lives in the external store — an unresolved claim
  // ref that can never resolve in this graph.
  putImmutable(cwd, {
    evidenceId: "EVID-0001",
    claim: { ref: "SPEC-gone::R-01", documentRevision: sha256Of("ghost") },
    check: { ref: "VD-efgh::CHK-01", designRevision: checkResolution.check.designRevision },
    subject: { kind: "commit", commit: gitOut(cwd, ["rev-parse", "HEAD"]) },
    method: "unit",
    provider: { kind: "repository", name: null },
    runId: "RUN-0001",
    environment: { runner: "local" },
    outcome: "passed",
    retention: "release",
    artifacts: [],
  }, external);
  // And the DEFAULT store is torn — a sweep that silently read it would
  // surface its own marker instead of the selected store's finding.
  fs.mkdirSync(path.join(cwd, STATE_ROOT, "evidence"), { recursive: true });
  fs.writeFileSync(path.join(cwd, STATE_ROOT, "evidence", "manifest.json"), "{ \"schemaVersion\":", "utf8");

  const report = await collectDashboard({
    cwd, graphPath: GRAPH_PATH, focus: [designPath], signals: [], ...external,
  });
  assert.equal(report.evidenceStore.integrity, "ok");
  assert.ok(report.findings.some((finding) => finding.ruleId === "unresolved-evidence-claim"),
    "the selected store's records must reach the evidence gate");
  assert.ok(!report.findings.some((finding) => finding.ruleId === "corrupt-evidence-store"),
    "the default root's torn manifest must never leak into a selected-root sweep");
});
