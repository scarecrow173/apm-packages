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
