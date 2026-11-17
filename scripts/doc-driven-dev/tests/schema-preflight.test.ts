import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import test from "node:test";
import { evaluateSchemaPreflight } from "../src/skills/lib/schema_preflight";

// Schema Manifest v1 + shared Migration Preflight (Issue #233).
//
// These tests pin the observable contract: the six preflight statuses, the
// machine-readable refusal every guarded entrypoint emits, the only
// authorized migration surface (`doc_maintenance migrate plan|apply|
// recovery`), and read-only behavior on every non-mutating path.

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
  return fs.mkdtempSync(path.join(os.tmpdir(), "schema-preflight-"));
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

function runNode(script: string, args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", windowsHide: true });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function runScript(skill: string, name: string, args: string[], cwd: string) {
  return runNode(path.join(skillRoot, skill, "scripts", name), args, cwd);
}

function migratePlan(repo: string) {
  const result = runNode(maintenanceScript, ["migrate", "plan", "--cwd", repo], repo);
  assert.equal(result.status, 0, `migrate plan should exit 0: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function snapshotTree(root: string): string {
  const entries: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      if (entry.isDirectory()) walk(abs);
      else entries.push(`${rel}:${fs.statSync(abs).size}`);
    }
  };
  walk(root);
  return entries.join("\n");
}

// --- fixture factories ------------------------------------------------------

function canonicalPlanRepo() {
  const repo = tempRepo();
  writeDoc(repo, "docs/plans/0001-plan.md", { id: "PLAN-0001", type: "plan", status: "approved", title: "P" });
  writeDoc(repo, "docs/tasks/0001-task.md", {
    id: "TASK-0001", type: "task", status: "todo", title: "T",
    relations: { implements: ["docs/plans/0001-plan.md"] },
  });
  return repo;
}

function durableOnlyRepo() {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-spec.md", { id: "SPEC-0001", type: "spec", status: "approved", title: "S" });
  writeDoc(repo, "docs/adr/0001-adr.md", { id: "ADR-0001", type: "adr", status: "accepted", title: "A" });
  return repo;
}

// --- status classification --------------------------------------------------

test("preflight: completely new repository is uninitialized", () => {
  const plan = migratePlan(tempRepo());
  assert.equal(plan.preflight.status, "uninitialized");
  assert.equal(plan.preflight.manifest.state, "missing");
});

test("preflight: canonical docs without a manifest are uninitialized, not legacy", () => {
  const plan = migratePlan(canonicalPlanRepo());
  assert.equal(plan.preflight.status, "uninitialized");
  assert.equal(plan.preflight.detected.executionDocs, 2);
});

test("preflight: raw fm-less markdown in doc dirs stays uninitialized", () => {
  // Plans, evidence notes, and other typeless Markdown are first-class
  // managed shapes — nothing about them is provably pre-registry.
  const repo = tempRepo();
  writeFile(repo, "docs/plans/0001-plan.md", "# Plan\n");
  writeFile(repo, "docs/impl/0001-evidence.md", "# Evidence\n");
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "uninitialized");
  assert.equal(plan.preflight.detected.unmanagedDocs, 2);
});

test("preflight: foreign file inside docs/.doc-driven-dev is migration-required", () => {
  const repo = tempRepo();
  writeFile(repo, "docs/.doc-driven-dev/graph-state.json", "{}");
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "migration-required");
  assert.ok(plan.preflight.issues.some((i: any) => i.reason === "legacy-state-file"));
});

test("preflight: legacy graph YAML inside docs/.doc-driven-dev is migration-required", () => {
  const repo = tempRepo();
  writeFile(repo, "docs/.doc-driven-dev/graph.yaml", "schemaVersion: 2\nnodes: {}\nedges: []\n");
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "migration-required");
  assert.ok(plan.preflight.issues.some((i: any) => i.reason === "legacy-graph-state"));
});

test("preflight: malformed relations shape is lint-domain until a manifest declares currency", () => {
  const writeSpec = (repo: string): void =>
    writeDoc(repo, "docs/specs/0001-spec.md", { id: "SPEC-0001", type: "spec", status: "draft", title: "S", relations: "depends-on-other" });
  const unmanifested = tempRepo();
  writeSpec(unmanifested);
  assert.equal(migratePlan(unmanifested).preflight.status, "uninitialized");

  const manifested = tempRepo();
  writeSpec(manifested);
  writeManifest(manifested);
  const plan = migratePlan(manifested);
  assert.equal(plan.preflight.status, "migration-required");
  assert.ok(plan.preflight.issues.some((i: any) => i.reason === "legacy-relations"));
});

test("preflight: foreign execution state under .apm/state is migration-required", () => {
  const repo = tempRepo();
  writeFile(repo, ".apm/state/doc-driven-dev/runs.json", "[]");
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "migration-required");
  assert.ok(plan.preflight.issues.some((i: any) => i.reason === "legacy-execution-state"));
});

test("preflight: valid manifest plus durable-only docs is current", () => {
  const repo = durableOnlyRepo();
  writeManifest(repo);
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "current");
  assert.equal(plan.preflight.manifest.state, "valid");
  assert.deepEqual(plan.preflight.manifest.declared, MANIFEST);
});

test("preflight: hand-raised manifest over execution docs is migration-required", () => {
  const repo = canonicalPlanRepo();
  writeManifest(repo);
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "migration-required");
  assert.ok(plan.preflight.issues.some((i: any) => i.reason === "legacy-execution-doc" && i.path === "docs/plans/0001-plan.md"));
  assert.ok(plan.preflight.issues.some((i: any) => i.reason === "legacy-execution-doc" && i.path === "docs/tasks/0001-task.md"));
});

test("preflight: populated non-v1 relation fields under a manifest are migration-required", () => {
  const repo = durableOnlyRepo();
  writeDoc(repo, "docs/designs/0001-design.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "D",
    relations: { "derives-from": ["SPEC-0001"], "verified-by": ["TSPEC-0001"] },
  });
  writeManifest(repo);
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "migration-required");
  const keys = plan.preflight.issues.filter((i: any) => i.reason === "legacy-relations").map((i: any) => i.detail).join(" ");
  assert.ok(keys.includes("derives-from"));
  assert.ok(keys.includes("verified-by"));
});

test("preflight: newer manifest schemaVersion is unsupported-version", () => {
  const repo = tempRepo();
  writeManifest(repo, { ...MANIFEST, schemaVersion: 2 });
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "unsupported-version");
  assert.ok(plan.preflight.issues.some((i: any) => i.reason === "schema-version-unsupported"));
});

test("preflight: newer component version is unsupported-version", () => {
  const repo = tempRepo();
  writeManifest(repo, { ...MANIFEST, documentRegistry: 4 });
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "unsupported-version");
  assert.ok(plan.preflight.issues.some((i: any) => i.reason === "component-version-unsupported" && i.detail.includes("documentRegistry")));
});

test("preflight: older declared component version is migration-required", () => {
  const repo = durableOnlyRepo();
  writeManifest(repo, { ...MANIFEST, documentRegistry: 2 });
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "migration-required");
  assert.ok(plan.preflight.issues.some((i: any) => i.reason === "component-version-behind" && i.detail.includes("documentRegistry")));
});

test("preflight: malformed manifest JSON is invalid", () => {
  const repo = tempRepo();
  writeManifest(repo, "{ not json");
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "invalid");
  assert.ok(plan.preflight.issues.some((i: any) => i.reason === "manifest-malformed"));
});

test("preflight: manifest missing a component is invalid", () => {
  const repo = tempRepo();
  const { graphDefinition, ...missing } = MANIFEST;
  writeManifest(repo, missing);
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "invalid");
  assert.ok(plan.preflight.issues.some((i: any) => i.reason === "manifest-malformed" && i.detail.includes("graphDefinition")));
});

test("preflight: migration journal without manifest is migration-incomplete", () => {
  const repo = tempRepo();
  writeFile(repo, "docs/.doc-driven-dev/migration.journal.json", "{}");
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "migration-incomplete");
  assert.ok(plan.preflight.issues.some((i: any) => i.reason === "migration-journal-present"));
});

test("preflight: manifest migration marker is migration-incomplete", () => {
  const repo = durableOnlyRepo();
  writeManifest(repo, { ...MANIFEST, migration: { status: "in-progress" } });
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "migration-incomplete");
  assert.ok(plan.preflight.issues.some((i: any) => i.reason === "manifest-migration-in-progress"));
});

test("preflight: symlinked docs dir escaping the checkout is invalid", (t) => {
  const repo = tempRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-outside-"));
  writeFile(outside, "plans/x.md", "# x\n");
  try {
    fs.symlinkSync(outside, path.join(repo, "docs"), "junction");
  } catch (error: unknown) {
    t.skip(`symlink unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  writeManifest(repo);
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "invalid");
  assert.ok(plan.preflight.issues.some((i: any) => i.reason === "scope-escape" || i.reason === "manifest-escaped" || i.reason === "manifest-malformed"));
});

// --- the entrypoint guard ---------------------------------------------------
//
// Every normal entrypoint must stop on a non-current repository with the
// machine-readable refusal. The table enumerates the full surface; each row
// carries the minimal args that reach the guard (argument validation that
// precedes it stays untouched).

const GUARDED_ENTRYPOINTS: Array<{ skill: string; script: string; args: string[] }> = [
  { skill: "doc-driven-dev-graph", script: "route_graph.js", args: ["--json"] },
  { skill: "doc-driven-dev-graph", script: "inspect_graph.js", args: [] },
  { skill: "doc-driven-dev-graph", script: "fetch_context.js", args: ["--metadata"] },
  { skill: "doc-driven-dev-graph", script: "build_task_graph.js", args: ["--plan", "docs/plans/0001-plan.md"] },
  { skill: "doc-driven-dev-graph", script: "build_dashboard.js", args: [] },
  { skill: "doc-driven-dev-graph", script: "execution_store.js", args: ["list"] },
  { skill: "doc-driven-dev-graph", script: "migrate_docs.js", args: [] },
  { skill: "doc-driven-dev-graph", script: "migrate_ids.js", args: [] },
  { skill: "doc-driven-dev-graph", script: "scaffold_docs.js", args: [] },
  { skill: "doc-maintenance", script: "doc_maintenance.js", args: ["plan"] },
  { skill: "doc-maintenance", script: "doc_maintenance.js", args: ["apply"] },
  { skill: "doc-maintenance", script: "doc_maintenance.js", args: ["index", "plan"] },
  { skill: "doc-maintenance", script: "migrate_docs.js", args: [] },
  { skill: "doc-maintenance", script: "migrate_ids.js", args: [] },
  { skill: "doc-maintenance", script: "scaffold_docs.js", args: [] },
  { skill: "doc-maintenance", script: "promote_index.js", args: [] },
  { skill: "doc-status", script: "doc_status.js", args: ["list"] },
  { skill: "doc-status", script: "doc_status.js", args: ["lint"] },
  { skill: "doc-status", script: "doc_status.js", args: ["health"] },
  { skill: "doc-status", script: "audit_docs.js", args: ["--type", "spec"] },
  { skill: "doc-status", script: "list_docs.js", args: ["--type", "spec"] },
  { skill: "adr-doc", script: "audit_adr.js", args: [] },
  { skill: "adr-doc", script: "check_code_links.js", args: [] },
  { skill: "adr-doc", script: "list_adrs.js", args: [] },
  { skill: "adr-doc", script: "migrate_report.js", args: [] },
  { skill: "adr-doc", script: "new_adr.js", args: ["--title", "Decision"] },
  { skill: "adr-doc", script: "relate_adr.js", args: ["--from", "a.md", "--to", "b.md", "--relation", "supersedes"] },
  { skill: "adr-doc", script: "review_adr.js", args: [] },
  { skill: "adr-doc", script: "update_index.js", args: [] },
  { skill: "briefing-flow", script: "audit_briefing.js", args: ["--spec", "SPEC-0001", "--adr", "ADR-0001"] },
  { skill: "design-doc", script: "new_design.js", args: ["--title", "D"] },
  { skill: "discovery-doc", script: "new_discovery.js", args: ["--title", "D"] },
  { skill: "idea-doc", script: "new_idea.js", args: ["--title", "I"] },
  { skill: "impl-doc", script: "append_experiment_event.js", args: ["--file", "docs/impl/exp/x.jsonl", "--type", "observation"] },
  { skill: "impl-doc", script: "audit_experiment_log.js", args: [] },
  { skill: "impl-doc", script: "audit_impl_record.js", args: [] },
  { skill: "impl-doc", script: "edit_experiment_log.js", args: ["--file", "docs/impl/exp/x.jsonl", "--seq", "1", "--set", "k=v"] },
  { skill: "impl-doc", script: "new_experiment_log.js", args: ["--title", "E"] },
  { skill: "impl-doc", script: "new_impl_record.js", args: ["--title", "IR"] },
  { skill: "impl-doc", script: "sync_impl_index.js", args: ["--kind", "ir"] },
  { skill: "implementation-flow", script: "check_parallel.js", args: [] },
  { skill: "plan-doc", script: "new_plan.js", args: ["--title", "P"] },
  { skill: "spec-doc", script: "new_spec.js", args: ["--title", "S"] },
  { skill: "task-doc", script: "new_task.js", args: ["--title", "T"] },
  { skill: "test-spec-doc", script: "new_test_spec.js", args: ["--title", "TS"] },
];

test("guard: every normal entrypoint fails closed with a machine-readable refusal on migration-required", () => {
  const repo = canonicalPlanRepo();
  writeManifest(repo);
  const before = snapshotTree(repo);
  const failures: string[] = [];
  for (const entry of GUARDED_ENTRYPOINTS) {
    const result = runScript(entry.skill, entry.script, [...entry.args, "--cwd", repo], repo);
    const label = `${entry.skill}/${entry.script} ${entry.args.join(" ")}`;
    if (result.status !== 2) {
      failures.push(`${label}: exit ${result.status} (expected 2) — stdout: ${result.stdout.slice(0, 200)}`);
      continue;
    }
    let payload: any;
    try {
      payload = JSON.parse(result.stdout);
    } catch {
      failures.push(`${label}: refusal is not JSON: ${result.stdout.slice(0, 200)}`);
      continue;
    }
    if (payload.error !== "schema-preflight-blocked" || payload.preflight?.status !== "migration-required") {
      failures.push(`${label}: unexpected payload ${JSON.stringify(payload).slice(0, 200)}`);
    }
    const first = payload.preflight?.issues?.[0];
    if (typeof first?.reason !== "string" || typeof first?.path !== "string") {
      failures.push(`${label}: issues lack reason/path`);
    }
    if (typeof payload.preflight?.recommended?.command !== "string") {
      failures.push(`${label}: recommended command missing`);
    }
  }
  assert.deepEqual(failures, [], `guarded entrypoints did not all fail closed:\n${failures.join("\n")}`);
  assert.equal(snapshotTree(repo), before, "refused entrypoints must not mutate the repository");
});

test("guard: normal entrypoints proceed on an uninitialized repository", () => {
  const repo = canonicalPlanRepo();
  const route = runScript("doc-driven-dev-graph", "route_graph.js", ["--json", "--cwd", repo], repo);
  assert.equal(route.status, 0, `route_graph should proceed: ${route.stderr}`);
  const parsed = JSON.parse(route.stdout);
  assert.equal(parsed.graphId, "doc-driven-dev");
});

test("guard: normal entrypoints proceed on a current repository", () => {
  const repo = durableOnlyRepo();
  writeManifest(repo);
  const status = runScript("doc-status", "doc_status.js", ["health", "--cwd", repo], repo);
  assert.equal(status.status, 0, `doc_status should proceed: ${status.stderr}\n${status.stdout}`);
  const created = runScript("spec-doc", "new_spec.js", ["--title", "Fresh", "--cwd", repo], repo);
  assert.equal(created.status, 0, `new_spec should proceed: ${created.stderr}`);
});

// --- the authorized migration surface ---------------------------------------

test("migrate plan is read-only and deterministic", () => {
  const repo = canonicalPlanRepo();
  writeManifest(repo);
  const before = snapshotTree(repo);
  const first = migratePlan(repo);
  const second = migratePlan(repo);
  assert.equal(snapshotTree(repo), before);
  assert.equal(first.plan.planHash, second.plan.planHash);
  assert.equal(first.plan.applyEligible, false);
  assert.ok(first.plan.blockers.length > 0);
});

test("migrate apply installs the manifest only on already-consistent content", () => {
  const repo = durableOnlyRepo();
  const applied = runNode(maintenanceScript, ["migrate", "apply", "--cwd", repo], repo);
  assert.equal(applied.status, 0, applied.stdout);
  const payload = JSON.parse(applied.stdout);
  assert.equal(payload.applied, true);
  assert.equal(payload.preflight.status, "current");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(repo, "docs/.doc-driven-dev/schema.json"), "utf8")), MANIFEST);

  const again = runNode(maintenanceScript, ["migrate", "apply", "--cwd", repo], repo);
  assert.equal(again.status, 0);
  assert.equal(JSON.parse(again.stdout).applied, false);
});

test("migrate apply refuses on legacy content and writes nothing", () => {
  const repo = canonicalPlanRepo();
  const before = snapshotTree(repo);
  const result = runNode(maintenanceScript, ["migrate", "apply", "--cwd", repo], repo);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.applied, false);
  assert.ok(payload.blockers.length > 0);
  assert.equal(snapshotTree(repo), before);
});

test("migrate apply --expect pins the scanned state and refuses drift", () => {
  const repo = durableOnlyRepo();
  const { plan } = migratePlan(repo);
  const wrong = runNode(maintenanceScript, ["migrate", "apply", "--expect", "deadbeef", "--cwd", repo], repo);
  assert.equal(wrong.status, 1);
  assert.match(JSON.parse(wrong.stdout).reason, /plan hash mismatch/);
  const right = runNode(maintenanceScript, ["migrate", "apply", "--expect", plan.planHash, "--cwd", repo], repo);
  assert.equal(right.status, 0, right.stdout);
  assert.equal(JSON.parse(right.stdout).applied, true);
});

test("migrate recovery reports journal state without mutating it", () => {
  const repo = durableOnlyRepo();
  const clean = runNode(maintenanceScript, ["migrate", "recovery", "--cwd", repo], repo);
  assert.equal(clean.status, 0);
  assert.equal(JSON.parse(clean.stdout).status, "no-migration-in-progress");

  writeFile(repo, "docs/.doc-driven-dev/migration.journal.json", JSON.stringify({ step: "transform" }));
  const before = snapshotTree(repo);
  const result = runNode(maintenanceScript, ["migrate", "recovery", "--cwd", repo], repo);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "migration-incomplete");
  assert.equal(payload.recovered, false);
  assert.equal(snapshotTree(repo), before);
});

// --- scan side effects ------------------------------------------------------
//
// The shared preflight runs ahead of every guarded entrypoint in the same
// process, so its read-only scan must not leave state behind that changes
// what later consumers observe.

test("preflight: scanning unparseable front matter leaves gray-matter's cache clean for later consumers", () => {
  const repo = tempRepo();
  const raw = '---\ntitle: "unclosed\n---\n# bad\n';
  writeFile(repo, "docs/tasks/0002-bad.md", raw);
  const report = evaluateSchemaPreflight(repo);
  assert.equal(report.detected.unmanagedDocs, 1);
  // gray-matter 4.0.3 writes matter.cache[content] BEFORE parsing, so a bare
  // matter() probe that throws would leave a poisoned entry behind — every
  // later bare call for the same content (audit_docs' parseDoc →
  // lintParseErrors, and every `if (document.parseError) continue` guard)
  // then reads an error-free { data: {} } instead of the parse failure.
  const cache = (matter as unknown as { cache: Record<string, unknown> }).cache;
  assert.equal(cache[raw], undefined, "preflight's scan must not populate matter.cache");
  assert.throws(() => matter(raw), "a later consumer must still see the parse error");
});

// --- execution-state layout (#236 shape) -------------------------------------

test("preflight: the declared runs/<run-id>/ layout is not foreign", () => {
  const repo = tempRepo();
  writeFile(repo, ".apm/state/doc-driven-dev/runs/RUN-1/run.manifest.json", `${JSON.stringify({ schemaVersion: 1 })}\n`);
  writeFile(repo, ".apm/state/doc-driven-dev/runs/RUN-1/events.jsonl", "{}\n");
  writeFile(repo, ".apm/state/doc-driven-dev/runs/RUN-1/checkpoints/0001.json", "{}\n");
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "uninitialized");
  assert.equal(
    plan.preflight.issues.filter((i: any) => i.reason === "legacy-execution-state").length,
    0,
    "files inside a run directory are current state, not legacy markers",
  );
});

test("preflight: loose files directly under runs/ are foreign", () => {
  const repo = tempRepo();
  writeFile(repo, ".apm/state/doc-driven-dev/runs/loose-file.txt", "x\n");
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "migration-required");
  assert.ok(plan.preflight.issues.some(
    (i: any) => i.reason === "legacy-execution-state" && i.path === ".apm/state/doc-driven-dev/runs/loose-file.txt",
  ));
});

test("preflight: a run manifest at the wrong schemaVersion inside runs/<run-id>/ is flagged", () => {
  const repo = tempRepo();
  writeFile(repo, ".apm/state/doc-driven-dev/runs/RUN-1/run.manifest.json", `${JSON.stringify({ schemaVersion: 99 })}\n`);
  const plan = migratePlan(repo);
  assert.equal(plan.preflight.status, "migration-required");
  assert.ok(plan.preflight.issues.some(
    (i: any) => i.reason === "legacy-execution-state" && i.path === ".apm/state/doc-driven-dev/runs/RUN-1/run.manifest.json",
  ));
});

// --- write boundary ----------------------------------------------------------

test("migrate apply refuses before writing when docs resolves outside the checkout", (t) => {
  const repo = tempRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-outside-"));
  try {
    fs.symlinkSync(outside, path.join(repo, "docs"), "junction");
  } catch (error: unknown) {
    t.skip(`symlink unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const result = runNode(maintenanceScript, ["migrate", "apply", "--cwd", repo], repo);
  assert.equal(result.status, 1, result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.applied, false);
  assert.match(payload.reason, /outside the checkout/);
  assert.equal(fs.existsSync(path.join(outside, ".doc-driven-dev")), false, "no state may be created outside the checkout");
  assert.equal(fs.existsSync(path.join(outside, "schema.json")), false);
});

test("migrate apply refuses a nonexistent --cwd without creating it", () => {
  const missing = path.join(os.tmpdir(), `ddd-migrate-no-such-${process.pid}-${Date.now()}`);
  const result = runNode(maintenanceScript, ["migrate", "apply", "--cwd", missing], os.tmpdir());
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /does not exist/);
  assert.equal(fs.existsSync(missing), false, "apply must not create the target tree");
});
