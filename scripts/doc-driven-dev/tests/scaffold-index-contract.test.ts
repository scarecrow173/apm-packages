import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DIRECTORY_CONTRACTS } from "../src/skills/lib/doc_ownership";
import {
  emptyIndexForDir,
  GENERATED_INDEX_MARKER,
  legacyScaffoldIndex,
  scaffoldDocsTree,
} from "../src/skills/lib/doc_suite_utils";

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-index-contract-"));
}

test("emptyIndexForDir renders each owner format and null elsewhere", () => {
  assert.equal(
    emptyIndexForDir("docs/adr"),
    `# Architecture Decision Records\n\n${GENERATED_INDEX_MARKER}\n\nDirectory: \`docs/adr\`\n\n| ID | Title | Status | File |\n| --- | --- | --- | --- |\n`,
  );
  assert.equal(
    emptyIndexForDir("docs/impl/ir"),
    `# Implementation Records\n\n${GENERATED_INDEX_MARKER}\n\nDirectory: \`docs/impl/ir\`\n\n| ID | Title | Status | File |\n| --- | --- | --- | --- |\n`,
  );
  assert.equal(
    emptyIndexForDir("docs/impl/exp"),
    `# Experiment Logs\n\n${GENERATED_INDEX_MARKER}\n\nDirectory: \`docs/impl/exp\`\n\n| File |\n| --- |\n`,
  );
  // typed shared dirs, the docs/impl container, and aliases have no contract index
  assert.equal(emptyIndexForDir("docs/specs"), null);
  assert.equal(emptyIndexForDir("docs/impl"), null);
  assert.equal(emptyIndexForDir("docs/decisions"), null);
  assert.equal(emptyIndexForDir("custom/dir"), null);
});

test("scaffoldDocsTree writes marker-bearing owner indexes for ADR/IR/EXP", async () => {
  const repo = tempRepo();
  await scaffoldDocsTree(repo);
  for (const dir of ["docs/adr", "docs/impl/ir", "docs/impl/exp"]) {
    const content = fs.readFileSync(path.join(repo, dir, "README.md"), "utf8");
    assert.ok(content.includes(GENERATED_INDEX_MARKER), `${dir} index must carry the managed marker`);
    assert.equal(content, emptyIndexForDir(dir), `${dir} index must equal the contract empty index`);
  }
  // shared typed dirs still use the typed managed index
  const specIndex = fs.readFileSync(path.join(repo, "docs/specs/README.md"), "utf8");
  assert.match(specIndex, /^# SPEC Documents/m);
  assert.ok(specIndex.includes(GENERATED_INDEX_MARKER));
});

test("empty contract index is byte-identical to what each owner writer produces on an empty dir", async () => {
  const repo = tempRepo();
  const adrDir = path.join(repo, "docs/adr");
  const irDir = path.join(repo, "docs/impl/ir");
  const expDir = path.join(repo, "docs/impl/exp");
  for (const dir of [adrDir, irDir, expDir]) fs.mkdirSync(dir, { recursive: true });

  const { buildIndex } = await import("../src/skills/adr-doc/scripts/lib/adr_utils");
  const { updateIndexForMarkdownDir, updateIndexForExperimentDir } = await import(
    "../src/skills/impl-doc/scripts/lib/impl_doc_utils"
  );

  assert.equal(await buildIndex(repo, "docs/adr"), emptyIndexForDir("docs/adr"));

  updateIndexForMarkdownDir(repo, "docs/impl/ir");
  assert.equal(fs.readFileSync(path.join(irDir, "README.md"), "utf8"), emptyIndexForDir("docs/impl/ir"));

  updateIndexForExperimentDir(repo, "docs/impl/exp");
  assert.equal(fs.readFileSync(path.join(expDir, "README.md"), "utf8"), emptyIndexForDir("docs/impl/exp"));
});

test("legacyScaffoldIndex reproduces the pre-#184 generic READMEs byte-for-byte", () => {
  assert.equal(legacyScaffoldIndex("docs/adr"), "# ADR Documents\n\nDirectory: `docs/adr`\n");
  assert.equal(legacyScaffoldIndex("docs/impl/ir"), "# Implementation Record Documents\n\nDirectory: `docs/impl/ir`\n");
  assert.equal(legacyScaffoldIndex("docs/impl/exp"), "# Experiment Log Documents\n\nDirectory: `docs/impl/exp`\n");
  assert.equal(legacyScaffoldIndex("docs/specs"), null);
});
