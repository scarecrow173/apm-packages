import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildIndex,
  docEntries,
  emptyIndexForDir,
  GENERATED_INDEX_MARKER,
  GENERATED_SETTLED_MARKER,
  mergeManagedIndex,
} from "../src/skills/lib/doc_suite_utils";
import { buildIndex as buildAdrIndex } from "../src/skills/adr-doc/scripts/lib/adr_utils";

const adrRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/adr-doc");
const maintenanceRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-maintenance");

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

// The generated `.apm` bundles are the public contract — e2e cases spawn the
// shipped CLIs the same way doc-driven-dev-graph-scaffold.test.ts does
// (rebuild with `pnpm run build` before running this file).
function runSkill(root: string, name: string, args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", name), ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

// Everything the generated marker owns: the Directory line, the index table,
// and the optional `## Settled` tier. Hand-written preamble sits before the
// marker, trailing prose after the generated region.
function managedRegion(content: string): string {
  return content.slice(content.indexOf(GENERATED_INDEX_MARKER));
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
  const adrWriter = await buildAdrIndex(repo, "docs/adr");
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

test("alias dir without its own indexTitle falls back to the canonical contract title", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/decisions/0003-monorepo.md", {
    id: "ADR-0003", type: "adr", status: "accepted", title: "Keep a monorepo", created: "2026-01-04",
  }, "# 3. Keep a monorepo\n");

  const content = await buildIndex(repo, "adr", "docs/decisions");
  // The alias contract row carries no indexTitle; the canonical docs/adr
  // contract row supplies it so the heading matches the ADR writer's legacy
  // hardcoded title rather than the generic `${idPrefix} Documents`.
  assert.ok(content.startsWith("# Architecture Decision Records"), content);
  assert.match(content, /Directory: `docs\/decisions`/);
  assert.match(content, /\| ADR-0003 \| Keep a monorepo \| accepted \|/);
});

test("idFromFile applies to the basename for nested ADR files", async () => {
  const repo = seedAdrRepo();
  // walkMarkdownFiles recurses — a nested MADR-numbered file must derive its
  // id from the basename, not fail the `^(\d+)-` anchor on the relative path.
  writeFile(repo, "docs/adr/archive/0011-keep-cqrs.md", "# 11. Keep CQRS\n\n## Context\n\nEvent sourcing.\n");
  const entries = await docEntries(repo, "adr");
  const nested = entries.find((entry) => entry.file === "archive/0011-keep-cqrs.md");
  assert.ok(nested, "nested ADR must produce an entry");
  assert.equal(nested.id, "ADR-0011");
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

// ---------------------------------------------------------------------------
// End-to-end: the three producers spawn as the shipped `.apm` CLIs.
// ---------------------------------------------------------------------------

test("new_adr, update_index --write, and doc_maintenance produce the same managed index", () => {
  const repo = tempRepo();
  const scaffold = runSkill(maintenanceRoot, "scaffold_docs.js", ["--cwd", repo], repo);
  assert.equal(scaffold.status, 0, scaffold.stderr);

  for (const title of ["Adopt MADR", "Use PostgreSQL"]) {
    const created = runSkill(adrRoot, "new_adr.js", ["--title", title, "--cwd", repo], repo);
    assert.equal(created.status, 0, created.stderr);
  }
  const indexPath = path.join(repo, "docs/adr/README.md");
  const producerA = fs.readFileSync(indexPath, "utf8");

  // Producer B: the shared maintenance writer rebuilds the missing index.
  fs.unlinkSync(indexPath);
  const maintenance = runSkill(
    maintenanceRoot,
    "doc_maintenance.js",
    ["apply", "--dir", "docs/adr", "--cwd", repo],
    repo,
  );
  assert.equal(maintenance.status, 0, maintenance.stderr);
  const producerB = fs.readFileSync(indexPath, "utf8");

  // Producer C: the dedicated ADR index writer.
  fs.unlinkSync(indexPath);
  const update = runSkill(adrRoot, "update_index.js", ["--dir", "docs/adr", "--write", "--cwd", repo], repo);
  assert.equal(update.status, 0, update.stderr);
  const producerC = fs.readFileSync(indexPath, "utf8");

  for (const content of [producerA, producerB, producerC]) {
    assert.ok(content.startsWith("# Architecture Decision Records"), content);
    assert.match(content, /adopt-madr\.md/);
    assert.match(content, /use-postgresql\.md/);
  }
  assert.equal(managedRegion(producerB), managedRegion(producerA));
  assert.equal(managedRegion(producerC), managedRegion(producerA));
});

test("update_index --write preserves hand-written preamble and tail on a managed index", () => {
  const repo = tempRepo();
  const scaffold = runSkill(maintenanceRoot, "scaffold_docs.js", ["--cwd", repo], repo);
  assert.equal(scaffold.status, 0, scaffold.stderr);
  const first = runSkill(adrRoot, "new_adr.js", ["--title", "Adopt MADR", "--cwd", repo], repo);
  assert.equal(first.status, 0, first.stderr);

  const indexPath = path.join(repo, "docs/adr/README.md");
  const managed = fs.readFileSync(indexPath, "utf8");
  fs.writeFileSync(indexPath, `# Custom Intro\n\n${managed}\n\n## Team Notes\n\nhand written\n`, "utf8");

  // A second ADR arrives without touching the index, so regeneration must
  // merge new rows while leaving the hand-written bookends in place.
  const second = runSkill(adrRoot, "new_adr.js", ["--title", "Use PostgreSQL", "--cwd", repo, "--no-index"], repo);
  assert.equal(second.status, 0, second.stderr);

  const update = runSkill(adrRoot, "update_index.js", ["--dir", "docs/adr", "--write", "--cwd", repo], repo);
  assert.equal(update.status, 0, update.stderr);

  const content = fs.readFileSync(indexPath, "utf8");
  assert.ok(content.startsWith("# Custom Intro"), content);
  assert.ok(content.indexOf("# Custom Intro") < content.indexOf(GENERATED_INDEX_MARKER));
  assert.match(content, /## Team Notes\n\nhand written/);
  assert.ok(content.indexOf("## Team Notes") > content.indexOf(GENERATED_INDEX_MARKER));
  // Rows were regenerated across the merge, not appended stale.
  assert.match(content, /adopt-madr\.md/);
  assert.match(content, /use-postgresql\.md/);
});

test("hand-curated README still refused by default; --force replaces it", () => {
  const repo = tempRepo();
  const scaffold = runSkill(maintenanceRoot, "scaffold_docs.js", ["--cwd", repo], repo);
  assert.equal(scaffold.status, 0, scaffold.stderr);
  const first = runSkill(adrRoot, "new_adr.js", ["--title", "Adopt MADR", "--cwd", repo], repo);
  assert.equal(first.status, 0, first.stderr);

  const indexPath = path.join(repo, "docs/adr/README.md");
  const curated = "# My Notes\n\nhand curated\n";
  fs.writeFileSync(indexPath, curated, "utf8");

  const refused = runSkill(adrRoot, "update_index.js", ["--dir", "docs/adr", "--write", "--cwd", repo], repo);
  assert.equal(refused.status, 0, refused.stderr);
  assert.match(refused.stdout + refused.stderr, /hand-curated/);
  assert.equal(fs.readFileSync(indexPath, "utf8"), curated);

  const forced = runSkill(adrRoot, "update_index.js", ["--dir", "docs/adr", "--write", "--force", "--cwd", repo], repo);
  assert.equal(forced.status, 0, forced.stderr);
  const content = fs.readFileSync(indexPath, "utf8");
  assert.ok(content.includes(GENERATED_INDEX_MARKER), content);
  assert.match(content, /adopt-madr\.md/);
});

test("update_index --dir docs/decisions writes the canonical ADR index at the alias dir", () => {
  const repo = tempRepo();
  // Alias dirs are not scaffolded; seed one ADR so the dir exists.
  writeDoc(repo, "docs/decisions/0003-monorepo.md", {
    id: "ADR-0003", type: "adr", status: "accepted", title: "Keep a monorepo", created: "2026-01-04",
  }, "# 3. Keep a monorepo\n");

  const update = runSkill(adrRoot, "update_index.js", ["--dir", "docs/decisions", "--write", "--cwd", repo], repo);
  assert.equal(update.status, 0, update.stderr);

  const content = fs.readFileSync(path.join(repo, "docs/decisions/README.md"), "utf8");
  // The alias contract row carries no indexTitle, so the canonical docs/adr
  // contract supplies it — same H1 as the canonical dir, not "ADR Documents".
  assert.ok(content.startsWith("# Architecture Decision Records"), content);
  assert.ok(content.includes(GENERATED_INDEX_MARKER), content);
  assert.match(content, /Directory: `docs\/decisions`/);
  assert.match(content, /\| ADR-0003 \| Keep a monorepo \| accepted \|/);
});

test("update_index rejects a non-adr --dir without writing", () => {
  const repo = tempRepo();
  const scaffold = runSkill(maintenanceRoot, "scaffold_docs.js", ["--cwd", repo], repo);
  assert.equal(scaffold.status, 0, scaffold.stderr);

  // docs/ideas is doc-suite territory (resident type: idea); the ADR writer
  // must fail closed on the ownership boundary, before touching any file.
  const ideasIndex = path.join(repo, "docs/ideas/README.md");
  const before = fs.existsSync(ideasIndex) ? fs.readFileSync(ideasIndex, "utf8") : null;

  const rejected = runSkill(adrRoot, "update_index.js", ["--dir", "docs/ideas", "--write", "--cwd", repo], repo);
  assert.notEqual(rejected.status, 0, "non-adr --dir must fail the type-scope check");
  assert.match(rejected.stderr, /Scope mismatch/);
  if (before === null) assert.ok(!fs.existsSync(ideasIndex));
  else assert.equal(fs.readFileSync(ideasIndex, "utf8"), before);
});

test("settled ADRs land in the ## Settled tier identically across all three producers", () => {
  const repo = tempRepo();
  const scaffold = runSkill(maintenanceRoot, "scaffold_docs.js", ["--cwd", repo], repo);
  assert.equal(scaffold.status, 0, scaffold.stderr);

  const adrs: [string, string][] = [
    ["Keep REST", "accepted"],
    ["Drop SOAP", "rejected"],
    ["Retire XML", "deprecated"],
    ["Move to gRPC", "superseded"],
  ];
  for (const [title, status] of adrs) {
    const created = runSkill(adrRoot, "new_adr.js", ["--title", title, "--status", status, "--cwd", repo], repo);
    assert.equal(created.status, 0, created.stderr);
  }
  const indexPath = path.join(repo, "docs/adr/README.md");
  const producerA = fs.readFileSync(indexPath, "utf8");

  fs.unlinkSync(indexPath);
  const maintenance = runSkill(
    maintenanceRoot,
    "doc_maintenance.js",
    ["apply", "--dir", "docs/adr", "--cwd", repo],
    repo,
  );
  assert.equal(maintenance.status, 0, maintenance.stderr);
  const producerB = fs.readFileSync(indexPath, "utf8");

  fs.unlinkSync(indexPath);
  const update = runSkill(adrRoot, "update_index.js", ["--dir", "docs/adr", "--write", "--cwd", repo], repo);
  assert.equal(update.status, 0, update.stderr);
  const producerC = fs.readFileSync(indexPath, "utf8");

  // ADR settled statuses come from doc_lifecycle: rejected/deprecated/
  // superseded drop below `## Settled`; accepted stays in the active table.
  for (const content of [producerA, producerB, producerC]) {
    const settledAt = content.indexOf("## Settled");
    assert.ok(settledAt > 0, content);
    assert.ok(content.includes(GENERATED_SETTLED_MARKER), content);
    const activeRegion = content.slice(0, settledAt);
    const settledRegion = content.slice(settledAt);
    assert.match(activeRegion, /keep-rest\.md/);
    for (const file of ["drop-soap", "retire-xml", "move-to-grpc"]) {
      assert.doesNotMatch(activeRegion, new RegExp(`${file}\\.md`));
      assert.match(settledRegion, new RegExp(`\\| ADR-\\w+ \\| [^|]+ \\| (rejected|deprecated|superseded) \\| \\[${file}\\.md\\]`));
    }
  }
  assert.equal(managedRegion(producerB), managedRegion(producerA));
  assert.equal(managedRegion(producerC), managedRegion(producerA));
});

test("a foreign-typed file in docs/adr is indexed identically by all three producers", () => {
  const repo = tempRepo();
  const scaffold = runSkill(maintenanceRoot, "scaffold_docs.js", ["--cwd", repo], repo);
  assert.equal(scaffold.status, 0, scaffold.stderr);
  const first = runSkill(adrRoot, "new_adr.js", ["--title", "Adopt MADR", "--cwd", repo], repo);
  assert.equal(first.status, 0, first.stderr);

  // A misplaced idea squatting in ADR territory is in scope for the index —
  // doc_lint's index-missing-entry rule requires in-scope docs to be indexed —
  // so every producer renders its own IDEA-* row. The ADR filename fallback
  // must not rewrite the declared id into ADR-0099.
  writeDoc(repo, "docs/adr/0099-note.md", {
    id: "IDEA-0099", type: "idea", status: "draft", title: "Misplaced idea", created: "2026-01-03",
  }, "# Misplaced\n");

  const second = runSkill(adrRoot, "new_adr.js", ["--title", "Use PostgreSQL", "--cwd", repo], repo);
  assert.equal(second.status, 0, second.stderr);
  const indexPath = path.join(repo, "docs/adr/README.md");
  const producerA = fs.readFileSync(indexPath, "utf8");

  fs.unlinkSync(indexPath);
  const maintenance = runSkill(
    maintenanceRoot,
    "doc_maintenance.js",
    ["apply", "--dir", "docs/adr", "--cwd", repo],
    repo,
  );
  assert.equal(maintenance.status, 0, maintenance.stderr);
  const producerB = fs.readFileSync(indexPath, "utf8");

  fs.unlinkSync(indexPath);
  const update = runSkill(adrRoot, "update_index.js", ["--dir", "docs/adr", "--write", "--cwd", repo], repo);
  assert.equal(update.status, 0, update.stderr);
  const producerC = fs.readFileSync(indexPath, "utf8");

  for (const content of [producerA, producerB, producerC]) {
    assert.match(content, /\| IDEA-0099 \| Misplaced idea \| draft \|/);
    assert.doesNotMatch(content, /ADR-0099/);
  }
  assert.equal(managedRegion(producerB), managedRegion(producerA));
  assert.equal(managedRegion(producerC), managedRegion(producerA));
});

test("new_adr --no-index leaves README bytes untouched; --force-index overwrites a hand-curated README", () => {
  const repo = tempRepo();
  const scaffold = runSkill(maintenanceRoot, "scaffold_docs.js", ["--cwd", repo], repo);
  assert.equal(scaffold.status, 0, scaffold.stderr);
  const first = runSkill(adrRoot, "new_adr.js", ["--title", "Adopt MADR", "--cwd", repo], repo);
  assert.equal(first.status, 0, first.stderr);

  const indexPath = path.join(repo, "docs/adr/README.md");
  const managed = fs.readFileSync(indexPath, "utf8");

  const noIndex = runSkill(adrRoot, "new_adr.js", ["--title", "Use PostgreSQL", "--no-index", "--cwd", repo], repo);
  assert.equal(noIndex.status, 0, noIndex.stderr);
  assert.match(noIndex.stdout, /--no-index/);
  assert.equal(fs.readFileSync(indexPath, "utf8"), managed);

  const curated = "# My Notes\n\nhand curated\n";
  fs.writeFileSync(indexPath, curated, "utf8");
  const forced = runSkill(adrRoot, "new_adr.js", ["--title", "Keep CQRS", "--force-index", "--cwd", repo], repo);
  assert.equal(forced.status, 0, forced.stderr);
  const content = fs.readFileSync(indexPath, "utf8");
  assert.ok(content.includes(GENERATED_INDEX_MARKER), content);
  assert.match(content, /adopt-madr\.md/);
  assert.match(content, /use-postgresql\.md/);
  assert.match(content, /keep-cqrs\.md/);
});

test("update_index dry-run changes zero bytes", () => {
  const repo = tempRepo();
  const scaffold = runSkill(maintenanceRoot, "scaffold_docs.js", ["--cwd", repo], repo);
  assert.equal(scaffold.status, 0, scaffold.stderr);
  const first = runSkill(adrRoot, "new_adr.js", ["--title", "Adopt MADR", "--cwd", repo], repo);
  assert.equal(first.status, 0, first.stderr);

  const indexPath = path.join(repo, "docs/adr/README.md");
  const before = fs.readFileSync(indexPath, "utf8");

  const dry = runSkill(adrRoot, "update_index.js", ["--dir", "docs/adr", "--cwd", repo], repo);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /DRY RUN/);
  assert.equal(fs.readFileSync(indexPath, "utf8"), before);

  // A missing index stays missing — dry-run never creates it either.
  fs.unlinkSync(indexPath);
  const dryMissing = runSkill(adrRoot, "update_index.js", ["--dir", "docs/adr", "--cwd", repo], repo);
  assert.equal(dryMissing.status, 0, dryMissing.stderr);
  assert.match(dryMissing.stdout, /DRY RUN/);
  assert.ok(!fs.existsSync(indexPath));
});

test("second new_adr on an existing managed index preserves prior hand edits", () => {
  const repo = tempRepo();
  const scaffold = runSkill(maintenanceRoot, "scaffold_docs.js", ["--cwd", repo], repo);
  assert.equal(scaffold.status, 0, scaffold.stderr);
  const first = runSkill(adrRoot, "new_adr.js", ["--title", "Adopt MADR", "--cwd", repo], repo);
  assert.equal(first.status, 0, first.stderr);

  const indexPath = path.join(repo, "docs/adr/README.md");
  const managed = fs.readFileSync(indexPath, "utf8");
  fs.writeFileSync(indexPath, `# Custom Intro\n\n${managed}\n\n## Team Notes\n\nhand written\n`, "utf8");

  // new_adr's index refresh is a merge, not an overwrite: hand-written
  // bookends survive and the new row lands inside the generated region.
  const second = runSkill(adrRoot, "new_adr.js", ["--title", "Use PostgreSQL", "--cwd", repo], repo);
  assert.equal(second.status, 0, second.stderr);

  const content = fs.readFileSync(indexPath, "utf8");
  assert.ok(content.startsWith("# Custom Intro"), content);
  assert.ok(content.indexOf("# Custom Intro") < content.indexOf(GENERATED_INDEX_MARKER));
  assert.match(content, /## Team Notes\n\nhand written/);
  assert.ok(content.indexOf("## Team Notes") > content.indexOf(GENERATED_INDEX_MARKER));
  assert.match(content, /adopt-madr\.md/);
  assert.match(content, /use-postgresql\.md/);
});
