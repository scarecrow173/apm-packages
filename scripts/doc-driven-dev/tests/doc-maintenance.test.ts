import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { createDocument, migrateDocs, scaffoldDocsTree } from "../src/skills/lib/doc_suite_utils";
import { planMaintenance } from "../src/skills/lib/doc_maintenance";
import { CANONICAL_DOC_DIRS } from "../src/skills/lib/document_utils";

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
    "  implements: [IDEA-0001]",
    extraFrontMatter,
    "---",
    `# Spec ${name}`,
    "",
  ].filter((line) => line !== "").join("\n") + "\n");
}

function seedIdea(root: string) {
  writeFile(root, "docs/ideas/spark.md", [
    "---",
    "id: IDEA-0001",
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
  writeSpec(repo, "checkout", "SPEC-0001");
  const before = snapshot(repo);

  const result = runScript("doc_maintenance.js", ["plan", "--type", "spec"], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /rebuild-index/);
  assert.deepEqual(snapshot(repo), before);
});

test("apply creates a missing index and is idempotent", () => {
  const repo = tempRepo();
  seedIdea(repo);
  writeSpec(repo, "checkout", "SPEC-0001");

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
  writeSpec(repo, "checkout", "SPEC-0001");
  writeSpec(repo, "other", "SPEC-0002");
  generatedIndex(repo, [
    "| SPEC-0001 | Wrong Title | active | [checkout.md](./checkout.md) |",
    "| SPEC-GONE | Ghost | draft | [ghost.md](./ghost.md) |",
  ]);

  const result = runScript("doc_maintenance.js", ["apply", "--type", "spec"], repo);
  assert.equal(result.status, 0, result.stderr);
  const content = fs.readFileSync(path.join(repo, "docs/specs/README.md"), "utf8");
  assert.match(content, /\| SPEC-0001 \| Spec checkout \| draft \|/);
  assert.match(content, /\| SPEC-0002 \|/);
  assert.doesNotMatch(content, /ghost\.md|Wrong Title/);
});

test("index-tier-mismatch routes into the index rebuild plan", async () => {
  const repo = tempRepo();
  seedIdea(repo);
  writeSpec(repo, "checkout", "SPEC-0001");
  writeTypedDoc(repo, "docs/specs/old.md", "SPEC-0002", "spec", "implemented", "Old");
  // Generated index keeps the settled doc's row in the active table — lint
  // reports index-tier-mismatch and regeneration is its safe repair (Issue #189).
  generatedIndex(repo, [
    "| SPEC-0001 | Spec checkout | draft | [checkout.md](./checkout.md) |",
    "| SPEC-0002 | Old | implemented | [old.md](./old.md) |",
  ]);

  const { plan } = await planMaintenance(repo, { type: "spec" });
  const rebuild = plan.actions.find(
    (action) => action.kind === "rebuild-index" && action.path === "docs/specs/README.md",
  );
  assert.ok(rebuild, `expected a rebuild-index action: ${JSON.stringify(plan.actions)}`);
  assert.ok(
    rebuild.ruleIds.includes("index-tier-mismatch"),
    `index-tier-mismatch must route to rebuild: ${JSON.stringify(rebuild.ruleIds)}`,
  );
  assert.ok(
    !plan.skipped.some((item) => item.ruleId === "index-tier-mismatch"),
    "a rebuild-routed finding must not surface as manual/skipped",
  );
});

test("hand-curated index is skipped unless --force-index", () => {
  const repo = tempRepo();
  seedIdea(repo);
  writeSpec(repo, "checkout", "SPEC-0001");
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
    "id: SPEC-0001",
    "type: spec",
    "status: draft",
    'title: "Checkout"',
    'created: "2026-01-01"',
    'updated: "2026-01-01"',
    "owners: [team]",
    "relations:",
    "  implements: [IDEA-0001]",
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
  writeSpec(repo, "checkout", "SPEC-0001");
  writeSpec(repo, "other", "SPEC-0002");
  writeFile(repo, "docs/specs/checkout.md", [
    "---",
    "id: SPEC-0001",
    "type: spec",
    "status: draft",
    'title: "Spec checkout"',
    'created: "2026-01-01"',
    'updated: "2026-01-01"',
    "owners: [team]",
    "relations:",
    "  implements: [IDEA-0001]",
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

function writeTypedDoc(root: string, relPath: string, id: string, type: string, status: string, title: string) {
  writeFile(root, relPath, [
    "---",
    `id: ${id}`,
    `type: ${type}`,
    `status: ${status}`,
    `title: "${title}"`,
    'created: "2026-01-01"',
    'updated: "2026-01-01"',
    "owners: [team]",
    "relations: {}",
    "---",
    `# ${title}`,
    "",
  ].join("\n"));
}

test("shared-directory index is rebuilt once and covers all resident types", () => {
  const repo = tempRepo();
  writeTypedDoc(repo, "docs/discovery/idea-note.md", "BRAINSTORM-0001", "brainstorm", "capturing", "Idea note");
  writeTypedDoc(repo, "docs/discovery/research.md", "DISC-0001", "discovery", "draft", "Research");
  writeFile(repo, "docs/discovery/README.md", [
    "# DISC Documents",
    "",
    "<!-- doc-suite:generated-index -->",
    "",
    "Directory: `docs/discovery`",
    "",
    "| ID | Title | Status | File |",
    "| --- | --- | --- | --- |",
    "| DISC-0001 | Research | draft | [research.md](./research.md) |",
    "",
  ].join("\n"));

  const plan = JSON.parse(runScript("doc_maintenance.js", ["plan", "--type", "all", "--json"], repo).stdout);
  const rebuilds = plan.actions.filter(
    (action: { kind: string; path: string }) => action.kind === "rebuild-index" && action.path === "docs/discovery/README.md",
  );
  assert.equal(rebuilds.length, 1);
  assert.deepEqual(rebuilds[0].scopeTypes, ["brainstorm", "discovery"]);

  const apply = runScript("doc_maintenance.js", ["apply", "--type", "all"], repo);
  assert.equal(apply.status, 0, apply.stderr);
  const content = fs.readFileSync(path.join(repo, "docs/discovery/README.md"), "utf8");
  assert.match(content, /idea-note\.md/);
  assert.match(content, /research\.md/);

  const second = JSON.parse(runScript("doc_maintenance.js", ["plan", "--type", "all", "--json"], repo).stdout);
  assert.ok(!second.actions.some(
    (action: { kind: string; path: string }) => action.kind === "rebuild-index" && action.path === "docs/discovery/README.md",
  ));
});

test("scoped rebuild keeps sibling-type rows in a shared directory", () => {
  const repo = tempRepo();
  writeTypedDoc(repo, "docs/discovery/idea-note.md", "BRAINSTORM-0001", "brainstorm", "capturing", "Idea note");
  writeTypedDoc(repo, "docs/discovery/research.md", "DISC-0001", "discovery", "draft", "Research");
  writeFile(repo, "docs/discovery/README.md", [
    "# DISC Documents",
    "",
    "<!-- doc-suite:generated-index -->",
    "",
    "Directory: `docs/discovery`",
    "",
    "| ID | Title | Status | File |",
    "| --- | --- | --- | --- |",
    "| DISC-0001 | Research | draft | [research.md](./research.md) |",
    "",
  ].join("\n"));

  const apply = runScript("doc_maintenance.js", ["apply", "--type", "brainstorm"], repo);
  assert.equal(apply.status, 0, apply.stderr);
  const content = fs.readFileSync(path.join(repo, "docs/discovery/README.md"), "utf8");
  assert.match(content, /idea-note\.md/);
  assert.match(content, /research\.md/, "discovery rows must survive a brainstorm-scoped rebuild");
});

test("createDocument keeps sibling-type rows and manual text in a shared index", async () => {
  const repo = tempRepo();
  writeTypedDoc(repo, "docs/discovery/idea-note.md", "BRAINSTORM-0001", "brainstorm", "capturing", "Idea note");
  writeFile(repo, "docs/discovery/README.md", [
    "# DISC Documents",
    "",
    "Curated notes about this directory.",
    "",
    "<!-- doc-suite:generated-index -->",
    "",
    "Directory: `docs/discovery`",
    "",
    "| ID | Title | Status | File |",
    "| --- | --- | --- | --- |",
    "| BRAINSTORM-0001 | Idea note | capturing | [idea-note.md](./idea-note.md) |",
    "",
    "Trailing operations notes.",
    "",
  ].join("\n"));

  const result = await createDocument("discovery", { cwd: repo, title: "Research" });
  assert.equal(result.indexWritten, true);

  const content = fs.readFileSync(path.join(repo, "docs/discovery/README.md"), "utf8");
  assert.match(content, /idea-note\.md/, "sibling-type rows must survive document creation");
  assert.match(content, /research\.md/);
  assert.match(content, /Curated notes about this directory\./);
  assert.match(content, /Trailing operations notes\./);
});

test("managed index rebuild preserves hand-written text around the generated region", () => {
  const repo = tempRepo();
  seedIdea(repo);
  writeSpec(repo, "checkout", "SPEC-0001");
  writeFile(repo, "docs/specs/README.md", [
    "# SPEC Documents",
    "",
    "Curated introduction that must survive rebuilds.",
    "",
    "<!-- doc-suite:generated-index -->",
    "",
    "Directory: `docs/specs`",
    "",
    "| ID | Title | Status | File |",
    "| --- | --- | --- | --- |",
    "| SPEC-GONE | Ghost | draft | [ghost.md](./ghost.md) |",
    "",
    "Operational notes kept below the table.",
    "",
  ].join("\n"));

  const apply = runScript("doc_maintenance.js", ["apply", "--type", "spec"], repo);
  assert.equal(apply.status, 0, apply.stderr);
  const content = fs.readFileSync(path.join(repo, "docs/specs/README.md"), "utf8");
  assert.match(content, /Curated introduction that must survive rebuilds\./);
  assert.match(content, /Operational notes kept below the table\./);
  assert.match(content, /checkout\.md/);
  assert.doesNotMatch(content, /ghost\.md/);
});

test("plan and apply return stable JSON output", () => {
  const repo = tempRepo();
  seedIdea(repo);
  writeSpec(repo, "checkout", "SPEC-0001");

  const plan = JSON.parse(runScript("doc_maintenance.js", ["plan", "--type", "spec", "--json"], repo).stdout);
  assert.equal(plan.command, "plan");
  assert.ok(Array.isArray(plan.actions));
  assert.ok(Array.isArray(plan.skipped));

  const apply = JSON.parse(runScript("doc_maintenance.js", ["apply", "--type", "spec", "--json"], repo).stdout);
  assert.equal(apply.command, "apply");
  assert.equal(typeof apply.findingsBefore, "number");
  assert.equal(typeof apply.findingsAfter, "number");
});

// --- index plan|apply (Issue #197) -------------------------------------------
//
// CLI surface over the index materialization lib: `index plan` is a read-only
// per-target preview (verdicts, changes, pins, planHash); `index apply`
// re-plans, re-validates pins, and writes only through owner writers.
// The repair plan|apply verbs are untouched — impl dirs still Scope-mismatch
// there (pinned in doc-scope-preflight.test.ts).

const INDEX_MARKER = "<!-- doc-suite:generated-index -->";
const INDEX_HEADER = "| ID | Title | Status | File |\n| --- | --- | --- | --- |";

function writeImplRecord(root: string, file: string, id: string, status: string) {
  writeFile(root, `docs/impl/ir/${file}`, [
    "---",
    `id: "${id}"`,
    'type: "impl"',
    `status: "${status}"`,
    `title: "${id}"`,
    'created: "2026-01-01"',
    'updated: "2026-01-01"',
    "owners: []",
    "relations: {}",
    "metadata:",
    "  experiments:",
    "    adopted: []",
    "    rejected: []",
    "---",
    "",
    `# ${id}`,
    "",
  ].join("\n"));
}

function writeImplIndex(root: string, rows: string[]) {
  writeFile(root, "docs/impl/ir/README.md", [
    "# Implementation Records",
    "",
    INDEX_MARKER,
    "",
    "Directory: `docs/impl/ir`",
    "",
    INDEX_HEADER,
    ...rows,
    "",
  ].join("\n"));
}

test("index plan previews targets as JSON and writes nothing", () => {
  const repo = tempRepo();
  writeSpec(repo, "checkout", "SPEC-0001");
  const before = snapshot(repo);

  const result = runScript("doc_maintenance.js", ["index", "plan", "--dir", "docs/specs", "--json"], repo);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.command, "index plan");
  assert.match(report.planHash, /^[0-9a-f]{64}$/);
  assert.equal(report.targets.length, 1);
  const target = report.targets[0];
  assert.equal(target.directory, "docs/specs");
  assert.equal(target.kind, "shared");
  assert.equal(target.owner, "doc-suite");
  assert.equal(target.verdict, "create");
  assert.equal(target.indexPath, "docs/specs/README.md");
  assert.equal(target.sourceCount, 1);
  assert.equal("content" in target, false, "JSON targets never carry the write payload");
  assert.match(target.planHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(snapshot(repo), before, "index plan must be read-only");

  const text = runScript("doc_maintenance.js", ["index", "plan", "--dir", "docs/specs"], repo);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /index plan: 1 target\(s\)/);
  assert.match(text.stdout, /docs\/specs kind=shared owner=doc-suite verdict=create/);
  assert.deepEqual(snapshot(repo), before);
});

test("index apply writes a stale shared index; second apply is a no-op", () => {
  const repo = tempRepo();
  writeSpec(repo, "checkout", "SPEC-0001");
  writeSpec(repo, "other", "SPEC-0002");
  generatedIndex(repo, [
    "| SPEC-0001 | Spec checkout | draft | [checkout.md](./checkout.md) |",
  ]);

  const apply = runScript("doc_maintenance.js", ["index", "apply", "--dir", "docs/specs"], repo);
  assert.equal(apply.status, 0, apply.stderr);
  assert.match(apply.stdout, /index apply: 1 written, 0 blocked/);
  const content = fs.readFileSync(path.join(repo, "docs/specs/README.md"), "utf8");
  assert.match(content, /other\.md/);
  assert.match(content, /doc-suite:generated-index/);

  const again = runScript("doc_maintenance.js", ["index", "apply", "--dir", "docs/specs", "--json"], repo);
  assert.equal(again.status, 0, again.stderr);
  const report = JSON.parse(again.stdout);
  assert.equal(report.command, "index apply");
  assert.deepEqual(report.written, []);
  assert.deepEqual(report.blocked, []);
  assert.equal(fs.readFileSync(path.join(repo, "docs/specs/README.md"), "utf8"), content);
});

test("index apply --expect binds to a prior planHash and refuses drift", () => {
  const repo = tempRepo();
  writeSpec(repo, "checkout", "SPEC-0001");
  writeSpec(repo, "other", "SPEC-0002");
  generatedIndex(repo, [
    "| SPEC-0001 | Spec checkout | draft | [checkout.md](./checkout.md) |",
  ]);

  const plan = JSON.parse(
    runScript("doc_maintenance.js", ["index", "plan", "--dir", "docs/specs", "--json"], repo).stdout,
  );
  const before = snapshot(repo);

  const refused = runScript("doc_maintenance.js", [
    "index", "apply", "--dir", "docs/specs", "--expect", "0".repeat(64), "--json",
  ], repo);
  assert.equal(refused.status, 1, "a wrong --expect must fail closed");
  const refusal = JSON.parse(refused.stdout);
  assert.deepEqual(refusal.written, []);
  assert.equal(refusal.blocked.length, 1);
  assert.match(refusal.blocked[0].reason, /plan drift/);
  assert.deepEqual(snapshot(repo), before, "a refused apply writes nothing");

  const applied = runScript("doc_maintenance.js", [
    "index", "apply", "--dir", "docs/specs", "--expect", plan.planHash,
  ], repo);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /index apply: 1 written, 0 blocked/);

  // --expect is index-apply-only: the repair verbs and index plan reject it.
  for (const argv of [
    ["index", "plan", "--expect", plan.planHash],
    ["apply", "--expect", plan.planHash],
  ]) {
    const misuse = runScript("doc_maintenance.js", argv, repo);
    assert.equal(misuse.status, 1, `${argv.join(" ")} must reject --expect`);
    assert.match(`${misuse.stdout}\n${misuse.stderr}`, /--expect requires index apply/);
  }
});

test("index apply --dir docs/impl/ir repairs the IR index through the owner sync API", () => {
  const repo = tempRepo();
  writeImplRecord(repo, "a.md", "IMPL-A", "draft");
  writeImplRecord(repo, "b.md", "IMPL-B", "draft");
  writeImplIndex(repo, [
    "| IMPL-A | IMPL-A | draft | [a.md](./a.md) |",
    "| IMPL-B | IMPL-B | draft | [b.md](./b.md) |",
  ]);
  // Status drift: b is now settled — the IR owner sync must move the row.
  writeImplRecord(repo, "b.md", "IMPL-B", "completed");

  const apply = runScript("doc_maintenance.js", ["index", "apply", "--dir", "docs/impl/ir"], repo);
  assert.equal(apply.status, 0, apply.stderr);
  assert.match(apply.stdout, /\[written\] docs\/impl\/ir\/README\.md/);
  const content = fs.readFileSync(path.join(repo, "docs/impl/ir/README.md"), "utf8");
  const settledAt = content.indexOf("## Settled");
  assert.ok(settledAt > 0, "owner sync produced a settled tier");
  assert.ok(content.indexOf("[b.md](./b.md)") > settledAt, "b.md moved to the settled tier");

  // The repair surface still refuses impl dirs outright (preflight pin).
  for (const verb of ["plan", "apply"]) {
    const repair = runScript("doc_maintenance.js", [verb, "--dir", "docs/impl/ir"], repo);
    assert.notEqual(repair.status, 0, `repair ${verb} must fail closed on impl dirs`);
    assert.match(`${repair.stdout}\n${repair.stderr}`, /Scope mismatch/);
  }
});

test("index ops stay fail-closed on the docs/impl container", () => {
  const repo = tempRepo();
  writeImplRecord(repo, "a.md", "IMPL-A", "draft");
  const before = snapshot(repo);

  // plan reports the rejected target without failing — preview stays honest.
  const plan = runScript("doc_maintenance.js", ["index", "plan", "--dir", "docs/impl"], repo);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /verdict=rejected/);
  assert.match(plan.stdout, /impl container has no managed index/);
  assert.deepEqual(snapshot(repo), before, "index plan writes nothing");

  // apply blocks the same target and exits non-zero — nothing is created.
  const apply = runScript("doc_maintenance.js", ["index", "apply", "--dir", "docs/impl", "--json"], repo);
  assert.equal(apply.status, 1, "blocked targets must fail the apply");
  const report = JSON.parse(apply.stdout);
  assert.deepEqual(report.written, []);
  assert.equal(report.blocked.length, 1);
  assert.equal(report.blocked[0].target.verdict, "rejected");
  assert.match(report.blocked[0].reason, /impl container has no managed index/);
  assert.deepEqual(snapshot(repo), before, "a rejected target is reported, never written");
});

test("index apply reports rejected targets without writing them", () => {
  const repo = tempRepo();
  writeSpec(repo, "checkout", "SPEC-0001");
  writeFile(repo, "docs/specs/README.md", "# Hand-written\n\nCurated index — no marker.\n");
  const indexBefore = fs.readFileSync(path.join(repo, "docs/specs/README.md"), "utf8");

  const plan = runScript("doc_maintenance.js", ["index", "plan", "--dir", "docs/specs"], repo);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /verdict=rejected reason=hand-curated-index/);

  const apply = runScript("doc_maintenance.js", ["index", "apply", "--dir", "docs/specs"], repo);
  assert.equal(apply.status, 1, "a rejected target blocks the apply");
  assert.match(apply.stdout, /\[blocked\] docs\/specs\/README\.md: hand-curated-index/);
  assert.equal(fs.readFileSync(path.join(repo, "docs/specs/README.md"), "utf8"), indexBefore);

  // No force path exists on the index op.
  const forced = runScript("doc_maintenance.js", ["index", "apply", "--dir", "docs/specs", "--force-index"], repo);
  assert.equal(forced.status, 1, "--force-index is not part of the index contract");
  assert.equal(fs.readFileSync(path.join(repo, "docs/specs/README.md"), "utf8"), indexBefore);
});

test("index requires a plan|apply verb", () => {
  const repo = tempRepo();
  for (const argv of [["index"], ["index", "bogus"], ["index", "--dir", "docs/specs"]]) {
    const result = runScript("doc_maintenance.js", argv, repo);
    assert.equal(result.status, 1, `${argv.join(" ")} must be a usage error`);
    assert.match(`${result.stdout}\n${result.stderr}`, /index requires a verb|Unknown index verb/);
  }
});

test("scaffold targets are sourced from CANONICAL_DOC_DIRS, not a parallel list", async () => {
  const repo = tempRepo();
  const result = await scaffoldDocsTree(repo);
  // The scaffolded tree is exactly the canonical directory set — a drifted
  // second list (the pre-consolidation scaffoldTargets) could not produce
  // this equality (Issue #156).
  assert.deepEqual(result.created.sort(), CANONICAL_DOC_DIRS.map((dir) => `${dir}/README.md`).sort());
  for (const dir of CANONICAL_DOC_DIRS) {
    assert.equal(fs.existsSync(path.join(repo, dir, "README.md")), true, `${dir}/README.md missing`);
  }
});

test("migrateDocs rejects an escaping --from root at the library boundary", async () => {
  const repo = tempRepo();
  for (const from of ["../outside", path.dirname(repo)]) {
    await assert.rejects(
      () => migrateDocs({ cwd: repo, from: [from] }),
      /--from escapes the checkout/,
      `--from ${from} must be rejected`,
    );
  }
});
