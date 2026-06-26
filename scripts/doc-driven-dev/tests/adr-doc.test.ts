const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/adr-doc");
const commonRelationFields = [
  "source",
  "implements",
  "implemented-by",
  "depends-on",
  "blocks",
  "supersedes",
  "superseded-by",
  "related",
  "refines",
  "refined-by",
  "derives-from",
  "derived-by",
  "verifies",
  "verified-by",
  "references",
  "defers",
  "deferred-by",
];

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "adr-doc-test-"));
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

test("new_adr creates the default MADR ADR and index in docs/adr", () => {
  const repo = tempRepo();

  const result = runScript("new_adr.js", ["--title", "Adopt MADR"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(repo, "docs/adr/0001-adopt-madr.md")), true);
  assert.equal(fs.existsSync(path.join(repo, "docs/adr/README.md")), true);

  const adr = fs.readFileSync(path.join(repo, "docs/adr/0001-adopt-madr.md"), "utf8");
  assert.match(adr, /^id: "ADR-0001"$/m);
  assert.match(adr, /^type: "adr"$/m);
  assert.match(adr, /^status: "proposed"$/m);
  assert.match(adr, /^title: "Adopt MADR"$/m);
  assert.match(adr, /^created: "\d{4}-\d{2}-\d{2}"$/m);
  assert.match(adr, /^updated: "\d{4}-\d{2}-\d{2}"$/m);
  assert.match(adr, /^owners: \[\]$/m);
  assert.match(adr, /^metadata:$/m);
  assert.match(adr, /^  adr:$/m);
  assert.match(adr, /^    decision-makers: \[\]$/m);
  assert.match(adr, /^    consulted: \[\]$/m);
  assert.match(adr, /^    informed: \[\]$/m);
  assert.doesNotMatch(adr, /^date: /m);
  assert.doesNotMatch(adr, /^decision-makers: /m);
  assert.doesNotMatch(adr, /^consulted: /m);
  assert.doesNotMatch(adr, /^informed: /m);
  assert.match(adr, /^relations:$/m);
  for (const field of commonRelationFields) {
    assert.match(adr, new RegExp(`^  ${field}: \\[\\]$`, "m"));
  }
  assert.match(adr, /^  changes:$/m);
  for (const field of ["added", "modified", "deleted", "renamed", "moved", "generated"]) {
    assert.match(adr, new RegExp(`^    ${field}: \\[\\]$`, "m"));
  }
  const index = fs.readFileSync(path.join(repo, "docs/adr/README.md"), "utf8");
  assert.match(index, /\| ADR-0001 \| Adopt MADR \| proposed \| \[0001-adopt-madr\.md\]\(\.\/0001-adopt-madr\.md\) \|/);
  assert.match(adr, /^# 1\. Adopt MADR/m);
  assert.match(adr, /## Context and Problem Statement/);
  assert.match(adr, /## Decision Drivers/);
  assert.match(adr, /## Pros and Cons of the Options/);
  assert.match(adr, /## Decision Outcome/);
  assert.match(adr, /## Implementation Plan/);
  assert.match(adr, /## Verification/);
});

test("audit_adr accepts source URLs in common relations", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/adr/0001-source-url.md"),
    [
      "---",
      'status: "accepted"',
      'date: "2026-05-23"',
      "decision-makers: []",
      "consulted: []",
      "informed: []",
      "relations:",
      '  source: ["https://example.com/source"]',
      "  references: []",
      "  supersedes: []",
      "  superseded-by: []",
      "  related: []",
      "  refines: []",
      "---",
      "",
      "# 1. Source URL",
      "",
      "## Context and Problem Statement",
      "",
      "## Considered Options",
      "",
      "## Decision Outcome",
      "",
      "## Implementation Plan",
      "",
      "## Verification",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runScript("audit_adr.js", ["--dir", "docs/adr", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.some((finding) => finding.message.includes("https://example.com/source")), false);
});

test("new_adr honors --dir and all supported templates", () => {
  for (const template of ["full", "minimal", "bare", "bare-minimal"]) {
    const repo = tempRepo();

    const result = runScript(
      "new_adr.js",
      ["--title", `Template ${template}`, "--dir", "decisions", "--template", template],
      { cwd: repo },
    );

    assert.equal(result.status, 0, `${template}: ${result.stderr}`);
    const files = fs.readdirSync(path.join(repo, "decisions")).filter((file) => file.endsWith(".md"));
    assert.equal(files.some((file) => file.includes(`template-${template}`)), true);
  }
});

test("update_index is dry-run by default and writes only with --write", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/adr/0001-existing.md"), "# 1. Existing\n", "utf8");

  const dryRun = runScript("update_index.js", ["--dir", "docs/adr"], { cwd: repo });

  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /DRY RUN/);
  assert.equal(fs.existsSync(path.join(repo, "docs/adr/README.md")), false);

  const write = runScript("update_index.js", ["--dir", "docs/adr", "--write"], { cwd: repo });

  assert.equal(write.status, 0, write.stderr);
  assert.match(fs.readFileSync(path.join(repo, "docs/adr/README.md"), "utf8"), /Existing/);
});

test("audit_adr reports issues without modifying files", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  const adrPath = path.join(repo, "docs/adr/0001-incomplete.md");
  fs.writeFileSync(adrPath, "# 1. Incomplete\n\nTODO\n", "utf8");
  const before = fs.readFileSync(adrPath, "utf8");

  const result = runScript("audit_adr.js", ["--dir", "docs/adr", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.length > 0, true);
  assert.equal(fs.readFileSync(adrPath, "utf8"), before);
});

test("audit_adr validates relation links when relations are present", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/adr/0001-has-relations.md"),
    [
      "---",
      'status: "accepted"',
      'date: "2026-05-23"',
      "decision-makers: []",
      "consulted: []",
      "informed: []",
      "relations:",
      '  supersedes: ["0000-missing.md"]',
      "  superseded-by: []",
      "  related: []",
      "  refines: []",
      "---",
      "",
      "# 1. Has Relations",
      "",
      "## Context and Problem Statement",
      "",
      "## Considered Options",
      "",
      "## Decision Outcome",
      "",
      "## Implementation Plan",
      "",
      "## Verification",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runScript("audit_adr.js", ["--dir", "docs/adr", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.some((finding) => finding.code === "broken-relation-link"), true);
});

test("audit_adr validates reference-style markdown links", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/adr/0001-reference-link.md"),
    [
      "---",
      'status: "accepted"',
      'date: "2026-05-23"',
      "decision-makers: []",
      "consulted: []",
      "informed: []",
      "relations:",
      "  supersedes: []",
      "  superseded-by: []",
      "  related: []",
      "  refines: []",
      "---",
      "",
      "# 1. Reference Link",
      "",
      "## Context and Problem Statement",
      "",
      "See [missing reference][missing].",
      "",
      "## Considered Options",
      "",
      "## Decision Outcome",
      "",
      "## Implementation Plan",
      "",
      "## Verification",
      "",
      "[missing]: ./missing.md",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runScript("audit_adr.js", ["--dir", "docs/adr", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.some((finding) => finding.code === "broken-local-link"), true);
});

test("package scripts expose tests and markdownlint", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));

  assert.equal(packageJson.packageManager, "pnpm@11.2.2");
  assert.match(packageJson.scripts.test, /tsx --test/);
  assert.match(packageJson.scripts["lint:md"], /markdownlint-cli2/);
  assert.equal(Boolean(packageJson.dependencies["gray-matter"]), true);
  assert.equal(Boolean(packageJson.dependencies.zod), true);
  assert.equal(Boolean(packageJson.dependencies.ajv), false);
  assert.equal(Boolean(packageJson.dependencies.unified), true);
  assert.equal(Boolean(packageJson.dependencies["remark-parse"]), true);
  assert.equal(Boolean(packageJson.dependencies["unist-util-visit"]), true);
  assert.equal(Boolean(packageJson.devDependencies["markdownlint-cli2"]), true);
});

test("migrate_report is report-only", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/decisions"), { recursive: true });
  const adrPath = path.join(repo, "docs/decisions/0001-old-style.md");
  fs.writeFileSync(adrPath, "# Old Style\n\nDecision: keep it simple.\n", "utf8");
  const before = fs.readFileSync(adrPath, "utf8");

  const result = runScript("migrate_report.js", ["--dir", "docs/decisions", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.migrations.length, 1);
  assert.equal(fs.readFileSync(adrPath, "utf8"), before);
});

test("list_adrs reports ADR metadata", () => {
  const repo = tempRepo();
  const created = runScript("new_adr.js", ["--title", "List Metadata", "--status", "accepted"], { cwd: repo });
  assert.equal(created.status, 0, created.stderr);

  const result = runScript("list_adrs.js", ["--dir", "docs/adr", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.count, 1);
  assert.equal(report.entries[0].status, "accepted");
  assert.equal(report.entries[0].title, "List Metadata");
});

test("review_adr checks agent-readiness without writing", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  const adrPath = path.join(repo, "docs/adr/0001-not-ready.md");
  fs.writeFileSync(
    adrPath,
    [
      "---",
      'status: "proposed"',
      'date: "2026-05-23"',
      "---",
      "",
      "# 1. Not Ready",
      "",
      "## Context and Problem Statement",
      "",
      "## Considered Options",
      "",
      "## Decision Outcome",
      "",
      "## Implementation Plan",
      "",
      "## Verification",
      "",
    ].join("\n"),
    "utf8",
  );
  const before = fs.readFileSync(adrPath, "utf8");

  const result = runScript("review_adr.js", ["--dir", "docs/adr", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.some((finding) => finding.code === "missing-affected-paths"), true);
  assert.equal(report.findings.some((finding) => finding.code === "missing-verification-checks"), true);
  assert.equal(fs.readFileSync(adrPath, "utf8"), before);
});

test("relate_adr is dry-run by default and writes bidirectional relations", () => {
  const repo = tempRepo();
  const first = runScript("new_adr.js", ["--title", "Old Decision"], { cwd: repo });
  const second = runScript("new_adr.js", ["--title", "New Decision"], { cwd: repo });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);

  const dryRun = runScript(
    "relate_adr.js",
    ["--dir", "docs/adr", "--from", "0002-new-decision.md", "--to", "0001-old-decision.md", "--relation", "supersedes"],
    { cwd: repo },
  );
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.doesNotMatch(fs.readFileSync(path.join(repo, "docs/adr/0002-new-decision.md"), "utf8"), /0001-old-decision\.md/);

  const write = runScript(
    "relate_adr.js",
    ["--dir", "docs/adr", "--from", "0002-new-decision.md", "--to", "0001-old-decision.md", "--relation", "supersedes", "--write"],
    { cwd: repo },
  );
  assert.equal(write.status, 0, write.stderr);
  assert.match(fs.readFileSync(path.join(repo, "docs/adr/0002-new-decision.md"), "utf8"), /0001-old-decision\.md/);
  assert.match(fs.readFileSync(path.join(repo, "docs/adr/0001-old-decision.md"), "utf8"), /0002-new-decision\.md/);
});

test("check_code_links reports missing Implementation Plan paths", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/adr/0001-code-links.md"),
    [
      "---",
      'status: "accepted"',
      'date: "2026-05-23"',
      "---",
      "",
      "# 1. Code Links",
      "",
      "## Implementation Plan",
      "",
      "* Affected paths: `src/missing.ts`",
      "",
      "## Verification",
      "",
      "* [ ] Run tests",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runScript("check_code_links.js", ["--dir", "docs/adr", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.some((finding) => finding.code === "missing-implementation-path"), true);
});

test("check_code_links includes nested Implementation Plan subsections", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/adr/0001-nested-implementation.md"),
    [
      "---",
      'status: "accepted"',
      'date: "2026-05-23"',
      "---",
      "",
      "# 1. Nested Implementation",
      "",
      "## Implementation Plan",
      "",
      "### Affected paths",
      "",
      "- Update `src/nested-missing.ts`.",
      "",
      "## Verification",
      "",
      "- [ ] Run tests",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runScript("check_code_links.js", ["--dir", "docs/adr", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.some((finding) => finding.message.includes("src/nested-missing.ts")), true);
});

test("review_adr accepts verification checkboxes in nested subsections", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/adr/0001-nested-verification.md"),
    [
      "---",
      'status: "accepted"',
      'date: "2026-05-23"',
      "decision-makers: []",
      "consulted: []",
      "informed: []",
      "---",
      "",
      "# 1. Nested Verification",
      "",
      "## Context and Problem Statement",
      "",
      "## Considered Options",
      "",
      "## Decision Outcome",
      "",
      "## Implementation Plan",
      "",
      "Affected paths: `src/app.ts`",
      "Patterns to follow: existing ADR scripts.",
      "",
      "## Verification",
      "",
      "### Automated",
      "",
      "- [ ] Run `pnpm test`.",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runScript("review_adr.js", ["--dir", "docs/adr", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.some((finding) => finding.code === "missing-verification-checks"), false);
});

test("list_adrs extracts plain text from markdown heading titles", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/adr/0001-linked-title.md"),
    [
      "---",
      'status: "accepted"',
      'date: "2026-05-23"',
      "decision-makers: []",
      "consulted: []",
      "informed: []",
      "---",
      "",
      "# 1. Use [new module](../src/new-module.ts)",
      "",
      "## Context and Problem Statement",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runScript("list_adrs.js", ["--dir", "docs/adr", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.entries[0].title, "Use new module");
});

test("audit_adr validates front matter with zod schema", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/adr/0001-invalid-front-matter.md"),
    [
      "---",
      "status: 42",
      'date: "20260523"',
      "decision-makers: nobody",
      "consulted: []",
      "informed: []",
      "relations:",
      "  supersedes: []",
      "  superseded-by: []",
      "  related: []",
      "  refines: []",
      "---",
      "",
      "# 1. Invalid Front Matter",
      "",
      "## Context and Problem Statement",
      "",
      "## Considered Options",
      "",
      "## Decision Outcome",
      "",
      "## Implementation Plan",
      "",
      "## Verification",
      "",
      "* [ ] Run tests",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runScript("audit_adr.js", ["--dir", "docs/adr", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.some((finding) => finding.code === "invalid-front-matter"), true);
});

test("audit_adr rejects non-ADR document type", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/adr/0001-wrong-type.md"),
    [
      "---",
      'id: "ADR-0001"',
      'type: "spec"',
      'status: "accepted"',
      'title: "Wrong Type"',
      'created: "2026-05-23"',
      'updated: "2026-05-23"',
      "owners: []",
      "relations:",
      "  source: []",
      "  implements: []",
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
      "  defers: []",
      "  deferred-by: []",
      "metadata:",
      "  adr:",
      "    decision-makers: []",
      "    consulted: []",
      "    informed: []",
      "---",
      "",
      "# 1. Wrong Type",
      "",
      "## Context and Problem Statement",
      "",
      "## Considered Options",
      "",
      "## Decision Outcome",
      "",
      "## Implementation Plan",
      "",
      "## Verification",
      "",
      "* [ ] Run tests",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runScript("audit_adr.js", ["--dir", "docs/adr", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(
    report.findings.some(
      (finding) =>
        finding.code === "invalid-front-matter" && finding.message.includes('Expected type "adr"'),
    ),
    true,
  );
});

test("audit_adr rejects legacy top-level ADR front matter fields", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/adr"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "docs/adr/0001-legacy-front-matter.md"),
    [
      "---",
      'status: "accepted"',
      'date: "2026-05-23"',
      "decision-makers: []",
      "consulted: []",
      "informed: []",
      "relations:",
      "  supersedes: []",
      "  superseded-by: []",
      "  related: []",
      "  refines: []",
      "---",
      "",
      "# 1. Legacy Front Matter",
      "",
      "## Context and Problem Statement",
      "",
      "## Considered Options",
      "",
      "## Decision Outcome",
      "",
      "## Implementation Plan",
      "",
      "## Verification",
      "",
      "* [ ] Run tests",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runScript("audit_adr.js", ["--dir", "docs/adr", "--json"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(
    report.findings.some(
      (finding) =>
        finding.code === "invalid-front-matter" &&
        finding.message.includes("id"),
    ),
    true,
  );
});
