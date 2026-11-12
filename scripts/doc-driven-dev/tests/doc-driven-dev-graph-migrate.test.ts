import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceCli = path.resolve(__dirname, "../src/skills/doc-driven-dev-graph/scripts/migrate_docs.ts");
const tsxCli = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-driven-dev-graph-migrate-"));
}

function runMigrate(cwd: any, args: string[] = []) {
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
  const target = path.join(repo, "docs", "specs", "payment-spec.md");
  assert.equal(fs.existsSync(target), true);
  const content = fs.readFileSync(target, "utf8");
  assert.match(content, /^id: "SPEC-[0-9A-Za-z]{22}"$/m);
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
  assert.equal(fs.existsSync(path.join(repo, "docs", "ideas", "first-idea.md")), true);
  assert.equal(fs.existsSync(path.join(repo, "docs", "ideas", "second-idea.md")), true);
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

test("migrate_docs plan skips content-guessed ADR/IR/EXP routes", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  // Each source pattern-routes into an owner dir (type:null route). Note the
  // titles must not hit earlier typed routes — e.g. /architecture/ would
  // claim the file for docs/designs before /decision/ sees it.
  fs.writeFileSync(path.join(repo, "docs", "old-decision.md"), "# Decision: keep JSONL logs\n\nWe decided...\n", "utf8");
  fs.writeFileSync(path.join(repo, "docs", "ir-note.md"), "# Implementation Record: cache layer\n\nnotes...\n", "utf8");
  fs.writeFileSync(path.join(repo, "docs", "exp-note.md"), "# Experiment: spike on caching\n\nresults...\n", "utf8");

  const result = runMigrate(repo, ["--from", "docs", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.migrations.length, 0, `owner routes must not be planned: ${result.stdout}`);
  assert.deepEqual(
    report.skipped,
    [
      { file: "docs/exp-note.md", reason: "unsupported-owner-route" },
      { file: "docs/ir-note.md", reason: "unsupported-owner-route" },
      { file: "docs/old-decision.md", reason: "unsupported-owner-route" },
    ],
  );
});

test("migrate_docs --apply refuses to write into owner dirs; source unchanged", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  const src = path.join(repo, "docs", "exp-note.md");
  fs.writeFileSync(src, "# Experiment: spike on caching\n\nresults...\n", "utf8");
  const before = fs.readFileSync(src, "utf8");

  const result = runMigrate(repo, ["--from", "docs", "--apply", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.skipped, [
    { file: "docs/exp-note.md", reason: "unsupported-owner-route" },
  ]);
  assert.equal(
    fs.existsSync(path.join(repo, "docs", "impl", "exp", "exp-note.md")),
    false,
    "no .md may be written into the exp owner dir",
  );
  assert.equal(fs.readFileSync(src, "utf8"), before, "refused migrations never touch the source");
});

test("migrate_docs keeps typed adr routes writing into docs/adr", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  // A declared `type: adr` in front matter is a typed route, not a content
  // guess: migrate_docs is a declared mutator for docs/adr and the emitted
  // schema is valid, so it still routes and writes (Issue #188).
  fs.writeFileSync(
    path.join(repo, "docs", "typed-adr.md"),
    "---\ntype: adr\ntitle: \"Keep JSONL logs\"\n---\n\n# Decision: keep JSONL logs\n\nBody.\n",
    "utf8",
  );

  const result = runMigrate(repo, ["--from", "docs", "--apply", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.migrations.length, 1);
  assert.equal(report.migrations[0].targetDir, "docs/adr");
  assert.equal(report.migrations[0].type, "adr");
  assert.equal(report.skipped.length, 0);
  const target = path.join(repo, report.migrations[0].target);
  assert.equal(fs.existsSync(target), true, `typed adr target missing: ${report.migrations[0].target}`);
  const content = fs.readFileSync(target, "utf8");
  assert.match(content, /^id: "ADR-[0-9A-Za-z]{22}"$/m);
  assert.match(content, /^type: "adr"$/m);
});

test("migrate_docs --apply rejects a symlinked canonical target dir", (t) => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  // A spec-typed source keeps a typed route to docs/specs — but docs/specs is
  // a junction to outside the checkout, so apply must hard-fail rather than
  // write through the link.
  fs.writeFileSync(path.join(repo, "docs", "new-spec.md"), "---\ntype: spec\ntitle: X\n---\n\nbody\n", "utf8");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
  try {
    fs.symlinkSync(outside, path.join(repo, "docs", "specs"), process.platform === "win32" ? "junction" : "dir");
  } catch (error: unknown) {
    t.skip(`cannot create symlinks/junctions here: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const result = runMigrate(repo, ["--from", "docs", "--apply"]);

  assert.notEqual(result.status, 0, "an escaping canonical target must fail closed");
  assert.match(`${result.stdout}\n${result.stderr}`, /migrate target escapes the checkout/);
  assert.equal(fs.readdirSync(outside).length, 0, "nothing may be written through the link");
});
