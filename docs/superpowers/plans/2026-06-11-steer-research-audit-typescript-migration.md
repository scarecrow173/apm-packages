# Steer Research Audit TypeScript 移行実装計画

> **agentic worker 向け:** REQUIRED SUB-SKILL: この計画は superpowers:subagent-driven-development（推奨）または superpowers:executing-plans を使って、タスクごとに実行してください。進捗はチェックボックス（`- [ ]`）で管理します。

**Goal:** `research_audit.py` を `scripts/steer-enterprise-web-research/` 配下の TypeScript ソースへ移し、まず Python と同等の動作を確認したうえで、パッケージの実行時処理を成果物だけの JavaScript に置き換える。

**Architecture:** 移行中は Python を基準実装として残し、純粋なヘルパー関数を持つ TypeScript の CLI を実装して `packages/steer-enterprise-web-research/scripts/research_audit.js` にビルドします。同じフィクスチャ入力に対して Python と TypeScript の両 CLI を動かし、終了ステータスと主要出力行を比較する parity テストで一致を確認してから Python を削除します。最終的なパッケージ実行は `apm.yml` から生成済みの JavaScript 成果物だけを呼び出します。

**Tech Stack:** TypeScript, tsx, esbuild, Node.js の fs/path API, Python（移行中の比較基準）, pnpm

---

## スコープ確認

この計画は 1 つのサブシステムだけを対象にします。対象は `steer-enterprise-web-research` の研究監査 CLI の移行です。監査呼び出しのドキュメント以外に、スキルプロンプト、エージェント、研究テンプレートは変更しません。

## ファイル構成

- 作成: `scripts/steer-enterprise-web-research/package.json`
  - この移行用ワークスペースの隔離された build/test 依存を置く。
- 作成: `scripts/steer-enterprise-web-research/pnpm-workspace.yaml`
  - ローカルの workspace 設定（`packages: ['.']`）。
- 作成: `scripts/steer-enterprise-web-research/tsconfig.json`
  - `src/` と `tests/` 用のコンパイラ設定。
- 作成: `scripts/steer-enterprise-web-research/build/build-research-audit.ts`
  - TS ソースをパッケージの成果物パスへバンドルする。
- 作成: `scripts/steer-enterprise-web-research/src/research_audit.ts`
  - Python ロジックの TypeScript 実装。
- 作成: `scripts/steer-enterprise-web-research/tests/research_audit.unit.test.ts`
  - ヘルパー論理（`hasTableRows`、`countSourceIds`、sufficiency 判定）の単体テスト。
- 作成: `scripts/steer-enterprise-web-research/tests/research_audit.parity.test.ts`
  - Python と TypeScript の出力 / ステータス一致を確認する parity テスト。
- 変更: `packages/steer-enterprise-web-research/apm.yml`
  - parity 合格後に `python scripts/research_audit.py research` を `node scripts/research_audit.js research` に置き換える。
- 削除: `packages/steer-enterprise-web-research/scripts/research_audit.py`
  - parity 確認後に Python 実行を削除する。
- 変更: `packages/steer-enterprise-web-research/README.md`
- 変更: `packages/steer-enterprise-web-research/README.ja.md`
  - 新しい audit コマンドとソース位置について EN/JA の説明を同期させる。

---

### Task 1: steer 監査用の独立 TypeScript ワークスペースを初期化する

**Files:**
- 作成: `scripts/steer-enterprise-web-research/package.json`
- 作成: `scripts/steer-enterprise-web-research/pnpm-workspace.yaml`
- 作成: `scripts/steer-enterprise-web-research/tsconfig.json`
- 作成: `scripts/steer-enterprise-web-research/build/build-research-audit.ts`

- [ ] **Step 1: ディレクトリのひな形を作成する**

```bash
mkdir -p scripts/steer-enterprise-web-research/{build,src,tests}
```

- [ ] **Step 2: build 出力先ヘルパーがまだ無いことを確認する失敗テストを書く**

`scripts/steer-enterprise-web-research/tests/research_audit.unit.test.ts` を作成します。

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { resolveOutputPath } from "../build/build-research-audit";

test("resolveOutputPath points to package artifact location", () => {
  const out = resolveOutputPath("D:/repo/apm-packages/scripts/steer-enterprise-web-research");
  assert.equal(
    out.replaceAll("\\", "/").endsWith("/packages/steer-enterprise-web-research/scripts/research_audit.js"),
    true,
  );
});
```

- [ ] **Step 3: テストを実行して失敗することを確認する**

Run: `pnpm --dir scripts/steer-enterprise-web-research test -- tests/research_audit.unit.test.ts`
Expected: モジュール / 関数が見つからないエラーで FAIL。

- [ ] **Step 4: workspace 設定と最小の build ヘルパー実装を追加する**

`scripts/steer-enterprise-web-research/package.json` を作成します。

```json
{
  "name": "steer-enterprise-web-research-build",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "tsx build/build-research-audit.ts",
    "test": "tsx --test tests/*.test.ts tests/**/*.test.ts"
  },
  "packageManager": "pnpm@11.2.2",
  "devDependencies": {
    "esbuild": "^0.25.11",
    "tsx": "^4.20.6",
    "typescript": "^5.6.3"
  }
}
```

`scripts/steer-enterprise-web-research/pnpm-workspace.yaml` を作成します。

```yaml
packages:
  - "."
```

`scripts/steer-enterprise-web-research/tsconfig.json` を作成します。

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["build/**/*.ts", "src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`scripts/steer-enterprise-web-research/build/build-research-audit.ts` を作成します。

```ts
#!/usr/bin/env node
import { build } from "esbuild";
import path from "node:path";

export function resolveOutputPath(root: string): string {
  return path.join(root, "..", "..", "packages", "steer-enterprise-web-research", "scripts", "research_audit.js");
}

async function main(): Promise<void> {
  const root = process.cwd();
  const outfile = resolveOutputPath(root);

  await build({
    entryPoints: [path.join(root, "src", "research_audit.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: ["node20"],
    charset: "ascii",
    sourcemap: false,
    logLevel: "silent",
  });

  console.log(`Built ${path.relative(root, outfile).replaceAll("\\", "/")}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 5: テストを実行して成功することを確認する**

Run: `pnpm --dir scripts/steer-enterprise-web-research test -- tests/research_audit.unit.test.ts`
Expected: PASS。

- [ ] **Step 6: コミットする**

```bash
git add scripts/steer-enterprise-web-research
git commit -m "chore(steer-research): initialize isolated TypeScript build workspace"
```

### Task 2: TypeScript 版の research audit を単体テスト付きで実装する

**Files:**
- 変更: `scripts/steer-enterprise-web-research/src/research_audit.ts`
- 変更: `scripts/steer-enterprise-web-research/tests/research_audit.unit.test.ts`

- [ ] **Step 1: コアロジックの parity を確認する失敗テストを書く**

`scripts/steer-enterprise-web-research/tests/research_audit.unit.test.ts` を更新します。

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  hasTableRows,
  countSourceIds,
  hasSufficiencyDecision,
} from "../src/research_audit";

test("hasTableRows returns true when markdown table has header + data row", () => {
  const md = [
    "| source_id | claim |",
    "|---|---|",
    "| S1 | A |",
  ].join("\n");
  assert.equal(hasTableRows(md), true);
});

test("hasTableRows returns false when table has only separator", () => {
  const md = ["| source_id | claim |", "|---|---|"].join("\n");
  assert.equal(hasTableRows(md), false);
});

test("countSourceIds deduplicates S# markers", () => {
  assert.equal(countSourceIds("S1 S2 S1"), 2);
});

test("hasSufficiencyDecision accepts sufficient marker", () => {
  assert.equal(hasSufficiencyDecision("Sufficient for handoff", ""), true);
});

test("hasSufficiencyDecision accepts unresolved marker disclosure", () => {
  assert.equal(hasSufficiencyDecision("", "remaining gaps in evidence"), true);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `pnpm --dir scripts/steer-enterprise-web-research test -- tests/research_audit.unit.test.ts`
Expected: `src/research_audit.ts` の export 不足で FAIL。

- [ ] **Step 3: Python 置換前の TypeScript 監査ロジックを実装する**

`scripts/steer-enterprise-web-research/src/research_audit.ts` を作成します。

```ts
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const REQUIRED_FILES = [
  "todo.md",
  "persona.md",
  "query-log.md",
  "evidence-ledger.md",
  "running-summary.md",
  "audit.md",
  "final-report.md",
] as const;

export type Check = {
  name: string;
  passed: boolean;
  detail: string;
};

function read(filePath: string): string {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

export function hasTableRows(md: string): boolean {
  const lines = md.split(/\r?\n/).map((line) => line.trim());
  const dataRows = lines.filter(
    (line) => line.startsWith("|") && line.endsWith("|") && !/^\|[-:\s|]+\|$/.test(line),
  );
  return dataRows.length >= 2;
}

export function countSourceIds(md: string): number {
  const ids = new Set(md.match(/\bS\d+\b/g) ?? []);
  return ids.size;
}

export function hasSufficiencyDecision(auditMd: string, finalMd: string): boolean {
  const unresolvedMarkers = ["needs-more-search", "insufficient-tools", "remaining gaps", "unresolved"];
  const loweredAudit = auditMd.toLowerCase();
  const loweredFinal = finalMd.toLowerCase();
  const hasDisclosedGaps = unresolvedMarkers.some(
    (marker) => loweredAudit.includes(marker) || loweredFinal.includes(marker),
  );
  const hasSufficient = loweredAudit.includes("sufficient");
  return hasSufficient || hasDisclosedGaps;
}

export function audit(root: string): Check[] {
  const checks: Check[] = [];

  for (const filename of REQUIRED_FILES) {
    const full = path.join(root, filename);
    const exists = fs.existsSync(full);
    checks.push({
      name: `required file: ${filename}`,
      passed: exists,
      detail: exists ? "exists" : "missing",
    });
  }

  const evidence = read(path.join(root, "evidence-ledger.md"));
  const final = read(path.join(root, "final-report.md"));
  const queryLog = read(path.join(root, "query-log.md"));
  const auditMd = read(path.join(root, "audit.md"));

  checks.push({
    name: "evidence ledger has table rows",
    passed: hasTableRows(evidence),
    detail: hasTableRows(evidence) ? "evidence table appears populated" : "evidence table appears empty",
  });

  const sourceCount = countSourceIds(`${evidence}\n${final}`);
  checks.push({
    name: "source identifiers present",
    passed: sourceCount >= 2,
    detail: `found ${sourceCount} unique S# identifiers`,
  });

  checks.push({
    name: "query log has entries",
    passed: hasTableRows(queryLog),
    detail: hasTableRows(queryLog) ? "query log appears populated" : "query log appears empty",
  });

  const hasDecision = hasSufficiencyDecision(auditMd, final);
  checks.push({
    name: "sufficiency decision present",
    passed: hasDecision,
    detail: hasDecision ? "found sufficiency/gap marker" : "no sufficiency or gap marker found",
  });

  const confidenceLabels = ["High", "Medium", "Low", "高", "中", "低"];
  const hasConfidence = confidenceLabels.some((label) => final.includes(label));
  checks.push({
    name: "confidence labels present",
    passed: hasConfidence,
    detail: hasConfidence ? "found confidence labels" : "no confidence labels found",
  });

  return checks;
}

export function runCli(argv: string[]): number {
  const root = argv.length > 2 ? argv[2] : "research";
  const checks = audit(root);

  console.log(`Research audit: ${root}`);

  let failures = 0;
  for (const check of checks) {
    const status = check.passed ? "PASS" : "FAIL";
    console.log(`[${status}] ${check.name}: ${check.detail}`);
    if (!check.passed) failures += 1;
  }

  if (failures > 0) {
    console.log(`\nResult: NOT READY (${failures} failed checks)`);
    return 1;
  }

  console.log("\nResult: structurally ready for human review");
  return 0;
}

if (require.main === module) {
  process.exitCode = runCli(process.argv);
}
```

- [ ] **Step 4: 単体テストを実行して成功を確認する**

Run: `pnpm --dir scripts/steer-enterprise-web-research test -- tests/research_audit.unit.test.ts`
Expected: PASS。

- [ ] **Step 5: コミットする**

```bash
git add scripts/steer-enterprise-web-research/src/research_audit.ts scripts/steer-enterprise-web-research/tests/research_audit.unit.test.ts
git commit -m "feat(steer-research): add TypeScript research audit implementation"
```

### Task 3: 置き換え前に Python / TypeScript の parity を検証する

**Files:**
- 作成: `scripts/steer-enterprise-web-research/tests/research_audit.parity.test.ts`
- 変更: `scripts/steer-enterprise-web-research/package.json`

- [ ] **Step 1: 両 CLI をフィクスチャデータで実行する失敗 parity テストを書く**

`scripts/steer-enterprise-web-research/tests/research_audit.parity.test.ts` を作成します。

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function mkResearchFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "steer-audit-parity-"));
  const research = path.join(root, "research");
  fs.mkdirSync(research, { recursive: true });

  fs.writeFileSync(path.join(research, "todo.md"), "- [ ] done\n", "utf8");
  fs.writeFileSync(path.join(research, "persona.md"), "persona\n", "utf8");
  fs.writeFileSync(path.join(research, "query-log.md"), "| q | r |\n|---|---|\n| a | b |\n", "utf8");
  fs.writeFileSync(path.join(research, "evidence-ledger.md"), "| source_id | claim |\n|---|---|\n| S1 | c1 |\n| S2 | c2 |\n", "utf8");
  fs.writeFileSync(path.join(research, "running-summary.md"), "summary\n", "utf8");
  fs.writeFileSync(path.join(research, "audit.md"), "sufficient\n", "utf8");
  fs.writeFileSync(path.join(research, "final-report.md"), "Confidence: High\nS1\nS2\n", "utf8");

  return root;
}

function run(cmd: string, args: string[], cwd: string) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8", windowsHide: true });
}

test("python and typescript audit return same exit code and summary", () => {
  const root = mkResearchFixture();

  const py = run("python", ["packages/steer-enterprise-web-research/scripts/research_audit.py", "research"], "D:/repository/apm-packages");
  const ts = run("node", ["packages/steer-enterprise-web-research/scripts/research_audit.js", "research"], root);

  assert.equal(ts.status, py.status);
  assert.equal(ts.stdout.includes("Result:"), true);
  assert.equal(py.stdout.includes("Result:"), true);
});
```

- [ ] **Step 2: parity テストを実行して、build 配線前に失敗することを確認する**

Run: `pnpm --dir scripts/steer-enterprise-web-research test -- tests/research_audit.parity.test.ts`
Expected: `packages/.../research_audit.js` がまだ存在しないため FAIL。

- [ ] **Step 3: TS 成果物を build し、parity テストの実行経路を調整する**

`scripts/steer-enterprise-web-research/package.json` の scripts を更新します。

```json
{
  "scripts": {
    "build": "tsx build/build-research-audit.ts",
    "test": "pnpm run build && tsx --test tests/*.test.ts tests/**/*.test.ts"
  }
}
```

`scripts/steer-enterprise-web-research/tests/research_audit.parity.test.ts` の呼び出しパスを更新します。

```ts
const repoRoot = "D:/repository/apm-packages";

const py = run("python", ["packages/steer-enterprise-web-research/scripts/research_audit.py", path.join(root, "research")], repoRoot);
const ts = run("node", ["packages/steer-enterprise-web-research/scripts/research_audit.js", path.join(root, "research")], repoRoot);

assert.equal(ts.status, py.status);
const tsLines = ts.stdout.split(/\r?\n/).filter((l) => l.startsWith("[PASS]") || l.startsWith("[FAIL]") || l.startsWith("Result:"));
const pyLines = py.stdout.split(/\r?\n/).filter((l) => l.startsWith("[PASS]") || l.startsWith("[FAIL]") || l.startsWith("Result:"));
assert.deepEqual(tsLines, pyLines);
```

- [ ] **Step 4: parity テストを実行して成功することを確認する**

Run: `pnpm --dir scripts/steer-enterprise-web-research test -- tests/research_audit.parity.test.ts`
Expected: Python と JS の pass/fail 行の並びと最終結果が一致して PASS。

- [ ] **Step 5: コミットする**

```bash
git add scripts/steer-enterprise-web-research/package.json scripts/steer-enterprise-web-research/tests/research_audit.parity.test.ts packages/steer-enterprise-web-research/scripts/research_audit.js
git commit -m "test(steer-research): add python-vs-typescript parity verification"
```

### Task 4: 実行コマンドを JavaScript 成果物へ切り替え、Python スクリプトを削除する

**Files:**
- 変更: `packages/steer-enterprise-web-research/apm.yml`
- 削除: `packages/steer-enterprise-web-research/scripts/research_audit.py`

- [ ] **Step 1: apm.yml の runtime コマンド切り替え用の失敗テストを書く**

`scripts/steer-enterprise-web-research/tests/apm_script_config.test.ts` を作成します。

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("apm.yml audit-research script uses node runtime", () => {
  const yml = fs.readFileSync("packages/steer-enterprise-web-research/apm.yml", "utf8");
  assert.equal(yml.includes('audit-research: "node scripts/research_audit.js research"'), true);
});
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `pnpm --dir scripts/steer-enterprise-web-research test -- tests/apm_script_config.test.ts`
Expected: 現在のコマンドがまだ Python なので FAIL。

- [ ] **Step 3: runtime コマンドを差し替え、Python ファイルを削除する**

`packages/steer-enterprise-web-research/apm.yml` を更新します。

```yaml
scripts:
  validate: "apm compile --validate"
  preview: "apm compile --dry-run"
  pack: "apm pack --archive -o dist"
  audit-research: "node scripts/research_audit.js research"
```

Python の基準スクリプトを削除します。

```bash
git rm packages/steer-enterprise-web-research/scripts/research_audit.py
```

- [ ] **Step 4: テストとスモークコマンドを実行して成功を確認する**

Run: `pnpm --dir scripts/steer-enterprise-web-research test -- tests/apm_script_config.test.ts`
Expected: PASS。

Run: `apm run audit-research --dir packages/steer-enterprise-web-research`
Expected: Node でスクリプトが実行され、フィクスチャに応じた PASS / FAIL チェックを出力する（終了コードは fixture 状態に一致）。

- [ ] **Step 5: コミットする**

```bash
git add packages/steer-enterprise-web-research/apm.yml scripts/steer-enterprise-web-research/tests/apm_script_config.test.ts
git commit -m "refactor(steer-research): switch audit runtime from python to node artifact"
```

### Task 5: EN/JA のドキュメントを更新し、最終検証を実施する

**Files:**
- 変更: `packages/steer-enterprise-web-research/README.md`
- 変更: `packages/steer-enterprise-web-research/README.ja.md`

- [ ] **Step 1: 新しいソース / 成果物レイアウト文言の失敗テストを書く**

`scripts/steer-enterprise-web-research/tests/readme_layout.test.ts` を作成します。

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

for (const file of [
  "packages/steer-enterprise-web-research/README.md",
  "packages/steer-enterprise-web-research/README.ja.md",
]) {
  test(`${file} documents scripts-side ts source`, () => {
    const body = fs.readFileSync(file, "utf8");
    assert.equal(body.includes("scripts/steer-enterprise-web-research/src/research_audit.ts"), true);
    assert.equal(body.includes("packages/steer-enterprise-web-research/scripts/research_audit.js"), true);
  });
}
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `pnpm --dir scripts/steer-enterprise-web-research test -- tests/readme_layout.test.ts`
Expected: 現在のドキュメントが新レイアウトをまだ記載していないため FAIL。

- [ ] **Step 3: EN/JA README を同期した構成で更新する**

`packages/steer-enterprise-web-research/README.md` に以下を追加します。

```md
## Audit Script Development

The source of the audit script now lives in:

- `scripts/steer-enterprise-web-research/src/research_audit.ts`

Build output artifact is placed in:

- `packages/steer-enterprise-web-research/scripts/research_audit.js`

Run build and tests:

```bash
pnpm --dir scripts/steer-enterprise-web-research test
pnpm --dir scripts/steer-enterprise-web-research build
```
```

`packages/steer-enterprise-web-research/README.ja.md` に対応する節を追加します。

```md
## 監査スクリプト開発

監査スクリプトのソースは以下に配置します。

- `scripts/steer-enterprise-web-research/src/research_audit.ts`

ビルド成果物は以下に配置されます。

- `packages/steer-enterprise-web-research/scripts/research_audit.js`

ビルドとテスト:

```bash
pnpm --dir scripts/steer-enterprise-web-research test
pnpm --dir scripts/steer-enterprise-web-research build
```
```

- [ ] **Step 4: 全体の検証を実行する**

Run: `pnpm --dir scripts/steer-enterprise-web-research test`
Expected: PASS。

Run: `pnpm --dir scripts/steer-enterprise-web-research build`
Expected: PASS し、`packages/.../scripts/research_audit.js` が再生成される。

Run: `apm install --dry-run -v`
Expected: hidden-character のブロッカー再発なしで PASS。

- [ ] **Step 5: コミットする**

```bash
git add packages/steer-enterprise-web-research/README.md packages/steer-enterprise-web-research/README.ja.md scripts/steer-enterprise-web-research/tests/readme_layout.test.ts packages/steer-enterprise-web-research/scripts/research_audit.js
git commit -m "docs(steer-research): document typescript audit source and artifact workflow"
```

---

## 自己レビュー

### 1. 仕様カバレッジ

- 要件: `scripts/research_audit.py` を TypeScript に変換し、`/scripts/steer-enterprise-web-research/` 配下へソースを移す。
  - Task 1 と Task 2 で対応。
- 要件: 成果物のみを package ツリーに配置する。
  - Task 1 の build 出力先と Task 4 の runtime 切り替えで対応。
- 要件: 置き換え前に parity を検証する。
  - Task 3 で Python / TypeScript の parity テストを明示的に実施してから Task 4 で削除。

未カバーの要件はありません。

### 2. プレースホルダ確認

- TODO / TBD / 後で実装する、のような未完成の記述はありません。
- コード変更ステップにはすべて具体的なコードブロックを含めています。
- 検証ステップにはすべて具体的なコマンドと期待結果を含めています。

### 3. 型の整合性

- `resolveOutputPath`、`hasTableRows`、`countSourceIds`、`hasSufficiencyDecision`、`runCli` の名前はテストと実装で一貫しています。
- 成果物パス `packages/steer-enterprise-web-research/scripts/research_audit.js` は全タスクで一貫しています。

## 実行引き継ぎ

計画は完了し、`docs/superpowers/plans/2026-06-11-steer-research-audit-typescript-migration.md` に保存済みです。実行オプションは 2 つです。

**1. Subagent-Driven（推奨）** - タスクごとに新しいサブエージェントを起動し、各タスクの間でレビューするため、反復が速いです。

**2. Inline Execution** - この会話内で `executing-plans` を使って、チェックポイント付きのバッチ実行で進めます。

どちらで進めますか。
