const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const sourceCli = path.resolve(__dirname, "../src/skills/doc-driven-dev-graph/scripts/migrate_docs.ts");
const tsxCli = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-driven-dev-graph-migrate-"));
}

function runMigrate(cwd, args = []) {
  const result = spawnSync(
    process.execPath,
    [tsxCli, sourceCli, ...args],
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

test("migrate_docs dry-run reports planned canonical targets without writing files", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "legacy"), { recursive: true });
  fs.writeFileSync(path.join(repo, "legacy", "payment-spec.md"), "# Payment Spec\n\n## Acceptance Criteria\n\n- capture payments\n", "utf8");

  const result = runMigrate(repo, ["--from", "legacy", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.applied, false);
  assert.equal(report.migrations.length, 1);
  assert.equal(report.migrations[0].source, "legacy/payment-spec.md");
  assert.equal(report.migrations[0].targetDir, "docs/specs");
  assert.equal(report.migrations[0].type, "spec");
  assert.equal(fs.existsSync(path.join(repo, "docs", "specs")), false);
});

test("migrate_docs apply writes converted spec and preserves original", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "legacy"), { recursive: true });
  fs.writeFileSync(path.join(repo, "legacy", "payment-spec.md"), "# Payment Spec\n\n## Acceptance Criteria\n\n- capture payments\n", "utf8");

  const result = runMigrate(repo, ["--from", "legacy", "--apply"]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(repo, "legacy", "payment-spec.md")), true);
  const target = path.join(repo, "docs", "specs", "0001-payment-spec.md");
  assert.equal(fs.existsSync(target), true);
  const content = fs.readFileSync(target, "utf8");
  assert.match(content, /^id: "SPEC-0001"$/m);
  assert.match(content, /^type: "spec"$/m);
  assert.match(content, /^status: "draft"$/m);
  assert.match(content, /# Payment Spec/);
  assert.equal(fs.existsSync(path.join(repo, "docs", "designs", "overview.md")), false);
});

test("migrate_docs split-h1 creates separate discovery files", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "notes"), { recursive: true });
  fs.writeFileSync(path.join(repo, "notes", "workshop.md"), "# First Idea\n\nA\n\n# Second Idea\n\nB\n", "utf8");

  const result = runMigrate(repo, ["--from", "notes", "--split-h1", "--apply", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.applied, true);
  assert.equal(report.migrations.length, 2);
  assert.equal(fs.existsSync(path.join(repo, "docs", "ideas", "0001-first-idea.md")), true);
  assert.equal(fs.existsSync(path.join(repo, "docs", "ideas", "0002-second-idea.md")), true);
});

test("migrate_docs skips canonical docs by default", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs", "specs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs", "specs", "0001-existing.md"), "# Existing Spec\n", "utf8");

  const result = runMigrate(repo, ["--from", "docs", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.migrations.length, 0);
});
