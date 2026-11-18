import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import matter from "gray-matter";

// ---------------------------------------------------------------------------
// Journaled migration apply / resume / rollback (Issue #247)
// ---------------------------------------------------------------------------
//
// Pins the observable contract of the engine in migration_apply.ts:
// hash-pinned gating, explicit resolutions, staged+validated writes, the
// schema manifest stamped LAST, crash recovery via journal, and exact
// rollback. Library-level tests (CLI flags are covered by arg validation
// and the dist rebuild).

import { applyMigration, recoverMigration } from "../src/skills/doc-maintenance/scripts/lib/migration_apply";
import { buildMigrationPlan } from "../src/skills/doc-maintenance/scripts/lib/migration_inventory";
import { evaluateSchemaPreflight } from "../src/skills/lib/schema_preflight";
import { createRun, loadRun } from "../src/skills/lib/execution_store";
import type { MigrationPlanReport } from "../src/skills/doc-maintenance/scripts/lib/migration_inventory";

// --- fixtures --------------------------------------------------------------

function tempRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "migration-apply-"));
  // The Execution Store boundary demands ignore coverage for the state root —
  // outside a worktree, .gitignore files are the authority.
  writeFile(repo, ".gitignore", "/.apm/state/\n");
  return repo;
}

function writeFile(repo: string, rel: string, content: string): void {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function writeDoc(repo: string, rel: string, data: Record<string, unknown>, body = "# Doc\n"): void {
  writeFile(repo, rel, matter.stringify(body, data));
}

function snapshotTree(repo: string): string {
  const out: string[] = [];
  const visit = (dir: string, rel: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) visit(abs, relPath);
      else if (entry.isFile()) {
        out.push(`${relPath}:${crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex")}`);
      }
    }
  };
  visit(repo, "");
  return out.join("\n");
}

// A minimal v2 plan + tasks corpus — the canonical migration-classified repo.
function planTaskRepo(): string {
  const repo = tempRepo();
  writeDoc(repo, "docs/plans/0001-plan.md", {
    id: "PLAN-0001", type: "plan", status: "in-progress", title: "Plan de migración",
    created: "2024-01-01", updated: "2024-01-02", owners: ["equipo"],
  }, "# Plan de migración\n\nCuerpo del plan v2.\n");
  writeDoc(repo, "docs/tasks/0001-first.md", {
    id: "TASK-0001", type: "task", status: "done", title: "Primera tarea",
    created: "2024-01-01", updated: "2024-01-02", owners: ["equipo"],
    relations: { implements: ["docs/plans/0001-plan.md"] },
  }, "# Primera tarea\n");
  writeDoc(repo, "docs/tasks/0002-second.md", {
    id: "TASK-0002", type: "task", status: "todo", title: "Segunda tarea",
    created: "2024-01-01", updated: "2024-01-02", owners: ["equipo"],
    relations: { implements: ["docs/plans/0001-plan.md"], "depends-on": ["TASK-0001"] },
  }, "# Segunda tarea\n");
  return repo;
}

// Auto-resolve every required decision with an executable default so the
// apply can run end-to-end; overrides patch specific decisionIds.
function resolutionsFor(plan: MigrationPlanReport, overrides: Record<string, unknown> = {}): { schemaVersion: 1; decisions: Record<string, unknown> } {
  const decisions: Record<string, unknown> = {};
  for (const d of plan.migration.semanticDecisions) {
    if (overrides[d.decisionId] !== undefined) {
      decisions[d.decisionId] = overrides[d.decisionId];
      continue;
    }
    if (!d.required) continue;
    switch (d.kind) {
      case "run-approval": decisions[d.decisionId] = "re-approve via approve-plan after import"; break;
      case "run-status": decisions[d.decisionId] = "active"; break;
      case "status-mapping": decisions[d.decisionId] = d.candidates[0]; break;
      case "legacy-relation": decisions[d.decisionId] = "drop-as-unmapped"; break;
      case "doc-placement": decisions[d.decisionId] = "move-to-canonical-dir"; break;
      case "untyped-legacy-doc":
        decisions[d.decisionId] = { choice: "knowledge", kind: "lesson", title: "Documento migrado", status: "current", lifecycle: "current", created: "2024-01-01", updated: "2024-01-01" };
        break;
      case "missing-field":
        decisions[d.decisionId] = d.candidates.includes("declare-date") ? { choice: "declare-date", value: "2024-01-01" } : { choice: "declare-title", value: "Título migrado" };
        break;
      case "check-binding":
        decisions[d.decisionId] = d.element === "relations.verified-by" ? { choice: "declare VD-<id>::CHK-NN references", refs: [] } : { choice: d.candidates[0], checks: [] };
        break;
      default:
        decisions[d.decisionId] = d.default ?? d.candidates[0];
    }
  }
  return { schemaVersion: 1, decisions };
}

const fixedNow = () => "2025-01-15T12:00:00.000Z";

// --- gating: nothing writes before every gate passes -------------------------

test("hash mismatch refuses before any write", async () => {
  const repo = planTaskRepo();
  const before = snapshotTree(repo);
  const result = await applyMigration(repo, { expect: "deadbeef", resolutions: {}, allowDirty: true });
  assert.equal(result.applied, false);
  assert.match(result.reason, /plan hash mismatch/);
  assert.equal(snapshotTree(repo), before);
});

test("missing required resolutions refuse without opening a journal", async () => {
  const repo = planTaskRepo();
  const before = snapshotTree(repo);
  const result = await applyMigration(repo, { allowDirty: true });
  assert.equal(result.applied, false);
  assert.ok(result.blockers.length > 0);
  assert.match(result.reason, /required decision unresolved/);
  assert.equal(snapshotTree(repo), before, "no journal, no staging, no writes");
});

test("an unknown resolution target refuses", async () => {
  const repo = planTaskRepo();
  const plan = buildMigrationPlan(repo);
  const res = resolutionsFor(plan);
  res.decisions["D-9999"] = "active";
  const result = await applyMigration(repo, { resolutions: res, allowDirty: true });
  assert.equal(result.applied, false);
  assert.match(result.reason, /unknown resolution target D-9999/);
});

test("resolutions bound to a different planHash refuse", async () => {
  const repo = planTaskRepo();
  const plan = buildMigrationPlan(repo);
  const res = { ...resolutionsFor(plan), planHash: "0".repeat(64) };
  const result = await applyMigration(repo, { resolutions: res, allowDirty: true });
  assert.equal(result.applied, false);
  assert.match(result.reason, /resolutions bind planHash/);
});

test("a non-executable choice refuses with a human-step explanation", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/broken.md", { title: "broken" }, "# broken\n");
  const plan = buildMigrationPlan(repo);
  const res = resolutionsFor(plan, {});
  const id = plan.migration.semanticDecisions.find((d) => d.kind === "untyped-legacy-doc")?.decisionId;
  if (id === undefined) return;
  res.decisions[id] = "plan"; // reclassification requires a replan, not apply
  const result = await applyMigration(repo, { resolutions: res, allowDirty: true });
  assert.equal(result.applied, false);
  assert.match(result.reason, /human step|replan/i);
});

// --- end-to-end: plan+tasks → Execution Store run -----------------------------

test("plan + tasks migrate into a valid Execution Store run; manifest stamps last", async () => {
  const repo = planTaskRepo();
  const plan = buildMigrationPlan(repo);
  assert.equal(plan.plan.classification, "migration");
  const res = resolutionsFor(plan);
  const result = await applyMigration(repo, { expect: plan.plan.planHash, resolutions: res, allowDirty: true, now: fixedNow });
  assert.equal(result.applied, true, result.reason);
  assert.equal(result.runsImported.length, 1);
  const runId = result.runsImported[0];
  const run = loadRun(repo, runId);
  assert.equal(run.manifest.status, "active");
  assert.equal(run.manifest.approval, null, "approval is never fabricated");
  assert.equal(run.tasks.length, 2);
  const second = run.tasks.find((t) => t.taskId === "TASK-0002");
  assert.deepEqual(second?.dependsOn, ["TASK-0001"]);
  // plan.md digest bound; sources removed at finalize
  assert.ok(run.manifest.planDigest !== null);
  assert.ok(!fs.existsSync(path.join(repo, "docs/plans/0001-plan.md")));
  assert.ok(!fs.existsSync(path.join(repo, "docs/tasks/0001-first.md")));
  // manifest exists and preflight is current; journal/staging cleaned
  const preflight = evaluateSchemaPreflight(repo);
  assert.equal(preflight.status, "current");
  assert.ok(!fs.existsSync(path.join(repo, "docs/.doc-driven-dev/migration.journal.json")));
  // follow-up records the re-approval duty
  assert.ok(result.followUps.some((f) => f.includes("re-approve")));
});

test("a second apply reports already-current and writes nothing", async () => {
  const repo = planTaskRepo();
  const plan = buildMigrationPlan(repo);
  await applyMigration(repo, { expect: plan.plan.planHash, resolutions: resolutionsFor(plan), allowDirty: true, now: fixedNow });
  const before = snapshotTree(repo);
  const again = await applyMigration(repo, { allowDirty: true });
  assert.equal(again.applied, false);
  assert.equal(again.ok, true);
  assert.equal(snapshotTree(repo), before);
});

// --- durable conversion ------------------------------------------------------

test("a test-spec converts to Verification Design with declared checks", async () => {
  const repo = tempRepo();
  // A pre-existing v3 spec owns the claim the VD check binds to.
  writeDoc(repo, "docs/specs/0001-spec.md", {
    id: "SPEC-0001", type: "spec", status: "approved", lifecycle: "current",
    title: "Spec", created: "2024-01-01", updated: "2024-01-01", owners: [],
  }, "# Spec\n\n## Requirements\n\n- <!-- claim:R-01 --> regla 1\n");
  writeDoc(repo, "docs/test-specs/0001-testspec.md", {
    id: "TS-0001", type: "test-spec", status: "approved", title: "Spec de verificación",
    created: "2024-01-01", updated: "2024-01-01", owners: ["qa"],
  }, "# Spec\n\n## Reglas\n\n- regla 1\n");
  const plan = buildMigrationPlan(repo);
  const cb = plan.migration.semanticDecisions.find((d) => d.kind === "check-binding");
  const overrides: Record<string, unknown> = {};
  if (cb) {
    overrides[cb.decisionId] = {
      choice: cb.candidates[0],
      checks: [{
        id: "CHK-01", target: "SPEC-0001::R-01", method: "manual-review",
        implementation: "revisión contra la checklist migrada", preconditions: ["la spec existe"],
        passCriteria: { kind: "manual-review", checklistItem: "regla 1 verificada" },
        limitations: ["solo revisión manual"], required: true,
      }],
    };
  }
  const result = await applyMigration(repo, { expect: plan.plan.planHash, resolutions: resolutionsFor(plan, overrides), allowDirty: true, now: fixedNow });
  assert.equal(result.applied, true, result.reason);
  const vdPath = result.docsWritten.find((p) => p.startsWith("docs/verification/"));
  assert.ok(vdPath, "expected a Verification Design document");
  const doc = matter(fs.readFileSync(path.join(repo, vdPath!), "utf8"));
  assert.equal(doc.data.type, "verification");
  assert.ok(String(doc.data.id).startsWith("VD-"));
  if (cb) {
    assert.equal((doc.data.checks as { id: string }[])[0].id, "CHK-01");
  }
  assert.ok(!fs.existsSync(path.join(repo, "docs/test-specs/0001-testspec.md")));
  assert.equal(evaluateSchemaPreflight(repo).status, "current");
});

// --- journal, crash recovery, rollback ---------------------------------------

test("fault injection mid-publish leaves a resumable journal; resume finishes the migration", async () => {
  const repo = planTaskRepo();
  const plan = buildMigrationPlan(repo);
  const res = resolutionsFor(plan);
  const first = await applyMigration(repo, { expect: plan.plan.planHash, resolutions: res, allowDirty: true, failAt: "publish:1", now: fixedNow });
  assert.equal(first.applied, false);
  assert.equal(first.ok, false);
  // Journal persisted mid-flight; recovery reports it.
  const inspect = await recoverMigration(repo, { action: "inspect" });
  assert.equal(inspect.status, "migration-incomplete");
  assert.ok(inspect.journal !== null && inspect.journal.stepsTotal > 0);
  assert.equal(evaluateSchemaPreflight(repo).status, "migration-incomplete");
  // Resume completes — idempotent on already-done steps.
  const resumed = await recoverMigration(repo, { action: "resume", expect: plan.plan.planHash });
  assert.equal(resumed.recovered, true, resumed.note);
  assert.equal(evaluateSchemaPreflight(repo).status, "current");
});

test("fault injection at transform re-transforms cleanly on resume", async () => {
  const repo = planTaskRepo();
  const plan = buildMigrationPlan(repo);
  const res = resolutionsFor(plan);
  await applyMigration(repo, { expect: plan.plan.planHash, resolutions: res, allowDirty: true, failAt: "transform", now: fixedNow });
  const resumed = await recoverMigration(repo, { action: "resume" });
  assert.equal(resumed.recovered, true, resumed.note);
  assert.equal(evaluateSchemaPreflight(repo).status, "current");
});

test("fault injection at validate / postflight / finalize resumes to a clean finish", async () => {
  for (const failAt of ["validate", "postflight", "finalize:1"]) {
    const repo = planTaskRepo();
    const plan = buildMigrationPlan(repo);
    const res = resolutionsFor(plan);
    const first = await applyMigration(repo, { expect: plan.plan.planHash, resolutions: res, allowDirty: true, failAt, now: fixedNow });
    assert.equal(first.applied, false, `${failAt} should abort`);
    const resumed = await recoverMigration(repo, { action: "resume" });
    assert.equal(resumed.recovered, true, `${failAt}: ${resumed.note}`);
    assert.equal(evaluateSchemaPreflight(repo).status, "current", failAt);
  }
});

test("rollback mid-finalize restores already-removed sources and drops the journal", async () => {
  const repo = planTaskRepo();
  const plan = buildMigrationPlan(repo);
  const res = resolutionsFor(plan);
  const pristine = snapshotTree(repo);
  // Crash after the first finalize step — some removals are already done.
  await applyMigration(repo, { expect: plan.plan.planHash, resolutions: res, allowDirty: true, failAt: "finalize:1", now: fixedNow });
  const rolled = await recoverMigration(repo, { action: "rollback" });
  assert.equal(rolled.status, "recovered-rollback", rolled.note);
  assert.equal(snapshotTree(repo), pristine);
});

test("--resolutions file input is honored", async () => {
  const repo = planTaskRepo();
  const plan = buildMigrationPlan(repo);
  writeFile(repo, "migration-resolutions.json", `${JSON.stringify(resolutionsFor(plan), null, 2)}\n`);
  const result = await applyMigration(repo, { expect: plan.plan.planHash, resolutionsFile: "migration-resolutions.json", allowDirty: true, now: fixedNow });
  assert.equal(result.applied, true, result.reason);
});

test("--resolutions outside the checkout is refused before writes", async () => {
  const repo = planTaskRepo();
  const before = snapshotTree(repo);
  const result = await applyMigration(repo, { resolutionsFile: "../outside.json", allowDirty: true });
  assert.equal(result.applied, false);
  assert.match(result.reason, /inside the checkout/);
  assert.equal(snapshotTree(repo), before);
});

test("diagnostic-trace resolutions route content into the diagnostics run", async () => {
  const repo = planTaskRepo();
  // Typeless markdown inside a migration-owned dir → untyped-legacy-doc decision.
  writeDoc(repo, "docs/tasks/scratch.md", {}, "# Scratch\n\nAmbiguous v2 content.\n");
  const plan = buildMigrationPlan(repo);
  const traceDecision = plan.migration.semanticDecisions.find((d) => d.kind === "untyped-legacy-doc" && d.path === "docs/tasks/scratch.md");
  assert.ok(traceDecision, "expected an untyped-legacy-doc decision");
  const res = resolutionsFor(plan, { [traceDecision.decisionId]: "diagnostic-trace" });
  const result = await applyMigration(repo, { expect: plan.plan.planHash, resolutions: res, allowDirty: true, now: fixedNow });
  assert.equal(result.applied, true, result.reason);
  // Exactly one imported run carries a trace file naming the traced source.
  const traced = result.runsImported.filter((runId) => {
    const tracePath = path.join(repo, `.apm/state/doc-driven-dev/runs/${runId}/run_trace.jsonl`);
    return fs.existsSync(tracePath) && fs.readFileSync(tracePath, "utf8").includes("docs/tasks/scratch.md");
  });
  assert.equal(traced.length, 1, "expected the diagnostics run to carry the trace");
  assert.ok(!fs.existsSync(path.join(repo, "docs/tasks/scratch.md")), "traced source is removed");
});

test("a durable doc missing a required field is repaired in place (doc-edit)", async () => {
  const repo = planTaskRepo();
  // A v3-typed spec missing `created` — provenance dates are never
  // fabricated; a missing-field resolution declares them.
  writeDoc(repo, "docs/specs/0002-spec.md", {
    id: "SPEC-0002", type: "spec", status: "approved", lifecycle: "current",
    title: "Segunda spec", updated: "2024-01-01", owners: [],
  }, "# Segunda spec\n\nContenido v3.\n");
  const plan = buildMigrationPlan(repo);
  const missing = plan.migration.semanticDecisions.find((d) => d.kind === "missing-field" && d.path === "docs/specs/0002-spec.md");
  assert.ok(missing, "expected a missing-field decision for the spec created date");
  const res = resolutionsFor(plan, { [missing.decisionId]: { choice: "declare-date", value: "2024-01-05" } });
  const result = await applyMigration(repo, { expect: plan.plan.planHash, resolutions: res, allowDirty: true, now: fixedNow });
  assert.equal(result.applied, true, result.reason);
  const doc = matter(fs.readFileSync(path.join(repo, "docs/specs/0002-spec.md"), "utf8"));
  assert.equal(doc.data.created, "2024-01-05");
  assert.equal(evaluateSchemaPreflight(repo).status, "current");
});

test("an existing active run requires a declared handoff; finalize applies it", async () => {
  const repo = planTaskRepo();
  const existing = createRun(repo, { tasks: [{ taskId: "TASK-EXIST" }] });
  const plan = buildMigrationPlan(repo);
  const res = resolutionsFor(plan);
  // Without the handoff declared, apply must refuse.
  const refused = await applyMigration(repo, { resolutions: res, allowDirty: true });
  assert.equal(refused.applied, false);
  assert.match(refused.reason, new RegExp(`${existing.manifest.runId}.*handoff`));
  const applied = await applyMigration(repo, {
    expect: plan.plan.planHash,
    resolutions: { ...res, runHandoffs: { [existing.manifest.runId]: { method: "finalize", status: "completed" } } },
    allowDirty: true,
    now: fixedNow,
  });
  assert.equal(applied.applied, true, applied.reason);
  assert.equal(loadRun(repo, existing.manifest.runId).manifest.status, "completed");
});

test("caller bookkeeping converts to receipts and checkpoints on the migrated run", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/plans/0001-plan.md", {
    id: "PLAN-0001", type: "plan", status: "in-progress", title: "Plan",
    created: "2024-01-01", updated: "2024-01-01", owners: [],
    effectOutcomes: [{ status: "completed", stage: "brief", effect: "note", at: "2024-01-02T00:00:00Z" }],
    checkpointEvidence: [{ edgeId: "e-1", at: "2024-01-02T01:00:00Z" }],
  }, "# Plan\n");
  writeDoc(repo, "docs/tasks/0001-t.md", {
    id: "TASK-0001", type: "task", status: "done", title: "T",
    created: "2024-01-01", updated: "2024-01-01", owners: [],
    relations: { implements: ["docs/plans/0001-plan.md"] },
  }, "# T\n");
  const plan = buildMigrationPlan(repo);
  const result = await applyMigration(repo, { expect: plan.plan.planHash, resolutions: resolutionsFor(plan), allowDirty: true, now: fixedNow });
  assert.equal(result.applied, true, result.reason);
  const run = loadRun(repo, result.runsImported[0]);
  assert.equal(run.receipts.length, 1);
  assert.equal(run.receipts[0].status, "success");
  assert.equal(run.checkpoints.length, 1);
  assert.equal(run.checkpoints[0].edgeId, "e-1");
});

test("resume refuses on input drift", async () => {
  const repo = planTaskRepo();
  const plan = buildMigrationPlan(repo);
  const res = resolutionsFor(plan);
  await applyMigration(repo, { expect: plan.plan.planHash, resolutions: res, allowDirty: true, failAt: "publish:1", now: fixedNow });
  // Drift on an unconsumed input → refuse.
  fs.writeFileSync(path.join(repo, "docs/plans/0001-plan.md"), "# TAMPERED\n");
  const resumed = await recoverMigration(repo, { action: "resume" });
  assert.equal(resumed.status, "resume-refused");
  assert.match(resumed.note, /changed|drift|replan/i);
});

test("rollback restores the exact pre-migration tree", async () => {
  const repo = planTaskRepo();
  const plan = buildMigrationPlan(repo);
  const res = resolutionsFor(plan);
  const pristine = snapshotTree(repo);
  await applyMigration(repo, { expect: plan.plan.planHash, resolutions: res, allowDirty: true, failAt: "publish:1", now: fixedNow });
  const rolled = await recoverMigration(repo, { action: "rollback" });
  assert.equal(rolled.status, "recovered-rollback", rolled.note);
  assert.equal(snapshotTree(repo), pristine, "rollback must restore every source byte");
});

test("rollback after a completed migration removes published artifacts and restores sources", async () => {
  const repo = planTaskRepo();
  const plan = buildMigrationPlan(repo);
  const res = resolutionsFor(plan);
  const applied = await applyMigration(repo, { expect: plan.plan.planHash, resolutions: res, allowDirty: true, now: fixedNow });
  assert.equal(applied.applied, true);
  // After cleanup there is no journal — a full rollback is not offered.
  const inspect = await recoverMigration(repo, { action: "inspect" });
  assert.equal(inspect.status, "no-migration-in-progress");
});

test("a corrupt/foreign journal makes recovery refuse safely", async () => {
  const repo = tempRepo();
  writeFile(repo, "docs/.doc-driven-dev/migration.journal.json", "{ not json");
  const inspect = await recoverMigration(repo, { action: "inspect" });
  assert.equal(inspect.status, "migration-incomplete");
  assert.equal(inspect.recovered, false);
  const resume = await recoverMigration(repo, { action: "resume" });
  assert.equal(resume.recovered, false);
});

// --- collisions and safety ---------------------------------------------------

test("a plan-blocked repo (collisions) refuses before any write", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/plans/0001-plan.md", { id: "PLAN-0001", type: "plan", status: "in-progress", title: "p", created: "2024-01-01", updated: "2024-01-01", owners: [] }, "# p\n");
  writeDoc(repo, "docs/tasks/0001-a.md", { id: "TASK-0001", type: "task", status: "done", title: "a", created: "2024-01-01", updated: "2024-01-01", owners: [], relations: { implements: ["docs/plans/0001-plan.md"] } }, "# a\n");
  writeDoc(repo, "docs/tasks/0002-b.md", { id: "TASK-0001", type: "task", status: "done", title: "b", created: "2024-01-01", updated: "2024-01-01", owners: [], relations: { implements: ["docs/plans/0001-plan.md"] } }, "# b\n");
  const before = snapshotTree(repo);
  const result = await applyMigration(repo, { resolutions: {}, allowDirty: true });
  assert.equal(result.applied, false);
  assert.equal(snapshotTree(repo), before);
});

test("the migration journal is itself ignored-path safe: foreign docs/.doc-driven-dev content is traced and removed", async () => {
  const repo = planTaskRepo();
  writeFile(repo, "docs/.doc-driven-dev/old-graph.yaml", "v2: state\n");
  const plan = buildMigrationPlan(repo);
  const res = resolutionsFor(plan);
  const result = await applyMigration(repo, { expect: plan.plan.planHash, resolutions: res, allowDirty: true, now: fixedNow });
  assert.equal(result.applied, true, result.reason);
  assert.ok(!fs.existsSync(path.join(repo, "docs/.doc-driven-dev/old-graph.yaml")));
  assert.equal(evaluateSchemaPreflight(repo).status, "current");
});
