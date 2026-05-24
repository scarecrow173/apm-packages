const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const skillRoot = path.resolve(__dirname, "../.apm/skills");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-suite-test-"));
}

function runScript(skill, name, args, options = {}) {
  const result = spawnSync(
    process.execPath,
    [path.join(skillRoot, skill, "scripts", name), ...args],
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

test("new_spec creates front matter spec and index", () => {
  const repo = tempRepo();

  const result = runScript("spec-doc", "new_spec.js", ["--title", "Define checkout flow"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const specPath = path.join(repo, "docs/specs/0001-define-checkout-flow.md");
  assert.equal(fs.existsSync(specPath), true);
  assert.equal(fs.existsSync(path.join(repo, "docs/specs/README.md")), true);

  const spec = fs.readFileSync(specPath, "utf8");
  assert.match(spec, /^id: "SPEC-0001"$/m);
  assert.match(spec, /^type: "spec"$/m);
  assert.match(spec, /^status: "draft"$/m);
  assert.match(spec, /^title: "Define checkout flow"$/m);
  assert.match(spec, /^relations:$/m);
  assert.match(spec, /^  source: \[\]$/m);
  assert.match(spec, /^  implements: \[\]$/m);
  assert.match(spec, /^  references: \[\]$/m);
  assert.match(spec, /^# Define checkout flow/m);
});

test("doc skills ship conventions and templates", () => {
  for (const [skill, convention, template] of [
    ["spec-doc", "spec-conventions.md", "spec.md"],
    ["spec-doc", "spec-conventions.ja.md", "spec.ja.md"],
    ["plan-doc", "plan-conventions.md", "plan.md"],
    ["plan-doc", "plan-conventions.ja.md", "plan.ja.md"],
    ["task-doc", "task-conventions.md", "task.md"],
    ["task-doc", "task-conventions.ja.md", "task.ja.md"],
  ]) {
    assert.equal(fs.existsSync(path.join(skillRoot, skill, "references", convention)), true);
    assert.equal(fs.existsSync(path.join(skillRoot, skill, "assets/templates", template)), true);
  }
});

test("doc conventions cover directory order, filenames, mutability, and categories", () => {
  for (const [skill, convention] of [
    ["spec-doc", "spec-conventions.md"],
    ["plan-doc", "plan-conventions.md"],
    ["task-doc", "task-conventions.md"],
  ]) {
    const text = fs.readFileSync(path.join(skillRoot, skill, "references", convention), "utf8");
    assert.match(text, /Detection order used by scripts:/);
    assert.match(text, /Rules:/);
    assert.match(text, /## Mutability/);
    assert.match(text, /## Categories/);
  }
});

test("new_spec uses the packaged spec template", () => {
  const repo = tempRepo();

  const result = runScript("spec-doc", "new_spec.js", ["--title", "Template driven spec"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const spec = fs.readFileSync(path.join(repo, "docs/specs/0001-template-driven-spec.md"), "utf8");
  assert.match(spec, /## Why Now/);
  assert.match(spec, /## Users and Value/);
  assert.match(spec, /## Acceptance Criteria/);
});

test("doc creation detects existing alternate directories", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "specs"), { recursive: true });
  fs.mkdirSync(path.join(repo, "plans"), { recursive: true });
  fs.mkdirSync(path.join(repo, "tasks"), { recursive: true });

  assert.equal(runScript("spec-doc", "new_spec.js", ["--title", "Alternate spec dir"], { cwd: repo }).status, 0);
  assert.equal(runScript("plan-doc", "new_plan.js", ["--title", "Alternate plan dir"], { cwd: repo }).status, 0);
  assert.equal(runScript("task-doc", "new_task.js", ["--title", "Alternate task dir"], { cwd: repo }).status, 0);

  assert.equal(fs.existsSync(path.join(repo, "specs/0001-alternate-spec-dir.md")), true);
  assert.equal(fs.existsSync(path.join(repo, "plans/0001-alternate-plan-dir.md")), true);
  assert.equal(fs.existsSync(path.join(repo, "tasks/0001-alternate-task-dir.md")), true);
});

test("new_idea creates idea-refine artifact and index", () => {
  const repo = tempRepo();

  const result = runScript("idea-refine", "new_idea.js", ["--title", "Improve onboarding"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const ideaPath = path.join(repo, "docs/ideas/0001-improve-onboarding.md");
  assert.equal(fs.existsSync(ideaPath), true);
  assert.equal(fs.existsSync(path.join(repo, "docs/ideas/README.md")), true);

  const idea = fs.readFileSync(ideaPath, "utf8");
  assert.match(idea, /^id: "IDEA-0001"$/m);
  assert.match(idea, /^type: "idea"$/m);
  assert.match(idea, /^status: "exploring"$/m);
  assert.match(idea, /^# Improve onboarding/m);
  assert.match(idea, /## Raw Idea/);
  assert.match(idea, /## Refined Options/);
});

test("new_brainstorm creates discovery artifact linked to refined idea", () => {
  const repo = tempRepo();
  const idea = runScript("idea-refine", "new_idea.js", ["--title", "Improve onboarding"], { cwd: repo });
  assert.equal(idea.status, 0, idea.stderr);

  const result = runScript(
    "brainstorming",
    "new_brainstorm.js",
    ["--title", "Onboarding discovery", "--from", "docs/ideas/0001-improve-onboarding.md"],
    { cwd: repo },
  );

  assert.equal(result.status, 0, result.stderr);
  const brainstorm = fs.readFileSync(path.join(repo, "docs/discovery/0001-onboarding-discovery.md"), "utf8");
  assert.match(brainstorm, /^id: "BRAINSTORM-0001"$/m);
  assert.match(brainstorm, /^type: "brainstorm"$/m);
  assert.match(brainstorm, /^status: "capturing"$/m);
  assert.match(brainstorm, /^  derives-from:$/m);
  assert.match(brainstorm, /^    - "docs\/ideas\/0001-improve-onboarding.md"$/m);
  assert.match(brainstorm, /## Intent/);
  assert.match(brainstorm, /## Document Routing/);
});

test("new_plan links to spec with implements and derives-from relations", () => {
  const repo = tempRepo();
  const spec = runScript("spec-doc", "new_spec.js", ["--title", "Define checkout flow"], { cwd: repo });
  assert.equal(spec.status, 0, spec.stderr);

  const result = runScript(
    "plan-doc",
    "new_plan.js",
    ["--title", "Implement checkout flow", "--implements", "docs/specs/0001-define-checkout-flow.md"],
    { cwd: repo },
  );

  assert.equal(result.status, 0, result.stderr);
  const plan = fs.readFileSync(path.join(repo, "docs/plans/0001-implement-checkout-flow.md"), "utf8");
  assert.match(plan, /^id: "PLAN-0001"$/m);
  assert.match(plan, /^type: "plan"$/m);
  assert.match(plan, /^  implements:$/m);
  assert.match(plan, /^    - "docs\/specs\/0001-define-checkout-flow.md"$/m);
  assert.match(plan, /^  derives-from:$/m);
  assert.match(plan, /^    - "docs\/specs\/0001-define-checkout-flow.md"$/m);
});

test("new_task links to plan and list_docs filters by status", () => {
  const repo = tempRepo();
  const planDir = path.join(repo, "docs/plans");
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, "0001-plan.md"), "# Plan\n", "utf8");

  const created = runScript(
    "task-doc",
    "new_task.js",
    ["--title", "Wire checkout button", "--plan", "docs/plans/0001-plan.md", "--status", "in-progress"],
    { cwd: repo },
  );
  assert.equal(created.status, 0, created.stderr);

  const task = fs.readFileSync(path.join(repo, "docs/tasks/0001-wire-checkout-button.md"), "utf8");
  assert.match(task, /^id: "TASK-0001"$/m);
  assert.match(task, /^status: "in-progress"$/m);
  assert.match(task, /^  implements:$/m);
  assert.match(task, /^    - "docs\/plans\/0001-plan.md"$/m);

  const listed = runScript("doc-status", "list_docs.js", ["--type", "task", "--status", "in-progress", "--json"], { cwd: repo });
  assert.equal(listed.status, 0, listed.stderr);
  const report = JSON.parse(listed.stdout);
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].status, "in-progress");
});

test("doc-status audits required front matter, status, indexes, relations, and sources", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/specs"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/specs/0001-invalid.md"),
    [
      "---",
      'id: "SPEC-0001"',
      'type: "spec"',
      'status: "unknown"',
      'title: "Invalid"',
      'created: "2026-05-25"',
      'updated: "2026-05-25"',
      "owners: []",
      "relations:",
      '  source: ["https://example.com/source"]',
      '  references: ["docs/missing-reference.md"]',
      '  implements: ["docs/missing-implementation.md"]',
      "---",
      "",
      "# Invalid",
      "",
      "## Intent",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runScript("doc-status", "audit_docs.js", ["--type", "spec", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.some((finding) => finding.code === "invalid-status"), true);
  assert.equal(report.findings.some((finding) => finding.code === "missing-index"), true);
  assert.equal(report.findings.some((finding) => finding.message.includes("docs/missing-implementation.md")), true);
  assert.equal(report.findings.some((finding) => finding.message.includes("docs/missing-reference.md")), true);
  assert.equal(report.findings.some((finding) => finding.message.includes("https://example.com/source")), false);
});
