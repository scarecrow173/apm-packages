# Typed Reciprocal Semantics for `verified-by`/`verifies` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve GitHub issue #105 — make `doc-status` relation lint treat `plan`/`task -> verified-by -> test-spec` as a verification-evidence link that does not require a `verifies` back-link, while keeping true reciprocal-pair checks intact.

**Architecture:** Gate the existing reciprocal check in `lintRelations` on the *target* document's contract: if the target type's contract constrains the inverse relation's target types and the source document's type is not among them, the inverse link can never legally exist, so the reciprocal check is skipped. No new relation fields, no front-matter changes.

**Tech Stack:** TypeScript source under `scripts/doc-driven-dev/src/skills/lib/`; generated JS bundles under `packages/doc-driven-dev/.apm/skills/**/scripts/` (regenerated via `mise exec -- pnpm --dir scripts/doc-driven-dev run build`); node:test tests run by tsx against the generated bundles.

## Global Constraints

- Run repo-managed commands through `mise exec --` (mise shims are off PATH).
- Edit TypeScript source first; regenerate distributed JS with `mise exec -- pnpm --dir scripts/doc-driven-dev run build`. Never hand-edit generated JS.
- Keep `*.md` / `*.ja.md` sibling docs synchronized in meaning and structure.
- `test-spec.verifies` target types stay `["spec", "design", "adr"]` (TEST-SPEC-DOC-GATE-001).
- `plan.verified-by` requirement (`targetTypes: ["test-spec"]`, statuses `approved`/`in-progress`/`completed`, `skipField: "test-spec-skip"`) stays unchanged.
- Verify with `mise exec -- pnpm --dir scripts/doc-driven-dev test`, `mise exec -- pnpm --dir scripts/doc-driven-dev run lint:md`, and `git diff --check`.

---

### Task 1: Type-gated reciprocal check in `doc_lint.ts`

**Files:**
- Modify: `scripts/doc-driven-dev/src/skills/lib/doc_lint.ts` (reciprocal block inside `lintRelations`, ~lines 269-293)
- Test: `scripts/doc-driven-dev/tests/doc-status-lint.test.ts`

**Interfaces:**
- Consumes: `contractForType` (already imported), `RECIPROCAL_RELATIONS`, `RepositoryDocument.type`
- Produces: helper `reciprocalApplies(document, inverseField, targetDocument): boolean` used inside `lintRelations`; rule id `inconsistent-reciprocal-relation` unchanged

- [ ] **Step 1: Write the failing regression test**

Add to `scripts/doc-driven-dev/tests/doc-status-lint.test.ts` after the existing reciprocal test (~line 138). `writeDoc` and `specFrontMatter` helpers already exist in this file.

```ts
test("audit_docs treats plan/task verified-by to a test-spec as evidence, not reciprocal", () => {
  const repo = tempRepo();
  for (const dir of ["docs/specs", "docs/plans", "docs/tasks", "docs/test-specs"]) {
    fs.mkdirSync(path.join(repo, dir), { recursive: true });
    fs.writeFileSync(path.join(repo, dir, "README.md"), `# ${dir}\n`, "utf8");
  }
  writeDoc(path.join(repo, "docs/specs"), "0001-a.md", specFrontMatter({ status: "approved" }));
  writeDoc(path.join(repo, "docs/specs"), "0002-b.md", specFrontMatter({
    id: "SPEC-0002",
    status: "approved",
    relations: { "verified-by": ["TSPEC-0002"] },
  }));
  writeDoc(path.join(repo, "docs/test-specs"), "0001-ts.md", specFrontMatter({
    id: "TSPEC-0001",
    type: "test-spec",
    status: "approved",
    title: "TS1",
    relations: { verifies: ["SPEC-0001"] },
  }));
  writeDoc(path.join(repo, "docs/test-specs"), "0002-ts.md", specFrontMatter({
    id: "TSPEC-0002",
    type: "test-spec",
    status: "approved",
    title: "TS2",
    relations: { verifies: ["SPEC-0001"] },
  }));
  writeDoc(path.join(repo, "docs/plans"), "0001-p.md", specFrontMatter({
    id: "PLAN-0001",
    type: "plan",
    status: "approved",
    title: "Plan",
    relations: { "verified-by": ["TSPEC-0001"] },
  }));
  writeDoc(path.join(repo, "docs/tasks"), "0001-t.md", specFrontMatter({
    id: "TASK-0001",
    type: "task",
    status: "todo",
    title: "Task",
    relations: { "verified-by": ["TSPEC-0001"] },
  }));

  const report = auditJson(repo, "all");
  const flagged = report.findings
    .filter((finding: any) => finding.code === "inconsistent-reciprocal-relation")
    .map((finding: any) => finding.file);
  assert.deepEqual(flagged, ["docs/specs/0002-b.md"]);
  assert.equal(
    report.findings.some((finding: any) => finding.code === "plan-missing-test-spec-evidence"),
    false,
  );
  assert.equal(
    report.findings.some((finding: any) => finding.code === "test-spec-invalid-verifies-target"),
    false,
  );
});
```

Why this shape: `PLAN-0001`/`TASK-0001` link `verified-by -> TSPEC-0001` while `TSPEC-0001.verifies = [SPEC-0001]` is non-empty and cannot legally point back — today this produces `inconsistent-reciprocal-relation`. `SPEC-0002 -> verified-by -> TSPEC-0002` (whose `verifies` points at `SPEC-0001`, not `SPEC-0002`) proves genuine reciprocal detection is preserved for types the inverse relation can legally target.

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev test -- tests/doc-status-lint.test.ts`
Expected: FAIL — the new test sees `inconsistent-reciprocal-relation` on `docs/plans/0001-p.md` and `docs/tasks/0001-t.md` (and likely on `docs/specs/0002-b.md`), so `flagged` is not `["docs/specs/0002-b.md"]`.

(Note: tests run against generated bundles in `packages/doc-driven-dev/.apm/skills/`; the failure is expected since the bundle still contains the old logic.)

- [ ] **Step 3: Add the typed reciprocal gate**

In `scripts/doc-driven-dev/src/skills/lib/doc_lint.ts`, after `relationSourcePaths` (~line 70), add:

```ts
// Typed reciprocal semantics: an inverse link is only expected when the
// target type's contract could legally express it back to the source type.
// `plan`/`task` -> `verified-by` -> `test-spec` is a verification-evidence
// link; `test-spec.verifies` may only target spec/design/adr, so it can
// never reciprocate a plan or task source.
function reciprocalApplies(
  document: RepositoryDocument,
  inverseField: string,
  targetDocument: RepositoryDocument,
): boolean {
  const inverseRule = contractForType(targetDocument.type ?? "")
    ?.requiredRelations.find((rule) => rule.field === inverseField);
  if (!inverseRule) return true;
  return document.type !== null && inverseRule.targetTypes.includes(document.type);
}
```

Then change the reciprocal block inside `lintRelations` (currently `if (reciprocal) {`) to:

```ts
      const reciprocal = RECIPROCAL_RELATIONS[field];
      if (reciprocal && reciprocalApplies(document, reciprocal, targetDocument)) {
```

- [ ] **Step 4: Regenerate distributed JS, then re-run the test**

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev run build`
Run: `mise exec -- pnpm --dir scripts/doc-driven-dev test -- tests/doc-status-lint.test.ts`
Expected: PASS (all tests in the file, including the pre-existing `inconsistent-reciprocal-relation` test at line 116)

- [ ] **Step 5: Run the full suite**

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev test`
Expected: PASS — in particular `doc-suite.test.ts` ("flags test-specs without verifies and plans without test-spec evidence"), `doc-structure-lint.test.ts` (localized-sibling reciprocal test), and `doc-driven-dev-graph-run-to-yield.test.ts` (which uses `verified-by` + `verifies` fixtures).

- [ ] **Step 6: Commit**

```bash
git add scripts/doc-driven-dev/src/skills/lib/doc_lint.ts scripts/doc-driven-dev/tests/doc-status-lint.test.ts packages/doc-driven-dev/.apm
git commit -m "fix(doc-driven-dev): gate reciprocal lint on typed inverse legality"
```

### Task 2: Sync English/Japanese convention docs

**Files:**
- Modify: `packages/doc-driven-dev/.apm/skills/test-spec-doc/references/test-spec-conventions.md` (~lines 92-100)
- Modify: `packages/doc-driven-dev/.apm/skills/test-spec-doc/references/test-spec-conventions.ja.md` (~lines 92-100)

- [ ] **Step 1: Update the English doc**

In `test-spec-conventions.md`, after the sentence "Tasks that implement the behavior should point back with their own `verified-by` relation to this test spec.", extend the paragraph to state the evidence-link semantics:

```markdown
Tasks that implement the behavior should point back with their own
`verified-by` relation to this test spec. `verified-by` links from plans and
tasks are verification-evidence links, so `doc-status` does not require a
`verifies` back-link for them; the reciprocal check applies only where the
linked document's type can legally declare one.
```

- [ ] **Step 2: Update the Japanese doc with the matching meaning**

In `test-spec-conventions.ja.md`, after the matching paragraph (~lines 92-93):

```markdown
その振る舞いを実装する task は、自身の `verified-by` relation でこの test
spec を指し戻します。plan や task からの `verified-by` link は検証証跡の
link として扱われるため、`doc-status` はそれらに対する `verifies` の
逆リンクを要求しません。reciprocal check は、リンク先の文書型が逆方向の
relation を合法的に宣言できる場合にのみ適用されます。
```

- [ ] **Step 3: Markdown lint + diff check**

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev run lint:md`
Run: `git diff --check`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add packages/doc-driven-dev/.apm/skills/test-spec-doc/references/test-spec-conventions.md packages/doc-driven-dev/.apm/skills/test-spec-doc/references/test-spec-conventions.ja.md
git commit -m "docs(doc-driven-dev): document evidence-link semantics of verified-by"
```

### Task 3: Close-out on issue #105

- [ ] **Step 1:** `git status` — confirm only intended files changed (leave the pre-existing `apm.lock.yaml` modification untouched).
- [ ] **Step 2:** Comment summary on issue #105 (or report back to the user) describing the typed-reciprocal fix and test coverage. Do not close the issue or push without explicit user approval.
