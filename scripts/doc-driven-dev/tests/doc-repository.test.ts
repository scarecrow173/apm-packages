import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import test from "node:test";

import {
  canonicalDocRoots,
  compareFindings,
  contractForType,
  documentContracts,
  finding,
  scanRepository,
  slugifyAnchor,
  sortFindings,
} from "../src/skills/lib/doc_repository";

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-repository-test-"));
}

function writeDoc(repo: string, relative: string, frontMatter: Record<string, unknown>, body = "# Doc\n") {
  const full = path.join(repo, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, matter.stringify(body, frontMatter), "utf8");
}

function canonicalFrontMatter(overrides: Record<string, unknown> = {}) {
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

function healthyRepo() {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/checkout.md", canonicalFrontMatter({ title: "Checkout" }), [
    "# Checkout",
    "",
    "## Acceptance Criteria",
    "",
    "See [the plan](../plans/implement-checkout.md) and ![diagram](assets/flow.png).",
    "",
  ].join("\n"));
  writeDoc(repo, "docs/plans/implement-checkout.md", canonicalFrontMatter({
    id: "PLAN-0001",
    type: "plan",
    title: "Implement checkout",
    relations: { implements: ["docs/specs/checkout.md"], "verified-by": ["TSPEC-0001"] },
  }));
  writeDoc(repo, "docs/test-specs/checkout-total.md", canonicalFrontMatter({
    id: "TSPEC-0001",
    type: "test-spec",
    title: "Checkout total",
    relations: { verifies: ["SPEC-0001"] },
  }));
  writeDoc(repo, "docs/specs/README.md", {}, "# SPEC Documents\n\n[checkout](./checkout.md)\n");
  return repo;
}

test("scanRepository projects a healthy fixture deterministically", async () => {
  const repo = healthyRepo();
  const first = await scanRepository({ cwd: repo });
  const second = await scanRepository({ cwd: repo });

  const summarize = (model: typeof first) => model.files.map((file) => ({
    path: file.path,
    kind: file.kind,
    id: file.id,
    type: file.type,
    status: file.status,
    title: file.title,
    links: file.links,
    headings: file.headings,
    indexMembership: file.indexMembership,
  }));
  assert.deepEqual(summarize(first), summarize(second));
  assert.deepEqual(first.canonicalDocuments.map((doc) => doc.path), [
    "docs/plans/implement-checkout.md",
    "docs/specs/checkout.md",
    "docs/test-specs/checkout-total.md",
  ]);
  assert.deepEqual(first.indexes.map((doc) => doc.path), ["docs/specs/README.md"]);
});

test("scanner separates canonical documents, indexes, and unmanaged markdown", async () => {
  const repo = healthyRepo();
  fs.writeFileSync(path.join(repo, "NOTES.md"), "# Notes\n", "utf8");

  const model = await scanRepository({ cwd: repo });

  const spec = model.byPath.get("docs/specs/checkout.md");
  assert.equal(spec?.kind, "canonical");
  assert.deepEqual(spec?.expectedTypes, ["spec"]);
  const notes = model.byPath.get("NOTES.md");
  assert.equal(notes?.kind, "unmanaged");
  assert.deepEqual(notes?.expectedTypes, []);
  assert.equal(model.byPath.get("docs/specs/README.md")?.kind, "index");
});

test("scanner extracts markdown links, images, and heading anchors", async () => {
  const repo = healthyRepo();
  const model = await scanRepository({ cwd: repo });
  const spec = model.byPath.get("docs/specs/checkout.md");

  assert.ok(spec);
  assert.deepEqual(
    spec.links.map((link) => ({ target: link.target, isImage: link.isImage })),
    [
      { target: "../plans/implement-checkout.md", isImage: false },
      { target: "assets/flow.png", isImage: true },
    ],
  );
  assert.deepEqual(
    spec.headings.map((heading) => ({ depth: heading.depth, text: heading.text, slug: heading.slug })),
    [
      { depth: 1, text: "Checkout", slug: "checkout" },
      { depth: 2, text: "Acceptance Criteria", slug: "acceptance-criteria" },
    ],
  );
  assert.equal(model.hasAnchor(spec, "acceptance-criteria"), true);
  assert.equal(model.hasAnchor(spec, "missing"), false);
});

test("malformed front matter is isolated per document without crashing the scan", async () => {
  const repo = healthyRepo();
  const bad = path.join(repo, "docs/specs/broken.md");
  fs.writeFileSync(bad, "---\nid: [unclosed\n---\n# Broken\n", "utf8");

  const model = await scanRepository({ cwd: repo });

  const broken = model.byPath.get("docs/specs/broken.md");
  assert.ok(broken);
  assert.equal(typeof broken.parseError, "string");
  assert.equal(broken.id, null);
  assert.equal(broken.type, null);
  // The rest of the repository still projected correctly.
  assert.equal(model.byPath.get("docs/specs/checkout.md")?.id, "SPEC-0001");
});

test("duplicate artifact IDs are preserved losslessly", async () => {
  const repo = healthyRepo();
  writeDoc(repo, "docs/specs/duplicate.md", canonicalFrontMatter({ title: "Duplicate" }));

  const model = await scanRepository({ cwd: repo });

  assert.deepEqual(model.duplicateIds(), [
    { id: "SPEC-0001", paths: ["docs/specs/checkout.md", "docs/specs/duplicate.md"] },
  ]);
  const lookup = model.lookupById("SPEC-0001");
  assert.equal(lookup.status, "ambiguous");
  if (lookup.status === "ambiguous") {
    assert.deepEqual(lookup.candidates.map((doc) => doc.path), [
      "docs/specs/checkout.md",
      "docs/specs/duplicate.md",
    ]);
  }
  assert.equal(model.lookupById("SPEC-9999").status, "none");
  assert.equal(model.lookupById("PLAN-0001").status, "unique");
});

test("relation resolution handles IDs, paths, ambiguity, and external targets", async () => {
  const repo = healthyRepo();
  const model = await scanRepository({ cwd: repo });
  const plan = model.byPath.get("docs/plans/implement-checkout.md");
  assert.ok(plan);

  const byId = model.resolveRelationTarget(plan, "SPEC-0001");
  assert.equal(byId.status, "resolved");
  if (byId.status === "resolved") assert.equal(byId.document.path, "docs/specs/checkout.md");

  const byPath = model.resolveRelationTarget(plan, "docs/specs/checkout.md");
  assert.equal(byPath.status, "resolved");

  const missing = model.resolveRelationTarget(plan, "docs/specs/missing.md");
  assert.equal(missing.status, "unresolved");

  const external = model.resolveRelationTarget(plan, "https://example.com/spec");
  assert.equal(external.status, "external");

  const nonDocFile = path.join(repo, "docs/specs/assets/flow.png");
  fs.mkdirSync(path.dirname(nonDocFile), { recursive: true });
  fs.writeFileSync(nonDocFile, "png", "utf8");
  const fresh = await scanRepository({ cwd: repo });
  const planAgain = fresh.byPath.get("docs/plans/implement-checkout.md");
  assert.ok(planAgain);
  assert.equal(fresh.resolveRelationTarget(planAgain, "docs/specs/assets/flow.png").status, "resolved-file");
});

test("path resolution refuses escapes outside the repository root", async () => {
  const repo = healthyRepo();
  fs.writeFileSync(path.join(os.tmpdir(), "outside-secret.md"), "# outside\n", "utf8");
  const model = await scanRepository({ cwd: repo });
  const spec = model.byPath.get("docs/specs/checkout.md");
  assert.ok(spec);

  assert.equal(model.resolvePath(spec, "../../../outside-secret.md").status, "escaped");
  assert.equal(model.resolvePath(spec, path.join(os.tmpdir(), "outside-secret.md")).status, "escaped");
  const fragmentOnly = model.resolvePath(spec, "#acceptance-criteria");
  assert.equal(fragmentOnly.status, "resolved");
  assert.equal(fragmentOnly.fragment, "acceptance-criteria");
});

test("index membership is recorded from index file links", async () => {
  const repo = healthyRepo();
  const model = await scanRepository({ cwd: repo });

  assert.deepEqual(model.byPath.get("docs/specs/checkout.md")?.indexMembership, ["docs/specs/README.md"]);
  assert.deepEqual(model.byPath.get("docs/plans/implement-checkout.md")?.indexMembership, []);
});

test("locale siblings are linked in both directions", async () => {
  const repo = healthyRepo();
  writeDoc(repo, "docs/specs/checkout.ja.md", canonicalFrontMatter({ title: "Checkout JA" }));

  const model = await scanRepository({ cwd: repo });

  assert.deepEqual(model.byPath.get("docs/specs/checkout.md")?.localeSiblings, ["docs/specs/checkout.ja.md"]);
  assert.deepEqual(model.byPath.get("docs/specs/checkout.ja.md")?.localeSiblings, ["docs/specs/checkout.md"]);
});

test("document contract registry exposes per-type metadata", () => {
  const contracts = documentContracts();
  const spec = contractForType("spec");
  assert.ok(spec);
  assert.equal(spec.idPrefix, "SPEC");
  assert.deepEqual(spec.dirs, ["docs/specs", "docs/spec", "specs", "spec"]);
  assert.ok(spec.statusValues.includes("approved"));
  assert.ok(spec.requiredFields.includes("relations"));

  const testSpec = contractForType("test-spec");
  assert.ok(testSpec);
  assert.deepEqual(testSpec.requiredRelations.map((rule) => rule.field), ["verifies"]);
  assert.deepEqual(testSpec.requiredRelations[0].targetTypes, ["spec", "design", "adr"]);

  const plan = contractForType("plan");
  assert.ok(plan);
  assert.equal(plan.requiredRelations[0].field, "verified-by");
  assert.deepEqual(plan.requiredRelations[0].appliesToStatuses, ["approved", "in-progress", "completed"]);
  assert.equal(plan.requiredRelations[0].skipField, "test-spec-skip");

  const design = contractForType("design");
  assert.ok(design);
  assert.deepEqual(design.requiredDirectoryFiles, ["overview.md"]);
  assert.ok(design.idExceptions.includes("DESIGN-OVERVIEW"));

  const impl = contractForType("impl");
  assert.ok(impl);
  assert.deepEqual(impl.dirs, ["docs/impl/ir", "docs/impl/exp"]);

  assert.ok(canonicalDocRoots().includes("docs/impl/ir"));
  assert.equal(contractForType("unknown"), null);
  assert.ok(Object.keys(contracts).length >= 10);
});

test("finding contract defaults and deterministic ordering", () => {
  const findings = sortFindings([
    finding({ ruleId: "link/missing-target", category: "link", message: "b", path: "docs/b.md", line: 3 }),
    finding({ ruleId: "front-matter/invalid", category: "front-matter", message: "a", path: "docs/a.md", severity: "warning" }),
    finding({ ruleId: "index/missing-entry", category: "index", message: "c", path: "docs/a.md", severity: "info", blocking: false }),
  ]);

  assert.equal(findings[0].ruleId, "front-matter/invalid");
  assert.equal(findings[0].severity, "warning");
  assert.equal(findings[0].blocking, false);
  assert.equal(findings[0].repair, "manual");
  assert.equal(findings[1].ruleId, "index/missing-entry");
  assert.equal(findings[2].ruleId, "link/missing-target");
  assert.equal(findings[2].blocking, true);

  const again = [...findings].reverse().sort(compareFindings);
  assert.deepEqual(again, findings);
});

test("repository paths use posix separators even on windows-style input", async () => {
  const repo = healthyRepo();
  const model = await scanRepository({ cwd: repo });
  for (const file of model.files) {
    assert.equal(file.path.includes("\\"), false, file.path);
  }
});

test("slugifyAnchor produces github-style anchors", () => {
  assert.equal(slugifyAnchor("Acceptance Criteria"), "acceptance-criteria");
  assert.equal(slugifyAnchor("  Spaces & Punctuation!  "), "spaces--punctuation");
  assert.equal(slugifyAnchor("日本語 見出し"), "日本語-見出し");
});

test("id format contract accepts legacy numeric and 22-char base62 ids only", () => {
  const spec = contractForType("spec");
  assert.ok(spec);
  assert.ok(spec.idPattern.test("SPEC-0001"));
  assert.ok(spec.idPattern.test("SPEC-034qPUpBj0VYOqxmFLijD5"));
  assert.ok(!spec.idPattern.test("SPEC-AAA"));
  assert.ok(!spec.idPattern.test("SPEC-A"));
  assert.ok(!spec.idPattern.test("SPEC-"));
  assert.ok(!spec.idPattern.test("spec_0001"));

  const impl = contractForType("impl");
  assert.ok(impl);
  assert.ok(impl.idPattern.test("IMPL-0001"));
  assert.ok(!impl.idPattern.test("IMPL-ABC"));
});

test("localized siblings share one logical artifact identity", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/checkout.md", canonicalFrontMatter({ id: "SPEC-0001" }));
  writeDoc(repo, "docs/specs/checkout.ja.md", canonicalFrontMatter({ id: "SPEC-0001", title: "Checkout JA" }));

  const model = await scanRepository({ cwd: repo });
  assert.deepEqual(model.duplicateIds(), []);

  const lookup = model.lookupById("SPEC-0001");
  assert.equal(lookup.status, "unique");
  if (lookup.status === "unique") {
    assert.equal(lookup.document.path, "docs/specs/checkout.md");
  }

  const relation = model.resolveRelationTarget(
    model.byPath.get("docs/specs/checkout.ja.md")!,
    "SPEC-0001",
  );
  assert.equal(relation.status, "resolved");
});

test("duplicate ids across distinct artifacts are still flagged", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/a.md", canonicalFrontMatter({ id: "SPEC-0001" }));
  writeDoc(repo, "docs/specs/b.md", canonicalFrontMatter({ id: "SPEC-0001", title: "B" }));

  const model = await scanRepository({ cwd: repo });
  const duplicates = model.duplicateIds();
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].id, "SPEC-0001");
  assert.equal(model.lookupById("SPEC-0001").status, "ambiguous");
});
