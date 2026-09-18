import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-status-cli-"));
}

function runScript(name: string, args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(skillRoot, "doc-status", "scripts", name), ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function writeFile(root: string, relPath: string, content: string) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function seedRepo(root: string) {
  writeFile(root, "docs/specs/checkout.md", [
    "---",
    "id: SPEC-AAA",
    "type: spec",
    "status: draft",
    'title: "Checkout"',
    'created: "2026-01-01"',
    'updated: "2026-01-01"',
    "owners: [team]",
    "relations:",
    "  implements: [IDEA-AAA]",
    "---",
    "# Checkout",
    "",
    "See [missing](gone.md).",
    "",
  ].join("\n"));
  writeFile(root, "docs/specs/README.md", [
    "---",
    "type: index",
    "of: spec",
    "status: active",
    'title: "Spec Index"',
    'created: "2026-01-01"',
    "---",
    "# Spec Index",
    "",
    "| ID | Title | Status | File |",
    "| --- | --- | --- | --- |",
    "| SPEC-AAA | Checkout | draft | [checkout.md](./checkout.md) |",
    "",
  ].join("\n"));
  writeFile(root, "docs/ideas/spark.md", [
    "---",
    "id: IDEA-AAA",
    "type: idea",
    "status: draft",
    'title: "Spark"',
    'created: "2026-01-01"',
    'updated: "2026-01-01"',
    "owners: [team]",
    "relations: {}",
    "---",
    "# Spark",
    "",
  ].join("\n"));
}

function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.set(path.relative(dir, full), fs.readFileSync(full, "utf8"));
    }
  };
  walk(dir);
  return files;
}

test("doc_status lint reports shared findings with stable output", () => {
  const repo = tempRepo();
  seedRepo(repo);
  const result = runScript("doc_status.js", ["lint", "--type", "spec"], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /lint: \d+ document\(s\), \d+ finding\(s\), \d+ blocking/);
  assert.match(result.stdout, /broken-link/);
});

test("doc_status lint filters by rule, severity, and blocking", () => {
  const repo = tempRepo();
  seedRepo(repo);
  const byRule = runScript("doc_status.js", ["lint", "--type", "spec", "--rule", "broken-link"], repo);
  assert.equal(byRule.status, 0, byRule.stderr);
  assert.match(byRule.stdout, /broken-link/);
  assert.doesNotMatch(byRule.stdout, /invalid-status|missing-index/);

  const bySeverity = runScript("doc_status.js", ["lint", "--type", "spec", "--severity", "error"], repo);
  assert.equal(bySeverity.status, 0, bySeverity.stderr);
  for (const line of bySeverity.stdout.split("\n").filter((line) => line.startsWith("["))) {
    assert.match(line, /^\[error/);
  }

  const blockingOnly = runScript("doc_status.js", ["lint", "--type", "spec", "--blocking"], repo);
  assert.equal(blockingOnly.status, 0, blockingOnly.stderr);
  for (const line of blockingOnly.stdout.split("\n").filter((line) => line.startsWith("["))) {
    assert.match(line, /blocking\]/);
  }
});

test("doc_status lint --json returns the shared finding contract", () => {
  const repo = tempRepo();
  seedRepo(repo);
  const result = runScript("doc_status.js", ["lint", "--type", "spec", "--json"], repo);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.command, "lint");
  assert.ok(typeof report.blocking === "number");
  assert.ok(Array.isArray(report.findings));
  const finding = report.findings.find((item: { ruleId: string }) => item.ruleId === "broken-link");
  assert.ok(finding);
  assert.equal(typeof finding.ruleId, "string");
  assert.equal(typeof finding.category, "string");
  assert.equal(typeof finding.severity, "string");
  assert.equal(typeof finding.blocking, "boolean");
  assert.equal(typeof finding.repair, "string");
});

test("doc_status health aggregates findings by category without a numeric score", () => {
  const repo = tempRepo();
  seedRepo(repo);
  const result = runScript("doc_status.js", ["health"], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Documents: \d+/);
  assert.match(result.stdout, /Blocking: +\d+/);
  assert.match(result.stdout, /link\s+1 blocking/);
  assert.doesNotMatch(result.stdout, /score/i);

  const json = runScript("doc_status.js", ["health", "--json"], repo);
  const report = JSON.parse(json.stdout);
  assert.equal(report.command, "health");
  assert.ok(Array.isArray(report.categories));
  const link = report.categories.find((item: { category: string }) => item.category === "link");
  assert.ok(link);
  assert.equal(link.blocking, 1);
});

test("doc_status audit reports blocking summary for gate decisions", () => {
  const repo = tempRepo();
  seedRepo(repo);
  const result = runScript("doc_status.js", ["audit", "--type", "spec"], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /audit: \d+ document\(s\), \d+ finding\(s\), \d+ blocking/);
});

test("doc_status list works with and without --type", () => {
  const repo = tempRepo();
  seedRepo(repo);
  const single = runScript("doc_status.js", ["list", "--type", "spec"], repo);
  assert.equal(single.status, 0, single.stderr);
  assert.match(single.stdout, /checkout\.md/);
  assert.doesNotMatch(single.stdout, /spark\.md/);

  const all = runScript("doc_status.js", ["list"], repo);
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /checkout\.md/);
  assert.match(all.stdout, /spark\.md/);
});

test("doc_status commands are read-only", () => {
  const repo = tempRepo();
  seedRepo(repo);
  const before = snapshot(repo);
  for (const command of ["list", "lint", "audit", "health"]) {
    const result = runScript("doc_status.js", [command], repo);
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  }
  const after = snapshot(repo);
  assert.deepEqual(after, before);
});

test("doc_status exits non-zero on unknown command or missing command", () => {
  const repo = tempRepo();
  seedRepo(repo);
  const unknown = runScript("doc_status.js", ["frobnicate"], repo);
  assert.notEqual(unknown.status, 0);
  const missing = runScript("doc_status.js", [], repo);
  assert.notEqual(missing.status, 0);
});
