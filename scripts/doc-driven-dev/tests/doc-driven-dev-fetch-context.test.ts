import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { case01 } from "./e2e/cases/case-01-happy-path";
import type { E2ECase } from "./e2e/harness/case_types";
import {
  createFixtureRepo,
  updateArtifact,
  writeArtifact,
  type DocSpec,
} from "./e2e/harness/fixture_manager";
import { runCase } from "./e2e/harness/run_case";
import { canonicalReference } from "../src/skills/doc-driven-dev-graph/scripts/lib/caller_runner";

/**
 * Issue #124 Task 5 — e2e coverage for the GENERATED fetch_context.js bundle
 * (same spawn convention as the check-parallel tests) plus the scan-vs-
 * delegate-input read baseline on a large corpus. Lib internals are covered
 * by doc-driven-dev-artifact-context.test.ts; this file proves the CLI
 * contract end to end and the baseline separation at fixture scale.
 *
 * Large-corpus approach: a FULL runCase on the ~70-record corpus (not the
 * direct scan+lib fallback). The corpus only adds in-process file reads per
 * routing hop — the per-hop tsx spawn count is unchanged, so runtime stays
 * proportional to the happy path. The pathological variant (duplicate-id /
 * broken relation) is exercised separately: those issues are router-level
 * hard blockers by design, so that variant asserts fail-closed CLI findings
 * and a blocked runCase rather than dispatched delegates.
 */
const FETCH_CONTEXT = path.resolve(
  __dirname,
  "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/fetch_context.js",
);

type CliRun = {
  status: number | null; stdout: string;
  report: Record<string, unknown>; stderr: string;
};
type Finding = { code: string; path?: string; message: string };
type MetadataEntry = {
  path: string; id: string | null; type: string | null;
  status: string | null; relations: Record<string, string[]>;
};
type FetchDocument = { path: string; id: string | null; body: string };
type ExpandNode = { path: string; id: string | null; depth: number; via: string | null };

function runCli(repo: string, args: string[]): CliRun {
  const result = spawnSync(
    process.execPath,
    [FETCH_CONTEXT, "--cwd", repo, "--json", ...args],
    { cwd: repo, encoding: "utf8", windowsHide: true },
  );
  let report: Record<string, unknown>;
  try {
    report = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    assert.fail(`CLI stdout is not JSON (status ${result.status}): ${result.stdout}\nstderr: ${result.stderr}`);
  }
  return { status: result.status, stdout: result.stdout, report, stderr: result.stderr };
}

function findings(report: Record<string, unknown>): Finding[] {
  return (report.findings ?? []) as Finding[];
}

/** Recursively assert no object in the payload carries a forbidden key. */
function assertNoKeys(value: unknown, keys: string[], location: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoKeys(item, keys, `${location}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const key of keys) {
      assert.equal(key in value, false, `${location} must not carry ${key}`);
    }
    for (const [name, item] of Object.entries(value)) {
      assertNoKeys(item, keys, `${location}.${name}`);
    }
  }
}

// --- Step 1: CLI e2e on the small fixture corpus ------------------------------

test("L1 --metadata covers the focus chain plus typed-relation neighbors, body-free and sorted", () => {
  const repo = createFixtureRepo();
  const { status, report, stderr } = runCli(repo, ["--metadata", "--focus", "PLAN-0001"]);
  assert.equal(status, 0, stderr);
  const metadata = report.metadata as MetadataEntry[];
  const paths = metadata.map((entry) => entry.path);
  assert.deepEqual(paths, [...paths].sort((left, right) => left.localeCompare(right)),
    "metadata must be sorted by path");
  assert.deepEqual(new Set(paths), new Set([
    "docs/adr/0001-graph.md",
    "docs/designs/0001-graph.md",
    "docs/plans/0001-graph.md",
    "docs/specs/0001-graph.md",
    "docs/tasks/0001-task.md",
    "docs/test-specs/0001-graph.md",
  ]));
  // The impl record shares the repo but sits outside the focus chain.
  assert.equal(paths.includes("docs/impl/ir/0001-task.md"), false);
  assertNoKeys(report, ["body", "absolutePath"], "report");
  assert.deepEqual(findings(report), []);
});

test("L1 --metadata without --focus fails closed with focus-required", () => {
  const repo = createFixtureRepo();
  const { status, report } = runCli(repo, ["--metadata"]);
  assert.equal(status, 1);
  assert.deepEqual(report.metadata, []);
  assert.ok(findings(report).some((finding) => finding.code === "focus-required"));
});

test("L1 --metadata with an ambiguous focus fails closed with focus-invalid", () => {
  // Two plans on one design: DESIGN-0001 cannot resolve to a unique chain.
  const repo = createFixtureRepo({ secondPlan: true });
  const { status, report } = runCli(repo, ["--metadata", "--focus", "DESIGN-0001"]);
  assert.equal(status, 1);
  assert.deepEqual(report.metadata, []);
  assert.ok(findings(report).some((finding) => finding.code === "focus-invalid"));
});

test("L2 --fetch returns validated bodies for canonical refs", () => {
  const repo = createFixtureRepo();
  const { status, report, stderr } = runCli(repo, [
    "--fetch", "docs/plans/0001-graph.md",
    "--fetch", "docs/tasks/0001-task.md",
  ]);
  assert.equal(status, 0, stderr);
  assert.equal(report.level, "L2");
  const documents = report.documents as FetchDocument[];
  assert.deepEqual(documents.map((doc) => doc.path), [
    "docs/plans/0001-graph.md",
    "docs/tasks/0001-task.md",
  ]);
  assert.equal(documents[0].id, "PLAN-0001");
  assert.ok(documents[0].body.includes("# Graph"));
  assert.equal(documents[1].id, "TASK-0001");
  assert.deepEqual(findings(report), []);
});

test("L2 --fetch rejects a wrong --id pin, exit 1", () => {
  const repo = createFixtureRepo();
  const { status, report } = runCli(repo, [
    "--fetch", "docs/plans/0001-graph.md",
    "--id", "docs/plans/0001-graph.md:PLAN-9999",
  ]);
  assert.equal(status, 1);
  assert.deepEqual(report.documents, []);
  assert.ok(findings(report).some((finding) => finding.code === "id-mismatch"
    && finding.path === "docs/plans/0001-graph.md"));
});

test("L2 --fetch rejects a stale --fingerprint after the doc is re-projected", () => {
  const repo = createFixtureRepo();
  const before = canonicalReference(repo, "docs/plans/0001-graph.md");
  updateArtifact(repo, "docs/plans/0001-graph.md", { title: "Graph v2" });

  const stale = runCli(repo, [
    "--fetch", "docs/plans/0001-graph.md",
    "--fingerprint", `docs/plans/0001-graph.md:${before.fingerprint}`,
  ]);
  assert.equal(stale.status, 1);
  assert.deepEqual(stale.report.documents, []);
  assert.ok(findings(stale.report).some((finding) => finding.code === "stale-fingerprint"
    && finding.path === "docs/plans/0001-graph.md"));

  // Refresh rule: re-project, then re-fetch with the new fingerprint.
  const after = canonicalReference(repo, "docs/plans/0001-graph.md");
  assert.notEqual(after.fingerprint, before.fingerprint);
  const retry = runCli(repo, [
    "--fetch", "docs/plans/0001-graph.md",
    "--fingerprint", `docs/plans/0001-graph.md:${after.fingerprint}`,
  ]);
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal((retry.report.documents as FetchDocument[]).length, 1);
});

test("L3 --expand over an a↔b derives-from cycle terminates, deduped, via recorded", () => {
  const repo = createFixtureRepo();
  writeArtifact(repo, "docs/specs/0007-cyc-a.md", {
    id: "CYC-A", type: "spec", status: "approved", title: "Cycle A",
    relations: { "derives-from": ["CYC-B"] },
  }, "# Cycle A\n");
  writeArtifact(repo, "docs/specs/0008-cyc-b.md", {
    id: "CYC-B", type: "spec", status: "approved", title: "Cycle B",
    relations: { "derives-from": ["CYC-A"] },
  }, "# Cycle B\n");
  // Depth 5 would loop forever without the visited set.
  const { status, report, stderr } = runCli(repo, ["--expand", "CYC-A", "--depth", "5"]);
  assert.equal(status, 0, stderr);
  assert.deepEqual(report.nodes as ExpandNode[], [
    { path: "docs/specs/0007-cyc-a.md", id: "CYC-A", depth: 0, via: null },
    { path: "docs/specs/0008-cyc-b.md", id: "CYC-B", depth: 1, via: "derives-from" },
  ]);
  assert.deepEqual(findings(report), []);
});

test("L3 --expand records broken-relation and ambiguous-target lookups, exit 1", () => {
  const repo = createFixtureRepo();
  writeArtifact(repo, "docs/specs/0020-src.md", {
    id: "SRC-0001", type: "spec", status: "approved", title: "Source",
    relations: { "derives-from": ["MISSING-0001", "DUP-T"] },
  }, "# Source\n");
  writeArtifact(repo, "docs/specs/0021-dup-a.md", {
    id: "DUP-T", type: "spec", status: "approved", title: "Dup A",
  }, "# Dup A\n");
  writeArtifact(repo, "docs/specs/0022-dup-b.md", {
    id: "DUP-T", type: "spec", status: "approved", title: "Dup B",
  }, "# Dup B\n");
  const { status, report } = runCli(repo, ["--expand", "docs/specs/0020-src.md"]);
  assert.equal(status, 1);
  assert.deepEqual(report.nodes as ExpandNode[], [
    { path: "docs/specs/0020-src.md", id: "SRC-0001", depth: 0, via: null },
  ]);
  const found = findings(report);
  assert.ok(found.some((finding) => finding.code === "broken-relation"
    && finding.path === "docs/specs/0020-src.md"
    && finding.message.includes("MISSING-0001")));
  assert.ok(found.some((finding) => finding.code === "ambiguous-target"
    && finding.path === "docs/specs/0020-src.md"
    && finding.message.includes("DUP-T")));
});

test("conflicting modes fail at the CLI boundary with an error payload", () => {
  const repo = createFixtureRepo();
  const { status, report } = runCli(repo, ["--metadata", "--fetch", "docs/plans/0001-graph.md"]);
  assert.equal(status, 1);
  assert.equal(typeof report.error, "string");
});

test("--task-dir escaping the checkout is a caller error in every mode (#142)", () => {
  const repo = createFixtureRepo();
  for (const taskDir of ["../outside", "./../outside", path.dirname(repo)]) {
    for (const mode of [
      ["--metadata", "--focus", "PLAN-0001"],
      ["--fetch", "docs/plans/0001-graph.md"],
      ["--expand", "docs/plans/0001-graph.md"],
    ]) {
      const { status, report } = runCli(repo, [...mode, "--task-dir", taskDir]);
      assert.equal(status, 1, `${mode[0]} --task-dir ${taskDir}`);
      assert.equal(typeof report.error, "string", `${mode[0]} --task-dir ${taskDir}`);
      assert.match(String(report.error), /--task-dir escapes the checkout/, `${mode[0]} --task-dir ${taskDir}`);
    }
  }
  // Contained task dirs work in every mode.
  const metadata = runCli(repo, ["--metadata", "--focus", "PLAN-0001", "--task-dir", "docs/tasks"]);
  assert.equal(metadata.status, 0, metadata.stderr);
  const fetched = runCli(repo, ["--fetch", "docs/tasks/0001-task.md", "--task-dir", "docs/tasks"]);
  assert.equal(fetched.status, 0, fetched.stderr);
  const expanded = runCli(repo, ["--expand", "docs/plans/0001-graph.md", "--task-dir", "docs/tasks"]);
  assert.equal(expanded.status, 0, expanded.stderr);
});

test("--task-dir keeps L1/L2/L3 on one scan set (#141)", () => {
  const repo = createFixtureRepo();
  writeArtifact(repo, "docs/work-items/0001-task.md", {
    id: "TASK-CUSTOM", type: "task", status: "todo", title: "Custom",
    relations: { implements: ["docs/plans/0001-graph.md"] },
  }, "# Custom task\n");

  // L1 lists the custom-dir record only when --task-dir is supplied.
  const listed = runCli(repo, ["--metadata", "--focus", "PLAN-0001", "--task-dir", "docs/work-items"]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.ok((listed.report.metadata as MetadataEntry[]).some((entry) =>
    entry.path === "docs/work-items/0001-task.md" && entry.id === "TASK-CUSTOM"));

  // L2 refuses the same path as not-canonical without the dir, accepts it with.
  const refused = runCli(repo, ["--fetch", "docs/work-items/0001-task.md"]);
  assert.equal(refused.status, 1);
  assert.ok(findings(refused.report).some((finding) => finding.code === "not-canonical"));
  const fetched = runCli(repo, ["--fetch", "docs/work-items/0001-task.md", "--task-dir", "docs/work-items"]);
  assert.equal(fetched.status, 0, fetched.stderr);
  assert.equal((fetched.report.documents as FetchDocument[])[0].id, "TASK-CUSTOM");

  // L3 resolves the custom-dir root only with the dir.
  const missing = runCli(repo, ["--expand", "TASK-CUSTOM"]);
  assert.equal(missing.status, 1);
  assert.ok(findings(missing.report).some((finding) => finding.code === "not-found"));
  const expanded = runCli(repo, [
    "--expand", "TASK-CUSTOM", "--task-dir", "docs/work-items", "--relations", "implements",
  ]);
  assert.equal(expanded.status, 0, expanded.stderr);
  assert.deepEqual((expanded.report.nodes as ExpandNode[]).map((node) => node.path), [
    "docs/work-items/0001-task.md",
    "docs/plans/0001-graph.md",
  ]);
});

test("--expand reports requested-but-undeclared relations as unused-relation (#143)", () => {
  const repo = createFixtureRepo();
  // "implements" is declared on task records even though no edge walks it
  // from the plan; "implementz" is declared nowhere — a typo the caller sees.
  const { status, report } = runCli(repo, [
    "--expand", "docs/plans/0001-graph.md", "--relations", "implements,implementz",
  ]);
  assert.equal(status, 1);
  const unused = findings(report).filter((finding) => finding.code === "unused-relation");
  assert.equal(unused.length, 1);
  assert.ok(unused[0].message.includes("implementz"));

  // Declared relations — walked or merely present on scanned records — give
  // no finding, and a clean traversal exits 0.
  const clean = runCli(repo, ["--expand", "docs/plans/0001-graph.md", "--relations", "derives-from"]);
  assert.equal(clean.status, 0, clean.stderr);
  assert.deepEqual(findings(clean.report), []);
});

// --- Step 2: large corpus ------------------------------------------------------

const pad = (value: number): string => String(value).padStart(4, "0");

/**
 * The Task-5 large corpus: createFixtureRepo's standard chain plus ~60 extra
 * canonical docs — 20 discovery (one ≥50KB body so scan bytes dominate), 15
 * specs (11 bulk + an en/ja sibling pair + an a↔b derives-from cycle), 10
 * ADRs, 10 tasks bound to PLAN-0002 (a second chain), 5 idea docs.
 *
 * `pathologies` adds the dup-ID pair and the broken relation. Both are
 * scan-level `duplicate-id`/`broken-relation` issues — which graph_state
 * promotes to ROUTER hard blockers — so the pathological corpus can never
 * dispatch a delegate; it is used only where recorded findings or a blocked
 * run are the expectation.
 */
function largeCorpusFiles(pathologies: { dupId?: boolean; brokenRelation?: boolean }): Record<string, DocSpec> {
  const doc = (frontmatter: Record<string, unknown>, body: string): DocSpec => ({ frontmatter, body });
  const files: Record<string, DocSpec> = {};

  for (let index = 1; index <= 19; index += 1) {
    const n = pad(index);
    files[`docs/discovery/${n}-bulk.md`] = doc(
      { id: `DISC-${n}`, type: "discovery", status: "confirmed", title: `Discovery ${n}` },
      `# Discovery ${n}\n`,
    );
  }
  files["docs/discovery/0020-big.md"] = doc(
    { id: "DISC-0020", type: "discovery", status: "confirmed", title: "Oversized discovery" },
    `# Oversized discovery\n\n${"evidence line\n".repeat(4000)}`, // ≈56 KB body
  );

  for (let index = 1; index <= 11; index += 1) {
    const n = pad(100 + index);
    files[`docs/specs/${n}-bulk.md`] = doc(
      { id: `SPEC-B${n}`, type: "spec", status: "approved", title: `Bulk spec ${n}` },
      `# Bulk spec ${n}\n`,
    );
  }
  // en + ja siblings scan as DISTINCT records — no locale merging in the
  // artifact graph (verified against scanArtifactGraph).
  files["docs/specs/0100-pair.md"] = doc(
    { id: "SPEC-0100", type: "spec", status: "approved", title: "Pair spec" },
    "# Pair\n",
  );
  files["docs/specs/0100-pair.ja.md"] = doc(
    { id: "SPEC-0100-JA", type: "spec", status: "approved", title: "Pair spec (ja)" },
    "# Pair (ja)\n",
  );
  files["docs/specs/0300-cyc-a.md"] = doc(
    { id: "CYC-A", type: "spec", status: "approved", title: "Cycle A",
      relations: { "derives-from": ["CYC-B"] } },
    "# Cycle A\n",
  );
  files["docs/specs/0301-cyc-b.md"] = doc(
    { id: "CYC-B", type: "spec", status: "approved", title: "Cycle B",
      relations: { "derives-from": ["CYC-A"] } },
    "# Cycle B\n",
  );

  for (let index = 1; index <= 10; index += 1) {
    const n = pad(100 + index);
    files[`docs/adr/${n}-bulk.md`] = doc(
      { id: `ADR-B${n}`, type: "adr", status: "accepted", title: `Bulk ADR ${n}` },
      `# Bulk ADR ${n}\n\n## Considered Options\n\n### A\n`,
    );
  }
  // Path-form implements is required for task-graph membership; these tasks
  // bind PLAN-0002's chain, never PLAN-0001's.
  for (let index = 1; index <= 10; index += 1) {
    const n = pad(100 + index);
    files[`docs/tasks/${n}-bulk.md`] = doc(
      { id: `TASK-B${n}`, type: "task", status: "todo", title: `Bulk task ${n}`,
        relations: { implements: ["docs/plans/0002-other.md"] } },
      `# Bulk task ${n}\n`,
    );
  }
  for (let index = 1; index <= 5; index += 1) {
    const n = pad(100 + index);
    files[`docs/ideas/${n}-idea.md`] = doc(
      { id: `IDEA-B${n}`, type: "idea", status: "captured", title: `Idea ${n}` },
      `# Idea ${n}\n`,
    );
  }

  // PLAN-0001 references the en+ja pair so --metadata covers them as
  // typed-relation neighbors without disturbing the focus chain.
  files["docs/plans/0001-graph.md"] = doc(
    { id: "PLAN-0001", type: "plan", status: "approved", title: "Graph",
      relations: {
        "derives-from": ["DESIGN-0001"],
        "verified-by": ["docs/test-specs/0001-graph.md"],
        references: ["docs/specs/0100-pair.md", "docs/specs/0100-pair.ja.md"],
      } },
    "# Graph\n",
  );

  if (pathologies.dupId) {
    files["docs/specs/0200-dup-a.md"] = doc(
      { id: "DUP-PAIR", type: "spec", status: "approved", title: "Dup A" }, "# Dup A\n");
    files["docs/specs/0201-dup-b.md"] = doc(
      { id: "DUP-PAIR", type: "spec", status: "approved", title: "Dup B" }, "# Dup B\n");
  }
  if (pathologies.brokenRelation) {
    files["docs/specs/0400-broken.md"] = doc(
      { id: "SPEC-BROKEN", type: "spec", status: "approved", title: "Broken",
        relations: { "derives-from": ["GHOST-9999"] } },
      "# Broken\n",
    );
  }
  return files;
}

test("large corpus --metadata covers only the chain subset — ja siblings distinct, pathologies reported", () => {
  const repo = createFixtureRepo({
    secondPlan: true,
    files: largeCorpusFiles({ dupId: true, brokenRelation: true }),
  });
  const { status, report } = runCli(repo, ["--metadata", "--focus", "PLAN-0001"]);
  // Scan-level pathologies fail closed even though the focus chain resolves.
  assert.equal(status, 1);
  const found = findings(report);
  assert.ok(found.some((finding) => finding.code === "duplicate-id"));
  assert.ok(found.some((finding) => finding.code === "broken-relation"));

  const metadata = report.metadata as MetadataEntry[];
  const paths = metadata.map((entry) => entry.path);
  assert.deepEqual(paths, [...paths].sort((left, right) => left.localeCompare(right)));
  assert.deepEqual(new Set(paths), new Set([
    "docs/adr/0001-graph.md",
    "docs/designs/0001-graph.md",
    "docs/plans/0001-graph.md",
    "docs/specs/0001-graph.md",
    "docs/specs/0100-pair.ja.md", // en/ja siblings are distinct scanned records
    "docs/specs/0100-pair.md",
    "docs/tasks/0001-task.md",
    "docs/test-specs/0001-graph.md",
  ]));
  // None of the ~60 unrelated docs leak into the chain view.
  assert.ok(paths.every((p) => !p.includes("-bulk")
    && !p.includes("cyc-") && !p.includes("dup-") && !p.includes("broken")
    && !p.startsWith("docs/discovery/") && !p.startsWith("docs/ideas/")));
  const pair = metadata.find((entry) => entry.path === "docs/specs/0100-pair.md");
  const pairJa = metadata.find((entry) => entry.path === "docs/specs/0100-pair.ja.md");
  assert.equal(pair?.id, "SPEC-0100");
  assert.equal(pairJa?.id, "SPEC-0100-JA");
  assertNoKeys(report, ["body", "absolutePath"], "report");
});

test("large corpus --expand stays scoped: lineage-only traversal, cycle deduped at depth", () => {
  const repo = createFixtureRepo({
    secondPlan: true,
    files: largeCorpusFiles({ dupId: true, brokenRelation: true }),
  });
  // Non-lineage relations (verified-by, references) are not traversed, so the
  // expansion touches only the lineage neighborhood — not the other ~70 docs.
  const fromPlan = runCli(repo, ["--expand", "docs/plans/0001-graph.md", "--depth", "1"]);
  assert.equal(fromPlan.status, 0, fromPlan.stderr);
  assert.deepEqual(fromPlan.report.nodes as ExpandNode[], [
    { path: "docs/plans/0001-graph.md", id: "PLAN-0001", depth: 0, via: null },
    { path: "docs/designs/0001-graph.md", id: "DESIGN-0001", depth: 1, via: "derives-from" },
  ]);
  // The dup/broken pathology records sit outside the cycle's neighborhood, so
  // traversal reports no findings and exits cleanly.
  const cycle = runCli(repo, ["--expand", "CYC-A", "--depth", "5"]);
  assert.equal(cycle.status, 0, cycle.stderr);
  assert.deepEqual(cycle.report.nodes as ExpandNode[], [
    { path: "docs/specs/0300-cyc-a.md", id: "CYC-A", depth: 0, via: null },
    { path: "docs/specs/0301-cyc-b.md", id: "CYC-B", depth: 1, via: "derives-from" },
  ]);
  assert.deepEqual(findings(cycle.report), []);
});

test("large corpus re-projection after mutation is deterministic — stale refused, fresh fetched", () => {
  const repo = createFixtureRepo({
    secondPlan: true,
    files: largeCorpusFiles({ dupId: true, brokenRelation: true }),
  });
  const target = "docs/discovery/0020-big.md";
  const before = canonicalReference(repo, target);
  const first = runCli(repo, ["--fetch", target, "--fingerprint", `${target}:${before.fingerprint}`]);
  assert.equal(first.status, 0, first.stderr);
  // Same corpus + same ref → byte-identical output (deterministic retrieval).
  const repeat = runCli(repo, ["--fetch", target, "--fingerprint", `${target}:${before.fingerprint}`]);
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(repeat.stdout, first.stdout);

  updateArtifact(repo, target, { title: "Oversized discovery v2" });
  const after = canonicalReference(repo, target);
  assert.notEqual(after.fingerprint, before.fingerprint,
    "mutation must change the canonical fingerprint deterministically");

  const stale = runCli(repo, ["--fetch", target, "--fingerprint", `${target}:${before.fingerprint}`]);
  assert.equal(stale.status, 1);
  assert.ok(findings(stale.report).some((finding) => finding.code === "stale-fingerprint"
    && finding.path === target));

  const fresh = runCli(repo, ["--fetch", target, "--fingerprint", `${target}:${after.fingerprint}`]);
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.equal((fresh.report.documents as FetchDocument[])[0].id, "DISC-0020");
});

// --- Step 2 continued: baseline separation through the real e2e runner ---------

const HAPPY_SEQUENCE = [
  "probe-to-briefing", "briefing-to-design", "design-to-planning",
  "planning-to-task-graph", "task-graph-to-implementation",
  "implementation-to-followup-triage", "followup-triage-terminal",
  "exit-audit-to-complete",
];

test("runCase baseline: 60-doc corpus scan dwarfs the dispatched delegate inputs", { timeout: 120_000 }, () => {
  const e2eCase: E2ECase = {
    id: "fetch-context-large-corpus-baseline",
    description: "happy path over ~70 canonical docs — scan vs delegate-input read separation",
    fixture: {
      taskStatuses: ["todo"],
      secondPlan: true,
      // Clean variant: dup-id/broken-relation are router hard blockers, so the
      // dispatched-delegate baseline requires the pathology-free corpus.
      files: largeCorpusFiles({}),
    },
    focus: ["PLAN-0001"],
    signals: ["implementation-verified", "followup-terminal", "exit-audit-pass"],
    script: case01.script,
    expect: {
      yield: "terminal",
      edgeSequence: [...HAPPY_SEQUENCE, null],
      completedEdges: HAPPY_SEQUENCE,
      finalFiles: { "docs/tasks/0001-task.md": { frontmatter: { status: "done" } } },
    },
  };
  const { run, report } = runCase(e2eCase);
  assert.deepEqual(report.failures, []);
  const baseline = run.baseline;
  assert.ok(baseline, "run.baseline missing");

  // Each routing hop re-reads the whole canonical corpus (~67 records); the
  // delegate-input channel only ever carries the small focus-chain set.
  assert.ok(report.traceSummary.uniqueFilesMax >= 60,
    `expected a hop's scan to cover ≥60 unique files, got ${report.traceSummary.uniqueFilesMax}`);
  assert.ok(baseline.scan.files >= 50, `expected scan.files ≥ 50, got ${baseline.scan.files}`);
  assert.equal(baseline.scan.files, report.traceSummary.filesRead);
  assert.equal(baseline.scan.bytes, report.traceSummary.bytesRead);
  assert.ok(baseline.delegateInputs.files > 0,
    "delegates must actually dispatch — an empty input set would prove nothing");
  assert.ok(baseline.delegateInputs.files <= 10,
    `expected delegateInputs.files ≤ 10, got ${baseline.delegateInputs.files}`);
  assert.ok(baseline.ratio < 0.5, `expected ratio < 0.5, got ${baseline.ratio}`);

  // Whole-repo audits keep their scope (issue acceptance #5): the exit
  // audit's `all` audit still receives every canonical doc path.
  const allAudit = run.traceEvents.find((event) =>
    event.kind === "effect-dispatched" && event.effectId === "all");
  assert.ok(allAudit && allAudit.kind === "effect-dispatched", "the `all` audit must still dispatch");
  assert.ok(allAudit.focusPaths.length >= 7,
    `expected the \`all\` audit to carry ≥7 canonical inputs, got ${allAudit.focusPaths.length}`);
});

test("runCase fail-closed at scale: an unresolved reference blocks the run before any dispatch", { timeout: 120_000 }, () => {
  const e2eCase: E2ECase = {
    id: "fetch-context-large-corpus-fail-closed",
    description: "broken relation in a ~70-doc corpus → blocked route, zero dispatches",
    fixture: {
      taskStatuses: ["todo"],
      secondPlan: true,
      files: largeCorpusFiles({ brokenRelation: true }),
    },
    focus: ["PLAN-0001"],
    signals: ["implementation-verified", "followup-terminal", "exit-audit-pass"],
    script: case01.script,
    expect: {
      yield: "unrecoverable-blocker",
      edgeSequence: [null],
      completedEdges: [],
      blockersContain: [/^broken-relation:sha256:[0-9a-f]{12}$/],
      events: [{ kind: "effect-dispatched", count: 0 }],
    },
  };
  const { run, report } = runCase(e2eCase);
  assert.deepEqual(report.failures, []);
  const baseline = run.baseline;
  assert.ok(baseline, "run.baseline missing");
  // The scan still measured the whole corpus; no delegate body was fetched.
  assert.ok(baseline.scan.files >= 50, `expected scan.files ≥ 50, got ${baseline.scan.files}`);
  assert.equal(baseline.delegateInputs.files, 0);
  assert.equal(baseline.ratio, 0);
});
