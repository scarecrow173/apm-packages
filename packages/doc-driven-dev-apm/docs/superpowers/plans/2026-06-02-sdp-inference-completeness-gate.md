# SDP Inference Completeness Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `skill-reference-inferences.json` に推論完了状態を明示し、`sdp infer check` と `sdp profile` が未レビューの skill を必ず失敗として扱うようにする。

**Architecture:** `review_status` を inference 成果物の各 skill に追加し、`pending` と `reviewed` を明示的に区別する。completeness validation は `src/skills/skill-discovery-protocol/scripts/lib` 配下の共有関数に集約し、`infer check` と `profile` の両方から再利用する。`catalog` と `flow profile` は従来どおり flow 実行用の正規成果物に留め、未完了状態の表現は inference 成果物と CLI エラーに閉じ込める。

**Tech Stack:** TypeScript, Node.js fs/path, zod, node:test, tsx, markdownlint-cli2

---

## ファイル構成

### Create

- `src/skills/skill-discovery-protocol/scripts/lib/inference_validation.ts`
  - inference 成果物の completeness 検証を集約する。
- `tests/skills/skill-discovery-protocol/inference-validation.test.ts`
  - completeness 検証関数の単体テストを持つ。

### Modify

- `src/skills/skill-discovery-protocol/scripts/lib/types.ts`
  - `SkillReferenceInference` に `review_status` を追加する。
- `src/skills/skill-discovery-protocol/scripts/lib/schemas/inference.ts`
  - inference schema に `review_status: "pending" | "reviewed"` を追加する。
- `src/skills/skill-discovery-protocol/scripts/lib/infer_edit.ts`
  - `init` 時の既定値を `pending` にし、既存 merge 時の互換を定義する。
- `src/skills/skill-discovery-protocol/scripts/lib/inference.ts`
  - 既存 load/enrich 周りから completeness validator を呼べるようにする。
- `src/skills/skill-discovery-protocol/scripts/infer.ts`
  - `check` の終了条件とメッセージを completeness aware に更新する。
- `src/skills/skill-discovery-protocol/scripts/profile.ts`
  - `profile` 実行前に completeness validation を必須化し、未完了時は終了コード `3` を返す。
- `tests/skills/skill-discovery-protocol/infer.test.ts`
  - `init` の既定値、`check` の失敗条件、CLI メッセージを更新する。
- `tests/skills/skill-discovery-protocol/infer-edit.test.ts`
  - `set-skill` / `apply` で `review_status` を扱う回帰を追加する。
- `tests/skills/skill-discovery-protocol/profile.test.ts`
  - inference incomplete 時に `profile` が `3` で失敗することを追加する。
- `tests/skills/skill-discovery-protocol/integration.test.ts`
  - scan -> infer -> profile の end-to-end で reviewed 化後のみ通ることを確認する。
- `docs/specs/skills/skill-discovery-protocol/sdp-cli.md`
  - `infer check` / `profile` の終了コード契約を更新する。
- `docs/specs/skills/skill-discovery-protocol/overview.md`
  - inference 成果物が review lifecycle を持つことを明記する。
- `docs/specs/skills/skill-discovery-protocol/skill-reference-catalog.md`
  - catalog は reviewed inference から生成される前提を明記する。
- `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/protocol-contract.md`
  - completeness gate の運用契約を更新する。
- `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/protocol-contract.ja.md`
  - 日本語版の completeness gate 契約を更新する。
- `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/cli-reference.md`
  - `infer check` と `profile` の運用手順を更新する。
- `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/cli-reference.ja.md`
  - 日本語版 CLI reference を更新する。

### Build Artifacts

- `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/scripts/infer.js`
- `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/scripts/profile.js`

---

### Task 1: review_status を inference schema に導入する

**Files:**

- Create: `packages/doc-driven-dev-apm/tests/skills/skill-discovery-protocol/inference-validation.test.ts`
- Modify: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/lib/types.ts`
- Modify: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/lib/schemas/inference.ts`
- Modify: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/lib/infer_edit.ts`
- Test: `packages/doc-driven-dev-apm/tests/skills/skill-discovery-protocol/infer.test.ts`

- [ ] **Step 1: 失敗する型・初期値テストを書く**

```ts
test("sdp infer init marks every scanned skill as pending", () => {
  const doc = JSON.parse(fs.readFileSync(inferPath, "utf8"));
  assert.equal(doc.skills[0].review_status, "pending");
});

test("sdp infer set-skill accepts reviewed status in a skill spec", () => {
  assert.equal(doc.skills.find((s: { name: string }) => s.name === "test-driven-development")?.review_status, "reviewed");
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts tests/skills/skill-discovery-protocol/infer-edit.test.ts`
Expected: FAIL。`review_status` 未定義、または schema validation mismatch を含む。

- [ ] **Step 3: 型定義と schema を更新する**

```ts
export type SkillReferenceInference = {
  name: string;
  review_status: "pending" | "reviewed";
  provides: { capability: string; description?: string }[];
  uses: { capability: string; required: boolean; default_skill?: string; override_allowed: boolean }[];
  execution_policy: ScannedSkill["execution_policy"];
  tags: string[];
};
```

```ts
const SkillReferenceInferenceSchema = z.object({
  name: z.string(),
  review_status: z.enum(["pending", "reviewed"]),
  provides: z.array(CapabilitySchema),
  uses: z.array(UsesSchema),
  execution_policy: ExecutionPolicySchema,
  tags: z.array(z.string()),
});
```

- [ ] **Step 4: init と merge の既定動作を実装する**

```ts
function buildInitDocument(scanList: SkillScanListDocument): SkillReferenceInferenceDocument {
  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    inference_source: "agent",
    skills: [...scanList.skills].sort((a, b) => a.name.localeCompare(b.name)).map((skill) => ({
      name: skill.name,
      review_status: "pending",
      provides: [],
      uses: [],
      execution_policy: defaultExecutionPolicy(),
      tags: [],
    })),
  };
}
```

```ts
const normalized = {
  review_status: "pending",
  provides: [],
  uses: [],
  tags: [],
  ...skillSpec,
  name,
};
```

- [ ] **Step 5: テストを再実行する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts tests/skills/skill-discovery-protocol/infer-edit.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/skills/skill-discovery-protocol/inference-validation.test.ts tests/skills/skill-discovery-protocol/infer.test.ts tests/skills/skill-discovery-protocol/infer-edit.test.ts src/skills/skill-discovery-protocol/scripts/lib/types.ts src/skills/skill-discovery-protocol/scripts/lib/schemas/inference.ts src/skills/skill-discovery-protocol/scripts/lib/infer_edit.ts
git commit -m "feat: add review status to inference schema"
```

---

### Task 2: completeness validator を共有関数として実装する

**Files:**

- Create: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/lib/inference_validation.ts`
- Create: `packages/doc-driven-dev-apm/tests/skills/skill-discovery-protocol/inference-validation.test.ts`
- Modify: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/lib/inference.ts`
- Test: `packages/doc-driven-dev-apm/tests/skills/skill-discovery-protocol/inference-validation.test.ts`

- [ ] **Step 1: completeness validator の失敗テストを書く**

```ts
test("validateInferenceCompleteness reports pending skills", () => {
  const result = validateInferenceCompleteness(scanList, inferenceDoc);
  assert.equal(result.ok, false);
  assert.deepEqual(result.pending_skills, ["spec-doc"]);
});

test("validateInferenceCompleteness passes when every skill is reviewed", () => {
  const result = validateInferenceCompleteness(scanList, reviewedDoc);
  assert.equal(result.ok, true);
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/inference-validation.test.ts`
Expected: FAIL。`validateInferenceCompleteness` が未定義。

- [ ] **Step 3: validator を実装する**

```ts
export type InferenceCompletenessResult =
  | { ok: true }
  | { ok: false; pending_skills: string[]; message: string };

export function validateInferenceCompleteness(
  scanList: SkillScanListDocument,
  inferenceDoc: SkillReferenceInferenceDocument,
): InferenceCompletenessResult {
  const scannedNames = new Set(scanList.skills.map((skill) => skill.name));
  const inferredByName = new Map(inferenceDoc.skills.map((skill) => [skill.name, skill]));
  const pendingSkills = [...scannedNames]
    .filter((name) => inferredByName.get(name)?.review_status !== "reviewed")
    .sort();

  if (pendingSkills.length === 0) return { ok: true };

  return {
    ok: false,
    pending_skills: pendingSkills,
    message: `Inference document is incomplete: ${pendingSkills.length} skill(s) still pending review: ${pendingSkills.join(", ")}`,
  };
}
```

- [ ] **Step 4: 共有 helper から validator を再利用できるようにする**

```ts
function assertInferenceComplete(
  scanList: SkillScanListDocument,
  inferenceDoc: SkillReferenceInferenceDocument,
): void {
  const result = validateInferenceCompleteness(scanList, inferenceDoc);
  if (!result.ok) throw new Error(result.message);
}
```

- [ ] **Step 5: 単体テストを再実行する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/inference-validation.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/skills/skill-discovery-protocol/scripts/lib/inference_validation.ts src/skills/skill-discovery-protocol/scripts/lib/inference.ts tests/skills/skill-discovery-protocol/inference-validation.test.ts
git commit -m "feat: add shared inference completeness validation"
```

---

### Task 3: infer check と profile に completeness gate を接続する

**Files:**

- Modify: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/infer.ts`
- Modify: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/profile.ts`
- Modify: `packages/doc-driven-dev-apm/tests/skills/skill-discovery-protocol/infer.test.ts`
- Modify: `packages/doc-driven-dev-apm/tests/skills/skill-discovery-protocol/profile.test.ts`
- Modify: `packages/doc-driven-dev-apm/tests/skills/skill-discovery-protocol/integration.test.ts`

- [ ] **Step 1: CLI 回帰テストを先に足す**

```ts
test("sdp infer check exits 3 when pending skills remain", () => {
  const result = runInfer(["check", "--in", inferPath, "--scan", scanPath], dir);
  assert.equal(result.status, 3);
  assert.ok(result.stderr.includes("pending review"));
});

test("sdp profile exits 3 when inference is incomplete", () => {
  const result = runProfile(["--adapter", "profile-test-adapter.yaml"], dir);
  assert.equal(result.status, 3);
  assert.ok(result.stderr.includes("sdp infer check"));
});
```

```ts
test("scan -> infer -> profile succeeds only after reviewed updates", () => {
  assert.equal(firstProfile.status, 3);
  assert.equal(secondProfile.status, 0);
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts tests/skills/skill-discovery-protocol/profile.test.ts tests/skills/skill-discovery-protocol/integration.test.ts`
Expected: FAIL。`check` と `profile` が pending skill を通してしまう。

- [ ] **Step 3: infer check を completeness aware に変更する**

```ts
if (args.command === "check") {
  try {
    const doc = readInferenceOrThrow(inPath);
    const scanList = loadScanList(scanPath);
    const completeness = validateInferenceCompleteness(scanList, doc);
    if (!completeness.ok) {
      console.error(completeness.message);
      process.exitCode = 3;
      return;
    }
    console.log("Inference document is valid and complete");
    return;
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
    return;
  }
}
```

- [ ] **Step 4: profile に同じ validator を接続する**

```ts
const completeness = validateInferenceCompleteness(scanList, inferenceDoc);
if (!completeness.ok) {
  console.error(completeness.message);
  console.error("Run inference review and retry:");
  console.error(`  sdp infer check --in \"${inferencePathForHint}\" --scan \"${scanPathForHint}\"`);
  process.exitCode = 3;
  return;
}
```

- [ ] **Step 5: reviewed 化を伴う統合テストを通す**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts tests/skills/skill-discovery-protocol/profile.test.ts tests/skills/skill-discovery-protocol/integration.test.ts`
Expected: PASS

- [ ] **Step 6: package 回帰テストを広げる**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/skills/skill-discovery-protocol/scripts/infer.ts src/skills/skill-discovery-protocol/scripts/profile.ts tests/skills/skill-discovery-protocol/infer.test.ts tests/skills/skill-discovery-protocol/profile.test.ts tests/skills/skill-discovery-protocol/integration.test.ts
git commit -m "feat: gate profile on complete reviewed inference"
```

---

### Task 4: 配布スクリプトと仕様書を更新する

**Files:**

- Modify: `packages/doc-driven-dev-apm/docs/specs/skills/skill-discovery-protocol/overview.md`
- Modify: `packages/doc-driven-dev-apm/docs/specs/skills/skill-discovery-protocol/sdp-cli.md`
- Modify: `packages/doc-driven-dev-apm/docs/specs/skills/skill-discovery-protocol/skill-reference-catalog.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/protocol-contract.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/protocol-contract.ja.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/cli-reference.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/cli-reference.ja.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/scripts/infer.js`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/scripts/profile.js`

- [ ] **Step 1: 仕様書の failing expectation を文章として書き換える**

```md
- `skill-reference-inferences.json` の各 skill は `review_status` を持つ。
- `sdp infer check` は schema 検証だけでなく completeness 検証も行う。
- `sdp profile` は pending skill が 1 件でも残っていれば終了コード `3` で失敗する。
```

- [ ] **Step 2: CLI 契約に終了コードを明記する**

```md
- `2`: 入力エラー、schema 不正、scan / inference 成果物不足
- `3`: inference incomplete。scan 済み skill に `review_status != reviewed` が残っている
```

- [ ] **Step 3: 配布スクリプトを再生成する**

Run: `pnpm run build:scripts`
Expected: PASS。`.apm/skills/skill-discovery-protocol/scripts/infer.js` と `profile.js` が更新される。

- [ ] **Step 4: 変更ドキュメントを lint する**

Run: `pnpm exec markdownlint-cli2 --no-globs "docs/specs/skills/skill-discovery-protocol/overview.md" "docs/specs/skills/skill-discovery-protocol/sdp-cli.md" "docs/specs/skills/skill-discovery-protocol/skill-reference-catalog.md" ".apm/skills/skill-discovery-protocol/references/protocol-contract.md" ".apm/skills/skill-discovery-protocol/references/protocol-contract.ja.md" ".apm/skills/skill-discovery-protocol/references/cli-reference.md" ".apm/skills/skill-discovery-protocol/references/cli-reference.ja.md" "docs/superpowers/plans/2026-06-02-sdp-inference-completeness-gate.md"`
Expected: PASS

- [ ] **Step 5: APM validate を実行する**

Run: `apm compile --validate`
Expected: PASS。`All primitives validated successfully!`

- [ ] **Step 6: Commit**

```bash
git add docs/specs/skills/skill-discovery-protocol/overview.md docs/specs/skills/skill-discovery-protocol/sdp-cli.md docs/specs/skills/skill-discovery-protocol/skill-reference-catalog.md .apm/skills/skill-discovery-protocol/references/protocol-contract.md .apm/skills/skill-discovery-protocol/references/protocol-contract.ja.md .apm/skills/skill-discovery-protocol/references/cli-reference.md .apm/skills/skill-discovery-protocol/references/cli-reference.ja.md .apm/skills/skill-discovery-protocol/scripts/infer.js .apm/skills/skill-discovery-protocol/scripts/profile.js
git commit -m "docs: define reviewed inference completeness contract"
```

---

## 実装メモ

- この計画では `sdp-infer-agent` を作らない。目的は推論品質の改善ではなく、未完了推論を profile に流さないこと。
- completeness 条件は `provides` 非空ではなく `review_status == "reviewed"` とする。空配列が「未推論」なのか「レビュー済みで提供能力なし」なのかを区別するため。
- `catalog` と `flow profile` には `review_status` を出さない。runtime artifact へ reviewer workflow の内部状態を漏らさないため。
- 既存 inference ファイルとの互換は `merge` / `set-skill` 更新で吸収する。古い `review_status` なしファイルは `check` で schema error になるので、`init --if-exists merge` または `set-skill` を使った再保存に寄せる。

## 検証順序

1. `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/inference-validation.test.ts`
2. `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts tests/skills/skill-discovery-protocol/infer-edit.test.ts tests/skills/skill-discovery-protocol/profile.test.ts tests/skills/skill-discovery-protocol/integration.test.ts`
3. `pnpm test`
4. `pnpm run build:scripts`
5. `pnpm exec markdownlint-cli2 --no-globs ...`
6. `apm compile --validate`

## セルフレビュー

- spec coverage: `review_status` 導入、`infer check` completeness 化、`profile` gate、終了コード `3`、関連 docs 更新を全タスクに割り当てた。
- placeholder scan: `TODO` / `TBD` / 「適切に更新する」だけの曖昧表現は残していない。
- type consistency: `review_status` の語彙は全タスクで `pending | reviewed` に統一した。終了コードは `2=input/schema/artifact`、`3=inference incomplete` に統一した。
