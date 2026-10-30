import type { DocSpec } from "../../e2e/harness/fixture_manager";
import { isSettledStatus } from "../../../src/skills/lib/doc_lifecycle";

/**
 * Document-corpus builders for the Issue #127 lifecycle analysis.
 *
 * `benchmarkCorpusFiles` is the ~70-record corpus originally built for the
 * Issue #124 progressive-retrieval baseline (moved here verbatim so the
 * lifecycle analysis measures the same benchmark, not a second corpus).
 * `longRunningCorpusFiles` synthesizes a "project that ran for a while":
 * several completed feature chains with settled statuses, stale tasks left
 * behind on completed plans, superseded upstreams, orphaned drafts, a broken
 * relation, a localized sibling, and realistic generated indexes carrying
 * their own drift (stale row, metadata mismatch, uncovered orphans).
 *
 * Both return `files` maps for `createFixtureRepo` — front matter uses the
 * harness's fixed dates, so every byte count is deterministic.
 */

const pad = (value: number): string => String(value).padStart(4, "0");

/**
 * The #124 Task-5 large corpus: the standard chain plus ~60 extra canonical
 * docs — 20 discovery (one ≥50KB body so scan bytes dominate), 15 specs
 * (11 bulk + an en/ja sibling pair + an a↔b derives-from cycle), 10 ADRs,
 * 10 tasks bound to PLAN-0002 (a second chain), 5 idea docs.
 *
 * Its ids/statuses intentionally keep the benchmark's pre-contract spellings
 * (`SPEC-B0101`, `status: "confirmed"`) — doc-status surfaces those as
 * invalid-id-format / invalid-status findings, which the lifecycle stats
 * record faithfully as benchmark-debt.
 *
 * `pathologies` adds the dup-ID pair and the broken relation. Both are
 * scan-level `duplicate-id`/`broken-relation` issues — which graph_state
 * promotes to ROUTER hard blockers — so the pathological corpus can never
 * dispatch a delegate; it is used only where recorded findings or a blocked
 * run are the expectation.
 */
export function benchmarkCorpusFiles(pathologies: { dupId?: boolean; brokenRelation?: boolean }): Record<string, DocSpec> {
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

// ---------------------------------------------------------------------------
// Long-running project corpus
// ---------------------------------------------------------------------------

/**
 * `type`/`docStatus` describe the *document's* real lifecycle coordinates;
 * `status` is the cell text actually written into the row. Keeping them
 * separate lets the fixture plant a stale row (TASK-0101 shows `todo` while
 * the doc is `done`) that still sorts into the tier a faithful regeneration
 * would place the document in — matching `renderIndexBody`.
 */
type IndexRow = {
  id: string;
  title: string;
  status: string;
  file: string;
  type?: string;
  docStatus?: string;
};

/**
 * A generated-style index (`doc-suite:generated-index` marker + status-aware
 * two-tier table), matching `writeGeneratedIndex`/`renderIndexBody` output
 * shape: in-flight rows first, then a `## Settled` tier, each file-lexical
 * (overview.md first for designs). Rows must carry the doc's real
 * id/title/status or doc-status reports `index-metadata-mismatch`.
 */
function indexReadme(dir: string, title: string, rows: IndexRow[], extra = ""): string {
  const header = "| ID | Title | Status | File |\n| --- | --- | --- | --- |";
  const compare = (a: IndexRow, b: IndexRow): number => {
    if (dir === "docs/designs") {
      if (a.file === "overview.md") return -1;
      if (b.file === "overview.md") return 1;
    }
    return a.file.localeCompare(b.file);
  };
  const settled = (row: IndexRow): boolean =>
    isSettledStatus(row.type ?? "untyped", row.docStatus ?? row.status);
  const line = (row: IndexRow): string =>
    `| ${row.id} | ${row.title} | ${row.status} | [${row.file}](./${row.file}) |`;
  const active = rows.filter((row) => !settled(row)).sort(compare);
  const settledRows = rows.filter(settled).sort(compare);
  const body = `${header}\n${active.map(line).join("\n")}`
    + (settledRows.length > 0
      ? `\n\n## Settled <!-- doc-suite:settled-index -->\n\n${header}\n${settledRows.map(line).join("\n")}`
      : "");
  return `# ${title}\n\n<!-- doc-suite:generated-index -->\n\nDirectory: \`${dir}\`\n\n${body}\n${extra}`;
}

/**
 * A "long-running project" corpus: ~100 canonical docs across seven feature
 * chains at different lifecycle stages plus accumulated debt.
 *
 * All ids keep the contract shape (`<PREFIX>-<digits>`) so the only findings
 * are the intended lifecycle debt:
 * - Chains 01–04 completed end to end (resolved discovery → implemented spec
 *   → accepted ADR → approved design → completed plan → approved test-spec →
 *   done tasks → completed Implementation Records).
 * - Chain 05 is the supersession chain: SPEC-0501 was replaced by SPEC-0502
 *   but DESIGN-0501 still derives from the superseded spec and two tasks are
 *   still `todo` on the completed plan (stale-upstream signals).
 * - Chain 06 is mid-flight (plan in-progress, mixed task statuses, one
 *   in-progress IR). Chain 07 stalled early (design still draft, no plan).
 * - Debt: 8 un-promoted ideas, 2 brainstorms, 3 orphan discoveries (one
 *   missing `relations.source`, one unresolved local source), a spec with a
 *   broken `derives-from`, a blocked + a superseded plan, index drift (stale
 *   entry, metadata mismatch, uncovered orphan discoveries), an unmanaged
 *   doc, a ja locale sibling, and 2 experiment `.jsonl` logs (not Markdown —
 *   outside the document scan entirely).
 */
export function longRunningCorpusFiles(): Record<string, DocSpec | string> {
  const doc = (frontmatter: Record<string, unknown>, body: string): DocSpec => ({ frontmatter, body });
  const files: Record<string, DocSpec | string> = {};
  const indexRows: Record<string, IndexRow[]> = {};
  const addRow = (dir: string, row: IndexRow): void => {
    (indexRows[dir] ??= []).push(row);
  };
  const put = (dir: string, rel: string, frontmatter: Record<string, unknown>, body: string): void => {
    files[`${dir}/${rel}`] = doc(frontmatter, body);
    addRow(dir, {
      id: String(frontmatter.id), title: String(frontmatter.title),
      status: String(frontmatter.status), file: rel, type: String(frontmatter.type),
    });
  };

  const specBody = (name: string): string =>
    `# ${name}\n\n## Why Now\n\nReason.\n\n## Users and Value\n\nValue.\n\n## Acceptance Criteria\n\n- [ ] criterion\n`;
  const adrBody = (name: string): string =>
    `# ${name}\n\n## Considered Options\n\n### Option A\n\n### Option B\n`;

  // ── Chains 01–04: completed end to end ───────────────────────────────────
  for (let chain = 1; chain <= 4; chain += 1) {
    const chainId = `0${chain}01`;
    put("docs/discovery", `0${chain}01-discovery.md`,
      { id: `DISC-${chainId}`, type: "discovery", status: "resolved", title: `Discovery ${chainId}`,
        relations: {
          source: [`https://example.com/research/${chainId}`],
          "derived-by": [`SPEC-${chainId}`, `ADR-${chainId}`],
        } },
      chain === 1
        ? `# Discovery ${chainId}\n\n${"evidence row\n".repeat(3000)}` // ≈36 KB — the fat tail
        : `# Discovery ${chainId}\n`);
    put("docs/specs", `0${chain}01-spec.md`,
      { id: `SPEC-${chainId}`, type: "spec", status: "implemented", title: `Spec ${chainId}`,
        relations: { "derives-from": [`DISC-${chainId}`] } },
      specBody(`Spec ${chainId}`));
    put("docs/adr", `0${chain}01-adr.md`,
      { id: `ADR-${chainId}`, type: "adr", status: "accepted", title: `ADR ${chainId}`,
        relations: { "derives-from": [`DISC-${chainId}`] } },
      adrBody(`ADR ${chainId}`));
    put("docs/designs", `0${chain}01-design.md`,
      { id: `DESIGN-${chainId}`, type: "design", status: "approved", title: `Design ${chainId}`,
        relations: { "derives-from": [`SPEC-${chainId}`, `ADR-${chainId}`] } },
      `# Design ${chainId}\n`);
    put("docs/plans", `0${chain}01-plan.md`,
      { id: `PLAN-${chainId}`, type: "plan", status: "completed", title: `Plan ${chainId}`,
        relations: {
          "derives-from": [`DESIGN-${chainId}`],
          "verified-by": [`docs/test-specs/0${chain}01-tspec.md`],
        } },
      `# Plan ${chainId}\n`);
    put("docs/test-specs", `0${chain}01-tspec.md`,
      { id: `TSPEC-${chainId}`, type: "test-spec", status: chain === 4 ? "deprecated" : "approved",
        title: `Test spec ${chainId}`, relations: { verifies: [`SPEC-${chainId}`] } },
      `# Test spec ${chainId}\n`);

    const taskStatuses = chain === 2
      ? ["done", "done", "done", "wont-do"]
      : ["done", "done", "done"];
    taskStatuses.forEach((status, index) => {
      const taskId = `0${chain}0${index + 1}`;
      put("docs/tasks", `${taskId}-task.md`,
        { id: `TASK-${taskId}`, type: "task", status, title: `Task ${taskId}`,
          relations: { implements: [`docs/plans/0${chain}01-plan.md`] } },
        `# Task ${taskId}\n\n## Verification\n\n- [ ] node --test\n`);
      if (status === "done") {
        put("docs/impl/ir", `${taskId}-ir.md`,
          { id: `IMPL-${taskId}`, type: "impl", status: "completed", title: `IR ${taskId}`,
            metadata: { task: `docs/tasks/${taskId}-task.md` },
            relations: { implements: [`docs/tasks/${taskId}-task.md`] } },
          `# Implementation Record ${taskId}\n\nTask: [${taskId}](../../tasks/${taskId}-task.md).\n`);
      }
    });
  }

  // ja locale sibling of the implemented chain-02 spec — shares the logical
  // artifact identity (same stem, same id), scanned as a second file.
  put("docs/specs", "0201-spec.ja.md",
    { id: "SPEC-0201", type: "spec", status: "implemented", title: "Spec 0201 (ja)",
      relations: { "derives-from": ["DISC-0201"] } },
    "# Spec 0201 (ja)\n");

  // ── Chain 05: supersession + stale tasks on a completed plan ─────────────
  put("docs/discovery", "0501-discovery.md",
    { id: "DISC-0501", type: "discovery", status: "resolved", title: "Discovery 0501",
      relations: { source: ["https://example.com/research/0501"], "derived-by": ["SPEC-0501", "ADR-0501"] } },
    "# Discovery 0501\n");
  put("docs/specs", "0501-spec.md",
    { id: "SPEC-0501", type: "spec", status: "superseded", title: "Spec 0501",
      relations: { "derives-from": ["DISC-0501"], "superseded-by": ["SPEC-0502"] } },
    specBody("Spec 0501"));
  put("docs/specs", "0502-spec.md",
    { id: "SPEC-0502", type: "spec", status: "implemented", title: "Spec 0502",
      relations: { "derives-from": ["DISC-0501"], supersedes: ["SPEC-0501"] } },
    specBody("Spec 0502"));
  put("docs/adr", "0501-adr.md",
    { id: "ADR-0501", type: "adr", status: "deprecated", title: "ADR 0501",
      relations: { "derives-from": ["DISC-0501"] } },
    adrBody("ADR 0501"));
  // The design was never re-pointed at SPEC-0502 — a stale upstream edge.
  put("docs/designs", "0501-design.md",
    { id: "DESIGN-0501", type: "design", status: "approved", title: "Design 0501",
      relations: { "derives-from": ["SPEC-0501", "ADR-0501"] } },
    "# Design 0501\n");
  put("docs/plans", "0501-plan.md",
    { id: "PLAN-0501", type: "plan", status: "completed", title: "Plan 0501",
      relations: { "derives-from": ["DESIGN-0501"], "verified-by": ["docs/test-specs/0501-tspec.md"] } },
    "# Plan 0501\n");
  put("docs/test-specs", "0501-tspec.md",
    { id: "TSPEC-0501", type: "test-spec", status: "approved", title: "Test spec 0501",
      relations: { verifies: ["SPEC-0502"] } },
    "# Test spec 0501\n");
  const chain05Tasks: Array<[string, boolean]> = [
    ["done", true], ["done", true], ["todo", false], ["todo", false], ["wont-do", false],
  ];
  chain05Tasks.forEach(([status, hasIr], index) => {
    const taskId = `050${index + 1}`;
    put("docs/tasks", `${taskId}-task.md`,
      { id: `TASK-${taskId}`, type: "task", status, title: `Task ${taskId}`,
        relations: { implements: ["docs/plans/0501-plan.md"] } },
      `# Task ${taskId}\n\n## Verification\n\n- [ ] node --test\n`);
    if (hasIr) {
      put("docs/impl/ir", `${taskId}-ir.md`,
        { id: `IMPL-${taskId}`, type: "impl", status: "completed", title: `IR ${taskId}`,
          metadata: { task: `docs/tasks/${taskId}-task.md` },
          relations: { implements: [`docs/tasks/${taskId}-task.md`] } },
        `# Implementation Record ${taskId}\n\nTask: [${taskId}](../../tasks/${taskId}-task.md).\n`);
    }
  });

  // ── Chain 06: mid-flight ─────────────────────────────────────────────────
  put("docs/discovery", "0601-discovery.md",
    { id: "DISC-0601", type: "discovery", status: "active", title: "Discovery 0601",
      relations: { source: ["https://example.com/research/0601"], "derived-by": ["SPEC-0601", "ADR-0601"] } },
    "# Discovery 0601\n");
  put("docs/specs", "0601-spec.md",
    { id: "SPEC-0601", type: "spec", status: "approved", title: "Spec 0601",
      relations: { "derives-from": ["DISC-0601"] } },
    specBody("Spec 0601"));
  put("docs/adr", "0601-adr.md",
    { id: "ADR-0601", type: "adr", status: "proposed", title: "ADR 0601",
      relations: { "derives-from": ["DISC-0601"] } },
    adrBody("ADR 0601"));
  put("docs/designs", "0601-design.md",
    { id: "DESIGN-0601", type: "design", status: "approved", title: "Design 0601",
      relations: { "derives-from": ["SPEC-0601", "ADR-0601"] } },
      "# Design 0601\n");
  put("docs/plans", "0601-plan.md",
    { id: "PLAN-0601", type: "plan", status: "in-progress", title: "Plan 0601",
      relations: { "derives-from": ["DESIGN-0601"], "verified-by": ["docs/test-specs/0601-tspec.md"] } },
    "# Plan 0601\n");
  put("docs/test-specs", "0601-tspec.md",
    { id: "TSPEC-0601", type: "test-spec", status: "draft", title: "Test spec 0601",
      relations: { verifies: ["SPEC-0601"] } },
    "# Test spec 0601\n");
  const chain06Tasks: Array<[string, string | null]> = [
    ["done", "completed"], ["in-progress", "in-progress"], ["blocked", null], ["todo", null],
  ];
  chain06Tasks.forEach(([status, irStatus], index) => {
    const taskId = `060${index + 1}`;
    put("docs/tasks", `${taskId}-task.md`,
      { id: `TASK-${taskId}`, type: "task", status, title: `Task ${taskId}`,
        relations: { implements: ["docs/plans/0601-plan.md"] } },
      `# Task ${taskId}\n\n## Verification\n\n- [ ] node --test\n`);
    if (irStatus) {
      put("docs/impl/ir", `${taskId}-ir.md`,
        { id: `IMPL-${taskId}`, type: "impl", status: irStatus, title: `IR ${taskId}`,
          metadata: { task: `docs/tasks/${taskId}-task.md` },
          relations: { implements: [`docs/tasks/${taskId}-task.md`] } },
        `# Implementation Record ${taskId}\n\nTask: [${taskId}](../../tasks/${taskId}-task.md).\n`);
    }
  });

  // ── Chain 07: stalled early (design never approved, no plan) ─────────────
  put("docs/discovery", "0701-discovery.md",
    { id: "DISC-0701", type: "discovery", status: "resolved", title: "Discovery 0701",
      relations: { source: ["docs/misc/legacy-notes.md"], "derived-by": ["SPEC-0701", "ADR-0701"] } },
    "# Discovery 0701\n");
  put("docs/specs", "0701-spec.md",
    { id: "SPEC-0701", type: "spec", status: "approved", title: "Spec 0701",
      relations: { "derives-from": ["DISC-0701"] } },
    specBody("Spec 0701"));
  put("docs/adr", "0701-adr.md",
    { id: "ADR-0701", type: "adr", status: "accepted", title: "ADR 0701",
      relations: { "derives-from": ["DISC-0701"] } },
    adrBody("ADR 0701"));
  put("docs/designs", "0701-design.md",
    { id: "DESIGN-0701", type: "design", status: "draft", title: "Design 0701",
      relations: { "derives-from": ["SPEC-0701", "ADR-0701"] } },
    "# Design 0701\n");

  // ── Orphaned captures: never promoted, never related ─────────────────────
  const ideaStatuses = ["draft", "draft", "draft", "draft", "draft", "parked", "parked", "archived"];
  ideaStatuses.forEach((status, index) => {
    put("docs/ideas", `90${pad(index + 1).slice(2)}-idea.md`,
      { id: `IDEA-90${pad(index + 1).slice(2)}`, type: "idea", status, title: `Orphan idea ${index + 1}` },
      `# Orphan idea ${index + 1}\n`);
  });
  put("docs/discovery", "9101-brainstorm.md",
    { id: "BRAINSTORM-9101", type: "brainstorm", status: "capturing", title: "Brainstorm 9101" },
    "# Brainstorm 9101\n");
  put("docs/discovery", "9102-brainstorm.md",
    { id: "BRAINSTORM-9102", type: "brainstorm", status: "confirmed", title: "Brainstorm 9102" },
    "# Brainstorm 9102\n");

  // Orphan discoveries — 9103 deliberately has no source evidence, 9104's
  // local source path does not resolve (accumulated provenance debt).
  files["docs/discovery/9103-no-source.md"] = doc(
    { id: "DISC-9103", type: "discovery", status: "draft", title: "Discovery 9103" },
    "# Discovery 9103\n",
  );
  files["docs/discovery/9104-bad-source.md"] = doc(
    { id: "DISC-9104", type: "discovery", status: "draft", title: "Discovery 9104",
      relations: { source: ["docs/misc/missing-source.md"] } },
    "# Discovery 9104\n",
  );
  files["docs/discovery/9105-lone.md"] = doc(
    { id: "DISC-9105", type: "discovery", status: "draft", title: "Discovery 9105",
      relations: { source: ["https://example.com/note"] } },
    "# Discovery 9105\n",
  );

  // ── Isolated debt ────────────────────────────────────────────────────────
  put("docs/specs", "9201-broken.md",
    { id: "SPEC-9201", type: "spec", status: "proposed", title: "Spec 9201",
      relations: { "derives-from": ["DISC-9999"] } },
    specBody("Spec 9201"));
  put("docs/plans", "9301-blocked.md",
    { id: "PLAN-9301", type: "plan", status: "blocked", title: "Plan 9301",
      relations: { "derives-from": ["DESIGN-0701"], "test-spec-skip": "deferred" } },
    "# Plan 9301\n");
  files["docs/plans/9302-dead.md"] = doc(
    { id: "PLAN-9302", type: "plan", status: "superseded", title: "Plan 9302" },
    "# Plan 9302\n",
  );

  // Superseded Implementation Record (record was re-cut under a new id).
  put("docs/impl/ir", "9901-replaced.md",
    { id: "IMPL-9901", type: "impl", status: "superseded", title: "IR 9901",
      metadata: { task: "docs/tasks/0501-task.md" } },
    "# IR 9901\n");

  // Unmanaged document outside the canonical dirs — scanned but outside the
  // contract scopes (its broken link below is never linted).
  files["docs/misc/legacy-notes.md"] =
    "# Legacy notes\n\nSee [old doc](./old-doc.md) for context.\n";

  // Experiment logs are JSONL, not Markdown — outside the document scan.
  files["docs/impl/exp/0001-spike.jsonl"] =
    '{"event":"start","title":"Spike cache layer"}\n{"event":"end","result":"kept"}\n';
  files["docs/impl/exp/0002-spike.jsonl"] =
    '{"event":"start","title":"Spike retry policy"}\n{"event":"end","result":"rejected"}\n';

  // ── Indexes ──────────────────────────────────────────────────────────────
  // Generated-style READMEs listing the docs written above. Deliberate drift:
  // - tasks index still lists TASK-0101 as "todo" (the doc is done) —
  //   one index-metadata-mismatch, the classic stale-row symptom.
  // - specs index retains a row for a deleted file (index-stale-entry).
  // - discovery index omits the 9103/9104/9105 orphans (index-missing-entry +
  //   orphan-index for each).
  //
  // The default createFixtureRepo chain (0001-*) lives in the same dirs, so
  // the generated-style indexes must list it too.
  const defaultChainRows: Record<string, IndexRow[]> = {
    "docs/specs": [{ id: "SPEC-0001", title: "Graph", status: "approved", file: "0001-graph.md", type: "spec" }],
    "docs/adr": [{ id: "ADR-0001", title: "Graph", status: "accepted", file: "0001-graph.md", type: "adr" }],
    "docs/designs": [{ id: "DESIGN-0001", title: "Graph", status: "approved", file: "0001-graph.md", type: "design" }],
    "docs/plans": [{ id: "PLAN-0001", title: "Graph", status: "approved", file: "0001-graph.md", type: "plan" }],
    "docs/test-specs": [{ id: "TSPEC-0001", title: "Graph", status: "approved", file: "0001-graph.md", type: "test-spec" }],
    "docs/tasks": [{ id: "TASK-0001", title: "TASK-0001", status: "todo", file: "0001-task.md", type: "task" }],
    "docs/impl/ir": [{ id: "IMPL-0001", title: "Graph implementation", status: "complete", file: "0001-task.md", type: "implementation-record" }],
  };
  const rowsFor = (dir: string): IndexRow[] =>
    [...(indexRows[dir] ?? []), ...(defaultChainRows[dir] ?? [])];

  files["docs/ideas/README.md"] = indexReadme("docs/ideas", "IDEA Documents", rowsFor("docs/ideas"));
  files["docs/specs/README.md"] = indexReadme("docs/specs", "SPEC Documents", [
    ...rowsFor("docs/specs"),
    { id: "SPEC-0098", title: "Deleted spec", status: "approved", file: "0098-deleted.md", type: "spec" },
  ]);
  files["docs/adr/README.md"] = indexReadme("docs/adr", "ADR Documents", rowsFor("docs/adr"));
  files["docs/designs/README.md"] = indexReadme("docs/designs", "DESIGN Documents", [
    { id: "DESIGN-OVERVIEW", title: "Design overview", status: "approved", file: "overview.md", type: "design" },
    ...rowsFor("docs/designs"),
  ]);
  files["docs/plans/README.md"] = indexReadme("docs/plans", "PLAN Documents", [
    ...rowsFor("docs/plans"),
    { id: "PLAN-9302", title: "Plan 9302", status: "superseded", file: "9302-dead.md", type: "plan" },
  ]);
  files["docs/test-specs/README.md"] = indexReadme("docs/test-specs", "TEST-SPEC Documents", rowsFor("docs/test-specs"));
  files["docs/impl/ir/README.md"] = indexReadme("docs/impl/ir", "Implementation Record Documents", rowsFor("docs/impl/ir"));
  files["docs/tasks/README.md"] = indexReadme("docs/tasks", "TASK Documents",
    rowsFor("docs/tasks").map((row) =>
      row.id === "TASK-0101" ? { ...row, status: "todo", docStatus: "done" } : row));

  // Discovery index covers brainstorms + chained discoveries but skips the
  // three orphans (9103–9105) — realistic coverage debt.
  files["docs/discovery/README.md"] = indexReadme("docs/discovery", "DISCOVERY Documents",
    rowsFor("docs/discovery").filter((row) => !/^910[345]/.test(row.file)));

  files["docs/impl/exp/README.md"] =
    "# Experiment Log Documents\n\nDirectory: `docs/impl/exp`\n";

  // Designs require overview.md (requiredDirectoryFiles).
  files["docs/designs/overview.md"] = doc(
    { id: "DESIGN-OVERVIEW", type: "design", status: "approved", title: "Design overview" },
    "# System Design Overview\n",
  );

  return files;
}
