# SDP Adapter Scoped Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `.sdp` 配下で adapter 間の非共有成果物（profile / validation report）を `adapter_id` ディレクトリに分離し、同名衝突なしで同時利用可能にする。

**Architecture:** 共有成果物（scan list / inference / catalog）は `.sdp` 直下に維持し、フロー固有成果物だけを `.sdp/<adapter_id>/` に配置する。生成・検証・問い合わせの全経路で同じパス解決ヘルパーを使い、旧配置（`.sdp/*.json`）も読める後方互換を残す。

**Tech Stack:** Node.js, TypeScript (tsx), node:test, Zod, pnpm

---

## Scope Check

今回の変更対象は 1 サブシステム（skill-discovery-protocol の artifact path ルーティング）であり、独立サブシステム分割は不要。

## File Structure

- Create: `src/skills/skill-discovery-protocol/scripts/lib/artifact_paths.ts`
  - adapter_id ベースの成果物パス解決を一元化する。
- Modify: `src/skills/skill-discovery-protocol/scripts/generate.ts`
  - profile 出力を `.sdp/<adapter_id>/` に変更し、catalog は共有として維持する。
- Modify: `src/skills/skill-discovery-protocol/scripts/validate.ts`
  - report 出力を profile と同じディレクトリへ変更し、catalog 探索を root + profile dir 両対応にする。
- Modify: `src/skills/skill-discovery-protocol/scripts/lib/query/loader.ts`
  - profile dir を優先しつつ、catalog/report のフォールバック探索を実装する。
- Modify: `src/skills/skill-discovery-protocol/scripts/lib/gates/deterministic_gate.ts`
  - 新旧配置の比較対象を適切に復元できるよう調整する。
- Modify: `.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`
  - `flow_profile` と `report` の出力先を adapter_id ディレクトリへ変更する。
- Modify: `.apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml`
  - 同上。
- Modify: `tests/skills/skill-discovery-protocol/generate.test.ts`
  - profile の adapter_id 配下出力を検証する回帰テストを追加する。
- Modify: `tests/skills/skill-discovery-protocol/validate.test.ts`
  - validation-report の profile 同居出力を検証するテストを追加する。
- Modify: `tests/skills/skill-discovery-protocol/query-regression.test.ts`
  - profile が subdir の時でも query が catalog/report を読めることを検証する。
- Modify: `docs/specs/skills/skill-discovery-protocol/sdp-cli.md`
  - 成果物配置ルールを更新する。
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/generate.js`
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/validate.js`
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/query.js`

### Task 1: パス分離の失敗先行テストを追加

**Files:**
- Modify: `tests/skills/skill-discovery-protocol/generate.test.ts`
- Modify: `tests/skills/skill-discovery-protocol/validate.test.ts`
- Modify: `tests/skills/skill-discovery-protocol/query-regression.test.ts`
- Test: `tests/skills/skill-discovery-protocol/generate.test.ts`

- [ ] **Step 1: generate の失敗テストを書く（profile が adapter_id 配下に出ること）**

```ts
// generate.test.ts に追加

test("sdp generate writes flow profile under .sdp/<adapter_id>/", () => {
  const dir = tempDir();
  setupTestProject(dir);

  const result = runSdp(["--adapter", "test-adapter.yaml"], dir);
  assert.equal(result.status, 0, result.stderr);

  const profilePath = path.join(dir, ".sdp", "test-flow-default", "test-flow-profile.json");
  assert.ok(fs.existsSync(profilePath), "profile should be adapter-scoped");
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/generate.test.ts --test-name-pattern "adapter_id"`
Expected: FAIL（現状は `.sdp/` 直下に profile が出る）

- [ ] **Step 3: validate の失敗テストを書く（report が profile と同居すること）**

```ts
// validate.test.ts に追加

test("sdp validate writes report next to profile", () => {
  const dir = tempDir();
  setupProfileFixture(dir, "test-flow-default");

  const result = runValidate([
    "--profile", ".sdp/test-flow-default/test-flow-profile.json",
    "--adapter", "test-adapter.yaml",
  ], dir);
  assert.equal(result.status, 0, result.stderr);

  const reportPath = path.join(dir, ".sdp", "test-flow-default", "validation-report.json");
  assert.ok(fs.existsSync(reportPath), "report should be co-located with profile");
});
```

- [ ] **Step 4: query 回帰失敗テストを書く（catalog が root にあっても読めること）**

```ts
// query-regression.test.ts に追加

test("query loads root catalog when profile is adapter-scoped", () => {
  const dir = tempDir();
  writeProfile(path.join(dir, ".sdp", "test-flow-default", "test-flow-profile.json"));
  writeCatalog(path.join(dir, ".sdp", "skill-reference-catalog.json"));

  const result = runQuery([
    "--profile", ".sdp/test-flow-default/test-flow-profile.json",
    "flow-stack",
  ], dir);

  assert.equal(result.status, 0, result.stderr);
});
```

- [ ] **Step 5: 追加テストを実行して失敗を確認する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/generate.test.ts tests/skills/skill-discovery-protocol/validate.test.ts tests/skills/skill-discovery-protocol/query-regression.test.ts`
Expected: FAIL（新配置に未対応）

- [ ] **Step 6: Commit**

```bash
git add tests/skills/skill-discovery-protocol/generate.test.ts tests/skills/skill-discovery-protocol/validate.test.ts tests/skills/skill-discovery-protocol/query-regression.test.ts
git commit -m "test(sdp): add failing tests for adapter-scoped artifact paths"
```

### Task 2: 成果物パス解決ヘルパーを実装

**Files:**
- Create: `src/skills/skill-discovery-protocol/scripts/lib/artifact_paths.ts`
- Test: `tests/skills/skill-discovery-protocol/generate.test.ts`

- [ ] **Step 1: パス解決ヘルパーの最小実装を書く**

```ts
// src/skills/skill-discovery-protocol/scripts/lib/artifact_paths.ts
"use strict";

const path = require("node:path");

function sdpBase(cwd: string): string {
  return path.resolve(cwd, ".sdp");
}

function adapterDir(cwd: string, adapterId: string): string {
  return path.join(sdpBase(cwd), adapterId);
}

function resolveSharedCatalogPath(cwd: string, rel: string): string {
  return path.resolve(sdpBase(cwd), rel);
}

function resolveFlowProfilePath(cwd: string, adapterId: string, rel: string): string {
  return path.resolve(adapterDir(cwd, adapterId), rel);
}

function resolveValidationReportPath(cwd: string, profilePath: string): string {
  return path.join(path.dirname(profilePath), "validation-report.json");
}

module.exports = {
  sdpBase,
  adapterDir,
  resolveSharedCatalogPath,
  resolveFlowProfilePath,
  resolveValidationReportPath,
};
```

- [ ] **Step 2: 型チェックを通すためエクスポート利用を追加する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/generate.test.ts --test-name-pattern "adapter-scoped"`
Expected: FAIL（まだ generate/validate 側が未接続）

- [ ] **Step 3: Commit**

```bash
git add src/skills/skill-discovery-protocol/scripts/lib/artifact_paths.ts
git commit -m "feat(sdp): add adapter-scoped artifact path helpers"
```

### Task 3: generate / validate / query を新配置に対応

**Files:**
- Modify: `src/skills/skill-discovery-protocol/scripts/generate.ts`
- Modify: `src/skills/skill-discovery-protocol/scripts/validate.ts`
- Modify: `src/skills/skill-discovery-protocol/scripts/lib/query/loader.ts`
- Modify: `src/skills/skill-discovery-protocol/scripts/lib/gates/deterministic_gate.ts`
- Test: `tests/skills/skill-discovery-protocol/validate.test.ts`

- [ ] **Step 1: generate で profile 出力を adapter_id 配下へ切り替える**

```ts
// generate.ts 変更イメージ
const {
  resolveSharedCatalogPath,
  resolveFlowProfilePath,
} = require("./lib/artifact_paths.ts");

const catalogRel = adapter.artifacts.protocol.skill_reference_catalog;
const profileRel = adapter.artifacts.protocol.flow_profile;

const catalogAbs = resolveSharedCatalogPath(cwd, catalogRel);
const profileAbs = resolveFlowProfilePath(cwd, adapter.adapter_id, profileRel);
```

- [ ] **Step 2: validate で report を profile 同居に変更する**

```ts
// validate.ts 変更イメージ
const { resolveValidationReportPath } = require("./lib/artifact_paths.ts");

const reportPath = resolveValidationReportPath(cwd, profilePath);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, renderJson(report), "utf8");
```

- [ ] **Step 3: query loader に root フォールバック探索を追加する**

```ts
// query/loader.ts 変更イメージ
const rootDir = path.resolve(profileDir, "..");
const catalog =
  loadOptionalJson(path.join(profileDir, "skill-reference-catalog.json")) ||
  loadOptionalJson(path.join(rootDir, "skill-reference-catalog.json"));

const validationReport =
  loadOptionalJson(path.join(profileDir, "validation-report.json")) ||
  loadOptionalJson(path.join(rootDir, "validation-report.json"));
```

- [ ] **Step 4: deterministic gate で profile/catalog の比較対象解決を維持する**

```ts
// deterministic_gate.ts 変更イメージ
// profilePath と catalogPath をそのまま比較対象に使い、
// 生成側と同一 helper を通して再計算された内容と比較する。
```

- [ ] **Step 5: 変更対象テストを実行して pass を確認する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/generate.test.ts tests/skills/skill-discovery-protocol/validate.test.ts tests/skills/skill-discovery-protocol/query-regression.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/skills/skill-discovery-protocol/scripts/generate.ts src/skills/skill-discovery-protocol/scripts/validate.ts src/skills/skill-discovery-protocol/scripts/lib/query/loader.ts src/skills/skill-discovery-protocol/scripts/lib/gates/deterministic_gate.ts
git commit -m "feat(sdp): route flow artifacts under adapter scoped directories"
```

### Task 4: adapter 設定とドキュメントを新配置へ更新

**Files:**
- Modify: `.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`
- Modify: `.apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml`
- Modify: `docs/specs/skills/skill-discovery-protocol/sdp-cli.md`
- Test: `tests/skills/skill-discovery-protocol/integration.test.ts`

- [ ] **Step 1: implementation adapter の flow_profile 出力を adapter_id 基準へ変更する**

```yaml
artifacts:
  protocol:
    flow_profile: "implementation-flow-profile.json"
    report: "validation-report.json"
```

```txt
Note: 実パスは helper が .sdp/implementation-flow-default/ を前置する。
```

- [ ] **Step 2: briefing adapter も同様に統一する**

```yaml
artifacts:
  protocol:
    flow_profile: "briefing-profile.json"
    report: "validation-report.json"
```

```txt
Note: 実パスは .sdp/briefing-flow-default/ 配下。
```

- [ ] **Step 3: CLI 仕様ドキュメントを更新する**

```md
- shared artifacts:
  - .sdp/skill-scan-list.json
  - .sdp/skill-reference-inferences.json
  - .sdp/skill-reference-catalog.json
- adapter-scoped artifacts:
  - .sdp/<adapter_id>/<flow_profile>
  - .sdp/<adapter_id>/validation-report.json
```

- [ ] **Step 4: integration テストを実行して挙動を確認する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml .apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml docs/specs/skills/skill-discovery-protocol/sdp-cli.md
git commit -m "docs(sdp): document adapter scoped artifact output layout"
```

### Task 5: フル検証と生成スクリプト同期

**Files:**
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/generate.js`
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/validate.js`
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/query.js`
- Modify (generated): `.apm/skills/skill-discovery-protocol/schemas/adapter.schema.json`

- [ ] **Step 1: ビルドを実行して生成物を同期する**

Run: `pnpm run build`
Expected: `Finished: ... script(s) built.` と `Done: 6 JSON Schema files generated.`

- [ ] **Step 2: implementation-flow の実運用コマンドを確認する**

Run: `pnpm -s exec node .apm/skills/skill-discovery-protocol/scripts/generate.js --adapter .apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`
Expected: `.sdp/implementation-flow-default/implementation-flow-profile.json` が生成 or 更新される

- [ ] **Step 3: validate を実行して report 同居を確認する**

Run: `pnpm -s exec node .apm/skills/skill-discovery-protocol/scripts/validate.js --profile .sdp/implementation-flow-default/implementation-flow-profile.json --adapter .apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`
Expected: `Report: .../.sdp/implementation-flow-default/validation-report.json`

- [ ] **Step 4: 全テストを実行する**

Run: `pnpm test`
Expected: PASS（0 failed）

- [ ] **Step 5: Commit**

```bash
git add .apm/skills/skill-discovery-protocol/scripts/generate.js .apm/skills/skill-discovery-protocol/scripts/validate.js .apm/skills/skill-discovery-protocol/scripts/query.js .apm/skills/skill-discovery-protocol/schemas/adapter.schema.json
git commit -m "build(sdp): regenerate scripts and schemas for adapter scoped artifacts"
```

## Self-Review

### 1) Spec Coverage

- 要件: flow 間で同名 profile/report が衝突しないこと
  - 対応: Task 2-3-5
- 要件: 共有成果物は共通利用（catalog など）
  - 対応: Task 2-3
- 要件: 既存 query/validate の実用性維持
  - 対応: Task 1-3
- 要件: ドキュメントと実装の同期
  - 対応: Task 4-5

ギャップ: なし。

### 2) Placeholder Scan

- `TODO`, `TBD`, 「後で実装」系の記述なし。
- すべてのコード変更ステップに具体コードまたは変更形を記載。

### 3) Type Consistency

- 用語を統一: `adapter_id`, `flow_profile`, `validation-report.json`, `skill-reference-catalog.json`。
- 新規 helper 名を全タスクで一貫して使用。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-01-sdp-adapter-scoped-artifacts.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
