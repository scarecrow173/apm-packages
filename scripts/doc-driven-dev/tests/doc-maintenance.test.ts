import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-maintenance-"));
}

function runScript(name: string, args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(skillRoot, "doc-maintenance", "scripts", name), ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function writeFile(root: string, relPath: string, content: string) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function writeSpec(root: string, name: string, id: string, extraFrontMatter = "") {
  writeFile(root, `docs/specs/${name}.md`, [
    "---",
    `id: ${id}`,
    "type: spec",
    "status: draft",
    `title: "Spec ${name}"`,
    'created: "2026-01-01"',
    'updated: "2026-01-01"',
    "owners: [team]",
    "relations:",
    "  implements: [IDEA-AAA]",
    extraFrontMatter,
    "---",
    `# Spec ${name}`,
    "",
  ].filter((line) => line !== "").join("\n") + "\n");
}

function seedIdea(root: string) {
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

function generatedIndex(root: string, rows: string[]) {
  writeFile(root, "docs/specs/README.md", [
    "# SPEC Documents",
    "",
    "<!-- doc-suite:generated-index -->",
    "",
    "Directory: `docs/specs`",
    "",
    "| ID | Title | Status | File |",
    "| --- | --- | --- | --- |",
    ...rows,
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

test("plan previews index regeneration without writing", () => {
  const repo = tempRepo();
  seedIdea(repo);
  writeSpec(repo, "checkout", "SPEC-AAA");
  const before = snapshot(repo);

  const result = runScript("doc_maintenance.js", ["plan", "--type", "spec"], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /rebuild-index/);
  assert.deepEqual(snapshot(repo), before);
});

test("apply creates a missing index and is idempotent", () => {
  const repo = tempRepo();
  seedIdea(repo);
  writeSpec(repo, "checkout", "SPEC-AAA");

  const first = runScript("doc_maintenance.js", ["apply", "--type", "spec"], repo);
  assert.equal(first.status, 0, first.stderr);
  const indexPath = path.join(repo, "docs/specs/README.md");
  assert.ok(fs.existsSync(indexPath));
  const content = fs.readFileSync(indexPath, "utf8");
  assert.match(content, /checkout\.md/);
  assert.match(content, /doc-suite:generated-index/);

  const second = runScript("doc_maintenance.js", ["apply", "--type", "spec"], repo);
  assert.equal(second.status, 0, second.stderr);
  const report = JSON.parse(runScript("doc_maintenance.js", ["apply", "--type", "spec", "--json"], repo).stdout);
  assert.equal(report.applied.length, 0);
  assert.equal(fs.readFileSync(indexPath, "utf8"), content);
});

test("apply regenerates stale and mismatched managed index entries", () => {
  const repo = tempRepo();
  seedIdea(repo);
  writeSpec(repo, "checkout", "SPEC-AAA");
  writeSpec(repo, "other", "SPEC-BBB");
  generatedIndex(repo, [
    "| SPEC-AAA | Wrong Title | active | [checkout.md](./checkout.md) |",
    "| SPEC-GONE | Ghost | draft | [ghost.md](./ghost.md) |",
  ]);

  const result = runScript("doc_maintenance.js", ["apply", "--type", "spec"], repo);
  assert.equal(result.status, 0, result.stderr);
  const content = fs.readFileSync(path.join(repo, "docs/specs/README.md"), "utf8");
  assert.match(content, /\| SPEC-AAA \| Spec checkout \| draft \|/);
  assert.match(content, /\| SPEC-BBB \|/);
  assert.doesNotMatch(content, /ghost\.md|Wrong Title/);
});

test("hand-curated index is skipped unless --force-index", () => {
  const repo = tempRepo();
  seedIdea(repo);
  writeSpec(repo, "checkout", "SPEC-AAA");
  writeFile(repo, "docs/specs/README.md", "# Hand-written\n\nThis index is curated.\n");

  const plan = runScript("doc_maintenance.js", ["plan", "--type", "spec"], repo);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /hand-curated-index/);

  const apply = runScript("doc_maintenance.js", ["apply", "--type", "spec"], repo);
  assert.equal(apply.status, 0, apply.stderr);
  const content = fs.readFileSync(path.join(repo, "docs/specs/README.md"), "utf8");
  assert.match(content, /Hand-written/);

  const forced = runScript("doc_maintenance.js", ["apply", "--type", "spec", "--force-index"], repo);
  assert.equal(forced.status, 0, forced.stderr);
  const regenerated = fs.readFileSync(path.join(repo, "docs/specs/README.md"), "utf8");
  assert.match(regenerated, /checkout\.md/);
});

test("manual-only findings are skipped, never repaired", () => {
  const repo = tempRepo();
  seedIdea(repo);
  writeFile(repo, "docs/specs/checkout.md", [
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

  const result = runScript("doc_maintenance.js", ["apply", "--type", "spec", "--json"], repo);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const broken = report.skipped.find((item: { ruleId: string }) => item.ruleId === "broken-link");
  assert.ok(broken);
  assert.equal(broken.reason, "manual");
  assert.ok(fs.readFileSync(path.join(repo, "docs/specs/checkout.md"), "utf8").includes("gone.md"));
});

test("fix-link-case normalizes path spelling on case-insensitive filesystems", () => {
  const repo = tempRepo();
  seedIdea(repo);
  writeSpec(repo, "checkout", "SPEC-AAA");
  writeSpec(repo, "other", "SPEC-BBB");
  writeFile(repo, "docs/specs/checkout.md", [
    "---",
    "id: SPEC-AAA",
    "type: spec",
    "status: draft",
    'title: "Spec checkout"',
    'created: "2026-01-01"',
    'updated: "2026-01-01"',
    "owners: [team]",
    "relations:",
    "  implements: [IDEA-AAA]",
    "---",
    "# Spec checkout",
    "",
    "See [other](OTHER.md).",
    "",
  ].join("\n"));

  if (!fs.existsSync(path.join(repo, "docs/specs", "OTHER.md"))) {
    // Case-sensitive filesystem: the link is broken, not a case mismatch.
    const plan = JSON.parse(runScript("doc_maintenance.js", ["plan", "--type", "spec", "--json"], repo).stdout);
    assert.ok(!plan.actions.some((action: { kind: string }) => action.kind === "fix-link-case"));
    return;
  }

  const result = runScript("doc_maintenance.js", ["apply", "--type", "spec"], repo);
  assert.equal(result.status, 0, result.stderr);
  const content = fs.readFileSync(path.join(repo, "docs/specs/checkout.md"), "utf8");
  assert.match(content, /\(other\.md\)/);
});

test("plan and apply return stable JSON output", () => {
  const repo = tempRepo();
  seedIdea(repo);
  writeSpec(repo, "checkout", "SPEC-AAA");

  const plan = JSON.parse(runScript("doc_maintenance.js", ["plan", "--type", "spec", "--json"], repo).stdout);
  assert.equal(plan.command, "plan");
  assert.ok(Array.isArray(plan.actions));
  assert.ok(Array.isArray(plan.skipped));

  const apply = JSON.parse(runScript("doc_maintenance.js", ["apply", "--type", "spec", "--json"], repo).stdout);
  assert.equal(apply.command, "apply");
  assert.equal(typeof apply.findingsBefore, "number");
  assert.equal(typeof apply.findingsAfter, "number");
});
