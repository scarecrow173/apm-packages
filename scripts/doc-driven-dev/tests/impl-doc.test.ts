const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/impl-doc");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "impl-doc-test-"));
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

test("new_impl_record creates markdown record and index", () => {
  const repo = tempRepo();

  const result = runScript(
    "new_impl_record.js",
    ["--title", "Extract foo service", "--task", "docs/tasks/0003-implement-foo-service.md", "--status", "completed"],
    { cwd: repo },
  );

  assert.equal(result.status, 0, result.stderr);
  const recordPath = path.join(repo, "docs/impl/ir/0001-extract-foo-service.md");
  const indexPath = path.join(repo, "docs/impl/ir/README.md");
  assert.equal(fs.existsSync(recordPath), true);
  assert.equal(fs.existsSync(indexPath), true);

  const record = fs.readFileSync(recordPath, "utf8");
  assert.match(record, /^id: "IMPL-0001"$/m);
  assert.match(record, /^type: "impl"$/m);
  assert.match(record, /^status: "completed"$/m);
  assert.match(record, /^title: "Extract foo service"$/m);
  assert.match(record, /^  changes:$/m);
  assert.match(record, /^    added: \[\]$/m);
  assert.match(record, /^  implements:$/m);
  assert.match(record, /^    - "docs\/tasks\/0003-implement-foo-service.md"$/m);
  assert.match(record, /^metadata:$/m);
  assert.match(record, /^  experiments:$/m);
  assert.match(record, /^    adopted: \[\]$/m);
  assert.match(record, /^    rejected: \[\]$/m);
  assert.doesNotMatch(record, /record-type/);
  assert.doesNotMatch(record, /validation:/);
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
  assert.equal(report.findings.some((finding) => finding.code === "invalid-front-matter"), true);

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
  assert.equal(secondReport.findings.some((finding) => finding.code === "broken-relation-link"), true);
  assert.equal(secondReport.findings.some((finding) => finding.code === "missing-experiment-link"), true);
  assert.equal(secondReport.findings.some((finding) => finding.code === "missing-section"), true);
});

test("experiment log creation, append, edit, and audit work together", () => {
  const repo = tempRepo();

  const created = runScript(
    "new_experiment_log.js",
    ["--title", "Try foo service extraction", "--task", "docs/tasks/0003-implement-foo-service.md"],
    { cwd: repo },
  );
  assert.equal(created.status, 0, created.stderr);

  const logPath = path.join(repo, "docs/impl/exp/0001-try-foo-service-extraction.jsonl");
  assert.equal(fs.existsSync(logPath), true);
  assert.equal(fs.readFileSync(logPath, "utf8"), "");

  const appended = runScript(
    "append_experiment_event.js",
    [
      "--file",
      "docs/impl/exp/0001-try-foo-service-extraction.jsonl",
      "--type",
      "hypothesis",
      "--summary",
      "FooService may simplify BarService",
      "--set",
      "implementation=docs/impl/ir/0001-extract-foo-service.md",
    ],
    { cwd: repo },
  );
  assert.equal(appended.status, 0, appended.stderr);

  const linesAfterAppend = fs.readFileSync(logPath, "utf8").trim().split(/\r?\n/);
  assert.equal(linesAfterAppend.length, 1);
  const firstEvent = JSON.parse(linesAfterAppend[0]);
  assert.equal(firstEvent.seq, 1);
  assert.equal(firstEvent.type, "hypothesis");
  assert.equal(firstEvent.summary, "FooService may simplify BarService");
  assert.equal(firstEvent.implementation, "docs/impl/ir/0001-extract-foo-service.md");
  assert.equal(firstEvent.schema, "experiment_event.v1");
  assert.equal(firstEvent.experiment, "docs/impl/exp/0001-try-foo-service-extraction.jsonl");
  assert.equal(typeof firstEvent.ts, "string");

  const edited = runScript(
    "edit_experiment_log.js",
    [
      "--file",
      "docs/impl/exp/0001-try-foo-service-extraction.jsonl",
      "--seq",
      "1",
      "--set",
      "reason=adopted into implementation record",
    ],
    { cwd: repo },
  );
  assert.equal(edited.status, 0, edited.stderr);

  const editedEvent = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
  assert.equal(editedEvent.seq, 1);
  assert.equal(editedEvent.reason, "adopted into implementation record");

  const audit = runScript("audit_experiment_log.js", ["--json"], { cwd: repo });
  assert.equal(audit.status, 0, audit.stderr);
  const report = JSON.parse(audit.stdout);
  assert.equal(report.findings.length, 0);
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
  assert.equal(report.findings.some((finding) => finding.code === "invalid-json"), true);
  assert.equal(report.findings.some((finding) => finding.code === "invalid-event-shape"), true);
  assert.equal(report.findings.some((finding) => finding.code === "non-monotonic-seq"), true);
  assert.equal(report.findings.some((finding) => finding.code === "invalid-event-type"), true);
});
