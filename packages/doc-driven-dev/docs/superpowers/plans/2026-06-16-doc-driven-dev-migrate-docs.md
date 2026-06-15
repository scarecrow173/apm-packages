# doc-driven-dev migrate docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `migrate_docs` lifecycle command that inventories existing Markdown documentation, classifies it into the canonical doc-driven-dev tree, converts it to the package front matter format, and optionally writes split/converted files into `docs/ideas`, `docs/discovery`, `docs/specs`, `docs/designs`, `docs/plans`, `docs/tasks`, `docs/adr`, and `docs/impl/*`.

**Architecture:** Keep migration logic in `scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts` beside the canonical tree and document type definitions, then expose it through `doc-driven-dev-lifecycle/scripts/migrate_docs.ts`. The CLI defaults to dry-run reporting; `--apply` writes new canonical files without deleting originals, and repeated runs avoid overwriting existing targets.

**Tech Stack:** Node 20, TypeScript compiled by `tsx`/`esbuild`, `gray-matter` for Markdown front matter, built-in `fs`/`path`, `node:test` for regression tests.

---

## Scope Check

This plan is one implementation stream because all work belongs to one lifecycle feature: migrating existing docs into the canonical doc-driven-dev tree. It deliberately does not add semantic LLM summarization or content rewriting beyond deterministic front matter wrapping and H1-based splitting; those can become a later enhancement after the deterministic migration surface is stable.

## File Structure

| File | Responsibility |
| ---- | -------------- |
| `scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts` | Add reusable migration types and functions: source discovery, classification, H1 splitting, front matter conversion, safe output path allocation, dry-run/apply result model. |
| `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/migrate_docs.ts` | CLI entrypoint for `migrate_docs`; parse flags, call `migrateDocs`, print human or JSON reports. |
| `scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-migrate.test.ts` | End-to-end CLI tests using temporary repos and the distributed `.apm` command path. |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/migrate_docs.js` | Generated distributed CLI output from `build/build-skill-scripts.ts`. |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/migration-contract.md` | English user-facing migration contract, options, safety guarantees, and completion criteria. |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/migration-contract.ja.md` | Japanese migration contract kept structurally aligned with the English file. |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md` | Document lifecycle entrypoint update: migration is a pre-bootstrap/transition operation for existing repos. |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.ja.md` | Japanese lifecycle entrypoint update matching English meaning and section structure. |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.md` | Add migration as an optional Phase -1 for existing repositories before Phase 0 scaffold. |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.ja.md` | Japanese flow-contract update matching English. |
| `packages/doc-driven-dev/README.md` | Add package-level command summary and safe migration workflow. |
| `packages/doc-driven-dev/README.ja.md` | Japanese README update matching English. |

## Migration Contract

The first version implements deterministic Markdown migration only:

- Sources are Markdown files under `--from` directories, defaulting to `docs`, `doc`, `architecture`, `design`, `specs`, `plans`, and `tasks` when those directories exist.
- Existing canonical target directories are created by reusing `scaffoldDocsTree(cwd)` before apply writes.
- `README.md` and `index.md` are skipped as source documents.
- Files already under canonical target directories are skipped unless `--include-canonical` is passed.
- Classification order is:
  - front matter `type` matching `idea`, `brainstorm`, `spec`, `design`, `plan`, or `task`
  - path or filename keywords
  - first heading keywords
  - fallback to `docs/discovery`
- ADR files are routed to `docs/adr` when path or title contains `adr`, `decision`, `decisions`, or `architecture decision`.
- Implementation records are routed to `docs/impl/ir` when path or title contains `implementation record`, `impl record`, or `ir`.
- Experiment logs are routed to `docs/impl/exp` when path or title contains `experiment`, `exp`, or `spike`.
- Multi-H1 files are split into one document per top-level H1 when `--split-h1` is passed.
- Dry-run is default and never writes files.
- `--apply` writes converted files and README indexes, but never deletes or edits original files.
- Existing target files are never overwritten; a numeric suffix is appended when the planned target already exists.

## Classification Rules

Use these deterministic routing rules in order:

```ts
const migrationRoutes = [
  { target: "docs/ideas", type: "idea", patterns: [/idea/i, /proposal/i] },
  { target: "docs/discovery", type: "brainstorm", patterns: [/discovery/i, /brainstorm/i, /research/i, /brief/i] },
  { target: "docs/specs", type: "spec", patterns: [/spec/i, /requirement/i, /acceptance/i] },
  { target: "docs/designs", type: "design", patterns: [/design/i, /architecture/i] },
  { target: "docs/plans", type: "plan", patterns: [/plan/i, /roadmap/i] },
  { target: "docs/tasks", type: "task", patterns: [/task/i, /todo/i, /work item/i] },
  { target: "docs/adr", patterns: [/adr/i, /decision/i, /architecture decision/i] },
  { target: "docs/impl/ir", patterns: [/implementation record/i, /impl record/i, /\bir\b/i] },
  { target: "docs/impl/exp", patterns: [/experiment/i, /\bexp\b/i, /spike/i] },
];
```

When a route has a `type`, write canonical front matter with that doc type. When a route has no `type`, preserve existing front matter and add a minimal title only if the source had none.

## Output Naming

Use the target directory's current numbering mode:

- If any target file matches `0001-*.md`, create `NNNN-slug.md`.
- If the target has only slug files, create `slug.md`.
- Empty target directories use numbered names.
- Split files append the split heading slug to avoid duplicate names.
- Existing targets use `-2`, `-3`, etc. before `.md`.

## Task 1: Add Migration Tests First

**Files:**

- Create: `scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-migrate.test.ts`

- [ ] **Step 1: Write the failing CLI test file**

Create `scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-migrate.test.ts` with this content:

```ts
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const skillRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-driven-dev-lifecycle-migrate-"));
}

function runMigrate(cwd, args = []) {
  const result = spawnSync(
    process.execPath,
    [path.join(skillRoot, "scripts", "migrate_docs.js"), ...args],
    {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    },
  );

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

test("migrate_docs dry-run reports planned canonical targets without writing files", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "legacy"), { recursive: true });
  fs.writeFileSync(path.join(repo, "legacy", "payment-spec.md"), "# Payment Spec\n\n## Acceptance Criteria\n\n- capture payments\n", "utf8");

  const result = runMigrate(repo, ["--from", "legacy", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.applied, false);
  assert.equal(report.migrations.length, 1);
  assert.equal(report.migrations[0].source, "legacy/payment-spec.md");
  assert.equal(report.migrations[0].targetDir, "docs/specs");
  assert.equal(report.migrations[0].type, "spec");
  assert.equal(fs.existsSync(path.join(repo, "docs", "specs")), false);
});

test("migrate_docs apply writes converted spec and preserves original", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "legacy"), { recursive: true });
  fs.writeFileSync(path.join(repo, "legacy", "payment-spec.md"), "# Payment Spec\n\n## Acceptance Criteria\n\n- capture payments\n", "utf8");

  const result = runMigrate(repo, ["--from", "legacy", "--apply"]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(repo, "legacy", "payment-spec.md")), true);
  const target = path.join(repo, "docs", "specs", "0001-payment-spec.md");
  assert.equal(fs.existsSync(target), true);
  const content = fs.readFileSync(target, "utf8");
  assert.match(content, /^id: "SPEC-0001"$/m);
  assert.match(content, /^type: "spec"$/m);
  assert.match(content, /^status: "draft"$/m);
  assert.match(content, /# Payment Spec/);
  assert.equal(fs.existsSync(path.join(repo, "docs", "designs", "overview.md")), false);
});

test("migrate_docs split-h1 creates separate discovery files", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "notes"), { recursive: true });
  fs.writeFileSync(path.join(repo, "notes", "workshop.md"), "# First Idea\n\nA\n\n# Second Idea\n\nB\n", "utf8");

  const result = runMigrate(repo, ["--from", "notes", "--split-h1", "--apply", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.applied, true);
  assert.equal(report.migrations.length, 2);
  assert.equal(fs.existsSync(path.join(repo, "docs", "ideas", "0001-first-idea.md")), true);
  assert.equal(fs.existsSync(path.join(repo, "docs", "ideas", "0002-second-idea.md")), true);
});

test("migrate_docs skips canonical docs by default", () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, "docs", "specs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs", "specs", "0001-existing.md"), "# Existing Spec\n", "utf8");

  const result = runMigrate(repo, ["--from", "docs", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.migrations.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-migrate.test.ts
```

Expected: FAIL because `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/migrate_docs.js` does not exist yet.

- [ ] **Step 3: Commit the failing test**

```powershell
git add scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-migrate.test.ts
git commit -m "test: cover lifecycle docs migration"
```

## Task 2: Implement Migration Core

**Files:**

- Modify: `scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts`

- [ ] **Step 1: Add migration types and constants near `ScaffoldTarget`**

Insert these definitions after the existing `ScaffoldTarget` type:

```ts
type MigrationDocType = DocType | null;

type MigrationInput = {
  body: string;
  source: string;
  title: string;
};

type MigrationPlan = {
  content: string;
  source: string;
  target: string;
  targetDir: string;
  title: string;
  type: MigrationDocType;
};

type MigrationOptions = {
  apply?: boolean;
  cwd: string;
  from?: string[];
  includeCanonical?: boolean;
  splitH1?: boolean;
};

type MigrationResult = {
  applied: boolean;
  created: string[];
  migrations: MigrationPlan[];
  skipped: { file: string; reason: string }[];
};

type MigrationRoute = {
  patterns: RegExp[];
  targetDir: string;
  type: MigrationDocType;
};

const canonicalDocDirs = scaffoldTargets.map((target) => target.dir);

const migrationRoutes: MigrationRoute[] = [
  { targetDir: "docs/ideas", type: "idea", patterns: [/idea/i, /proposal/i] },
  { targetDir: "docs/discovery", type: "brainstorm", patterns: [/discovery/i, /brainstorm/i, /research/i, /brief/i] },
  { targetDir: "docs/specs", type: "spec", patterns: [/spec/i, /requirement/i, /acceptance/i] },
  { targetDir: "docs/designs", type: "design", patterns: [/design/i, /architecture/i] },
  { targetDir: "docs/plans", type: "plan", patterns: [/plan/i, /roadmap/i] },
  { targetDir: "docs/tasks", type: "task", patterns: [/task/i, /todo/i, /work item/i] },
  { targetDir: "docs/adr", type: null, patterns: [/adr/i, /decision/i, /architecture decision/i] },
  { targetDir: "docs/impl/ir", type: null, patterns: [/implementation record/i, /impl record/i, /\bir\b/i] },
  { targetDir: "docs/impl/exp", type: null, patterns: [/experiment/i, /\bexp\b/i, /spike/i] },
];
```

- [ ] **Step 2: Add source discovery helpers before `scaffoldDocsTree`**

Insert these functions before `async function scaffoldDocsTree`:

```ts
function isMarkdownSource(file: string): boolean {
  return file.endsWith(".md") && !/^readme\.md$/i.test(path.basename(file)) && !/^index\.md$/i.test(path.basename(file));
}

function isUnderCanonicalDir(relativeFile: string): boolean {
  const normalized = normalizeDir(relativeFile);
  return canonicalDocDirs.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`));
}

function walkMarkdownFiles(baseDir: string): string[] {
  if (!fs.existsSync(baseDir)) return [];
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) return walkMarkdownFiles(fullPath);
    return isMarkdownSource(fullPath) ? [fullPath] : [];
  }).sort();
}

function defaultMigrationSources(cwd: string): string[] {
  return ["docs", "doc", "architecture", "design", "specs", "plans", "tasks"]
    .filter((dir) => fs.existsSync(path.join(cwd, dir)));
}

function headingTitle(content: string, fallback: string): string {
  const parsed = matter(content);
  const data = parsed.data || {};
  if (typeof data.title === "string" && data.title.trim()) return data.title.trim();
  const match = /^#\s+(.+)$/m.exec(parsed.content);
  return match?.[1]?.trim() || fallback;
}
```

- [ ] **Step 3: Add H1 splitting and classification helpers**

Insert these functions after `headingTitle`:

```ts
function splitByH1(source: string, content: string): MigrationInput[] {
  const parsed = matter(content);
  const body = parsed.content.trim();
  const matches = [...body.matchAll(/^#\s+(.+)$/gm)];
  if (matches.length <= 1) {
    return [{
      source,
      title: headingTitle(content, path.basename(source, ".md")),
      body,
    }];
  }

  return matches.map((match, index) => {
    const start = match.index || 0;
    const end = index + 1 < matches.length ? matches[index + 1].index || body.length : body.length;
    const chunk = body.slice(start, end).trim();
    return {
      source,
      title: match[1].trim(),
      body: chunk,
    };
  });
}

function routeFor(input: MigrationInput, sourceData: Record<string, unknown>): MigrationRoute {
  if (typeof sourceData.type === "string" && docTypes.includes(sourceData.type as DocType)) {
    const config = configFor(sourceData.type);
    return { targetDir: config.dir, type: config.type, patterns: [] };
  }

  const haystack = `${input.source}\n${input.title}\n${input.body.slice(0, 2000)}`;
  return migrationRoutes.find((route) => route.patterns.some((pattern) => pattern.test(haystack)))
    || { targetDir: "docs/discovery", type: "brainstorm", patterns: [] };
}

function nextAvailablePath(cwd: string, targetDir: string, baseName: string): string {
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);
  let candidate = path.join(targetDir, baseName);
  let suffix = 2;
  while (fs.existsSync(path.join(cwd, candidate))) {
    candidate = path.join(targetDir, `${stem}-${suffix}${ext}`);
    suffix += 1;
  }
  return candidate.replace(/\\/g, "/");
}
```

- [ ] **Step 4: Add conversion and migration functions**

Insert these functions after `nextAvailablePath`:

```ts
function migratedFrontMatter(type: DocType, number: number, title: string, date: string, source: string): string {
  const config = configFor(type);
  return frontMatter(config, number, title, config.defaultStatus, date, {
    source: [source],
    changes: {
      generated: [{ type: "migration", source }],
    },
  });
}

function migratedContent(input: MigrationInput, route: MigrationRoute, sourceContent: string, source: string, number: number, date: string): string {
  if (route.type) {
    return `${migratedFrontMatter(route.type, number, input.title, date, source)}\n\n${input.body.trim()}\n`;
  }

  const parsed = matter(sourceContent);
  const data = parsed.data || {};
  if (Object.keys(data).length > 0) return `${matter.stringify(input.body.trim(), data).trimEnd()}\n`;
  return `---\ntitle: ${quote(input.title)}\nsource: ${quote(source)}\n---\n\n${input.body.trim()}\n`;
}

function plannedMigration(cwd: string, source: string, input: MigrationInput, sourceContent: string, date: string): MigrationPlan {
  const sourceData = matterData(sourceContent);
  const route = routeFor(input, sourceData);
  const targetDir = route.targetDir;
  const fullTargetDir = path.join(cwd, targetDir);
  const existingFiles = fs.existsSync(fullTargetDir)
    ? fs.readdirSync(fullTargetDir).filter((file) => file.endsWith(".md"))
    : [];
  const number = nextNumber(existingFiles);
  const naming = detectNaming(existingFiles);
  const baseName = naming === "slug"
    ? `${slugify(input.title, route.type || "doc")}.md`
    : `${String(number).padStart(4, "0")}-${slugify(input.title, route.type || "doc")}.md`;
  const target = nextAvailablePath(cwd, targetDir, baseName);
  return {
    content: migratedContent(input, route, sourceContent, source, number, date),
    source,
    target,
    targetDir,
    title: input.title,
    type: route.type,
  };
}

async function migrateDocs(options: MigrationOptions): Promise<MigrationResult> {
  const cwd = path.resolve(options.cwd);
  const fromDirs = (options.from && options.from.length > 0) ? options.from : defaultMigrationSources(cwd);
  const skipped: MigrationResult["skipped"] = [];
  const migrations: MigrationPlan[] = [];
  const date = new Date().toISOString().slice(0, 10);

  for (const fromDir of fromDirs) {
    const fullFrom = path.resolve(cwd, fromDir);
    const files = walkMarkdownFiles(fullFrom);
    for (const fullFile of files) {
      const relativeFile = path.relative(cwd, fullFile).replace(/\\/g, "/");
      if (!options.includeCanonical && isUnderCanonicalDir(relativeFile)) {
        skipped.push({ file: relativeFile, reason: "canonical-doc" });
        continue;
      }

      const sourceContent = fs.readFileSync(fullFile, "utf8");
      const inputs = options.splitH1
        ? splitByH1(relativeFile, sourceContent)
        : [{
          source: relativeFile,
          title: headingTitle(sourceContent, path.basename(relativeFile, ".md")),
          body: matter(sourceContent).content.trim(),
        }];
      for (const input of inputs) {
        migrations.push(plannedMigration(cwd, relativeFile, input, sourceContent, date));
      }
    }
  }

  const created: string[] = [];
  if (options.apply) {
    await scaffoldDocsTree(cwd);
    for (const migration of migrations) {
      const targetPath = path.join(cwd, migration.target);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, migration.content, "utf8");
      created.push(migration.target);
    }
    for (const target of scaffoldTargets.filter((item) => item.type)) {
      const index = await buildIndex(cwd, target.type, target.dir);
      fs.writeFileSync(path.join(cwd, target.dir, "README.md"), index, "utf8");
    }
  }

  return { applied: Boolean(options.apply), created, migrations, skipped };
}
```

- [ ] **Step 5: Export the migration API**

Add `migrateDocs` to `module.exports`:

```ts
module.exports = {
  auditDocuments,
  buildIndex,
  buildGenericIndex,
  configFor,
  createDocument,
  docEntries,
  docFiles,
  docTypes,
  migrateDocs,
  relationFields,
  changeFields,
  changesSchema,
  frontMatterSchema,
  relationSchema,
  scaffoldDocsTree,
  validateFrontMatter,
};
```

- [ ] **Step 6: Run type/build feedback for this file**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-migrate.test.ts
```

Expected: still FAIL because the CLI entrypoint and generated distributed JS do not exist, but no syntax error should come from `doc_suite_utils.ts`.

## Task 3: Add `migrate_docs` CLI and Generated Script

**Files:**

- Create: `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/migrate_docs.ts`
- Create after build: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/migrate_docs.js`

- [ ] **Step 1: Create the CLI entrypoint**

Create `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/migrate_docs.ts` with:

```ts
#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { migrateDocs } = require("../../lib/doc_suite_utils.ts");

type CliArgs = {
  apply: boolean;
  cwd: string;
  from: string[];
  help?: boolean;
  includeCanonical: boolean;
  json: boolean;
  splitH1: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    apply: false,
    cwd: process.cwd(),
    from: [],
    includeCanonical: false,
    json: false,
    splitH1: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--from") args.from.push(argv[++i]);
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--include-canonical") args.includeCanonical = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--split-h1") args.splitH1 = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/migrate_docs.js [--cwd <path>] [--from <dir>] [--split-h1] [--include-canonical] [--apply] [--json]";
}

function printHuman(report: { applied: boolean; created: string[]; migrations: any[]; skipped: any[] }): void {
  console.log(`${report.applied ? "Applied" : "Planned"} docs migration`);
  if (report.migrations.length === 0) console.log("No source documents selected.");
  for (const migration of report.migrations) {
    console.log(`${migration.source} -> ${migration.target}${migration.type ? ` [${migration.type}]` : ""}`);
  }
  for (const created of report.created) {
    console.log(`Created ${created}`);
  }
  for (const skipped of report.skipped) {
    console.log(`Skipped ${skipped.file}: ${skipped.reason}`);
  }
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }

    const report = await migrateDocs({
      apply: args.apply,
      cwd: path.resolve(args.cwd),
      from: args.from,
      includeCanonical: args.includeCanonical,
      splitH1: args.splitH1,
    });

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    printHuman(report);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
```

- [ ] **Step 2: Build distributed scripts**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev run build:scripts
```

Expected: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/migrate_docs.js` is created. Existing generated JS files may update because the shared bundled helper changed.

- [ ] **Step 3: Run migration tests**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-migrate.test.ts
```

Expected: PASS for all tests in `doc-driven-dev-lifecycle-migrate.test.ts`.

- [ ] **Step 4: Commit implementation**

```powershell
git add scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/migrate_docs.ts packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/migrate_docs.js packages/doc-driven-dev/.apm/skills/*/scripts/*.js
git commit -m "feat: add lifecycle docs migration command"
```

## Task 4: Document Migration Contract

**Files:**

- Create: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/migration-contract.md`
- Create: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/migration-contract.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.ja.md`

- [ ] **Step 1: Add English migration contract**

Create `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/migration-contract.md`:

```markdown
# doc-driven-dev-lifecycle Migration Contract

This document defines how `migrate_docs` brings existing Markdown documentation
into the canonical doc-driven-dev tree.

## Position in the Lifecycle

Migration is an optional Phase -1 for repositories that already have
documentation before adopting doc-driven-dev. Run it before Phase 0
`scaffold_docs`.

## Safety Rules

- Dry-run is the default.
- `--apply` creates converted canonical documents.
- Original source documents are preserved.
- Existing canonical target files are not overwritten.
- Existing canonical directories are skipped by default.
- `docs/designs/overview.md` is still owned by `design-doc`.

## Supported Transformations

- Inventory Markdown files from one or more `--from` directories.
- Classify each document into the canonical docs tree.
- Convert known doc types to canonical front matter.
- Preserve ADR, implementation record, and experiment log content with minimal metadata.
- Split multi-H1 source files when `--split-h1` is passed.

## Completion

- Dry-run report lists every planned source-to-target mapping.
- Apply run creates the reported files.
- Existing source files remain present.
- `doc-status` can audit the resulting canonical docs.
```

- [ ] **Step 2: Add Japanese migration contract**

Create `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/migration-contract.ja.md`:

```markdown
# doc-driven-dev-lifecycle Migration Contract

この文書は、既存の Markdown ドキュメントを `migrate_docs` で
doc-driven-dev の canonical tree へ取り込む契約を定義します。

## ライフサイクル上の位置づけ

migration は、既にドキュメントを持つリポジトリが doc-driven-dev を導入する
場合の任意の Phase -1 です。Phase 0 の `scaffold_docs` より前に実行します。

## Safety Rules

- 既定は dry-run です。
- `--apply` は変換済みの canonical document を作成します。
- 元の source document は保持します。
- 既存の canonical target file は上書きしません。
- 既存の canonical directory は既定で移行元から除外します。
- `docs/designs/overview.md` は引き続き `design-doc` が所有します。

## Supported Transformations

- 1 つ以上の `--from` directory から Markdown file を棚卸しします。
- 各 document を canonical docs tree に分類します。
- 既知の doc type を canonical front matter へ変換します。
- ADR、implementation record、experiment log は最小 metadata で内容を保持します。
- `--split-h1` 指定時は複数 H1 を持つ source file を分割します。

## Completion

- Dry-run report が全 source-to-target mapping を表示します。
- Apply run が report された file を作成します。
- 既存の source file は残ります。
- 生成後の canonical docs は `doc-status` で audit できます。
```

- [ ] **Step 3: Update lifecycle skill docs**

Modify English and Japanese lifecycle docs so the process begins with optional migration:

```markdown
For existing repositories, run `migrate_docs` as an optional Phase -1 before
Phase 0. Use dry-run first, review the planned source-to-target mappings, then
rerun with `--apply` only when the mapping is acceptable.
```

Japanese equivalent:

```markdown
既存ドキュメントを持つ repository では、Phase 0 の前に任意の Phase -1 として
`migrate_docs` を実行します。まず dry-run で source-to-target mapping を確認し、
mapping が妥当な場合だけ `--apply` で再実行します。
```

- [ ] **Step 4: Update flow contracts**

Add a Phase -1 row before Phase 0 in both flow contracts:

```markdown
| -1 | Migrate existing docs into canonical structure | `migrate_docs` | dry-run reviewed; apply creates canonical docs without deleting originals |
```

Japanese equivalent:

```markdown
| -1 | 既存 docs を canonical structure に移行する | `migrate_docs` | dry-run を確認済み; apply は original を削除せず canonical docs を作成する |
```

- [ ] **Step 5: Commit docs**

```powershell
git add packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/migration-contract.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/migration-contract.ja.md
git commit -m "docs: document lifecycle docs migration"
```

## Task 5: Update Package README and Command Inventory

**Files:**

- Modify: `packages/doc-driven-dev/README.md`
- Modify: `packages/doc-driven-dev/README.ja.md`

- [ ] **Step 1: Update English README command list**

Add `migrate_docs` near `scaffold_docs`:

```markdown
- `migrate_docs`: dry-run or apply migration of existing Markdown docs into the canonical doc-driven-dev tree.
```

Add a usage block:

````markdown
### Migrating Existing Docs

Run dry-run first:

```bash
node .apm/skills/doc-driven-dev-lifecycle/scripts/migrate_docs.js --from docs --json
```

Apply only after reviewing the mapping:

```bash
node .apm/skills/doc-driven-dev-lifecycle/scripts/migrate_docs.js --from docs --split-h1 --apply
```

The command preserves source files and never overwrites existing canonical targets.
````

- [ ] **Step 2: Update Japanese README command list**

Add the equivalent Japanese text:

```markdown
- `migrate_docs`: 既存 Markdown docs を canonical な doc-driven-dev tree へ移行するための dry-run / apply command。
```

Add usage:

````markdown
### 既存 Docs の Migration

まず dry-run します:

```bash
node .apm/skills/doc-driven-dev-lifecycle/scripts/migrate_docs.js --from docs --json
```

Mapping を確認してから apply します:

```bash
node .apm/skills/doc-driven-dev-lifecycle/scripts/migrate_docs.js --from docs --split-h1 --apply
```

この command は source file を保持し、既存の canonical target を上書きしません。
````

- [ ] **Step 3: Run markdown lint on touched docs**

Run:

```powershell
pnpm --dir scripts/doc-driven-dev run lint:md
```

Expected: PASS, or only pre-existing markdownlint debt outside the touched lines. If new errors appear in touched files, fix them before committing.

- [ ] **Step 4: Commit README updates**

```powershell
git add packages/doc-driven-dev/README.md packages/doc-driven-dev/README.ja.md
git commit -m "docs: add docs migration usage"
```

## Task 6: Full Verification and Package Integrity

**Files:**

- Verify generated outputs and touched docs.

- [ ] **Step 1: Run focused migration tests**

```powershell
pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-migrate.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run scaffold regression tests**

```powershell
pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-scaffold.test.ts
```

Expected: PASS, confirming migration did not change Phase 0 scaffold behavior.

- [ ] **Step 3: Run full package tests**

```powershell
pnpm --dir scripts/doc-driven-dev test
```

Expected: PASS except for known unrelated baseline failures. If `tests/deep-dive.test.ts` still fails on missing `Post-Acceptance Lifecycle`, record it as unrelated and do not fix it in this migration branch.

- [ ] **Step 4: Rebuild distributed scripts**

```powershell
pnpm --dir scripts/doc-driven-dev run build:scripts
```

Expected: generated `.apm/skills/**/scripts/*.js` files match source changes and include `migrate_docs.js`.

- [ ] **Step 5: Run markdown lint**

```powershell
pnpm --dir scripts/doc-driven-dev run lint:md
```

Expected: PASS for touched package docs.

- [ ] **Step 6: Inspect final diff**

```powershell
git status --short
git diff --stat HEAD
```

Expected: only migration source, tests, generated scripts, lifecycle docs, README files, and this plan are changed.

- [ ] **Step 7: Commit final verification updates**

If the build or docs steps changed generated files after the earlier commits:

```powershell
git add packages/doc-driven-dev/.apm/skills/*/scripts/*.js packages/doc-driven-dev/README.md packages/doc-driven-dev/README.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle packages/doc-driven-dev/docs/superpowers/plans/2026-06-16-doc-driven-dev-migrate-docs.md
git commit -m "chore: finalize docs migration package outputs"
```

If there are no remaining changes except this plan:

```powershell
git add packages/doc-driven-dev/docs/superpowers/plans/2026-06-16-doc-driven-dev-migrate-docs.md
git commit -m "docs: plan lifecycle docs migration"
```

## Verification Matrix

| Area | Command | Expected Result |
| ---- | ------- | --------------- |
| Migration CLI | `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-migrate.test.ts` | PASS |
| Scaffold regression | `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-scaffold.test.ts` | PASS |
| Full tests | `pnpm --dir scripts/doc-driven-dev test` | PASS, or known unrelated `deep-dive.test.ts` baseline failure documented |
| Generated scripts | `pnpm --dir scripts/doc-driven-dev run build:scripts` | `migrate_docs.js` generated |
| Markdown docs | `pnpm --dir scripts/doc-driven-dev run lint:md` | PASS for touched docs |

## Rollback Plan

If the migration behavior is wrong:

1. Remove `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/migrate_docs.ts`.
2. Revert migration additions in `scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts`.
3. Remove `scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-migrate.test.ts`.
4. Re-run `pnpm --dir scripts/doc-driven-dev run build:scripts` so generated `.apm` scripts no longer include `migrate_docs.js`.
5. Revert lifecycle and README documentation mentioning migration.

## Self-Review

- [x] Spec coverage: plan covers organizing, converting, splitting, dry-run reporting, apply mode, canonical routing, and original-file preservation.
- [x] Placeholder scan: task steps contain concrete files, code, commands, and expected outcomes.
- [x] Type consistency: `migrateDocs`, `MigrationOptions`, `MigrationResult`, `MigrationPlan`, `splitH1`, and `includeCanonical` names are consistent across tests, implementation, CLI, and docs.
- [x] Boundary check: `docs/designs/overview.md` remains owned by `design-doc`; migration does not create it directly.
- [x] Safety check: destructive move/delete behavior is not part of the first migration implementation.
