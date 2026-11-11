import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildIndex,
  docEntries,
  emptyIndexForDir,
  GENERATED_INDEX_MARKER,
  mergeManagedIndex,
} from "../src/skills/lib/doc_suite_utils";
import { buildIndex as buildAdrIndex } from "../src/skills/adr-doc/scripts/lib/adr_utils";

/**
 * Issue #185 — unify ADR index writes on the common managed-index pipeline.
 *
 * The ADR-dedicated writer and the shared doc-suite pipeline historically
 * derived index rows with subtly different fallbacks (MADR filename/heading
 * numbering, `idPrefix Documents` titles vs the contract index title). The
 * common pipeline now learns the ADR row semantics via type-keyed
 * `indexRow` hooks and resolves the index H1 from the ownership contract,
 * so `buildIndex(cwd, "adr")` renders what `adr_utils.buildIndex` renders.
 */

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "adr-index-unification-"));
}

function writeFile(root: string, rel: string, content: string) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function writeDoc(root: string, rel: string, frontmatter: Record<string, string>, body = "# Doc\n") {
  const head = Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`);
  writeFile(root, rel, `---\n${head.join("\n")}\n---\n\n${body}`);
}

// Scaffold-managed README + two ADRs. One ADR has NO front matter id/title —
// MADR filename `0007-use-pgsql.md` and H1 `# 7. Use PostgreSQL` carry the
// decision number; the other is a normal new_adr-style doc (id/title
// present). A foreign-typed .md (`type: "idea"`) is also in the dir.
function seedAdrRepo(): string {
  const repo = tempRepo();
  writeFile(repo, "docs/adr/README.md", emptyIndexForDir("docs/adr") ?? "");
  writeFile(repo, "docs/adr/0007-use-pgsql.md", "# 7. Use PostgreSQL\n\n## Context\n\nStores need a relational engine.\n");
  writeDoc(repo, "docs/adr/0002-use-es.md", {
    id: "ADR-0002", type: "adr", status: "accepted", title: "Use Elasticsearch", created: "2026-01-02",
  }, "# 2. Use Elasticsearch\n");
  writeDoc(repo, "docs/adr/0099-note.md", {
    id: "IDEA-0099", type: "idea", status: "draft", title: "Misplaced idea", created: "2026-01-03",
  }, "# Misplaced\n");
  return repo;
}

test("common buildIndex renders ADR rows identical to adr semantics", async () => {
  const repo = seedAdrRepo();
  const content = await buildIndex(repo, "adr");

  // Byte-identical to what the dedicated ADR writer renders for the same dir.
  const adrWriter = await buildAdrIndex(path.join(repo, "docs/adr"), "docs/adr");
  assert.equal(content, adrWriter);

  // Contract indexTitle, not the `${idPrefix} Documents` fallback.
  assert.ok(content.startsWith("# Architecture Decision Records"), content);
  // idFromFile + titleFromHeading derive the row for the front-matter-less ADR.
  assert.match(content, /\| ADR-0007 \| Use PostgreSQL \|/);
  // The normal ADR's row is present; the idea doc keeps its own front-matter
  // id — the ADR filename fallback must not rewrite it.
  assert.match(content, /\| ADR-0002 \| Use Elasticsearch \| accepted \|/);
  assert.match(content, /\| IDEA-0099 \| Misplaced idea \|/);
  assert.doesNotMatch(content, /ADR-0099/);
});

test("docEntries for adr applies idFromFile and titleFromHeading fallbacks", async () => {
  const repo = seedAdrRepo();
  const entries = await docEntries(repo, "adr");
  const numbered = entries.find((entry) => entry.file === "0007-use-pgsql.md");
  assert.ok(numbered, "0007-use-pgsql.md must produce an entry");
  assert.equal(numbered.id, "ADR-0007");
  assert.equal(numbered.title, "Use PostgreSQL");
});

test("mergeManagedIndex preserves hand-written preamble, trailing prose, and in-region notes", () => {
  const existing = [
    "# Hand-written ADR notes",
    "",
    "Preamble prose stays.",
    "",
    GENERATED_INDEX_MARKER,
    "",
    "<!-- hand note inside the generated region stays -->",
    "",
    "Directory: `docs/adr`",
    "",
    "| ID | Title | Status | File |",
    "| --- | --- | --- | --- |",
    "| ADR-0001 | Old | proposed | [0001-old.md](./0001-old.md) |",
    "",
    "## Notes",
    "",
    "keep me",
    "",
  ].join("\n");
  const generated = [
    "# Architecture Decision Records",
    "",
    GENERATED_INDEX_MARKER,
    "",
    "Directory: `docs/adr`",
    "",
    "| ID | Title | Status | File |",
    "| --- | --- | --- | --- |",
    "| ADR-0001 | Old | proposed | [0001-old.md](./0001-old.md) |",
    "| ADR-0002 | New | accepted | [0002-new.md](./0002-new.md) |",
    "",
  ].join("\n");

  const merged = mergeManagedIndex(existing, generated);

  // Preamble bytes before the marker are preserved.
  assert.ok(merged.startsWith("# Hand-written ADR notes"), merged);
  assert.match(merged, /Preamble prose stays\./);
  assert.ok(merged.indexOf("Preamble prose stays.") < merged.indexOf(GENERATED_INDEX_MARKER));
  // Notes inside the generated region and the trailing section survive.
  assert.match(merged, /hand note inside the generated region stays/);
  assert.match(merged, /## Notes\n\nkeep me/);
  // The generated table content is refreshed.
  assert.match(merged, /\| ADR-0002 \| New \| accepted \|/);
});
