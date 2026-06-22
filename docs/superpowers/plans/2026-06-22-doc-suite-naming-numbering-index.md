# doc-suite Naming / Numbering / Index Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `doc-driven-dev` の文書生成スクリプト（`new_design.js` ほか `createDocument` 系全スクリプト）が「slug 命名 + サブディレクトリ配置 + front matter にのみ存在する連番 ID + 手キュレーション索引」という設計規約と非互換である 3 つのバグ（ID 衝突 / フラット配置 / 索引クロバー）を解消する。

**Architecture:** 全 `new_*.js` は共有モジュール `scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts` の `createDocument()` を呼ぶ。バグはすべてこの 1 関数（と `document_utils.ts` の採番補助）に集約しているため、共有層を修正すれば design/spec/plan/task/idea/discovery 全種に一括で効く。TS ソースを esbuild でバンドルし `packages/doc-driven-dev/.apm/skills/<skill>/scripts/<name>.js` に出力する。テストは `tests/*.test.ts`（`node:test` + spawn でビルド済みバンドルを実行）。**TS を編集したら必ず `pnpm build` してからテストする**（テストはバンドルを spawn するため、ビルドしないと変更が反映されない）。

**Tech Stack:** TypeScript（CommonJS, esbuild bundle, target node20）、`gray-matter`、`node:test`、pnpm@11.2.2（`mise exec -- pnpm` 経由）、Node 24。

---

## 背景と根本原因

対象リポジトリ消費側で起きた問題は `docs/discovery/new-design-js-naming-incompatibility.md`（DISC-0006, code-knowledge リポジトリ）に記録済み。本リポジトリ（上流）の対応するソースは以下:

- `scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts` … `createDocument()` (914–943), `buildIndex()` (681–698)
- `scripts/doc-driven-dev/src/skills/lib/document_utils.ts` … `nextNumber()` (25–31), `detectNaming()` (19–23)

3 つのバグと根本原因:

1. **ID 衝突** — `createDocument` は `nextNumber(files)` をファイル名 `^(\d{4})-.+\.md$` からのみ算出。slug 命名（接頭辞なし）リポジトリでは常に 1 を返し、front matter `id:` の連番（例 DESIGN-0025）を無視して DESIGN-0001 を再生成する。
2. **フラット配置 + サブディレクトリ不可視** — `createDocument` は `fs.readdirSync(fullDir)`（非再帰）で採番・命名判定し、ファイルを `fullDir` 直下にのみ生成する。サブディレクトリの既存設計が見えず、`<feature>/design.md` 規約を生成できない。
3. **索引クロバー** — `buildIndex()` の生成結果で `README.md` を無条件 `writeFileSync`（全上書き）し、手キュレーションのグルーピングを破壊する。

### 修正方針（後方互換を厳守）

既存テストは「numbered 規約（`0001-foo.md` + front matter id ミラー）」を前提に多数あり、これを壊さないことが必須。そこで:

- **命名判定は再帰化**するが、判定スコープは「正規ルート（`docs/designs` 等）配下を再帰走査した basename 群（`overview.md` 等の予約ファイルは除外）」。
- **採番は命名で分岐**する。
  - `numbered` → 従来どおり対象ディレクトリ直下のファイル名 `NNNN-` から算出（ローカル採番。conventions の「カテゴリ毎ローカル採番」を維持）。
  - `slug` → 正規ルート配下を再帰走査し front matter `id:` の `PREFIX-NNNN` 最大値 +1（グローバル採番）。これがバグ 1 の本丸。
- **`overview.md`（design）と索引 README は正規ルートに固定**。サブディレクトリ書き込み時もルートの README を更新対象にする。
- **索引は生成マーカー方式で非破壊化**。生成 index に `<!-- doc-suite:generated-index -->` を埋め込み、既存 README にマーカーが無い（= 手キュレーション）場合は上書きせず警告。新規・生成済みは従来どおり上書き。`--no-index` / `--force-index` で明示制御。
- **`--name <filename>` を追加**し、`--dir docs/designs/<feature> --name design.md` で `<feature>/design.md` 規約を再現可能にする。

numbered なテスト用一時リポジトリでは「正規ルート == 対象ディレクトリ」「README は毎回新規生成（マーカー付き）」「サブディレクトリ無し」のため、上記すべてが従来挙動と一致する（後方互換）。

---

## File Structure

| File | 役割 | 変更種別 |
| --- | --- | --- |
| `scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts` | 共有文書生成ロジック。`createDocument` の採番/命名/配置/索引を修正、補助関数と `--name`/`--no-index`/`--force-index` オプションを追加 | Modify |
| `scripts/doc-driven-dev/src/skills/design-doc/scripts/new_design.ts` | `--name`/`--no-index`/`--force-index` の引数解析と索引スキップ警告出力 | Modify |
| `scripts/doc-driven-dev/src/skills/spec-doc/scripts/new_spec.ts` | 同上（共有オプションの横展開） | Modify |
| `scripts/doc-driven-dev/src/skills/plan-doc/scripts/new_plan.ts` | 同上 | Modify |
| `scripts/doc-driven-dev/src/skills/task-doc/scripts/new_task.ts` | 同上 | Modify |
| `scripts/doc-driven-dev/src/skills/idea-doc/scripts/new_idea.ts` | 同上 | Modify |
| `scripts/doc-driven-dev/src/skills/discovery-doc/scripts/new_discovery.ts` | 同上 | Modify |
| `scripts/doc-driven-dev/tests/doc-suite.test.ts` | 新挙動の統合テスト追加 | Modify |
| `packages/doc-driven-dev/.apm/skills/*/scripts/new_*.js` | ビルド成果物（バンドル）。`pnpm build` で再生成 | Generated |
| `packages/doc-driven-dev/.apm/skills/design-doc/references/design-conventions.md` / `.ja.md` | 採番・`--name`・索引マーカーの仕様を追記 | Modify |

---

## Task 1: 共有 `createDocument` の再帰命名判定・front matter グローバル採番・索引非破壊化

front matter `id:` ベースのグローバル採番（slug 時）、再帰命名判定、`overview.md`/索引のルート固定、生成マーカーによる非破壊索引を実装する。これがバグ 1・3 とバグ 2 の「サブディレクトリ不可視」を解消する中核。

**Files:**
- Modify: `scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts`
- Modify: `scripts/doc-driven-dev/src/skills/design-doc/scripts/new_design.ts:56-57`
- Test: `scripts/doc-driven-dev/tests/doc-suite.test.ts`

- [ ] **Step 1: Write the failing test**

`scripts/doc-driven-dev/tests/doc-suite.test.ts` の末尾（最終行の閉じ括弧の後）に追記する。`tempRepo` / `runScript` は同ファイル冒頭で定義済み。

```ts
test("new_design continues front-matter id numbering and preserves slug naming in slug repos", () => {
  const repo = tempRepo();
  const designs = path.join(repo, "docs/designs");
  fs.mkdirSync(path.join(designs, "storage-port"), { recursive: true });

  // 予約ファイル（採番・命名から除外されること）
  fs.writeFileSync(path.join(designs, "overview.md"), [
    "---", 'id: "DESIGN-OVERVIEW"', 'type: "design"', 'status: "draft"',
    'title: "System Design Overview"', 'created: "2026-06-01"', 'updated: "2026-06-01"',
    "owners: []", "relations:", "  source: []", "---", "", "# System Design Overview", "",
  ].join("\n"), "utf8");

  // slug 命名のトップレベル設計（id DESIGN-0005）
  fs.writeFileSync(path.join(designs, "analysis-pipeline.md"), [
    "---", 'id: "DESIGN-0005"', 'type: "design"', 'status: "approved"',
    'title: "Analysis Pipeline"', 'created: "2026-06-02"', 'updated: "2026-06-02"',
    "owners: []", "relations:", "  source: []", "---", "", "# Analysis Pipeline", "",
  ].join("\n"), "utf8");

  // サブディレクトリの設計（id DESIGN-0025、非再帰では不可視）
  fs.writeFileSync(path.join(designs, "storage-port", "design.md"), [
    "---", 'id: "DESIGN-0025"', 'type: "design"', 'status: "approved"',
    'title: "Storage Port"', 'created: "2026-06-03"', 'updated: "2026-06-03"',
    "owners: []", "relations:", "  source: []", "---", "", "# Storage Port", "",
  ].join("\n"), "utf8");

  // 手キュレーション索引（生成マーカー無し）
  const handCurated = "# Curated Design Index\n\n## Approved\n\n- analysis-pipeline\n- storage-port\n";
  fs.writeFileSync(path.join(designs, "README.md"), handCurated, "utf8");

  const result = runScript("design-doc", "new_design.js",
    ["--title", "Graph Visualization", "--status", "approved"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);

  // slug 命名で生成され、front matter id はグローバル連番 DESIGN-0026（max(5,25)+1）
  const created = path.join(designs, "graph-visualization.md");
  assert.equal(fs.existsSync(created), true, "slug-named file expected");
  const body = fs.readFileSync(created, "utf8");
  assert.match(body, /^id: "DESIGN-0026"$/m);

  // 手キュレーション README は保持される（クロバーしない）
  assert.equal(fs.readFileSync(path.join(designs, "README.md"), "utf8"), handCurated,
    "hand-curated README must be preserved");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `mise exec -- pnpm -C scripts/doc-driven-dev exec tsx --test --test-name-pattern "continues front-matter id numbering" tests/doc-suite.test.ts`

Expected: FAIL（現状のバンドルは ID を DESIGN-0001 で再生成し、README を全上書きするため、`id: "DESIGN-0026"` 不一致または README 不一致で失敗）。

- [ ] **Step 3: Add shared constants and helper functions in `doc_suite_utils.ts`**

`configFor` 関数の直前（現在の 256 行目 `function configFor` の直前）に以下を挿入する。

```ts
const GENERATED_INDEX_MARKER = "<!-- doc-suite:generated-index -->";

function canonicalRootDir(cwd: string, type: string): string {
  const config = configFor(type);
  return findDocumentDir(cwd, undefined, config.dirs, config.dir);
}

function isUnderDir(child: string, parent: string): boolean {
  const c = normalizeDir(child);
  const p = normalizeDir(parent);
  return c === p || c.startsWith(`${p}/`);
}

function recursiveBasenames(cwd: string, relativeDir: string, type: DocType): string[] {
  const fullDir = path.join(cwd, relativeDir);
  return walkMarkdownFiles(fullDir)
    .map((fullPath) => path.basename(fullPath))
    .filter((file) => !isReservedDocFile(type, file));
}

function nextNumberFromFrontMatter(cwd: string, relativeDir: string, idPrefix: string): number {
  const fullDir = path.join(cwd, relativeDir);
  const pattern = new RegExp(`^${idPrefix}-(\\d{4})$`);
  const numbers = walkMarkdownFiles(fullDir)
    .map((fullPath) => matterData(fs.readFileSync(fullPath, "utf8")).id)
    .filter((id): id is string => typeof id === "string")
    .map((id) => pattern.exec(id.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => Number(match[1]));
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name.trim());
  return base.toLowerCase().endsWith(".md") ? base : `${base}.md`;
}
```

- [ ] **Step 4: Extend `CreateDocumentOptions` type**

`doc_suite_utils.ts` の `CreateDocumentOptions`（現在の 79–86 行）を以下に置換する。

```ts
type CreateDocumentOptions = {
  cwd: string;
  date?: string;
  dir?: string;
  forceIndex?: boolean;
  name?: string;
  noIndex?: boolean;
  relations?: RelationInput;
  status?: string;
  title: string;
};
```

- [ ] **Step 5: Embed the generated-index marker in `buildIndex`**

`buildIndex` の return 文（現在の 697 行）を以下に置換する。

```ts
  return `# ${title}\n\n${GENERATED_INDEX_MARKER}\n\nDirectory: \`${relativeDir.replace(/\\/g, "/")}\`\n\n${body}\n`;
```

- [ ] **Step 6: Add the non-destructive index writer**

`createDocument` 関数の直前（現在の 914 行 `async function createDocument` の直前）に以下を挿入する。

```ts
type IndexWriteResult = { path: string; written: boolean; reason: string | null };

async function writeGeneratedIndex(cwd: string, type: DocType, relativeDir: string, options: CreateDocumentOptions): Promise<IndexWriteResult> {
  const indexPath = path.join(cwd, relativeDir, "README.md");
  const relIndex = path.relative(cwd, indexPath).replace(/\\/g, "/");
  if (options.noIndex) return { path: relIndex, written: false, reason: "disabled" };

  const content = await buildIndex(cwd, type, relativeDir);
  const existing = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : null;
  const isGenerated = existing === null || existing.includes(GENERATED_INDEX_MARKER);
  if (!isGenerated && !options.forceIndex) {
    return { path: relIndex, written: false, reason: "hand-curated" };
  }

  fs.writeFileSync(indexPath, content, "utf8");
  return { path: relIndex, written: true, reason: null };
}
```

- [ ] **Step 7: Rewrite `createDocument`**

`createDocument`（現在の 914–943 行）を以下に全置換する。

```ts
async function createDocument(type: DocType, options: CreateDocumentOptions): Promise<{ file: string; index: string; indexWritten: boolean; indexSkippedReason: string | null; relativeDir: string }> {
  const config = configFor(type);
  const cwd = path.resolve(options.cwd);
  const relativeDir = docDir(cwd, type, options.dir);
  const fullDir = path.join(cwd, relativeDir);
  fs.mkdirSync(fullDir, { recursive: true });

  const rootDir = canonicalRootDir(cwd, type);
  const underRoot = isUnderDir(relativeDir, rootDir);
  const scopeDir = underRoot ? rootDir : relativeDir;

  const naming = detectNaming(recursiveBasenames(cwd, scopeDir, type));
  const localFiles = fs.readdirSync(fullDir)
    .filter((file) => file.endsWith(".md"))
    .filter((file) => !isReservedDocFile(type, file));
  const number = naming === "slug"
    ? nextNumberFromFrontMatter(cwd, scopeDir, config.idPrefix)
    : nextNumber(localFiles);

  const filename = options.name
    ? sanitizeFileName(options.name)
    : naming === "slug"
      ? `${slugify(options.title, type)}.md`
      : `${String(number).padStart(4, "0")}-${slugify(options.title, type)}.md`;
  const outputPath = path.join(fullDir, filename);
  if (fs.existsSync(outputPath)) throw new Error(`Document already exists: ${path.relative(cwd, outputPath)}`);

  const date = options.date || new Date().toISOString().slice(0, 10);
  const status = options.status || config.defaultStatus;
  const content = `${frontMatter(config, number, options.title, status, date, options.relations)}\n\n${bodyFor(type, options.title)}\n`;
  fs.writeFileSync(outputPath, content, "utf8");

  if (type === "design") ensureDesignOverview(path.join(cwd, rootDir), date);

  const indexRelativeDir = underRoot ? rootDir : relativeDir;
  const indexResult = await writeGeneratedIndex(cwd, type, indexRelativeDir, options);

  return {
    file: path.relative(cwd, outputPath).replace(/\\/g, "/"),
    index: indexResult.path,
    indexWritten: indexResult.written,
    indexSkippedReason: indexResult.reason,
    relativeDir,
  };
}
```

- [ ] **Step 8: Update `new_design.ts` output to surface a skipped/hand-curated index**

`new_design.ts` の出力ブロック（現在の 56–57 行）:

```ts
    console.log(`Created ${result.file}`);
    console.log(`Updated ${result.index}`);
```

を以下に置換する。

```ts
    console.log(`Created ${result.file}`);
    if (result.indexWritten) {
      console.log(`Updated ${result.index}`);
    } else if (result.indexSkippedReason === "hand-curated") {
      console.warn(`Skipped index update: ${result.index} appears hand-curated (no generated marker). Update it manually or pass --force-index.`);
    } else if (result.indexSkippedReason === "disabled") {
      console.log(`Skipped index update (--no-index): ${result.index}`);
    }
```

- [ ] **Step 9: Build the bundles and run the new test**

Run:
```bash
mise exec -- pnpm -C scripts/doc-driven-dev build
mise exec -- pnpm -C scripts/doc-driven-dev exec tsx --test --test-name-pattern "continues front-matter id numbering" tests/doc-suite.test.ts
```
Expected: PASS（`id: "DESIGN-0026"` 一致、手キュレーション README 保持）。

- [ ] **Step 10: Run the full suite to confirm no regressions**

Run: `mise exec -- pnpm -C scripts/doc-driven-dev test`
Expected: PASS（195 既存テスト + 1 新規 = 196 件、fail 0）。numbered 一時リポジトリは正規ルート == 対象ディレクトリ・README 毎回新規生成のため従来挙動と一致する。

- [ ] **Step 11: Commit**

```bash
git add scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts \
        scripts/doc-driven-dev/src/skills/design-doc/scripts/new_design.ts \
        scripts/doc-driven-dev/tests/doc-suite.test.ts \
        packages/doc-driven-dev/.apm/skills
git commit -m "fix(doc-driven-dev): number from front matter ids and preserve hand-curated indexes

Slug-naming repos now continue the global DESIGN/SPEC/... id sequence from
front matter (recursive walk) instead of regenerating NNNN-0001, and README
indexes with no generated marker are preserved instead of clobbered.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `--name` による明示ファイル名とサブディレクトリ配置

`--dir docs/designs/<feature> --name design.md` で `<feature>/design.md` 規約を再現可能にする（バグ 2 の本丸）。`createDocument` は Task 1 で既に `options.name` に対応済みなので、本タスクは CLI への引数配線が中心。

**Files:**
- Modify: `scripts/doc-driven-dev/src/skills/design-doc/scripts/new_design.ts`
- Modify: `scripts/doc-driven-dev/src/skills/spec-doc/scripts/new_spec.ts`
- Modify: `scripts/doc-driven-dev/src/skills/plan-doc/scripts/new_plan.ts`
- Modify: `scripts/doc-driven-dev/src/skills/task-doc/scripts/new_task.ts`
- Modify: `scripts/doc-driven-dev/src/skills/idea-doc/scripts/new_idea.ts`
- Modify: `scripts/doc-driven-dev/src/skills/discovery-doc/scripts/new_discovery.ts`
- Test: `scripts/doc-driven-dev/tests/doc-suite.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/doc-suite.test.ts` の末尾に追記する。

```ts
test("new_design honors --dir and --name for subdirectory placement with global numbering", () => {
  const repo = tempRepo();
  const designs = path.join(repo, "docs/designs");
  fs.mkdirSync(designs, { recursive: true });

  fs.writeFileSync(path.join(designs, "overview.md"), [
    "---", 'id: "DESIGN-OVERVIEW"', 'type: "design"', 'status: "draft"',
    'title: "System Design Overview"', 'created: "2026-06-01"', 'updated: "2026-06-01"',
    "owners: []", "relations:", "  source: []", "---", "", "# System Design Overview", "",
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(designs, "analysis-pipeline.md"), [
    "---", 'id: "DESIGN-0007"', 'type: "design"', 'status: "approved"',
    'title: "Analysis Pipeline"', 'created: "2026-06-02"', 'updated: "2026-06-02"',
    "owners: []", "relations:", "  source: []", "---", "", "# Analysis Pipeline", "",
  ].join("\n"), "utf8");

  const result = runScript("design-doc", "new_design.js", [
    "--title", "Graph Visualization",
    "--dir", "docs/designs/graph-visualization",
    "--name", "design.md",
    "--status", "approved",
  ], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);

  const created = path.join(designs, "graph-visualization", "design.md");
  assert.equal(fs.existsSync(created), true, "<feature>/design.md expected");
  assert.match(fs.readFileSync(created, "utf8"), /^id: "DESIGN-0008"$/m);

  // overview と index はサブディレクトリではなくルートに置かれる
  assert.equal(fs.existsSync(path.join(designs, "overview.md")), true);
  assert.equal(fs.existsSync(path.join(designs, "graph-visualization", "overview.md")), false);
  assert.equal(fs.existsSync(path.join(designs, "graph-visualization", "README.md")), false);

  // ルート README は新規生成（マーカー付き）され、サブディレクトリの設計を相対リンクで含む
  const index = fs.readFileSync(path.join(designs, "README.md"), "utf8");
  assert.match(index, /<!-- doc-suite:generated-index -->/);
  assert.match(index, /graph-visualization\/design\.md/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `mise exec -- pnpm -C scripts/doc-driven-dev exec tsx --test --test-name-pattern "honors --dir and --name" tests/doc-suite.test.ts`
Expected: FAIL（現状の `new_design.js` は `--name` を未知の引数として `Unknown argument: --name` で exit 1）。

- [ ] **Step 3: Wire `--name` into `new_design.ts`**

`new_design.ts` の `CliArgs` 型（現在の 7–15 行）に `name?: string;` を追加する。置換後:

```ts
type CliArgs = {
  cwd: string;
  date?: string;
  dir?: string;
  derivesFrom: string[];
  help?: boolean;
  name?: string;
  status?: string;
  title?: string;
};
```

`parseArgs` の `--dir` 分岐の直後（現在の 23 行 `else if (arg === "--dir") args.dir = argv[++i];` の次の行）に追加する。

```ts
    else if (arg === "--name") args.name = argv[++i];
```

`usage()`（現在の 35 行）を以下に置換する。

```ts
  return "Usage: node scripts/new_design.js --title <title> [--from <doc>] [--dir <path>] [--name <filename>] [--status <status>]";
```

`createDocument("design", {...})` 呼び出し（現在の 46–55 行）に `name: args.name,` を追加する。置換後:

```ts
    const result = await createDocument("design", {
      cwd: path.resolve(args.cwd),
      date: args.date,
      dir: args.dir,
      name: args.name,
      relations: {
        "derives-from": args.derivesFrom,
      },
      status: args.status,
      title: args.title,
    });
```

- [ ] **Step 4: Wire `--name` into the other five CLIs**

以下の各ファイルに同一パターンを適用する（`CliArgs` に `name?: string;` 追加、`parseArgs` の `--dir` 分岐直後に `else if (arg === "--name") args.name = argv[++i];` 追加、`usage()` に `[--name <filename>]` 追加、`createDocument(...)` 呼び出しに `name: args.name,` を `dir: args.dir,` の直後に追加）。

`scripts/doc-driven-dev/src/skills/spec-doc/scripts/new_spec.ts`:
- `CliArgs`（16 行で `args` を生成する直前の型, 7–14 行）に `name?: string;` を追加。
- `parseArgs` の `--dir`（21 行）直後に `else if (arg === "--name") args.name = argv[++i];`。
- `usage()`（33 行）→ `"Usage: node scripts/new_spec.js --title <title> [--dir <path>] [--name <filename>] [--status <status>]"`。
- `createDocument("spec", {...})`（44–50 行）の `dir: args.dir,` 直後に `name: args.name,`。

`scripts/doc-driven-dev/src/skills/plan-doc/scripts/new_plan.ts`:
- `CliArgs`（11–20 行）に `name?: string;` を追加。
- `parseArgs` の `--dir`（29 行）直後に `else if (arg === "--name") args.name = argv[++i];`。
- `usage()`（41 行）の末尾 `[--status <status>]` の前に `[--name <filename>] ` を挿入。
- `createDocument("plan", {...})`（92–102 行）の `dir: args.dir,` 直後に `name: args.name,`。

`scripts/doc-driven-dev/src/skills/task-doc/scripts/new_task.ts`:
- `CliArgs`（7–15 行）に `name?: string;` を追加。
- `parseArgs` の `--dir`（23 行）直後に `else if (arg === "--name") args.name = argv[++i];`。
- `usage()`（35 行）→ `"Usage: node scripts/new_task.js --title <title> [--plan <plan>] [--dir <path>] [--name <filename>] [--status <status>]"`。
- `createDocument("task", {...})`（47–57 行）の `dir: args.dir,` 直後に `name: args.name,`。

`scripts/doc-driven-dev/src/skills/idea-doc/scripts/new_idea.ts`:
- `CliArgs`（7–15 行）に `name?: string;` を追加。
- `parseArgs` の `--dir`（23 行）直後に `else if (arg === "--name") args.name = argv[++i];`。
- `usage()`（35 行）→ `"Usage: node scripts/new_idea.js --title <title> [--from <source>] [--dir <path>] [--name <filename>] [--status <status>]"`。
- `createDocument("idea", {...})`（46–55 行）の `dir: args.dir,` 直後に `name: args.name,`。

`scripts/doc-driven-dev/src/skills/discovery-doc/scripts/new_discovery.ts`:
- `CliArgs`（7–15 行）に `name?: string;` を追加。
- `parseArgs` の `--dir`（23 行）直後に `else if (arg === "--name") args.name = argv[++i];`。
- `usage()`（35 行）→ `"Usage: node scripts/new_discovery.js --title <title> [--from <doc>] [--dir <path>] [--name <filename>] [--status <status>]"`。
- `createDocument("discovery", {...})`（46–55 行）の `dir: args.dir,` 直後に `name: args.name,`。

- [ ] **Step 5: Build and run the new test**

Run:
```bash
mise exec -- pnpm -C scripts/doc-driven-dev build
mise exec -- pnpm -C scripts/doc-driven-dev exec tsx --test --test-name-pattern "honors --dir and --name" tests/doc-suite.test.ts
```
Expected: PASS。

- [ ] **Step 6: Run the full suite**

Run: `mise exec -- pnpm -C scripts/doc-driven-dev test`
Expected: PASS（fail 0）。

- [ ] **Step 7: Commit**

```bash
git add scripts/doc-driven-dev/src/skills packages/doc-driven-dev/.apm/skills scripts/doc-driven-dev/tests/doc-suite.test.ts
git commit -m "feat(doc-driven-dev): add --name for subdirectory document placement

Lets callers create <feature>/design.md style docs via
--dir docs/designs/<feature> --name design.md while overview.md and the
README index stay at the canonical root.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `--no-index` / `--force-index` フラグと索引スキップ警告の横展開

索引更新の opt-out（`--no-index`）と手キュレーション保護の上書き強制（`--force-index`）を全 CLI に配線し、Task 1 で `new_design.ts` のみに入れたスキップ/警告出力を残り 5 CLI にも展開する。

**Files:**
- Modify: `scripts/doc-driven-dev/src/skills/{design-doc,spec-doc,plan-doc,task-doc,idea-doc,discovery-doc}/scripts/new_*.ts`
- Test: `scripts/doc-driven-dev/tests/doc-suite.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/doc-suite.test.ts` の末尾に追記する。

```ts
test("new_spec --no-index skips writing the README index", () => {
  const repo = tempRepo();
  const result = runScript("spec-doc", "new_spec.js",
    ["--title", "No index spec", "--no-index"], { cwd: repo });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(repo, "docs/specs/0001-no-index-spec.md")), true);
  assert.equal(fs.existsSync(path.join(repo, "docs/specs/README.md")), false,
    "index must not be created when --no-index is passed");
  assert.match(result.stdout, /Skipped index update \(--no-index\)/);
});

test("new_spec --force-index overwrites a hand-curated index", () => {
  const repo = tempRepo();
  const specs = path.join(repo, "docs/specs");
  fs.mkdirSync(specs, { recursive: true });
  const handCurated = "# Curated Spec Index\n\n- keep me\n";
  fs.writeFileSync(path.join(specs, "README.md"), handCurated, "utf8");

  const skipped = runScript("spec-doc", "new_spec.js", ["--title", "First spec"], { cwd: repo });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(fs.readFileSync(path.join(specs, "README.md"), "utf8"), handCurated,
    "hand-curated index preserved by default");
  assert.match(skipped.stderr, /appears hand-curated/);

  const forced = runScript("spec-doc", "new_spec.js",
    ["--title", "Second spec", "--force-index"], { cwd: repo });
  assert.equal(forced.status, 0, forced.stderr);
  const index = fs.readFileSync(path.join(specs, "README.md"), "utf8");
  assert.match(index, /<!-- doc-suite:generated-index -->/, "index regenerated under --force-index");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `mise exec -- pnpm -C scripts/doc-driven-dev exec tsx --test --test-name-pattern "no-index|force-index" tests/doc-suite.test.ts`
Expected: FAIL（`new_spec.js` は `--no-index` / `--force-index` を未知引数として exit 1）。

- [ ] **Step 3: Wire the flags and output into all six CLIs**

各 `new_*.ts` に対して以下を適用する。

(a) `CliArgs` 型に 2 フィールド追加:

```ts
  forceIndex?: boolean;
  noIndex?: boolean;
```

(b) `parseArgs` の `--name` 分岐の直後に追加:

```ts
    else if (arg === "--no-index") args.noIndex = true;
    else if (arg === "--force-index") args.forceIndex = true;
```

(c) `usage()` の末尾（`[--status <status>]` の後）に ` [--no-index] [--force-index]` を追加。例（`new_spec.ts`）:

```ts
  return "Usage: node scripts/new_spec.js --title <title> [--dir <path>] [--name <filename>] [--status <status>] [--no-index] [--force-index]";
```

(d) `createDocument(...)` 呼び出しの `name: args.name,` の直後に追加:

```ts
      forceIndex: args.forceIndex,
      noIndex: args.noIndex,
```

(e) 出力ブロック（`new_design.ts` 以外の 5 CLI の `console.log(\`Created ...\`); console.log(\`Updated ...\`);`）を以下に置換する（`new_design.ts` は Task 1 Step 8 で適用済み）:

```ts
    console.log(`Created ${result.file}`);
    if (result.indexWritten) {
      console.log(`Updated ${result.index}`);
    } else if (result.indexSkippedReason === "hand-curated") {
      console.warn(`Skipped index update: ${result.index} appears hand-curated (no generated marker). Update it manually or pass --force-index.`);
    } else if (result.indexSkippedReason === "disabled") {
      console.log(`Skipped index update (--no-index): ${result.index}`);
    }
```

- [ ] **Step 4: Build and run the new tests**

Run:
```bash
mise exec -- pnpm -C scripts/doc-driven-dev build
mise exec -- pnpm -C scripts/doc-driven-dev exec tsx --test --test-name-pattern "no-index|force-index" tests/doc-suite.test.ts
```
Expected: PASS。

- [ ] **Step 5: Run the full suite**

Run: `mise exec -- pnpm -C scripts/doc-driven-dev test`
Expected: PASS（fail 0）。

- [ ] **Step 6: Commit**

```bash
git add scripts/doc-driven-dev/src/skills packages/doc-driven-dev/.apm/skills scripts/doc-driven-dev/tests/doc-suite.test.ts
git commit -m "feat(doc-driven-dev): add --no-index and --force-index controls

--no-index skips README regeneration; --force-index overrides hand-curated
index protection. Skipped/hand-curated outcomes are surfaced on stdout/stderr.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 規約ドキュメントの更新

`design-conventions.md` / `.ja.md` に「slug リポジトリでの front matter グローバル採番」「`--name` による `<feature>/design.md` 配置」「生成索引マーカーと手キュレーション保護」を明記する。`tests/doc-suite.test.ts` の "doc conventions cover ..." テストが要求する見出し（`## Subdirectory Grouping`, `Detection order used by scripts:`, `Rules:`, `## Mutability`）は維持する。

**Files:**
- Modify: `packages/doc-driven-dev/.apm/skills/design-doc/references/design-conventions.md`
- Modify: `packages/doc-driven-dev/.apm/skills/design-doc/references/design-conventions.ja.md`

- [ ] **Step 1: Confirm the convention sections that tests assert remain present**

Run: `mise exec -- pnpm -C scripts/doc-driven-dev exec tsx --test --test-name-pattern "doc conventions cover" tests/doc-suite.test.ts`
Expected: PASS（編集前のベースライン確認。`Detection order used by scripts:` / `Rules:` / `## Mutability` / `## Subdirectory Grouping` を消さないこと）。

- [ ] **Step 2: Update `design-conventions.md`**

`## Filenames` 節の `Rules:` リスト（現在の 30–34 行）の直後に、以下のサブ節を挿入する。

```markdown

### Numbering source

- In **numbered** directories (`NNNN-<slug>.md` files present), `NNNN` is taken
  from the highest filename prefix in that directory and incremented locally.
- In **slug-only** directories (no `NNNN-` prefixes), scripts derive the next
  sequential `DESIGN-NNNN` id by scanning the front matter `id:` of every design
  doc under `docs/designs/` recursively (including subdirectories), so the global
  id sequence continues even when files use slug names and subdirectory layout.
- `overview.md` (`DESIGN-OVERVIEW`) is excluded from both naming detection and
  numbering.

### Explicit filenames and subdirectory placement

To place a design under a feature subdirectory with a fixed filename, pass
`--dir` and `--name`:

```text
node scripts/new_design.js --title "Graph Visualization" \
  --dir docs/designs/graph-visualization --name design.md
```

`overview.md` and the `README.md` index always stay at the canonical
`docs/designs/` root, even for subdirectory writes.
```

`## Index` 節の `Index rules:` リスト（現在の 117 行以降）に、以下の項目を追加する。

```markdown
- Generated indexes embed an `<!-- doc-suite:generated-index -->` marker.
  Scripts only overwrite a `README.md` that contains this marker (or one that
  does not yet exist). A hand-curated index (no marker) is preserved and the
  script warns instead of clobbering it. Use `--force-index` to overwrite a
  hand-curated index, or `--no-index` to skip index regeneration entirely.
```

- [ ] **Step 3: Update `design-conventions.ja.md`**

`design-conventions.ja.md` の対応箇所に、Step 2 と同義の日本語節を追加する（英語版とセクション構成・見出しを揃える）。追加内容:

- 「### 採番ソース」: numbered ディレクトリはファイル名 `NNNN-` のローカル採番、slug ディレクトリは `docs/designs/` 配下を再帰走査した front matter `id:` の `DESIGN-NNNN` 最大値 +1 によるグローバル採番。`overview.md`（`DESIGN-OVERVIEW`）は命名判定・採番の双方から除外。
- 「### 明示ファイル名とサブディレクトリ配置」: `--dir docs/designs/<feature> --name design.md` で `<feature>/design.md` を生成可能。`overview.md` と `README.md` 索引は常に正規ルート `docs/designs/` に置かれる。
- 索引ルールへの追記: 生成索引には `<!-- doc-suite:generated-index -->` マーカーが埋め込まれ、マーカーを含む（または未作成の）README のみ上書きする。マーカー無し（手キュレーション）の索引は保持し警告する。`--force-index` で上書き強制、`--no-index` で索引再生成をスキップ。

- [ ] **Step 4: Build, run lint and the full suite**

Run:
```bash
mise exec -- pnpm -C scripts/doc-driven-dev build
mise exec -- pnpm -C scripts/doc-driven-dev test
```
Expected: 全テスト PASS（fail 0）。`design-conventions` の必須見出しテストも PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/doc-driven-dev/.apm/skills/design-doc/references/design-conventions.md \
        packages/doc-driven-dev/.apm/skills/design-doc/references/design-conventions.ja.md
git commit -m "docs(design-doc): document front-matter numbering, --name, and index marker

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage（DISC-0006 の推奨修正 1–4 と本リポジトリ回避策）:**

- 推奨 1「front matter から連番算出」→ Task 1（`nextNumberFromFrontMatter`、slug 時にグローバル採番）。
- 推奨 2「再帰走査に統一」→ Task 1（`recursiveBasenames` による命名判定の再帰化、`walkMarkdownFiles` ベース）。
- 推奨 3「サブディレクトリ配置サポート」→ Task 1（`overview`/索引のルート固定）+ Task 2（`--name` + `--dir` 配線）。
- 推奨 4「索引の非破壊更新」→ Task 1（生成マーカー + `writeGeneratedIndex`）+ Task 3（`--no-index` / `--force-index` + 警告出力）。
- バグ 1（ID 衝突）→ Task 1。バグ 2（フラット配置）→ Task 1 + Task 2。バグ 3（索引クロバー）→ Task 1 + Task 3。

**後方互換:** numbered 一時リポジトリでは「正規ルート == 対象ディレクトリ」「サブディレクトリ無し」「README 毎回新規生成（マーカー付き）」のため、命名判定（再帰でも結果同一）・採番（`nextNumber(localFiles)` 維持）・`overview`/索引位置・索引上書きのすべてが従来挙動と一致。既存 195 テストは不変のまま PASS する想定。

**Placeholder scan:** 各コードステップは実コードを掲載済み。Task 2 Step 4 / Task 3 Step 3 は 6 ファイルへ同一パターンを適用するため、適用規則と各ファイルの行番号・対象シンボルを明示（プレースホルダではなく機械的反復）。

**Type consistency:** `createDocument` の戻り値に `indexWritten: boolean` / `indexSkippedReason: string | null` を Task 1 で追加し、CLI（Task 1 Step 8 / Task 3 Step 3e）で同名プロパティを参照。`CreateDocumentOptions` に `name`/`noIndex`/`forceIndex` を Task 1 で追加し、CLI 側 `CliArgs` の `name`/`noIndex`/`forceIndex`（camelCase）から `name: args.name` / `noIndex: args.noIndex` / `forceIndex: args.forceIndex` でマッピング。生成マーカー定数 `GENERATED_INDEX_MARKER` は `buildIndex`（埋め込み）と `writeGeneratedIndex`（検出）で同一文字列を共有。
</content>
</invoke>
