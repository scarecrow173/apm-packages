import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ddd-regressions-"));
}

function runScript(skill: string, name: string, args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(skillRoot, skill, "scripts", name), ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function writeDoc(dir: string, file: string, frontMatter: Record<string, unknown>, body = "# Doc\n") {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(frontMatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  fs.writeFileSync(path.join(dir, file), `---\n${lines}\n---\n\n${body}`, "utf8");
}

test("audit_docs reports unparseable front matter instead of crashing", () => {
  const repo = tempRepo();
  const dir = path.join(repo, "docs/tasks");
  writeDoc(dir, "0001-good.md", {
    id: "TASK-0001", type: "task", status: "todo", title: "Good",
    created: "2026-09-15", updated: "2026-09-15", owners: [], relations: {},
  });
  fs.writeFileSync(path.join(dir, "0002-bad.md"), '---\ntitle: "unclosed\n---\n# bad\n', "utf8");

  const audit = runScript("doc-status", "audit_docs.js", ["--type", "task"], repo);
  assert.equal(audit.status, 0, audit.stderr);
  assert.match(audit.stdout, /unparseable-front-matter|not valid YAML/);

  const list = runScript("doc-status", "list_docs.js", ["--type", "task"], repo);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /0001-good\.md/);
});

test("new_task rejects an unknown status before writing any file", () => {
  const repo = tempRepo();
  const res = runScript("task-doc", "new_task.js", ["--title", "Sample", "--status", "bogus"], repo);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Invalid task status/);
  const dir = path.join(repo, "docs/tasks");
  const docs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
  assert.deepEqual(docs, []);
});

test("new_task rejects a status containing YAML-breaking characters", () => {
  const repo = tempRepo();
  const res = runScript("task-doc", "new_task.js", ["--title", "Sample", "--status", 'a"b'], repo);
  assert.equal(res.status, 1);
  const dir = path.join(repo, "docs/tasks");
  assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0);
});

test("new_spec rejects a malformed --date before writing", () => {
  const repo = tempRepo();
  const res = runScript("spec-doc", "new_spec.js", ["--title", "X", "--date", "Sept 1"], repo);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Invalid date/);
});

test("generated index escapes pipe characters in titles", () => {
  const repo = tempRepo();
  const res = runScript("task-doc", "new_task.js", ["--title", "Use A | B"], repo);
  assert.equal(res.status, 0, res.stderr);
  const readme = fs.readFileSync(path.join(repo, "docs/tasks/README.md"), "utf8");
  assert.ok(readme.includes("A \\| B"), readme);
});

test("new_adr preserves a hand-curated README index", () => {
  const repo = tempRepo();
  const dir = path.join(repo, "docs/adr");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# Hand-curated ADR index\n\nKeep this prose.\n", "utf8");
  const res = runScript("adr-doc", "new_adr.js", ["--title", "Use Redis"], repo);
  assert.equal(res.status, 0, res.stderr);
  const readme = fs.readFileSync(path.join(dir, "README.md"), "utf8");
  assert.ok(readme.includes("Keep this prose"), "hand-curated README must not be overwritten");
  assert.match(`${res.stdout}\n${res.stderr}`, /hand-curated/);
});

test("new_adr generated index carries the generated-index marker", () => {
  const repo = tempRepo();
  const res = runScript("adr-doc", "new_adr.js", ["--title", "Use Redis"], repo);
  assert.equal(res.status, 0, res.stderr);
  const readme = fs.readFileSync(path.join(repo, "docs/adr/README.md"), "utf8");
  assert.ok(readme.includes("<!-- doc-suite:generated-index -->"), readme);
});

test("brainstorm and discovery documents sharing docs/discovery do not cross-flag", () => {
  const repo = tempRepo();
  const created = runScript("discovery-doc", "new_discovery.js", ["--title", "Research A"], repo);
  assert.equal(created.status, 0, created.stderr);
  writeDoc(path.join(repo, "docs/discovery"), "0002-idea-x.md", {
    id: "BRAINSTORM-0001", type: "brainstorm", status: "capturing", title: "Idea X",
    created: "2026-09-15", updated: "2026-09-15", owners: [], relations: {},
  });

  const discovery = runScript("doc-status", "audit_docs.js", ["--type", "discovery"], repo);
  assert.equal(discovery.status, 0, discovery.stderr);
  assert.ok(!discovery.stdout.includes("0002-idea-x.md"), discovery.stdout);

  const brainstorm = runScript("doc-status", "audit_docs.js", ["--type", "brainstorm"], repo);
  assert.equal(brainstorm.status, 0, brainstorm.stderr);
  assert.ok(!brainstorm.stdout.includes("research-a.md"), brainstorm.stdout);
});

test("new_adr assigns opaque ADR ids alongside legacy ids", () => {
  const repo = tempRepo();
  const dir = path.join(repo, "docs/adr");
  writeDoc(dir, "use-postgres.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "Use Postgres",
    created: "2026-09-15", updated: "2026-09-15", owners: [], relations: {},
  });
  const res = runScript("adr-doc", "new_adr.js", ["--title", "Second decision"], repo);
  assert.equal(res.status, 0, res.stderr);
  const created = fs.readFileSync(path.join(dir, "second-decision.md"), "utf8");
  assert.match(created, /id: "ADR-[0-9A-Za-z]{22}"/);
  assert.doesNotMatch(created, /id: "ADR-0001"/);
});

test("localized index files are not audited as documents", () => {
  const repo = tempRepo();
  const dir = path.join(repo, "docs/tasks");
  writeDoc(dir, "0001-task.md", {
    id: "TASK-0001", type: "task", status: "todo", title: "Task",
    created: "2026-09-15", updated: "2026-09-15", owners: [], relations: {},
  });
  fs.writeFileSync(path.join(dir, "README.ja.md"), "# タスク一覧\n", "utf8");
  const res = runScript("doc-status", "audit_docs.js", ["--type", "task"], repo);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!res.stdout.includes("README.ja.md"), res.stdout);
});

test("relate_adr writes nothing when the inverse target is missing", () => {
  const repo = tempRepo();
  const dir = path.join(repo, "docs/adr");
  const before = "---\nid: \"ADR-0001\"\ntype: \"adr\"\nstatus: \"accepted\"\ntitle: \"A\"\ncreated: \"2026-09-15\"\nupdated: \"2026-09-15\"\nowners: []\nrelations: {}\n---\n\n# A\n";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "a.md"), before, "utf8");
  const res = runScript("adr-doc", "relate_adr.js", ["--from", "a.md", "--to", "missing.md", "--relation", "related", "--write"], repo);
  assert.equal(res.status, 1);
  assert.equal(fs.readFileSync(path.join(dir, "a.md"), "utf8"), before);
});

test("experiment log summary containing quotes produces valid JSONL", () => {
  const repo = tempRepo();
  const res = runScript("impl-doc", "new_experiment_log.js", ["--title", "exp", "--type", "start", "--summary", 'say "hi"'], repo);
  assert.equal(res.status, 0, res.stderr);
  const dir = path.join(repo, "docs/impl/exp");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  assert.equal(files.length, 1);
  const events = fs.readFileSync(path.join(dir, files[0]), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(events[0].summary, 'say "hi"');
});

test("append_experiment_event preserves unparseable existing lines", () => {
  const repo = tempRepo();
  const dir = path.join(repo, "docs/impl/exp");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "exp.jsonl");
  fs.writeFileSync(
    file,
    '{"schema":"experiment_event.v1","experiment":"docs/impl/exp/exp.jsonl","seq":1,"type":"start","ts":"2026-09-15T00:00:00Z"}\n{corrupt line\n',
    "utf8",
  );
  const res = runScript("impl-doc", "append_experiment_event.js", ["--file", "docs/impl/exp/exp.jsonl", "--type", "observation"], repo);
  assert.equal(res.status, 0, res.stderr);
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[1], "{corrupt line");
  assert.equal(JSON.parse(lines[2]).seq, 2);
});
