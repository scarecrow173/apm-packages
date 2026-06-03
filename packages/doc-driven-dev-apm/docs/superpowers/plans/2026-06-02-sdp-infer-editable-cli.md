# SDP Infer 編集可能 CLI 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `sdp infer` に編集系サブコマンドを追加し、`skill-reference-inferences.json` をエージェントが段階的に安全更新できるようにする。

**Architecture:** `sdp infer` を単一エントリのまま維持し、既存の推論実行を `run`（既定）として残しつつ、`init` / `apply` / `check` / `set-skill` / `delete-skill` を追加する。編集系は JSONL operation を `infer_edit` モジュールで原子的に適用し、最終的に既存の推論スキーマで検証してから保存する。

**Tech Stack:** TypeScript (tsx), Node.js fs/path, zod, node:test

---

## ファイル構成

### Create

- `src/skills/skill-discovery-protocol/scripts/lib/infer_edit.ts`
  - `init` 用ドキュメント生成、JSONL operation 適用、upsert/delete を実装。
- `src/skills/skill-discovery-protocol/scripts/lib/schemas/infer_ops.ts`
  - operation の Zod schema を定義。
- `tests/skills/skill-discovery-protocol/infer-edit.test.ts`
  - 編集系サブコマンドのテストを集約。

### Modify

- `src/skills/skill-discovery-protocol/scripts/infer.ts`
  - サブコマンド解釈と各ハンドラ分岐を追加。
- `src/skills/skill-discovery-protocol/scripts/lib/inference.ts`
  - 推論ドキュメント read/write 共通ヘルパーを追加。
- `tests/skills/skill-discovery-protocol/infer.test.ts`
  - 既存 `run` 動作が壊れていないことを維持。
- `docs/specs/skills/skill-discovery-protocol/sdp-cli.md`
  - 新サブコマンド仕様を追記。

### Build Artifacts (generated)

- `.apm/skills/skill-discovery-protocol/scripts/infer.js`
- `.apm/skills/skill-discovery-protocol/scripts/sdp.js`

---

## CLI 契約（最終形）

```text
sdp infer run [--scan <json>] [--out <json>] [--cwd <dir>]
sdp infer init [--scan <json>] [--out <json>] [--cwd <dir>] [--if-exists <fail|overwrite|merge>]
sdp infer apply --ops <jsonl> --in <json> [--out <json>] [--cwd <dir>] [--dry-run]
sdp infer check --in <json> [--cwd <dir>]
sdp infer set-skill --name <skill> --spec <json> --in <json> [--out <json>] [--cwd <dir>] [--dry-run]
sdp infer delete-skill --name <skill> --in <json> [--out <json>] [--cwd <dir>] [--dry-run]
```

`apply` の JSONL 例:

```json
{"op":"add-uses","name":"spec-doc","uses":[{"capability":"adr_authoring","required":true,"override_allowed":true}]}
{"op":"add-provides","name":"spec-doc","provides":[{"capability":"spec_authoring","description":"Draft specs"}]}
{"op":"set-tags","name":"spec-doc","tags":["spec","workflow"]}
```

---

### Task 1: 失敗先行テストを追加する

**Files:**
- Create: `tests/skills/skill-discovery-protocol/infer-edit.test.ts`
- Modify: `tests/skills/skill-discovery-protocol/infer.test.ts`

- [ ] **Step 1: `init` の失敗先行テストを書く**

```ts
test("sdp infer init creates schema-valid baseline", () => {
  // scan を用意して init 実行
  // schema_version / inference_source / skill名 / default execution_policy を検証
});
```

- [ ] **Step 2: `apply` の失敗先行テストを書く**

```ts
test("sdp infer apply updates provides/uses via JSONL", () => {
  // 既存 inference + ops.jsonl を用意して apply 実行
  // uses/provides/tags の更新結果を検証
});
```

- [ ] **Step 3: ロールバックの失敗先行テストを書く**

```ts
test("sdp infer apply rolls back when an op is invalid", () => {
  // 1つ目成功、2つ目失敗の ops を用意
  // status=2 とファイル非変更を検証
});
```

- [ ] **Step 4: `check` の失敗先行テストを書く**

```ts
test("sdp infer check returns 0 for valid and 2 for invalid", () => {
  // valid -> 0
  // invalid -> 2
});
```

- [ ] **Step 5: テストを実行して失敗を確認する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer-edit.test.ts`
Expected: FAIL（未知サブコマンド / 未実装）

- [ ] **Step 6: Commit**

```bash
git add tests/skills/skill-discovery-protocol/infer-edit.test.ts tests/skills/skill-discovery-protocol/infer.test.ts
git commit -m "test: add failing tests for infer editable subcommands"
```

---

### Task 2: 編集エンジンと operation schema を実装する

**Files:**
- Create: `src/skills/skill-discovery-protocol/scripts/lib/schemas/infer_ops.ts`
- Create: `src/skills/skill-discovery-protocol/scripts/lib/infer_edit.ts`
- Modify: `src/skills/skill-discovery-protocol/scripts/lib/inference.ts`
- Test: `tests/skills/skill-discovery-protocol/infer-edit.test.ts`

- [ ] **Step 1: operation schema を実装する**

```ts
// upsert-skill / delete-skill / add-provides / add-uses / remove-provides / remove-uses
// を z.discriminatedUnion("op", ...) で定義
```

- [ ] **Step 2: inference read/write ヘルパーを追加する**

```ts
function readInferenceOrThrow(filePath: string): SkillReferenceInferenceDocument
function writeInferenceDocument(filePath: string, doc: SkillReferenceInferenceDocument): void
```

- [ ] **Step 3: init ドキュメント生成を実装する**

```ts
export function buildInitDocument(scanList: SkillScanListDocument): SkillReferenceInferenceDocument {
  // provides/uses は空、execution_policy は既定値、tags は空
}
```

- [ ] **Step 4: JSONL parser と atomic apply を実装する**

```ts
export function parseOpsJsonl(content: string): InferOp[]
export function applyOps(base: SkillReferenceInferenceDocument, ops: InferOp[]): SkillReferenceInferenceDocument
```

- [ ] **Step 5: Task 1 のテストが通ることを確認する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer-edit.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/skills/skill-discovery-protocol/scripts/lib/schemas/infer_ops.ts src/skills/skill-discovery-protocol/scripts/lib/infer_edit.ts src/skills/skill-discovery-protocol/scripts/lib/inference.ts tests/skills/skill-discovery-protocol/infer-edit.test.ts
git commit -m "feat: add infer edit engine and op schemas"
```

---

### Task 3: infer CLI にサブコマンドを接続する

**Files:**
- Modify: `src/skills/skill-discovery-protocol/scripts/infer.ts`
- Test: `tests/skills/skill-discovery-protocol/infer-edit.test.ts`
- Test: `tests/skills/skill-discovery-protocol/infer.test.ts`

- [ ] **Step 1: サブコマンドパーサを追加する**

```ts
type InferCommand = "run" | "init" | "apply" | "check" | "set-skill" | "delete-skill";
```

- [ ] **Step 2: `init` 分岐を実装する**

```ts
// scan から baseline を生成し、schema 検証後に保存
```

- [ ] **Step 3: `apply` 分岐を実装する**

```ts
// --ops を読み込み、applyOps -> schema 検証 -> 保存
```

- [ ] **Step 4: `check` / `set-skill` / `delete-skill` 分岐を実装する**

```ts
// check: validate only
// set-skill: name 指定で 1 skill upsert
// delete-skill: name 指定で削除
```

- [ ] **Step 5: usage/help を更新する**

```ts
// sdp infer run/init/apply/check/set-skill/delete-skill の使用例を表示
```

- [ ] **Step 6: infer テスト群を実行する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts tests/skills/skill-discovery-protocol/infer-edit.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/skills/skill-discovery-protocol/scripts/infer.ts tests/skills/skill-discovery-protocol/infer.test.ts tests/skills/skill-discovery-protocol/infer-edit.test.ts
git commit -m "feat: wire infer editable subcommands"
```

---

### Task 4: 仕様書更新と回帰確認

**Files:**
- Modify: `docs/specs/skills/skill-discovery-protocol/sdp-cli.md`
- Modify: `tests/skills/skill-discovery-protocol/integration.test.ts`
- Modify: `.apm/skills/skill-discovery-protocol/scripts/infer.js` (generated)
- Modify: `.apm/skills/skill-discovery-protocol/scripts/sdp.js` (generated)

- [ ] **Step 1: CLI 仕様を更新する**

```md
sdp infer run [--scan <json>] [--out <json>] [--cwd <dir>]
sdp infer init ...
sdp infer apply --ops <jsonl> ...
sdp infer check ...
sdp infer set-skill ...
sdp infer delete-skill ...
```

- [ ] **Step 2: init -> apply -> generate の統合テストを追加する**

```ts
test("editable infer workflow can feed generate", () => {
  // generate -> infer init -> infer apply(add-uses) -> generate --references
  // resolved_invocations が期待どおり解決されることを検証
});
```

- [ ] **Step 3: 生成スクリプトを再生成する**

Run: `pnpm run build:scripts`
Expected: `infer.js` / `sdp.js` が更新される

- [ ] **Step 4: 回帰テストを実行する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts tests/skills/skill-discovery-protocol/infer-edit.test.ts tests/skills/skill-discovery-protocol/generate.test.ts tests/skills/skill-discovery-protocol/validate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/specs/skills/skill-discovery-protocol/sdp-cli.md tests/skills/skill-discovery-protocol/integration.test.ts .apm/skills/skill-discovery-protocol/scripts/infer.js .apm/skills/skill-discovery-protocol/scripts/sdp.js
git commit -m "docs(test): document and verify infer editable workflow"
```

---

## Self-Review

### 1. 要件カバレッジ

- `sdp infer` の編集系サブコマンド追加: Task 3 で網羅。
- エージェント入力しやすい JSONL ベース更新: Task 2 と Task 4 で網羅。
- `uses` を明示編集可能にするフロー: Task 2/3/4 で網羅。
- 既存 `run` 動作の互換維持: Task 3 の回帰テストで担保。

### 2. プレースホルダ確認

- `TODO/TBD` なし。
- 各タスクに実行コマンドと期待結果あり。

### 3. 型整合性

- `SkillReferenceInferenceDocument` 必須項目を維持。
- `uses` は `{ capability, required, default_skill?, override_allowed }` を維持。
- `execution_policy` 必須を全フローで維持。

---

計画書は `docs/superpowers/plans/2026-06-02-sdp-infer-editable-cli.md` に保存済みです。実行は次のどちらで進めますか。

1. Subagent-Driven（推奨）
2. Inline Execution