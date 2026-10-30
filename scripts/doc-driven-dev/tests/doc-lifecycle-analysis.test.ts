import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createFixtureRepo } from "./e2e/harness/fixture_manager";
import { benchmarkCorpusFiles, longRunningCorpusFiles } from "./fixtures/doc-lifecycle/corpora";
import { analyzeCorpus } from "../src/skills/lib/lifecycle_stats";

/**
 * Issue #127 — document-lifecycle cost analysis.
 *
 * Guards the deterministic measurement tool (`src/skills/lib/lifecycle_stats.ts`)
 * and the committed per-corpus stats fixtures in
 * `tests/fixtures/doc-lifecycle/stats-*.json`. The tool consumes the existing
 * doc-status pipeline (repository model + findings + health) rather than
 * re-implementing diagnostics, so these tests pin the projection shape, the
 * byte-identical determinism, and the measured debt signals of each corpus.
 *
 * Regenerate fixtures after intentional corpus/contract changes with:
 *   mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx tests/fixtures/doc-lifecycle/write_stats.ts
 */

const FIXTURE_DIR = path.join(__dirname, "fixtures", "doc-lifecycle");

function smallRepo(): string {
  return createFixtureRepo({});
}
function benchmarkRepo(): string {
  return createFixtureRepo({ secondPlan: true, files: benchmarkCorpusFiles({}) });
}
function longRunningRepo(): string {
  return createFixtureRepo({ files: longRunningCorpusFiles() });
}

const CORPORA: Array<[label: string, build: () => string]> = [
  ["small", smallRepo],
  ["benchmark", benchmarkRepo],
  ["long-running", longRunningRepo],
];

test("stats output matches committed fixtures byte-for-byte", async () => {
  for (const [label, build] of CORPORA) {
    const stats = await analyzeCorpus(build(), { label });
    const fixture = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, `stats-${label}.json`), "utf8"),
    );
    assert.deepEqual(stats, fixture, `${label} corpus stats drifted — regenerate fixtures via write_stats.ts`);
  }
});

test("repeated analysis is byte-identical on the same corpus", async () => {
  const repo = longRunningRepo();
  const first = JSON.stringify(await analyzeCorpus(repo, { label: "long-running" }), null, 2);
  const second = JSON.stringify(await analyzeCorpus(repo, { label: "long-running" }), null, 2);
  assert.equal(first, second);
});

test("shape contract — sorted buckets, consistent counts", async () => {
  const stats = await analyzeCorpus(smallRepo(), { label: "small" });
  assert.equal(stats.tool, "doc-lifecycle-stats/1");

  const names = Object.keys(stats.types);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));

  const fileSum = Object.values(stats.types).reduce((sum, type) => sum + type.files, 0);
  assert.equal(fileSum, stats.corpus.documents);
  assert.equal(stats.corpus.documents, stats.corpus.canonicalDocuments + stats.corpus.unmanagedDocuments);

  for (const [name, type] of Object.entries(stats.types)) {
    const statusSum = Object.values(type.statusCounts).reduce((sum, count) => sum + count, 0);
    assert.equal(statusSum, type.files, `${name} status distribution does not sum to files`);
    assert.equal(type.settled + type.inFlight, type.files, `${name} settled/in-flight does not sum to files`);
    const declared = type.relations;
    assert.equal(
      declared.declared,
      declared.resolved + declared.resolvedFile + declared.ambiguous
        + declared.unresolved + declared.escaped + declared.external,
      `${name} relation resolution counts do not sum to declared`,
    );
  }
});

test("small corpus is the standard chain — minimal, mostly in-flight", async () => {
  const stats = await analyzeCorpus(smallRepo(), { label: "small" });
  assert.equal(stats.corpus.documents, 7);
  assert.equal(stats.corpus.duplicateIdGroups, 0);
  assert.ok(stats.corpus.inFlightDocuments >= 6);
  assert.ok(stats.types.task.files >= 1);
  assert.ok(stats.types.impl.files >= 1);
});

test("benchmark corpus keeps #124 scale and records its pre-contract debt", async () => {
  const stats = await analyzeCorpus(benchmarkRepo(), { label: "benchmark" });
  // ~70 canonical records: standard chain + second plan + ~60 bulk docs.
  assert.ok(stats.corpus.canonicalDocuments >= 60, `canonical docs ${stats.corpus.canonicalDocuments}`);
  assert.ok(stats.types.discovery.files >= 20);
  assert.ok(stats.types.spec.files >= 15);
  assert.ok(stats.types.task.files >= 10);
  // The benchmark deliberately keeps pre-contract spellings; doc-status must
  // surface them so the report can separate corpus debt from lifecycle debt.
  // (`CAPS-<alnum>` ids are reported as invalid-id-prefix by doc_lint.)
  const invalidIds = (stats.findings.byRuleId["invalid-id-prefix"] ?? 0)
    + (stats.findings.byRuleId["invalid-id-format"] ?? 0);
  assert.ok(invalidIds >= 30, `invalid ids ${invalidIds}`);
  assert.ok((stats.findings.byRuleId["invalid-status"] ?? 0) >= 10);
  assert.ok((stats.findings.byRuleId["provenance-missing-source"] ?? 0) >= 19);
  // A derives-from cycle and a broken relation are measured, not hidden.
  assert.ok(stats.relations.byField["derives-from"].declared >= 4);
});

test("long-running corpus is mostly settled evidence with layered debt", async () => {
  const stats = await analyzeCorpus(longRunningRepo(), { label: "long-running" });

  assert.ok(stats.corpus.documents >= 80, `documents ${stats.corpus.documents}`);
  assert.equal(stats.corpus.duplicateIdGroups, 0);
  assert.deepEqual(stats.corpus.missingTypes, []);

  // Majority historical: completed chains 01–05 alone contribute ~40 settled.
  assert.ok(stats.corpus.settledDocuments >= 40, `settled ${stats.corpus.settledDocuments}`);
  assert.ok(stats.corpus.settledDocuments > stats.corpus.inFlightDocuments);

  // Stale upstreams: 2 todo tasks on completed PLAN-0501 + DESIGN-0501 on
  // superseded SPEC-0501/deprecated ADR-0501.
  assert.ok(stats.corpus.staleUpstreamDocuments >= 3, `staleUpstream ${stats.corpus.staleUpstreamDocuments}`);
  assert.ok(stats.types.task.staleUpstream >= 2);
  assert.ok(stats.types.design.staleUpstream >= 1);
  // Issue #166: the promoted doc-status rule surfaces the same edges as
  // findings — one `stale-upstream` finding per dead upstream target
  // (DESIGN-0501 has two: SPEC-0501 + ADR-0501; TASK-0503/0504 one each).
  assert.ok((stats.findings.byRuleId["stale-upstream"] ?? 0) >= 4,
    `stale-upstream findings ${stats.findings.byRuleId["stale-upstream"]}`);

  // Status distributions show lifecycle stages, not a single state.
  assert.ok((stats.types.task.statusCounts.done ?? 0) >= 10);
  assert.ok((stats.types.task.statusCounts.todo ?? 0) >= 3);
  assert.ok((stats.types.plan.statusCounts.completed ?? 0) >= 5);
  assert.ok((stats.types.spec.statusCounts.superseded ?? 0) >= 1);
  assert.ok((stats.types.idea.statusCounts.draft ?? 0) >= 5);

  // Debt the stats must surface: orphans, index drift, broken relation,
  // provenance gaps, one unmanaged doc, one localized sibling.
  assert.ok(stats.types.idea.orphanRelation >= 8, `idea orphans ${stats.types.idea.orphanRelation}`);
  assert.ok((stats.findings.byRuleId["index-stale-entry"] ?? 0) >= 1);
  assert.ok((stats.findings.byRuleId["index-metadata-mismatch"] ?? 0) >= 1);
  assert.ok((stats.findings.byRuleId["index-missing-entry"] ?? 0) >= 3);
  assert.ok((stats.findings.byRuleId["orphan-index"] ?? 0) >= 3);
  assert.ok((stats.findings.byRuleId["broken-relation-link"] ?? 0) >= 1);
  assert.ok((stats.findings.byRuleId["provenance-missing-source"] ?? 0) >= 1);
  assert.ok((stats.findings.byRuleId["provenance-unresolved-local-source"] ?? 0) >= 1);
  assert.ok(stats.types.unmanaged.files >= 1);
  assert.ok(stats.types.spec.localizedFiles >= 1);
  assert.ok(stats.types.impl.files >= 12);
  assert.ok((stats.types.impl.statusCounts.completed ?? 0) >= 10);
  assert.ok((stats.types.impl.statusCounts.superseded ?? 0) >= 1);

  // Relation traffic concentrates on lineage fields — the graph spine.
  const lineage = ["implements", "derives-from", "refines"];
  const lineageDeclared = lineage.reduce(
    (sum, field) => sum + (stats.relations.byField[field]?.declared ?? 0), 0);
  assert.ok(lineageDeclared >= stats.relations.declared * 0.5);

  // Health categories reuse the doc-status report verbatim — only categories
  // with findings appear, matching `doc_status health` semantics.
  const categories = stats.findings.health.categories.map((entry) => entry.category);
  for (const category of ["relation", "traceability", "provenance", "index", "orphan"]) {
    assert.ok(categories.includes(category), `health category ${category} missing`);
  }
});
