import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyImplIndexSync,
  parseImplIndexRows,
  planImplIndexSync,
} from "../src/skills/impl-doc/scripts/lib/impl_index_sync";
import {
  auditExperimentLogs,
  auditImplementationRecords,
} from "../src/skills/impl-doc/scripts/lib/impl_doc_utils";

/**
 * Issue #186/#187 — impl-doc owner index-sync engine.
 *
 * Unit-level coverage for `impl_index_sync.ts`: strict fail-closed managed
 * README classification, pinned plan construction (before/after rows, tier
 * moves, SHA-256 pins, planHash), drift-rejecting atomic apply, and the
 * exported row parser Task 3 audits will reuse.
 */

const MARKER = "<!-- doc-suite:generated-index -->";
const SETTLED_MARKER = "<!-- doc-suite:settled-index -->";
const IR_HEADER = "| ID | Title | Status | File |\n| --- | --- | --- | --- |";
const EXP_HEADER = "| File |\n| --- |";

type IrSpec = { file: string; id: string; title: string; status: string };
type ExpFile = string;

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "impl-index-sync-"));
}

function shaFile(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function treeHashes(repo: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out[path.relative(repo, full).replace(/\\/g, "/")] = shaFile(full);
    }
  };
  walk(repo);
  return out;
}

// --- IR fixtures -----------------------------------------------------------

function writeIr(repo: string, spec: IrSpec, dir = "docs/impl/ir") {
  const full = path.join(repo, dir, spec.file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, [
    "---",
    `id: "${spec.id}"`,
    'type: "impl"',
    `status: "${spec.status}"`,
    `title: "${spec.title}"`,
    'created: "2026-01-01"',
    'updated: "2026-01-01"',
    "owners: []",
    "metadata:",
    "  experiments:",
    "    adopted: []",
    "    rejected: []",
    "---",
    "",
    `# ${spec.title}`,
    "",
  ].join("\n"), "utf8");
}

function rewriteIr(repo: string, spec: IrSpec, dir = "docs/impl/ir") {
  writeIr(repo, spec, dir);
}

function irRow(spec: IrSpec): string {
  return `| ${spec.id} | ${spec.title} | ${spec.status} | [${spec.file}](./${spec.file}) |`;
}

function irBody(active: IrSpec[], settled: IrSpec[]): string {
  const head = [IR_HEADER, ...active.map(irRow)].join("\n");
  if (settled.length === 0) return head;
  return `${head}\n\n## Settled ${SETTLED_MARKER}\n\n${[IR_HEADER, ...settled.map(irRow)].join("\n")}`;
}

function writeIrIndex(
  repo: string,
  options: {
    active?: IrSpec[];
    settled?: IrSpec[];
    preamble?: string;
    tail?: string;
    dir?: string;
  } = {},
) {
  const dir = options.dir ?? "docs/impl/ir";
  const preamble = options.preamble ?? "# Implementation Records\n\n";
  const tail = options.tail ?? "";
  const doc = `${preamble}${MARKER}\n\nDirectory: \`${dir}\`\n\n${irBody(options.active ?? [], options.settled ?? [])}\n${tail}`;
  const full = path.join(repo, dir, "README.md");
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, doc, "utf8");
}

function writeRawIndex(repo: string, content: string, dir = "docs/impl/ir") {
  const full = path.join(repo, dir, "README.md");
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

// --- EXP fixtures ----------------------------------------------------------

function writeExp(repo: string, file: string, dir = "docs/impl/exp") {
  const full = path.join(repo, dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${JSON.stringify({ schema: "experiment_event.v1", experiment: `${dir}/${file}`, seq: 1, type: "start", ts: "2026-01-01T00:00:00Z" })}\n`, "utf8");
}

function expRow(file: string): string {
  return `| [${file}](./${file}) |`;
}

function expBody(files: ExpFile[]): string {
  return files.length > 0 ? `${EXP_HEADER}\n${files.map(expRow).join("\n")}` : EXP_HEADER;
}

function writeExpIndex(
  repo: string,
  options: { files?: ExpFile[]; preamble?: string; tail?: string; dir?: string } = {},
) {
  const dir = options.dir ?? "docs/impl/exp";
  const preamble = options.preamble ?? "# Experiment Logs\n\n";
  const tail = options.tail ?? "";
  const doc = `${preamble}${MARKER}\n\nDirectory: \`${dir}\`\n\n${expBody(options.files ?? [])}\n${tail}`;
  const full = path.join(repo, dir, "README.md");
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, doc, "utf8");
}

// --- IR tests ----------------------------------------------------------------

test("IR: in-sync managed index is a no-op for plan and apply", () => {
  const repo = tempRepo();
  const specs: IrSpec[] = [
    { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" },
    { file: "b.md", id: "IMPL-B", title: "Beta", status: "completed" },
  ];
  for (const spec of specs) writeIr(repo, spec);
  writeIrIndex(repo, { active: [specs[0]], settled: [specs[1]] });

  const plan = planImplIndexSync(repo, "ir");
  assert.equal(plan.verdict, "in-sync");
  assert.deepEqual(plan.changes, []);
  assert.deepEqual(plan.plannedFiles, []);
  assert.equal(plan.directory, "docs/impl/ir");
  assert.equal(plan.indexPath, "docs/impl/ir/README.md");
  assert.match(plan.planHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(plan.pins.fileList, ["a.md", "b.md"]);
  assert.ok(plan.pins.sources["a.md"]);
  assert.ok(plan.pins.index);

  const applied = applyImplIndexSync(repo, "ir");
  assert.equal(applied.written, false);
  assert.equal(applied.plan.verdict, "in-sync");
});

test("IR: status flip draft→completed moves the row to the Settled tier", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  const b: IrSpec = { file: "b.md", id: "IMPL-B", title: "Beta", status: "draft" };
  const c: IrSpec = { file: "c.md", id: "IMPL-C", title: "Gamma", status: "completed" };
  for (const spec of [a, b, c]) writeIr(repo, spec);
  writeIrIndex(repo, { active: [a, b], settled: [c], tail: "\nTrailing hand-written note.\n" });

  rewriteIr(repo, { ...b, status: "completed" });

  const plan = planImplIndexSync(repo, "ir");
  assert.equal(plan.verdict, "sync");
  const move = plan.changes.find((change) => change.file === "b.md");
  assert.equal(move?.kind, "move-tier");
  assert.equal(move?.before, "active");
  assert.equal(move?.after, "settled");
  assert.ok(!plan.changes.some((change) => change.file === "a.md"), "a.md must be untouched");
  assert.ok(!plan.changes.some((change) => change.file === "c.md"), "c.md must be untouched");
  assert.deepEqual(plan.plannedFiles, ["docs/impl/ir/README.md"]);

  const applied = applyImplIndexSync(repo, "ir");
  assert.equal(applied.written, true);
  const content = fs.readFileSync(path.join(repo, "docs/impl/ir/README.md"), "utf8");
  const settledAt = content.indexOf("## Settled");
  assert.ok(settledAt > 0, "settled tier expected");
  assert.ok(content.indexOf("[a.md](./a.md)") > -1 && content.indexOf("[a.md](./a.md)") < settledAt, "a stays active");
  assert.ok(content.indexOf("[b.md](./b.md)") > settledAt, "b moved to settled");
  assert.ok(content.indexOf("[c.md](./c.md)") > settledAt, "c stays settled");
  assert.match(content, /Trailing hand-written note\./, "tail preserved");

  assert.equal(planImplIndexSync(repo, "ir").verdict, "in-sync", "re-plan after apply is clean");
});

test("IR: completed→in-progress moves the row back to the active tier", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "in-progress" };
  const b: IrSpec = { file: "b.md", id: "IMPL-B", title: "Beta", status: "completed" };
  for (const spec of [a, b]) writeIr(repo, spec);
  writeIrIndex(repo, { active: [a], settled: [b] });

  rewriteIr(repo, { ...b, status: "in-progress" });

  const plan = planImplIndexSync(repo, "ir");
  assert.equal(plan.verdict, "sync");
  const move = plan.changes.find((change) => change.file === "b.md");
  assert.equal(move?.kind, "move-tier");
  assert.equal(move?.before, "settled");
  assert.equal(move?.after, "active");

  const applied = applyImplIndexSync(repo, "ir");
  assert.equal(applied.written, true);
  const content = fs.readFileSync(path.join(repo, "docs/impl/ir/README.md"), "utf8");
  assert.equal(content.includes("## Settled"), false, "empty settled tier is removed");
  assert.deepEqual(
    content.split("\n").filter((line) => line.includes("](")),
    [irRow(a), irRow({ ...b, status: "in-progress" })],
  );
});

test("IR: settled set is completed/abandoned/superseded; blocked stays active", () => {
  const repo = tempRepo();
  const specs: IrSpec[] = [
    { file: "done.md", id: "IMPL-DONE", title: "Done", status: "completed" },
    { file: "dead.md", id: "IMPL-DEAD", title: "Dead", status: "abandoned" },
    { file: "old.md", id: "IMPL-OLD", title: "Old", status: "superseded" },
    { file: "blocked.md", id: "IMPL-BLOCKED", title: "Blocked", status: "blocked" },
    { file: "live.md", id: "IMPL-LIVE", title: "Live", status: "in-progress" },
    { file: "wip.md", id: "IMPL-WIP", title: "Wip", status: "draft" },
  ];
  for (const spec of specs) writeIr(repo, spec);

  // Fresh managed index via create verdict — the generated tiers must match
  // isSettledStatus("impl", …) exactly.
  const created = applyImplIndexSync(repo, "ir");
  assert.equal(created.plan.verdict, "create");
  assert.equal(created.written, true);

  const content = fs.readFileSync(path.join(repo, "docs/impl/ir/README.md"), "utf8");
  const settledAt = content.indexOf("## Settled");
  assert.ok(settledAt > 0);
  const activeRegion = content.slice(0, settledAt);
  const settledRegion = content.slice(settledAt);
  for (const name of ["blocked.md", "live.md", "wip.md"]) {
    assert.ok(activeRegion.includes(`[${name}](./${name})`), `${name} must stay active`);
    assert.ok(!settledRegion.includes(`[${name}](./${name})`), `${name} must not settle`);
  }
  for (const name of ["done.md", "dead.md", "old.md"]) {
    assert.ok(settledRegion.includes(`[${name}](./${name})`), `${name} must settle`);
    assert.ok(!activeRegion.includes(`[${name}](./${name})`), `${name} must leave active`);
  }
});

test("IR: multi-target drift syncs, then re-apply is an in-sync no-op", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  const b: IrSpec = { file: "b.md", id: "IMPL-B", title: "Beta", status: "draft" };
  const c: IrSpec = { file: "c.md", id: "IMPL-C", title: "Gamma", status: "completed" };
  const d: IrSpec = { file: "d.md", id: "IMPL-D", title: "Delta", status: "draft" };
  for (const spec of [a, b, c, d]) writeIr(repo, spec);
  writeIrIndex(repo, { active: [a, b, d], settled: [c] });

  // Flip a→completed and b→abandoned; delete d; add e.
  rewriteIr(repo, { ...a, status: "completed" });
  rewriteIr(repo, { ...b, status: "abandoned" });
  fs.rmSync(path.join(repo, "docs/impl/ir/d.md"));
  const e: IrSpec = { file: "e.md", id: "IMPL-E", title: "Epsilon", status: "draft" };
  writeIr(repo, e);

  const plan = planImplIndexSync(repo, "ir");
  assert.equal(plan.verdict, "sync");
  const kinds = new Map(plan.changes.map((change) => [change.file, change.kind]));
  assert.equal(kinds.get("a.md"), "move-tier");
  assert.equal(kinds.get("b.md"), "move-tier");
  assert.equal(kinds.get("d.md"), "remove");
  assert.equal(kinds.get("e.md"), "add");
  assert.equal(kinds.has("c.md"), false, "c.md untouched");

  const applied = applyImplIndexSync(repo, "ir");
  assert.equal(applied.written, true);

  const again = applyImplIndexSync(repo, "ir");
  assert.equal(again.plan.verdict, "in-sync");
  assert.equal(again.written, false, "second apply is a no-op");
});

test("IR: missing README → verdict create; apply writes the managed index", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  writeIr(repo, a);

  const plan = planImplIndexSync(repo, "ir");
  assert.equal(plan.verdict, "create");
  assert.equal(plan.pins.index, null);
  assert.deepEqual(plan.plannedFiles, ["docs/impl/ir/README.md"]);
  assert.ok(plan.changes.every((change) => change.kind === "add"));

  const applied = applyImplIndexSync(repo, "ir");
  assert.equal(applied.written, true);
  const content = fs.readFileSync(path.join(repo, "docs/impl/ir/README.md"), "utf8");
  assert.ok(content.startsWith(`# Implementation Records\n\n${MARKER}\n\nDirectory: \`docs/impl/ir\`\n\n`));
  assert.ok(content.includes(irRow(a)));
});

test("IR: empty dir produces a header-only managed index", () => {
  const repo = tempRepo();
  const plan = planImplIndexSync(repo, "ir");
  assert.equal(plan.verdict, "create");
  assert.deepEqual(plan.pins.fileList, []);

  const applied = applyImplIndexSync(repo, "ir");
  assert.equal(applied.written, true);
  const content = fs.readFileSync(path.join(repo, "docs/impl/ir/README.md"), "utf8");
  assert.equal(
    content,
    `# Implementation Records\n\n${MARKER}\n\nDirectory: \`docs/impl/ir\`\n\n${IR_HEADER}\n`,
  );
});

test("IR: hand-written preamble and tail survive regeneration byte-for-byte", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  const b: IrSpec = { file: "b.md", id: "IMPL-B", title: "Beta", status: "draft" };
  for (const spec of [a, b]) writeIr(repo, spec);
  writeIrIndex(repo, {
    active: [a],
    preamble: "# Team implementation board\n\nCurated intro prose.\n\n",
    tail: "\n## Notes\n\nHand-kept commentary with | pipes in prose is fine here.\n",
  });
  // b.md exists but has no row yet → add drift.
  const plan = planImplIndexSync(repo, "ir");
  assert.equal(plan.verdict, "sync");
  assert.equal(plan.changes.find((change) => change.file === "b.md")?.kind, "add");

  const applied = applyImplIndexSync(repo, "ir");
  assert.equal(applied.written, true);
  const content = fs.readFileSync(path.join(repo, "docs/impl/ir/README.md"), "utf8");
  assert.ok(content.includes("# Team implementation board\n\nCurated intro prose."), "preamble preserved");
  assert.ok(content.includes("## Notes\n\nHand-kept commentary"), "tail preserved");
  assert.ok(content.indexOf("Curated intro prose.") < content.indexOf(MARKER), "preamble stays before marker");
  assert.ok(content.indexOf("Hand-kept commentary") > content.indexOf("doc-suite:settled-index") || content.indexOf("Hand-kept commentary") > content.indexOf(MARKER), "tail stays after region");
});

test("IR: rejects a hand-curated README without the generated marker", () => {
  const repo = tempRepo();
  writeIr(repo, { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" });
  writeRawIndex(repo, "# Implementation Records\n\nDirectory: `docs/impl/ir`\n\n| ID | Title | Status | File |\n| --- | --- | --- | --- |\n| IMPL-A | Alpha | draft | [a.md](./a.md) |\n");

  const plan = planImplIndexSync(repo, "ir");
  assert.equal(plan.verdict, "rejected");
  assert.match(plan.reason ?? "", /marker|hand-curated|ambiguous/i);
  assert.equal(applyImplIndexSync(repo, "ir").written, false);
});

test("IR: rejects an ambiguous README with the marker twice", () => {
  const repo = tempRepo();
  writeIr(repo, { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" });
  writeIrIndex(repo, { active: [{ file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" }] });
  const indexPath = path.join(repo, "docs/impl/ir/README.md");
  fs.writeFileSync(indexPath, `${fs.readFileSync(indexPath, "utf8")}\n${MARKER}\n`, "utf8");

  const plan = planImplIndexSync(repo, "ir");
  assert.equal(plan.verdict, "rejected");
  assert.match(plan.reason ?? "", /marker|ambiguous/i);
});

test("IR: rejects broken table structures", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  writeIr(repo, a);

  const cases: string[] = [
    // wrong cell count (3 cells, missing file link)
    `# Implementation Records\n\n${MARKER}\n\nDirectory: \`docs/impl/ir\`\n\n${IR_HEADER}\n| IMPL-A | Alpha | draft |\n`,
    // five cells
    `# Implementation Records\n\n${MARKER}\n\nDirectory: \`docs/impl/ir\`\n\n${IR_HEADER}\n| IMPL-A | Alpha | draft | [a.md](./a.md) | extra |\n`,
    // missing table entirely
    `# Implementation Records\n\n${MARKER}\n\nDirectory: \`docs/impl/ir\`\n\nNo table here.\n`,
    // wrong header shape
    `# Implementation Records\n\n${MARKER}\n\nDirectory: \`docs/impl/ir\`\n\n| ID | Title | File |\n| --- | --- | --- |\n| IMPL-A | Alpha | [a.md](./a.md) |\n`,
  ];
  for (const content of cases) {
    writeRawIndex(repo, content);
    const plan = planImplIndexSync(repo, "ir");
    assert.equal(plan.verdict, "rejected", `expected rejection for: ${content.slice(0, 80)}`);
  }
});

test("IR: rejects duplicate file rows", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  writeIr(repo, a);
  writeIrIndex(repo, { active: [a, a] });

  const plan = planImplIndexSync(repo, "ir");
  assert.equal(plan.verdict, "rejected");
  assert.match(plan.reason ?? "", /duplicate/i);
});

test("IR: rejects row links that escape the directory or are absolute", () => {
  const repo = tempRepo();
  writeIr(repo, { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" });

  const cases = [
    `| IMPL-A | Alpha | draft | [a.md](../outside.md) |`,
    `| IMPL-A | Alpha | draft | [a.md](./../outside.md) |`,
    `| IMPL-A | Alpha | draft | [a.md](/abs/a.md) |`,
    `| IMPL-A | Alpha | draft | [a.md](a.md) |`,
  ];
  for (const row of cases) {
    writeRawIndex(repo, `# Implementation Records\n\n${MARKER}\n\nDirectory: \`docs/impl/ir\`\n\n${IR_HEADER}\n${row}\n`);
    const plan = planImplIndexSync(repo, "ir");
    assert.equal(plan.verdict, "rejected", `expected rejection for row: ${row}`);
  }
});

test("IR: rejects a non-target order conflict between stable rows", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  const b: IrSpec = { file: "b.md", id: "IMPL-B", title: "Beta", status: "draft" };
  for (const spec of [a, b]) writeIr(repo, spec);
  // Both rows are stable (cells+tier already match) but listed out of
  // deterministic order — regeneration would reorder rows the sync must not
  // touch, so the plan fails closed.
  writeIrIndex(repo, { active: [b, a] });

  const plan = planImplIndexSync(repo, "ir");
  assert.equal(plan.verdict, "rejected");
  assert.match(plan.reason ?? "", /order/i);
  assert.equal(applyImplIndexSync(repo, "ir").written, false);
});

test("IR: rejects when a source file fails front-matter validation", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  writeIr(repo, a);
  writeIrIndex(repo, { active: [a] });
  // Corrupt b.md: impl type but an unknown status → schema blocker.
  writeIr(repo, { file: "b.md", id: "IMPL-B", title: "Beta", status: "bogus-status" });

  const plan = planImplIndexSync(repo, "ir");
  assert.equal(plan.verdict, "rejected");
  assert.match(plan.reason ?? "", /b\.md/);
});

test("IR: apply --expect rejects on source drift with zero writes", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  const b: IrSpec = { file: "b.md", id: "IMPL-B", title: "Beta", status: "draft" };
  for (const spec of [a, b]) writeIr(repo, spec);
  writeIrIndex(repo, { active: [a, b] });
  rewriteIr(repo, { ...b, status: "completed" });

  const plan = planImplIndexSync(repo, "ir");
  assert.equal(plan.verdict, "sync");
  const before = shaFile(path.join(repo, "docs/impl/ir/README.md"));

  // Drift between preview and apply: flip b back to draft.
  rewriteIr(repo, { ...b, status: "draft" });
  const applied = applyImplIndexSync(repo, "ir", undefined, { expectPlanHash: plan.planHash });
  assert.equal(applied.written, false);
  assert.match(applied.plan.reason ?? "", /drift|changed|mismatch/i);
  assert.equal(shaFile(path.join(repo, "docs/impl/ir/README.md")), before, "README untouched");
});

test("IR: apply --expect rejects on README drift; content-only drift keeps the plan valid", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  const b: IrSpec = { file: "b.md", id: "IMPL-B", title: "Beta", status: "draft" };
  for (const spec of [a, b]) writeIr(repo, spec);
  writeIrIndex(repo, { active: [a, b] });
  rewriteIr(repo, { ...b, status: "completed" });

  const plan = planImplIndexSync(repo, "ir");

  // Row-affecting README drift between plan and apply → the fresh planHash
  // differs → --expect refuses with zero writes.
  const indexPath = path.join(repo, "docs/impl/ir/README.md");
  const edited = fs.readFileSync(indexPath, "utf8").replace("| draft | [a.md]", "| in-progress | [a.md]");
  fs.writeFileSync(indexPath, edited, "utf8");
  const editedSha = shaFile(indexPath);
  const drifted = applyImplIndexSync(repo, "ir", undefined, { expectPlanHash: plan.planHash });
  assert.equal(drifted.written, false);
  assert.match(drifted.plan.reason ?? "", /drift/i);
  assert.equal(shaFile(indexPath), editedSha, "README untouched");

  // Content-only source drift does not change the reconcile: --expect still
  // applies because planHash covers the plan, while pins describe observed
  // state for the apply-internal TOCTOU guard.
  const repo2 = tempRepo();
  for (const spec of [a, b]) writeIr(repo2, spec);
  writeIrIndex(repo2, { active: [a, b] });
  rewriteIr(repo2, { ...b, status: "completed" }, "docs/impl/ir");
  const plan2 = planImplIndexSync(repo2, "ir");
  assert.equal(plan2.verdict, "sync");
  fs.appendFileSync(path.join(repo2, "docs/impl/ir/a.md"), "\nbody note\n", "utf8");
  const contentOnly = applyImplIndexSync(repo2, "ir", undefined, { expectPlanHash: plan2.planHash });
  assert.equal(contentOnly.written, true, "unchanged plan still applies under --expect");
  assert.equal(planImplIndexSync(repo2, "ir").verdict, "in-sync");
});

test("IR: apply without --expect re-validates classification at write time", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  const b: IrSpec = { file: "b.md", id: "IMPL-B", title: "Beta", status: "draft" };
  for (const spec of [a, b]) writeIr(repo, spec);
  writeIrIndex(repo, { active: [a, b] });
  rewriteIr(repo, { ...b, status: "completed" });
  const plan = planImplIndexSync(repo, "ir");
  assert.equal(plan.verdict, "sync");

  // Between plan and apply the README is replaced by a hand-curated one →
  // the fresh plan inside apply rejects and nothing is written.
  writeRawIndex(repo, "# Hand curated\n\nNo marker here.\n");
  const applied = applyImplIndexSync(repo, "ir");
  assert.equal(applied.written, false);
  assert.equal(applied.plan.verdict, "rejected");
  assert.equal(fs.readFileSync(path.join(repo, "docs/impl/ir/README.md"), "utf8"), "# Hand curated\n\nNo marker here.\n");
});

test("IR: preview (planImplIndexSync) never writes", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  writeIr(repo, a);
  writeIrIndex(repo, { active: [a] });
  rewriteIr(repo, { ...a, status: "completed" });

  const before = treeHashes(repo);
  const plan = planImplIndexSync(repo, "ir");
  assert.equal(plan.verdict, "sync");
  assert.deepEqual(treeHashes(repo), before, "plan must be read-only");
});

test("IR: symlinked README is rejected and the target stays untouched", (t) => {
  const repo = tempRepo();
  const outside = tempRepo();
  const outsideFile = path.join(outside, "index.md");
  fs.writeFileSync(outsideFile, "# outside\n", "utf8");
  writeIr(repo, { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" });
  fs.mkdirSync(path.join(repo, "docs/impl/ir"), { recursive: true });
  try {
    fs.symlinkSync(outsideFile, path.join(repo, "docs/impl/ir", "README.md"));
  } catch {
    t.skip("file symlinks are not permitted on this platform");
    return;
  }

  const plan = planImplIndexSync(repo, "ir");
  assert.equal(plan.verdict, "rejected");
  const applied = applyImplIndexSync(repo, "ir");
  assert.equal(applied.written, false);
  assert.equal(fs.readFileSync(outsideFile, "utf8"), "# outside\n", "symlink target untouched");
});

test("IR: custom --dir inside the checkout works; escaping --dir is rejected", () => {
  const repo = tempRepo();
  const dir = "docs/impl/ir/archive";
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  writeIr(repo, a, dir);

  const created = applyImplIndexSync(repo, "ir", dir);
  assert.equal(created.plan.verdict, "create");
  assert.equal(created.plan.directory, dir);
  assert.equal(created.written, true);
  const content = fs.readFileSync(path.join(repo, dir, "README.md"), "utf8");
  assert.ok(content.includes(`Directory: \`${dir}\``));
  assert.equal(planImplIndexSync(repo, "ir", dir).verdict, "in-sync");

  assert.throws(() => planImplIndexSync(repo, "ir", "../outside"), /escapes the checkout/);
  assert.throws(() => planImplIndexSync(repo, "ir", "docs/specs"), /Scope mismatch/);
});

// --- EXP tests ----------------------------------------------------------------

test("EXP: membership reconcile — missing row added, excess row removed, filename-asc order", () => {
  const repo = tempRepo();
  for (const file of ["a.jsonl", "b.jsonl", "c.jsonl"]) writeExp(repo, file);
  // Index knows a and c only, plus a stale row for a deleted file.
  writeExpIndex(repo, { files: ["a.jsonl", "x-gone.jsonl", "c.jsonl"] });

  const plan = planImplIndexSync(repo, "exp");
  assert.equal(plan.verdict, "sync");
  const kinds = new Map(plan.changes.map((change) => [change.file, change.kind]));
  assert.equal(kinds.get("b.jsonl"), "add");
  assert.equal(kinds.get("x-gone.jsonl"), "remove");
  assert.equal(kinds.has("a.jsonl"), false);
  assert.equal(kinds.has("c.jsonl"), false);

  const applied = applyImplIndexSync(repo, "exp");
  assert.equal(applied.written, true);
  const content = fs.readFileSync(path.join(repo, "docs/impl/exp/README.md"), "utf8");
  const rows = content.split("\n").filter((line) => line.startsWith("| ["));
  assert.deepEqual(rows, [expRow("a.jsonl"), expRow("b.jsonl"), expRow("c.jsonl")]);
  assert.equal(planImplIndexSync(repo, "exp").verdict, "in-sync");
});

test("EXP: pure order drift syncs via reorder changes", () => {
  const repo = tempRepo();
  for (const file of ["a.jsonl", "b.jsonl", "c.jsonl"]) writeExp(repo, file);
  writeExpIndex(repo, { files: ["c.jsonl", "a.jsonl", "b.jsonl"] });

  const plan = planImplIndexSync(repo, "exp");
  assert.equal(plan.verdict, "sync");
  assert.ok(plan.changes.length > 0);
  assert.ok(plan.changes.every((change) => change.kind === "reorder"));

  const applied = applyImplIndexSync(repo, "exp");
  assert.equal(applied.written, true);
  const content = fs.readFileSync(path.join(repo, "docs/impl/exp/README.md"), "utf8");
  const rows = content.split("\n").filter((line) => line.startsWith("| ["));
  assert.deepEqual(rows, [expRow("a.jsonl"), expRow("b.jsonl"), expRow("c.jsonl")]);
});

test("EXP: rejects hand-curated, broken, duplicate, and escaping rows", () => {
  const repo = tempRepo();
  writeExp(repo, "a.jsonl");

  // hand-curated: no marker
  writeRawIndex(repo, "# Experiment Logs\n\nDirectory: `docs/impl/exp`\n\n| File |\n| --- |\n| [a.jsonl](./a.jsonl) |\n", "docs/impl/exp");
  assert.equal(planImplIndexSync(repo, "exp").verdict, "rejected");

  const cases = [
    // wrong cell count
    `# Experiment Logs\n\n${MARKER}\n\nDirectory: \`docs/impl/exp\`\n\n${EXP_HEADER}\n| [a.jsonl](./a.jsonl) | extra |\n`,
    // duplicate rows
    `# Experiment Logs\n\n${MARKER}\n\nDirectory: \`docs/impl/exp\`\n\n${EXP_HEADER}\n| [a.jsonl](./a.jsonl) |\n| [a.jsonl](./a.jsonl) |\n`,
    // escaping link
    `# Experiment Logs\n\n${MARKER}\n\nDirectory: \`docs/impl/exp\`\n\n${EXP_HEADER}\n| [a.jsonl](../a.jsonl) |\n`,
    // non-link cell
    `# Experiment Logs\n\n${MARKER}\n\nDirectory: \`docs/impl/exp\`\n\n${EXP_HEADER}\n| a.jsonl |\n`,
  ];
  for (const content of cases) {
    writeRawIndex(repo, content, "docs/impl/exp");
    const plan = planImplIndexSync(repo, "exp");
    assert.equal(plan.verdict, "rejected", `expected rejection for: ${content.slice(-90)}`);
  }
});

test("EXP: missing README → create; empty dir → header-only 1-col index", () => {
  const repo = tempRepo();
  writeExp(repo, "a.jsonl");
  writeExp(repo, "b.jsonl");

  const created = applyImplIndexSync(repo, "exp");
  assert.equal(created.plan.verdict, "create");
  assert.equal(created.written, true);
  const content = fs.readFileSync(path.join(repo, "docs/impl/exp/README.md"), "utf8");
  assert.ok(content.startsWith(`# Experiment Logs\n\n${MARKER}\n\nDirectory: \`docs/impl/exp\`\n\n`));
  assert.ok(content.includes(expRow("a.jsonl")));
  assert.ok(!content.includes("Title"), "EXP index stays one-column");

  const empty = tempRepo();
  const emptyApplied = applyImplIndexSync(empty, "exp");
  assert.equal(emptyApplied.written, true);
  const emptyContent = fs.readFileSync(path.join(empty, "docs/impl/exp/README.md"), "utf8");
  assert.equal(
    emptyContent,
    `# Experiment Logs\n\n${MARKER}\n\nDirectory: \`docs/impl/exp\`\n\n${EXP_HEADER}\n`,
  );
});

test("EXP: hand-written preamble and tail are preserved", () => {
  const repo = tempRepo();
  writeExp(repo, "a.jsonl");
  writeExp(repo, "b.jsonl");
  writeExpIndex(repo, {
    files: ["a.jsonl"],
    preamble: "# Experiment board\n\nIntro note.\n\n",
    tail: "\nTail note.\n",
  });

  const applied = applyImplIndexSync(repo, "exp");
  assert.equal(applied.written, true);
  const content = fs.readFileSync(path.join(repo, "docs/impl/exp/README.md"), "utf8");
  assert.ok(content.includes("# Experiment board\n\nIntro note."));
  assert.ok(content.includes("Tail note."));
  assert.ok(content.includes(expRow("b.jsonl")), "b.jsonl row added");
});

// --- shared ------------------------------------------------------------------

test("parseImplIndexRows returns typed rows for managed content and errors otherwise", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  const b: IrSpec = { file: "b.md", id: "IMPL-B", title: "Beta", status: "completed" };
  for (const spec of [a, b]) writeIr(repo, spec);
  writeIrIndex(repo, { active: [a], settled: [b], preamble: "# Custom\n\nProse.\n\n", tail: "\nTail.\n" });

  const content = fs.readFileSync(path.join(repo, "docs/impl/ir/README.md"), "utf8");
  const parsed = parseImplIndexRows(content, "ir");
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.rows.length, 2);
    assert.deepEqual(parsed.rows[0], { file: "a.md", cells: ["IMPL-A", "Alpha", "draft", "[a.md](./a.md)"], tier: "active" });
    assert.deepEqual(parsed.rows[1], { file: "b.md", cells: ["IMPL-B", "Beta", "completed", "[b.md](./b.md)"], tier: "settled" });
  }

  const bad = parseImplIndexRows("# no marker\n", "ir");
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.reason, /marker|hand-curated|ambiguous/i);

  const expParsed = parseImplIndexRows(`# Experiment Logs\n\n${MARKER}\n\nDirectory: \`docs/impl/exp\`\n\n${EXP_HEADER}\n${expRow("a.jsonl")}\n`, "exp");
  assert.equal(expParsed.ok, true);
  if (expParsed.ok) {
    assert.deepEqual(expParsed.rows[0], { file: "a.jsonl", cells: ["[a.jsonl](./a.jsonl)"], tier: "active" });
  }
});

// --- CLI + creator alignment (built scripts; requires `pnpm run build`) ------

const implRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/impl-doc");

function runImplScript(name: string, args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [path.join(implRoot, "scripts", name), ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const runSync = (args: string[], cwd: string) => runImplScript("sync_impl_index.js", args, cwd);

test("CLI: preview prints the plan and writes nothing", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  const b: IrSpec = { file: "b.md", id: "IMPL-B", title: "Beta", status: "draft" };
  for (const spec of [a, b]) writeIr(repo, spec);
  writeIrIndex(repo, { active: [a, b] });
  rewriteIr(repo, { ...b, status: "completed" });

  const before = treeHashes(repo);
  const result = runSync(["--cwd", repo, "--kind", "ir"], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /sync/i);
  assert.match(result.stdout, /preview|--apply/i);
  assert.match(result.stdout, /b\.md/);
  assert.deepEqual(treeHashes(repo), before, "preview must not write");
});

test("CLI: --apply --kind ir syncs drift and --json emits the plan shape", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  const b: IrSpec = { file: "b.md", id: "IMPL-B", title: "Beta", status: "draft" };
  for (const spec of [a, b]) writeIr(repo, spec);
  writeIrIndex(repo, { active: [a, b] });
  rewriteIr(repo, { ...b, status: "completed" });

  const result = runSync(["--cwd", repo, "--kind", "ir", "--apply", "--json"], repo);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.kind, "ir");
  assert.equal(report.directory, "docs/impl/ir");
  assert.equal(report.verdict, "sync");
  assert.equal(report.applied, true);
  assert.equal(report.written, true);
  assert.match(report.planHash, /^[0-9a-f]{64}$/);
  assert.ok(Array.isArray(report.changes));
  assert.ok(
    report.changes.some((change: { file: string; kind: string }) => change.file === "b.md" && change.kind === "move-tier"),
    "expected a move-tier change for b.md",
  );
  assert.ok(report.pins && typeof report.pins === "object");
  assert.ok(report.pins.sources["a.md"]);
  assert.deepEqual(report.plannedFiles, ["docs/impl/ir/README.md"]);

  const content = fs.readFileSync(path.join(repo, "docs/impl/ir/README.md"), "utf8");
  assert.ok(content.indexOf("[b.md](./b.md)") > content.indexOf("## Settled"), "b.md settled");

  const again = runSync(["--cwd", repo, "--kind", "ir", "--apply", "--json"], repo);
  const second = JSON.parse(again.stdout);
  assert.equal(second.verdict, "in-sync");
  assert.equal(second.written, false, "re-apply is a no-op");
});

test("CLI: --kind exp syncs membership and order drift", () => {
  const repo = tempRepo();
  for (const file of ["a.jsonl", "b.jsonl", "c.jsonl"]) writeExp(repo, file);
  writeExpIndex(repo, { files: ["c.jsonl", "a.jsonl"] }); // missing b, wrong order

  const result = runSync(["--cwd", repo, "--kind", "exp", "--apply", "--json"], repo);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.kind, "exp");
  assert.equal(report.verdict, "sync");
  assert.equal(report.written, true);

  const content = fs.readFileSync(path.join(repo, "docs/impl/exp/README.md"), "utf8");
  const rows = content.split("\n").filter((line) => line.startsWith("| ["));
  assert.deepEqual(rows, [expRow("a.jsonl"), expRow("b.jsonl"), expRow("c.jsonl")]);
});

test("CLI: --expect rejects apply when the plan drifted; files stay byte-identical", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  const b: IrSpec = { file: "b.md", id: "IMPL-B", title: "Beta", status: "draft" };
  for (const spec of [a, b]) writeIr(repo, spec);
  writeIrIndex(repo, { active: [a, b] });
  rewriteIr(repo, { ...b, status: "completed" });

  const preview = runSync(["--cwd", repo, "--kind", "ir", "--json"], repo);
  assert.equal(preview.status, 0, preview.stderr);
  const { planHash } = JSON.parse(preview.stdout);
  assert.match(planHash, /^[0-9a-f]{64}$/);

  // Drift between preview and apply: flip b back so the reconcile disappears.
  rewriteIr(repo, { ...b, status: "draft" });
  const before = treeHashes(repo);
  const apply = runSync(["--cwd", repo, "--kind", "ir", "--apply", "--expect", planHash, "--json"], repo);
  assert.equal(apply.status, 1, "a stale plan must not apply");
  const report = JSON.parse(apply.stdout);
  assert.equal(report.written, false);
  assert.match(report.reason ?? "", /drift/i);
  assert.deepEqual(treeHashes(repo), before, "rejected apply must not write");
});

test("CLI: invalid invocations exit 1", () => {
  const repo = tempRepo();
  writeIr(repo, { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" });

  assert.equal(runSync(["--cwd", repo], repo).status, 1, "missing --kind");
  assert.equal(runSync(["--cwd", repo, "--kind", "bogus"], repo).status, 1, "bad --kind");
  assert.equal(runSync(["--cwd", repo, "--kind", "ir", "--bogus"], repo).status, 1, "unknown flag");
  assert.equal(runSync(["--cwd", repo, "--kind", "ir", "--expect"], repo).status, 1, "--expect needs a value");
  assert.equal(runSync(["--cwd", repo, "--kind", "ir", "--help"], repo).status, 0, "--help exits 0");
});

test("CLI: rejected verdict exits 1 in preview and apply; README stays byte-identical", () => {
  const repo = tempRepo();
  writeIr(repo, { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" });
  writeRawIndex(repo, "# Implementation Records\n\nNo marker here.\n");
  const indexPath = path.join(repo, "docs/impl/ir/README.md");
  const before = shaFile(indexPath);

  const preview = runSync(["--cwd", repo, "--kind", "ir"], repo);
  assert.equal(preview.status, 1, "preview of a rejected plan exits 1");
  assert.match(preview.stdout + preview.stderr, /reject|hand-curated|marker/i);

  const apply = runSync(["--cwd", repo, "--kind", "ir", "--apply"], repo);
  assert.equal(apply.status, 1);
  assert.equal(shaFile(indexPath), before, "rejected README must be byte-identical");
});

test("CLI: preview and owner audits are read-only", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  const b: IrSpec = { file: "b.md", id: "IMPL-B", title: "Beta", status: "draft" };
  for (const spec of [a, b]) writeIr(repo, spec);
  writeIrIndex(repo, { active: [a, b] });
  rewriteIr(repo, { ...b, status: "completed" });
  writeExp(repo, "x.jsonl");
  writeExpIndex(repo, { files: [] }); // missing row → exp drift

  const before = treeHashes(repo);
  assert.equal(runSync(["--cwd", repo, "--kind", "ir"], repo).status, 0);
  assert.equal(runSync(["--cwd", repo, "--kind", "exp"], repo).status, 0);
  assert.equal(runImplScript("audit_impl_record.js", ["--cwd", repo, "--json"], repo).status, 0);
  assert.equal(runImplScript("audit_experiment_log.js", ["--cwd", repo, "--json"], repo).status, 0);
  assert.deepEqual(treeHashes(repo), before, "preview + audits must not write");
});

test("CLI: new_impl_record preserves hand-written preamble/tail in a managed README", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  writeIr(repo, a);
  writeIrIndex(repo, {
    active: [a],
    preamble: "# Team board\n\nCurated intro.\n\n",
    tail: "\n## Notes\n\nKeep this note.\n",
  });

  const result = runImplScript("new_impl_record.js", ["--title", "Gamma Work", "--cwd", repo], repo);
  assert.equal(result.status, 0, result.stderr);

  const content = fs.readFileSync(path.join(repo, "docs/impl/ir/README.md"), "utf8");
  assert.ok(content.includes("# Team board\n\nCurated intro."), "preamble preserved");
  assert.ok(content.includes("## Notes\n\nKeep this note."), "tail preserved");
  assert.ok(content.includes("gamma-work.md"), "new row added");
  assert.equal(planImplIndexSync(repo, "ir").verdict, "in-sync", "creator output stays sync-clean");
});

test("CLI: new_experiment_log preserves hand-written preamble/tail in a managed README", () => {
  const repo = tempRepo();
  writeExp(repo, "a.jsonl");
  writeExpIndex(repo, {
    files: ["a.jsonl"],
    preamble: "# Experiment board\n\nIntro note.\n\n",
    tail: "\nTail note.\n",
  });

  const result = runImplScript("new_experiment_log.js", ["--title", "Beta Probe", "--cwd", repo], repo);
  assert.equal(result.status, 0, result.stderr);

  const content = fs.readFileSync(path.join(repo, "docs/impl/exp/README.md"), "utf8");
  assert.ok(content.includes("# Experiment board\n\nIntro note."), "preamble preserved");
  assert.ok(content.includes("Tail note."), "tail preserved");
  assert.ok(content.includes("beta-probe.jsonl"), "new row added");
  assert.equal(planImplIndexSync(repo, "exp").verdict, "in-sync", "creator output stays sync-clean");
});

test("CLI: symlinked README — creators skip with a warning, sync rejects", (t) => {
  const repo = tempRepo();
  const outside = tempRepo();
  const outsideFile = path.join(outside, "index.md");
  fs.writeFileSync(outsideFile, "# Implementation Records\n\n", "utf8");
  fs.mkdirSync(path.join(repo, "docs/impl/ir"), { recursive: true });
  try {
    fs.symlinkSync(outsideFile, path.join(repo, "docs/impl/ir", "README.md"));
  } catch {
    t.skip("file symlinks are not permitted on this platform");
    return;
  }

  const created = runImplScript("new_impl_record.js", ["--title", "Gamma Work", "--cwd", repo], repo);
  assert.equal(created.status, 0, created.stderr);
  assert.match(created.stdout + created.stderr, /Skipped index update|hand-curated/i);
  assert.equal(fs.readFileSync(outsideFile, "utf8"), "# Implementation Records\n\n", "symlink target untouched");

  const synced = runSync(["--cwd", repo, "--kind", "ir", "--apply"], repo);
  assert.equal(synced.status, 1, "sync must reject a symlinked index");
  assert.equal(fs.readFileSync(outsideFile, "utf8"), "# Implementation Records\n\n", "symlink target untouched");
});

// --- index-aware owner audits -------------------------------------------------

function indexFindingCodes(findings: { code: string }[]): string[] {
  return findings.filter((finding) => finding.code.startsWith("index-")).map((finding) => finding.code).sort();
}

test("audit IR: in-sync managed index produces zero index findings", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  const b: IrSpec = { file: "b.md", id: "IMPL-B", title: "Beta", status: "completed" };
  for (const spec of [a, b]) writeIr(repo, spec);
  writeIrIndex(repo, { active: [a], settled: [b] });

  const report = auditImplementationRecords(repo, "docs/impl/ir");
  assert.deepEqual(indexFindingCodes(report.findings), []);
});

test("audit IR: flags missing/stale/metadata/tier/order index drift", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  const b: IrSpec = { file: "b.md", id: "IMPL-B", title: "Beta", status: "completed" };
  const c: IrSpec = { file: "c.md", id: "IMPL-C", title: "Gamma", status: "draft" };
  const d: IrSpec = { file: "d.md", id: "IMPL-D", title: "Delta", status: "draft" };
  const e: IrSpec = { file: "e.md", id: "IMPL-E", title: "Epsilon", status: "draft" };
  for (const spec of [a, b, c, d, e]) writeIr(repo, spec);
  writeIrIndex(repo, {
    active: [
      c, // order drift: c listed before a
      { file: "a.md", id: "IMPL-A", title: "Alpha", status: "in-progress" }, // metadata-mismatch
      { file: "ghost.md", id: "IMPL-G", title: "Ghost", status: "draft" }, // stale-entry
    ],
    settled: [
      { file: "b.md", id: "IMPL-B", title: "Beta", status: "draft" }, // metadata-mismatch (status cell)
      d, // tier-mismatch: draft row inside the Settled tier
    ],
  });
  // e.md has no index row → index-missing-entry.

  const report = auditImplementationRecords(repo, "docs/impl/ir");
  const codes = indexFindingCodes(report.findings);
  assert.equal(codes.filter((code) => code === "index-missing-entry").length, 1, "e.md missing row");
  assert.equal(codes.filter((code) => code === "index-stale-entry").length, 1, "ghost.md stale row");
  assert.equal(codes.filter((code) => code === "index-metadata-mismatch").length, 2, "a.md + b.md cell drift");
  assert.equal(codes.filter((code) => code === "index-tier-mismatch").length, 1, "d.md wrong tier");
  assert.equal(codes.filter((code) => code === "index-ordering").length, 1, "row order drift");
  assert.ok(!codes.includes("index-unparseable"), "structure parses fine");
  assert.ok(!codes.includes("index-escapes-root"), "no escaping rows");
});

test("audit IR: index classification — not-managed, unparseable, duplicate, escaping", () => {
  const repo = tempRepo();
  const a: IrSpec = { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" };
  writeIr(repo, a);

  // hand-curated: no marker
  writeRawIndex(repo, "# Implementation Records\n\nDirectory: `docs/impl/ir`\n\n| ID | Title | Status | File |\n| --- | --- | --- | --- |\n| IMPL-A | Alpha | draft | [a.md](./a.md) |\n");
  assert.deepEqual(indexFindingCodes(auditImplementationRecords(repo, "docs/impl/ir").findings), ["index-not-managed"]);

  // ambiguous: marker twice
  writeIrIndex(repo, { active: [a] });
  const indexPath = path.join(repo, "docs/impl/ir/README.md");
  fs.writeFileSync(indexPath, `${fs.readFileSync(indexPath, "utf8")}\n${MARKER}\n`, "utf8");
  assert.deepEqual(indexFindingCodes(auditImplementationRecords(repo, "docs/impl/ir").findings), ["index-not-managed"]);

  // broken table → index-unparseable (error)
  writeRawIndex(repo, `# Implementation Records\n\n${MARKER}\n\nDirectory: \`docs/impl/ir\`\n\n${IR_HEADER}\n| IMPL-A | Alpha | draft |\n`);
  let report = auditImplementationRecords(repo, "docs/impl/ir");
  assert.deepEqual(indexFindingCodes(report.findings), ["index-unparseable"]);
  assert.equal(report.findings.find((finding) => finding.code === "index-unparseable")?.severity, "error");

  // duplicate rows → index-duplicate-entry (warning)
  writeRawIndex(repo, `# Implementation Records\n\n${MARKER}\n\nDirectory: \`docs/impl/ir\`\n\n${IR_HEADER}\n| IMPL-A | Alpha | draft | [a.md](./a.md) |\n| IMPL-A | Alpha | draft | [a.md](./a.md) |\n`);
  report = auditImplementationRecords(repo, "docs/impl/ir");
  assert.deepEqual(indexFindingCodes(report.findings), ["index-duplicate-entry"]);
  assert.equal(report.findings.find((finding) => finding.code === "index-duplicate-entry")?.severity, "warning");

  // escaping row link → index-escapes-root (error)
  writeRawIndex(repo, `# Implementation Records\n\n${MARKER}\n\nDirectory: \`docs/impl/ir\`\n\n${IR_HEADER}\n| IMPL-A | Alpha | draft | [a.md](../a.md) |\n`);
  report = auditImplementationRecords(repo, "docs/impl/ir");
  assert.deepEqual(indexFindingCodes(report.findings), ["index-escapes-root"]);
  assert.equal(report.findings.find((finding) => finding.code === "index-escapes-root")?.severity, "error");
});

test("audit IR: missing README keeps only the existing missing-index warning", () => {
  const repo = tempRepo();
  writeIr(repo, { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" });

  const report = auditImplementationRecords(repo, "docs/impl/ir");
  assert.ok(report.findings.some((finding) => finding.code === "missing-index"));
  assert.deepEqual(indexFindingCodes(report.findings), []);
});

test("audit IR: symlinked README → index-not-managed", (t) => {
  const repo = tempRepo();
  const outside = tempRepo();
  const outsideFile = path.join(outside, "index.md");
  fs.writeFileSync(outsideFile, "# Implementation Records\n\n", "utf8");
  writeIr(repo, { file: "a.md", id: "IMPL-A", title: "Alpha", status: "draft" });
  fs.mkdirSync(path.join(repo, "docs/impl/ir"), { recursive: true });
  try {
    fs.symlinkSync(outsideFile, path.join(repo, "docs/impl/ir", "README.md"));
  } catch {
    t.skip("file symlinks are not permitted on this platform");
    return;
  }

  const report = auditImplementationRecords(repo, "docs/impl/ir");
  assert.deepEqual(indexFindingCodes(report.findings), ["index-not-managed"]);
});

test("audit EXP: flags membership, order, and stale index drift", () => {
  const repo = tempRepo();
  for (const file of ["a.jsonl", "b.jsonl", "c.jsonl"]) writeExp(repo, file);
  writeExpIndex(repo, { files: ["c.jsonl", "ghost.jsonl", "a.jsonl"] }); // missing b, stale ghost, order drift

  const report = auditExperimentLogs(repo, "docs/impl/exp");
  const codes = indexFindingCodes(report.findings);
  assert.equal(codes.filter((code) => code === "index-missing-entry").length, 1, "b.jsonl missing row");
  assert.equal(codes.filter((code) => code === "index-stale-entry").length, 1, "ghost.jsonl stale row");
  assert.equal(codes.filter((code) => code === "index-ordering").length, 1, "row order drift");
});

test("audit EXP: structural index problems map to dedicated codes", () => {
  const repo = tempRepo();
  writeExp(repo, "a.jsonl");

  // no marker → index-not-managed
  writeRawIndex(repo, "# Experiment Logs\n\n| File |\n| --- |\n| [a.jsonl](./a.jsonl) |\n", "docs/impl/exp");
  assert.deepEqual(indexFindingCodes(auditExperimentLogs(repo, "docs/impl/exp").findings), ["index-not-managed"]);

  // duplicate rows → index-duplicate-entry
  writeRawIndex(repo, `# Experiment Logs\n\n${MARKER}\n\nDirectory: \`docs/impl/exp\`\n\n${EXP_HEADER}\n| [a.jsonl](./a.jsonl) |\n| [a.jsonl](./a.jsonl) |\n`, "docs/impl/exp");
  assert.deepEqual(indexFindingCodes(auditExperimentLogs(repo, "docs/impl/exp").findings), ["index-duplicate-entry"]);

  // escaping row link → index-escapes-root
  writeRawIndex(repo, `# Experiment Logs\n\n${MARKER}\n\nDirectory: \`docs/impl/exp\`\n\n${EXP_HEADER}\n| [a.jsonl](../a.jsonl) |\n`, "docs/impl/exp");
  assert.deepEqual(indexFindingCodes(auditExperimentLogs(repo, "docs/impl/exp").findings), ["index-escapes-root"]);

  // wrong cell count → index-unparseable
  writeRawIndex(repo, `# Experiment Logs\n\n${MARKER}\n\nDirectory: \`docs/impl/exp\`\n\n${EXP_HEADER}\n| [a.jsonl](./a.jsonl) | extra |\n`, "docs/impl/exp");
  assert.deepEqual(indexFindingCodes(auditExperimentLogs(repo, "docs/impl/exp").findings), ["index-unparseable"]);
});

test("audit EXP: JSONL findings and index findings coexist without conflation", () => {
  const repo = tempRepo();
  writeExp(repo, "a.jsonl");
  fs.appendFileSync(path.join(repo, "docs/impl/exp", "a.jsonl"), "this is not json\n", "utf8");
  writeExp(repo, "b.jsonl");
  writeExpIndex(repo, { files: ["a.jsonl"] }); // b.jsonl has no row

  const report = auditExperimentLogs(repo, "docs/impl/exp");
  const codes = report.findings.map((finding) => finding.code);
  assert.ok(codes.includes("invalid-json"), "JSONL finding still reported");
  assert.ok(codes.includes("index-missing-entry"), "index finding still reported");
});
