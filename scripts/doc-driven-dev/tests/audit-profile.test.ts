import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { lintScope, MATERIALIZED_RULE_IDS } from "../src/skills/lib/doc_lint";
import type { AuditProfile } from "../src/skills/lib/doc_lint";
import { scanRepository } from "../src/skills/lib/doc_repository";
import type { Finding } from "../src/skills/lib/doc_repository";

const tempDirs: string[] = [];

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-profile-"));
  tempDirs.push(root);
  return root;
}

function writeFile(root: string, relPath: string, content: string) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

const IMPLEMENTS_IDEA = "relations:\n  implements: [IDEA-0001]\n";

function writeSpec(
  root: string,
  name: string,
  id: string,
  title: string,
  body: string,
  extraFrontMatter = "",
  status = "draft",
) {
  writeFile(
    root,
    `docs/specs/${name}.md`,
    `---\nid: ${id}\ntype: spec\nstatus: ${status}\ntitle: ${title}\ncreated: "2026-01-01"\nupdated: "2026-01-01"\nowners: [team]\n${extraFrontMatter}---\n${body}`,
  );
}

function writeIdea(root: string) {
  writeFile(
    root,
    "docs/ideas/idea-a.md",
    "---\nid: IDEA-0001\ntype: idea\nstatus: draft\ntitle: Idea\ncreated: \"2026-01-01\"\nupdated: \"2026-01-01\"\nowners: [team]\n---\n# Idea\n",
  );
}

// Two specs that implement the same idea and link to each other: every
// artifact-surface invariant holds (valid front matter, declared upstream,
// inbound canonical links, a resolved outbound relation), so the only way to
// get a finding out of this fixture is index state.
function writeLinkedSpecPair(root: string) {
  writeIdea(root);
  writeSpec(root, "a", "SPEC-0001", "Spec A", "# Spec A\n\nSee [Spec B](b.md).\n", IMPLEMENTS_IDEA);
  writeSpec(root, "b", "SPEC-0002", "Spec B", "# Spec B\n\nSee [Spec A](a.md).\n", IMPLEMENTS_IDEA);
}

const indexRow = (id: string, title: string, status: string, file: string) =>
  `| ${id} | ${title} | ${status} | [${file}](./${file}) |`;

function writeSpecIndex(root: string, rows: string[]) {
  const header = "| ID | Title | Status | File |\n| --- | --- | --- | --- |";
  writeFile(
    root,
    "docs/specs/README.md",
    `---\ntype: index\nof: spec\nstatus: active\ntitle: Spec Index\ncreated: "2026-01-01"\n---\n# Spec Index\n\n${header}\n${rows.join("\n")}\n`,
  );
}

async function lint(root: string, profile?: AuditProfile, type = "spec", dir = "docs/specs"): Promise<Finding[]> {
  const model = await scanRepository({ cwd: root });
  return lintScope(model, type, dir, profile);
}

function codes(findings: Finding[]): string[] {
  return findings.map((finding) => finding.ruleId);
}

function materializedFindings(findings: Finding[]): Finding[] {
  return findings.filter((finding) => MATERIALIZED_RULE_IDS.has(finding.ruleId));
}

test.afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test("MATERIALIZED_RULE_IDS pins exactly the index-surface rule ids", () => {
  assert.deepEqual([...MATERIALIZED_RULE_IDS].sort(), [
    "index-duplicate-entry",
    "index-escapes-root",
    "index-metadata-mismatch",
    "index-missing-entry",
    "index-missing-overview",
    "index-ordering",
    "index-stale-entry",
    "index-unparseable",
    "missing-index",
    "orphan-index",
  ]);
});

test("artifact profile emits no index findings; materialized reports missing-index", async () => {
  const root = fixture();
  writeLinkedSpecPair(root);

  const artifact = await lint(root, "artifact");
  assert.deepEqual(
    codes(artifact).filter((code) => MATERIALIZED_RULE_IDS.has(code)),
    [],
    "artifact must not evaluate index-surface rules",
  );

  const materialized = await lint(root, "materialized");
  const missing = materialized.find((finding) => finding.ruleId === "missing-index");
  assert.ok(missing, "materialized reports the absent README");
  assert.equal(missing.blocking, true);
});

test("artifact profile produces zero findings on a stale index; materialized reports index-missing-entry", async () => {
  const root = fixture();
  writeLinkedSpecPair(root);
  // README exists but only lists a.md — b.md's row is missing.
  writeSpecIndex(root, [indexRow("SPEC-0001", "Spec A", "draft", "a.md")]);

  const artifact = await lint(root, "artifact");
  assert.deepEqual(codes(artifact), [], "stale index state is invisible to the artifact profile");

  const materialized = await lint(root, "materialized");
  const missingEntry = materialized.find((finding) => finding.ruleId === "index-missing-entry");
  assert.ok(missingEntry, "materialized reports the missing index row");
  assert.equal(missingEntry.path, "docs/specs/b.md");
});

test("inconsistent index emits lintIndexConsistency findings only under materialized", async () => {
  const root = fixture();
  writeLinkedSpecPair(root);
  // The index has every member row but is internally inconsistent: a stale
  // row to a missing file plus a misordered pair exercises rules that live
  // exclusively inside lintIndexConsistency.
  writeSpecIndex(root, [
    indexRow("SPEC-0002", "Spec B", "draft", "b.md"),
    indexRow("SPEC-0001", "Spec A", "draft", "a.md"),
    indexRow("SPEC-9999", "Ghost", "draft", "ghost.md"),
  ]);

  const artifact = await lint(root, "artifact");
  assert.deepEqual(materializedFindings(artifact), [], "artifact does not evaluate index consistency");

  const materialized = await lint(root, "materialized");
  const materializedCodes = codes(materialized);
  assert.ok(materializedCodes.includes("index-stale-entry"), "materialized reports the stale row");
  assert.ok(materializedCodes.includes("index-ordering"), "materialized reports the misordered rows");
});

test("artifact profile still catches canonical-document defects", async () => {
  const root = fixture();
  writeIdea(root);
  // duplicate-id: two artifacts share SPEC-0001.
  writeSpec(root, "dup-a", "SPEC-0001", "Dup A", "# Dup A\n\nSee [dup-b](dup-b.md).\n", IMPLEMENTS_IDEA);
  writeSpec(root, "dup-b", "SPEC-0001", "Dup B", "# Dup B\n\nSee [dup-a](dup-a.md).\n", IMPLEMENTS_IDEA);
  // invalid-status + broken-relation-link.
  writeSpec(
    root,
    "bad",
    "SPEC-0002",
    "Bad",
    "# Bad\n\nSee [dup-a](dup-a.md).\n",
    "relations:\n  implements: [SPEC-9999]\n",
    "bogus-status",
  );

  const specFindings = await lint(root, "artifact");
  const specCodes = codes(specFindings);
  assert.ok(specCodes.includes("duplicate-id"), "duplicate-id is an artifact defect");
  assert.ok(specCodes.includes("invalid-status"), "invalid-status is an artifact defect");
  assert.ok(specCodes.includes("broken-relation-link"), "broken-relation-link is an artifact defect");

  // missing-overview: a design directory without the required overview.md is a
  // canonical required-file finding and stays in both profiles.
  writeFile(
    root,
    "docs/designs/widget.md",
    "---\nid: DESIGN-0001\ntype: design\nstatus: draft\ntitle: Widget\ncreated: \"2026-01-01\"\nupdated: \"2026-01-01\"\nowners: [team]\n---\n# Widget\n",
  );
  const artifactDesign = await lint(root, "artifact", "design", "docs/designs");
  assert.ok(
    codes(artifactDesign).includes("missing-overview"),
    "missing-overview stays an artifact finding",
  );
  const materializedDesign = await lint(root, "materialized", "design", "docs/designs");
  assert.ok(
    codes(materializedDesign).includes("missing-overview"),
    "missing-overview stays a materialized finding too",
  );
});

test("orphan split: index membership is materialized-only; canonical orphans stay in artifact", async () => {
  const root = fixture();
  // listed.md is in the index but unreachable through canonical links or
  // relations. unlisted.md is absent from the index entirely.
  writeSpec(root, "listed", "SPEC-0001", "Listed", "# Listed\n");
  writeSpec(root, "unlisted", "SPEC-0002", "Unlisted", "# Unlisted\n");
  writeSpecIndex(root, [indexRow("SPEC-0001", "Listed", "draft", "listed.md")]);

  const orphansFor = (findings: Finding[], file: string) =>
    findings.filter((finding) => finding.path === file).map((finding) => finding.ruleId);

  const artifact = await lint(root, "artifact");
  const listedArtifact = orphansFor(artifact, "docs/specs/listed.md");
  assert.ok(listedArtifact.includes("orphan-navigation"), "index-only reachability does not count under artifact");
  assert.ok(listedArtifact.includes("orphan-relation"));
  assert.ok(!listedArtifact.includes("orphan-index"), "orphan-index is suppressed under artifact");

  const unlistedArtifact = orphansFor(artifact, "docs/specs/unlisted.md");
  assert.ok(unlistedArtifact.includes("orphan-navigation"));
  assert.ok(unlistedArtifact.includes("orphan-relation"));
  assert.ok(!unlistedArtifact.includes("orphan-index"), "orphan-index is suppressed under artifact");
  assert.deepEqual(materializedFindings(artifact), [], "no index-surface findings leak into artifact");

  const materialized = await lint(root, "materialized");
  const listedMaterialized = orphansFor(materialized, "docs/specs/listed.md");
  assert.ok(!listedMaterialized.includes("orphan-navigation"), "index README link counts as inbound under materialized");
  assert.ok(listedMaterialized.includes("orphan-relation"), "relation orphans still fire under materialized");
  assert.ok(!listedMaterialized.includes("orphan-index"), "indexed docs are not index orphans");

  const unlistedMaterialized = orphansFor(materialized, "docs/specs/unlisted.md");
  assert.ok(unlistedMaterialized.includes("orphan-index"), "materialized flags docs missing from the index");
});

test("omitting the profile behaves exactly like explicit materialized", async () => {
  const root = fixture();
  writeLinkedSpecPair(root);
  writeSpecIndex(root, [indexRow("SPEC-0001", "Spec A", "draft", "a.md")]);

  const model = await scanRepository({ cwd: root });
  const implicitProfile = lintScope(model, "spec", "docs/specs");
  const explicitMaterialized = lintScope(model, "spec", "docs/specs", "materialized");
  assert.deepEqual(implicitProfile, explicitMaterialized);
  assert.ok(codes(implicitProfile).includes("index-missing-entry"), "default keeps materialized index checks");
});
