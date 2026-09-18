import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { auditDocuments } from "../src/skills/lib/doc_audit";
import { collectFindings, summarizeHealth } from "../src/skills/lib/doc_report";

const tempDirs: string[] = [];

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-structure-"));
  tempDirs.push(root);
  return root;
}

function writeFile(root: string, relPath: string, content: string) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function writeSpec(root: string, name: string, id: string, body: string, extraFrontMatter = "") {
  writeFile(
    root,
    `docs/specs/${name}.md`,
    `---\nid: ${id}\ntype: spec\nstatus: draft\ntitle: Spec ${name}\ncreated: 2026-01-01\nowners: [team]\n${extraFrontMatter}---\n${body}`,
  );
}

function writeSpecIndex(root: string, items: string[]) {
  const header = "| ID | Title | Status | File |\n| --- | --- | --- | --- |";
  const body = items.length > 0 ? `${header}\n${items.join("\n")}\n` : `${header}\n`;
  writeFile(
    root,
    "docs/specs/README.md",
    `---\ntype: index\nof: spec\nstatus: active\ntitle: Spec Index\ncreated: 2026-01-01\n---\n# Spec Index\n\n${body}`,
  );
}

const indexItem = (id: string, file: string, title: string, status: string) =>
  `| ${id} | ${title} | ${status} | [${file}](./${file}) |`;

function codes(report: { findings: Array<{ code: string }> }) {
  return report.findings.map((finding) => finding.code);
}

test.afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test("flags missing local markdown and image targets", async () => {
  const root = fixture();
  writeSpec(root, "checkout", "SPEC-0001", "# Checkout\n\nSee [flow](missing.md) and ![logo](logo.png).\n");
  writeFile(root, "docs/specs/logo.png", "png");
  writeSpecIndex(root, [indexItem("SPEC-0001", "checkout.md", "Spec checkout", "draft")]);

  const report = await auditDocuments(root, "spec");
  assert.ok(codes(report).includes("broken-link"));
  assert.ok(!codes(report).includes("missing-image-link"));
});

test("flags missing image targets", async () => {
  const root = fixture();
  writeSpec(root, "checkout", "SPEC-0001", "# Checkout\n\n![logo](logo.png)\n");
  writeSpecIndex(root, [indexItem("SPEC-0001", "checkout.md", "Spec checkout", "draft")]);

  const report = await auditDocuments(root, "spec");
  assert.ok(codes(report).includes("missing-image-link"));
});

test("flags missing anchors in local and cross-file links", async () => {
  const root = fixture();
  writeSpec(root, "checkout", "SPEC-0001", "# Checkout\n\nSee [self](#nowhere) and [other](other.md#missing).\n");
  writeSpec(root, "other", "SPEC-0002", "# Other\n\n## Exists\n\nBody.\n");
  writeSpecIndex(root, [
    indexItem("SPEC-0001", "checkout.md", "Spec checkout", "draft"),
    indexItem("SPEC-0002", "other.md", "Spec other", "draft"),
  ]);

  const report = await auditDocuments(root, "spec");
  const anchors = report.findings.filter((finding) => finding.code === "broken-anchor");
  assert.equal(anchors.length, 2);
});

test("accepts anchors that exist", async () => {
  const root = fixture();
  writeSpec(root, "checkout", "SPEC-0001", "# Checkout Flow\n\nSee [self](#checkout-flow).\n");
  writeSpecIndex(root, [indexItem("SPEC-0001", "checkout.md", "Spec checkout", "draft")]);

  const report = await auditDocuments(root, "spec");
  assert.ok(!codes(report).includes("broken-anchor"));
});

test("flags links escaping the repository root", async () => {
  const root = fixture();
  writeSpec(root, "checkout", "SPEC-0001", "# Checkout\n\nSee [outside](../../outside.md).\n");
  writeSpecIndex(root, [indexItem("SPEC-0001", "checkout.md", "Spec checkout", "draft")]);

  const report = await auditDocuments(root, "spec");
  assert.ok(codes(report).includes("link-escapes-root"));
});

test("flags index stale, duplicate, metadata-mismatch, and ordering problems", async () => {
  const root = fixture();
  writeSpec(root, "checkout", "SPEC-0001", "# Checkout\n");
  writeSpec(root, "other", "SPEC-0002", "# Other\n");
  writeSpecIndex(root, [
    indexItem("SPEC-0002", "other.md", "Spec other", "draft"),
    indexItem("SPEC-0001", "checkout.md", "Wrong Title", "active"),
    indexItem("SPEC-0001", "checkout.md", "Spec checkout", "draft"),
    indexItem("SPEC-GONE", "ghost.md", "Ghost", "draft"),
  ]);

  const report = await auditDocuments(root, "spec");
  for (const code of ["index-stale-entry", "index-duplicate-entry", "index-metadata-mismatch", "index-ordering"]) {
    assert.ok(codes(report).includes(code), `expected ${code}`);
  }
});

test("flags unparseable index items", async () => {
  const root = fixture();
  writeSpec(root, "checkout", "SPEC-0001", "# Checkout\n");
  writeFile(
    root,
    "docs/specs/README.md",
    "---\ntype: index\nof: spec\nstatus: active\ntitle: Spec Index\ncreated: 2026-01-01\n---\n# Spec Index\n\n## Index\n\n- not an index item\n",
  );

  const report = await auditDocuments(root, "spec");
  assert.ok(codes(report).includes("index-unparseable"));
});

test("classifies orphan navigation and relation findings", async () => {
  const root = fixture();
  writeSpec(root, "checkout", "SPEC-0001", "# Checkout\n");
  writeSpecIndex(root, []);

  const report = await auditDocuments(root, "spec");
  assert.ok(codes(report).includes("orphan-index"));
  assert.ok(codes(report).includes("orphan-navigation"));
  assert.ok(codes(report).includes("orphan-relation"));
});

test("downgrades orphan severity for root-eligible types", async () => {
  const root = fixture();
  writeFile(
    root,
    "docs/ideas/spark.md",
    "---\nid: IDEA-0001\ntype: idea\nstatus: draft\ntitle: Spark\ncreated: 2026-01-01\n---\n# Spark\n",
  );

  const report = await auditDocuments(root, "idea");
  const nav = report.findings.find((finding) => finding.code === "orphan-navigation");
  const rel = report.findings.find((finding) => finding.code === "orphan-relation");
  assert.equal(nav?.severity, "info");
  assert.equal(rel?.severity, "info");
});

test("suppresses orphan navigation when the doc is indexed", async () => {
  const root = fixture();
  writeSpec(root, "checkout", "SPEC-0001", "# Checkout\n");
  writeSpecIndex(root, [indexItem("SPEC-0001", "checkout.md", "Spec checkout", "draft")]);

  const report = await auditDocuments(root, "spec");
  assert.ok(!codes(report).includes("orphan-navigation"));
});

test("suppresses orphan relation when relations exist", async () => {
  const root = fixture();
  writeSpec(root, "checkout", "SPEC-0001", "# Checkout\n", "relations:\n  implements: [IDEA-0001]\n");
  writeFile(
    root,
    "docs/ideas/spark.md",
    "---\nid: IDEA-0001\ntype: idea\nstatus: draft\ntitle: Spark\ncreated: 2026-01-01\n---\n# Spark\n",
  );
  writeSpecIndex(root, [indexItem("SPEC-0001", "checkout.md", "Spec checkout", "draft")]);

  const report = await auditDocuments(root, "spec");
  assert.ok(!codes(report).includes("orphan-relation"));
});

test("does not check external links by default", async () => {
  const root = fixture();
  writeSpec(root, "checkout", "SPEC-0001", "# Checkout\n\nSee [docs](https://example.com/x).\n");
  writeSpecIndex(root, [indexItem("SPEC-0001", "checkout.md", "Spec checkout", "draft")]);

  const report = await auditDocuments(root, "spec");
  assert.ok(!codes(report).some((code) => code.startsWith("external-link")));
});

test("detects case-only mismatches on case-insensitive filesystems", async () => {
  const root = fixture();
  writeSpec(root, "checkout", "SPEC-0001", "# Checkout\n\nSee [other](OTHER.md).\n");
  writeSpec(root, "other", "SPEC-0002", "# Other\n");
  writeSpecIndex(root, [
    indexItem("SPEC-0001", "checkout.md", "Spec checkout", "draft"),
    indexItem("SPEC-0002", "other.md", "Spec other", "draft"),
  ]);

  const report = await auditDocuments(root, "spec");
  if (fs.existsSync(path.join(root, "docs/specs", "OTHER.md"))) {
    assert.ok(codes(report).includes("link-case-mismatch"));
  } else {
    assert.ok(codes(report).includes("broken-link"));
  }
});

test("localized siblings share artifact identity for self and reciprocal checks", async () => {
  const root = fixture();
  writeSpec(root, "checkout", "SPEC-0001", "# Checkout\n");
  writeFile(
    root,
    "docs/specs/checkout.ja.md",
    "---\nid: SPEC-0001\ntype: spec\nstatus: draft\ntitle: Checkout JA\ncreated: 2026-01-01\nowners: [team]\nrelations:\n  implements: [IDEA-0001]\n  related: [SPEC-0001]\n---\n# Checkout JA\n",
  );
  writeFile(
    root,
    "docs/ideas/spark.md",
    "---\nid: IDEA-0001\ntype: idea\nstatus: draft\ntitle: Spark\ncreated: 2026-01-01\nrelations:\n  implemented-by: [../specs/checkout.md]\n---\n# Spark\n",
  );

  const collected = await collectFindings(root, { type: "spec" });
  const codes = collected.findings.map((finding) => finding.ruleId);
  assert.ok(codes.includes("self-relation"), "a relation to the shared artifact id is a self-relation");
  assert.ok(!codes.includes("inconsistent-reciprocal-relation"), "a back-link naming the sibling file still resolves to the same artifact");
  assert.ok(!codes.includes("duplicate-id"));
  assert.ok(!codes.includes("ambiguous-relation-target"));
});

test("documented blocking rules flag findings and gate health", async () => {
  const root = fixture();
  writeSpec(
    root,
    "checkout",
    "SPEC-0001",
    "# Checkout\n\nSee [flow](missing.md).\n",
    "relations:\n  implements: [SPEC-GONE]\n",
  );
  writeSpecIndex(root, []);

  const collected = await collectFindings(root, { type: "spec" });
  const byRule = new Map(collected.findings.map((finding) => [finding.ruleId, finding]));

  for (const ruleId of ["broken-relation-link", "broken-link", "index-missing-entry"]) {
    const flagged = byRule.get(ruleId);
    assert.ok(flagged, `${ruleId} should be reported`);
    assert.equal(flagged.blocking, true, `${ruleId} should block`);
  }

  const health = summarizeHealth(collected, collected.findings);
  assert.ok(health.blocking >= 3, "blocking findings must count toward health gating");
});
