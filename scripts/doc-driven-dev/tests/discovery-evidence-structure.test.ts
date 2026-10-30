import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { fetchArtifactBodies } from "../src/skills/doc-driven-dev-graph/scripts/lib/artifact_context";
import { hasSection, headingNames, sectionBody } from "../src/skills/lib/markdown_sections";

/**
 * Issue #164 — discovery bounded-head / append-only-evidence structure.
 *
 * The lifecycle analysis (Issue #127, Bucket C2) measured discovery as
 * ~93% of corpus body bytes: write-once research dumps. L1 metadata was
 * already body-free, so the channel that actually pays for that mass is
 * the L2 body fetch (and any direct file read) — every fetch of a
 * discovery doc pulls the full evidence dump into context. The convention
 * fix is structural: a bounded head (`## Summary` + the working sections)
 * above an append-only `## Evidence` tail, so a reader who only needs the
 * conclusions stops at the tail heading while evidence stays on the doc
 * for audit/traceability.
 *
 * These tests pin the template shape, the canonical/localized tail
 * heading, and the measurable head-vs-tail split under a real L2 fetch —
 * including the grandfathered case of a legacy doc with no `## Evidence`.
 */

const skillRoot = path.resolve(
  __dirname,
  "../../../packages/doc-driven-dev/.apm/skills",
);

const FRONT_MATTER = [
  "---",
  'id: "DISC-0001"',
  'type: "discovery"',
  'status: "draft"',
  'title: "Evidence heavy"',
  'created: "2026-10-30"',
  'updated: "2026-10-30"',
  "owners: []",
  "relations:",
  "  source:",
  '    - "https://example.com/research"',
  "---",
  "",
].join("\n");

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ddd-discovery-structure-"));
}

function runDiscovery(cwd: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [path.join(skillRoot, "discovery-doc", "scripts", "new_discovery.js"), ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
}

/** `##`-level heading lines in document order — the shape the contract asserts. */
function h2Headings(content: string): string[] {
  return content
    .split(/\r?\n/)
    .filter((line) => /^##\s+\S/.test(line.trimEnd()))
    .map((line) => line.trim());
}

/** Byte offset of the line carrying the `## Evidence` heading, or -1. */
function evidenceHeadingOffset(body: string): number {
  const match = /^##\s+Evidence\s*$/m.exec(body);
  return match ? match.index : -1;
}

test("new_discovery.js emits the bounded head and append-only evidence tail", () => {
  const repo = tempRepo();
  const result = runDiscovery(repo, ["--title", "Research A"]);
  assert.equal(result.status, 0, result.stderr);

  const content = fs.readFileSync(path.join(repo, "docs/discovery/research-a.md"), "utf8");
  const headings = h2Headings(content);

  // Bounded head: Summary opens the body and precedes the working sections.
  assert.equal(headings[0], "## Summary");
  assert.equal(headings[1], "## Exploration Goal");

  // The append-only tail is the last section — nothing follows it.
  const last = headings.at(-1) as string;
  assert.equal(last, "## Evidence");
  assert.equal(headings.at(-2), "## Sources and Relations");

  assert.equal(hasSection(content, "Summary"), true);
  assert.equal(hasSection(content, "Evidence"), true);
  assert.match(sectionBody(content, "Evidence"), /[Aa]ppend-only/);
});

test("shipped en/ja templates carry the structure and the declared aliases", () => {
  const templatesDir = path.join(skillRoot, "discovery-doc", "assets", "templates");
  const en = fs.readFileSync(path.join(templatesDir, "discovery.md"), "utf8");
  const ja = fs.readFileSync(path.join(templatesDir, "discovery.ja.md"), "utf8");

  const enHeadings = h2Headings(en);
  assert.equal(enHeadings[0], "## Summary");
  assert.equal(enHeadings.at(-1), "## Evidence");

  const jaHeadings = h2Headings(ja);
  assert.equal(jaHeadings.length, enHeadings.length);
  assert.equal(jaHeadings[0], "## 要約");
  assert.equal(jaHeadings.at(-1), "## エビデンス");

  // The tail heading resolves through the canonical name on both locales —
  // tooling never has to know which template wrote the doc.
  assert.ok(headingNames("Evidence").includes("エビデンス"));
  assert.ok(headingNames("Summary").includes("要約"));
  assert.equal(hasSection(ja, "Evidence"), true);
  assert.match(sectionBody(ja, "Evidence"), /追記専用/);
});

test("L2 fetch returns the whole body while the bounded head stays small", () => {
  const repo = tempRepo();
  const dir = path.join(repo, "docs/discovery");
  fs.mkdirSync(dir, { recursive: true });

  const tail = "- 2026-10-30: captured dump\n\n" + "evidence line\n".repeat(4000);
  const body = [
    "# Evidence heavy",
    "",
    "## Summary",
    "",
    "Conclusion is option B; confidence medium. Evidence below.",
    "",
    "## Exploration Goal",
    "",
    "Pick an auth strategy.",
    "",
    "## Tentative Conclusions and Hypotheses",
    "",
    "- B (hypothesis)",
    "",
    "## Sources and Relations",
    "",
    "- https://example.com/research",
    "",
    "## Evidence",
    "",
    tail,
  ].join("\n");
  fs.writeFileSync(path.join(dir, "evidence-heavy.md"), `${FRONT_MATTER}${body}`, "utf8");

  const result = fetchArtifactBodies(repo, [{ path: "docs/discovery/evidence-heavy.md" }]);
  assert.deepEqual(result.findings, []);
  assert.equal(result.documents.length, 1);

  const fetched = result.documents[0].body;
  // L2 still returns the entire body — the contract is unchanged; the
  // structure is what bounds how much of it a conclusions-only reader
  // must consume.
  const offset = evidenceHeadingOffset(fetched);
  assert.ok(offset > 0, "expected an ## Evidence heading in the fetched body");
  const headBytes = Buffer.byteLength(fetched.slice(0, offset), "utf8");
  const bodyBytes = Buffer.byteLength(fetched, "utf8");

  // The head carries the summary, reasoning, and links; the tail carries
  // ~56 KB of append-only dump. The head is the bounded read.
  assert.ok(headBytes < 1024, `bounded head should stay small, got ${headBytes} B`);
  assert.ok(bodyBytes > 50_000, `tail should hold the mass, got ${bodyBytes} B total`);
  assert.ok(headBytes / bodyBytes < 0.05, "head must be a small fraction of the body");
  assert.match(sectionBody(fetched, "Evidence"), /captured dump/);
});

test("grandfathered discovery docs without ## Evidence still fetch cleanly", () => {
  const repo = tempRepo();
  const dir = path.join(repo, "docs/discovery");
  fs.mkdirSync(dir, { recursive: true });

  // Pre-#164 shape: the evidence dump sits inline in the body with no tail
  // section — exactly the corpus fixture the analysis measured.
  const body = `# Legacy dump\n\n${"evidence row\n".repeat(3000)}`;
  fs.writeFileSync(path.join(dir, "legacy-dump.md"), `${FRONT_MATTER}${body}`, "utf8");

  const result = fetchArtifactBodies(repo, [{ path: "docs/discovery/legacy-dump.md" }]);
  assert.deepEqual(result.findings, []);
  assert.equal(result.documents.length, 1);

  const fetched = result.documents[0].body;
  // Nothing special-cases the missing section: the doc stays fetchable and
  // lintable as-is; restructuring is opportunistic, never forced.
  assert.equal(hasSection(fetched, "Evidence"), false);
  assert.equal(evidenceHeadingOffset(fetched), -1);
  assert.ok(Buffer.byteLength(fetched, "utf8") > 30_000);
});
