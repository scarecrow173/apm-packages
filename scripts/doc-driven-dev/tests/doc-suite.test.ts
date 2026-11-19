import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import matter from "gray-matter";
import test from "node:test";

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-suite-test-"));
}

function runScript(skill: any, name: any, args: any, options: { cwd?: string } = {}) {
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

function assertConcepts(text: any, concepts: any, label: any) {
  const normalized = text.replace(/\s+/g, " ");

  for (const concept of concepts) {
    assert.match(normalized, concept, label);
  }
}

function entriesUnder(directory: any): string[] {
  const entries: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".git"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    entries.push(absolute);
    if (entry.isDirectory()) entries.push(...entriesUnder(absolute));
  }
  return entries;
}

function markdownSection(text: any, heading: any) {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `missing Markdown section: ${heading}`);
  const end = lines.findIndex((line: any, index: any) => index > start && /^## /.test(line));
  return lines.slice(start + 1, end === -1 ? lines.length : end).join("\n");
}

function numberedSteps(section: any) {
  return [...section.matchAll(/^(\d+)\.\s/gm)].map((match) => Number(match[1]));
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
  for (const entry of [...entriesUnder(packageRoot), ...entriesUnder(scriptRoot)]) {
    const normalizedPath = entry.replace(/\\/g, "/");
    for (const term of oldTerms) {
      if (normalizedPath.includes(term)) residue.push(`${path.relative(process.cwd(), entry)} (path): ${term}`);
    }
    if (!fs.statSync(entry).isFile()) continue;
    const text = fs.readFileSync(entry, "utf8");
    for (const term of oldTerms) {
      if (text.includes(term)) residue.push(`${path.relative(process.cwd(), entry)} (content): ${term}`);
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

test("new_spec creates a spec and defers index materialization", () => {
  const repo = tempRepo();

  const result = runScript("spec-doc", "new_spec.js", ["--title", "Define checkout flow"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const specPath = path.join(repo, "docs/specs/define-checkout-flow.md");
  assert.equal(fs.existsSync(specPath), true);
  assert.match(result.stdout, /Created docs\/specs\/.*\.md/);
  assert.match(result.stdout, /Index deferred/);
  assert.equal(
    fs.existsSync(path.join(repo, "docs/specs/README.md")),
    false,
    "creator must not write the index",
  );

  const spec = fs.readFileSync(specPath, "utf8");
  assert.match(spec, /^id: "SPEC-[0-9A-Za-z]{22}"$/m);
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
  // Knowledge Relations v1 (Issue #235): a spec stores only its declared
  // forward fields — `supersedes` is the spec type's sole canonical field;
  // the pre-v3 keys are never emitted.
  assert.match(spec, /^  supersedes: \[\]$/m);
  assert.doesNotMatch(spec, /^  (implements|references|defers|deferred-by|derives-from):/m);
  assert.match(spec, /^# Define checkout flow/m);
  assert.match(spec, /## Deferred Design Concerns/);
});

test("new_spec leaves an existing README byte-identical", () => {
  const repo = tempRepo();
  const specsDir = path.join(repo, "docs/specs");
  fs.mkdirSync(specsDir, { recursive: true });
  const readmePath = path.join(specsDir, "README.md");
  fs.writeFileSync(readmePath, "# my hand index\n", "utf8");
  const before = fs.readFileSync(readmePath, "utf8");

  const result = runScript("spec-doc", "new_spec.js", ["--title", "Beta"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(readmePath, "utf8"), before);
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
  const spec = fs.readFileSync(path.join(repo, "docs/specs/template-driven-spec.md"), "utf8");
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
      ["--title", "Alternate design dir", "--status", "approved", "--from", "specs/alternate-spec-dir.md", "--dir", "docs/designs"],
      { cwd: repo },
    ).status,
    0,
  );

  assert.equal(fs.existsSync(path.join(repo, "specs/alternate-spec-dir.md")), true);
  assert.equal(fs.existsSync(path.join(repo, "docs/designs/alternate-design-dir.md")), true);
  assert.equal(fs.existsSync(path.join(repo, "docs/designs/overview.md")), true);

  // Registry 3: plan/task are execution-bound — no durable creator ships
  // for them at all (Issue #249 removed the pre-v3 entrypoints).
  assert.equal(fs.existsSync(path.join(repo, "plans/alternate-dir.md")), false);
  assert.equal(fs.existsSync(path.join(repo, "tasks/alternate-dir.md")), false);
});

test("pre-v3 creator/mutator entrypoints are absent from the distribution", () => {
  // Issue #249: the legacy/execution-bound creators are not shipped —
  // nothing remains to interpret the old formats on the normal path.
  for (const [skill, name] of [
    ["plan-doc", "new_plan.js"],
    ["task-doc", "new_task.js"],
    ["test-spec-doc", "new_test_spec.js"],
    ["impl-doc", "new_impl_record.js"],
    ["impl-doc", "new_experiment_log.js"],
    ["impl-doc", "append_experiment_event.js"],
    ["impl-doc", "edit_experiment_log.js"],
    ["impl-doc", "sync_impl_index.js"],
  ] as const) {
    assert.equal(
      fs.existsSync(path.join(skillRoot, skill, "scripts", name)),
      false,
      `${skill}/scripts/${name} must not ship (Issue #249)`,
    );
  }
});

test("new_design creates overview and detailed design, and defers the index", () => {
  const repo = tempRepo();

  const result = runScript(
    "design-doc",
    "new_design.js",
    ["--title", "Design checkout orchestration", "--from", "docs/specs/define-checkout-flow.md"],
    { cwd: repo },
  );

  assert.equal(result.status, 0, result.stderr);
  const designPath = path.join(repo, "docs/designs/design-checkout-orchestration.md");
  const overviewPath = path.join(repo, "docs/designs/overview.md");
  const indexPath = path.join(repo, "docs/designs/README.md");
  assert.equal(fs.existsSync(designPath), true);
  assert.equal(fs.existsSync(overviewPath), true);
  assert.match(result.stdout, /Index deferred/);
  assert.equal(fs.existsSync(indexPath), false, "creator must not write the index");

  const design = fs.readFileSync(designPath, "utf8");
  const overview = fs.readFileSync(overviewPath, "utf8");
  assert.match(design, /^id: "DESIGN-[0-9A-Za-z]{22}"$/m);
  assert.match(design, /^type: "design"$/m);
  assert.match(design, /^status: "draft"$/m);
  assert.match(design, /^  changes:$/m);
  assert.match(design, /^    added: \[\]$/m);
  // Knowledge Relations v1: --from seeds the canonical `realizes` edge, not
  // the legacy `derives-from` key (Issue #235).
  assert.match(design, /^  realizes:$/m);
  assert.match(design, /^    - "docs\/specs\/define-checkout-flow.md"$/m);
  assert.match(design, /^  supersedes: \[\]$/m);
  assert.doesNotMatch(design, /^  (derives-from|defers|deferred-by):/m);
  assert.match(design, /## Deferred Design Concerns/);
  assert.match(overview, /^# System Design Overview/m);
});

test("task reads are not a durable scope — list_docs refuses execution-bound types", () => {
  const repo = tempRepo();
  const planDir = path.join(repo, "docs/plans");
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(
    path.join(planDir, "0001-plan.md"),
    ["---", 'id: "PLAN-0001"', 'type: "plan"', 'status: "approved"', 'title: "Plan"', 'created: "2026-07-30"', 'updated: "2026-07-30"', "owners: []", "relations:", "  implements: []", "---", "# Plan", ""].join("\n"),
    "utf8",
  );

  // Issue #249: the new_task.js creator is gone entirely — nothing mints a
  // durable task file, so there is no artifact path to assert.
  assert.equal(fs.existsSync(path.join(repo, "docs/tasks/wire-checkout-button.md")), false);

  const listed = runScript("doc-status", "list_docs.js", ["--type", "task", "--status", "in-progress", "--json"], { cwd: repo });
  assert.notEqual(listed.status, 0, "task is not a durable list scope");
  assert.match(listed.stderr, /execution-bound|ephemeral|Execution Store/);
});

test("test-spec is not a durable audit scope — audit_docs refuses the legacy type", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/specs"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/specs/0001-checkout.md"),
    matter.stringify("# Spec\n", {
      id: "SPEC-0001", type: "spec", status: "approved", title: "Checkout",
      created: "2026-09-15", updated: "2026-09-15", owners: [], relations: {},
    }),
    "utf8",
  );

  // Registry 3: test-spec is a legacy, migration-only type with no shipped
  // creator (Issue #249); durable verification intent lives in
  // `verification` (Issue #234 / #239).
  assert.equal(fs.existsSync(path.join(repo, "docs/test-specs")), false);

  const audited = runScript("doc-status", "audit_docs.js", ["--type", "test-spec", "--json"], { cwd: repo });
  assert.notEqual(audited.status, 0, "test-spec is not a durable audit scope");
  assert.match(audited.stderr, /legacy format|migration-only|migration tooling/);
});

test("doc-status flags test-specs without verifies and plans without test-spec evidence", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/test-specs"), { recursive: true });
  fs.mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  fs.mkdirSync(path.join(repo, "docs/specs"), { recursive: true });
  fs.mkdirSync(path.join(repo, "docs/tasks"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/test-specs/README.md"), "# test-specs\n", "utf8");
  fs.writeFileSync(path.join(repo, "docs/plans/README.md"), "# plans\n", "utf8");
  fs.writeFileSync(path.join(repo, "docs/specs/README.md"), "# specs\n", "utf8");
  fs.writeFileSync(path.join(repo, "docs/tasks/README.md"), "# tasks\n", "utf8");

  const writeDoc = (relativePath: string, data: Record<string, unknown>) => {
    fs.writeFileSync(path.join(repo, relativePath), matter.stringify("# Doc\n", data), "utf8");
  };
  const baseDoc = {
    created: "2026-09-15", updated: "2026-09-15", owners: [],
  };

  writeDoc("docs/specs/0001-checkout.md", {
    ...baseDoc, id: "SPEC-0001", type: "spec", status: "approved", title: "Checkout", relations: {},
  });
  writeDoc("docs/tasks/0001-implement.md", {
    ...baseDoc, id: "TASK-0001", type: "task", status: "proposed", title: "Implement", relations: {},
  });
  writeDoc("docs/test-specs/0001-empty.md", {
    ...baseDoc, id: "TSPEC-0001", type: "test-spec", status: "approved", title: "Empty", relations: {},
  });
  writeDoc("docs/test-specs/0002-scalar-verifies.md", {
    ...baseDoc, id: "TSPEC-0002", type: "test-spec", status: "approved", title: "Scalar",
    relations: { verifies: "docs/specs/0001-checkout.md" },
  });
  writeDoc("docs/test-specs/0003-id-verifies.md", {
    ...baseDoc, id: "TSPEC-0003", type: "test-spec", status: "approved", title: "IdRef",
    relations: { verifies: ["SPEC-0001"] },
  });
  writeDoc("docs/test-specs/0004-task-verifies.md", {
    ...baseDoc, id: "TSPEC-0004", type: "test-spec", status: "approved", title: "TaskTarget",
    relations: { verifies: ["docs/tasks/0001-implement.md"] },
  });
  writeDoc("docs/plans/0001-bare.md", {
    ...baseDoc, id: "PLAN-0001", type: "plan", status: "approved", title: "Bare", relations: {},
  });
  writeDoc("docs/plans/0002-skipped.md", {
    ...baseDoc, id: "PLAN-0002", type: "plan", status: "approved", title: "Skipped", relations: {},
    "test-spec-skip": "no verifiable behavior in this plan",
  });
  writeDoc("docs/plans/0003-linked.md", {
    ...baseDoc, id: "PLAN-0003", type: "plan", status: "approved", title: "Linked",
    relations: { "verified-by": ["docs/test-specs/0001-empty.md"] },
  });
  writeDoc("docs/plans/0004-draft.md", {
    ...baseDoc, id: "PLAN-0004", type: "plan", status: "draft", title: "Draft", relations: {},
  });
  writeDoc("docs/plans/0005-linked-id.md", {
    ...baseDoc, id: "PLAN-0005", type: "plan", status: "approved", title: "LinkedId",
    relations: { "verified-by": ["TSPEC-0001"] },
  });
  writeDoc("docs/plans/0006-linked-scalar.md", {
    ...baseDoc, id: "PLAN-0006", type: "plan", status: "approved", title: "LinkedScalar",
    relations: { "verified-by": "docs/test-specs/0001-empty.md" },
  });
  writeDoc("docs/plans/0007-linked-spec.md", {
    ...baseDoc, id: "PLAN-0007", type: "plan", status: "approved", title: "LinkedSpec",
    relations: { "verified-by": ["docs/specs/0001-checkout.md"] },
  });

  // Registry 3: test-spec is legacy and plan execution-bound — neither is a
  // durable audit scope; both refuse at the registry gate (Issue #234).
  const specAudit = runScript("doc-status", "audit_docs.js", ["--type", "test-spec", "--json"], { cwd: repo });
  assert.notEqual(specAudit.status, 0, "test-spec audit must refuse");
  assert.match(specAudit.stderr, /legacy format|migration-only|migration tooling/);

  const planAudit = runScript("doc-status", "audit_docs.js", ["--type", "plan", "--json"], { cwd: repo });
  assert.notEqual(planAudit.status, 0, "plan audit must refuse");
  assert.match(planAudit.stderr, /execution-bound|ephemeral|Execution Store/);

  // --type all audits durable types only; the planted legacy/execution docs
  // stay scannable evidence but produce no legacy-scope findings.
  const allAudit = runScript("doc-status", "audit_docs.js", ["--type", "all", "--json"], { cwd: repo });
  assert.equal(allAudit.status, 0, allAudit.stderr);
  const allReport = JSON.parse(allAudit.stdout);
  const retiredCodes = ["test-spec-missing-verifies", "test-spec-invalid-verifies-target", "plan-missing-test-spec-evidence"];
  assert.equal(
    allReport.findings.some((finding: any) => retiredCodes.includes(finding.code)),
    false,
    "no retired plan/test-spec rule ids under Registry 3",
  );
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
      '  supersedes: ["docs/missing-predecessor.md"]',
      '  references: ["docs/missing-reference.md"]',
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
  assert.equal(report.findings.some((finding: any) => finding.code === "invalid-status"), true);
  assert.equal(report.findings.some((finding: any) => finding.code === "missing-index"), true);
  // A missing `supersedes` target resolves through the v1 graph as a broken
  // link; the pre-v3 `references` key is a migration-input finding on the
  // field name itself, never a resolved edge (Issue #235).
  assert.equal(
    report.findings.some((finding: any) => finding.code === "broken-relation-link"
      && finding.message.includes("docs/missing-predecessor.md")),
    true,
  );
  assert.equal(
    report.findings.some((finding: any) => finding.code === "legacy-relation-field"
      && finding.message.includes("references")),
    true,
  );
  assert.equal(report.findings.some((finding: any) => finding.message.includes("https://example.com/source")), false);
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
      '  supersedes: ["docs/missing-in-subdir.md"]',
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
  assert.equal(report.findings.some((f: any) => f.code === "invalid-status"), true, "invalid-status from subdir file");
  assert.equal(
    report.findings.some((f: any) => f.code === "broken-relation-link"
      && f.message.includes("docs/missing-in-subdir.md")),
    true,
    "broken supersedes link in subdir file",
  );
});

test("graph entrypoint publishes one-edge runtime contract", () => {
  const graphSkill = path.join(skillRoot, "doc-driven-dev-graph");
  assert.equal(fs.existsSync(path.join(graphSkill, "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(graphSkill, "SKILL.ja.md")), true);
  assert.equal(fs.existsSync(path.join(graphSkill, "references", "graph-contract.md")), true);
  assert.equal(fs.existsSync(path.join(graphSkill, "references", "execution-contract.md")), true);
  assert.equal(fs.existsSync(path.join(graphSkill, "references", "graph-inspection.md")), true);
  assert.equal(fs.existsSync(path.join(graphSkill, "references", "graph-inspection.ja.md")), true);
  assert.equal(fs.existsSync(path.join(graphSkill, "scripts", "inspect_graph.js")), true);

  const skill = fs.readFileSync(path.join(graphSkill, "SKILL.md"), "utf8");
  const skillJa = fs.readFileSync(path.join(graphSkill, "SKILL.ja.md"), "utf8");
  const contract = fs.readFileSync(path.join(graphSkill, "references", "execution-contract.md"), "utf8");
  const contractJa = fs.readFileSync(path.join(graphSkill, "references", "execution-contract.ja.md"), "utf8");
  assert.match(skill, /^name: doc-driven-dev-graph$/m);
  assert.match(skill, /^description: .*at most one declared edge.*terminal\/blocked result/m);
  assert.match(skillJa, /^description: .*最大 1 つ.*terminal\/blocked.*$/m);
  assert.match(skill, /Graph Definition/);
  assert.match(skill, /Runtime loop/);
  assert.match(skill, /one declared edge/);
  assert.match(skill, /successful transition selects exactly one declared edge/i);
  assert.match(skill, /same-node blocked/i);
  assert.match(skill, /result with no edge/i);
  assert.match(skill, /route_graph\.js.*itself never recursively follows a\s+second edge/i);
  assert.match(skillJa, /route_graph\.js.*2 つ目の edge.*再帰的/s);
  assert.match(skillJa, /成功する遷移は宣言済み edge を 1 つだけ選択します/);
  assert.match(skillJa, /同一 node blocked 結果/);
  assert.match(skill, /phase labels are conceptual and non-normative.*execution authority/is);
  const runtime = markdownSection(skill, "## Runtime loop");
  const runtimeJa = markdownSection(skillJa, "## Graph runtime の 10 ステップ");
  assert.deepEqual(numberedSteps(runtime), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(numberedSteps(runtimeJa), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.match(skillJa, /phase label は概念上かつ非規範的.*実行\s*authority/s);
  assert.match(contract, /checkpoint != yield/);
  assert.match(contract, /single-step/);
  assert.match(contract, /run-until-yield/);
  assert.match(contract, /topologyBaseHops = 10/);
  assert.match(contract, /route.*audit.*delegate.*evidence.*re-project/is);
  assert.doesNotMatch(contract, /same turn must not.*multiple\s+edges/is);
  assert.match(contractJa, /checkpoint.*yield/);
  assert.match(contractJa, /同じ run.*複数 edge/);
  for (const text of [contract, contractJa]) {
    assert.doesNotMatch(text, /per-self-loop|self-loop budget|per edge ID per run/i);
    assert.match(text, /complete `GraphRoute`|完全な `GraphRoute`/);
    assert.match(text, /Task Graph|taskGraph/);
    assert.match(text, /topologyBaseHops/);
    assert.match(text, /taskBudgetCount/);
    assert.match(text, /Math\.max\(0, taskBudgetCount - 1\)/);
    assert.match(text, /todo.*in-progress.*blocked/s);
    assert.match(text, /done.*wont-do/s);
    assert.match(text, /handoff.*do not recalculate|handoff.*再計算しない/s);
    assert.match(text, /next run|次回 run/);
    assert.match(text, /budget-exhausted.*new run|budget-exhausted.*次回 run/s);
    assert.match(text, /fingerprint/);
  }
});

test("graph-invoked effects publish scoped typed outcomes", () => {
  const graphRoot = path.join(skillRoot, "doc-driven-dev-graph");
  const outcomeContract = fs.readFileSync(path.join(graphRoot, "references", "execution-outcome-contract.md"), "utf8");
  const outcomeContractJa = fs.readFileSync(path.join(graphRoot, "references", "execution-outcome-contract.ja.md"), "utf8");
  const executionContract = fs.readFileSync(path.join(graphRoot, "references", "execution-contract.md"), "utf8");
  const effectSkills = ["briefing-flow", "design-doc", "implementation-flow", "doc-status", "planning-flow"];
  const effects = effectSkills.map((skill) => fs.readFileSync(path.join(skillRoot, skill, "SKILL.md"), "utf8"));
  const effectsJa = effectSkills.map((skill) => fs.readFileSync(path.join(skillRoot, skill, "SKILL.ja.md"), "utf8"));

  for (const text of [outcomeContract, outcomeContractJa]) {
    assert.doesNotMatch(text, /selfLoopCounts/);
    assert.match(text, /taskBudgetCount: number \| null/);
  }

  for (const text of [...effects.slice(0, 4), ...effectsJa.slice(0, 4)]) {
    assert.match(text, /return exactly the\s+\[`EffectOutcome footer`\]|正確な \[`EffectOutcome footer`\]/);
    assert.doesNotMatch(text, /```yaml\nstatus:/);
  }
  assert.match(effects[0], /Use `completed` after the briefing gate passes, `retry` for a recoverable\n?document gap, and `yield` with `input-required` for an unresolved user-only\n?requirement\./);
  assert.match(effects[1], /Use `completed` for an approved design, `yield` with `approval-required` while\n?waiting for the designated reviewer, and `yield` with `input-required` for a\n?missing upstream user decision\./);
  assert.match(effects[2], /Use `completed` only for a verified task slice whose logical changes are\n?committed and whose consolidation decision was explicit \(persist, route, or\n?`none`\), `retry` for declared spec\/design\/constraint repair, `yield` with\n?`commit-required` when the slice produced changes that cannot be committed\n?within granted authority, `yield` with `authority-required` for an\n?irreversible effect without permission, and `yield` with\n?`unrecoverable-blocker` when no declared safe repair exists\./);
  assert.match(effects[3], /Use `completed` for a Completable result, `retry` for Returned with declared\n?repair evidence, and `yield` with `unrecoverable-blocker` for Returned without\n?a safe repair\./);
  assert.match(effects[4], /\[`EffectOutcome footer`\]\(\.\.\/doc-driven-dev-graph\/references\/execution-outcome-contract\.md\)/);
  assert.match(effects[4], /Use `completed` for a digest-approved run plan with materialized task records,\n?`retry` for changed plan\/task repair evidence, `yield` with\n?`approval-required` while plan review is pending, `yield` with `input-required` when a\n?user-owned planning choice is missing, and `yield` with `unrecoverable-blocker` when no\n?declared safe repair exists\./);
  assert.match(effectsJa[0], /briefing gate が通過したら `completed`、recoverable document gap には `retry`、未解決の\n?user-only requirement には `input-required` を理由とする `yield` を使います。/);
  assert.match(effectsJa[1], /approved design には `completed`、designated reviewer を待つ場合は `approval-required`\n?を理由とする `yield`、upstream user decision がない場合は `input-required` を理由とする\n?`yield` を使います。/);
  assert.match(effectsJa[2], /`completed` は logical change が commit 済みで統合決定が明示的（永続化、\n?route、または `none`）な verified task slice にのみ使い、declared\n?spec\/design\/constraint repair には `retry`、slice が granted authority 内で\n?commit できない変更を生んだ場合は `commit-required` を理由とする `yield`、\n?permission のない irreversible effect には `authority-required` を理由とする\n?`yield`、declared safe repair がない場合は `unrecoverable-blocker` を理由とする\n?`yield` を使います。/);
  assert.match(effectsJa[3], /Completable result には `completed`、declared repair evidence を伴う Returned には\n?`retry`、safe repair のない Returned には `unrecoverable-blocker` を理由とする `yield`\n?を使います。/);
  assert.match(effectsJa[4], /\[`EffectOutcome footer`\]\(\.\.\/doc-driven-dev-graph\/references\/execution-outcome-contract\.ja\.md\)/);
  assert.match(effectsJa[4], /digest 承認済みの run plan と materialize された task record には `completed`、changed\n?plan\/task repair evidence には `retry`、plan review が pending の場合は\n?`approval-required` を理由とする `yield`、user-owned planning choice が missing の場合は\n?`input-required` を理由とする `yield`、declared safe repair がない場合は\n?`unrecoverable-blocker` を理由とする `yield` を使います。/);
  const footerBlocks = [...outcomeContract.matchAll(/```yaml\n([\s\S]*?)```/g)].map((match) => match[1]);
  assert.equal(footerBlocks.length, 3);
  const footerVariants = footerBlocks.map((block) => require("js-yaml").load(block));
  const footerVariantsJa = [...outcomeContractJa.matchAll(/```yaml\n([\s\S]*?)```/g)]
    .map((match) => require("js-yaml").load(match[1]));
  assert.deepEqual(footerVariants.map((outcome) => outcome.status), ["completed", "retry", "yield"]);
  assert.deepEqual(footerVariantsJa, footerVariants);
  for (const outcome of footerVariants) {
    assert.equal(typeof outcome.edgeId, "string");
    assert.ok(["audit", "delegate"].includes(outcome.stage));
    assert.ok(["audit", "delegate"].includes(outcome.effect.kind));
    assert.equal(typeof outcome.effect.id, "string");
    assert.ok(Array.isArray(outcome.inputs));
    assert.ok(Array.isArray(outcome.outputs));
  }
  assert.ok(footerVariants[0].proof.kind === "durable-document" || footerVariants[0].proof.kind === "provider");
  assert.match(outcomeContract, /kind: provider/);
  assert.equal("reason" in footerVariants[0], false);
  assert.ok(Array.isArray(footerVariants[1].retry.changedOutputs));
  assert.equal("proof" in footerVariants[1], false);
  assert.equal(footerVariants[2].reason, "authority-required");
  assert.equal("proof" in footerVariants[2], false);
  const graphRunContract = (text: string) => text.match(/## [^\n]*GraphRunResult[^\n]*[\s\S]*?```ts\n([\s\S]*?)```/)?.[1];
  assert.ok(graphRunContract(outcomeContract));
  assert.deepEqual(graphRunContract(outcomeContractJa), graphRunContract(outcomeContract));
  assert.match(graphRunContract(outcomeContract) as string, /status: "yielded"/);
  assert.match(graphRunContract(outcomeContract) as string, /reason:.*"terminal"/s);
  assert.match(graphRunContract(outcomeContract) as string, /reason:.*"budget-exhausted"/s);
  assert.match(graphRunContract(outcomeContract) as string, /route: GraphRoute/);
  assert.match(graphRunContract(outcomeContract) as string, /outcomes: EffectOutcome\[\]/);
  assert.match(graphRunContract(outcomeContract) as string, /trace: GraphRunTrace\[\]/);
  assert.match(graphRunContract(outcomeContract) as string, /handoff: GraphRunHandoff/);
  assert.match(graphRunContract(outcomeContract) as string, /type GraphRunTrace = \{[\s\S]*route: GraphRoute[\s\S]*outcomes: EffectOutcome\[\]/);
  assert.match(graphRunContract(outcomeContract) as string, /type GraphRunHandoff = \{[\s\S]*current: string[\s\S]*edgeTrace: GraphRunTrace\[\][\s\S]*pending:[\s\S]*hops: number/);
  assert.match(outcomeContract, /Caller-normalized effects/);
  assert.match(outcomeContract, /migrate_docs.*scaffold_docs.*planning-flow.*build_task_graph/s);
  assert.match(outcomeContract, /`scaffold_docs` \(workspace-root bootstrap input\)/);
  assert.match(outcomeContract, /`build_task_graph` \(selected run's `plan\.md` plus its task records\)/);
  assert.match(outcomeContract, /`planning-flow` reads the\n?selected approved design/);
  assert.match(outcomeContract, /records the selected run's `plan\.md` and all\n?produced task records/);
  assert.match(outcomeContractJa, /`scaffold_docs`\s*（workspace-root bootstrap input）/);
  assert.match(outcomeContractJa, /`build_task_graph`（選択された run の `plan\.md` とその task record）/);
  assert.match(outcomeContractJa, /`planning-flow` は selected approved design を/);
  assert.match(outcomeContractJa, /選択された run の `plan\.md` と生成されたすべての task record を記録/);
  assert.match(outcomeContract, /\| `planning-flow` \| digest-approved run plan plus materialized task records \| changed run plan\/task repair evidence \| `approval-required` when plan review is pending; `input-required` when a user-owned planning choice is missing; `unrecoverable-blocker` when no declared safe repair exists \|/);
  assert.match(outcomeContractJa, /\| `planning-flow` \| digest 承認済みの run plan と materialize された task record \| changed run plan\/task repair evidence \| plan review が pending の `approval-required`、user-owned planning choice が missing の `input-required`、declared safe repair がない場合の `unrecoverable-blocker` \|/);
  assert.match(outcomeContract, /spec.*adr.*design.*verification.*knowledge.*all/s);
  assert.match(executionContract, /caller adapter.*missing or malformed.*authority-required/is);
  assert.ok(effects[0].indexOf("## Anti-patterns") < effects[0].indexOf("## Graph Effect Outcome"));
  assert.ok(effectsJa[0].indexOf("## アンチパターン") < effectsJa[0].indexOf("## Graph Effect Outcome"));
  assert.match(outcomeContract, /blocked.*GraphRoute|GraphRoute.*blocked/s);
  assert.doesNotMatch(outcomeContract, /status: blocked/);
  assert.match(outcomeContract, /never requires byte-equivalent\s+complete `GraphRoute`/s);
  assert.match(outcomeContractJa, /edgeId/);
  assert.match(executionContract, /exact.*EffectOutcome.*match/i);
});

test("graph-dispatched doc audits map to audit_docs with the artifact profile", () => {
  const docStatus = fs.readFileSync(path.join(skillRoot, "doc-status", "SKILL.md"), "utf8");
  const docStatusJa = fs.readFileSync(path.join(skillRoot, "doc-status", "SKILL.ja.md"), "utf8");
  const outcomeContract = fs.readFileSync(
    path.join(skillRoot, "doc-driven-dev-graph", "references", "execution-outcome-contract.md"),
    "utf8",
  );
  const outcomeContractJa = fs.readFileSync(
    path.join(skillRoot, "doc-driven-dev-graph", "references", "execution-outcome-contract.ja.md"),
    "utf8",
  );

  // Graph-dispatched named audits run the artifact profile so derived index
  // state never gates graph execution; the flag string is identical in both
  // languages (Issue #195).
  for (const text of [docStatus, docStatusJa, outcomeContract, outcomeContractJa]) {
    assert.match(text, /audit_docs\.js --type <name> --profile artifact/);
    assert.match(text, /audit_docs\.js --type all --profile artifact/);
  }
  // impl-record / experiment-log remain live owner audits (`--owners`), but
  // they are not graph-dispatched scopes under Graph Definition v3 — they
  // belong in the doc-status contract, not the graph outcome contract.
  for (const text of [docStatus, docStatusJa]) {
    assert.match(text, /impl-doc\/scripts\/audit_impl_record\.js/);
    assert.match(text, /impl-doc\/scripts\/audit_experiment_log\.js/);
    // audit_impl_record.js rejects unknown args — a --profile flag on it would
    // break graph dispatch; pin that the docs never pair them.
    assert.doesNotMatch(text, /audit_impl_record\.js --profile/);
    assert.doesNotMatch(text, /audit_experiment_log\.js --profile/);
  }
});

test("graph docs bind delegates, audits, and condition-driven subgraphs", () => {
  const root = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");
  const skill = fs.readFileSync(path.join(root, "doc-driven-dev-graph/SKILL.md"), "utf8");
  const skillJa = fs.readFileSync(path.join(root, "doc-driven-dev-graph/SKILL.ja.md"), "utf8");
  const graphDefinition = fs.readFileSync(path.join(root, "doc-driven-dev-graph/graphs/doc-driven-dev.yaml"), "utf8");
  const readme = fs.readFileSync(path.resolve(__dirname, "../../../packages/doc-driven-dev/README.md"), "utf8");
  const readmeJa = fs.readFileSync(path.resolve(__dirname, "../../../packages/doc-driven-dev/README.ja.md"), "utf8");
  const agents = fs.readFileSync(path.resolve(__dirname, "../../../packages/doc-driven-dev/AGENTS.md"), "utf8");
  const agentsJa = fs.readFileSync(path.resolve(__dirname, "../../../packages/doc-driven-dev/AGENTS.ja.md"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
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
  assert.match(graphDefinition, /^  planning: \{ kind: delegate, delegate: planning-flow, audits: \[design\] \}$/m);
  assert.match(graphDefinition, /^  task-graph: \{ kind: action, delegate: build_task_graph, audits: \[design\] \}$/m);
  assert.match(graphDefinition, /^  exit-audit: \{ kind: audit, delegate: doc-status, audits: \[all\], requiresGates: \[/m);
  for (const text of [readme, readmeJa, agents, agentsJa]) {
    assert.match(text, /planning-flow/);
    assert.match(text, /build_task_graph/);
  }
  assert.match(packageJson.scripts["lint:md"], /planning-flow\/SKILL\.md/);
  assert.match(packageJson.scripts["lint:md"], /planning-flow\/SKILL\.ja\.md/);
  assert.match(skill, /task-graph node audits the durable `design` and dispatches\s+`build_task_graph`, executed by `build_task_graph\.js`/);
  assert.match(skillJa, /task-graph node は durable な `design` を audit して `build_task_graph` を dispatch し、\s+`build_task_graph\.js` が実行/);
});

test("implementation-flow consolidates durable findings via knowledge-doc; impl-doc is migration-only", () => {
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

  // Issue #242: the old always-on impl-doc default-generation contract is
  // abolished — Phase C0 is a conditional consolidation decision, and a
  // normal run completes with no IR/EXP/forced Knowledge.
  assert.match(flow, /Phase C0: Implementation Documentation \(conditional\)/);
  assert.match(flow, /consolidate_knowledge\.js/);
  assert.match(flow, /`none` is a valid outcome|consciously `none`/);
  assert.match(flow, /no forced|no IR, no EXP|never forced/i);
  assert.doesNotMatch(flow, /new_impl_record\.js --title/);
  assert.doesNotMatch(flow, /--status "in-progress"/);
  assert.doesNotMatch(flow, /Implementation Record is opened before code changes begin/);
  assert.match(flowJa, /実装フェーズ|実装ドキュメント/);
  assert.match(flowJa, /`knowledge-doc`/);
  assert.match(flowJa, /consolidate_knowledge\.js/);
  assert.doesNotMatch(flowJa, /--status "in-progress"/);

  // The documentation slot is conditional and resolves to knowledge-doc —
  // impl-doc is never the normal-run default anymore.
  assert.match(adapter, /slot_id: "implementation_documentation"/);
  assert.match(adapter, /activation: "conditional"/);
  assert.match(adapter, /skill: "knowledge-doc"/);
  assert.doesNotMatch(adapter, /skill: "impl-doc"/);
  assert.match(adapter, /description_patterns:/);
  assert.match(adapter, /knowledge-doc/);
  assert.match(adapter, /docs\/knowledge/);

  assert.match(graphSkill, /implementation delegates to `implementation-flow`/i);
  assert.match(graphSkill, /Execution Store checkpoint/);
  assert.match(graphSkillJa, /implementation-flow/);
  assert.match(contract, /Record completion, gate, and verification evidence/);

  // impl-doc documents the legacy corpus contract for migration, not a
  // normal-run creation path.
  assert.match(implDoc, /migration tooling|migration-only|migration-owned/);
  assert.match(implDoc, /abolished/);
  assert.match(implDoc, /Legacy corpus shape/);
});

test("doc-driven-dev-graph documents post-implementation verification and consolidation", () => {
  const graphRoot = path.join(skillRoot, "doc-driven-dev-graph");
  const skill = fs.readFileSync(path.join(graphRoot, "SKILL.md"), "utf8");
  const skillJa = fs.readFileSync(path.join(graphRoot, "SKILL.ja.md"), "utf8");
  const stateContract = fs.readFileSync(path.join(graphRoot, "references", "graph-state.md"), "utf8");
  const stateContractJa = fs.readFileSync(path.join(graphRoot, "references", "graph-state.ja.md"), "utf8");
  const graph = fs.readFileSync(path.join(graphRoot, "graphs", "doc-driven-dev.yaml"), "utf8");

  assert.match(skill, /verification node/);
  assert.match(skill, /knowledge-consolidation/);
  assert.match(skill, /Verification Summary/);
  assert.match(skill, /verification-summary-contract\.md/);
  assert.match(skill, /wont-do/);
  assert.match(skillJa, /verification node/);
  assert.match(skillJa, /knowledge-consolidation/);
  assert.match(skillJa, /Verification Summary/);
  assert.match(skillJa, /verification-summary-contract\.ja\.md/);
  assert.match(stateContract, /knowledge-consolidated/);
  assert.match(stateContract, /exit-audit-pass/);
  assert.match(stateContractJa, /knowledge-consolidated/);
  assert.match(stateContractJa, /exit-audit-pass/);
  assert.match(graph, /from: verification, to: knowledge-consolidation, when: verification/);
  assert.match(graph, /from: knowledge-consolidation, to: exit-audit, when: knowledge-consolidation/);
  assert.match(graph, /from: exit-audit, to: complete, when: exit-audit/);
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
  // Issue #237: plan approval is a digest-bound Execution Store gate — the
  // pre-v3 TASK-DOC-GATE-001 creator flag is gone.
  assert.match(skill, /plan-not-approved/);
  assert.match(skill, /\(runId, taskId\)/);
  assert.match(skill, /dependsOn/);
  assert.match(conventions, /Follow-up Classification/);
  assert.match(conventions, /relations\.depends-on/);
  assert.match(conventions, /relations\.blocks/);
  assert.match(template, /## Classification/);

  assert.match(skillJa, /承認済み run plan/);
  assert.match(skillJa, /plan-not-approved/);
  assert.match(skillJa, /\(runId, taskId\)/);
  assert.match(conventionsJa, /フォローアップ分類/);
  assert.match(conventionsJa, /relations\.depends-on/);
  assert.match(conventionsJa, /relations\.blocks/);
  assert.match(conventionsJa, /承認済み plan/);
  assert.match(templateJa, /## 分類/);
});

test("doc-status documents the durable-set exit audit before complete", () => {
  const statusRoot = path.join(skillRoot, "doc-status");
  const skill = fs.readFileSync(path.join(statusRoot, "SKILL.md"), "utf8");
  const skillJa = fs.readFileSync(path.join(statusRoot, "SKILL.ja.md"), "utf8");
  const graph = fs.readFileSync(path.join(skillRoot, "doc-driven-dev-graph", "graphs", "doc-driven-dev.yaml"), "utf8");

  assert.match(skill, /`exit-audit` node/);
  assert.match(skill, /runs the named audit `all` only/);
  assert.match(skill, /Knowledge Relation/);
  assert.match(skillJa, /`exit-audit` node/);
  assert.match(skillJa, /named audit `all` のみ/);
  assert.match(skillJa, /Knowledge Relation/);
  assert.match(graph, /exit-audit: \{ kind: audit, delegate: doc-status, audits: \[all\], requiresGates: \[bootstrap, briefing, design, planning, implementation, verification, knowledge-consolidation\] \}/);
  for (const signal of ["focus-required", "exit-audit-pass", "commit-waived", "knowledge-consolidated"]) {
    assert.match(graph, new RegExp(`runtimeSignals:.*${signal}`));
  }
  assert.match(graph, /when: exit-audit/);
  assert.doesNotMatch(graph, /followup/);
});

test("new_design assigns an opaque id and preserves slug naming in slug repos", () => {
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

  // slug 命名で生成され、front matter id は既存の連番に依存しない不透明ID
  const created = path.join(designs, "graph-visualization.md");
  assert.equal(fs.existsSync(created), true, "slug-named file expected");
  const body = fs.readFileSync(created, "utf8");
  assert.match(body, /^id: "DESIGN-[0-9A-Za-z]{22}"$/m);

  // 手キュレーション README は保持される（クロバーしない）
  assert.equal(fs.readFileSync(path.join(designs, "README.md"), "utf8"), handCurated,
    "hand-curated README must be preserved");
});

test("new_design honors --dir and --name for subdirectory placement with opaque ids", () => {
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
  assert.match(fs.readFileSync(created, "utf8"), /^id: "DESIGN-[0-9A-Za-z]{22}"$/m);

  // overview と index はサブディレクトリではなくルートに置かれる
  assert.equal(fs.existsSync(path.join(designs, "overview.md")), true);
  assert.equal(fs.existsSync(path.join(designs, "graph-visualization", "overview.md")), false);
  assert.equal(fs.existsSync(path.join(designs, "graph-visualization", "README.md")), false);

  // index materialization is deferred — the creator never writes a README
  assert.match(result.stdout, /Index deferred/);
  assert.equal(fs.existsSync(path.join(designs, "README.md")), false);
});

test("new_spec --no-index is inert and prints a deprecation note", () => {
  const repo = tempRepo();
  const result = runScript("spec-doc", "new_spec.js",
    ["--title", "No index spec", "--no-index"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(repo, "docs/specs/no-index-spec.md")), true);
  assert.equal(fs.existsSync(path.join(repo, "docs/specs/README.md")), false,
    "creators never write the index");
  assert.match(result.stdout, /Index deferred/);
  assert.match(result.stdout, /--no-index\/--force-index are deprecated and have no effect/);
});

test("new_spec --force-index is inert and leaves a hand-curated index byte-identical", () => {
  const repo = tempRepo();
  const specs = path.join(repo, "docs/specs");
  fs.mkdirSync(specs, { recursive: true });
  const handCurated = "# Curated Spec Index\n\n- keep me\n";
  fs.writeFileSync(path.join(specs, "README.md"), handCurated, "utf8");

  const skipped = runScript("spec-doc", "new_spec.js", ["--title", "First spec"], { cwd: repo });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(fs.readFileSync(path.join(specs, "README.md"), "utf8"), handCurated,
    "hand-curated index preserved by default");

  const forced = runScript("spec-doc", "new_spec.js",
    ["--title", "Second spec", "--force-index"], { cwd: repo });
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stdout, /Index deferred/);
  assert.match(forced.stdout, /--no-index\/--force-index are deprecated and have no effect/);
  assert.equal(fs.readFileSync(path.join(specs, "README.md"), "utf8"), handCurated,
    "--force-index is inert: the hand-curated index stays byte-identical");
});
