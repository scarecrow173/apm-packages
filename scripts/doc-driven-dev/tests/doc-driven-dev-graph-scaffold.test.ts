import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceCli = path.resolve(__dirname, "../src/skills/doc-driven-dev-graph/scripts/scaffold_docs.ts");
const tsxCli = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-driven-dev-graph-scaffold-"));
}

function runScaffold(cwd: any) {
  const result = spawnSync(
    process.execPath,
    [tsxCli, sourceCli],
    {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    },
  );

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

test("scaffold_docs creates the canonical docs tree without overview.md", () => {
  const repo = tempRepo();

  const result = runScaffold(repo);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Created docs tree scaffold/);

  const expectedPaths = [
    "docs/ideas/README.md",
    "docs/discovery/README.md",
    "docs/specs/README.md",
    "docs/designs/README.md",
    "docs/plans/README.md",
    "docs/tasks/README.md",
    "docs/test-specs/README.md",
    "docs/adr/README.md",
    "docs/impl/ir/README.md",
    "docs/impl/exp/README.md",
  ];

  for (const relPath of expectedPaths) {
    assert.equal(fs.existsSync(path.join(repo, relPath)), true, relPath);
  }

  assert.equal(fs.existsSync(path.join(repo, "docs/designs/overview.md")), false);
});

test("scaffold_docs preserves existing README files", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/specs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/specs/README.md"), "# existing\n", "utf8");

  const result = runScaffold(repo);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(repo, "docs/specs/README.md"), "utf8"), "# existing\n");
  assert.equal(fs.existsSync(path.join(repo, "docs/designs/overview.md")), false);
});

const adrRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/adr-doc");
const implRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/impl-doc");
const maintenanceRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-maintenance");

function runSkill(root: string, name: string, args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", name), ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("scaffolded owner indexes accept explicit materialization end to end", () => {
  const repo = tempRepo();
  const scaffold = runSkill(maintenanceRoot, "scaffold_docs.js", ["--cwd", repo], repo);
  assert.equal(scaffold.status, 0, scaffold.stderr);

  for (const dir of ["docs/adr", "docs/impl/ir", "docs/impl/exp"]) {
    const content = fs.readFileSync(path.join(repo, dir, "README.md"), "utf8");
    assert.ok(content.includes("doc-suite:generated-index"), `${dir} scaffold index is managed`);
  }

  const adr = runSkill(adrRoot, "new_adr.js", ["--title", "Adopt MADR", "--cwd", repo], repo);
  assert.equal(adr.status, 0, adr.stderr);
  assert.match(adr.stdout, /Index deferred/);
  assert.doesNotMatch(fs.readFileSync(path.join(repo, "docs/adr/README.md"), "utf8"), /adopt-madr\.md/);
  const adrApply = runSkill(maintenanceRoot, "doc_maintenance.js", ["index", "apply", "--dir", "docs/adr", "--cwd", repo], repo);
  assert.equal(adrApply.status, 0, adrApply.stderr);
  assert.doesNotMatch(adrApply.stdout + adrApply.stderr, /hand-curated/);
  assert.match(fs.readFileSync(path.join(repo, "docs/adr/README.md"), "utf8"), /adopt-madr\.md/);

  const ir = runSkill(implRoot, "new_impl_record.js", ["--title", "Extract foo", "--cwd", repo], repo);
  assert.equal(ir.status, 0, ir.stderr);
  assert.match(ir.stdout, /Index deferred/);
  assert.doesNotMatch(fs.readFileSync(path.join(repo, "docs/impl/ir/README.md"), "utf8"), /extract-foo\.md/);
  const irApply = runSkill(maintenanceRoot, "doc_maintenance.js", ["index", "apply", "--dir", "docs/impl/ir", "--cwd", repo], repo);
  assert.equal(irApply.status, 0, irApply.stderr);
  assert.doesNotMatch(irApply.stdout + irApply.stderr, /hand-curated/);
  assert.match(fs.readFileSync(path.join(repo, "docs/impl/ir/README.md"), "utf8"), /extract-foo\.md/);

  const exp = runSkill(implRoot, "new_experiment_log.js", ["--title", "Try caches", "--cwd", repo], repo);
  assert.equal(exp.status, 0, exp.stderr);
  assert.match(exp.stdout, /Index deferred/);
  assert.doesNotMatch(fs.readFileSync(path.join(repo, "docs/impl/exp/README.md"), "utf8"), /try-caches\.jsonl/);
  const expApply = runSkill(maintenanceRoot, "doc_maintenance.js", ["index", "apply", "--dir", "docs/impl/exp", "--cwd", repo], repo);
  assert.equal(expApply.status, 0, expApply.stderr);
  assert.doesNotMatch(expApply.stdout + expApply.stderr, /hand-curated/);
  const expIndex = fs.readFileSync(path.join(repo, "docs/impl/exp/README.md"), "utf8");
  assert.match(expIndex, /try-caches\.jsonl/);
  assert.doesNotMatch(expIndex, /\| Title \|/, "EXP index stays one-column");
});

test("a second scaffold run leaves managed owner indexes untouched", () => {
  const repo = tempRepo();
  runSkill(maintenanceRoot, "scaffold_docs.js", ["--cwd", repo], repo);
  runSkill(adrRoot, "new_adr.js", ["--title", "Adopt MADR", "--cwd", repo], repo);
  const materialize = runSkill(maintenanceRoot, "doc_maintenance.js", ["index", "apply", "--dir", "docs/adr", "--cwd", repo], repo);
  assert.equal(materialize.status, 0, materialize.stderr);
  const before = fs.readFileSync(path.join(repo, "docs/adr/README.md"), "utf8");
  assert.match(before, /adopt-madr\.md/);

  const again = runSkill(maintenanceRoot, "scaffold_docs.js", ["--cwd", repo], repo);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(fs.readFileSync(path.join(repo, "docs/adr/README.md"), "utf8"), before);
});

test("migrate_docs --apply produces contract-conformant owner indexes", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/old-decision.md"),
    "# Decision: keep JSONL logs\n\nBody of a decision record to migrate.\n",
    "utf8",
  );

  const migrate = runSkill(maintenanceRoot, "migrate_docs.js", ["--cwd", repo, "--apply"], repo);
  assert.equal(migrate.status, 0, migrate.stderr);

  const adrIndex = fs.readFileSync(path.join(repo, "docs/adr/README.md"), "utf8");
  assert.match(adrIndex, /^# Architecture Decision Records/m);
  assert.ok(adrIndex.includes("doc-suite:generated-index"));
  const expIndex = fs.readFileSync(path.join(repo, "docs/impl/exp/README.md"), "utf8");
  assert.match(expIndex, /\| File \|/);
});
