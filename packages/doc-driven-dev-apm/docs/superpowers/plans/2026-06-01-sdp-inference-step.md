# SDP Inference Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** skill-discovery-protocol に inference 生成ステップを追加し、implementation-flow と briefing-flow の検証を inference 不足で停止しない形にする。

**Architecture:** 既存の scan 成果物 `.sdp/skill-scan-list.json` から inference 成果物 `.sdp/skill-reference-inferences.json` を生成する専用 CLI `sdp infer` を追加する。`sdp generate` は scan 後に inference 未存在時の停止を維持しつつ、`sdp infer` 実行ガイダンスを必ず出力する。検証コマンドとドキュメントは `.sdp` 配下の profile 実体パスで統一する。

**Tech Stack:** Node.js, TypeScript (tsx), node:test, Zod, pnpm

---

## Scope Check

今回の対象は 1 サブシステムのみ（skill-discovery-protocol の CLI ワークフロー）で、独立した別サブシステム分割は不要。

## File Structure

- Modify: `src/skills/skill-discovery-protocol/scripts/generate.ts`
  - inference 不足時エラーメッセージを `sdp infer` 手順付きに改善する。
- Create: `src/skills/skill-discovery-protocol/scripts/infer.ts`
  - `.sdp/skill-scan-list.json` を入力に `.sdp/skill-reference-inferences.json` を生成する CLI。
- Create: `src/skills/skill-discovery-protocol/scripts/lib/infer_builder.ts`
  - scan skill から inference skill を組み立てる純粋関数を定義する。
- Modify: `tests/skills/skill-discovery-protocol/generate.test.ts`
  - inference 不足時のガイダンス出力を期待する回帰テストを追加する。
- Create: `tests/skills/skill-discovery-protocol/infer.test.ts`
  - infer CLI 単体テスト（生成成功、既存上書き、入力不足エラー）を追加する。
- Modify: `docs/specs/skills/skill-discovery-protocol/sdp-cli.md`
  - `sdp infer` を正規コマンド体系に追加する。
- Modify: `.apm/skills/implementation-flow/SKILL.md`
  - generate 前後の実行順に infer を追加する。
- Modify: `.apm/skills/briefing-flow/SKILL.md`
  - generate 前後の実行順に infer を追加する。
- Modify: `.apm/skills/implementation-flow/SKILL.ja.md`
  - 日本語版手順にも infer を追加する。
- Modify: `.apm/skills/briefing-flow/SKILL.ja.md`
  - 日本語版手順にも infer を追加する。
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/generate.js`
- Create (generated): `.apm/skills/skill-discovery-protocol/scripts/infer.js`

### Task 1: Infer CLI の失敗先行テストを追加

**Files:**
- Create: `tests/skills/skill-discovery-protocol/infer.test.ts`
- Modify: `tests/skills/skill-discovery-protocol/generate.test.ts`
- Test: `tests/skills/skill-discovery-protocol/infer.test.ts`

- [ ] **Step 1: infer CLI の失敗テストを書く**

```ts
// tests/skills/skill-discovery-protocol/infer.test.ts
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const skillRoot = path.resolve(__dirname, "../../../.apm/skills");
const sdpScripts = path.join(skillRoot, "skill-discovery-protocol", "scripts");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sdp-infer-test-"));
}

function runInfer(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [path.join(sdpScripts, "infer.js"), ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("sdp infer generates skill-reference-inferences.json from scan list", () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".sdp", "skill-scan-list.json"),
    JSON.stringify(
      {
        schema_version: "1.0",
        generated_at: "2026-06-01T00:00:00Z",
        skills: [
          {
            name: "skill-a",
            description: "ADR authoring skill",
            body: "# Skill A\nUse when writing ADR and architecture records.",
            skill_path: "/tmp/skill-a/SKILL.md",
            scope: "project",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = runInfer([], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const inferPath = path.join(dir, ".sdp", "skill-reference-inferences.json");
  assert.ok(fs.existsSync(inferPath), "inference file should exist");

  const doc = JSON.parse(fs.readFileSync(inferPath, "utf8"));
  assert.equal(doc.schema_version, "1.0");
  assert.equal(doc.inference_source, "agent");
  assert.equal(doc.skills.length, 1);
  assert.equal(doc.skills[0].name, "skill-a");
});

test("sdp infer exits 2 when scan list is missing", () => {
  const dir = tempDir();
  const result = runInfer([], dir);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes("Scan list not found"));
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts`
Expected: FAIL（`infer.js` が存在しない、またはコマンド未実装）

- [ ] **Step 3: generate 側の回帰失敗テストを追加する**

```ts
// tests/skills/skill-discovery-protocol/generate.test.ts に追加

test("sdp generate missing inference prints infer command hint", () => {
  const dir = tempDir();
  setupTestProject(dir);
  fs.unlinkSync(path.join(dir, ".sdp", "skill-reference-inferences.json"));

  const result = runSdp(["--adapter", "test-adapter.yaml"], dir);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes("Skill reference inference required"));
  assert.ok(result.stderr.includes("sdp infer --scan .sdp/skill-scan-list.json"));
});
```

- [ ] **Step 4: 追加した回帰テストを実行して失敗を確認する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/generate.test.ts --test-name-pattern "missing inference prints infer command hint"`
Expected: FAIL（ヒント文がまだ出ていない）

- [ ] **Step 5: Commit**

```bash
git add tests/skills/skill-discovery-protocol/infer.test.ts tests/skills/skill-discovery-protocol/generate.test.ts
git commit -m "test(sdp): add failing tests for infer step and generate hint"
```

### Task 2: infer CLI の最小実装を追加

**Files:**
- Create: `src/skills/skill-discovery-protocol/scripts/lib/infer_builder.ts`
- Create: `src/skills/skill-discovery-protocol/scripts/infer.ts`
- Test: `tests/skills/skill-discovery-protocol/infer.test.ts`

- [ ] **Step 1: inference 変換ロジックの最小実装を書く**

```ts
// src/skills/skill-discovery-protocol/scripts/lib/infer_builder.ts
"use strict";

import type { RawScannedSkill, SkillReferenceInferenceDocument } from "./types";

function inferCapabilities(skill: RawScannedSkill): string[] {
  const text = `${skill.name} ${skill.description} ${skill.body}`.toLowerCase();
  const out: string[] = [];
  if (text.includes("adr")) out.push("adr_authoring");
  if (text.includes("spec")) out.push("spec_authoring");
  if (text.includes("review")) out.push("code_review");
  if (text.includes("test")) out.push("testing");
  return out.length > 0 ? out : ["general_support"];
}

function buildInferenceFromScan(skills: RawScannedSkill[]): SkillReferenceInferenceDocument {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    schema_version: "1.0",
    generated_at: now,
    inference_source: "agent",
    skills: skills
      .map((skill) => {
        const caps = inferCapabilities(skill);
        return {
          name: skill.name,
          provides: caps.map((cap) => ({ capability: cap, description: `Inferred from ${skill.name}` })),
          uses: [],
          execution_policy: {
            strictness: "flexible",
            sequence_required: false,
            allow_step_reordering: true,
            allow_partial_application: true,
            guidance: "Review inferred capabilities before production use",
          },
          tags: ["inferred"],
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

module.exports = {
  buildInferenceFromScan,
};
```

- [ ] **Step 2: infer CLI エントリーポイントを実装する**

```ts
// src/skills/skill-discovery-protocol/scripts/infer.ts
#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { loadScanList, defaultScanListPath, defaultInferencePath } = require("./lib/inference.ts");
const { SkillReferenceInferenceDocumentSchema } = require("./lib/schemas/inference.ts");
const { buildInferenceFromScan } = require("./lib/infer_builder.ts");

function parseArgs(argv: string[]): { scan?: string; out?: string; cwd?: string; help?: boolean } {
  const args: { scan?: string; out?: string; cwd?: string; help?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scan") args.scan = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: sdp infer [--scan <scan-list-json>] [--out <inference-json>] [--cwd <dir>]";
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const scanPath = args.scan ? path.resolve(cwd, args.scan) : defaultScanListPath(cwd);
  const outPath = args.out ? path.resolve(cwd, args.out) : defaultInferencePath(cwd);

  if (!fs.existsSync(scanPath)) {
    console.error(`Scan list not found: ${scanPath}`);
    process.exitCode = 2;
    return;
  }

  const scan = loadScanList(scanPath);
  const inference = buildInferenceFromScan(scan.skills);
  const parsed = SkillReferenceInferenceDocumentSchema.safeParse(inference);
  if (!parsed.success) {
    console.error("Generated inference did not satisfy schema");
    process.exitCode = 2;
    return;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(parsed.data, null, 2) + "\n", "utf8");
  console.log(`Written: ${path.relative(cwd, outPath)}`);
}

main();
```

- [ ] **Step 3: infer テストを実行して通過を確認する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts`
Expected: PASS（2 tests passed）

- [ ] **Step 4: 既存 generate テストへの副作用を確認する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/generate.test.ts --test-name-pattern "writes scan list and exits 2 when references are missing"`
Expected: PASS（既存仕様を壊していない）

- [ ] **Step 5: Commit**

```bash
git add src/skills/skill-discovery-protocol/scripts/infer.ts src/skills/skill-discovery-protocol/scripts/lib/infer_builder.ts
git commit -m "feat(sdp): add infer command to generate inference from scan list"
```

### Task 3: generate のヒント出力と検証手順を更新

**Files:**
- Modify: `src/skills/skill-discovery-protocol/scripts/generate.ts`
- Modify: `docs/specs/skills/skill-discovery-protocol/sdp-cli.md`
- Modify: `.apm/skills/implementation-flow/SKILL.md`
- Modify: `.apm/skills/briefing-flow/SKILL.md`
- Modify: `.apm/skills/implementation-flow/SKILL.ja.md`
- Modify: `.apm/skills/briefing-flow/SKILL.ja.md`
- Test: `tests/skills/skill-discovery-protocol/generate.test.ts`

- [ ] **Step 1: generate の inference 不足メッセージを実装する**

```ts
// src/skills/skill-discovery-protocol/scripts/generate.ts の inference 不足分岐を置換
if (!inferenceDoc) {
  const relScanPath = path.relative(cwd, scanListPath).replace(/\\/g, "/");
  const relInferencePath = path.relative(cwd, inferencePath).replace(/\\/g, "/");
  console.error(`Skill reference inference required. Wrote scan list: ${scanListPath}`);
  console.error(`Next: sdp infer --scan ${relScanPath} --out ${relInferencePath}`);
  process.exitCode = 2;
  return;
}
```

- [ ] **Step 2: generate 回帰テストを実行して通過を確認する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/generate.test.ts --test-name-pattern "missing inference prints infer command hint"`
Expected: PASS

- [ ] **Step 3: CLI 仕様に infer コマンドを追加する**

```md
## コマンド体系

```text
sdp generate --adapter <adapter-yaml> [--references <json>] [--cwd <dir>]
sdp infer [--scan <scan-list-json>] [--out <inference-json>] [--cwd <dir>]
sdp validate --profile <flow-profile-json> [--adapter <adapter-yaml>] [--cwd <dir>]
sdp query --profile <flow-profile-json> <subcommand> [options]
```

## `sdp infer`

scan list から inference 成果物を生成する。

```text
sdp infer [--scan <scan-list-json>] [--out <inference-json>]
```

既定入力: `.sdp/skill-scan-list.json`
既定出力: `.sdp/skill-reference-inferences.json`
```

- [ ] **Step 4: flow スキル手順を infer を含む順序へ更新する**

```md
# 例: .apm/skills/implementation-flow/SKILL.md の実行例を置換
- Generate scan: `sdp generate --adapter .apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`
- Infer references (if needed): `sdp infer --scan .sdp/skill-scan-list.json --out .sdp/skill-reference-inferences.json`
- Generate profile: `sdp generate --adapter .apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`
- Validate: `sdp validate --profile .sdp/implementation-flow-profile.json --adapter .apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`
```

- [ ] **Step 5: Commit**

```bash
git add src/skills/skill-discovery-protocol/scripts/generate.ts docs/specs/skills/skill-discovery-protocol/sdp-cli.md .apm/skills/implementation-flow/SKILL.md .apm/skills/briefing-flow/SKILL.md .apm/skills/implementation-flow/SKILL.ja.md .apm/skills/briefing-flow/SKILL.ja.md
git commit -m "docs(sdp): add infer step and fix validate profile path examples"
```

### Task 4: バンドル再生成と統合検証

**Files:**
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/generate.js`
- Create (generated): `.apm/skills/skill-discovery-protocol/scripts/infer.js`
- Test: `tests/skills/skill-discovery-protocol/infer.test.ts`
- Test: `tests/skills/skill-discovery-protocol/integration.test.ts`

- [ ] **Step 1: スクリプトをビルドしてバンドルを更新する**

Run: `pnpm run build:scripts`
Expected: PASS（`.apm/skills/skill-discovery-protocol/scripts/infer.js` が生成される）

- [ ] **Step 2: infer の focused テストを実行する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts`
Expected: PASS

- [ ] **Step 3: generate と integration の focused テストを実行する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/generate.test.ts tests/skills/skill-discovery-protocol/integration.test.ts`
Expected: PASS

- [ ] **Step 4: パッケージ全体テストを実行する**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .apm/skills/skill-discovery-protocol/scripts/generate.js .apm/skills/skill-discovery-protocol/scripts/infer.js
git add tests/skills/skill-discovery-protocol/infer.test.ts tests/skills/skill-discovery-protocol/generate.test.ts
git add docs/specs/skills/skill-discovery-protocol/sdp-cli.md
git commit -m "test(sdp): verify infer-first pipeline for adapter validation"
```

## Self-Review

### 1. Spec coverage
- requirement: inference 生成ステップ追加
  - covered by Task 1, Task 2, Task 3
- requirement: implementation-flow / briefing-flow 検証を再実行可能にする運用導線
  - covered by Task 3（各 SKILL.md 更新）
- requirement: 検証可能性（テスト・回帰）
  - covered by Task 1, Task 4

### 2. Placeholder scan
- TBD/TODO/implement later の未記入: なし
- 「適切に対応」等の抽象表現: なし
- 実行コマンド未記載: なし

### 3. Type consistency
- inference ドキュメント型は `SkillReferenceInferenceDocument` に統一
- 新規 CLI は既存 `inference.ts` の `defaultScanListPath` / `defaultInferencePath` / `loadScanList` を利用

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-01-sdp-inference-step.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
