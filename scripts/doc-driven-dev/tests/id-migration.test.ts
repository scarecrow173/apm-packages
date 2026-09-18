import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import matter from "gray-matter";
import test from "node:test";

import { isNewArtifactId } from "../src/skills/lib/artifact_id";
import { migrateArtifactIds } from "../src/skills/doc-driven-dev-graph/scripts/lib/id_migration";

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "id-migration-test-"));
}

function writeDoc(repo: string, relPath: string, data: Record<string, unknown>, body: string) {
  const fullPath = path.join(repo, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, matter.stringify(body, data), "utf8");
}

function docFrontMatter(repo: string, relPath: string): Record<string, unknown> {
  return matter(fs.readFileSync(path.join(repo, relPath), "utf8")).data;
}

function legacyTask(id: string, title: string, relations: Record<string, unknown> = {}) {
  return {
    id, type: "task", status: "todo", title,
    created: "2026-08-13", updated: "2026-08-13", owners: [], relations,
  };
}

function legacySpec(id: string, title: string, relations: Record<string, unknown> = {}) {
  return {
    id, type: "spec", status: "approved", title,
    created: "2026-08-13", updated: "2026-08-13", owners: [], relations,
  };
}

test("migrates legacy ids, relations, body references, filenames, and generated index", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-schema.md", legacyTask("TASK-0001", "schema"), "# schema\n");
  writeDoc(
    repo,
    "docs/specs/0002-checkout.md",
    legacySpec("SPEC-0002", "checkout", { "implemented-by": ["TASK-0001"] }),
    "# checkout\n\nImplements TASK-0001 and links docs/tasks/0001-schema.md.\n",
  );
  fs.writeFileSync(
    path.join(repo, "docs/tasks/README.md"),
    "# TASK Documents\n\n<!-- doc-suite:generated-index -->\n\nDirectory: `docs/tasks`\n\n| ID | Title | Status | File |\n| --- | --- | --- | --- |\n| TASK-0001 | schema | todo | [0001-schema.md](./0001-schema.md) |\n",
    "utf8",
  );

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.deepEqual(report.blockers, []);
  assert.equal(report.mappings.length, 2);
  const taskMapping = report.mappings.find((mapping) => mapping.legacyId === "TASK-0001");
  assert.ok(taskMapping);
  assert.ok(isNewArtifactId(taskMapping.newId));

  assert.ok(fs.existsSync(path.join(repo, "docs/tasks/schema.md")));
  assert.ok(fs.existsSync(path.join(repo, "docs/specs/checkout.md")));
  assert.ok(!fs.existsSync(path.join(repo, "docs/tasks/0001-schema.md")));

  const taskData = docFrontMatter(repo, "docs/tasks/schema.md");
  assert.equal(taskData.id, taskMapping.newId);

  const specContent = fs.readFileSync(path.join(repo, "docs/specs/checkout.md"), "utf8");
  assert.ok(!specContent.includes("TASK-0001"));
  assert.ok(!specContent.includes("0001-schema.md"));
  assert.ok(specContent.includes(taskMapping.newId));
  assert.ok(specContent.includes("docs/tasks/schema.md"));

  const index = fs.readFileSync(path.join(repo, "docs/tasks/README.md"), "utf8");
  assert.ok(index.includes(taskMapping.newId));
  assert.ok(index.includes("schema.md"));
  assert.ok(!index.includes("TASK-0001"));

  assert.deepEqual(report.validation.remainingLegacyIds, []);
  assert.deepEqual(report.validation.duplicateIds, []);
});

test("dry-run plans mappings and renames without mutating the repo", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-schema.md", legacyTask("TASK-0001", "schema"), "# schema\n");
  const before = fs.readFileSync(path.join(repo, "docs/tasks/0001-schema.md"), "utf8");

  const report = await migrateArtifactIds({ cwd: repo });

  assert.equal(report.applied, false);
  assert.equal(report.mappings.length, 1);
  assert.equal(report.renames.length, 1);
  assert.equal(report.renames[0].from, "docs/tasks/0001-schema.md");
  assert.equal(report.renames[0].to, "docs/tasks/schema.md");
  assert.equal(fs.readFileSync(path.join(repo, "docs/tasks/0001-schema.md"), "utf8"), before);
  assert.ok(!fs.existsSync(path.join(repo, "docs/tasks/schema.md")));
});

test("locale siblings share one new id and both are renamed", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-schema.md", legacyTask("TASK-0001", "schema"), "# schema\n");
  writeDoc(repo, "docs/tasks/0001-schema.ja.md", legacyTask("TASK-0001", "schema ja"), "# schema\n");

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.deepEqual(report.blockers, []);
  assert.equal(report.mappings.length, 1);
  const enData = docFrontMatter(repo, "docs/tasks/schema.md");
  const jaData = docFrontMatter(repo, "docs/tasks/schema.ja.md");
  assert.equal(enData.id, jaData.id);
  assert.ok(isNewArtifactId(String(enData.id)));
});

test("duplicate legacy id across non-sibling files blocks without mutation", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-schema.md", legacyTask("TASK-0001", "schema"), "# schema\n");
  writeDoc(repo, "docs/tasks/0002-other.md", legacyTask("TASK-0001", "other"), "# other\n");

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.ok(report.blockers.some((blocker) => blocker.code === "duplicate-legacy-id"));
  assert.equal(fs.readFileSync(path.join(repo, "docs/tasks/0001-schema.md"), "utf8").includes("TASK-0001"), true);
  assert.ok(fs.existsSync(path.join(repo, "docs/tasks/0001-schema.md")));
});

test("rename target collision blocks without mutation", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-schema.md", legacyTask("TASK-0001", "schema"), "# numbered\n");
  writeDoc(repo, "docs/tasks/schema.md", legacyTask("TASK-0002", "schema v2"), "# existing\n");

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.ok(report.blockers.some((blocker) => blocker.code === "rename-collision"));
  assert.ok(fs.existsSync(path.join(repo, "docs/tasks/0001-schema.md")));
  assert.ok(fs.existsSync(path.join(repo, "docs/tasks/schema.md")));
});

test("unresolved legacy reference blocks without mutation", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-schema.md", legacyTask("TASK-0001", "schema", { "depends-on": ["TASK-0099"] }), "# schema\n");

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.ok(report.blockers.some((blocker) => blocker.code === "unresolved-legacy-reference"));
  assert.ok(fs.existsSync(path.join(repo, "docs/tasks/0001-schema.md")));
});

test("keeps new-format and special ids untouched", async () => {
  const repo = tempRepo();
  const newId = "TASK-034qPUpBj0VYOqxmFLijD5";
  writeDoc(repo, "docs/tasks/new-task.md", legacyTask(newId, "new task"), "# new\n");
  writeDoc(repo, "docs/designs/overview.md", {
    id: "DESIGN-OVERVIEW", type: "design", status: "draft", title: "System Design Overview",
    created: "2026-08-13", updated: "2026-08-13", owners: [], relations: {},
  }, "# System Design Overview\n");

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.deepEqual(report.blockers, []);
  assert.equal(report.mappings.length, 0);
  assert.equal(docFrontMatter(repo, "docs/tasks/new-task.md").id, newId);
  assert.equal(docFrontMatter(repo, "docs/designs/overview.md").id, "DESIGN-OVERVIEW");
});

test("numbered file without front-matter id receives a synthesized new id", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/adr/0003-use-x.md", {
    type: "adr", status: "accepted", title: "use x",
    created: "2026-08-13", updated: "2026-08-13", owners: [], relations: {},
  }, "# use x\n");

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.deepEqual(report.blockers, []);
  assert.equal(report.mappings.length, 1);
  assert.equal(report.mappings[0].legacyId, "ADR-0003");
  const data = docFrontMatter(repo, "docs/adr/use-x.md");
  assert.equal(data.id, report.mappings[0].newId);
  assert.ok(isNewArtifactId(String(data.id)));
});

test("experiment log renames update jsonl experiment paths and impl metadata", async () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/impl/exp"), { recursive: true });
  fs.mkdirSync(path.join(repo, "docs/impl/ir"), { recursive: true });
  const event = {
    schema: "experiment_event.v1",
    experiment: "docs/impl/exp/0001-foo.jsonl",
    seq: 1,
    type: "start",
    ts: "2026-08-13T00:00:00.000Z",
  };
  fs.writeFileSync(
    path.join(repo, "docs/impl/exp/0001-foo.jsonl"),
    `${JSON.stringify(event)}\n`,
    "utf8",
  );
  writeDoc(repo, "docs/impl/ir/0001-impl.md", {
    id: "IMPL-0001", type: "impl", status: "completed", title: "impl",
    created: "2026-08-13", updated: "2026-08-13", owners: [], relations: {},
    metadata: { experiments: { adopted: ["docs/impl/exp/0001-foo.jsonl"], rejected: [] } },
  }, "# impl\n");

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.deepEqual(report.blockers, []);
  assert.ok(fs.existsSync(path.join(repo, "docs/impl/exp/foo.jsonl")));
  const jsonl = fs.readFileSync(path.join(repo, "docs/impl/exp/foo.jsonl"), "utf8");
  assert.ok(jsonl.includes('"docs/impl/exp/foo.jsonl"'));
  const implContent = fs.readFileSync(path.join(repo, "docs/impl/ir/impl.md"), "utf8");
  assert.ok(implContent.includes("docs/impl/exp/foo.jsonl"));
  assert.ok(!implContent.includes("0001-foo.jsonl"));
});

test("--keep-filenames rewrites ids but preserves numbered filenames", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-schema.md", legacyTask("TASK-0001", "schema"), "# schema\n");

  const report = await migrateArtifactIds({ cwd: repo, apply: true, keepFilenames: true });

  assert.deepEqual(report.blockers, []);
  assert.equal(report.renames.length, 0);
  assert.ok(fs.existsSync(path.join(repo, "docs/tasks/0001-schema.md")));
  const data = docFrontMatter(repo, "docs/tasks/0001-schema.md");
  assert.ok(isNewArtifactId(String(data.id)));
});

test("second run is a no-op", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-schema.md", legacyTask("TASK-0001", "schema"), "# schema\n");
  await migrateArtifactIds({ cwd: repo, apply: true });

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.deepEqual(report.blockers, []);
  assert.equal(report.mappings.length, 0);
  assert.equal(report.renames.length, 0);
  assert.equal(report.rewrites.length, 0);
});

test("--apply on dirty git worktree blocks unless --allow-dirty", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-schema.md", legacyTask("TASK-0001", "schema"), "# schema\n");
  spawnSync("git", ["init"], { cwd: repo });
  spawnSync("git", ["add", "-A"], { cwd: repo });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "dirty.txt"), "dirty", "utf8");

  const blocked = await migrateArtifactIds({ cwd: repo, apply: true });
  assert.ok(blocked.blockers.some((blocker) => blocker.code === "dirty-worktree"));
  assert.ok(fs.existsSync(path.join(repo, "docs/tasks/0001-schema.md")));

  const allowed = await migrateArtifactIds({ cwd: repo, apply: true, allowDirty: true });
  assert.deepEqual(allowed.blockers.filter((blocker) => blocker.code === "dirty-worktree"), []);
  assert.ok(fs.existsSync(path.join(repo, "docs/tasks/schema.md")));
});

test("generated migrate_ids.js CLI applies migration end to end", () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-schema.md", legacyTask("TASK-0001", "schema"), "# schema\n");

  const script = path.join(skillRoot, "doc-driven-dev-graph", "scripts", "migrate_ids.js");
  const plan = spawnSync(process.execPath, [script, "--cwd", repo, "--json"], { encoding: "utf8", windowsHide: true });
  assert.equal(plan.status, 0, plan.stderr);
  const planReport = JSON.parse(plan.stdout);
  assert.equal(planReport.applied, false);
  assert.equal(planReport.mappings.length, 1);

  const applied = spawnSync(process.execPath, [script, "--cwd", repo, "--apply", "--allow-dirty", "--json"], { encoding: "utf8", windowsHide: true });
  assert.equal(applied.status, 0, applied.stderr);
  assert.ok(fs.existsSync(path.join(repo, "docs/tasks/schema.md")));
});
