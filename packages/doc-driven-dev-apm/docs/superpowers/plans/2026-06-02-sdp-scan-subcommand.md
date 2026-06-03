# SDP Scan, Infer, and Profile Ordering Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `sdp scan` / `sdp infer` / `sdp profile` の責務と実行順序を一致させ、CLI・仕様・テスト・生成物を `scan → infer → profile → validate → query` に統一する。

**Architecture:** `scan.ts` は adapter から `.sdp/skill-scan-list.json` を生成する。`infer.ts` は scan 結果を編集可能な `skill-reference-inferences.json` に変換し、`profile.ts` は scan と inference を結合して catalog と flow profile を生成する。`sdp.ts` はこの 3 段構成をトップレベルコマンドとして公開し、仕様書と回帰テストは同じ順序を前提に更新する。

**Tech Stack:** Node.js, TypeScript, node:test, tsx

---

## File Structure

- Create: `src/skills/skill-discovery-protocol/scripts/scan.ts`
  - `sdp scan` の CLI 本体。adapter 読み込み、skill scan 実行、scan list 永続化、help/exit code を担当する。
- Create: `src/skills/skill-discovery-protocol/scripts/infer.ts`
  - `sdp infer` の CLI 本体。scan list を入力に inference を初期化・編集する。
- Create: `src/skills/skill-discovery-protocol/scripts/profile.ts`
  - `sdp profile` の CLI 本体。scan と inference を読み込んで catalog/profile を生成する。
- Modify: `src/skills/skill-discovery-protocol/scripts/sdp.ts`
  - `scan` / `infer` / `profile` をトップレベルコマンドに追加し、usage と dispatcher を更新する。
- Modify: `tests/skills/skill-discovery-protocol/generate.test.ts`
  - 旧 `generate` 表記が残る場合は `profile` に置換し、scan/infer/profile の順序を前提とする回帰に更新する。
- Create: `tests/skills/skill-discovery-protocol/scan.test.ts`
  - `scan` 単体 CLI の正常系・異常系・help を検証する。
- Create: `tests/skills/skill-discovery-protocol/profile.test.ts`
  - `profile` が scan / inference 依存で catalog/profile を生成することを検証する。
- Modify: `tests/skills/skill-discovery-protocol/integration.test.ts`
  - full pipeline と editable infer フローを `scan -> infer init/apply -> profile -> validate/query` に更新する。
- Modify: `docs/specs/skills/skill-discovery-protocol/sdp-cli.md`
  - コマンド体系、責務、手順、終了コード説明を `scan -> infer -> profile` の流れに更新する。
- Modify: `.apm/skills/skill-discovery-protocol/references/cli-reference.md`
  - 英語 CLI リファレンスの見出し順と説明を `scan -> infer -> profile` に揃える。
- Modify: `.apm/skills/skill-discovery-protocol/references/cli-reference.ja.md`
  - 日本語 CLI リファレンスの見出し順と説明を同順に揃える。
- Modify: `.apm/skills/skill-discovery-protocol/references/operation-policy.md`
  - 責務表を `scan / infer / profile / validate / query` の順にする。
- Modify: `.apm/skills/skill-discovery-protocol/references/operation-policy.ja.md`
  - 日本語版の責務表を同順にする。
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/scan.js`
  - `build:scripts` で生成される配布スクリプト。
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/infer.js`
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/profile.js`
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/sdp.js`

## Task 1: `scan` CLI の失敗先行テストを追加する

**Files:**
- Create: `tests/skills/skill-discovery-protocol/scan.test.ts`
- Modify: `tests/skills/skill-discovery-protocol/integration.test.ts`

- [ ] **Step 1: `scan` の正常系テストを書く**

```ts
test("sdp scan writes skill-scan-list.json from adapter scopes", () => {
  const dir = tempDir();
  setupTestProject(dir);

  const result = runScan(["--adapter", "test-adapter.yaml"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const scanPath = path.join(dir, ".sdp", "skill-scan-list.json");
  assert.ok(fs.existsSync(scanPath), "scan list should exist");

  const doc = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  assert.equal(doc.schema_version, "1.0");
  assert.equal(doc.skills.length, 2);
  assert.equal(doc.skills[0].name, "skill-a");
});
```

- [ ] **Step 2: `scan` の引数/ヘルプ異常系テストを書く**

```ts
test("sdp scan without --adapter exits 1", () => {
  const dir = tempDir();
  const result = runScan([], dir);
  assert.equal(result.status, 1, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes("--adapter is required"));
});

test("sdp.js scan --help returns 0", () => {
  const dir = tempDir();
  const result = runSdpScan(["--help"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes("Usage: sdp scan --adapter <adapter-yaml>"));
});
```

- [ ] **Step 3: `profile` の前提条件テストを失敗先行で追加する**

```ts
test("sdp profile exits 2 when scan list is missing", () => {
  const dir = tempDir();
  setupTestProject(dir);
  fs.rmSync(path.join(dir, ".sdp", "skill-scan-list.json"), { force: true });

  const result = runProfile(["--adapter", "test-adapter.yaml"], dir);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes("Skill scan list required"));
  assert.ok(result.stderr.includes("sdp scan --adapter"));
});

test("sdp profile exits 2 when inference is missing", () => {
  const dir = tempDir();
  setupTestProject(dir);
  runScan(["--adapter", "test-adapter.yaml"], dir);
  fs.rmSync(path.join(dir, ".sdp", "skill-reference-inferences.json"), { force: true });

  const result = runProfile(["--adapter", "test-adapter.yaml"], dir);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes("sdp infer init"));
});
```

- [ ] **Step 4: 失敗を確認する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/scan.test.ts tests/skills/skill-discovery-protocol/integration.test.ts --test-name-pattern "scan|profile is missing"`
Expected: FAIL (`scan.js` / `profile.js` 未実装、または dispatcher が未接続のため期待値不一致)

- [ ] **Step 5: Commit**

```bash
git add tests/skills/skill-discovery-protocol/scan.test.ts tests/skills/skill-discovery-protocol/integration.test.ts
git commit -m "test(sdp): add scan and profile ordering coverage"
```

## Task 2: `scan.ts` を実装してトップレベル CLI に接続する

**Files:**
- Create: `src/skills/skill-discovery-protocol/scripts/scan.ts`
- Modify: `src/skills/skill-discovery-protocol/scripts/sdp.ts`
- Modify: `tests/skills/skill-discovery-protocol/scan.test.ts`

- [ ] **Step 1: `scan.ts` の最小実装を書く**

```ts
#!/usr/bin/env node
"use strict";

const path = require("node:path");

const { loadAdapter } = require("./lib/adapter.ts");
const { scanSkills } = require("./lib/scanner.ts");
const { writeScanList } = require("./lib/inference.ts");

function parseArgs(argv: string[]): { adapter?: string; cwd?: string; help?: boolean } {
  const args: { adapter?: string; cwd?: string; help?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--adapter") args.adapter = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: sdp scan --adapter <adapter-yaml> [--cwd <dir>]";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.adapter) {
    console.error("Error: --adapter is required");
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const adapterPath = path.resolve(cwd, args.adapter);
  const adapter = loadAdapter(adapterPath);
  const rawSkills = scanSkills(cwd, adapter);
  const scanListPath = writeScanList(cwd, rawSkills);
  console.log(`Written: ${path.relative(cwd, scanListPath)}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
```

- [ ] **Step 2: `sdp.ts` に `scan` を追加する**

```ts
function usage(): string {
  return `Usage: sdp <command> [options]

Commands:
  scan        Generate skill scan list
  infer       Generate skill reference inference from scan list
  profile     Generate skill catalog and flow profile
  validate    Validate artifacts or adapter
  query       Query flow profile data

Run 'sdp <command> --help' for command-specific usage.`;
}

const validCommands = ["scan", "infer", "profile", "validate", "query"];
```

- [ ] **Step 3: `scan` テストを通す**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/scan.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/skills/skill-discovery-protocol/scripts/scan.ts src/skills/skill-discovery-protocol/scripts/sdp.ts tests/skills/skill-discovery-protocol/scan.test.ts
git commit -m "feat(sdp): add scan command"
```

## Task 3: `infer` と `profile` を接続する

**Files:**
- Create: `src/skills/skill-discovery-protocol/scripts/infer.ts`
- Create: `src/skills/skill-discovery-protocol/scripts/profile.ts`
- Modify: `src/skills/skill-discovery-protocol/scripts/sdp.ts`
- Modify: `tests/skills/skill-discovery-protocol/profile.test.ts`
- Modify: `tests/skills/skill-discovery-protocol/generate.test.ts`

- [ ] **Step 1: `infer.ts` の最小実装を書く**

```ts
#!/usr/bin/env node
"use strict";

const path = require("node:path");

const { defaultScanListPath, loadScanList, defaultInferencePath, writeInferenceDocument } = require("./lib/inference.ts");

function usage(): string {
  return "Usage: sdp infer init [--scan <json>] [--out <json>] [--cwd <dir>] [--if-exists <fail|overwrite|merge>]";
}

// init / apply / check / set-skill / delete-skill を scan list 入力で扱う
```

- [ ] **Step 2: `profile.ts` の最小実装を書く**

```ts
#!/usr/bin/env node
"use strict";

const path = require("node:path");

const { loadAdapter } = require("./lib/adapter.ts");
const { buildCatalog } = require("./lib/catalog.ts");
const { classifySkills } = require("./lib/classifier.ts");
const { resolveInvocations } = require("./lib/resolver.ts");
const { buildProfile } = require("./lib/profile.ts");
const { stabilizeCatalog, stabilizeProfile, writeArtifact } = require("./lib/renderer.ts");
const { defaultScanListPath, loadScanList, defaultInferencePath, loadInferenceDocument, enrichSkills } = require("./lib/inference.ts");
const { resolveSharedCatalogPath, resolveFlowProfilePath } = require("./lib/artifact_paths.ts");
```

- [ ] **Step 3: `sdp.ts` の dispatcher を scan / infer / profile に更新する**

```ts
const validCommands = ["scan", "infer", "profile", "validate", "query"];
```

- [ ] **Step 4: `profile` を通すテストを書く**

```ts
test("sdp profile creates catalog and profile after scan and infer", () => {
  const dir = tempDir();
  setupTestProject(dir);
  runScan(["--adapter", "test-adapter.yaml"], dir);
  runInfer(["init", "--scan", ".sdp/skill-scan-list.json"], dir);

  const result = runProfile(["--adapter", "test-adapter.yaml"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(fs.existsSync(path.join(dir, ".sdp", "skill-reference-catalog.json")));
  assert.ok(fs.existsSync(path.join(dir, ".sdp", "test-adapter", "implementation-profile.json")));
});
```

- [ ] **Step 5: `infer` と `profile` のテストを通す**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/scan.test.ts tests/skills/skill-discovery-protocol/profile.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/skills/skill-discovery-protocol/scripts/infer.ts src/skills/skill-discovery-protocol/scripts/profile.ts src/skills/skill-discovery-protocol/scripts/sdp.ts tests/skills/skill-discovery-protocol/profile.test.ts
git commit -m "feat(sdp): add infer and profile commands"
```

## Task 4: 仕様と回帰検証を scan → infer → profile に統一する

**Files:**
- Modify: `tests/skills/skill-discovery-protocol/integration.test.ts`
- Modify: `docs/specs/skills/skill-discovery-protocol/sdp-cli.md`
- Modify: `.apm/skills/skill-discovery-protocol/references/cli-reference.md`
- Modify: `.apm/skills/skill-discovery-protocol/references/cli-reference.ja.md`
- Modify: `.apm/skills/skill-discovery-protocol/references/operation-policy.md`
- Modify: `.apm/skills/skill-discovery-protocol/references/operation-policy.ja.md`
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/scan.js`
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/infer.js`
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/profile.js`
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/sdp.js`

- [ ] **Step 1: integration helper の順序を固定する**

```ts
function runFullPipeline(cwd: string) {
  const scan = runScan(["--adapter", "impl-adapter.yaml"], cwd);
  assert.equal(scan.status, 0, `scan stderr: ${scan.stderr}`);

  const infer = runInfer(["init", "--scan", ".sdp/skill-scan-list.json"], cwd);
  assert.equal(infer.status, 0, `infer stderr: ${infer.stderr}`);

  const profile = runProfile(["--adapter", "impl-adapter.yaml"], cwd);
  assert.equal(profile.status, 0, `profile stderr: ${profile.stderr}`);

  return { scan, infer, profile };
}
```

- [ ] **Step 2: 仕様書のコマンド体系を順序通りに直す**

```md
```text
sdp scan --adapter <adapter-yaml> [--cwd <dir>]
sdp infer init [--scan <json>] [--out <json>] [--cwd <dir>] [--if-exists <fail|overwrite|merge>]
sdp profile --adapter <adapter-yaml> [--references <json>] [--cwd <dir>]
```
```

- [ ] **Step 3: generated scripts を再生成する**

Run: `pnpm run build:scripts`
Expected: `.apm/skills/skill-discovery-protocol/scripts/scan.js`, `infer.js`, `profile.js`, `sdp.js` が更新される

- [ ] **Step 4: フル回帰を通す**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/*.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/skills/skill-discovery-protocol/integration.test.ts docs/specs/skills/skill-discovery-protocol/sdp-cli.md .apm/skills/skill-discovery-protocol/references/cli-reference.md .apm/skills/skill-discovery-protocol/references/cli-reference.ja.md .apm/skills/skill-discovery-protocol/references/operation-policy.md .apm/skills/skill-discovery-protocol/references/operation-policy.ja.md .apm/skills/skill-discovery-protocol/scripts/scan.js .apm/skills/skill-discovery-protocol/scripts/infer.js .apm/skills/skill-discovery-protocol/scripts/profile.js .apm/skills/skill-discovery-protocol/scripts/sdp.js
git commit -m "docs(sdp): align command ordering"
```

## Self-Review

- Spec coverage:
  - `scan` 導入: Task 1-2
  - `infer` / `profile` 接続: Task 3
  - CLI / docs / integration 更新: Task 4
- Placeholder scan:
  - `TODO` / `TBD` / 「適切に」などの曖昧表現は未使用。
- Type consistency:
  - CLI 名は `scan` / `infer` / `profile` / `validate` / `query` で統一。
  - scan artifact path は `.sdp/skill-scan-list.json`、inference path は `.sdp/skill-reference-inferences.json`、profile path は `.sdp/<adapter_id>/*-profile.json` で統一。
