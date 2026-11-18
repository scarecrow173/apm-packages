import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import test from "node:test";

import { buildMigrationPlan } from "../src/skills/doc-maintenance/scripts/lib/migration_inventory";

// Migration inventory + read-only dry-run plan (Issue #245).
//
// `doc_maintenance.js migrate plan` is the only place legacy readers exist.
// These tests pin the contract: a deterministic, fully read-only report over
// every git-era artifact (durable docs, plan/task, test-spec, impl/exp,
// relations, indexes, caller bookkeeping, foreign state, existing runs)
// with concrete per-element destinations, mechanical convertibles,
// semantic-judgment blockers, collisions, residual risks, run handoff
// requirements, and a locale/order-independent planHash. Bootstrap (a
// fresh empty repository) is never a migration target.

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");
const maintenanceScript = path.join(skillRoot, "doc-maintenance", "scripts", "doc_maintenance.js");

const MANIFEST = {
  schemaVersion: 1,
  documentRegistry: 3,
  knowledgeRelations: 1,
  verificationDesign: 1,
  evidenceRecord: 1,
  graphDefinition: 3,
};

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "migration-inventory-"));
}

function writeFile(repo: string, rel: string, content: string): void {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function writeDoc(repo: string, rel: string, data: Record<string, unknown>, body = "# Doc\n"): void {
  writeFile(repo, rel, matter.stringify(body, data));
}

function writeManifest(repo: string, value: unknown = MANIFEST): void {
  writeFile(repo, "docs/.doc-driven-dev/schema.json", typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
}

function writeRun(repo: string, runId: string, status: "active" | "completed" | "aborted", tasks: Array<Record<string, unknown>> = []): void {
  const dir = `.apm/state/doc-driven-dev/runs/${runId}`;
  const stamp = "2026-01-01T00:00:00.000Z";
  writeFile(repo, `${dir}/manifest.json`, `${JSON.stringify({
    schemaVersion: 1,
    runId,
    revision: 1,
    status,
    graphId: "doc-driven-dev",
    focus: null,
    baseCommit: null,
    planDigest: null,
    approval: null,
    createdAt: stamp,
    updatedAt: stamp,
    finalizedAt: status === "active" ? null : stamp,
  }, null, 2)}\n`);
  for (const task of tasks) {
    const taskId = String(task.taskId);
    writeFile(repo, `${dir}/tasks/${taskId}.json`, `${JSON.stringify({
      schemaVersion: 1,
      runId,
      taskId,
      title: taskId,
      status: "todo",
      dependsOn: [],
      checks: [],
      scope: [],
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
      ...task,
    }, null, 2)}\n`);
  }
}

function writeExpLog(repo: string, rel: string, events: Array<Record<string, unknown>>, extraRawLines: string[] = []): void {
  const lines = [
    ...events.map((event, index) => JSON.stringify({
      schema: "experiment_event.v1",
      experiment: rel,
      seq: index + 1,
      ts: "2026-01-02T00:00:00.000Z",
      ...event,
    })),
    ...extraRawLines,
  ];
  writeFile(repo, rel, `${lines.join("\n")}\n`);
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function snapshotTree(root: string): string {
  const entries: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      if (entry.isDirectory()) walk(abs);
      else entries.push(`${rel}:${sha256(fs.readFileSync(abs, "utf8"))}`);
    }
  };
  walk(root);
  return entries.join("\n");
}

function runMigratePlan(repo: string) {
  const result = spawnSync(process.execPath, [maintenanceScript, "migrate", "plan", "--cwd", repo], { cwd: repo, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `migrate plan should exit 0: ${result.stderr}\n${result.stdout.slice(0, 400)}`);
  return JSON.parse(result.stdout);
}

// --- fixture factories ------------------------------------------------------

function baseDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "DOC-0001",
    type: "spec",
    status: "approved",
    title: "Doc",
    created: "2026-01-01",
    updated: "2026-01-02",
    owners: [],
    relations: {},
    ...overrides,
  };
}

function v3Doc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { lifecycle: "current", ...baseDoc(overrides) };
}

function legacyCorpusRepo() {
  const repo = tempRepo();
  // v2 durable docs: no lifecycle, legacy relation vocabulary.
  writeDoc(repo, "docs/specs/0001-checkout.md", baseDoc({
    id: "SPEC-0001", type: "spec", status: "approved", title: "Checkout",
    relations: { "derives-from": ["docs/discovery/0001-research.md"], source: ["src/checkout.ts"] },
  }), "# Checkout\n\nSee [the plan](../plans/0001-checkout-plan.md) and [the spec](./0001-checkout.md).\n");
  writeDoc(repo, "docs/designs/0001-checkout-flow.md", baseDoc({
    id: "DESIGN-0001", type: "design", status: "approved", title: "Checkout Flow",
    relations: { realizes: ["SPEC-0001"], "verified-by": ["TSPEC-0001"] },
  }), "# Checkout Flow\n");
  writeDoc(repo, "docs/designs/overview.md", baseDoc({
    id: "DESIGN-OVERVIEW", type: "design", status: "approved", title: "Designs",
  }), "# Design overview\n");
  writeDoc(repo, "docs/discovery/0001-research.md", baseDoc({
    id: "DISC-0001", type: "discovery", status: "resolved", title: "Research",
  }), "# Research\n");
  writeDoc(repo, "docs/adr/0001-use-pgsql.md", baseDoc({
    id: "ADR-0001", type: "adr", status: "accepted", title: "Use PostgreSQL",
  }), "# 1. Use PostgreSQL\n");
  // Legacy verification intent.
  writeDoc(repo, "docs/test-specs/0001-checkout-test.md", baseDoc({
    id: "TSPEC-0001", type: "test-spec", status: "approved", title: "Checkout Tests",
    relations: { verifies: ["SPEC-0001"] },
  }), "# Checkout Tests\n\n## Guarantees\n\n- Orders are idempotent.\n\n## Rules\n\n- A cart must total before pay.\n\n## Examples\n\n- Given a cart, when paid, then receipt.\n\n## Non-goals\n\n- Performance.\n");
  // Execution-bound corpus: one plan + a two-task DAG.
  writeDoc(repo, "docs/plans/0001-checkout-plan.md", baseDoc({
    id: "PLAN-0001", type: "plan", status: "in-progress", title: "Checkout Plan",
  }), "# Checkout Plan\n");
  writeDoc(repo, "docs/tasks/0001-schema.md", baseDoc({
    id: "TASK-0001", type: "task", status: "done", title: "Schema",
    relations: { implements: ["docs/plans/0001-checkout-plan.md"], "depends-on": [] },
    effectOutcomes: [
      { status: "completed", edgeId: "e-1", stage: "audit", effect: { kind: "audit", id: "lint" }, authoritativeInputs: [], evidence: [], proof: {} },
      { status: "yield", edgeId: "e-2", stage: "delegate", effect: { kind: "delegate", id: "impl" }, authoritativeInputs: [], evidence: [], reason: "input-required" },
    ],
    checkpointEvidence: [
      { edgeId: "e-1", evidence: { path: "docs/tasks/0001-schema.md", id: "TASK-0001", fingerprint: "abc" } },
    ],
  }), "# Schema task\n");
  writeDoc(repo, "docs/tasks/0002-api.md", baseDoc({
    id: "TASK-0002", type: "task", status: "in-progress", title: "API",
    relations: {
      implements: ["docs/plans/0001-checkout-plan.md"],
      "depends-on": ["docs/tasks/0001-schema.md"],
      "verified-by": ["TSPEC-0001"],
    },
  }), "# API task\n");
  // Implementation record + experiment log.
  writeDoc(repo, "docs/impl/ir/0001-checkout-impl.md", baseDoc({
    id: "IMPL-0001", type: "impl", status: "completed", title: "Checkout Impl",
    relations: { implements: ["docs/tasks/0001-schema.md"] },
    metadata: { experiments: { adopted: ["docs/impl/exp/0001-pooling.jsonl"], rejected: [] } },
  }), "# Checkout Impl\n\n## Validation\n\n- `pnpm test` passed.\n");
  writeExpLog(repo, "docs/impl/exp/0001-pooling.jsonl", [
    { type: "start", summary: "Pooling experiment" },
    { type: "observation", summary: "Latency dropped" },
  ]);
  // Indexes: generated in a durable dir, hand-curated in a migration dir.
  writeFile(repo, "docs/specs/README.md", "# SPEC Documents\n\n<!-- doc-suite:generated-index -->\n\nDirectory: `docs/specs`\n\n| ID | Title | Status | File |\n| --- | --- | --- | --- |\n| SPEC-0001 | Checkout | approved | [0001-checkout.md](./0001-checkout.md) |\n");
  writeFile(repo, "docs/tasks/README.md", "# Task notes\n\nHand-curated index of tasks.\n");
  // Foreign v2 state.
  writeFile(repo, "docs/.doc-driven-dev/graph-state.json", "{}\n");
  writeFile(repo, ".apm/state/doc-driven-dev/runs.json", "[]\n");
  // Existing v3 runs: two active, one finalized.
  writeRun(repo, "RUN-active-one", "active", [{ taskId: "TASK-A" }]);
  writeRun(repo, "RUN-active-two", "active");
  writeRun(repo, "RUN-done", "completed", [{ taskId: "TASK-B" }]);
  return repo;
}

// --- classification ---------------------------------------------------------

test("empty repository is a bootstrap target, not a migration target", () => {
  const plan = buildMigrationPlan(tempRepo());
  assert.equal(plan.plan.classification, "bootstrap");
  assert.equal(plan.plan.applyEligible, false);
  assert.equal(plan.migration.status, "nothing");
  assert.equal(plan.inventory.inputFiles.length, 0);
  assert.equal(plan.inventory.inputHash, sha256("[]"));
  assert.match(plan.plan.next, /scaffold|bootstrap/i);
});

test("durable-only repo conformant with v3 is manifest-only, not migration", () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-spec.md", v3Doc({ id: "SPEC-0001" }));
  writeDoc(repo, "docs/adr/0001-adr.md", v3Doc({ id: "ADR-0001", type: "adr", status: "accepted" }));
  const plan = buildMigrationPlan(repo);
  assert.equal(plan.plan.classification, "manifest-only");
  assert.equal(plan.plan.applyEligible, true);
  assert.equal(plan.inventory.documents.every((doc) => doc.disposition === "preserve"), true);
  assert.equal(plan.migration.semanticDecisions.length, 0);
  assert.ok(plan.migration.plannedWrites.some((write) => write.kind === "schema-manifest" && write.target === "docs/.doc-driven-dev/schema.json"));
});

test("current repository reports nothing to migrate", () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-spec.md", v3Doc({ id: "SPEC-0001" }));
  writeManifest(repo);
  const plan = buildMigrationPlan(repo);
  assert.equal(plan.preflight.status, "current");
  assert.equal(plan.plan.classification, "current");
});

// --- full inventory over the legacy corpus -----------------------------------

test("inventory detects every legacy owner and artifact class", () => {
  const plan = buildMigrationPlan(legacyCorpusRepo());
  assert.equal(plan.plan.classification, "migration");
  assert.equal(plan.plan.applyEligible, false);
  assert.equal(plan.plan.requiresFullMigration, true);

  const byPath = new Map(plan.inventory.documents.map((doc) => [doc.path, doc]));
  assert.equal(byPath.get("docs/plans/0001-checkout-plan.md")?.disposition, "convert:run-plan");
  assert.equal(byPath.get("docs/tasks/0001-schema.md")?.disposition, "convert:run-task");
  assert.equal(byPath.get("docs/tasks/0002-api.md")?.disposition, "convert:run-task");
  assert.equal(byPath.get("docs/test-specs/0001-checkout-test.md")?.disposition, "convert:verification");
  assert.equal(byPath.get("docs/impl/ir/0001-checkout-impl.md")?.disposition, "classify");
  assert.equal(byPath.get("docs/specs/0001-checkout.md")?.disposition, "preserve");
  assert.equal(byPath.get("docs/adr/0001-use-pgsql.md")?.disposition, "preserve");

  // Every file class is inventoried.
  assert.equal(plan.inventory.experimentLogs.length, 1);
  assert.equal(plan.inventory.experimentLogs[0].path, "docs/impl/exp/0001-pooling.jsonl");
  assert.equal(plan.inventory.experimentLogs[0].events, 2);
  assert.equal(plan.inventory.indexes.length, 2);
  assert.equal(plan.inventory.runs.length, 3);
  assert.ok(plan.inventory.foreignState.some((entry) => entry.path === "docs/.doc-driven-dev/graph-state.json"));
  assert.ok(plan.inventory.foreignState.some((entry) => entry.path === ".apm/state/doc-driven-dev/runs.json"));
  assert.ok(plan.inventory.callerBookkeeping.some((entry) => entry.path === "docs/tasks/0001-schema.md" && entry.effectOutcomes === 2 && entry.checkpointEvidence === 1));
  assert.ok(plan.inventory.legacyRelations.some((entry) => entry.path === "docs/specs/0001-checkout.md" && entry.field === "derives-from"));
  assert.ok(plan.inventory.legacyRelations.some((entry) => entry.path === "docs/designs/0001-checkout-flow.md" && entry.field === "verified-by"));
  assert.ok(plan.inventory.legacyRelations.some((entry) => entry.path === "docs/test-specs/0001-checkout-test.md" && entry.field === "verifies"));
});

test("input files and inputHash cover every inventoried artifact", () => {
  const repo = legacyCorpusRepo();
  const plan = buildMigrationPlan(repo);
  const expected = [
    "docs/specs/0001-checkout.md",
    "docs/specs/README.md",
    "docs/designs/0001-checkout-flow.md",
    "docs/designs/overview.md",
    "docs/discovery/0001-research.md",
    "docs/adr/0001-use-pgsql.md",
    "docs/test-specs/0001-checkout-test.md",
    "docs/plans/0001-checkout-plan.md",
    "docs/tasks/0001-schema.md",
    "docs/tasks/0002-api.md",
    "docs/tasks/README.md",
    "docs/impl/ir/0001-checkout-impl.md",
    "docs/impl/exp/0001-pooling.jsonl",
    "docs/.doc-driven-dev/graph-state.json",
    ".apm/state/doc-driven-dev/runs.json",
    ".apm/state/doc-driven-dev/runs/RUN-active-one/manifest.json",
    ".apm/state/doc-driven-dev/runs/RUN-done/manifest.json",
  ];
  for (const rel of expected) {
    assert.ok(plan.inventory.inputFiles.includes(rel), `${rel} missing from inputFiles`);
  }
  // Deterministic order-independent hash over per-file digests.
  const recomputed = crypto.createHash("sha256")
    .update(plan.inventory.inputFiles.map((rel) => `${rel}:${sha256(fs.readFileSync(path.join(repo, rel), "utf8"))}`).join("\n"))
    .digest("hex");
  assert.equal(plan.inventory.inputHash, recomputed);
});

// --- conversions -------------------------------------------------------------

test("plan/task corpus converts into one run snapshot", () => {
  const plan = buildMigrationPlan(legacyCorpusRepo());
  const runWrites = plan.migration.plannedWrites.filter((write) => write.kind === "run-manifest" && write.source === "docs/plans/0001-checkout-plan.md");
  assert.equal(runWrites.length, 1, `expected exactly one plan-anchored migrated run, got ${JSON.stringify(runWrites)}`);
  const runId = (runWrites[0].target.match(/runs\/([^/]+)\/manifest\.json/) ?? [])[1];
  assert.ok(runId, "run manifest write must name the run id");
  const taskWrites = plan.migration.plannedWrites.filter((write) => write.kind === "task-record");
  assert.deepEqual(taskWrites.map((write) => write.target).sort(), [
    `.apm/state/doc-driven-dev/runs/${runId}/tasks/TASK-0001.json`,
    `.apm/state/doc-driven-dev/runs/${runId}/tasks/TASK-0002.json`,
  ].sort());
  const planWrite = plan.migration.plannedWrites.find((write) => write.kind === "run-plan");
  assert.equal(planWrite?.target, `.apm/state/doc-driven-dev/runs/${runId}/plan.md`);
  // Task DAG: TASK-0002 depends on TASK-0001 inside the same run.
  const dag = plan.migration.convertibles.find((item) => item.kind === "task-depends-on" && item.path === "docs/tasks/0002-api.md");
  assert.deepEqual(dag?.targets, ["TASK-0001"]);
  // Old approval is never fabricated.
  const approval = plan.migration.semanticDecisions.find((decision) => decision.kind === "run-approval" && decision.path === "docs/plans/0001-checkout-plan.md");
  assert.ok(approval, "approved/in-progress plans must surface a run-approval decision");
});

test("test-spec converts to a Verification Design preserving intent", () => {
  const plan = buildMigrationPlan(legacyCorpusRepo());
  const write = plan.migration.plannedWrites.find((entry) => entry.kind === "durable-document" && entry.source === "docs/test-specs/0001-checkout-test.md");
  assert.equal(write?.target, "docs/verification/0001-checkout-test.md");
  // TSPEC-0001 keeps its numeric identity under the VD prefix.
  const idRow = plan.migration.destinations.find((row) => row.source === "docs/test-specs/0001-checkout-test.md" && row.element === "id");
  assert.equal(idRow?.target, "VD-0001");
  // Guarantees/Rules/Examples are preserved into the VD body and each needs a
  // check binding — never silently converted into checks.
  const bodyRow = plan.migration.destinations.find((row) => row.source === "docs/test-specs/0001-checkout-test.md" && row.element === "body");
  assert.match(bodyRow?.target ?? "", /verification/);
  const bindings = plan.migration.semanticDecisions.filter((decision) => decision.kind === "check-binding" && decision.path === "docs/test-specs/0001-checkout-test.md");
  assert.ok(bindings.length >= 1, "test-spec verifies/guarantees must need explicit check bindings");
});

test("impl and exp classify into durable/diagnostic destinations", () => {
  const plan = buildMigrationPlan(legacyCorpusRepo());
  const ir = plan.migration.semanticDecisions.find((decision) => decision.kind === "ir-classification" && decision.path === "docs/impl/ir/0001-checkout-impl.md");
  assert.ok(ir, "impl records need a classification decision");
  assert.ok(ir?.candidates.includes("knowledge"));
  // The IR body is never dropped: it converts to a knowledge document.
  const irWrite = plan.migration.plannedWrites.find((write) => write.source === "docs/impl/ir/0001-checkout-impl.md" && write.kind === "durable-document");
  assert.equal(irWrite?.target, "docs/knowledge/0001-checkout-impl.md");
  // Validation prose is never fabricated into verified Evidence.
  const evidence = plan.migration.semanticDecisions.filter((decision) => decision.kind === "evidence-admission");
  assert.ok(evidence.length >= 1, "IR validation content is an evidence candidate requiring admission");
  // The EXP log is never durable evidence: diagnostic trace or explicit classification.
  const expRow = plan.migration.destinations.find((row) => row.source === "docs/impl/exp/0001-pooling.jsonl" && row.element === "file");
  assert.match(expRow?.target ?? "", /run_trace\.jsonl|decision:/);
  assert.ok(!plan.migration.plannedWrites.some((write) => write.target.includes("/evidence/") || write.kind === "evidence-record"), "no evidence records may be fabricated");
});

test("caller bookkeeping converts to run receipts, checkpoints, and trace", () => {
  const plan = buildMigrationPlan(legacyCorpusRepo());
  const runWrite = plan.migration.plannedWrites.find((write) => write.kind === "run-manifest" && write.source === "docs/plans/0001-checkout-plan.md");
  const runId = (runWrite?.target.match(/runs\/([^/]+)\/manifest\.json/) ?? [])[1];
  const receipt = plan.migration.plannedWrites.find((write) => write.kind === "receipt-record");
  assert.match(receipt?.target ?? "", new RegExp(`runs/${runId}/receipts/`));
  const checkpoint = plan.migration.plannedWrites.find((write) => write.kind === "checkpoint-record");
  assert.match(checkpoint?.target ?? "", new RegExp(`runs/${runId}/checkpoints/`));
  // Yield outcomes are diagnostics, never receipts.
  assert.ok(plan.migration.plannedWrites.some((write) => write.kind === "run-trace" && write.target === `.apm/state/doc-driven-dev/runs/${runId}/run_trace.jsonl`));
});

test("legacy relations become semantic decisions, never mechanical rewrites", () => {
  const plan = buildMigrationPlan(legacyCorpusRepo());
  const derives = plan.migration.semanticDecisions.filter((decision) => decision.kind === "legacy-relation" && decision.field === "derives-from");
  assert.equal(derives.length, 1);
  assert.deepEqual(derives[0].targets, ["docs/discovery/0001-research.md"]);
  // v1 relations already conform: kept, not decisions.
  assert.ok(!plan.migration.semanticDecisions.some((decision) => decision.kind === "legacy-relation" && decision.field === "realizes"));
  assert.ok(plan.migration.convertibles.some((item) => item.kind === "preserve-relation" && item.field === "realizes"));
  // source is provenance, exempt.
  assert.ok(!plan.migration.semanticDecisions.some((decision) => decision.kind === "legacy-relation" && decision.field === "source"));
});

test("indexes report managed vs hand-curated destinations", () => {
  const plan = buildMigrationPlan(legacyCorpusRepo());
  const generated = plan.inventory.indexes.find((index) => index.path === "docs/specs/README.md");
  assert.equal(generated?.generated, true);
  assert.equal(generated?.disposition, "regenerate");
  const curated = plan.inventory.indexes.find((index) => index.path === "docs/tasks/README.md");
  assert.equal(curated?.generated, false);
  assert.equal(curated?.disposition, "decision");
  assert.ok(plan.migration.semanticDecisions.some((decision) => decision.kind === "hand-curated-index" && decision.path === "docs/tasks/README.md"));
});

// --- lifecycle / status / field destinations ---------------------------------

test("old status to lifecycle is decided at migration, never guessed", () => {
  const plan = buildMigrationPlan(legacyCorpusRepo());
  const spec = plan.migration.destinations.filter((row) => row.source === "docs/specs/0001-checkout.md");
  const lifecycleRow = spec.find((row) => row.element === "frontmatter.lifecycle");
  assert.ok(lifecycleRow, "every durable doc reports a lifecycle destination");
  const lifecycle = plan.migration.semanticDecisions.find((decision) => decision.kind === "lifecycle-assignment" && decision.path === "docs/specs/0001-checkout.md");
  assert.ok(lifecycle, "missing lifecycle is an explicit resolution input");
  // Every front-matter field has a destination row.
  for (const element of ["frontmatter.type", "frontmatter.status", "frontmatter.title", "frontmatter.created", "frontmatter.updated", "frontmatter.owners", "frontmatter.relations", "id", "body", "file", "filename"]) {
    assert.ok(spec.some((row) => row.element === element), `spec is missing a destination row for ${element}`);
  }
  const ambiguous = plan.migration.semanticDecisions.filter((decision) => decision.kind === "lifecycle-assignment");
  assert.ok(ambiguous.length >= 1);
  assert.ok(ambiguous.every((decision) => decision.candidates.length >= 2));
});

// --- run handoff --------------------------------------------------------------

test("active runs require an explicit handoff method", () => {
  const plan = buildMigrationPlan(legacyCorpusRepo());
  const handoffs = plan.migration.runHandoffs.filter((entry) => entry.origin === "existing" && entry.handoffRequired);
  assert.deepEqual(handoffs.map((entry) => entry.runId).sort(), ["RUN-active-one", "RUN-active-two"]);
  for (const handoff of handoffs) {
    assert.ok(handoff.methods.some((method) => /export|portable snapshot/i.test(method)), "handoff must offer a portable snapshot");
    assert.ok(handoff.methods.some((method) => /finaliz|terminat/i.test(method)), "handoff must offer an explicit termination");
  }
  // Finalized runs need no handoff.
  assert.ok(!handoffs.some((entry) => entry.runId === "RUN-done"));
  // The migrated run is also active state that does not auto-share.
  assert.ok(plan.migration.runHandoffs.some((entry) => entry.origin === "migrated" && entry.handoffRequired));
});

// --- collisions, ambiguity, foreign state ------------------------------------

test("target collisions are reported with deterministic alternates", () => {
  const repo = legacyCorpusRepo();
  writeDoc(repo, "docs/verification/0001-checkout-test.md", v3Doc({ id: "VD-0099", type: "verification", title: "Existing" }), "# Existing\n");
  const plan = buildMigrationPlan(repo);
  const collision = plan.migration.collisions.find((entry) => entry.target === "docs/verification/0001-checkout-test.md");
  assert.ok(collision, "an existing verification doc at the mapped target is a collision");
  assert.ok(collision?.suggestedTarget && collision.suggestedTarget !== collision.target);
  assert.equal(plan.migration.status, "blocked");
});

test("ambiguous statuses and unresolvable dependencies are blockers, not guesses", () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/plans/0001-plan.md", baseDoc({ id: "PLAN-0001", type: "plan", status: "superseded" }));
  writeDoc(repo, "docs/tasks/0001-task.md", baseDoc({
    id: "TASK-0001", type: "task", status: "half-baked",
    relations: { implements: ["docs/plans/0001-plan.md"], "depends-on": ["docs/tasks/0099-missing.md"] },
  }));
  const plan = buildMigrationPlan(repo);
  assert.ok(plan.migration.semanticDecisions.some((decision) => decision.kind === "run-status" && decision.path === "docs/plans/0001-plan.md"));
  assert.ok(plan.migration.semanticDecisions.some((decision) => decision.kind === "status-mapping" && decision.path === "docs/tasks/0001-task.md"));
  assert.ok(plan.migration.semanticDecisions.some((decision) => decision.kind === "depends-on-resolution" && decision.path === "docs/tasks/0001-task.md"));
  assert.equal(plan.migration.status, "awaiting-resolution");
});

test("unparseable front matter and unknown types are decisions, not skipped", () => {
  const repo = tempRepo();
  writeFile(repo, "docs/tasks/0001-bad.md", '---\ntitle: "unclosed\n---\n# bad\n');
  writeDoc(repo, "docs/specs/0001-weird.md", baseDoc({ id: "SPEC-0001", type: "mystery" }));
  const plan = buildMigrationPlan(repo);
  assert.ok(plan.migration.semanticDecisions.some((decision) => decision.kind === "unparseable-frontmatter" && decision.path === "docs/tasks/0001-bad.md"));
  assert.ok(plan.migration.semanticDecisions.some((decision) => decision.kind === "unknown-type" && decision.path === "docs/specs/0001-weird.md"));
});

test("untyped docs in migration-owned dirs are decisions; in durable dirs, out of scope", () => {
  const repo = tempRepo();
  writeFile(repo, "docs/tasks/0001-note.md", "# loose note\n");
  writeFile(repo, "docs/specs/0001-note.md", "# loose note\n");
  const plan = buildMigrationPlan(repo);
  assert.ok(plan.migration.semanticDecisions.some((decision) => decision.kind === "untyped-legacy-doc" && decision.path === "docs/tasks/0001-note.md"));
  assert.ok(plan.migration.outOfScope.some((item) => item.path === "docs/specs/0001-note.md"));
});

test("foreign state gets an explicit disposition", () => {
  const plan = buildMigrationPlan(legacyCorpusRepo());
  assert.ok(plan.migration.semanticDecisions.some((decision) => decision.kind === "foreign-state-disposition" && decision.path === ".apm/state/doc-driven-dev/runs.json"));
  assert.ok(plan.migration.outOfScope.some((item) => item.path === "docs/.doc-driven-dev/graph-state.json"));
});

// --- safety ------------------------------------------------------------------

test("migrate plan writes nothing: zero byte-diff across the whole tree", () => {
  const repo = legacyCorpusRepo();
  writeManifest(repo);
  const before = snapshotTree(repo);
  buildMigrationPlan(repo);
  assert.equal(snapshotTree(repo), before, "buildMigrationPlan must not modify the tree");
  const viaCli = runMigratePlan(repo);
  assert.equal(snapshotTree(repo), before, "CLI migrate plan must not modify the tree");
  assert.equal(viaCli.plan.planHash, buildMigrationPlan(repo).plan.planHash);
});

test("planHash is deterministic and locale/order independent", () => {
  const first = buildMigrationPlan(legacyCorpusRepo());
  const second = buildMigrationPlan(legacyCorpusRepo());
  assert.equal(first.plan.planHash, second.plan.planHash);
  assert.equal(first.inventory.inputHash, second.inventory.inputHash);
  // Every emitted collection must be deterministically ordered.
  const sorted = (values: string[]) => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(first.inventory.inputFiles, sorted(first.inventory.inputFiles));
  const decisionIds = first.migration.semanticDecisions.map((decision) => decision.decisionId);
  assert.deepEqual(decisionIds, sorted(decisionIds));
  const writeTargets = first.migration.plannedWrites.map((write) => write.target);
  assert.deepEqual(writeTargets, sorted(writeTargets));
});

test("inventory never follows escaped paths", (t) => {
  const repo = tempRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "migration-outside-"));
  writeFile(outside, "docs/tasks/escaped.md", "id: TASK-0009\ntype: task\n");
  try {
    fs.symlinkSync(outside, path.join(repo, "docs"), "junction");
  } catch (error: unknown) {
    t.skip(`symlink unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const plan = buildMigrationPlan(repo);
  assert.ok(!plan.inventory.inputFiles.some((file) => file.includes("escaped")), "an escaping docs dir is never inventoried");
  assert.ok(plan.inventory.foreignState.some((entry) => entry.kind === "escape" && entry.path === "docs"), "the escaping root is flagged, never followed");
  assert.ok(plan.migration.semanticDecisions.some((decision) => decision.kind === "scope-escape"));
});

test("a symlinked file inside a managed dir is flagged, not followed", (t) => {
  const repo = tempRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "migration-outside-file-"));
  writeFile(outside, "secret.md", "id: TASK-0009\ntype: task\n");
  fs.mkdirSync(path.join(repo, "docs", "tasks"), { recursive: true });
  try {
    fs.symlinkSync(path.join(outside, "secret.md"), path.join(repo, "docs", "tasks", "0001-link.md"));
  } catch (error: unknown) {
    t.skip(`symlink unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const plan = buildMigrationPlan(repo);
  assert.ok(!plan.inventory.documents.some((doc) => doc.id === "TASK-0009"), "escaped content must never be read");
  assert.ok(plan.inventory.foreignState.some((entry) => entry.path === "docs/tasks/0001-link.md" && entry.kind === "escape")
    || plan.migration.semanticDecisions.some((decision) => decision.path === "docs/tasks/0001-link.md"));
});

// --- CLI contract -------------------------------------------------------------

test("migrate plan CLI prints the full deterministic report", () => {
  const repo = legacyCorpusRepo();
  writeManifest(repo);
  const viaCli = runMigratePlan(repo);
  assert.equal(viaCli.command, "migrate plan");
  assert.equal(viaCli.readOnly, true);
  assert.equal(viaCli.plan.classification, "migration");
  assert.equal(viaCli.plan.planHash, buildMigrationPlan(repo).plan.planHash);
  assert.ok(Array.isArray(viaCli.inventory.inputFiles));
  assert.ok(Array.isArray(viaCli.migration.plannedWrites));
  assert.ok(Array.isArray(viaCli.migration.destinations));
  assert.ok(viaCli.migration.resolutionsRequired.length > 0);
  assert.ok(viaCli.migration.residualRisks.length > 0);
});
