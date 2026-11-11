import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { auditAllDocuments } from "../src/skills/lib/doc_audit";
import { collectOwnerAudits } from "../src/skills/doc-status/scripts/lib/owner_audits";

function fixture(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "audit-owners-"));
}
function writeFile(root: string, relPath: string, content: string) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

// Owner index fixtures mirror impl-index-sync.test.ts exactly: IR uses the
// impl-4col generated index, EXP the exp-1col `| File |` table, both under the
// doc-suite generated-index marker.
const GENERATED_INDEX = "<!-- doc-suite:generated-index -->";
const IR_HEADER = "| ID | Title | Status | File |\n| --- | --- | --- | --- |";
const EXP_HEADER = "| File |\n| --- |";

function writeIrDoc(root: string, file: string, spec: { id: string; title: string; status: string }) {
  writeFile(root, `docs/impl/ir/${file}`, [
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
  ].join("\n"));
}

function writeIrIndex(root: string, activeRows: string[], settledRows: string[] = []) {
  const active = [IR_HEADER, ...activeRows].join("\n");
  const body = settledRows.length === 0
    ? active
    : `${active}\n\n## Settled <!-- doc-suite:settled-index -->\n\n${[IR_HEADER, ...settledRows].join("\n")}`;
  writeFile(
    root,
    "docs/impl/ir/README.md",
    `# Implementation Records\n\n${GENERATED_INDEX}\n\nDirectory: \`docs/impl/ir\`\n\n${body}\n`,
  );
}

function writeExpLog(root: string, file: string) {
  writeFile(
    root,
    `docs/impl/exp/${file}`,
    `${JSON.stringify({ schema: "experiment_event.v1", experiment: `docs/impl/exp/${file}`, seq: 1, type: "start", ts: "2026-01-01T00:00:00Z" })}\n`,
  );
}

function writeExpIndex(root: string, files: string[]) {
  const rows = files.map((file) => `| [${file}](./${file}) |`);
  const body = rows.length > 0 ? `${EXP_HEADER}\n${rows.join("\n")}` : EXP_HEADER;
  writeFile(
    root,
    "docs/impl/exp/README.md",
    `# Experiment Logs\n\n${GENERATED_INDEX}\n\nDirectory: \`docs/impl/exp\`\n\n${body}\n`,
  );
}

test("collectOwnerAudits runs impl-record and experiment-log owner audits", () => {
  const root = fixture();
  const owners = collectOwnerAudits(root);
  assert.deepEqual(owners.map((o) => o.name), ["impl-record", "experiment-log"]);
  // missing dirs -> missing-index warning surfaces, never throws
  assert.ok(owners.every((o) => o.findings.some((f) => f.code === "missing-index")));
  assert.equal(owners.every((o) => o.findings.every((f) => f.blocking === false || f.severity === "error")), true);
});

test("collectOwnerAudits detects IR status/index mismatch package-wide", () => {
  const root = fixture();
  // IR doc status: completed but its README lists it in the ACTIVE table
  // (impl-4col generated index, no ## Settled placement) -> owner audit
  // reports index-tier-mismatch. Build the fixture per impl-doc conventions:
  // docs/impl/ir/2026-11-12-x.md + generated README.md managed index.
  writeIrDoc(root, "2026-11-12-x.md", { id: "IMPL-X", title: "X", status: "completed" });
  writeIrIndex(root, ["| IMPL-X | X | completed | [2026-11-12-x.md](./2026-11-12-x.md) |"]);
  const owners = collectOwnerAudits(root);
  const ir = owners.find((o) => o.name === "impl-record")!;
  assert.ok(ir.findings.some((f) => f.code === "index-tier-mismatch"));
});

test("collectOwnerAudits detects EXP JSONL/index mismatch", () => {
  const root = fixture();
  // docs/impl/exp/0001-x.jsonl exists but generated exp README lacks the row
  // -> experiment-log owner audit reports index-missing-entry.
  writeExpLog(root, "0001-x.jsonl");
  writeExpIndex(root, []);
  const owners = collectOwnerAudits(root);
  const exp = owners.find((o) => o.name === "experiment-log")!;
  assert.ok(exp.findings.some((f) => f.code === "index-missing-entry"));
});

test("auditAllDocuments report shape accepts ownerAudits", async () => {
  const root = fixture();
  const report = await auditAllDocuments(root, undefined, {});
  report.ownerAudits = collectOwnerAudits(root);
  assert.equal(report.ownerAudits!.length, 2);
});
