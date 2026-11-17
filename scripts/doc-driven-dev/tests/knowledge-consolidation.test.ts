import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import matter from "gray-matter";
import test from "node:test";

// Issue #242 — knowledge-doc consolidation contract: Knowledge is a durable
// consolidation capability, never a new impl-log. These tests pin the
// violated-contract layer directly against the distributed CLI:
// assess is read-only; apply records exactly one decision — none / route /
// integrate / create — with provenance (source) and evidence (basis)
// mandatory on every persist path, conflicts acknowledged explicitly, and
// the spec/design/ADR responsibility boundary enforced.

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");
const knowledgeRoot = path.join(skillRoot, "knowledge-doc");
const sourceSkillRoot = path.resolve(__dirname, "../src/skills/knowledge-doc");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-consolidation-test-"));
}

function runScript(name: string, args: string[], options: { cwd?: string } = {}) {
  const result = spawnSync(
    process.execPath,
    [path.join(knowledgeRoot, "scripts", name), ...args],
    {
      cwd: options.cwd || tempRepo(),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function snapshotTree(root: string): string {
  const entries: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".git", "node_modules"].includes(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      entries.push(`${path.relative(root, absolute)}:${fs.statSync(absolute).size}`);
    }
  };
  walk(root);
  return entries.sort().join("\n");
}

function fm(overrides: Record<string, unknown> = {}) {
  return {
    id: "KNOW-0001",
    type: "knowledge",
    status: "draft",
    lifecycle: "draft",
    title: "Doc",
    created: "2026-09-19",
    updated: "2026-09-19",
    owners: [],
    relations: {},
    ...overrides,
  };
}

function writeDoc(repo: string, relative: string, frontMatter: Record<string, unknown>, body = "# Doc\n") {
  const full = path.join(repo, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, matter.stringify(body, frontMatter), "utf8");
  return relative;
}

function writeKnowledge(repo: string, file: string, overrides: Record<string, unknown> = {}, body?: string) {
  return writeDoc(repo, `docs/knowledge/${file}`, fm({
    knowledge_kind: "codebase",
    ...overrides,
  }), body ?? "# Doc\n\n## Source\n\n");
}

// --- shipped surface: bilingual docs, templates, scripts --------------------

test("knowledge-doc ships the consolidation surface in both languages", () => {
  for (const file of [
    "SKILL.md",
    "SKILL.ja.md",
    "references/knowledge-conventions.md",
    "references/knowledge-conventions.ja.md",
    "references/knowledge-extraction.md",
    "references/knowledge-extraction.ja.md",
    "assets/templates/knowledge.md",
    "assets/templates/knowledge.ja.md",
    "scripts/new_knowledge.js",
    "scripts/consolidate_knowledge.js",
  ]) {
    assert.ok(fs.existsSync(path.join(knowledgeRoot, file)), `missing ${file}`);
  }
  // Source → distribution parity: the CLI being exercised is generated from
  // the TypeScript entrypoint and lib that live under src/skills/.
  for (const file of [
    "scripts/consolidate_knowledge.ts",
    "scripts/lib/consolidation.ts",
    "scripts/new_knowledge.ts",
  ]) {
    assert.ok(fs.existsSync(path.join(sourceSkillRoot, file)), `missing source ${file}`);
  }
  // The template placeholder contract: {{title}} is what the renderer
  // replaces — an uppercase {{TITLE}} would leak through into minted docs.
  for (const template of [
    "assets/templates/knowledge.md",
    "assets/templates/knowledge.ja.md",
  ]) {
    const text = fs.readFileSync(path.join(knowledgeRoot, template), "utf8");
    assert.match(text, /\{\{title\}\}/, `${template} must use the lowercase placeholder`);
    assert.doesNotMatch(text, /\{\{TITLE\}\}/, `${template} must not carry the broken placeholder`);
  }
  // Bilingual parity markers: both extraction references carry the shared
  // contract vocabulary.
  const extraction = fs.readFileSync(path.join(knowledgeRoot, "references/knowledge-extraction.md"), "utf8");
  const extractionJa = fs.readFileSync(path.join(knowledgeRoot, "references/knowledge-extraction.ja.md"), "utf8");
  for (const text of [extraction, extractionJa]) {
    assert.match(text, /consolidate_knowledge\.js/, "extraction reference names the CLI");
    assert.match(text, /integrate/, "extraction reference covers integrate");
    assert.match(text, /none/, "extraction reference covers the none decision");
    assert.match(text, /--from/, "extraction reference requires provenance");
    assert.match(text, /--basis/, "extraction reference requires evidence basis");
  }
});

// --- assess: read-only screening -------------------------------------------

test("assess is read-only and reports candidates plus the gate", () => {
  const repo = tempRepo();
  const before = snapshotTree(repo);

  const empty = runScript("consolidate_knowledge.js", ["assess", "--title", "How the cache works", "--kind", "codebase", "--json", "--cwd", repo], { cwd: repo });
  assert.equal(empty.status, 0, empty.stderr);
  const emptyReport = JSON.parse(empty.stdout);
  assert.deepEqual(emptyReport.candidates, []);
  assert.deepEqual(emptyReport.conflicts, []);
  assert.equal(emptyReport.gate, "clear");
  assert.equal(snapshotTree(repo), before, "assess must not write");

  // A durable document in a different type is a candidate with the owning
  // skill's route — consolidation reports the route, it never writes there.
  writeDoc(repo, "docs/specs/0001-cache.md", fm({
    id: "SPEC-0001", type: "spec", status: "approved", title: "Cache eviction spec",
    relations: {},
  }));
  const spec = runScript("consolidate_knowledge.js", ["assess", "--title", "Cache eviction", "--json", "--cwd", repo], { cwd: repo });
  assert.equal(spec.status, 0, spec.stderr);
  const specReport = JSON.parse(spec.stdout);
  const specCandidate = specReport.candidates.find((c: any) => c.type === "spec");
  assert.ok(specCandidate, "spec doc should be a candidate");
  assert.equal(specCandidate.route, "spec-doc");
  assert.equal(specCandidate.conflict, false, "non-knowledge candidates are routes, not conflicts");
});

test("assess flags overlapping non-settled knowledge as conflicts", () => {
  const repo = tempRepo();
  writeKnowledge(repo, "0001-cache-invalidation.md", {
    id: "KNOW-0001", title: "Cache invalidation rules", status: "confirmed",
  });

  const result = runScript("consolidate_knowledge.js", ["assess", "--title", "Cache invalidation rules", "--kind", "codebase", "--json", "--cwd", repo], { cwd: repo });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const conflict = report.conflicts.find((c: any) => c.id === "KNOW-0001");
  assert.ok(conflict, "overlapping knowledge doc must surface as a conflict");
  assert.equal(conflict.route, "integrate");
  assert.equal(report.gate, "review-required");
});

// --- apply --decision none: the explicit no-op ------------------------------

test("apply --decision none is an explicit no-op that writes nothing", () => {
  const repo = tempRepo();
  const before = snapshotTree(repo);
  const result = runScript("consolidate_knowledge.js", ["apply", "--decision", "none", "--cwd", repo], { cwd: repo });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /nothing persisted/i);
  assert.equal(snapshotTree(repo), before, "none must not write");

  const json = runScript("consolidate_knowledge.js", ["apply", "--decision", "none", "--json", "--cwd", repo], { cwd: repo });
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), { decision: "none", recorded: false, note: null });
});

// --- apply --decision route: the ownership boundary -------------------------

test("apply --decision route names the owning skill and writes nothing", () => {
  const repo = tempRepo();
  const before = snapshotTree(repo);
  for (const [type, skill] of [["spec", "spec-doc"], ["design", "design-doc"], ["adr", "adr-doc"]] as const) {
    const result = runScript("consolidate_knowledge.js", ["apply", "--decision", "route", "--to", type, "--json", "--cwd", repo], { cwd: repo });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.decision, "route");
    assert.equal(payload.ownerSkill, skill);
    assert.equal(payload.recorded, false);
    assert.match(payload.guidance, new RegExp(`${skill}`));
    assert.match(payload.guidance, /never writes non-knowledge/i);
  }
  assert.equal(snapshotTree(repo), before, "route must not write");

  // `route --to knowledge` is not a route — it would be integrate/create.
  const bad = runScript("consolidate_knowledge.js", ["apply", "--decision", "route", "--to", "knowledge", "--cwd", repo], { cwd: repo });
  assert.equal(bad.status, 1, "route --to knowledge must refuse");
  assert.equal(snapshotTree(repo), before, "a refused route must not write");
});

// --- apply --decision integrate: existing-knowledge update -------------------

test("apply --decision integrate updates an existing knowledge document", () => {
  const repo = tempRepo();
  const target = writeKnowledge(repo, "0001-cache-invalidation.md", {
    id: "KNOW-0001", title: "Cache invalidation rules", status: "draft",
    relations: { source: ["docs/specs/0001-cache.md"] },
  });

  const result = runScript("consolidate_knowledge.js", [
    "apply", "--decision", "integrate",
    "--into", target,
    "--from", "run:impl-0042",
    "--basis", "confirmed by the eviction-order investigation",
    "--status", "confirmed",
    "--date", "2026-09-20",
    "--cwd", repo,
  ], { cwd: repo });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Integrated into docs\/knowledge\/0001-cache-invalidation\.md/);

  const updated = matter(fs.readFileSync(path.join(repo, target), "utf8"));
  assert.equal(updated.data.status, "confirmed");
  assert.equal(updated.data.updated, "2026-09-20");
  assert.deepEqual(updated.data.relations.source.sort(), ["docs/specs/0001-cache.md", "run:impl-0042"].sort());
  // The evidence basis lands as a dated entry under the Source section —
  // the same bookkeeping `create` writes.
  assert.match(updated.content, /- 2026-09-20 — confirmed by the eviction-order investigation \(source: run:impl-0042\)/);
});

test("apply --decision integrate requires provenance and basis", () => {
  const repo = tempRepo();
  const target = writeKnowledge(repo, "0001-k.md", { id: "KNOW-0001", title: "Rules" });
  const before = snapshotTree(repo);

  const noFrom = runScript("consolidate_knowledge.js", [
    "apply", "--decision", "integrate", "--into", target, "--basis", "x", "--cwd", repo,
  ], { cwd: repo });
  assert.equal(noFrom.status, 1, "integrate without --from must refuse");

  const noBasis = runScript("consolidate_knowledge.js", [
    "apply", "--decision", "integrate", "--into", target, "--from", "s", "--cwd", repo,
  ], { cwd: repo });
  assert.equal(noBasis.status, 1, "integrate without --basis must refuse");
  assert.match(noBasis.stderr, /--basis/);
  assert.equal(snapshotTree(repo), before, "a refused integrate must not write");
});

test("apply --decision integrate refuses non-knowledge targets — the spec/ADR boundary", () => {
  const repo = tempRepo();
  const spec = writeDoc(repo, "docs/specs/0001-cache.md", fm({
    id: "SPEC-0001", type: "spec", status: "approved", title: "Cache spec",
  }));
  const adr = writeDoc(repo, "docs/adr/0001-cache.md", fm({
    id: "ADR-0001", type: "adr", status: "accepted", title: "Cache ADR",
  }));
  const before = snapshotTree(repo);

  for (const [target, skill] of [[spec, "spec-doc"], [adr, "adr-doc"]] as const) {
    const result = runScript("consolidate_knowledge.js", [
      "apply", "--decision", "integrate", "--into", target, "--from", "s", "--basis", "b", "--cwd", repo,
    ], { cwd: repo });
    assert.equal(result.status, 1, `integrate into ${target} must refuse`);
    assert.match(result.stderr, /not a knowledge document/);
    assert.match(result.stderr, new RegExp(`route through ${skill}`));
  }
  assert.equal(snapshotTree(repo), before, "a refused integrate must not write");
});

test("apply --decision integrate refuses a settled knowledge target", () => {
  const repo = tempRepo();
  const target = writeKnowledge(repo, "0001-k.md", { id: "KNOW-0001", title: "Rules", status: "archived" });
  const result = runScript("consolidate_knowledge.js", [
    "apply", "--decision", "integrate", "--into", target, "--from", "s", "--basis", "b", "--cwd", repo,
  ], { cwd: repo });
  assert.equal(result.status, 1, "integrate into a settled doc must refuse");
  assert.match(result.stderr, /settled/);
});

// --- apply --decision create: conflict gating + recorded provenance ----------

test("apply --decision create refuses while conflicts are unacknowledged", () => {
  const repo = tempRepo();
  writeKnowledge(repo, "0001-cache-invalidation.md", {
    id: "KNOW-0001", title: "Cache invalidation rules", status: "confirmed",
  });
  const before = snapshotTree(repo);

  const result = runScript("consolidate_knowledge.js", [
    "apply", "--decision", "create",
    "--title", "Cache invalidation rules",
    "--kind", "codebase",
    "--from", "run:impl-0042",
    "--basis", "eviction-order investigation",
    "--cwd", repo,
  ], { cwd: repo });
  assert.equal(result.status, 1, "unacknowledged conflicts must refuse create");
  assert.match(result.stderr, /require explicit review before create/);
  assert.match(result.stderr, /KNOW-0001/);
  assert.equal(snapshotTree(repo), before, "a refused create must not write");
});

test("apply --decision create mints with acknowledged conflicts and recorded provenance", () => {
  const repo = tempRepo();
  writeKnowledge(repo, "0001-cache-invalidation.md", {
    id: "KNOW-0001", title: "Cache invalidation rules", status: "confirmed",
  });

  const result = runScript("consolidate_knowledge.js", [
    "apply", "--decision", "create",
    "--title", "Cache invalidation rules v2",
    "--kind", "codebase",
    "--keyword", "cache",
    "--keyword", "invalidation",
    "--from", "run:impl-0042",
    "--basis", "eviction-order investigation",
    "--acknowledge", "KNOW-0001",
    "--date", "2026-09-20",
    "--cwd", repo,
  ], { cwd: repo });
  assert.equal(result.status, 0, result.stderr);

  const createdFile = fs.readdirSync(path.join(repo, "docs/knowledge"))
    .filter((f) => f !== "0001-cache-invalidation.md" && f.endsWith(".md"));
  assert.equal(createdFile.length, 1, "exactly one new knowledge doc minted");
  const created = matter(fs.readFileSync(path.join(repo, "docs/knowledge", createdFile[0]), "utf8"));
  assert.equal(created.data.type, "knowledge");
  assert.equal(created.data.knowledge_kind, "codebase");
  assert.deepEqual(created.data.relations.source, ["run:impl-0042"]);
  // Extraction source AND evidence basis are recorded: `relations.source`
  // carries the provenance, the body carries the dated basis entry.
  assert.match(created.content, /- 2026-09-20 — eviction-order investigation \(source: run:impl-0042\)/);
});

test("apply --decision create requires provenance and basis", () => {
  const repo = tempRepo();
  for (const args of [
    ["apply", "--decision", "create", "--title", "X", "--kind", "codebase", "--basis", "b"],
    ["apply", "--decision", "create", "--title", "X", "--kind", "codebase", "--from", "s"],
    ["apply", "--decision", "create", "--title", "X", "--from", "s", "--basis", "b"],
  ] as const) {
    const result = runScript("consolidate_knowledge.js", [...args, "--cwd", repo], { cwd: repo });
    assert.equal(result.status, 1, `create must refuse: ${args.join(" ")}`);
  }
  assert.equal(fs.existsSync(path.join(repo, "docs/knowledge")), false, "refused creates mint nothing");
});

// --- --supersedes: relation validation --------------------------------------

test("--supersedes records the edge and validates knowledge targets only", () => {
  const repo = tempRepo();
  const old = writeKnowledge(repo, "0001-old.md", { id: "KNOW-0001", title: "Old rules", status: "confirmed" });
  const spec = writeDoc(repo, "docs/specs/0001-s.md", fm({ id: "SPEC-0001", type: "spec", title: "Spec" }));

  // new_knowledge --supersedes at a knowledge doc: the forward edge lands.
  const ok = runScript("new_knowledge.js", [
    "--title", "New rules", "--kind", "codebase",
    "--supersedes", old, "--date", "2026-09-20", "--cwd", repo,
  ], { cwd: repo });
  assert.equal(ok.status, 0, ok.stderr);
  const createdFile = fs.readdirSync(path.join(repo, "docs/knowledge"))
    .filter((f) => f !== "0001-old.md" && f.endsWith(".md"));
  assert.equal(createdFile.length, 1);
  const created = matter(fs.readFileSync(path.join(repo, "docs/knowledge", createdFile[0]), "utf8"));
  assert.deepEqual(created.data.relations.supersedes, [old]);

  // consolidate create --supersedes at a non-knowledge document refuses —
  // the edge would be unresolvable across the type boundary.
  const bad = runScript("consolidate_knowledge.js", [
    "apply", "--decision", "create",
    "--title", "Unrelated finding", "--kind", "operation",
    "--from", "s", "--basis", "b",
    "--supersedes", spec, "--cwd", repo,
  ], { cwd: repo });
  assert.equal(bad.status, 1, "supersedes must refuse a non-knowledge target");
  assert.match(bad.stderr, /not a knowledge document|does not resolve/);
});

// --- new_knowledge: confirmed requires provenance ----------------------------

test("new_knowledge refuses --status confirmed without --from provenance", () => {
  const repo = tempRepo();
  const before = snapshotTree(repo);

  const refused = runScript("new_knowledge.js", [
    "--title", "Unverified guess", "--kind", "lesson", "--status", "confirmed", "--cwd", repo,
  ], { cwd: repo });
  assert.equal(refused.status, 1, "confirmed without --from must refuse");
  assert.match(refused.stderr, /--status confirmed requires at least one --from/);
  assert.equal(snapshotTree(repo), before, "the refused mint writes nothing");

  const ok = runScript("new_knowledge.js", [
    "--title", "Verified fact", "--kind", "lesson", "--status", "confirmed",
    "--from", "run:impl-0042", "--date", "2026-09-20", "--cwd", repo,
  ], { cwd: repo });
  assert.equal(ok.status, 0, ok.stderr);
  const file = fs.readdirSync(path.join(repo, "docs/knowledge")).find((f) => f.endsWith(".md"));
  const doc = matter(fs.readFileSync(path.join(repo, "docs/knowledge", file!), "utf8"));
  assert.equal(doc.data.status, "confirmed");
  assert.deepEqual(doc.data.relations.source, ["run:impl-0042"]);
});

// --- template rendering regression ------------------------------------------

test("minted knowledge documents render the title, not the placeholder", () => {
  const repo = tempRepo();
  const result = runScript("new_knowledge.js", [
    "--title", "How the build cache works", "--kind", "codebase", "--date", "2026-09-20", "--cwd", repo,
  ], { cwd: repo });
  assert.equal(result.status, 0, result.stderr);
  const file = fs.readdirSync(path.join(repo, "docs/knowledge")).find((f) => f.endsWith(".md"));
  assert.ok(file, "a knowledge doc was minted");
  const content = fs.readFileSync(path.join(repo, "docs/knowledge", file!), "utf8");
  assert.match(content, /^# How the build cache works/m);
  assert.doesNotMatch(content, /\{\{title\}\}|\{\{TITLE\}\}/);
});
