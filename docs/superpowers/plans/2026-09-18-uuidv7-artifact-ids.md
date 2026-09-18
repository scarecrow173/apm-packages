# UUIDv7 + Base62 Artifact IDs Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. This plan is executed inline in the authoring session; each task ends with a commit.

**Goal:** Migrate the `doc-driven-dev` document suite from sequential `TYPE-NNNN` artifact IDs and `NNNN-<slug>.md` filenames to `<PREFIX>-<22-char Base62 UUIDv7>` IDs and slug-only filenames, so multiple Git worktrees can generate documents in parallel without a shared allocator (GitHub #83/#84), then ship a repository migration for existing documents (#85).

**Architecture:** One shared generator module (`src/skills/lib/artifact_id.ts`) wraps `uuid@14` `v7()` + `uuid62` encode; every `new_*` script funnels through it via `doc_suite_utils.frontMatter` / `impl_doc_utils`. Filenames decouple from identity: new documents are always `<slug>.md`. Runtime stays format-agnostic downstream (graph, task DAG, audit treat IDs as opaque strings); generation sites change. A new `migrate_ids.js` entrypoint next to `migrate_docs.js` performs discover → map → preflight → rewrite → rename → reindex → validate.

**Tech Stack:** TypeScript sources under `scripts/doc-driven-dev/src/skills/` bundled by esbuild into `packages/doc-driven-dev/.apm/skills/*/scripts/*.js`; `uuid@14.0.2` (v7) + `uuid62@1.0.2` (22-char Base62, decode round-trip); `node:test` + `tsx`; Markdown convention docs edited directly under `.apm/skills/` in EN+JA pairs.

## Global Constraints

- Run repo-managed tools via `mise exec -- <command>` (root `AGENTS.md` §0).
- ID contract: `<TYPE_PREFIX>-<22-char Base62>`; payload always 22 chars; alphabet/endian owned by `uuid62` — never re-implemented (issue #84).
- No UUID stored twice in front matter; no sequential allocator consulted on generation; lexical ID order is not chronology (issue #83).
- New documents default to slug-only filenames; `--name` remains the explicit override.
- `DESIGN-OVERVIEW` stays a fixed non-generated ID.
- Front matter `id` schema stays permissive (`z.string().min(1)`) so mixed legacy/new repos still validate.
- Duplicate ID / unresolved relation invariants unchanged — they are blockers, not errors to relax.
- Edit TS source, then `pnpm --dir scripts/doc-driven-dev build` to regenerate distributed JS; never hand-edit generated JS (package AGENTS.md).
- Every English doc change is mirrored in the `.ja.md` sibling (root `AGENTS.md` §2).
- Verify per package AGENTS.md: `pnpm --dir scripts/doc-driven-dev test`, `pnpm --dir scripts/doc-driven-dev run lint:md`, plus `tsc --noEmit` and `git diff --check`.

## File Structure

```
scripts/doc-driven-dev/
├── src/skills/lib/
│   ├── artifact_id.ts                    # NEW: generateArtifactId, encode/decode, validators
│   ├── doc_suite_utils.ts                # MOD: frontMatter(id), createDocument slug-only, migrateDocs
│   └── document_utils.ts                 # unchanged surface (detectNaming kept for migration detection)
├── src/skills/adr-doc/scripts/
│   ├── new_adr.ts                        # MOD: drop nextIdNumber/number templates, slug filename
│   └── lib/adr_utils.ts                  # MOD: remove nextIdNumber (dead after change)
├── src/skills/impl-doc/scripts/lib/impl_doc_utils.ts   # MOD: IMPL-<payload> id, slug .md/.jsonl names
├── src/skills/impl-doc/scripts/new_impl_record.ts      # MOD: id plumbing
├── src/skills/impl-doc/scripts/new_experiment_log.ts   # MOD: path plumbing (number no longer used)
├── src/skills/doc-driven-dev-graph/scripts/
│   ├── migrate_ids.ts                    # NEW (#85): legacy→new ID migration entrypoint
│   └── lib/id_migration.ts               # NEW (#85): discover/map/preflight/rewrite/rename engine
└── tests/
    ├── artifact-id.test.ts               # NEW: golden vectors, validator, uniqueness
    ├── id-migration.test.ts              # NEW (#85): migration behavior matrix
    └── doc-suite*.test.ts, adr-doc.test.ts, impl-doc.test.ts  # MOD: new-contract expectations

packages/doc-driven-dev/.apm/skills/
├── */scripts/*.js                        # REGEN via build
├── adr-doc/assets/templates/madr-4-*.md  # MOD: drop `{{number}}. ` heading prefix (8 files)
└── */references/*-conventions.{md,ja.md} + SKILL.{md,ja.md}  # MOD: ID/filename contract docs
```

## Issue → Task Map

| Issue | Scope | Tasks |
| --- | --- | --- |
| #84 | ID generation + conventions + tests | 1–7 |
| #85 | legacy migration entrypoint | 8 |
| #83 | tracking — closes when #84/#85 verified | 9 (report only) |

---

### Task 1: Shared artifact ID module (`artifact_id.ts`)

**Files:**
- Create: `scripts/doc-driven-dev/src/skills/lib/artifact_id.ts`
- Test: `scripts/doc-driven-dev/tests/artifact-id.test.ts`

**Interfaces:**
- Produces: `generateArtifactId(idPrefix: string): string` — `PREFIX-<uuid62.encode(uuidv7())>`
- Produces: `encodeUuidToPayload(uuid: string): string`, `decodePayloadToUuid(payload: string): string`
- Produces: `isNewArtifactId(value: string): boolean` — `/^[A-Z][A-Z0-9]*-[0-9A-Za-z]{22}$/`
- Produces: `isLegacyArtifactId(value: string): boolean` — `/^[A-Z][A-Z0-9]*-\d+$/` (used by #85)

- [x] **Step 1: Write the failing test** — golden vectors (nil UUID → `0000000000000000000000`, max UUID → `7N42dgm5tFLK9N8MT7fHC7`, `01a0b370-64e3-7468-91eb-ab4935e4d903` → `034qPUpBj0VYOqxmFLijD5`), 22-char assertion, round-trip decode, `generateArtifactId` format + 512-iteration uniqueness, validator accept/reject matrix.
- [x] **Step 2: Run test to verify it fails** — `mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx --test tests/artifact-id.test.ts` → module not found.
- [x] **Step 3: Write minimal implementation** — thin wrappers over `uuid`/`uuid62`; no custom alphabet math.
- [x] **Step 4: Run test to verify it passes.**
- [x] **Step 5: Commit** — `feat(doc-driven-dev): add shared UUIDv7+Base62 artifact id generator`

### Task 2: `doc_suite_utils` generation path

**Files:**
- Modify: `scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts`

**Interfaces:**
- Consumes: `generateArtifactId` from Task 1.
- Produces: `frontMatter(config, id, title, status, date, relations?, metadata?)` — `id` is now a full ID string (was `number`).
- Produces: `createDocument` unchanged signature; filenames become `<slug>.md` (or `--name`).

- [x] **Step 1:** Change `frontMatter(config, number, ...)` → `frontMatter(config, id, ...)`; emit `id: "<PREFIX>-<payload>"`.
- [x] **Step 2:** `createDocument`: remove `nextNumberFromFrontMatter`/`nextNumber`/`detectNaming` allocation; `generateArtifactId(config.idPrefix)`; filename `slugify(title, type)` + `.md` unless `--name`; keep reserved-file + existence checks.
- [x] **Step 3:** `migratedFrontMatter`/`migratedContent`/`plannedMigration`/`allocateTargetPath`: generate new IDs, slug-only targets; drop `TargetAllocation.next` (keep collision set).
- [x] **Step 4:** Remove now-dead helpers (`nextNumberFromFrontMatter`, `recursiveBasenames` if unreferenced, `TargetAllocation.next`); fix overview comment `0001-*.md` → `<slug>.md`.
- [x] **Step 5:** Build + run doc-suite tests; expect contract failures — fix in Task 6 (temporarily note).
- [x] **Step 6: Commit** — `feat(doc-driven-dev): generate opaque artifact ids and slug filenames in doc suite`

### Task 3: ADR path (`new_adr`, `adr_utils`, MADR templates)

**Files:**
- Modify: `src/skills/adr-doc/scripts/new_adr.ts`, `src/skills/adr-doc/scripts/lib/adr_utils.ts`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/assets/templates/madr-4-{full,minimal,bare,bare-minimal}{,.ja}.md`

- [x] **Step 1:** Templates: `# {{number}}. {{title}}` → `# {{title}}` (all 8).
- [x] **Step 2:** `new_adr.ts`: `generateArtifactId("ADR")`; slug-only filename; `renderTemplate` drops `number` (TemplateValues `{ title }`); keep `--template`/`--status`/`--date`/index flags.
- [x] **Step 3:** `adr_utils.ts`: remove `nextIdNumber`; keep filename-number fallback in `buildIndex` for legacy files lacking front-matter `id`.
- [x] **Step 4:** Build + `adr-doc.test.ts` passes after Task-6 expectation updates.
- [x] **Step 5: Commit** — `feat(doc-driven-dev): issue opaque ids and slug filenames for new ADRs`

### Task 4: impl-doc path (`impl_doc_utils`, new_impl_record, new_experiment_log)

**Files:**
- Modify: `src/skills/impl-doc/scripts/lib/impl_doc_utils.ts`, `new_impl_record.ts`, `new_experiment_log.ts`

- [x] **Step 1:** `implementationRecordFrontMatter`/`buildImplementationRecordContent`: `number` → `id` (`IMPL-<payload>`).
- [x] **Step 2:** `buildNewFilePath`: slug-only `.md`/`.jsonl`; drop `nextNumberForFiles`/`detectNamingForFiles` (remove if unreferenced).
- [x] **Step 3:** Update callers (`new_impl_record` uses `id` not `number`; `new_experiment_log` uses only `outputPath`).
- [x] **Step 4:** Build + `impl-doc.test.ts` green after expectation updates.
- [x] **Step 5: Commit** — `feat(doc-driven-dev): issue opaque ids and slug filenames for impl docs`

### Task 5: Graph/audit compatibility sweep

**Files:** inspect-only unless a defect found — `task_graph.ts`, `artifact_graph.ts`, `graph_state.ts`, `audit_docs.ts`, `list_docs.ts`, `migrate_report.ts`, `scaffold_docs.ts`, `relate_adr.ts`, `update_index.ts`.

- [x] **Step 1:** Confirm no `NNNN`/`-(\d{4})` assumptions remain outside legacy-fallback paths (grep evidence in plan research).
- [x] **Step 2:** Confirm `resolveDocumentReference`/`resolveArtifactRelation` match by exact `id` — already format-agnostic; add a mixed legacy/new fixture test if coverage is missing.
- [x] **Step 3: Commit** any needed fixes separately.

### Task 6: Update tests to the new contract

**Files:** `tests/doc-suite.test.ts`, `tests/doc-suite-regressions.test.ts`, `tests/adr-doc.test.ts`, `tests/impl-doc.test.ts`, `tests/doc-driven-dev-graph-*.test.ts` (fixture IDs may stay legacy — they model existing repos; only *generated-output* expectations change).

- [x] **Step 1:** Generated filenames: `NNNN-<slug>.md` → `<slug>.md`.
- [x] **Step 2:** Generated IDs: `PREFIX-\d{4}` → `/^PREFIX-[0-9A-Za-z]{22}$/` (matter-parse and assert pattern + uniqueness per repo).
- [x] **Step 3:** Tests named for numbering ("continues front-matter id numbering", "global numbering") re-purposed: assert new-format ID + slug filename; legacy-fixture repos still accept new slug-named docs (mixed state).
- [x] **Step 4:** Full suite green: `mise exec -- pnpm --dir scripts/doc-driven-dev test`.
- [x] **Step 5: Commit** — `test(doc-driven-dev): update expectations to opaque id and slug filename contract`

### Task 7: EN/JA documentation sync (#84 scope)

**Files:** `*-conventions.md/.ja.md` (adr, spec, plan, task, design, test-spec, idea, discovery, impl), SKILL.md/.ja.md files describing numbered filenames/IDs, `doc-driven-dev-graph` references where `NNNN` appears normatively, package README if it documents the contract, `execution-outcome-contract` examples.

- [x] **Step 1:** Rewrite ID sections: `TYPE-NNNN` → `TYPE-<22-char Base62>`; filename rules → slug-only default; index examples → new ID shape; subdirectory sections → drop "numbers local to directory".
- [x] **Step 2:** Sync each `.ja.md`.
- [x] **Step 3:** `lint:md` + residue/contract tests + `git diff --check`.
- [x] **Step 4: Commit** — `docs(doc-driven-dev): document opaque artifact id and slug filename contract`

### Task 8: #85 — `migrate_ids` migration entrypoint

**Files:**
- Create: `src/skills/doc-driven-dev-graph/scripts/lib/id_migration.ts`, `scripts/migrate_ids.ts`
- Test: `tests/id-migration.test.ts`
- Docs: `doc-driven-dev-graph` SKILL/references + `docs/migrations/` note (EN/JA where siblings exist)

Flow (fail-closed, plan-before-mutate):
1. **Discover** — scan canonical dirs (`configs[type].dirs`, impl ir/exp); collect path, id, type, relations, `.<locale>.md` siblings, numbered filename.
2. **Map** — one new ID per logical artifact; `.ja`/`.en` siblings of one stem share the new ID; duplicate legacy ID across non-siblings → blocker.
3. **Preflight** — malformed front matter, unresolved legacy refs, rename target collisions, unknown types → blockers; no mutation until zero blockers (or `--allow` resolution).
4. **Rewrite** — front matter `id`, all relation fields, metadata ID refs, body occurrences of exact mapped legacy IDs, README/index ID cells + links.
5. **Rename** — `NNNN-<slug>.md` → `<slug>.md` (`--keep-filenames` opts out); collisions preflighted.
6. **Index** — regenerate generated indexes; rewrite hand-curated index links/IDs in place.
7. **Validate** — re-project artifact graph; assert no duplicate-id/broken-relation; report summary; re-run is a no-op (idempotent).

CLI: `node scripts/migrate_ids.js [--cwd <path>] [--apply] [--keep-filenames] [--allow-dirty] [--json]` — dry-run by default; `--apply` requires clean `git status` unless `--allow-dirty`.

- [x] **Step 1:** Failing test matrix: basic rewrite, sibling ID sharing, mixed repo, collisions → blocker, idempotent re-run, index repair, dry-run purity.
- [x] **Step 2:** Implement engine + CLI.
- [x] **Step 3:** Tests green; run against fixture repo end-to-end.
- [x] **Step 4:** Docs (usage + safety contract), EN/JA sync.
- [x] **Step 5: Commit** — `feat(doc-driven-dev): add legacy artifact id migration`

### Task 9: Final gate

- [x] `pnpm build`, `pnpm test`, `lint:md`, `tsc --noEmit`, `git diff --check` all green.
- [x] Report #84/#85 completion against issue checklists; summarize residual #83 verification gaps for the user.
