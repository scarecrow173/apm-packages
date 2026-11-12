import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const maintenanceRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-maintenance");
const adrRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/adr-doc");
const implRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/impl-doc");

const LEGACY: Record<string, string> = {
  "docs/adr": "# ADR Documents\n\nDirectory: `docs/adr`\n",
  "docs/impl/ir": "# Implementation Record Documents\n\nDirectory: `docs/impl/ir`\n",
  "docs/impl/exp": "# Experiment Log Documents\n\nDirectory: `docs/impl/exp`\n",
};

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "promote-index-test-"));
}

function seedLegacy(repo: string, dirs = Object.keys(LEGACY)) {
  for (const dir of dirs) {
    fs.mkdirSync(path.join(repo, dir), { recursive: true });
    fs.writeFileSync(path.join(repo, dir, "README.md"), LEGACY[dir], "utf8");
  }
}

function sha(file: string) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function runScript(root: string, name: string, args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", name), ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const runPromote = (args: string[], cwd: string) => runScript(maintenanceRoot, "promote_index.js", args, cwd);

test("preview reports promotable legacy indexes without writing", () => {
  const repo = tempRepo();
  seedLegacy(repo);
  const before = sha(path.join(repo, "docs/adr/README.md"));

  const result = runPromote(["--cwd", repo], repo);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /docs\/adr\/README\.md/);
  assert.equal(sha(path.join(repo, "docs/adr/README.md")), before, "preview must not write");
});

test("apply promotes only byte-verified legacy indexes to owner format", () => {
  const repo = tempRepo();
  seedLegacy(repo);

  const result = runPromote(["--cwd", repo, "--apply"], repo);

  assert.equal(result.status, 0, result.stderr);
  const adr = fs.readFileSync(path.join(repo, "docs/adr/README.md"), "utf8");
  assert.match(adr, /^# Architecture Decision Records/m);
  assert.ok(adr.includes("doc-suite:generated-index"));
  const exp = fs.readFileSync(path.join(repo, "docs/impl/exp/README.md"), "utf8");
  assert.match(exp, /^# Experiment Logs/m);
  assert.match(exp, /\| File \|/);
  assert.doesNotMatch(exp, /\| Title \|/, "EXP stays one-column");
});

test("index apply appends rows to a promoted index without warnings", () => {
  const repo = tempRepo();
  seedLegacy(repo);
  runPromote(["--cwd", repo, "--apply"], repo);

  const adr = runScript(adrRoot, "new_adr.js", ["--title", "Adopt MADR", "--cwd", repo], repo);
  assert.equal(adr.status, 0, adr.stderr);
  assert.match(adr.stdout, /Index deferred/);
  const ir = runScript(implRoot, "new_impl_record.js", ["--title", "Extract foo", "--cwd", repo], repo);
  assert.equal(ir.status, 0, ir.stderr);
  assert.match(ir.stdout, /Index deferred/);

  const adrApply = runScript(maintenanceRoot, "doc_maintenance.js", ["index", "apply", "--dir", "docs/adr", "--cwd", repo], repo);
  assert.equal(adrApply.status, 0, adrApply.stderr);
  assert.doesNotMatch(adrApply.stdout + adrApply.stderr, /hand-curated/);
  const index = fs.readFileSync(path.join(repo, "docs/adr/README.md"), "utf8");
  assert.match(index, /adopt-madr\.md/);

  const irApply = runScript(maintenanceRoot, "doc_maintenance.js", ["index", "apply", "--dir", "docs/impl/ir", "--cwd", repo], repo);
  assert.equal(irApply.status, 0, irApply.stderr);
  assert.doesNotMatch(irApply.stdout + irApply.stderr, /hand-curated/);
  assert.match(fs.readFileSync(path.join(repo, "docs/impl/ir/README.md"), "utf8"), /extract-foo\.md/);
});

test("hand-curated or modified READMEs are rejected byte-identically", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/adr/README.md"), "# ADR Documents\n\nDirectory: `docs/adr`\n\nhand note\n", "utf8");
  const target = path.join(repo, "docs/adr/README.md");
  const before = sha(target);

  const preview = runPromote(["--cwd", repo], repo);
  assert.equal(preview.status, 1, "rejected verdict exits nonzero");
  assert.match(preview.stdout, /reject/i);

  const apply = runPromote(["--cwd", repo, "--apply"], repo);
  assert.equal(apply.status, 1);
  assert.equal(sha(target), before, "rejected README must be byte-identical");
});

test("CRLF legacy scaffold output is still promotable", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/adr/README.md"), LEGACY["docs/adr"].replace(/\n/g, "\r\n"), "utf8");

  const result = runPromote(["--cwd", repo, "--apply"], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.readFileSync(path.join(repo, "docs/adr/README.md"), "utf8").includes("generated-index"));
});

test("a symlinked index file is rejected and never written through", (t) => {
  const repo = tempRepo();
  const outside = tempRepo();
  const outsideFile = path.join(outside, "legacy.md");
  fs.writeFileSync(outsideFile, LEGACY["docs/adr"], "utf8");
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  try {
    fs.symlinkSync(outsideFile, path.join(repo, "docs/adr", "README.md"));
  } catch {
    t.skip("file symlinks are not permitted on this platform");
    return;
  }

  const result = runPromote(["--cwd", repo, "--apply"], repo);
  assert.equal(result.status, 1, "symlinked index must be rejected");
  assert.equal(fs.readFileSync(outsideFile, "utf8"), LEGACY["docs/adr"], "symlink target untouched");
});

test("--json emits the verdict report and --dir scopes to one contract dir", () => {
  const repo = tempRepo();
  seedLegacy(repo);

  const json = runPromote(["--cwd", repo, "--json"], repo);
  const report = JSON.parse(json.stdout);
  assert.equal(report.results.length, 3);
  assert.ok(report.results.every((entry: any) => entry.verdict === "promote"));

  const scoped = runPromote(["--cwd", repo, "--dir", "docs/adr", "--json"], repo);
  const scopedReport = JSON.parse(scoped.stdout);
  assert.equal(scopedReport.results.length, 1);
  assert.equal(scopedReport.results[0].dir, "docs/adr");

  const bad = runPromote(["--cwd", repo, "--dir", "docs/specs"], repo);
  assert.notEqual(bad.status, 0);
});
