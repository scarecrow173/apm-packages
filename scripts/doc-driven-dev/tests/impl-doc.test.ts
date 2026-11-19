import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/impl-doc");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "impl-doc-test-"));
}

function runScript(name: any, args: any, options: { cwd?: string } = {}) {
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

test("impl-doc ships skill docs, references, and templates", () => {
  assert.equal(fs.existsSync(path.join(skillRoot, "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(skillRoot, "SKILL.ja.md")), true);
  assert.equal(fs.existsSync(path.join(skillRoot, "references", "impl-conventions.md")), true);
  assert.equal(fs.existsSync(path.join(skillRoot, "references", "impl-conventions.ja.md")), true);
  assert.equal(fs.existsSync(path.join(skillRoot, "assets", "templates", "implementation-record.md")), true);
  assert.equal(fs.existsSync(path.join(skillRoot, "assets", "templates", "implementation-record.ja.md")), true);
  assert.equal(fs.existsSync(path.join(skillRoot, "assets", "templates", "experiment-log.jsonl")), true);
  assert.equal(fs.existsSync(path.join(skillRoot, "assets", "templates", "experiment-log.ja.jsonl")), true);
});

test("the pre-v3 impl/exp creator and mutator entrypoints are not shipped", () => {
  const repo = tempRepo();

  // Issue #249: `impl`/`exp` are legacy, migration-only types and their
  // creator/mutator entrypoints were removed outright — nothing in the
  // distribution can mint or mutate the legacy corpus.
  for (const script of [
    "new_impl_record.js",
    "new_experiment_log.js",
    "append_experiment_event.js",
    "edit_experiment_log.js",
    "sync_impl_index.js",
  ]) {
    assert.equal(
      fs.existsSync(path.join(skillRoot, "scripts", script)),
      false,
      `${script} must not ship`,
    );
  }
  assert.equal(fs.existsSync(path.join(repo, "docs/impl")), false, "no impl record is minted");
});

test("audit_impl_record reports front matter, shape, relation, and section issues", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/impl/ir"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/impl/ir/0001-invalid.md"),
    [
      "---",
      'id: "IMPL-0001"',
      'type: "impl"',
      'status: "unknown"',
      'title: "Invalid impl record"',
      'created: "2026-06-08"',
      'updated: "2026-06-08"',
      "owners: []",
      "relations:",
      "  source: []",
      "  changes:",
      '    added: ["bad-shape"]',
      "    modified: []",
      "    deleted: []",
      "    renamed: []",
      "    moved: []",
      "    generated: []",
      '  implements: ["docs/tasks/missing.md"]',
      "  implemented-by: []",
      "  depends-on: []",
      "  blocks: []",
      "  supersedes: []",
      "  superseded-by: []",
      "  related: []",
      "  refines: []",
      "  refined-by: []",
      "  derives-from: []",
      "  derived-by: []",
      "  verifies: []",
      "  verified-by: []",
      "  references: []",
      "metadata:",
      "  experiments:",
      '    adopted: ["docs/impl/exp/missing.jsonl"]',
      "    rejected: []",
      "---",
      "",
      "# Invalid impl record",
      "",
      "## Summary",
      "",
      "Only one section exists.",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runScript("audit_impl_record.js", ["--json"], { cwd: repo });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.some((finding: any) => finding.code === "invalid-front-matter"), true);

  fs.writeFileSync(
    path.join(repo, "docs/impl/ir/0001-invalid.md"),
    [
      "---",
      'id: "IMPL-0001"',
      'type: "impl"',
      'status: "completed"',
      'title: "Still invalid"',
      'created: "2026-06-08"',
      'updated: "2026-06-08"',
      "owners: []",
      "relations:",
      "  source: []",
      "  changes:",
      "    added: []",
      "    modified: []",
      "    deleted: []",
      "    renamed: []",
      "    moved: []",
      "    generated: []",
      '  implements: ["docs/tasks/missing.md"]',
      "  implemented-by: []",
      "  depends-on: []",
      "  blocks: []",
      "  supersedes: []",
      "  superseded-by: []",
      "  related: []",
      "  refines: []",
      "  refined-by: []",
      "  derives-from: []",
      "  derived-by: []",
      "  verifies: []",
      "  verified-by: []",
      "  references: []",
      "metadata:",
      "  experiments:",
      '    adopted: ["docs/impl/exp/missing.jsonl"]',
      "    rejected: []",
      "---",
      "",
      "# Still invalid",
      "",
      "## Summary",
      "",
      "Missing the remaining required sections.",
      "",
    ].join("\n"),
    "utf8",
  );

  const second = runScript("audit_impl_record.js", ["--json"], { cwd: repo });
  assert.equal(second.status, 0, second.stderr);
  const secondReport = JSON.parse(second.stdout);
  assert.equal(secondReport.findings.some((finding: any) => finding.code === "broken-relation-link"), true);
  assert.equal(secondReport.findings.some((finding: any) => finding.code === "missing-experiment-link"), true);
  assert.equal(secondReport.findings.some((finding: any) => finding.code === "missing-section"), true);
});

test("experiment log corpus stays audit-only — inspection never writes", () => {
  const repo = tempRepo();

  // Issue #249: the exp creators/mutators are gone; read-only inspection of
  // the existing legacy logs is the migration-dedicated surface.
  assert.equal(fs.existsSync(path.join(repo, "docs/impl")), false);
  fs.mkdirSync(path.join(repo, "docs/impl/exp"), { recursive: true });
  const log =
    '{"schema":"experiment_event.v1","experiment":"docs/impl/exp/x.jsonl","seq":1,"type":"hypothesis","ts":"2026-06-08T10:03:00+09:00"}\n';
  fs.writeFileSync(path.join(repo, "docs/impl/exp/x.jsonl"), log, "utf8");
  const audit = runScript("audit_experiment_log.js", ["--json"], { cwd: repo });
  assert.equal(audit.status, 0, audit.stderr);
  assert.equal(
    fs.readFileSync(path.join(repo, "docs/impl/exp/x.jsonl"), "utf8"),
    log,
    "audit must not rewrite the legacy log",
  );
});

test("audit_experiment_log reports invalid JSON, shape, seq, and type errors", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/impl/exp"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/impl/exp/0001-invalid.jsonl"),
    [
      '{"schema":"experiment_event.v1","experiment":"docs/impl/exp/0001-invalid.jsonl","seq":1,"type":"hypothesis","ts":"2026-06-08T10:03:00+09:00"}',
      '{"schema":"experiment_event.v1","experiment":"docs/impl/exp/0001-invalid.jsonl","seq":"bad","type":"change","ts":"2026-06-08T10:04:00+09:00"}',
      '{"schema":"experiment_event.v1","experiment":"docs/impl/exp/0001-invalid.jsonl","seq":1,"type":"nope","ts":"2026-06-08T10:05:00+09:00"}',
      'not-json',
    ].join("\n"),
    "utf8",
  );

  const result = runScript("audit_experiment_log.js", ["--json"], { cwd: repo });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.some((finding: any) => finding.code === "invalid-json"), true);
  assert.equal(report.findings.some((finding: any) => finding.code === "invalid-event-shape"), true);
  assert.equal(report.findings.some((finding: any) => finding.code === "non-monotonic-seq"), true);
  assert.equal(report.findings.some((finding: any) => finding.code === "invalid-event-type"), true);
});
