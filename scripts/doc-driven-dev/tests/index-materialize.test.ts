import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyIndexMaterialization,
  planIndexMaterialization,
} from "../src/skills/doc-maintenance/scripts/lib/index_materialize";
import type {
  IndexMaterializePlan,
  IndexMaterializeTarget,
} from "../src/skills/doc-maintenance/scripts/lib/index_materialize";

/**
 * Issue #197 — index-only materialization op for doc-maintenance.
 *
 * Covers the normalized per-target plan (`verdict`, `changes`, `pins`,
 * `planHash`, merged `content`) for shared-4col dirs and the ADR dir, plus
 * `applyIndexMaterialization` for those kinds: `--expect` global-hash gating,
 * pin revalidation, atomic shared writes, and the ADR owner-writer path.
 */

const MARKER = "<!-- doc-suite:generated-index -->";
const HEADER4 = "| ID | Title | Status | File |\n| --- | --- | --- | --- |";

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "index-materialize-"));
}

function writeFile(root: string, relPath: string, content: string) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function writeDoc(
  root: string,
  relPath: string,
  doc: { id: string; type: string; status: string; title: string },
) {
  writeFile(root, relPath, [
    "---",
    `id: "${doc.id}"`,
    `type: "${doc.type}"`,
    `status: "${doc.status}"`,
    `title: "${doc.title}"`,
    'created: "2026-01-01"',
    'updated: "2026-01-01"',
    "owners: []",
    "relations: {}",
    "---",
    "",
    `# ${doc.title}`,
    "",
  ].join("\n"));
}

function specDoc(name: string, title: string, status = "draft", id = "SPEC-0001") {
  return { file: `docs/specs/${name}.md`, id, type: "spec", status, title };
}

function indexBody(rows: string[]): string {
  return [HEADER4, ...rows].join("\n");
}

function row(id: string, title: string, status: string, file: string): string {
  return `| ${id} | ${title} | ${status} | [${file}](./${file}) |`;
}

function writeSharedIndex(
  root: string,
  dir: string,
  title: string,
  rows: string[],
  options: { preamble?: string; tail?: string; settledRows?: string[] } = {},
) {
  const preamble = options.preamble ?? `# ${title}\n\n`;
  const settled = (options.settledRows ?? []).length > 0
    ? `\n\n## Settled <!-- doc-suite:settled-index -->\n\n${indexBody(options.settledRows ?? [])}`
    : "";
  const doc = `${preamble}${MARKER}\n\nDirectory: \`${dir}\`\n\n${indexBody(rows)}${settled}\n${options.tail ?? ""}`;
  writeFile(root, `${dir}/README.md`, doc);
}

function shaFile(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function treeHashes(repo: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out[path.relative(repo, full).replace(/\\/g, "/")] = shaFile(full);
    }
  };
  walk(repo);
  return out;
}

function targetFor(plan: IndexMaterializePlan, dir: string): IndexMaterializeTarget {
  const target = plan.targets.find((item) => item.directory === dir);
  assert.ok(target, `expected a target for ${dir}`);
  return target;
}

// --- plan: shared-4col -------------------------------------------------------

test("plan reports in-sync for a clean generated shared index", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/checkout.md", specDoc("checkout", "Spec checkout"));
  writeSharedIndex(repo, "docs/specs", "SPEC Documents", [
    row("SPEC-0001", "Spec checkout", "draft", "checkout.md"),
  ]);

  const before = treeHashes(repo);
  const plan = await planIndexMaterialization(repo);
  assert.deepEqual(treeHashes(repo), before, "planning must be read-only");

  const target = targetFor(plan, "docs/specs");
  assert.equal(target.kind, "shared");
  assert.equal(target.owner, "doc-suite");
  assert.equal(target.verdict, "in-sync");
  assert.deepEqual(target.changes, []);
  assert.deepEqual(target.plannedFiles, []);
  assert.equal("content" in target, false, "in-sync targets carry no write payload");
  assert.equal(target.indexPath, "docs/specs/README.md");
  assert.equal(target.sourceCount, 1);
  assert.match(target.planHash, /^[0-9a-f]{64}$/);
  assert.ok(target.pins.index);
  assert.match(plan.planHash, /^[0-9a-f]{64}$/);
});

test("plan reports sync with a change summary for stale rows", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/checkout.md", specDoc("checkout", "Spec checkout"));
  writeDoc(repo, "docs/specs/other.md", specDoc("other", "Spec other", "draft", "SPEC-0002"));
  writeSharedIndex(repo, "docs/specs", "SPEC Documents", [
    row("SPEC-0001", "Wrong Title", "proposed", "checkout.md"),
    row("SPEC-GONE", "Ghost", "draft", "ghost.md"),
  ]);

  const plan = await planIndexMaterialization(repo);
  const target = targetFor(plan, "docs/specs");
  assert.equal(target.verdict, "sync");
  assert.deepEqual(target.plannedFiles, ["docs/specs/README.md"]);
  const kinds = new Map(target.changes.map((change) => [change.file, change.kind]));
  assert.equal(kinds.get("checkout.md"), "update-status");
  assert.equal(kinds.get("other.md"), "add");
  assert.equal(kinds.get("ghost.md"), "remove");
  assert.ok(typeof target.content === "string" && target.content.includes("other.md"));
  assert.ok(!target.content!.includes("ghost.md"));
});

test("plan reports move-tier for a settled row in the active tier", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/a.md", specDoc("a", "Alpha", "draft", "SPEC-0001"));
  writeDoc(repo, "docs/specs/b.md", specDoc("b", "Beta", "implemented", "SPEC-0002"));
  writeSharedIndex(repo, "docs/specs", "SPEC Documents", [
    row("SPEC-0001", "Alpha", "draft", "a.md"),
    row("SPEC-0002", "Beta", "implemented", "b.md"),
  ]);

  const plan = await planIndexMaterialization(repo);
  const target = targetFor(plan, "docs/specs");
  assert.equal(target.verdict, "sync");
  const move = target.changes.find((change) => change.file === "b.md");
  assert.equal(move?.kind, "move-tier");
  assert.equal(move?.before, "active");
  assert.equal(move?.after, "settled");
  assert.ok(!target.changes.some((change) => change.file === "a.md"), "a.md must be untouched");
});

test("plan reports reorder for stable rows in drifted order", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/a.md", specDoc("a", "Alpha", "draft", "SPEC-0001"));
  writeDoc(repo, "docs/specs/c.md", specDoc("c", "Gamma", "draft", "SPEC-0003"));
  // Both rows are stable (cells+tier already correct) but listed out of the
  // deterministic file order — a pure reorder, no membership change.
  writeSharedIndex(repo, "docs/specs", "SPEC Documents", [
    row("SPEC-0003", "Gamma", "draft", "c.md"),
    row("SPEC-0001", "Alpha", "draft", "a.md"),
  ]);

  const plan = await planIndexMaterialization(repo);
  const target = targetFor(plan, "docs/specs");
  assert.equal(target.verdict, "sync");
  assert.ok(target.changes.length > 0);
  assert.ok(target.changes.every((change) => change.kind === "reorder"));
});

test("plan reports create when the index is missing", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/checkout.md", specDoc("checkout", "Spec checkout"));

  const plan = await planIndexMaterialization(repo);
  const target = targetFor(plan, "docs/specs");
  assert.equal(target.verdict, "create");
  assert.equal(target.pins.index, null);
  assert.deepEqual(target.plannedFiles, ["docs/specs/README.md"]);
  assert.ok(target.changes.every((change) => change.kind === "add"));
  assert.ok(target.content?.startsWith("# SPEC Documents\n"));
  assert.ok(target.content?.includes(MARKER));
  assert.ok(target.content?.includes(row("SPEC-0001", "Spec checkout", "draft", "checkout.md")));
});

test("plan rejects a hand-curated index", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/checkout.md", specDoc("checkout", "Spec checkout"));
  writeFile(repo, "docs/specs/README.md", "# SPEC Documents\n\nCurated by hand.\n");

  const plan = await planIndexMaterialization(repo);
  const target = targetFor(plan, "docs/specs");
  assert.equal(target.verdict, "rejected");
  assert.equal(target.reason, "hand-curated-index");
  assert.deepEqual(target.changes, []);
  assert.deepEqual(target.plannedFiles, []);
  assert.equal("content" in target, false);
  assert.ok(target.pins.index, "rejected targets still pin the observed index");
});

test("plan rejects a symlinked or non-regular index", async (t) => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/checkout.md", specDoc("checkout", "Spec checkout"));
  const outside = tempRepo();
  const outsideFile = path.join(outside, "index.md");
  fs.writeFileSync(outsideFile, "# outside\n", "utf8");
  fs.mkdirSync(path.join(repo, "docs/specs"), { recursive: true });
  try {
    fs.symlinkSync(outsideFile, path.join(repo, "docs/specs", "README.md"));
  } catch {
    t.skip("file symlinks are not permitted on this platform");
    return;
  }

  const plan = await planIndexMaterialization(repo);
  const target = targetFor(plan, "docs/specs");
  assert.equal(target.verdict, "rejected");
  assert.equal(target.reason, "index-not-regular-file");
  assert.equal(fs.readFileSync(outsideFile, "utf8"), "# outside\n", "symlink target untouched");

  // A directory (or any non-regular entry) at the index path rejects the same way.
  const repo2 = tempRepo();
  writeDoc(repo2, "docs/specs/checkout.md", specDoc("checkout", "Spec checkout"));
  fs.mkdirSync(path.join(repo2, "docs/specs/README.md"), { recursive: true });
  const plan2 = await planIndexMaterialization(repo2);
  const target2 = targetFor(plan2, "docs/specs");
  assert.equal(target2.verdict, "rejected");
  assert.equal(target2.reason, "index-not-regular-file");
});

// --- plan: ADR ---------------------------------------------------------------

test("plan reports the ADR dir via the adr kind and adr-doc owner", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/adr/0001-use-pgsql.md", {
    id: "ADR-0001",
    type: "adr",
    status: "proposed",
    title: "Use PostgreSQL",
  });
  writeSharedIndex(repo, "docs/adr", "Architecture Decision Records", []);

  const plan = await planIndexMaterialization(repo);
  const target = targetFor(plan, "docs/adr");
  assert.equal(target.kind, "adr");
  assert.equal(target.owner, "adr-doc");
  assert.equal(target.verdict, "sync");
  assert.equal(target.changes.find((change) => change.file === "0001-use-pgsql.md")?.kind, "add");
  assert.ok(target.content?.includes("0001-use-pgsql.md"));
});

// --- enumeration / scoping ---------------------------------------------------

test("plan enumerates managed dirs without --dir and scopes with --dir", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/checkout.md", specDoc("checkout", "Spec checkout"));
  // impl-doc territory must never reach targets until Task 2 dispatch lands.
  writeFile(repo, "docs/impl/ir/alpha.md", "# impl\n");
  writeFile(repo, "docs/impl/exp/0001.jsonl", "{}\n");

  const plan = await planIndexMaterialization(repo);
  const directories = plan.targets.map((target) => target.directory).sort();
  assert.deepEqual(directories, [
    "docs/adr",
    "docs/designs",
    "docs/discovery",
    "docs/ideas",
    "docs/plans",
    "docs/specs",
    "docs/tasks",
    "docs/test-specs",
  ]);
  assert.ok(!plan.targets.some((target) => target.directory.startsWith("docs/impl")));
  const byDir = new Map(plan.targets.map((target) => [target.directory, target]));
  assert.equal(byDir.get("docs/adr")?.kind, "adr");
  assert.equal(byDir.get("docs/adr")?.owner, "adr-doc");
  assert.equal(byDir.get("docs/specs")?.kind, "shared");
  assert.equal(byDir.get("docs/specs")?.owner, "doc-suite");

  const scoped = await planIndexMaterialization(repo, { dir: "docs/specs" });
  assert.equal(scoped.targets.length, 1);
  assert.equal(scoped.targets[0].directory, "docs/specs");
  assert.equal(scoped.targets[0].kind, "shared");

  // impl dirs are managed index dirs but stay filtered until Task 2.
  const implScoped = await planIndexMaterialization(repo, { dir: "docs/impl/ir" });
  assert.equal(implScoped.targets.length, 0);

  // A --dir that lands on a file hosts no managed index.
  const fileScoped = await planIndexMaterialization(repo, { dir: "docs/specs/checkout.md" });
  assert.equal(fileScoped.targets.length, 0);
});

test("plan rejects a symlinked canonical dir escaping the checkout", async (t) => {
  const repo = tempRepo();
  const outside = tempRepo();
  writeFile(outside, "evil.md", "# outside content that must never be read\n");
  try {
    fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
    fs.symlinkSync(outside, path.join(repo, "docs/specs"), "dir");
  } catch {
    t.skip("directory symlinks are not permitted on this platform");
    return;
  }

  const plan = await planIndexMaterialization(repo);
  const target = targetFor(plan, "docs/specs");
  assert.equal(target.verdict, "rejected");
  assert.equal(target.reason, "directory-not-contained");
  assert.equal(target.sourceCount, 0, "escaping dirs are never scanned");
  assert.equal(target.pins.index, null, "outside index path is never touched");
  assert.equal("content" in target, false);

  // An explicit --dir at an escaping path still throws at the containment
  // boundary, exactly like the other doc ops.
  await assert.rejects(
    planIndexMaterialization(repo, { dir: "docs/specs" }),
    /escapes the checkout/,
  );

  // Apply must not write anything through the link either.
  const applied = await applyIndexMaterialization(repo);
  assert.ok(!applied.written.includes("docs/specs/README.md"));
  const blocked = applied.blocked.find((item) => item.target.directory === "docs/specs");
  assert.equal(blocked?.target.reason, "directory-not-contained");
  assert.equal(fs.readFileSync(path.join(outside, "evil.md"), "utf8"), "# outside content that must never be read\n");
  assert.deepEqual(fs.readdirSync(outside).sort(), ["evil.md"], "apply wrote nothing outside");
});

test("plan dedupes dir spellings that resolve to the same real dir", async (t) => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/checkout.md", specDoc("checkout", "Spec checkout"));
  writeSharedIndex(repo, "docs/specs", "SPEC Documents", [
    row("SPEC-0001", "Spec checkout", "draft", "checkout.md"),
  ]);
  try {
    fs.symlinkSync(path.join(repo, "docs/specs"), path.join(repo, "docs/ideas"), "dir");
  } catch {
    t.skip("directory symlinks are not permitted on this platform");
    return;
  }

  const plan = await planIndexMaterialization(repo);
  const specTargets = plan.targets.filter((target) => target.directory === "docs/specs");
  assert.equal(specTargets.length, 1, "one real dir = one target");
  assert.ok(
    !plan.targets.some((target) => target.directory === "docs/ideas"),
    "the linked alias collapses to the real dir — no second target",
  );
});

test("plan scopes an unclaimed --dir with resident docs as shared", async () => {
  const repo = tempRepo();
  writeDoc(repo, "custom/docs/thing.md", specDoc("thing", "Thing", "draft", "SPEC-0009"));

  const plan = await planIndexMaterialization(repo, { dir: "custom/docs" });
  assert.equal(plan.targets.length, 1);
  const target = plan.targets[0];
  assert.equal(target.kind, "shared");
  assert.equal(target.owner, null, "unclaimed dirs have no contract owner");
  assert.equal(target.verdict, "create");
  assert.equal(target.sourceCount, 1);
  assert.ok(target.content?.includes("thing.md"));
});

test("plan rejects an unclaimed --dir with no resident docs", async () => {
  const repo = tempRepo();

  // An unclaimed dir with NO residents is rejected — never a shared target
  // (sharedRepairAllowed parity: no managed-index contract, no residents).
  const missing = await planIndexMaterialization(repo, { dir: "custom/empty" });
  assert.equal(missing.targets.length, 1);
  assert.equal(missing.targets[0].verdict, "rejected");
  assert.equal(missing.targets[0].reason, "unclaimed-empty-directory");
  assert.equal(missing.targets[0].owner, null);

  // Same for an unclaimed dir that exists but holds only an index file.
  writeFile(repo, "custom/index-only/README.md", "# Curated\n");
  const indexOnly = await planIndexMaterialization(repo, { dir: "custom/index-only" });
  assert.equal(indexOnly.targets.length, 1);
  assert.equal(indexOnly.targets[0].verdict, "rejected");
  assert.equal(indexOnly.targets[0].reason, "unclaimed-empty-directory");
});

test("plan rejects an unscoped repo-root --dir, never a create", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/checkout.md", specDoc("checkout", "Spec checkout"));

  for (const dir of [".", ""]) {
    const plan = await planIndexMaterialization(repo, { dir });
    assert.equal(plan.targets.length, 1, `--dir "${dir}" must yield one rejected target`);
    assert.equal(plan.targets[0].verdict, "rejected");
    assert.equal(plan.targets[0].reason, "unscoped-root");
    assert.deepEqual(plan.targets[0].plannedFiles, []);
  }
});

// --- planHash ----------------------------------------------------------------

test("planHash is stable across runs and changes when sources change", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/checkout.md", specDoc("checkout", "Spec checkout"));
  writeSharedIndex(repo, "docs/specs", "SPEC Documents", [
    row("SPEC-0001", "Spec checkout", "draft", "checkout.md"),
  ]);

  const first = await planIndexMaterialization(repo);
  const second = await planIndexMaterialization(repo);
  assert.equal(first.planHash, second.planHash);
  assert.equal(targetFor(first, "docs/specs").planHash, targetFor(second, "docs/specs").planHash);

  // Source drift re-pins the touched target only.
  fs.appendFileSync(path.join(repo, "docs/specs/checkout.md"), "\nbody note\n", "utf8");
  const third = await planIndexMaterialization(repo);
  assert.notEqual(third.planHash, first.planHash);
  assert.notEqual(
    targetFor(third, "docs/specs").planHash,
    targetFor(first, "docs/specs").planHash,
  );
  assert.equal(
    targetFor(third, "docs/ideas").planHash,
    targetFor(first, "docs/ideas").planHash,
    "untouched targets keep their per-target planHash",
  );
});

// --- apply -------------------------------------------------------------------

test("apply writes a stale shared index atomically and preserves hand prose", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/checkout.md", specDoc("checkout", "Spec checkout"));
  writeDoc(repo, "docs/specs/other.md", specDoc("other", "Spec other", "draft", "SPEC-0002"));
  writeSharedIndex(repo, "docs/specs", "SPEC Documents", [
    row("SPEC-0001", "Spec checkout", "draft", "checkout.md"),
  ], { preamble: "# Team board\n\nCurated intro.\n\n", tail: "\nOperational notes.\n" });

  const indexAbs = path.join(repo, "docs/specs/README.md");
  const result = await applyIndexMaterialization(repo, { dir: "docs/specs" });
  assert.deepEqual(result.written, ["docs/specs/README.md"]);
  assert.deepEqual(result.blocked, []);

  const content = fs.readFileSync(indexAbs, "utf8");
  assert.ok(content.includes("# Team board\n\nCurated intro."), "preamble preserved");
  assert.ok(content.includes("Operational notes."), "tail preserved");
  assert.ok(content.includes(row("SPEC-0002", "Spec other", "draft", "other.md")));
  assert.ok(!fs.readdirSync(path.dirname(indexAbs)).some((name) => name.includes(".tmp-")), "no tmp files remain");

  const again = await applyIndexMaterialization(repo, { dir: "docs/specs" });
  assert.deepEqual(again.written, []);
  assert.equal(targetFor(again.plan, "docs/specs").verdict, "in-sync");
});

test("apply creates a missing index", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/checkout.md", specDoc("checkout", "Spec checkout"));

  const result = await applyIndexMaterialization(repo, { dir: "docs/specs" });
  assert.deepEqual(result.written, ["docs/specs/README.md"]);
  const content = fs.readFileSync(path.join(repo, "docs/specs/README.md"), "utf8");
  assert.ok(content.includes(MARKER));
  assert.ok(content.includes("checkout.md"));
});

test("apply --expect blocks on plan drift with zero writes", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/checkout.md", specDoc("checkout", "Spec checkout"));
  writeDoc(repo, "docs/specs/other.md", specDoc("other", "Spec other", "draft", "SPEC-0002"));
  writeSharedIndex(repo, "docs/specs", "SPEC Documents", [
    row("SPEC-0001", "Spec checkout", "draft", "checkout.md"),
  ]);

  // --expect pins the caller's preview to the apply: the hash is scoped, so
  // it must come from a plan computed over the same --dir.
  const plan = await planIndexMaterialization(repo, { dir: "docs/specs" });
  const before = treeHashes(repo);
  const result = await applyIndexMaterialization(repo, { dir: "docs/specs", expectPlanHash: "0".repeat(64) });
  assert.deepEqual(result.written, []);
  assert.equal(result.blocked.length, 1);
  assert.match(result.blocked[0].reason, /plan drift/);
  assert.deepEqual(treeHashes(repo), before, "a rejected --expect writes nothing");

  const applied = await applyIndexMaterialization(repo, { dir: "docs/specs", expectPlanHash: plan.planHash });
  assert.deepEqual(applied.written, ["docs/specs/README.md"]);
});

test("apply blocks rejected targets and leaves the index untouched", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/checkout.md", specDoc("checkout", "Spec checkout"));
  writeFile(repo, "docs/specs/README.md", "# Hand curated\n\nNo marker.\n");
  const before = shaFile(path.join(repo, "docs/specs/README.md"));

  const result = await applyIndexMaterialization(repo, { dir: "docs/specs" });
  assert.deepEqual(result.written, []);
  assert.equal(result.blocked.length, 1);
  assert.equal(result.blocked[0].target.verdict, "rejected");
  assert.equal(shaFile(path.join(repo, "docs/specs/README.md")), before);
});

test("apply syncs the ADR index through the owner writer", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/adr/0001-use-pgsql.md", {
    id: "ADR-0001",
    type: "adr",
    status: "proposed",
    title: "Use PostgreSQL",
  });
  writeSharedIndex(repo, "docs/adr", "Architecture Decision Records", [], {
    preamble: "# Architecture Decision Records\n\nTeam preamble.\n\n",
  });

  const result = await applyIndexMaterialization(repo, { dir: "docs/adr" });
  assert.deepEqual(result.written, ["docs/adr/README.md"]);
  const content = fs.readFileSync(path.join(repo, "docs/adr/README.md"), "utf8");
  assert.ok(content.includes("Team preamble."), "ADR preamble preserved");
  assert.ok(content.includes(row("ADR-0001", "Use PostgreSQL", "proposed", "0001-use-pgsql.md")));

  const again = await planIndexMaterialization(repo, { dir: "docs/adr" });
  assert.equal(targetFor(again, "docs/adr").verdict, "in-sync");
});
