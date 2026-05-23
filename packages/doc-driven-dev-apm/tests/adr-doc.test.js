const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const skillRoot = path.resolve(__dirname, "../.apm/skills/adr-doc");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "adr-doc-test-"));
}

function runScript(name, args, options = {}) {
  const result = spawnSync(
    process.execPath,
    [path.join(skillRoot, "scripts", name), ...args],
    {
      cwd: options.cwd || tempRepo(),
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

test("new_adr creates the default MADR ADR and index in docs/adr", () => {
  const repo = tempRepo();

  const result = runScript("new_adr.ts", ["--title", "Adopt MADR"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(repo, "docs/adr/0001-adopt-madr.md")), true);
  assert.equal(fs.existsSync(path.join(repo, "docs/adr/README.md")), true);

  const adr = fs.readFileSync(path.join(repo, "docs/adr/0001-adopt-madr.md"), "utf8");
  assert.match(adr, /^status: "proposed"$/m);
  assert.match(adr, /^date: "\d{4}-\d{2}-\d{2}"$/m);
  assert.match(adr, /^decision-makers: \[\]$/m);
  assert.match(adr, /^consulted: \[\]$/m);
  assert.match(adr, /^informed: \[\]$/m);
  assert.match(adr, /^relations:$/m);
  assert.match(adr, /^  supersedes: \[\]$/m);
  assert.match(adr, /^  superseded-by: \[\]$/m);
  assert.match(adr, /^  related: \[\]$/m);
  assert.match(adr, /^  refines: \[\]$/m);
  assert.match(adr, /^# 1\. Adopt MADR/m);
  assert.match(adr, /## Context and Problem Statement/);
  assert.match(adr, /## Decision Drivers/);
  assert.match(adr, /## Pros and Cons of the Options/);
  assert.match(adr, /## Decision Outcome/);
});

test("new_adr honors --dir and all supported templates", () => {
  for (const template of ["full", "minimal", "bare", "bare-minimal"]) {
    const repo = tempRepo();

    const result = runScript(
      "new_adr.ts",
      ["--title", `Template ${template}`, "--dir", "decisions", "--template", template],
      { cwd: repo },
    );

    assert.equal(result.status, 0, `${template}: ${result.stderr}`);
    const files = fs.readdirSync(path.join(repo, "decisions")).filter((file) => file.endsWith(".md"));
    assert.equal(files.some((file) => file.includes(`template-${template}`)), true);
  }
});

test("update_index is dry-run by default and writes only with --write", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/adr/0001-existing.md"), "# 1. Existing\n", "utf8");

  const dryRun = runScript("update_index.ts", ["--dir", "docs/adr"], { cwd: repo });

  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /DRY RUN/);
  assert.equal(fs.existsSync(path.join(repo, "docs/adr/README.md")), false);

  const write = runScript("update_index.ts", ["--dir", "docs/adr", "--write"], { cwd: repo });

  assert.equal(write.status, 0, write.stderr);
  assert.match(fs.readFileSync(path.join(repo, "docs/adr/README.md"), "utf8"), /Existing/);
});

test("audit_adr reports issues without modifying files", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  const adrPath = path.join(repo, "docs/adr/0001-incomplete.md");
  fs.writeFileSync(adrPath, "# 1. Incomplete\n\nTODO\n", "utf8");
  const before = fs.readFileSync(adrPath, "utf8");

  const result = runScript("audit_adr.ts", ["--dir", "docs/adr", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.length > 0, true);
  assert.equal(fs.readFileSync(adrPath, "utf8"), before);
});

test("audit_adr validates relation links when relations are present", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/adr/0001-has-relations.md"),
    [
      "---",
      'status: "accepted"',
      'date: "2026-05-23"',
      "decision-makers: []",
      "consulted: []",
      "informed: []",
      "relations:",
      '  supersedes: ["0000-missing.md"]',
      "  superseded-by: []",
      "  related: []",
      "  refines: []",
      "---",
      "",
      "# 1. Has Relations",
      "",
      "## Context and Problem Statement",
      "",
      "## Considered Options",
      "",
      "## Decision Outcome",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runScript("audit_adr.ts", ["--dir", "docs/adr", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.some((finding) => finding.code === "broken-relation-link"), true);
});

test("audit_adr validates reference-style markdown links", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/adr/0001-reference-link.md"),
    [
      "---",
      'status: "accepted"',
      'date: "2026-05-23"',
      "decision-makers: []",
      "consulted: []",
      "informed: []",
      "relations:",
      "  supersedes: []",
      "  superseded-by: []",
      "  related: []",
      "  refines: []",
      "---",
      "",
      "# 1. Reference Link",
      "",
      "## Context and Problem Statement",
      "",
      "See [missing reference][missing].",
      "",
      "## Considered Options",
      "",
      "## Decision Outcome",
      "",
      "[missing]: ./missing.md",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runScript("audit_adr.ts", ["--dir", "docs/adr", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.some((finding) => finding.code === "broken-local-link"), true);
});

test("package scripts expose tests and markdownlint", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));

  assert.equal(packageJson.packageManager, "pnpm@11.2.2");
  assert.match(packageJson.scripts.test, /node --test/);
  assert.match(packageJson.scripts["lint:md"], /markdownlint-cli2/);
  assert.equal(Boolean(packageJson.dependencies["gray-matter"]), true);
  assert.equal(Boolean(packageJson.dependencies.unified), true);
  assert.equal(Boolean(packageJson.dependencies["remark-parse"]), true);
  assert.equal(Boolean(packageJson.dependencies["unist-util-visit"]), true);
  assert.equal(Boolean(packageJson.devDependencies["markdownlint-cli2"]), true);
});

test("migrate_report is report-only", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/decisions"), { recursive: true });
  const adrPath = path.join(repo, "docs/decisions/0001-old-style.md");
  fs.writeFileSync(adrPath, "# Old Style\n\nDecision: keep it simple.\n", "utf8");
  const before = fs.readFileSync(adrPath, "utf8");

  const result = runScript("migrate_report.ts", ["--dir", "docs/decisions", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.migrations.length, 1);
  assert.equal(fs.readFileSync(adrPath, "utf8"), before);
});
