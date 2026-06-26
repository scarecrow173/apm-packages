# ADR Doc Front Matter Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `adr-doc` の YAML front matter を `doc_suite_utils.ts` の共通 front matter 契約へ統合し、ADR も `id/type/status/title/created/updated/owners/relations` を持つようにする。ADR 固有の governance 情報は `metadata.adr` に namespaced extension として残す。

**Architecture:** ADR 固有の MADR テンプレート、section review、relation maintenance、code-link checks は維持する。front matter の共通部分は `doc_suite_utils.ts` に寄せ、ADR 固有拡張は `metadata.adr` として同じ front matter 内に残す。`new_adr.ts` は共通 front matter を prepend して ADR body template を続ける。

**Tech Stack:** TypeScript/Node.js, `tsx --test`, `zod`, `gray-matter`, esbuild script bundling.

---

## Contract Decision

ADR front matter should use the same required top-level shape as other doc-suite documents:

```yaml
---
id: "ADR-0001"
type: "adr"
status: "proposed"
title: "Adopt MADR"
created: "2026-06-26"
updated: "2026-06-26"
owners: []
relations:
  source: []
  changes:
    added: []
    modified: []
    deleted: []
    renamed: []
    moved: []
    generated: []
  implements: []
  implemented-by: []
  depends-on: []
  blocks: []
  supersedes: []
  superseded-by: []
  related: []
  refines: []
  refined-by: []
  derives-from: []
  derived-by: []
  verifies: []
  verified-by: []
  references: []
  defers: []
  deferred-by: []
metadata:
  adr:
    decision-makers: []
    consulted: []
    informed: []
---
```

`metadata.adr` is intentionally an extension. It preserves MADR/RACI-style ADR governance without making `decision-makers`, `consulted`, or `informed` top-level fields that drift from the shared doc-suite contract.

## File Structure

- Modify: `scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts`
  - Add `adr` to the shared doc type/config list.
  - Export `frontMatter()`.
  - Extend `frontMatter()` with optional `metadata` output while keeping existing callers unchanged.
- Modify: `scripts/doc-driven-dev/src/skills/adr-doc/scripts/new_adr.ts`
  - Stop relying on ADR template front matter.
  - Use `frontMatter(configFor("adr"), ...)`.
  - Pass `metadata.adr.decision-makers`, `metadata.adr.consulted`, and `metadata.adr.informed` defaults.
- Modify: `scripts/doc-driven-dev/src/skills/adr-doc/scripts/lib/adr_utils.ts`
  - Validate ADR files with the shared doc-suite front matter schema.
  - Keep relation parsing and ADR-specific body helpers.
  - Read `data.id`, `data.title`, and `data.created` for list/index output.
- Modify: `scripts/doc-driven-dev/src/skills/adr-doc/scripts/migrate_report.ts`
  - Report legacy top-level `date/decision-makers/consulted/informed` fields as migration work.
  - Expect shared top-level fields plus optional `metadata.adr`.
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/assets/templates/madr-4-*.md`
  - Remove YAML front matter from all 4 English ADR body templates.
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/assets/templates/madr-4-*.ja.md`
  - Remove YAML front matter from all 4 Japanese ADR body templates.
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/SKILL.md`
  - Describe shared front matter and ADR-specific `metadata.adr`.
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/SKILL.ja.md`
  - Keep Japanese guidance synchronized with the English version.
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/references/adr-conventions.md`
  - Update front matter examples and field table.
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/references/adr-conventions.ja.md`
  - Keep Japanese reference synchronized with the English version.
- Modify: `scripts/doc-driven-dev/tests/adr-doc.test.ts`
  - Update generation, audit, list/index, and migration expectations.
- Regenerate: `packages/doc-driven-dev/.apm/skills/adr-doc/scripts/*.js`
  - Run `pnpm --dir scripts/doc-driven-dev run build:scripts`.

## Task 1: Add Failing Tests

**Files:**
- Modify: `scripts/doc-driven-dev/tests/adr-doc.test.ts`

- [ ] **Step 1: Update generated ADR front matter assertions**

In `new_adr creates default MADR ADR and index in docs/adr`, replace old metadata assertions with:

```ts
assert.match(adr, /^id: "ADR-0001"$/m);
assert.match(adr, /^type: "adr"$/m);
assert.match(adr, /^status: "proposed"$/m);
assert.match(adr, /^title: "Adopt MADR"$/m);
assert.match(adr, /^created: "\d{4}-\d{2}-\d{2}"$/m);
assert.match(adr, /^updated: "\d{4}-\d{2}-\d{2}"$/m);
assert.match(adr, /^owners: \[\]$/m);
assert.match(adr, /^metadata:$/m);
assert.match(adr, /^ adr:$/m);
assert.match(adr, /^  decision-makers: \[\]$/m);
assert.match(adr, /^  consulted: \[\]$/m);
assert.match(adr, /^  informed: \[\]$/m);
assert.doesNotMatch(adr, /^date: /m);
assert.doesNotMatch(adr, /^decision-makers: /m);
assert.doesNotMatch(adr, /^consulted: /m);
assert.doesNotMatch(adr, /^informed: /m);
```

- [ ] **Step 2: Assert full shared relations shape**

Extend `commonRelationFields` to match `doc_suite_utils.ts`, including `refined-by`, `derives-from`, `derived-by`, `verifies`, `verified-by`, `defers`, and `deferred-by`. Add:

```ts
assert.match(adr, /^ changes:$/m);
for (const field of ["added", "modified", "deleted", "renamed", "moved", "generated"]) {
  assert.match(adr, new RegExp(`^  ${field}: \\[\\]$`, "m"));
}
```

- [ ] **Step 3: Assert index uses shared id/title**

Add:

```ts
const index = fs.readFileSync(path.join(repo, "docs/adr/README.md"), "utf8");
assert.match(index, /\| ADR-0001 \| Adopt MADR \| proposed \| \[0001-adopt-madr\.md\]\(\.\/0001-adopt-madr\.md\) \|/);
```

- [ ] **Step 4: Add audit test for legacy top-level ADR fields**

Add a test where an ADR has old `date/decision-makers/consulted/informed` front matter and no `id/type/title/created/updated/owners`. `audit_adr --json` should report `invalid-front-matter` with an `id` issue.

- [ ] **Step 5: Run focused test and verify failure**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev exec tsx --test tests/adr-doc.test.ts
```

Expected: FAIL because `adr-doc` still emits and validates old ADR-specific front matter.

## Task 2: Extend Shared Front Matter Utilities

**Files:**
- Modify: `scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts`

- [ ] **Step 1: Add `adr` to shared doc types**

Change:

```ts
const docTypes = ["idea", "brainstorm", "discovery", "spec", "plan", "task", "design"] as const;
```

to:

```ts
const docTypes = ["idea", "brainstorm", "discovery", "spec", "plan", "task", "design", "adr"] as const;
```

- [ ] **Step 2: Add ADR config**

Add:

```ts
adr: {
  defaultStatus: "proposed",
  dir: "docs/adr",
  dirs: ["docs/adr", "docs/decisions", "adr", "docs/adrs", "decisions"],
  idPrefix: "ADR",
  statusValues: ["proposed", "accepted", "rejected", "deprecated", "superseded", "draft"],
  type: "adr",
},
```

- [ ] **Step 3: Add metadata rendering support**

Add a metadata input type:

```ts
type MetadataInput = Record<string, unknown>;
```

Extend `frontMatter()` signature:

```ts
function frontMatter(
  config: DocConfig,
  number: number,
  title: string,
  status: string,
  date: string,
  relations?: RelationInput,
  metadata?: MetadataInput,
): string {
```

Render `metadata` after `relations` when provided. Use a structured YAML writer already present in the dependency stack if practical; otherwise add a small formatter that supports objects, arrays, strings, booleans, and numbers. Existing callers should keep identical output when `metadata` is omitted.

- [ ] **Step 4: Export `frontMatter()`**

Add `frontMatter` to `module.exports`.

## Task 3: Generate ADRs with Shared Front Matter

**Files:**
- Modify: `scripts/doc-driven-dev/src/skills/adr-doc/scripts/new_adr.ts`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/assets/templates/madr-4-full.md`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/assets/templates/madr-4-minimal.md`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/assets/templates/madr-4-bare.md`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/assets/templates/madr-4-bare-minimal.md`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/assets/templates/madr-4-full.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/assets/templates/madr-4-minimal.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/assets/templates/madr-4-bare.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/assets/templates/madr-4-bare-minimal.ja.md`

- [ ] **Step 1: Import shared front matter helpers**

Add:

```ts
const { configFor, frontMatter } = require("../../lib/doc_suite_utils.ts");
```

- [ ] **Step 2: Render ADR body only**

Change `renderTemplate()` so it only replaces body placeholders:

```ts
return fs.readFileSync(templatePath, "utf8")
  .replaceAll("{{number}}", String(values.number))
  .replaceAll("{{title}}", values.title);
```

- [ ] **Step 3: Prepend shared front matter with metadata**

Use:

```ts
const date = args.date || new Date().toISOString().slice(0, 10);
const status = args.status;
const adrConfig = configFor("adr");
const metadata = {
  adr: {
    "decision-makers": [],
    consulted: [],
    informed: [],
  },
};
const header = frontMatter(adrConfig, number, args.title, status, date, undefined, metadata);
const body = renderTemplate(args.template, { number, title: args.title }).trimStart();
const content = `${header}\n\n${body}\n`;
```

- [ ] **Step 4: Strip front matter from all ADR templates**

For all 8 `madr-4-*` templates, remove the initial YAML block. The first non-empty line should be:

```md
# {{number}}. {{title}}
```

- [ ] **Step 5: Verify template cleanup**

Run:

```powershell
rg -n '^---$|^id:|^date:|^decision-makers:|^consulted:|^informed:' packages/doc-driven-dev/.apm/skills/adr-doc/assets/templates
```

Expected: no matches.

## Task 4: Validate ADRs with Shared Front Matter

**Files:**
- Modify: `scripts/doc-driven-dev/src/skills/adr-doc/scripts/lib/adr_utils.ts`

- [ ] **Step 1: Reuse shared validation**

Import:

```ts
const { validateFrontMatter: validateDocSuiteFrontMatter } = require("../../../lib/doc_suite_utils.ts");
```

Use:

```ts
function validateFrontMatter(content: string): FrontMatterIssue[] {
  return validateDocSuiteFrontMatter(content);
}
```

- [ ] **Step 2: Remove ADR-only top-level schema**

Remove the ADR-only requirement for top-level `date`, `decision-makers`, `consulted`, and `informed`. `metadata.adr` remains passthrough metadata under the shared schema.

- [ ] **Step 3: Read shared metadata in entries**

Use:

```ts
id: typeof data.id === "string" ? data.id : null,
title: typeof data.title === "string" ? data.title : await titleFromAdr(content, path.basename(file, ".md")),
status: typeof data.status === "string" ? data.status : null,
date: typeof data.created === "string" ? data.created : null,
```

- [ ] **Step 4: Prefer front matter id/title in index**

Use:

```ts
const id = typeof data.id === "string" && data.id.trim() ? data.id.trim() : fallbackId;
const title = typeof data.title === "string" && data.title.trim()
  ? data.title.trim()
  : await titleFromAdr(content, path.basename(file, ".md"));
```

## Task 5: Update ADR Docs and Migration Report

**Files:**
- Modify: `scripts/doc-driven-dev/src/skills/adr-doc/scripts/migrate_report.ts`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/SKILL.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/references/adr-conventions.md`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/references/adr-conventions.ja.md`

- [ ] **Step 1: Update migration metadata checks**

Replace checks for required old top-level fields:

```ts
["status", "date", "decision-makers", "consulted", "informed"]
```

with checks for required shared fields:

```ts
["id", "type", "status", "title", "created", "updated", "owners", "relations"]
```

Add a legacy warning when old top-level governance fields exist:

```ts
["decision-makers", "consulted", "informed"]
```

Expected message: move them under `metadata.adr`.

- [ ] **Step 2: Update English ADR skill guidance**

Document that ADR governance belongs in `metadata.adr`, while required lifecycle fields use the shared doc-suite front matter.

- [ ] **Step 3: Update Japanese ADR skill guidance**

Apply the same meaning in `SKILL.ja.md`, preserving section structure.

- [ ] **Step 4: Update ADR conventions examples**

In `adr-conventions.md` and `adr-conventions.ja.md`, replace the old front matter example with the shared front matter plus `metadata.adr` example from this plan.

- [ ] **Step 5: Verify Japanese files with UTF-8 reads**

Run:

```powershell
Get-Content -Encoding utf8 packages/doc-driven-dev/.apm/skills/adr-doc/SKILL.ja.md | Select-Object -First 20
Get-Content -Encoding utf8 packages/doc-driven-dev/.apm/skills/adr-doc/references/adr-conventions.ja.md | Select-Object -First 20
```

Expected: readable Japanese text; do not treat console rendering alone as file corruption.

## Task 6: Regenerate Distributed Scripts

**Files:**
- Regenerate: `packages/doc-driven-dev/.apm/skills/adr-doc/scripts/*.js`
- Regenerate: shared generated scripts only if `build:scripts` rewrites them because `doc_suite_utils.ts` changed.

- [ ] **Step 1: Run script build**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev run build:scripts
```

Expected: PASS.

- [ ] **Step 2: Inspect generated diff scope**

Run:

```powershell
git diff -- packages/doc-driven-dev/.apm/skills/adr-doc scripts/doc-driven-dev/src/skills/adr-doc scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts scripts/doc-driven-dev/tests/adr-doc.test.ts
```

Expected: changes are limited to shared front matter integration and ADR docs/templates/scripts.

## Task 7: Verify Behavior

**Files:**
- Validate: `scripts/doc-driven-dev/tests/adr-doc.test.ts`
- Validate: generated package scripts under `packages/doc-driven-dev/.apm/skills/adr-doc/scripts/`

- [ ] **Step 1: Run focused ADR tests**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev exec tsx --test tests/adr-doc.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run broader doc-driven-dev tests**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev test
```

Expected: PASS.

- [ ] **Step 3: Run whitespace gate**

Run:

```powershell
git diff --check
```

Expected: no whitespace errors.

## Task 8: Commit-Ready Review

**Files:**
- Review all modified files from Tasks 1-6.

- [ ] **Step 1: Confirm ADR governance is namespaced**

Run:

```powershell
rg -n '^decision-makers:|^consulted:|^informed:' packages/doc-driven-dev/.apm/skills/adr-doc scripts/doc-driven-dev/src/skills/adr-doc scripts/doc-driven-dev/tests/adr-doc.test.ts
```

Expected: no top-level governance fields remain in templates or schema requirements. Documentation may mention them only under `metadata.adr` or as legacy migration context.

- [ ] **Step 2: Confirm shared schema includes ADR**

Run:

```powershell
rg -n '"adr"|idPrefix: "ADR"|frontMatter|metadata' scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts scripts/doc-driven-dev/src/skills/adr-doc/scripts/new_adr.ts
```

Expected: `adr` is in `docTypes`, ADR config exists, `frontMatter` is exported, and `new_adr.ts` passes `metadata.adr`.

- [ ] **Step 3: Prepare commit**

Run:

```powershell
git status --short
```

Expected: only intended ADR front matter integration files are modified. Use a commit message like:

```text
fix: unify adr front matter schema
```

## Self-Review

- Spec coverage: The plan implements shared doc-suite front matter for ADRs while preserving ADR-specific governance under `metadata.adr`.
- Placeholder scan: No `TBD`, `TODO`, or unresolved implementation slots remain.
- Type consistency: The plan uses one top-level front matter shape and one id format, `ADR-0001`, across generation, validation, index display, migration reporting, docs, and tests.
- Risk: This is a document contract migration for ADRs. Existing ADRs using old top-level `date/decision-makers/consulted/informed` front matter need migration to `created/updated` and `metadata.adr`.
