const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const matter = require("gray-matter");
const test = require("node:test");

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-suite-test-"));
}

function repoWithApprovedPlanAndTasks() {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  fs.mkdirSync(path.join(repo, "docs/tasks"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/plans/0001-plan.md"),
    matter.stringify("# Plan\n", {
      id: "PLAN-0001", type: "plan", status: "approved", title: "Plan",
      created: "2026-08-13", updated: "2026-08-13", owners: [], relations: {},
    }),
    "utf8",
  );
  for (const [number, title] of [["0001", "schema"], ["0002", "types"], ["0004", "ui"]]) {
    fs.writeFileSync(
      path.join(repo, "docs/tasks", `${number}-${title}.md`),
      matter.stringify(`# ${title}\n`, {
        id: `TASK-${number}`, type: "task", status: "todo", title,
        created: "2026-08-13", updated: "2026-08-13", owners: [], relations: {},
      }),
      "utf8",
    );
  }
  return repo;
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

function assertConcepts(text, concepts, label) {
  const normalized = text.replace(/\s+/g, " ");

  for (const concept of concepts) {
    assert.match(normalized, concept, label);
  }
}

function filesUnder(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".git"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(absolute));
    else files.push(absolute);
  }
  return files;
}

test("public docs expose doc-driven-dev-graph and contain no retired lifecycle residue", () => {
  const packageRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev");
  const scriptRoot = path.resolve(__dirname, "..");
  const oldTerms = [
    ["doc-driven-dev", "lifecycle"].join("-"),
    ["Lifecycle", "Graph"].join(""),
    ["Lifecycle", "State"].join(""),
    ["Lifecycle", "Route"].join(""),
    ["Lifecycle", "Signal"].join(""),
    ["Lifecycle", "ReasonCode"].join(""),
    ["route", "lifecycle"].join("_"),
    ["lifecycle", "router"].join("_"),
    ["lifecycle", "state"].join("_"),
    ["lifecycle", "graph"].join("_"),
  ];
  const residue = [];
  for (const file of [...filesUnder(packageRoot), ...filesUnder(scriptRoot)]) {
    const text = fs.readFileSync(file, "utf8");
    for (const term of oldTerms) {
      if (text.includes(term)) residue.push(`${path.relative(process.cwd(), file)}: ${term}`);
    }
  }
  assert.deepEqual(residue, [], "retired public names may only appear in docs/migrations/doc-driven-dev-graph.md");

  for (const file of [
    path.join(packageRoot, "README.md"),
    path.join(packageRoot, "README.ja.md"),
    path.join(packageRoot, "AGENTS.md"),
    path.join(packageRoot, "AGENTS.ja.md"),
    path.join(packageRoot, ".apm", "skills", "doc-driven-dev-graph", "SKILL.md"),
    path.join(packageRoot, ".apm", "skills", "doc-driven-dev-graph", "SKILL.ja.md"),
  ]) {
    assert.match(fs.readFileSync(file, "utf8"), /doc-driven-dev-graph/);
  }
});

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
  assert.match(spec, /^  changes:$/m);
  assert.match(spec, /^    added: \[\]$/m);
  assert.match(spec, /^    modified: \[\]$/m);
  assert.match(spec, /^    deleted: \[\]$/m);
  assert.match(spec, /^    renamed: \[\]$/m);
  assert.match(spec, /^    moved: \[\]$/m);
  assert.match(spec, /^    generated: \[\]$/m);
  assert.match(spec, /^  implements: \[\]$/m);
  assert.match(spec, /^  references: \[\]$/m);
  assert.match(spec, /^  defers: \[\]$/m);
  assert.match(spec, /^  deferred-by: \[\]$/m);
  assert.match(spec, /^# Define checkout flow/m);
  assert.match(spec, /## Deferred Design Concerns/);
});

test("doc skills ship conventions and templates", () => {
  for (const [skill, convention, template] of [
    ["spec-doc", "spec-conventions.md", "spec.md"],
    ["spec-doc", "spec-conventions.ja.md", "spec.ja.md"],
    ["design-doc", "design-conventions.md", "design.md"],
    ["design-doc", "design-conventions.ja.md", "design.ja.md"],
    ["plan-doc", "plan-conventions.md", "plan.md"],
    ["plan-doc", "plan-conventions.ja.md", "plan.ja.md"],
    ["task-doc", "task-conventions.md", "task.md"],
    ["task-doc", "task-conventions.ja.md", "task.ja.md"],
  ]) {
    assert.equal(fs.existsSync(path.join(skillRoot, skill, "references", convention)), true);
    assert.equal(fs.existsSync(path.join(skillRoot, skill, "assets/templates", template)), true);
  }
});

test("doc conventions cover directory order, filenames, mutability, and subdirectory grouping", () => {
  for (const [skill, convention] of [
    ["spec-doc", "spec-conventions.md"],
    ["design-doc", "design-conventions.md"],
    ["plan-doc", "plan-conventions.md"],
    ["task-doc", "task-conventions.md"],
  ]) {
    const text = fs.readFileSync(path.join(skillRoot, skill, "references", convention), "utf8");
    assert.match(text, /Detection order used by scripts:/);
    assert.match(text, /Rules:/);
    assert.match(text, /## Mutability/);
    assert.match(text, /## Subdirectory Grouping/);
  }
});

test("plan-doc recommends abstract delegated implementation handoff", () => {
  const planDocRoot = path.join(skillRoot, "plan-doc");
  const files = [
    "SKILL.md",
    "SKILL.ja.md",
    "references/plan-conventions.md",
    "references/plan-conventions.ja.md",
    "assets/templates/plan.md",
    "assets/templates/plan.ja.md",
  ];
  const disallowed = /REQUIRED SUB-SKILL|superpowers:|writing-plans|subagent-driven-development|executing-plans/i;

  for (const relative of files) {
    const text = fs.readFileSync(path.join(planDocRoot, relative), "utf8");
    assert.doesNotMatch(text, disallowed, `${relative} should not hardcode environment-specific skill IDs`);
  }

  const englishSkill = fs.readFileSync(path.join(planDocRoot, "SKILL.md"), "utf8");
  assertConcepts(
    englishSkill,
    [/delegated/i, /subagent-capable/i, /implementation/i],
    "SKILL.md should recommend delegated or subagent-capable implementation",
  );
  assertConcepts(
    englishSkill,
    [/approval/i, /before dispatch/i],
    "SKILL.md should require user approval before dispatch",
  );
  assertConcepts(
    englishSkill,
    [/discover/i, /implementation/i, /delegation capabilities/i, /current environment/i],
    "SKILL.md should discover current environment implementation and delegation capabilities",
  );

  const englishTemplate = fs.readFileSync(path.join(planDocRoot, "assets/templates/plan.md"), "utf8");
  assert.match(englishTemplate, /## Implementation Handoff/);
  assertConcepts(
    englishTemplate,
    [/approval/i, /discover/i, /delegated|subagent-capable/i],
    "plan.md should cover approval, discovery, and delegated or subagent-capable implementation",
  );

  const japaneseSkill = fs.readFileSync(path.join(planDocRoot, "SKILL.ja.md"), "utf8");
  assertConcepts(
    japaneseSkill,
    [/実装ハンドオフ/, /ユーザー承認/, /現在の環境/, /実装・委譲能力/, /委譲型/, /サブエージェント対応/],
    "SKILL.ja.md should cover Japanese implementation handoff concepts",
  );

  const japaneseTemplate = fs.readFileSync(path.join(planDocRoot, "assets/templates/plan.ja.md"), "utf8");
  assert.match(japaneseTemplate, /## 実装ハンドオフ/);
  assertConcepts(
    japaneseTemplate,
    [/ユーザー承認/, /現在の環境/, /実装・委譲能力/, /委譲型/, /サブエージェント対応/],
    "plan.ja.md should cover Japanese approval, discovery, and delegated implementation concepts",
  );
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
  fs.mkdirSync(path.join(repo, "docs/designs"), { recursive: true });
  fs.mkdirSync(path.join(repo, "plans"), { recursive: true });
  fs.mkdirSync(path.join(repo, "tasks"), { recursive: true });

  assert.equal(runScript("spec-doc", "new_spec.js", ["--title", "Alternate spec dir"], { cwd: repo }).status, 0);
  assert.equal(
    runScript(
      "design-doc",
      "new_design.js",
      ["--title", "Alternate design dir", "--status", "approved", "--from", "specs/0001-alternate-spec-dir.md", "--dir", "docs/designs"],
      { cwd: repo },
    ).status,
    0,
  );
  assert.equal(
    runScript(
      "plan-doc",
      "new_plan.js",
      [
        "--title",
        "Alternate plan dir",
        "--implements",
        "specs/0001-alternate-spec-dir.md",
        "--design",
        "docs/designs/0001-alternate-design-dir.md",
      ],
      { cwd: repo },
    ).status,
    0,
  );
  assert.equal(runScript("task-doc", "new_task.js", ["--title", "Alternate task dir"], { cwd: repo }).status, 0);

  assert.equal(fs.existsSync(path.join(repo, "specs/0001-alternate-spec-dir.md")), true);
  assert.equal(fs.existsSync(path.join(repo, "docs/designs/0001-alternate-design-dir.md")), true);
  assert.equal(fs.existsSync(path.join(repo, "docs/designs/overview.md")), true);
  assert.equal(fs.existsSync(path.join(repo, "plans/0001-alternate-plan-dir.md")), true);
  assert.equal(fs.existsSync(path.join(repo, "tasks/0001-alternate-task-dir.md")), true);
});

test("new_plan links to spec with implements and derives-from relations", () => {
  const repo = tempRepo();
  const spec = runScript("spec-doc", "new_spec.js", ["--title", "Define checkout flow"], { cwd: repo });
  assert.equal(spec.status, 0, spec.stderr);
  const design = runScript(
    "design-doc",
    "new_design.js",
    ["--title", "Design checkout orchestration", "--from", "docs/specs/0001-define-checkout-flow.md", "--status", "approved"],
    { cwd: repo },
  );
  assert.equal(design.status, 0, design.stderr);

  const result = runScript(
    "plan-doc",
    "new_plan.js",
    [
      "--title",
      "Implement checkout flow",
      "--implements",
      "docs/specs/0001-define-checkout-flow.md",
      "--design",
      "docs/designs/0001-design-checkout-orchestration.md",
    ],
    { cwd: repo },
  );

  assert.equal(result.status, 0, result.stderr);
  const plan = fs.readFileSync(path.join(repo, "docs/plans/0001-implement-checkout-flow.md"), "utf8");
  assert.match(plan, /^id: "PLAN-0001"$/m);
  assert.match(plan, /^type: "plan"$/m);
  assert.match(plan, /^  implements:$/m);
  assert.match(plan, /^    - "docs\/specs\/0001-define-checkout-flow.md"$/m);
  assert.match(plan, /^  changes:$/m);
  assert.match(plan, /^    added: \[\]$/m);
  assert.match(plan, /^  derives-from:$/m);
  assert.match(plan, /^    - "docs\/specs\/0001-define-checkout-flow.md"$/m);
  assert.match(plan, /^    - "docs\/designs\/0001-design-checkout-orchestration.md"$/m);
});

test("new_design creates overview, detailed design, and index", () => {
  const repo = tempRepo();

  const result = runScript(
    "design-doc",
    "new_design.js",
    ["--title", "Design checkout orchestration", "--from", "docs/specs/0001-define-checkout-flow.md"],
    { cwd: repo },
  );

  assert.equal(result.status, 0, result.stderr);
  const designPath = path.join(repo, "docs/designs/0001-design-checkout-orchestration.md");
  const overviewPath = path.join(repo, "docs/designs/overview.md");
  const indexPath = path.join(repo, "docs/designs/README.md");
  assert.equal(fs.existsSync(designPath), true);
  assert.equal(fs.existsSync(overviewPath), true);
  assert.equal(fs.existsSync(indexPath), true);

  const design = fs.readFileSync(designPath, "utf8");
  const overview = fs.readFileSync(overviewPath, "utf8");
  assert.match(design, /^id: "DESIGN-0001"$/m);
  assert.match(design, /^type: "design"$/m);
  assert.match(design, /^status: "draft"$/m);
  assert.match(design, /^  changes:$/m);
  assert.match(design, /^    added: \[\]$/m);
  assert.match(design, /^  derives-from:$/m);
  assert.match(design, /^    - "docs\/specs\/0001-define-checkout-flow.md"$/m);
  assert.match(design, /^  defers: \[\]$/m);
  assert.match(design, /^  deferred-by: \[\]$/m);
  assert.match(design, /## Deferred Design Concerns/);
  assert.match(overview, /^# System Design Overview/m);
});

test("new_plan enforces approved design gate with fixed error code", () => {
  const repo = tempRepo();
  const spec = runScript("spec-doc", "new_spec.js", ["--title", "Define checkout flow"], { cwd: repo });
  assert.equal(spec.status, 0, spec.stderr);

  const missingDesign = runScript(
    "plan-doc",
    "new_plan.js",
    ["--title", "Implement checkout flow", "--implements", "docs/specs/0001-define-checkout-flow.md"],
    { cwd: repo },
  );
  assert.notEqual(missingDesign.status, 0);
  assert.match(missingDesign.stderr, /PLAN-DOC-GATE-001/);

  const draftDesign = runScript(
    "design-doc",
    "new_design.js",
    ["--title", "Draft checkout design", "--status", "draft"],
    { cwd: repo },
  );
  assert.equal(draftDesign.status, 0, draftDesign.stderr);

  const mixedCaseDesign = runScript(
    "design-doc",
    "new_design.js",
    ["--title", "Case-sensitive design", "--status", "Approved"],
    { cwd: repo },
  );
  assert.equal(mixedCaseDesign.status, 0, mixedCaseDesign.stderr);

  const invalidApproval = runScript(
    "plan-doc",
    "new_plan.js",
    [
      "--title",
      "Implement checkout flow",
      "--implements",
      "docs/specs/0001-define-checkout-flow.md",
      "--design",
      "docs/designs/0001-draft-checkout-design.md",
      "--design",
      "docs/designs/0002-case-sensitive-design.md",
    ],
    { cwd: repo },
  );
  assert.notEqual(invalidApproval.status, 0);
  assert.match(invalidApproval.stderr, /PLAN-DOC-GATE-001/);
});

test("new_task requires an approved or active plan and links it", () => {
  const repo = tempRepo();
  const planDir = path.join(repo, "docs/plans");
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(
    path.join(planDir, "0001-plan.md"),
    ["---", 'id: "PLAN-0001"', 'type: "plan"', 'status: "approved"', 'title: "Plan"', 'created: "2026-07-30"', 'updated: "2026-07-30"', "owners: []", "relations:", "  implements: []", "---", "# Plan", ""].join("\n"),
    "utf8",
  );

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
  assert.match(task, /^  changes:$/m);
  assert.match(task, /^    added: \[\]$/m);

  const listed = runScript("doc-status", "list_docs.js", ["--type", "task", "--status", "in-progress", "--json"], { cwd: repo });
  assert.equal(listed.status, 0, listed.stderr);
  const report = JSON.parse(listed.stdout);
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].status, "in-progress");
});

test("new_task records repeatable task dependencies and blocks relations", () => {
  const repo = repoWithApprovedPlanAndTasks();
  const created = runScript("task-doc", "new_task.js", [
    "--title", "Implement API",
    "--plan", "docs/plans/0001-plan.md",
    "--depends-on", "docs/tasks/0001-schema.md",
    "--depends-on", "TASK-0002",
    "--blocks", "docs/tasks/0004-ui.md",
  ], { cwd: repo });
  assert.equal(created.status, 0, created.stderr);
  const task = fs.readFileSync(path.join(repo, "docs/tasks/0005-implement-api.md"), "utf8");
  assert.match(task, /^    - "docs\/tasks\/0001-schema.md"$/m);
  assert.match(task, /^    - "TASK-0002"$/m);
  assert.match(task, /^  blocks:\n    - "docs\/tasks\/0004-ui.md"$/m);
});

test("new_task rejects a draft or superseded plan", () => {
  const repo = tempRepo();
  const planDir = path.join(repo, "docs/plans");
  fs.mkdirSync(planDir, { recursive: true });
  for (const [name, status] of [["draft", "draft"], ["superseded", "superseded"]]) {
    fs.writeFileSync(
      path.join(planDir, `0001-${name}.md`),
      ["---", `id: "PLAN-${name === "draft" ? "0001" : "0002"}"`, 'type: "plan"', `status: "${status}"`, `title: "${name}"`, 'created: "2026-07-30"', 'updated: "2026-07-30"', "owners: []", "relations:", "  implements: []", "---", "# Plan", ""].join("\n"),
      "utf8",
    );
    const result = runScript("task-doc", "new_task.js", ["--title", `Task for ${name}`, "--plan", `docs/plans/0001-${name}.md`], { cwd: repo });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TASK-DOC-GATE-001/);
  }
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
      '  defers: ["docs/missing-deferred.md"]',
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
  assert.equal(report.findings.some((finding) => finding.message.includes("docs/missing-deferred.md")), true);
  assert.equal(report.findings.some((finding) => finding.message.includes("https://example.com/source")), false);
});

test("doc-status audits specs inside subdirectories", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/specs/checkout"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/specs/checkout/0001-define-checkout-flow.md"),
    [
      "---",
      'id: "SPEC-0001"',
      'type: "spec"',
      'status: "bad-status"',
      'title: "Define checkout flow"',
      'created: "2026-06-17"',
      'updated: "2026-06-17"',
      "owners: []",
      "relations:",
      '  references: ["docs/missing-in-subdir.md"]',
      "---",
      "",
      "# Define checkout flow",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runScript("doc-status", "audit_docs.js", ["--type", "spec", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.files, 1, "subdirectory file should be counted");
  assert.equal(report.findings.some((f) => f.code === "invalid-status"), true, "invalid-status from subdir file");
  assert.equal(report.findings.some((f) => f.message.includes("docs/missing-in-subdir.md")), true, "broken link in subdir file");
});

test("doc-driven-dev-graph meta skill ships Graph Definition and runtime references", () => {
  const graphSkill = path.join(skillRoot, "doc-driven-dev-graph");
  assert.equal(fs.existsSync(path.join(graphSkill, "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(graphSkill, "SKILL.ja.md")), true);
  assert.equal(fs.existsSync(path.join(graphSkill, "references", "graph-contract.md")), true);
  assert.equal(fs.existsSync(path.join(graphSkill, "references", "execution-contract.md")), true);

  const skill = fs.readFileSync(path.join(graphSkill, "SKILL.md"), "utf8");
  assert.match(skill, /^name: doc-driven-dev-graph$/m);
  assert.match(skill, /Graph Definition/);
  assert.match(skill, /Runtime loop/);
  assert.match(skill, /one declared edge/);
  assert.match(skill, /does not define phases as the execution authority|phases are conceptual/i);
  assert.ok((skill.match(/^\d+\./gm) || []).length >= 10, "SKILL.md should document ten runtime steps");
});

test("graph docs bind delegates, audits, and condition-driven subgraphs", () => {
  const root = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");
  const skill = fs.readFileSync(path.join(root, "doc-driven-dev-graph/SKILL.md"), "utf8");
  const skillJa = fs.readFileSync(path.join(root, "doc-driven-dev-graph/SKILL.ja.md"), "utf8");
  for (const text of [skill, skillJa]) {
    assert.match(text, /route_graph\.js/);
    assert.match(text, /build_task_graph\.js/);
    assert.match(text, /briefing-flow/);
    assert.match(text, /implementation-flow/);
    assert.match(text, /focus-required/);
    assert.match(text, /priority|優先/);
    assert.match(text, /wont-do/);
    assert.match(text, /database|DB|データベース/i);
  }
});

test("implementation-flow opens impl-doc before task execution", () => {
  const implementationRoot = path.join(skillRoot, "implementation-flow");
  const graphRoot = path.join(skillRoot, "doc-driven-dev-graph");
  const implDocRoot = path.join(skillRoot, "impl-doc");

  const flow = fs.readFileSync(path.join(implementationRoot, "SKILL.md"), "utf8");
  const flowJa = fs.readFileSync(path.join(implementationRoot, "SKILL.ja.md"), "utf8");
  const adapter = fs.readFileSync(
    path.join(implementationRoot, "assets", "adapters", "implementation-adapter.yaml"),
    "utf8",
  );
  const graphSkill = fs.readFileSync(path.join(graphRoot, "SKILL.md"), "utf8");
  const graphSkillJa = fs.readFileSync(path.join(graphRoot, "SKILL.ja.md"), "utf8");
  const contract = fs.readFileSync(path.join(graphRoot, "references", "execution-contract.md"), "utf8");
  const implDoc = fs.readFileSync(path.join(implDocRoot, "SKILL.md"), "utf8");

  assert.match(flow, /Phase C0: Open Implementation Documentation/);
  assert.match(flow, /new_impl_record\.js --title/);
  assert.match(flow, /--status "in-progress"/);
  assert.match(flow, /Implementation Record is opened before code changes begin/);
  assert.match(flowJa, /実装フェーズ/);
  assert.match(flowJa, /`impl-doc`/);
  assert.match(flowJa, /Experiment Log/);
  assert.match(flowJa, /--status "in-progress"/);

  assert.match(adapter, /slot_id: "implementation_documentation"/);
  assert.match(adapter, /skill: "impl-doc"/);
  assert.match(adapter, /description_patterns:/);
  assert.match(adapter, /impl-doc/);
  assert.match(adapter, /implementation record/);
  assert.match(adapter, /experiment log/);
  assert.match(adapter, /docs\/impl/);

  assert.match(graphSkill, /implementation delegates to `implementation-flow`/i);
  assert.match(graphSkill, /Markdown evidence/);
  assert.match(graphSkillJa, /implementation-flow/);
  assert.match(contract, /Record completion, gate, and follow-up evidence/);

  assert.match(implDoc, /Task implementation is starting/);
  assert.match(implDoc, /Create or reuse an in-progress Implementation Record/);
});

test("doc-driven-dev-graph documents post-implementation follow-up triage", () => {
  const graphRoot = path.join(skillRoot, "doc-driven-dev-graph");
  const skill = fs.readFileSync(path.join(graphRoot, "SKILL.md"), "utf8");
  const skillJa = fs.readFileSync(path.join(graphRoot, "SKILL.ja.md"), "utf8");
  const stateContract = fs.readFileSync(path.join(graphRoot, "references", "graph-state.md"), "utf8");
  const stateContractJa = fs.readFileSync(path.join(graphRoot, "references", "graph-state.ja.md"), "utf8");
  const graph = fs.readFileSync(path.join(graphRoot, "graphs", "doc-driven-dev.yaml"), "utf8");

  assert.match(skill, /follow-up triage/i);
  assert.match(skill, /implementation-verified/);
  assert.match(skill, /wont-do/);
  assert.match(skillJa, /follow-up|フォローアップ/);
  assert.match(skillJa, /implementation-verified/);
  assert.match(stateContract, /exactly one typed follow-up signal/);
  assert.match(stateContract, /follow-up triage/);
  assert.match(stateContractJa, /型付き|follow-up/);
  assert.match(graph, /from: followup-triage, to: followup-triage, when: followups-unclassified/);
  assert.match(graph, /from: followup-triage, to: planning, when: followup-bug-fix/);
  assert.match(graph, /from: followup-triage, to: exit-audit, when: followup-terminal/);
});

test("task-doc documents follow-up task routing and dependency rules", () => {
  const taskRoot = path.join(skillRoot, "task-doc");
  const skill = fs.readFileSync(path.join(taskRoot, "SKILL.md"), "utf8");
  const skillJa = fs.readFileSync(path.join(taskRoot, "SKILL.ja.md"), "utf8");
  const conventions = fs.readFileSync(path.join(taskRoot, "references", "task-conventions.md"), "utf8");
  const conventionsJa = fs.readFileSync(path.join(taskRoot, "references", "task-conventions.ja.md"), "utf8");
  const template = fs.readFileSync(path.join(taskRoot, "assets", "templates", "task.md"), "utf8");
  const templateJa = fs.readFileSync(path.join(taskRoot, "assets", "templates", "task.ja.md"), "utf8");

  assert.match(skill, /follow-up task/i);
  assert.match(skill, /approved plan/i);
  assert.match(skill, /TASK-DOC-GATE-001/);
  assert.match(conventions, /Follow-up Classification/);
  assert.match(conventions, /relations\.depends-on/);
  assert.match(conventions, /relations\.blocks/);
  assert.match(template, /## Classification/);

  assert.match(skillJa, /承認済み plan/);
  assert.match(skillJa, /TASK-DOC-GATE-001/);
  assert.match(conventionsJa, /フォローアップ分類/);
  assert.match(conventionsJa, /relations\.depends-on/);
  assert.match(conventionsJa, /relations\.blocks/);
  assert.match(conventionsJa, /承認済み plan/);
  assert.match(templateJa, /## 分類/);
});

test("doc-status documents unclassified follow-up review before exit", () => {
  const statusRoot = path.join(skillRoot, "doc-status");
  const skill = fs.readFileSync(path.join(statusRoot, "SKILL.md"), "utf8");
  const skillJa = fs.readFileSync(path.join(statusRoot, "SKILL.ja.md"), "utf8");
  const graph = fs.readFileSync(path.join(skillRoot, "doc-driven-dev-graph", "graphs", "doc-driven-dev.yaml"), "utf8");

  assert.match(skill, /unclassified follow-up/i);
  assert.match(skill, /Phase 4 Exit Gate/);
  assert.match(skillJa, /未分類フォローアップ/);
  assert.match(skillJa, /Phase 4 終了ゲート/);
  for (const signal of [
    "followup-bug-fix", "followup-decision-briefing", "followup-decision-design",
    "followup-new-feature", "followup-doc-only", "followup-terminal",
  ]) {
    assert.match(graph, new RegExp(`when: ${signal}`));
  }
  assert.match(graph, /when: followups-unclassified/);
});

test("new_design continues front-matter id numbering and preserves slug naming in slug repos", () => {
  const repo = tempRepo();
  const designs = path.join(repo, "docs/designs");
  fs.mkdirSync(path.join(designs, "storage-port"), { recursive: true });

  // 予約ファイル（採番・命名から除外されること）
  fs.writeFileSync(path.join(designs, "overview.md"), [
    "---", 'id: "DESIGN-OVERVIEW"', 'type: "design"', 'status: "draft"',
    'title: "System Design Overview"', 'created: "2026-06-01"', 'updated: "2026-06-01"',
    "owners: []", "relations:", "  source: []", "---", "", "# System Design Overview", "",
  ].join("\n"), "utf8");

  // slug 命名のトップレベル設計（id DESIGN-0005）
  fs.writeFileSync(path.join(designs, "analysis-pipeline.md"), [
    "---", 'id: "DESIGN-0005"', 'type: "design"', 'status: "approved"',
    'title: "Analysis Pipeline"', 'created: "2026-06-02"', 'updated: "2026-06-02"',
    "owners: []", "relations:", "  source: []", "---", "", "# Analysis Pipeline", "",
  ].join("\n"), "utf8");

  // サブディレクトリの設計（id DESIGN-0025、非再帰では不可視）
  fs.writeFileSync(path.join(designs, "storage-port", "design.md"), [
    "---", 'id: "DESIGN-0025"', 'type: "design"', 'status: "approved"',
    'title: "Storage Port"', 'created: "2026-06-03"', 'updated: "2026-06-03"',
    "owners: []", "relations:", "  source: []", "---", "", "# Storage Port", "",
  ].join("\n"), "utf8");

  // 手キュレーション索引（生成マーカー無し）
  const handCurated = "# Curated Design Index\n\n## Approved\n\n- analysis-pipeline\n- storage-port\n";
  fs.writeFileSync(path.join(designs, "README.md"), handCurated, "utf8");

  const result = runScript("design-doc", "new_design.js",
    ["--title", "Graph Visualization", "--status", "approved"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);

  // slug 命名で生成され、front matter id はグローバル連番 DESIGN-0026（max(5,25)+1）
  const created = path.join(designs, "graph-visualization.md");
  assert.equal(fs.existsSync(created), true, "slug-named file expected");
  const body = fs.readFileSync(created, "utf8");
  assert.match(body, /^id: "DESIGN-0026"$/m);

  // 手キュレーション README は保持される（クロバーしない）
  assert.equal(fs.readFileSync(path.join(designs, "README.md"), "utf8"), handCurated,
    "hand-curated README must be preserved");
});

test("new_design honors --dir and --name for subdirectory placement with global numbering", () => {
  const repo = tempRepo();
  const designs = path.join(repo, "docs/designs");
  fs.mkdirSync(designs, { recursive: true });

  fs.writeFileSync(path.join(designs, "overview.md"), [
    "---", 'id: "DESIGN-OVERVIEW"', 'type: "design"', 'status: "draft"',
    'title: "System Design Overview"', 'created: "2026-06-01"', 'updated: "2026-06-01"',
    "owners: []", "relations:", "  source: []", "---", "", "# System Design Overview", "",
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(designs, "analysis-pipeline.md"), [
    "---", 'id: "DESIGN-0007"', 'type: "design"', 'status: "approved"',
    'title: "Analysis Pipeline"', 'created: "2026-06-02"', 'updated: "2026-06-02"',
    "owners: []", "relations:", "  source: []", "---", "", "# Analysis Pipeline", "",
  ].join("\n"), "utf8");

  const result = runScript("design-doc", "new_design.js", [
    "--title", "Graph Visualization",
    "--dir", "docs/designs/graph-visualization",
    "--name", "design.md",
    "--status", "approved",
  ], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);

  const created = path.join(designs, "graph-visualization", "design.md");
  assert.equal(fs.existsSync(created), true, "<feature>/design.md expected");
  assert.match(fs.readFileSync(created, "utf8"), /^id: "DESIGN-0008"$/m);

  // overview と index はサブディレクトリではなくルートに置かれる
  assert.equal(fs.existsSync(path.join(designs, "overview.md")), true);
  assert.equal(fs.existsSync(path.join(designs, "graph-visualization", "overview.md")), false);
  assert.equal(fs.existsSync(path.join(designs, "graph-visualization", "README.md")), false);

  // ルート README は新規生成（マーカー付き）され、サブディレクトリの設計を含む
  const index = fs.readFileSync(path.join(designs, "README.md"), "utf8");
  assert.match(index, /<!-- doc-suite:generated-index -->/);
  assert.match(index, /graph-visualization\/design\.md/);
});

test("new_spec --no-index skips writing the README index", () => {
  const repo = tempRepo();
  const result = runScript("spec-doc", "new_spec.js",
    ["--title", "No index spec", "--no-index"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(repo, "docs/specs/0001-no-index-spec.md")), true);
  assert.equal(fs.existsSync(path.join(repo, "docs/specs/README.md")), false,
    "index must not be created when --no-index is passed");
  assert.match(result.stdout, /Skipped index update \(--no-index\)/);
});

test("new_spec --force-index overwrites a hand-curated index", () => {
  const repo = tempRepo();
  const specs = path.join(repo, "docs/specs");
  fs.mkdirSync(specs, { recursive: true });
  const handCurated = "# Curated Spec Index\n\n- keep me\n";
  fs.writeFileSync(path.join(specs, "README.md"), handCurated, "utf8");

  const skipped = runScript("spec-doc", "new_spec.js", ["--title", "First spec"], { cwd: repo });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(fs.readFileSync(path.join(specs, "README.md"), "utf8"), handCurated,
    "hand-curated index preserved by default");
  assert.match(skipped.stderr, /appears hand-curated/);

  const forced = runScript("spec-doc", "new_spec.js",
    ["--title", "Second spec", "--force-index"], { cwd: repo });
  assert.equal(forced.status, 0, forced.stderr);
  const index = fs.readFileSync(path.join(specs, "README.md"), "utf8");
  assert.match(index, /<!-- doc-suite:generated-index -->/, "index regenerated under --force-index");
});
