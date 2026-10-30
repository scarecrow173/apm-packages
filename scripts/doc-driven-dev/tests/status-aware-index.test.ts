import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { writeGeneratedIndex } from "../src/skills/lib/doc_suite_utils";
import { collectFindings, summarizeHealth } from "../src/skills/lib/doc_report";
import { buildIndex as buildAdrIndex } from "../src/skills/adr-doc/scripts/lib/adr_utils";
import { updateIndexForMarkdownDir } from "../src/skills/impl-doc/scripts/lib/impl_doc_utils";

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");

/**
 * Issue #162 (B1–B3) + Issue #163 — status-aware generated index views.
 *
 * The settled tier is derived from the shared status authority
 * (`doc_lifecycle.isSettledStatus`) — no `archive:` front-matter flag.
 * These tests pin the format (active table first, `## Settled` tier below),
 * the deterministic ordering, the merge behavior for legacy/generated
 * indexes, lint convergence after regeneration, locale-sibling handling,
 * and the health roll-up for capture-layer orphans.
 */

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "status-aware-index-"));
}

function runScript(skill: string, name: string, args: string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(skillRoot, skill, "scripts", name), ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function writeDoc(root: string, rel: string, frontmatter: Record<string, string>, body = "# Doc\n") {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const head = Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`);
  fs.writeFileSync(full, `---\n${head.join("\n")}\n---\n\n${body}`, "utf8");
}

function rowFiles(region: string): string[] {
  return region.split("\n")
    .filter((line) => line.trim().startsWith("|") && !line.includes("---") && !/^\|\s*ID/i.test(line.trim()))
    .map((line) => /\[([^\]]*)\]\(([^)]*)\)/.exec(line)?.[2]?.trim() ?? "")
    .filter((file) => file !== "")
    .map((file) => file.replace(/^\.\//, ""));
}

function activeFiles(content: string): string[] {
  const settledAt = content.indexOf("## Settled");
  return rowFiles(settledAt >= 0 ? content.slice(0, settledAt) : content);
}

function settledFiles(content: string): string[] {
  const settledAt = content.indexOf("## Settled");
  return settledAt < 0 ? [] : rowFiles(content.slice(settledAt));
}

async function indexFindings(repo: string, type?: string) {
  const collected = await collectFindings(repo, { type });
  return collected.findings.filter((item) => item.category === "index");
}

test("generated index partitions settled documents under a marked Settled tier", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-old.md", {
    id: "TASK-0001", type: "task", status: "done", title: "Old task", created: "2026-01-01",
  });
  writeDoc(repo, "docs/tasks/0002-new.md", {
    id: "TASK-0002", type: "task", status: "in-progress", title: "New task", created: "2026-01-02",
  });
  writeDoc(repo, "docs/tasks/0003-plan.md", {
    id: "TASK-0003", type: "task", status: "todo", title: "Planned task", created: "2026-01-03",
  });
  writeDoc(repo, "docs/tasks/0004-dead.md", {
    id: "TASK-0004", type: "task", status: "wont-do", title: "Dead task", created: "2026-01-04",
  });

  const result = await writeGeneratedIndex(repo, "task", "docs/tasks", {});
  assert.ok(result.written);
  const content = fs.readFileSync(path.join(repo, "docs/tasks/README.md"), "utf8");

  assert.match(content, /<!-- doc-suite:generated-index -->/);
  assert.match(content, /## Settled <!-- doc-suite:settled-index -->/);
  assert.deepEqual(activeFiles(content), ["0002-new.md", "0003-plan.md"]);
  assert.deepEqual(settledFiles(content), ["0001-old.md", "0004-dead.md"]);
});

test("ordering is deterministic: overview.md first, in-flight lexical, settled lexical", async () => {
  const repo = tempRepo();
  // Deliberately created "out of order" so the output can only come from the
  // ordering rule: overview.md must lead the active tier, superseded design
  // lands in the settled tier.
  writeDoc(repo, "docs/designs/0002-beta.md", {
    id: "DESIGN-0002", type: "design", status: "approved", title: "Beta", created: "2026-01-02",
  });
  writeDoc(repo, "docs/designs/0009-legacy.md", {
    id: "DESIGN-0009", type: "design", status: "superseded", title: "Legacy", created: "2026-01-09",
  });
  writeDoc(repo, "docs/designs/0001-alpha.md", {
    id: "DESIGN-0001", type: "design", status: "draft", title: "Alpha", created: "2026-01-01",
  });
  writeDoc(repo, "docs/designs/overview.md", {
    id: "DESIGN-OVERVIEW", type: "design", status: "approved", title: "Overview", created: "2026-01-01",
  });

  await writeGeneratedIndex(repo, "design", "docs/designs", {});
  const content = fs.readFileSync(path.join(repo, "docs/designs/README.md"), "utf8");
  assert.deepEqual(activeFiles(content), ["overview.md", "0001-alpha.md", "0002-beta.md"]);
  assert.deepEqual(settledFiles(content), ["0009-legacy.md"]);
});

test("shared discovery dir partitions brainstorm and discovery rows by their own type", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/discovery/0001-research.md", {
    id: "DISC-0001", type: "discovery", status: "resolved", title: "Research", created: "2026-01-01",
  });
  writeDoc(repo, "docs/discovery/0002-live.md", {
    id: "DISC-0002", type: "discovery", status: "active", title: "Live", created: "2026-01-02",
  });
  writeDoc(repo, "docs/discovery/0003-brainstorm.md", {
    id: "BRAINSTORM-0003", type: "brainstorm", status: "capturing", title: "Brainstorm", created: "2026-01-03",
  });
  writeDoc(repo, "docs/discovery/0004-routed.md", {
    id: "BRAINSTORM-0004", type: "brainstorm", status: "routed", title: "Routed", created: "2026-01-04",
  });

  // Index regeneration writes the union of resident types.
  await writeGeneratedIndex(repo, "discovery", "docs/discovery", {});
  const content = fs.readFileSync(path.join(repo, "docs/discovery/README.md"), "utf8");
  // brainstorm "capturing"/discovery "active" stay in-flight; "routed"/
  // "resolved" are settled — the bucket comes from each row's own type.
  assert.deepEqual(activeFiles(content), ["0002-live.md", "0003-brainstorm.md"]);
  assert.deepEqual(settledFiles(content), ["0001-research.md", "0004-routed.md"]);
});

test("locale sibling files index as rows and partition with their own status", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0100-pair.md", {
    id: "SPEC-0100", type: "spec", status: "implemented", title: "Pair spec", created: "2026-01-01",
  });
  writeDoc(repo, "docs/specs/0100-pair.ja.md", {
    id: "SPEC-0100", type: "spec", status: "implemented", title: "Pair spec (ja)", created: "2026-01-01",
  });
  writeDoc(repo, "docs/specs/0200-next.md", {
    id: "SPEC-0200", type: "spec", status: "draft", title: "Next", created: "2026-01-02",
  });

  await writeGeneratedIndex(repo, "spec", "docs/specs", {});
  const content = fs.readFileSync(path.join(repo, "docs/specs/README.md"), "utf8");
  assert.deepEqual(activeFiles(content), ["0200-next.md"]);
  assert.deepEqual(settledFiles(content), ["0100-pair.ja.md", "0100-pair.md"]);
});

test("a status transition is reported as drift and repaired by regeneration", () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-old.md", {
    id: "TASK-0001", type: "task", status: "done", title: "Old task", created: "2026-01-01",
  });
  writeDoc(repo, "docs/tasks/0002-new.md", {
    id: "TASK-0002", type: "task", status: "todo", title: "New task", created: "2026-01-02",
  });
  // Legacy single-tier index still listing TASK-0001 as todo — exactly the
  // state a settled status transition leaves behind.
  writeDoc(repo, "docs/tasks/README.md", {}, [
    "# TASK Documents",
    "",
    "<!-- doc-suite:generated-index -->",
    "",
    "Directory: `docs/tasks`",
    "",
    "| ID | Title | Status | File |",
    "| --- | --- | --- | --- |",
    "| TASK-0001 | Old task | todo | [0001-old.md](./0001-old.md) |",
    "| TASK-0002 | New task | todo | [0002-new.md](./0002-new.md) |",
    "",
  ].join("\n"));

  // doc-status reports the drift before doc-maintenance repairs it — the
  // close-out convention relies on exactly this visibility (B2).
  const lint = runScript("doc-status", "doc_status.js", ["lint", "--type", "task"], repo);
  assert.equal(lint.status, 0, lint.stderr);
  assert.match(lint.stdout, /index-metadata-mismatch/);

  const maintenance = runScript("doc-maintenance", "doc_maintenance.js", ["apply", "--type", "task"], repo);
  assert.equal(maintenance.status, 0, maintenance.stderr);
  const content = fs.readFileSync(path.join(repo, "docs/tasks/README.md"), "utf8");
  assert.deepEqual(activeFiles(content), ["0002-new.md"]);
  assert.deepEqual(settledFiles(content), ["0001-old.md"]);
});

test("regeneration is drift-free: lint reports no index findings afterwards", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-live.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Live", created: "2026-01-01",
  });
  writeDoc(repo, "docs/specs/0002-done.md", {
    id: "SPEC-0002", type: "spec", status: "implemented", title: "Done", created: "2026-01-02",
  });
  writeDoc(repo, "docs/specs/0003-dead.md", {
    id: "SPEC-0003", type: "spec", status: "rejected", title: "Dead", created: "2026-01-03",
  });

  await writeGeneratedIndex(repo, "spec", "docs/specs", {});
  const findings = await indexFindings(repo, "spec");
  const driftRules = findings.filter((item) => item.ruleId.startsWith("index-"));
  assert.deepEqual(driftRules.map((item) => item.ruleId), [],
    `index drift after regeneration: ${JSON.stringify(driftRules)}`);
});

test("lint flags a settled row stranded in the active table", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/specs/0001-live.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Live", created: "2026-01-01",
  });
  writeDoc(repo, "docs/specs/0002-done.md", {
    id: "SPEC-0002", type: "spec", status: "implemented", title: "Done", created: "2026-01-02",
  });
  // Generated-shape index, but the settled row sits ahead of the in-flight
  // row — the ordering rule must flag it so doc-status reports the drift.
  writeDoc(repo, "docs/specs/README.md", {}, [
    "# SPEC Documents",
    "",
    "<!-- doc-suite:generated-index -->",
    "",
    "Directory: `docs/specs`",
    "",
    "| ID | Title | Status | File |",
    "| --- | --- | --- | --- |",
    "| SPEC-0002 | Done | implemented | [0002-done.md](./0002-done.md) |",
    "| SPEC-0001 | Live | approved | [0001-live.md](./0001-live.md) |",
    "",
  ].join("\n"));

  const findings = await indexFindings(repo, "spec");
  assert.ok(findings.some((item) => item.ruleId === "index-ordering"),
    `expected index-ordering finding: ${JSON.stringify(findings)}`);
});

test("regenerating a legacy index keeps hand-written preamble and tail", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-old.md", {
    id: "TASK-0001", type: "task", status: "done", title: "Old task", created: "2026-01-01",
  });
  writeDoc(repo, "docs/tasks/0002-new.md", {
    id: "TASK-0002", type: "task", status: "todo", title: "New task", created: "2026-01-02",
  });
  writeDoc(repo, "docs/tasks/README.md", {}, [
    "# Team task board",
    "",
    "Intro prose stays.",
    "",
    "<!-- doc-suite:generated-index -->",
    "",
    "Directory: `docs/tasks`",
    "",
    "| ID | Title | Status | File |",
    "| --- | --- | --- | --- |",
    "| TASK-0001 | Old task | todo | [0001-old.md](./0001-old.md) |",
    "| TASK-0002 | New task | todo | [0002-new.md](./0002-new.md) |",
    "",
    "Trailing hand-written notes stay too.",
    "",
  ].join("\n"));

  await writeGeneratedIndex(repo, "task", "docs/tasks", {});
  const content = fs.readFileSync(path.join(repo, "docs/tasks/README.md"), "utf8");
  assert.match(content, /# Team task board/);
  assert.match(content, /Intro prose stays\./);
  assert.match(content, /Trailing hand-written notes stay too\./);
  assert.match(content, /## Settled <!-- doc-suite:settled-index -->/);
  // Preamble remains before the marker; tail after the generated region.
  assert.ok(content.indexOf("# Team task board") < content.indexOf("doc-suite:generated-index"));
  assert.ok(content.indexOf("Trailing hand-written") > content.indexOf("doc-suite:settled-index"));
});

test("the Settled tier is consumed when every document is in-flight again", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/tasks/0001-old.md", {
    id: "TASK-0001", type: "task", status: "done", title: "Old task", created: "2026-01-01",
  });
  writeDoc(repo, "docs/tasks/0002-new.md", {
    id: "TASK-0002", type: "task", status: "todo", title: "New task", created: "2026-01-02",
  });
  await writeGeneratedIndex(repo, "task", "docs/tasks", {});
  assert.match(fs.readFileSync(path.join(repo, "docs/tasks/README.md"), "utf8"), /## Settled/);

  // Reopen both documents — regeneration must remove the tier wholesale,
  // not leave a stale table behind.
  writeDoc(repo, "docs/tasks/0001-old.md", {
    id: "TASK-0001", type: "task", status: "todo", title: "Old task", created: "2026-01-01",
  });
  await writeGeneratedIndex(repo, "task", "docs/tasks", {});
  const content = fs.readFileSync(path.join(repo, "docs/tasks/README.md"), "utf8");
  assert.doesNotMatch(content, /## Settled|doc-suite:settled-index/);
  assert.deepEqual(activeFiles(content), ["0001-old.md", "0002-new.md"]);
});

test("ADR index partitions rejected/deprecated records into the Settled tier", async () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/adr/0001-use-es.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "Use ES", created: "2026-01-01",
  });
  writeDoc(repo, "docs/adr/0002-old-store.md", {
    id: "ADR-0002", type: "adr", status: "deprecated", title: "Old store", created: "2026-01-02",
  });
  writeDoc(repo, "docs/adr/0003-rejected.md", {
    id: "ADR-0003", type: "adr", status: "rejected", title: "Rejected", created: "2026-01-03",
  });

  // buildIndex returns the generated body; update_index.js writes it.
  const content = await buildAdrIndex(path.join(repo, "docs/adr"), "docs/adr");
  assert.match(content, /## Settled <!-- doc-suite:settled-index -->/);
  // `accepted` stays in-flight — it is the normative baseline, not a close-out.
  assert.deepEqual(activeFiles(content), ["0001-use-es.md"]);
  assert.deepEqual(settledFiles(content), ["0002-old-store.md", "0003-rejected.md"]);
});

test("impl record index partitions completed/abandoned records into the Settled tier", () => {
  const repo = tempRepo();
  writeDoc(repo, "docs/impl/ir/0001-live.md", {
    id: "IMPL-0001", type: "implementation-record", status: "in-progress", title: "Live", created: "2026-01-01",
  });
  writeDoc(repo, "docs/impl/ir/0002-done.md", {
    id: "IMPL-0002", type: "implementation-record", status: "completed", title: "Done", created: "2026-01-02",
  });
  writeDoc(repo, "docs/impl/ir/0003-dead.md", {
    id: "IMPL-0003", type: "implementation-record", status: "abandoned", title: "Dead", created: "2026-01-03",
  });

  const result = updateIndexForMarkdownDir(repo, "docs/impl/ir");
  assert.equal(result.written, true);
  const content = fs.readFileSync(path.join(repo, "docs/impl/ir/README.md"), "utf8");
  assert.match(content, /## Settled <!-- doc-suite:settled-index -->/);
  assert.deepEqual(activeFiles(content), ["0001-live.md"]);
  assert.deepEqual(settledFiles(content), ["0002-done.md", "0003-dead.md"]);
});

test("health reports the capture-layer orphan roll-up", async () => {
  const repo = tempRepo();
  // Orphans: reachable from no index, no links, no relations.
  writeDoc(repo, "docs/tasks/0001-lone.md", {
    id: "TASK-0001", type: "task", status: "todo", title: "Lone task", created: "2026-01-01",
    relations: "{}",
  });
  writeDoc(repo, "docs/ideas/0001-spark.md", {
    id: "IDEA-0001", type: "idea", status: "draft", title: "Spark", created: "2026-01-01",
    relations: "{}",
  });

  const collected = await collectFindings(repo, {});
  const health = summarizeHealth(collected, collected.findings);
  assert.ok(health.orphans.total > 0, "orphan roll-up expected");
  const ruleTotal = Object.values(health.orphans.byRule).reduce((sum, count) => sum + count, 0);
  const typeTotal = Object.values(health.orphans.byType).reduce((sum, count) => sum + count, 0);
  assert.equal(ruleTotal, health.orphans.total);
  assert.equal(typeTotal, health.orphans.total);
  assert.ok((health.orphans.byType.task ?? 0) >= 1);
  assert.ok((health.orphans.byType.idea ?? 0) >= 1);
});
