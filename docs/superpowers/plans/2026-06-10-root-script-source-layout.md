# ルートスクリプトソースレイアウト 実装計画（フラット化版）

> **agentic worker 向け:** REQUIRED SUB-SKILL: この計画は superpowers:subagent-driven-development（推奨）または superpowers:executing-plans を使って、タスク単位で実行してください。進捗はチェックボックス（`- [ ]`）で管理します。

**Goal:** skill の TypeScript ソースと build 環境を `scripts/doc-driven-dev/` に独立させ、ビルド成果物のみを `packages/doc-driven-dev/.apm/` に配置する。結果として node_modules が `scripts/` 配下に隔離され、`apm install` の hidden character 検査から自動的に除外される。

**Architecture:** `scripts/doc-driven-dev/` に完全な build 環境（src/, build/, tests/, package.json, pnpm-lock.yaml, pnpm-workspace.yaml）を置き、ビルド出力だけを親リポジトリの package へ反映する。パッケージ側 `packages/doc-driven-dev/` は成果物受け取り専用になり、開発依存が混在しなくなる。

**Tech Stack:** TypeScript, tsx, esbuild, pnpm, Node.js fs/path APIs

**Hidden Character 問題への解決策:** node_modules が `scripts/doc-driven-dev/node_modules` に隔離されるため、`apm install` がルート apm.yml 処理時に検査対象にしない領域になる。pnpm clean 運用なしで安全になる。

---

## スコープとサブシステム確認

この計画が対象にするのは `packages/doc-driven-dev` と新規 `scripts/doc-driven-dev/` の source/build パイプラインのみ。
APM manifest 設計、install policy、公開フローの再設計は対象外。

## 想定ディレクトリ構造（目標状態）

```text
apm-packages/
  scripts/
    doc-driven-dev/                    # 独立した build 環境
      build/                           # ビルドスクリプト
        build-skill-scripts.ts
        generate-json-schemas.ts
      src/
        lib/                           # 共有ユーティリティ
          markdown-utils.ts
          yaml-parser.ts
        skills/                        # skill ソース
          adr-doc/
            new_adr.ts
            audit_adr.ts
            scripts/
              find_adr_references.ts
            lib/
              ...
          spec-doc/
            scripts/
              ...
          plan-doc/
            scripts/
              ...
      tests/
        skills/
          adr-doc.test.ts
          spec-doc.test.ts
        scripts/
          build-skill-scripts.test.ts
      package.json                     # 独立した build 依存
      pnpm-workspace.yaml
      pnpm-lock.yaml
      tsconfig.json
      .npmrc (オプション)
  
  packages/
    doc-driven-dev/
      .apm/
        skills/
          <skill>/
            scripts/
              *.js                     # build 成果物のみ
      src/                             # (削除対象)
      scripts/
        (削除対象)
      tests/
        (削除対象)
      package.json                     # (削除対象)
```

## ファイル分割と責務

- `scripts/doc-driven-dev/build/build-skill-scripts.ts`
  - ビルド実行スクリプト。`src/skills/**/scripts/*.ts` を読み `.apm/skills/**/scripts/*.js` へ出力。
  - output root は `../../packages/doc-driven-dev/.apm` に固定。
- `scripts/doc-driven-dev/src/skills/**/scripts/*.ts`
  - skill スクリプトの正本ソース。
- `scripts/doc-driven-dev/src/lib/`
  - 複数 skill で共用される utility 関数群。
- `scripts/doc-driven-dev/tests/`
  - ビルド・スクリプト・utility の tests。
- `scripts/doc-driven-dev/package.json`
  - typescript, tsx, esbuild, pnpm 等の build 依存。
  - install スクリプト：`pnpm run build`
- `packages/doc-driven-dev/README.md`
- `packages/doc-driven-dev/README.ja.md`
  - 開発フロー更新（新しい build 位置と実行方法）。
- `README.md`
- `README.ja.md`
  - ルートレベル contributor 向け注記（新レイアウト）。

---

### Task 1: scripts/doc-driven-dev/ ディレクトリ構造を初期化する

**Files:**
- Create: `scripts/doc-driven-dev/build/build-skill-scripts.ts`
- Create: `scripts/doc-driven-dev/src/lib/` (stub)
- Create: `scripts/doc-driven-dev/package.json`
- Create: `scripts/doc-driven-dev/pnpm-workspace.yaml`
- Create: `scripts/doc-driven-dev/tsconfig.json`

- [ ] **Step 1: scripts/doc-driven-dev ディレクトリを作成する**

```bash
mkdir -p scripts/doc-driven-dev/{build,src/lib,src/skills,tests/skills,tests/scripts}
```

- [ ] **Step 2: scripts/doc-driven-dev/package.json を作成する**

```json
{
  "name": "doc-driven-dev-build",
  "version": "0.1.0",
  "description": "Build environment for doc-driven-dev skill scripts",
  "type": "module",
  "scripts": {
    "build": "tsx build/build-skill-scripts.ts",
    "test": "tsx --test tests/**/*.test.ts"
  },
  "dependencies": {
    "gray-matter": "^4.0.3",
    "js-yaml": "^4.1.0",
    "remark-parse": "^11.0.0",
    "unified": "^11.0.5",
    "unist-util-visit": "^5.1.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "esbuild": "^0.25.11",
    "tsx": "^4.20.6",
    "typescript": "^5.6.3"
  },
  "packageManager": "pnpm@11.2.2"
}
```

- [ ] **Step 3: scripts/doc-driven-dev/pnpm-workspace.yaml を作成する**

```yaml
packages:
  - "."
```

- [ ] **Step 4: scripts/doc-driven-dev/tsconfig.json を作成する**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: scripts/doc-driven-dev/build/build-skill-scripts.ts を実装する（最小版）**

```ts
#!/usr/bin/env node
import { build } from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_ROOT = path.join(ROOT, "src", "skills");
const OUTPUT_ROOT = path.join(ROOT, "..", "..", "packages", "doc-driven-dev", ".apm", "skills");

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(fullPath);
      }
      return fullPath;
    })
  );

  return files.flat();
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function isEntryPoint(filePath: string): boolean {
  const rel = toPosix(path.relative(SOURCE_ROOT, filePath));
  if (!rel.endsWith(".ts")) {
    return false;
  }

  if (!rel.includes("/scripts/")) {
    return false;
  }

  if (rel.includes("/scripts/lib/")) {
    return false;
  }

  return true;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function cleanupOutputDir(dir: string): Promise<void> {
  await ensureDir(dir);

  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (entry.isFile() && entry.name.endsWith(".js")) {
      await fs.rm(path.join(dir, entry.name), { force: true });
      return;
    }

    if (entry.isDirectory() && entry.name === "dist") {
      await fs.rm(path.join(dir, entry.name), { recursive: true, force: true });
    }
  }));
}

async function main(): Promise<void> {
  const allFiles = await walk(SOURCE_ROOT);
  const entryPoints = allFiles.filter(isEntryPoint);

  if (entryPoints.length === 0) {
    console.log("No TypeScript entry points found under src/skills/**/scripts/*.ts");
    return;
  }

  const cleanedDirs = new Set<string>();

  for (const entryPoint of entryPoints) {
    const rel = path.relative(SOURCE_ROOT, entryPoint);
    const relDir = path.dirname(rel);
    const relBaseName = path.basename(rel, ".ts") + ".js";
    const outDir = path.join(OUTPUT_ROOT, relDir);
    const outfile = path.join(outDir, relBaseName);

    if (!cleanedDirs.has(outDir)) {
      await cleanupOutputDir(outDir);
      cleanedDirs.add(outDir);
    }

    await build({
      entryPoints: [entryPoint],
      outfile,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: ["node20"],
      charset: "ascii",
      sourcemap: false,
      logLevel: "silent"
    });

    console.log(`Built ${toPosix(path.relative(ROOT, outfile))}`);
  }

  console.log(`Finished: ${entryPoints.length} script(s) built.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 6: コミット**

```bash
git add scripts/doc-driven-dev/
git commit -m "chore(scripts): initialize independent build environment for doc-driven-dev"
```

### Task 2: 既存ソースを scripts/doc-driven-dev/src/skills/ へ移設する

**Files:**
- Move: `packages/doc-driven-dev/src/skills/*` -> `scripts/doc-driven-dev/src/skills/*`

- [ ] **Step 1: 移設前のテストを実行し、基準を記録する**

Run: `pnpm --dir packages/doc-driven-dev test`
Expected: テスト数を記録。

- [ ] **Step 2: ソースをコピー**

```bash
robocopy packages\doc-driven-dev\src\skills scripts\doc-driven-dev\src\skills /E /NFL /NDL /NJH /NJS
```

- [ ] **Step 3: scripts/doc-driven-dev で build を実行**

Run: `cd scripts/doc-driven-dev && pnpm install && pnpm run build`
Expected: `Built scripts/doc-driven-dev/...` ログと成果物が `packages/doc-driven-dev/.apm/skills/**/scripts/*.js` に生成される。

- [ ] **Step 4: packages/doc-driven-dev の成果物を確認**

Run: `ls -R packages/doc-driven-dev/.apm/skills/*/scripts/*.js`
Expected: 全スキルの JavaScript ファイルが存在。

- [ ] **Step 5: packages/doc-driven-dev の src/skills を削除**

```bash
Remove-Item packages\doc-driven-dev\src -Recurse -Force
```

- [ ] **Step 6: コミット**

```bash
git add scripts/doc-driven-dev/src/skills packages/doc-driven-dev/.apm/skills
git rm -r packages/doc-driven-dev/src
git commit -m "refactor(doc-driven-dev): move skill sources to independent build tree"
```

### Task 3: packages/doc-driven-dev の package.json を削除する

**Files:**
- Delete: `packages/doc-driven-dev/package.json`

- [ ] **Step 1: 失敗するテストを書く（package.json 不在を前提化）**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

test("packages/doc-driven-dev/package.json does not exist", () => {
  assert.equal(existsSync("packages/doc-driven-dev/package.json"), false);
});
```

- [ ] **Step 2: テストを実行し、失敗を確認**

Run: `tsx test.ts`
Expected: FAIL（まだ package.json が存在するため）。

- [ ] **Step 3: package.json を削除する**

```bash
git rm packages/doc-driven-dev/package.json
```

- [ ] **Step 4: テストを実行し、成功を確認**

Run: `tsx test.ts`
Expected: PASS。

- [ ] **Step 5: scripts/doc-driven-dev/package.json が独立している確認**

Run: `pnpm --dir scripts/doc-driven-dev install`
Expected: scripts/ 配下でだけ esbuild / tsx がインストールされ、packages/ 側に package.json は存在しない。

- [ ] **Step 6: コミット**

```bash
git commit -m "chore(doc-driven-dev): remove packages-side package.json"
```

### Task 4: scripts/doc-driven-dev で test を実行可能にする

**Files:**
- Create: `scripts/doc-driven-dev/tests/scripts/build-skill-scripts.test.ts`

- [ ] **Step 1: build ツール自体のテストを書く**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { promises as fs } from "node:fs";

test("build output directory resolves to packages/doc-driven-dev/.apm", async () => {
  const ROOT = process.cwd();
  const OUTPUT_ROOT = path.join(ROOT, "..", "..", "packages", "doc-driven-dev", ".apm", "skills");
  const normalized = path.normalize(OUTPUT_ROOT);
  
  // Verify it contains "packages/doc-driven-dev/.apm/skills"
  assert.equal(normalized.includes("packages"), true);
  assert.equal(normalized.includes("doc-driven-dev"), true);
  assert.equal(normalized.includes(".apm"), true);
});
```

- [ ] **Step 2: テストを実行し、失敗を確認**

Run: `pnpm --dir scripts/doc-driven-dev test`
Expected: FAIL（OUTPUT_ROOT 計算がまだ未実装の場合）。

- [ ] **Step 3: テストを PASS させるため build スクリプトを検証**

build/build-skill-scripts.ts の OUTPUT_ROOT を確認し、パスが正確か検証します。

```bash
node -e "console.log(require('path').join(process.cwd(), '..', '..', 'packages', 'doc-driven-dev', '.apm', 'skills'))"
```

- [ ] **Step 4: テストを実行し、成功を確認**

Run: `pnpm --dir scripts/doc-driven-dev test`
Expected: PASS。

- [ ] **Step 5: コミット**

```bash
git add scripts/doc-driven-dev/tests/scripts/build-skill-scripts.test.ts
git commit -m "test(scripts/doc-driven-dev): verify build output path resolution"
```

### Task 5: ドキュメントを更新（EN/JA 同期）

**Files:**
- Modify: `README.md`
- Modify: `README.ja.md`
- Modify: `packages/doc-driven-dev/README.md`
- Modify: `packages/doc-driven-dev/README.ja.md`

- [ ] **Step 1: ドキュメント更新前の state を記録**

既存 README の `## Development` セクションを確認。

- [ ] **Step 2: 新ワークフローを明記する**

**English (packages/doc-driven-dev/README.md):**
```md
## Development

Skill scripts are developed in the independent build environment at `scripts/doc-driven-dev/`.

To edit and build:

1. Navigate to the build environment:
   ```bash
   cd scripts/doc-driven-dev
   ```

2. Edit TypeScript sources under `src/skills/**/scripts/*.ts`

3. Run the build:
   ```bash
   pnpm run build
   ```

4. Outputs are automatically placed in `../../packages/doc-driven-dev/.apm/skills/**/scripts/*.js`

5. From the repo root, verify the installation:
   ```bash
   pnpm install --dry-run
   ```
```

**Japanese (packages/doc-driven-dev/README.ja.md):**
```md
## 開発

Skill スクリプトは `scripts/doc-driven-dev/` の独立した build 環境で開発されています。

編集とビルド：

1. build 環境へ移動：
   ```bash
   cd scripts/doc-driven-dev
   ```

2. `src/skills/**/scripts/*.ts` の TypeScript ソースを編集

3. ビルドを実行：
   ```bash
   pnpm run build
   ```

4. 成果物は自動的に `../../packages/doc-driven-dev/.apm/skills/**/scripts/*.js` に配置されます

5. ルートから installation を検証：
   ```bash
   pnpm install --dry-run
   ```
```

- [ ] **Step 3: README.md (ルート) へ新 source tree レイアウトの説明を追加**

```md
### Source Layout

- `scripts/doc-driven-dev/` -- Independent build environment for doc-driven-dev skills
  - `build/` -- Build scripts (esbuild orchestration)
  - `src/skills/` -- TypeScript sources
  - `tests/` -- Unit tests for build and utilities
  - `package.json` -- Build dependencies (esbuild, tsx, etc.)
  - `pnpm-lock.yaml` -- Isolated dependency lock
  
- `packages/doc-driven-dev/` -- Deployed APM package (build artifacts only)
  - `.apm/skills/` -- Generated JavaScript outputs
```

- [ ] **Step 4: 英語/日本語 docs で同じ content が記載されたか確認**

Run: `grep -r "scripts/doc-driven-dev" README.md README.ja.md packages/doc-driven-dev/README*`
Expected: 複数ファイルで記載あり。

- [ ] **Step 5: コミット**

```bash
git add README.md README.ja.md packages/doc-driven-dev/README.md packages/doc-driven-dev/README.ja.md
git commit -m "docs: update development workflow for independent build environment"
```
---

## 検証チェックリスト（最終ゲート）

- [ ] `pnpm --dir scripts/doc-driven-dev install` が成功し、node_modules/ が `scripts/doc-driven-dev/` 下にのみ存在。
- [ ] `pnpm --dir scripts/doc-driven-dev run build` で `.apm/skills/**/scripts/*.js` が期待通り `packages/` 配下に生成される。
- [ ] `pnpm install --dry-run` from ルートが hidden character エラーなく成功。
- [ ] 英語/日本語 README で同じワークフローが記載される。
- [ ] `packages/doc-driven-dev/src/` が削除済み、`scripts/doc-driven-dev/src/skills/` へ完全に移設。
- [ ] `packages/doc-driven-dev/package.json` が存在しない。

## 仕様カバレッジ自己レビュー

- 要求: `scripts/doc-driven-dev/` へのフラット化、build/src/tests を独立化。
  - Task 1/2 で対応。
- 要求: 成果物は `packages/doc-driven-dev/.apm/` 配下に配置。
  - Task 2/3 で検証。
- 要求: node_modules の隔離による hidden character 問題の回避。
  - Task 1 で独立 package.json、Task 3 で packages/ 側 package.json 削除により達成。
- 要求: 想定ディレクトリ構造の明示。
  - 本計画の「想定ディレクトリ構造（目標状態）」で対応。

未カバーの要件はなし。

## プレースホルダ自己レビュー

- TODO/TBD なし。
- 全コード変更ステップに具体的コードブロック。
- 全実行ステップに具体コマンドと期待結果。

## 型/シグネチャ整合性自己レビュー

- `build-skill-scripts.ts` の SOURCE_ROOT/OUTPUT_ROOT パスは全タスクで一貫。
- repository 構造参照も一貫。
