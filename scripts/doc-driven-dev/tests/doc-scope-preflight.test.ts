import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { planMaintenance, applyMaintenance } from "../src/skills/lib/doc_maintenance";

const skillsRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-scope-preflight-"));
}

function runScript(skill: string, name: string, args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(skillsRoot, skill, "scripts", name), ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function snapshotTree(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        files.set(
          path.relative(root, full).replace(/\\/g, "/"),
          createHash("sha256").update(fs.readFileSync(full)).digest("hex"),
        );
      }
    }
  };
  walk(root);
  return files;
}

function writeFile(root: string, rel: string, content: string) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function writeImplTree(root: string) {
  writeFile(root, "docs/impl/ir/alpha.md", [
    "---", 'id: "IMPL-0001"', 'type: "impl"', 'status: "in-progress"',
    'title: "Alpha"', 'created: "2026-01-01"', 'updated: "2026-01-01"',
    "owners: []", "relations: {}",
    'metadata:', '  experiments:', '    adopted: []', '    rejected: []',
    "---", "", "# Alpha", "",
  ].join("\n"));
  writeFile(root, "docs/impl/ir/README.md", "# Implementation Records\n\nHand-curated\n");
  writeFile(root, "docs/impl/exp/0001-alpha.jsonl", '{"schema":"experiment_event.v1","experiment":"docs/impl/exp/0001-alpha.jsonl","seq":1,"type":"start","ts":"2026-01-01T00:00:00Z"}\n');
  writeFile(root, "docs/impl/exp/README.md", "# Experiment Logs\n\nHand-curated\n");
}

function writeSpecTree(root: string) {
  writeFile(root, "docs/specs/0001-spec.md", [
    "---", 'id: "SPEC-0001"', 'type: "spec"', 'status: "approved"',
    'title: "Spec"', 'created: "2026-01-01"', 'updated: "2026-01-01"',
    "owners: []", "relations: {}",
    "---", "", "# Spec", "",
  ].join("\n"));
  writeFile(root, "docs/specs/README.md", "# SPEC Documents\n\n<!-- doc-suite:generated-index -->\n\nDirectory: `docs/specs`\n\n| ID | Title | Status | File |\n| --- | --- | --- | --- |\n| SPEC-0001 | Spec | approved | [0001-spec.md](./0001-spec.md) |\n");
}

test("maintenance plan/apply reject impl-doc dirs with no actions and no writes", async () => {
  const repo = tempRepo();
  writeImplTree(repo);
  const before = snapshotTree(repo);

  await assert.rejects(planMaintenance(repo, { dir: "docs/impl/ir" }), /Scope mismatch/);
  await assert.rejects(planMaintenance(repo, { dir: "docs/impl/ir" }, { forceIndex: true }), /Scope mismatch/);
  await assert.rejects(planMaintenance(repo, { type: "spec", dir: "docs/impl/ir" }), /Scope mismatch/);
  await assert.rejects(planMaintenance(repo, { dir: "docs/impl/exp" }), /Scope mismatch/);
  await assert.rejects(planMaintenance(repo, { dir: "docs/impl" }), /Scope mismatch/);
  await assert.rejects(applyMaintenance(repo, { dir: "docs/impl/ir" }), /Scope mismatch/);

  assert.deepEqual(snapshotTree(repo), before, "rejected scope must leave every file byte-identical");
});

test("doc_status lint/audit/health report scope errors instead of linting foreign docs", () => {
  const repo = tempRepo();
  writeImplTree(repo);
  for (const command of ["lint", "audit", "health"]) {
    const result = runScript("doc-status", "doc_status.js", [command, "--type", "spec", "--dir", "docs/impl/ir"], repo);
    assert.notEqual(result.status, 0, `${command} must fail`);
    assert.match(`${result.stdout}\n${result.stderr}`, /Scope mismatch/, command);
  }
  // NOTE: list_docs.js calls docEntries() directly (not listDocuments), so
  // its scope rejection lands via the docDir boundary assert in Task 5 —
  // it is exercised there, not here.
});

test("doc_maintenance CLI rejects foreign scope for plan and apply, JSON and text", () => {
  const repo = tempRepo();
  writeImplTree(repo);
  const before = snapshotTree(repo);
  const plan = runScript("doc-maintenance", "doc_maintenance.js", ["plan", "--dir", "docs/impl/ir"], repo);
  assert.notEqual(plan.status, 0);
  assert.match(plan.stderr, /Scope mismatch/);
  const applyJson = runScript("doc-maintenance", "doc_maintenance.js", ["apply", "--dir", "docs/impl/ir", "--json"], repo);
  assert.notEqual(applyJson.status, 0);
  const payload = JSON.parse(applyJson.stdout);
  assert.match(payload.error, /Scope mismatch/);
  assert.deepEqual(snapshotTree(repo), before);
});

test("read-only audit of a co-resident dir narrows to resident types", () => {
  const repo = tempRepo();
  writeFile(repo, "docs/discovery/alpha.md", [
    "---", 'id: "DISC-0001"', 'type: "discovery"', 'status: "draft"',
    'title: "Alpha"', 'created: "2026-01-01"', 'updated: "2026-01-01"',
    "owners: []", "relations: {}", "---", "", "# Alpha", "",
  ].join("\n"));
  const result = runScript("doc-status", "audit_docs.js", ["--type", "all", "--dir", "docs/discovery", "--json"], repo);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  for (const finding of report.findings) {
    assert.ok(!/Expected type spec/.test(finding.message), `misdiagnosed as spec: ${finding.message}`);
  }
});

test("legitimate scopes still work: shared dir, shared repair, custom dir", async () => {
  const repo = tempRepo();
  writeSpecTree(repo);
  // canonical maintenance scope stays functional
  const { plan } = await planMaintenance(repo, { type: "spec" });
  assert.ok(plan.actions.length >= 0); // must not throw
  const status = runScript("doc-status", "doc_status.js", ["lint", "--type", "spec", "--dir", "docs/specs"], repo);
  assert.equal(status.status, 0, status.stderr);
  // custom dir stays open to shared-type inspection
  const custom = runScript("doc-status", "list_docs.js", ["--type", "spec", "--dir", "custom/specs"], repo);
  assert.equal(custom.status, 0, custom.stderr);
});
