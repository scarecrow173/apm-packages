import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import matter from "gray-matter";
import test from "node:test";

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-status-lint-"));
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
  fs.writeFileSync(path.join(dir, file), matter.stringify(body, frontMatter), "utf8");
}

function specFrontMatter(overrides: Record<string, unknown> = {}) {
  return {
    id: "SPEC-0001",
    type: "spec",
    status: "draft",
    title: "Spec",
    created: "2026-09-19",
    updated: "2026-09-19",
    owners: [],
    relations: {},
    ...overrides,
  };
}

function auditJson(repo: string, type: string, extra: string[] = []) {
  const res = runScript("doc-status", "audit_docs.js", ["--type", type, "--json", ...extra], repo);
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

function codes(report: any): string[] {
  return report.findings.map((finding: any) => finding.code);
}

test("audit_docs reports duplicate artifact ids with a stable rule id", () => {
  const repo = tempRepo();
  const dir = path.join(repo, "docs/specs");
  writeDoc(dir, "0001-a.md", specFrontMatter());
  writeDoc(dir, "0002-b.md", specFrontMatter({ title: "Duplicated" }));

  const report = auditJson(repo, "spec");
  const duplicates = report.findings.filter((finding: any) => finding.code === "duplicate-id");
  assert.equal(duplicates.length, 2);
  assert.ok(duplicates.every((finding: any) => finding.message.includes("SPEC-0001")));
  assert.equal(duplicates[0].severity, "error");
});

test("audit_docs flags id format and prefix violations", () => {
  const repo = tempRepo();
  const dir = path.join(repo, "docs/specs");
  writeDoc(dir, "0001-a.md", specFrontMatter({ id: "spec_0001" }));
  writeDoc(dir, "0002-b.md", specFrontMatter({ id: "PLAN-0001", title: "Wrong prefix" }));

  const report = auditJson(repo, "spec");
  const formatFindings = report.findings.filter((finding: any) => finding.code === "invalid-id-format");
  const prefixFindings = report.findings.filter((finding: any) => finding.code === "invalid-id-prefix");
  assert.equal(formatFindings.length, 1);
  assert.equal(formatFindings[0].file, "0001-a.md");
  assert.equal(prefixFindings.length, 1);
  assert.equal(prefixFindings[0].file, "0002-b.md");
});

test("audit_docs resolves relation targets by artifact id", () => {
  const repo = tempRepo();
  writeDoc(path.join(repo, "docs/specs"), "0001-a.md", specFrontMatter());
  writeDoc(path.join(repo, "docs/plans"), "0001-p.md", specFrontMatter({
    id: "PLAN-0001",
    type: "plan",
    title: "Plan",
    relations: { implements: ["SPEC-0001"] },
  }));

  const report = auditJson(repo, "plan");
  assert.equal(report.findings.some((finding: any) => finding.code === "broken-relation-link"), false);
});

test("audit_docs flags self-referencing, ambiguous, and root-escaping relations", () => {
  const repo = tempRepo();
  writeDoc(path.join(repo, "docs/specs"), "0001-a.md", specFrontMatter());
  writeDoc(path.join(repo, "docs/specs"), "0002-b.md", specFrontMatter());
  writeDoc(path.join(repo, "docs/plans"), "0001-p.md", specFrontMatter({
    id: "PLAN-0001",
    type: "plan",
    title: "Plan",
    relations: {
      implements: ["docs/plans/0001-p.md"],
      related: ["SPEC-0001"],
      references: ["../../outside.md"],
    },
  }));

  const report = auditJson(repo, "plan");
  assert.equal(report.findings.some((finding: any) => finding.code === "self-relation"), true);
  assert.equal(report.findings.some((finding: any) => finding.code === "ambiguous-relation-target"), true);
  assert.equal(report.findings.some((finding: any) => finding.code === "relation-escapes-root"), true);
});

test("audit_docs flags declared reciprocal relations that do not link back", () => {
  const repo = tempRepo();
  writeDoc(path.join(repo, "docs/specs"), "0001-a.md", specFrontMatter({
    relations: { "implemented-by": ["docs/plans/other.md"] },
  }));
  writeDoc(path.join(repo, "docs/plans"), "0001-p.md", specFrontMatter({
    id: "PLAN-0001",
    type: "plan",
    title: "Plan",
    relations: { implements: ["docs/specs/0001-a.md"] },
  }));
  writeDoc(path.join(repo, "docs/plans"), "other.md", specFrontMatter({
    id: "PLAN-0002",
    type: "plan",
    title: "Other",
  }));

  const report = auditJson(repo, "plan");
  assert.equal(
    report.findings.some((finding: any) => finding.code === "inconsistent-reciprocal-relation"),
    true,
  );
});

test("audit_docs reports invalid verifies target types via the shared contract", () => {
  const repo = tempRepo();
  writeDoc(path.join(repo, "docs/tasks"), "0001-t.md", specFrontMatter({
    id: "TASK-0001",
    type: "task",
    title: "Task",
    status: "todo",
  }));
  writeDoc(path.join(repo, "docs/test-specs"), "0001-ts.md", specFrontMatter({
    id: "TSPEC-0001",
    type: "test-spec",
    title: "TS",
    relations: { verifies: ["TASK-0001"] },
  }));

  const report = auditJson(repo, "test-spec");
  assert.equal(
    report.findings.some((finding: any) => finding.code === "test-spec-invalid-verifies-target"),
    true,
  );
});

test("audit_docs never modifies project documents (read-only invariant)", () => {
  const repo = tempRepo();
  const dir = path.join(repo, "docs/specs");
  writeDoc(dir, "0001-a.md", specFrontMatter({ status: "bogus-status" }));
  writeDoc(dir, "0002-b.md", specFrontMatter({ id: "SPEC-0001" }));
  writeDoc(dir, "README.md", {}, "# Index\n");

  const snapshot = () => {
    const files = fs.readdirSync(dir).sort();
    return files.map((file) => [file, fs.readFileSync(path.join(dir, file), "utf8")]);
  };
  const before = snapshot();
  const res = runScript("doc-status", "audit_docs.js", ["--type", "all"], repo);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(fs.readdirSync(repo).sort(), ["docs"]);
});

test("audit_docs --type all reports findings from every canonical type once per scope", () => {
  const repo = tempRepo();
  writeDoc(path.join(repo, "docs/specs"), "0001-a.md", specFrontMatter({ status: "bogus" }));
  writeDoc(path.join(repo, "docs/tasks"), "0001-t.md", specFrontMatter({
    id: "TASK-0001",
    type: "task",
    status: "todo",
    title: "Task",
  }));

  const report = auditJson(repo, "all");
  assert.ok(codes(report).includes("invalid-status"));
  const invalidStatus = report.findings.find((finding: any) => finding.code === "invalid-status");
  assert.equal(invalidStatus.file, "docs/specs/0001-a.md");
});

test("legacy audit findings carry the blocking flag", () => {
  const repo = tempRepo();
  writeDoc(path.join(repo, "docs/specs"), "0001-a.md", specFrontMatter({
    relations: { implements: ["SPEC-9999"] },
  }));

  const report = auditJson(repo, "spec");
  const broken = report.findings.find((finding: any) => finding.code === "broken-relation-link");
  assert.ok(broken);
  assert.equal(broken.blocking, true);
  assert.ok(report.findings.every((finding: any) => typeof finding.blocking === "boolean"));
});

test("audit_docs flags dangling legacy artifact ids in document bodies", () => {
  const repo = tempRepo();
  writeDoc(path.join(repo, "docs/specs"), "0001-a.md", specFrontMatter(),
    "# Spec\n\nDetails are in SPEC-0099 and DESIGN-0017.\n");

  const report = auditJson(repo, "spec");
  const findings = report.findings.filter((finding: any) => finding.code === "unresolved-legacy-reference");
  assert.equal(findings.length, 2);
  assert.ok(findings.every((finding: any) => finding.severity === "error" && finding.blocking === true));
  assert.ok(findings.some((finding: any) => finding.message.includes("SPEC-0099")));
  assert.ok(findings.some((finding: any) => finding.message.includes("DESIGN-0017")));
});

test("audit_docs ignores body tokens that resolve to existing artifacts", () => {
  const repo = tempRepo();
  writeDoc(path.join(repo, "docs/specs"), "0001-a.md", specFrontMatter());
  writeDoc(path.join(repo, "docs/specs"), "0002-b.md", specFrontMatter({ id: "SPEC-0002" }),
    "# B\n\nBuilds on SPEC-0001. Text uses UTF-8 per RFC-2119.\n");

  const report = auditJson(repo, "spec");
  assert.equal(
    report.findings.some((finding: any) => finding.code === "unresolved-legacy-reference"),
    false,
  );
});

test("audit_docs resolves EXP-NNNN tokens against numbered experiment logs", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs/impl/exp"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs/impl/exp/0001-foo.jsonl"), "{}\n", "utf8");
  writeDoc(path.join(repo, "docs/specs"), "0001-a.md", specFrontMatter(),
    "# Spec\n\nSee EXP-0001 for data and EXP-0099 for the missing run.\n");

  const report = auditJson(repo, "spec");
  const findings = report.findings.filter((finding: any) => finding.code === "unresolved-legacy-reference");
  assert.equal(findings.length, 1);
  assert.ok(findings[0].message.includes("EXP-0099"));
});

test("audit_docs --type all flags legacy tokens in unmanaged root documents once", () => {
  const repo = tempRepo();
  writeDoc(path.join(repo, "docs/specs"), "0001-a.md", specFrontMatter());
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Agents\n\nSee ADR-0025 for context.\n", "utf8");

  const report = auditJson(repo, "all");
  const findings = report.findings.filter((finding: any) => finding.code === "unresolved-legacy-reference");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, "AGENTS.md");
  assert.ok(findings[0].message.includes("ADR-0025"));
});

test("audit_docs does not resolve EXP-NNNN through a symlinked experiment log", (t) => {
  const repo = tempRepo();
  const outside = tempRepo();
  fs.writeFileSync(path.join(outside, "run.jsonl"), "{}\n", "utf8");
  fs.mkdirSync(path.join(repo, "docs/impl/exp"), { recursive: true });
  try {
    fs.symlinkSync(path.join(outside, "run.jsonl"), path.join(repo, "docs/impl/exp", "0001-run.jsonl"));
  } catch {
    t.skip("file symlinks are not permitted on this platform");
    return;
  }
  writeDoc(path.join(repo, "docs/specs"), "0001-a.md", specFrontMatter(),
    "# Spec\n\nSee EXP-0001 for data.\n");

  const report = auditJson(repo, "spec");
  const findings = report.findings.filter((finding: any) => finding.code === "unresolved-legacy-reference");
  assert.equal(findings.length, 1);
  assert.ok(findings[0].message.includes("EXP-0001"));
});

test("audit_docs does not ingest documents through a symlinked docs root", (t) => {
  const repo = tempRepo();
  const outside = tempRepo();
  writeDoc(path.join(outside, "specs"), "0001-leak.md", specFrontMatter(),
    "# leak\n\nSee ADR-0025.\n");
  try {
    fs.symlinkSync(outside, path.join(repo, "docs"), "junction");
  } catch {
    t.skip("directory symlinks are not permitted on this platform");
    return;
  }

  const report = auditJson(repo, "all");
  assert.equal(report.files, 0);
  assert.equal(
    report.findings.some(
      (finding: any) => String(finding.file || "").includes("0001-leak")
        || String(finding.message || "").includes("ADR-0025"),
    ),
    false,
  );
});
