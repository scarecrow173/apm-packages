import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import matter from "gray-matter";
import test from "node:test";

import { isNewArtifactId } from "../src/skills/lib/artifact_id";
import { migrateArtifactIds } from "../src/skills/doc-maintenance/scripts/lib/id_migration";

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

test("root-level canonical dirs are rewritten and renamed", async () => {
  const repo = tempRepo();
  writeDoc(repo, "specs/0001-checkout.md", legacySpec("SPEC-0001", "checkout"), "# checkout\n");
  writeDoc(repo, "tasks/0001-wire.md", {
    ...legacyTask("TASK-0001", "wire", { "depends-on": ["SPEC-0001"] }),
  }, "# wire\n\nSee SPEC-0001 and specs/0001-checkout.md.\n");

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.deepEqual(report.blockers, []);
  assert.equal(report.mappings.length, 2);
  assert.ok(fs.existsSync(path.join(repo, "specs/checkout.md")));
  assert.ok(fs.existsSync(path.join(repo, "tasks/wire.md")));
  const specData = docFrontMatter(repo, "specs/checkout.md");
  const specMapping = report.mappings.find((mapping) => mapping.legacyId === "SPEC-0001");
  assert.equal(specData.id, specMapping?.newId);
  const taskContent = fs.readFileSync(path.join(repo, "tasks/wire.md"), "utf8");
  assert.ok(!taskContent.includes("SPEC-0001"));
  assert.ok(!taskContent.includes("0001-checkout.md"));
  assert.ok(taskContent.includes(String(specMapping?.newId)));
});

test("numbered markdown without front matter blocks before mutation", async () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/adr/0003-use-x.md"), "# 3. use x\n\nplain MADR without front matter\n", "utf8");
  writeDoc(repo, "docs/tasks/0001-schema.md", legacyTask("TASK-0001", "schema"), "# schema\n");

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.ok(report.blockers.some((blocker) => blocker.code === "missing-front-matter"));
  assert.ok(fs.existsSync(path.join(repo, "docs/adr/0003-use-x.md")));
  assert.ok(fs.existsSync(path.join(repo, "docs/tasks/0001-schema.md")));
});

test("rename chains never clobber existing files", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-0002-foo.md", legacyTask("TASK-0001", "outer"), "# outer doc\n");
  writeDoc(repo, "docs/tasks/0002-foo.md", legacyTask("TASK-0002", "inner"), "# inner doc\n");

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.deepEqual(report.blockers, []);
  const outer = fs.readFileSync(path.join(repo, "docs/tasks/0002-foo.md"), "utf8");
  const inner = fs.readFileSync(path.join(repo, "docs/tasks/foo.md"), "utf8");
  assert.ok(outer.includes("# outer doc"));
  assert.ok(inner.includes("# inner doc"));
  assert.ok(!fs.existsSync(path.join(repo, "docs/tasks/0001-0002-foo.md")));
});

test("secondary canonical dir regenerates its index with the correct type", async () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/specs"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/specs/README.md"),
    "# SPEC Documents\n\n<!-- doc-suite:generated-index -->\n\nDirectory: `docs/specs`\n\n| ID | Title | Status | File |\n| --- | --- | --- | --- |\n",
    "utf8",
  );
  writeDoc(repo, "specs/0001-checkout.md", legacySpec("SPEC-0001", "checkout"), "# checkout\n");
  fs.writeFileSync(
    path.join(repo, "specs/README.md"),
    "# SPEC Documents\n\n<!-- doc-suite:generated-index -->\n\nDirectory: `specs`\n\n| ID | Title | Status | File |\n| --- | --- | --- | --- |\n| SPEC-0001 | checkout | approved | [0001-checkout.md](./0001-checkout.md) |\n",
    "utf8",
  );

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.deepEqual(report.blockers, []);
  const index = fs.readFileSync(path.join(repo, "specs/README.md"), "utf8");
  assert.ok(index.includes("SPEC Documents"));
  assert.ok(index.includes("checkout.md"));
  assert.ok(!index.includes("DISC Documents"));
  assert.ok(!index.includes("SPEC-0001"));
});

test("existing migrate-temp path blocks before mutation", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-schema.md", legacyTask("TASK-0001", "schema"), "# schema\n");
  fs.writeFileSync(path.join(repo, "docs/tasks/0001-schema.md.migrate-tmp"), "leftover", "utf8");

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.ok(report.blockers.some((blocker) => blocker.code === "rename-temp-collision"));
  assert.equal(report.ok, false);
  assert.equal(fs.readFileSync(path.join(repo, "docs/tasks/0001-schema.md.migrate-tmp"), "utf8"), "leftover");
  assert.ok(fs.existsSync(path.join(repo, "docs/tasks/0001-schema.md")));
});

test("post-apply audit errors mark the report as failed", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/impl/ir/0001-rec.md", {
    id: "IMPL-0001", type: "impl", status: "completed", title: "rec",
    created: "2026-08-13", updated: "2026-08-13", owners: [], relations: {},
    metadata: { experiments: { adopted: [], rejected: [] } },
  }, "# rec\n");

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.deepEqual(report.blockers, []);
  assert.equal(report.ok, false);
  assert.ok(report.validation.auditErrors.some((error) => error.code === "missing-section"));
});

test("generated migrate_ids.js CLI applies migration end to end", () => {
  const repo = tempRepo();
  writeDoc(
    repo,
    "docs/tasks/0001-schema.md",
    legacyTask("TASK-0001", "schema", { implements: ["IDEA-0001"] }),
    "# schema\n",
  );
  writeDoc(repo, "docs/ideas/spark.md", {
    id: "IDEA-0001", type: "idea", status: "draft", title: "spark",
    created: "2026-08-13", updated: "2026-08-13", owners: [], relations: {},
  }, "# spark\n");
  for (const dir of ["docs/tasks", "docs/ideas"]) {
    fs.writeFileSync(
      path.join(repo, dir, "README.md"),
      "# Index\n\n<!-- doc-suite:generated-index -->\n\nDirectory: `" + dir + "`\n\n| ID | Title | Status | File |\n| --- | --- | --- | --- |\n",
      "utf8",
    );
  }

  const script = path.join(skillRoot, "doc-driven-dev-graph", "scripts", "migrate_ids.js");
  const plan = spawnSync(process.execPath, [script, "--cwd", repo, "--json"], { encoding: "utf8", windowsHide: true });
  assert.equal(plan.status, 0, plan.stderr);
  const planReport = JSON.parse(plan.stdout);
  assert.equal(planReport.applied, false);
  assert.equal(planReport.mappings.length, 2);

  const applied = spawnSync(process.execPath, [script, "--cwd", repo, "--apply", "--allow-dirty", "--json"], { encoding: "utf8", windowsHide: true });
  assert.equal(applied.status, 0, applied.stderr);
  assert.ok(fs.existsSync(path.join(repo, "docs/tasks/schema.md")));
});

test("post-apply validation fails on warning-severity blocking findings", async () => {
  const repo = tempRepo();
  writeDoc(
    repo,
    "docs/tasks/0001-schema.md",
    legacyTask("TASK-0001", "schema", { "depends-on": ["missing.md"] }),
    "# schema\n",
  );

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.equal(report.ok, false);
  assert.ok(
    report.validation.auditErrors.some((error) => error.code === "broken-relation-link"),
    `expected broken-relation-link in ${JSON.stringify(report.validation.auditErrors)}`,
  );
});

test("post-apply validation audits every resident type in a shared directory", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/discovery/0001-idea.md", {
    id: "BRAINSTORM-0001", type: "brainstorm", status: "capturing", title: "idea",
    created: "2026-08-13", updated: "2026-08-13", owners: [], relations: {},
  }, "# idea\n");
  writeDoc(repo, "docs/discovery/0002-research.md", {
    id: "DISC-0002", type: "discovery", status: "draft", title: "research",
    created: "2026-08-13", updated: "2026-08-13", owners: [],
    relations: { "depends-on": ["missing.md"], source: ["https://example.com/evidence"] },
  }, "# research\n");

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.equal(report.ok, false);
  assert.ok(
    report.validation.auditErrors.some(
      (error) => error.code === "broken-relation-link" && error.file === "research.md",
    ),
    `expected discovery-scope broken-relation-link in ${JSON.stringify(report.validation.auditErrors)}`,
  );
});

test("doc-maintenance migrate_ids.js is the canonical entrypoint and graph path is a compatible wrapper", () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-schema.md", legacyTask("TASK-0001", "schema"), "# schema\n");

  const canonical = path.join(skillRoot, "doc-maintenance", "scripts", "migrate_ids.js");
  const compat = path.join(skillRoot, "doc-driven-dev-graph", "scripts", "migrate_ids.js");
  for (const script of [canonical, compat]) {
    const plan = spawnSync(process.execPath, [script, "--cwd", repo, "--json"], { encoding: "utf8", windowsHide: true });
    assert.equal(plan.status, 0, `${script}: ${plan.stderr}`);
    const report = JSON.parse(plan.stdout);
    assert.equal(report.applied, false);
    assert.equal(report.mappings.length, 1);
    assert.equal(report.mappings[0].legacyId, "TASK-0001");
    assert.deepEqual(report.blockers, []);
    assert.ok(isNewArtifactId(report.mappings[0].newId));
  }
});

test("EXP-NNNN references are rewritten to the experiment log path", async () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/impl/exp"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/impl/exp/0001-foo.jsonl"),
    `${JSON.stringify({
      schema: "experiment_event.v1",
      experiment: "docs/impl/exp/0001-foo.jsonl",
      seq: 1,
      type: "start",
      ts: "2026-08-13T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
  writeDoc(
    repo,
    "docs/specs/0001-checkout.md",
    legacySpec("SPEC-0001", "checkout"),
    "# checkout\n\nSee EXP-0001 for the measurement history.\n",
  );

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.deepEqual(report.blockers, []);
  assert.ok(fs.existsSync(path.join(repo, "docs/impl/exp/foo.jsonl")));
  const specContent = fs.readFileSync(path.join(repo, "docs/specs/checkout.md"), "utf8");
  assert.ok(!specContent.includes("EXP-0001"));
  assert.ok(specContent.includes("docs/impl/exp/foo.jsonl"));
  assert.ok(report.rewrites.some((rewrite) => rewrite.file === "docs/specs/0001-checkout.md"));
});

test("EXP-NNNN with no matching experiment log blocks as unresolved-legacy-reference", async () => {
  const repo = tempRepo();
  writeDoc(
    repo,
    "docs/specs/0001-checkout.md",
    legacySpec("SPEC-0001", "checkout"),
    "# checkout\n\nSee EXP-0099 for the measurement history.\n",
  );

  const report = await migrateArtifactIds({ cwd: repo });

  assert.equal(report.ok, false);
  assert.ok(
    report.blockers.some(
      (blocker) => blocker.code === "unresolved-legacy-reference" && blocker.message.includes("EXP-0099"),
    ),
  );
  assert.ok(fs.existsSync(path.join(repo, "docs/specs/0001-checkout.md")));
});

test("EXP-NNNN matching multiple experiment logs blocks as ambiguous", async () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/impl/exp"), { recursive: true });
  for (const name of ["0001-a.jsonl", "0001-b.jsonl"]) {
    fs.writeFileSync(path.join(repo, "docs/impl/exp", name), "{}\n", "utf8");
  }
  writeDoc(
    repo,
    "docs/specs/0001-checkout.md",
    legacySpec("SPEC-0001", "checkout"),
    "# checkout\n\nSee EXP-0001 for the measurement history.\n",
  );

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.ok(
    report.blockers.some(
      (blocker) => blocker.code === "ambiguous-experiment-reference" && blocker.message.includes("EXP-0001"),
    ),
  );
  const specContent = fs.readFileSync(path.join(repo, "docs/specs/0001-checkout.md"), "utf8");
  assert.ok(specContent.includes("EXP-0001"));
});

test("--keep-filenames rewrites EXP-NNNN to the numbered experiment path", async () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/impl/exp"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/impl/exp/0001-foo.jsonl"), "{}\n", "utf8");
  writeDoc(
    repo,
    "docs/specs/0001-checkout.md",
    legacySpec("SPEC-0001", "checkout"),
    "# checkout\n\nSee EXP-0001 for the measurement history.\n",
  );

  const report = await migrateArtifactIds({ cwd: repo, apply: true, keepFilenames: true });

  assert.deepEqual(report.blockers, []);
  const specContent = fs.readFileSync(path.join(repo, "docs/specs/0001-checkout.md"), "utf8");
  assert.ok(!specContent.includes("EXP-0001"));
  assert.ok(specContent.includes("docs/impl/exp/0001-foo.jsonl"));
});

test("root-level AGENTS.md references are rewritten", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-schema.md", legacyTask("TASK-0001", "schema"), "# schema\n");
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Agents\n\nSee TASK-0001 for the work.\n", "utf8");

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.deepEqual(report.blockers, []);
  const mapping = report.mappings.find((entry) => entry.legacyId === "TASK-0001");
  assert.ok(mapping);
  const agents = fs.readFileSync(path.join(repo, "AGENTS.md"), "utf8");
  assert.ok(!agents.includes("TASK-0001"));
  assert.ok(agents.includes(mapping.newId));
  assert.ok(report.rewrites.some((rewrite) => rewrite.file === "AGENTS.md"));
});

test("unresolved legacy tokens in root-level docs block the run", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-schema.md", legacyTask("TASK-0001", "schema"), "# schema\n");
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Agents\n\nSee ADR-0025 for context.\n", "utf8");

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.ok(
    report.blockers.some(
      (blocker) => blocker.code === "unresolved-legacy-reference"
        && blocker.file === "AGENTS.md"
        && blocker.message.includes("ADR-0025"),
    ),
  );
  assert.ok(fs.existsSync(path.join(repo, "docs/tasks/0001-schema.md")));
  assert.ok(fs.readFileSync(path.join(repo, "AGENTS.md"), "utf8").includes("TASK-0001") === false);
});

test("non-doc-suite tokens in expanded scope do not block", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-schema.md", legacyTask("TASK-0001", "schema"), "# schema\n");
  fs.writeFileSync(path.join(repo, "README.md"), "# Readme\n\nFiles must be UTF-8 per RFC-2119.\n", "utf8");

  const report = await migrateArtifactIds({ cwd: repo });

  assert.deepEqual(report.blockers, []);
});

test("distributed .apm skill documents under packages/ are rewritten", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/discovery/0009-research.md", {
    id: "DISC-0009", type: "discovery", status: "draft", title: "research",
    created: "2026-08-13", updated: "2026-08-13", owners: [],
    relations: { source: ["https://example.com/evidence"] },
  }, "# research\n");
  const skillDir = path.join(repo, "packages/apm/.apm/skills/usage");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    "# Usage\n\nDerived from DISC-0009 and docs/discovery/0009-research.md.\n",
    "utf8",
  );

  const report = await migrateArtifactIds({ cwd: repo, apply: true });

  assert.deepEqual(report.blockers, []);
  const mapping = report.mappings.find((entry) => entry.legacyId === "DISC-0009");
  assert.ok(mapping);
  const skill = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  assert.ok(!skill.includes("DISC-0009"));
  assert.ok(skill.includes(mapping.newId));
  assert.ok(skill.includes("docs/discovery/research.md"));
});

test("--extra-root extends the scan scope and escapes are blocked", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-schema.md", legacyTask("TASK-0001", "schema"), "# schema\n");
  const extraDir = path.join(repo, "guides");
  fs.mkdirSync(extraDir, { recursive: true });
  fs.writeFileSync(path.join(extraDir, "onboarding.md"), "# Guide\n\nSee TASK-0001.\n", "utf8");

  const scoped = await migrateArtifactIds({ cwd: repo, apply: true, extraRoots: ["guides"] });
  const mapping = scoped.mappings.find((entry) => entry.legacyId === "TASK-0001");
  assert.ok(mapping);
  const guide = fs.readFileSync(path.join(extraDir, "onboarding.md"), "utf8");
  assert.ok(!guide.includes("TASK-0001"));
  assert.ok(guide.includes(mapping.newId));

  const escaping = await migrateArtifactIds({ cwd: repo, extraRoots: ["../outside"] });
  assert.ok(escaping.blockers.some((blocker) => blocker.code === "invalid-extra-root"));

  const missing = await migrateArtifactIds({ cwd: repo, extraRoots: ["no-such-dir"] });
  assert.ok(missing.blockers.some((blocker) => blocker.code === "invalid-extra-root"));
});
