# SDP スクリプトバグ修正 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `sdp scan` の YAML パースエラー時スキップ問題と `sdp infer apply --ops` の `review_status` 欠落問題を修正する。

**Architecture:** (1) `scanner.ts` の `parseSkillMd()` 内部で YAML パースエラーをキャッチしてフォールバック値を返す、(2) `infer_ops.ts` の `SkillSchema` に `review_status` フィールドを追加する。どちらも最小変更・後方互換。

**Tech Stack:** Node.js (CJS), TypeScript, zod v4, gray-matter, esbuild バンドラー

---

## 影響ファイル一覧

| 種別 | パス | 変更内容 |
|------|------|----------|
| Modify | `scripts/doc-driven-dev/src/skills/skill-discovery-protocol/scripts/lib/scanner.ts` | `parseSkillMd()` 内部に YAML フォールバック追加 |
| Modify | `scripts/doc-driven-dev/src/skills/skill-discovery-protocol/scripts/lib/schemas/infer_ops.ts` | `SkillSchema` に `review_status` 追加 |
| Modify | `scripts/doc-driven-dev/tests/skills/skill-discovery-protocol/scan.test.ts` | YAML フォールバックのテスト追加 |
| Modify | `scripts/doc-driven-dev/tests/skills/skill-discovery-protocol/infer-edit.test.ts` | `upsert-skill` + `review_status` のテスト追加 |
| Build | `scripts/doc-driven-dev/` | `pnpm build` でバンドル再生成 |

---

## Task 1: YAML パースエラー時のフォールバック — テスト追加

**Files:**
- Modify: `scripts/doc-driven-dev/tests/skills/skill-discovery-protocol/scan.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`scan.test.ts` の末尾（既存テストの後）に以下を追加する。既存の `setupProject()` 関数と `runScan()` 関数を利用する。

```typescript
test("sdp scan includes skill with unquoted colon-space in description as name-only fallback", () => {
  const dir = tempDir();
  setupProject(dir); // scan-skill-a を含む通常プロジェクトをセットアップ

  // YAML パースが壊れる description を持つスキルを追加
  const badSkillDir = path.join(dir, ".apm", "skills", "bad-yaml-skill");
  fs.mkdirSync(badSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(badSkillDir, "SKILL.md"),
    `---
name: bad-yaml-skill
description: A skill that uses: colon space in description
---

# Bad Yaml Skill
`,
    "utf8",
  );

  const result = runScan(["--adapter", "scan-test-adapter.yaml"], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const scanPath = path.join(dir, ".sdp", "skill-scan-list.json");
  const doc = JSON.parse(fs.readFileSync(scanPath, "utf8"));

  // 正常スキルは含まれる
  assert.ok(doc.skills.some((s: { name: string }) => s.name === "scan-skill-a"), "scan-skill-a should be included");

  // YAML パースエラーのスキルもフォールバックとして含まれる（スキップされない）
  const fallback = doc.skills.find((s: { name: string }) => s.name === "bad-yaml-skill");
  assert.ok(fallback, "bad-yaml-skill should be included as fallback, not skipped");
  assert.equal(fallback.description, "", "description should be empty string on parse failure");

  // 警告が stderr に出力されている
  assert.ok(result.stderr.includes("bad-yaml-skill") || result.stderr.includes("YAML"), `expected YAML warning in stderr, got: ${result.stderr}`);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```
cd scripts/doc-driven-dev
pnpm test -- --test-name-pattern "includes skill with unquoted"
```

Expected: テストが FAIL する（現在の実装では `bad-yaml-skill` がスキップされるため `doc.skills` に含まれない）

---

## Task 2: YAML パースエラー時フォールバック — 実装

**Files:**
- Modify: `scripts/doc-driven-dev/src/skills/skill-discovery-protocol/scripts/lib/scanner.ts`

- [ ] **Step 1: `parseSkillMd()` にフォールバックを追加する**

`parseSkillMd()` 関数（行 15-30）を以下のように変更する。YAML パースを try-catch で囲み、失敗時はディレクトリ名をスキル名として空 description/body のフォールバックを返す。

```typescript
function parseSkillMd(skillDir: string, scope = "project"): RawScannedSkill {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  const content = fs.readFileSync(skillMdPath, "utf8");

  let name: string;
  let description: string;
  let body: string;

  try {
    const { data, content: parsedBody } = matter(content);
    name = data.name || path.basename(skillDir);
    description = data.description || "";
    body = parsedBody.trim();
  } catch (e: unknown) {
    console.error(
      `Warning: YAML parse error in SKILL.md at "${skillMdPath}", using directory name as fallback: ${e instanceof Error ? e.message : String(e)}`,
    );
    name = path.basename(skillDir);
    description = "";
    body = "";
  }

  return {
    name,
    description,
    body,
    skill_path: skillMdPath,
    scope,
  };
}
```

- [ ] **Step 2: テストを実行してパスを確認**

```
cd scripts/doc-driven-dev
pnpm test -- --test-name-pattern "includes skill with unquoted"
```

Expected: PASS

- [ ] **Step 3: 既存の scan テストが壊れていないことを確認**

```
cd scripts/doc-driven-dev
pnpm test -- --test-name-pattern "sdp scan"
```

Expected: 全テスト PASS

- [ ] **Step 4: コミット**

```bash
git add scripts/doc-driven-dev/src/skills/skill-discovery-protocol/scripts/lib/scanner.ts
git add scripts/doc-driven-dev/tests/skills/skill-discovery-protocol/scan.test.ts
git commit -m "fix(sdp): fall back to dir-name on YAML parse error in parseSkillMd"
```

---

## Task 3: `upsert-skill` の `review_status` 欠落 — テスト追加

**Files:**
- Modify: `scripts/doc-driven-dev/tests/skills/skill-discovery-protocol/infer-edit.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`infer-edit.test.ts` の末尾（既存テストの後）に以下を追加する。

```typescript
test("sdp infer apply with upsert-skill preserves review_status when specified", () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });
  const inferPath = path.join(dir, ".sdp", "skill-reference-inferences.json");
  fs.writeFileSync(inferPath, JSON.stringify(baselineInference(), null, 2), "utf8");

  const opsPath = path.join(dir, ".sdp", "ops-upsert.jsonl");
  fs.writeFileSync(
    opsPath,
    JSON.stringify({
      op: "upsert-skill",
      name: "plan-doc",
      skill: {
        review_status: "reviewed",
        provides: [{ capability: "plan_authoring", description: "Author plans" }],
        uses: [],
        execution_policy: {
          strictness: "flexible",
          sequence_required: false,
          allow_step_reordering: true,
          allow_partial_application: true,
        },
        tags: ["planning"],
      },
    }) + "\n",
    "utf8",
  );

  const result = runInfer(["apply", "--ops", opsPath, "--in", inferPath], dir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const doc = JSON.parse(fs.readFileSync(inferPath, "utf8"));
  const upserted = doc.skills.find((s: { name: string }) => s.name === "plan-doc");
  assert.ok(upserted, "plan-doc should exist after upsert");
  assert.equal(
    upserted.review_status,
    "reviewed",
    `expected review_status to be "reviewed" but got "${upserted.review_status}"`,
  );
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```
cd scripts/doc-driven-dev
pnpm test -- --test-name-pattern "upsert-skill preserves review_status"
```

Expected: テストが FAIL する（現在は `review_status` が `"pending"` のまま）

---

## Task 4: `SkillSchema` に `review_status` を追加 — 実装

**Files:**
- Modify: `scripts/doc-driven-dev/src/skills/skill-discovery-protocol/scripts/lib/schemas/infer_ops.ts`

- [ ] **Step 1: `SkillSchema` に `review_status` フィールドを追加する**

`infer_ops.ts` の `SkillSchema`（行 25-30）を以下のように変更する。`optional()` にすることで既存の ops JSONL との後方互換を維持する。

```typescript
const SkillSchema = z.object({
  provides: z.array(CapabilitySchema),
  uses: z.array(UsesSchema),
  execution_policy: ExecutionPolicySchema,
  tags: z.array(z.string()),
  review_status: z.enum(["pending", "reviewed"]).optional(),
});
```

- [ ] **Step 2: テストを実行してパスを確認**

```
cd scripts/doc-driven-dev
pnpm test -- --test-name-pattern "upsert-skill preserves review_status"
```

Expected: PASS

- [ ] **Step 3: 既存の infer-edit テストが壊れていないことを確認**

```
cd scripts/doc-driven-dev
pnpm test -- --test-name-pattern "sdp infer"
```

Expected: 全テスト PASS

- [ ] **Step 4: コミット**

```bash
git add scripts/doc-driven-dev/src/skills/skill-discovery-protocol/scripts/lib/schemas/infer_ops.ts
git add scripts/doc-driven-dev/tests/skills/skill-discovery-protocol/infer-edit.test.ts
git commit -m "fix(sdp): add review_status to SkillSchema so upsert-skill can set it via apply --ops"
```

---

## Task 5: フルテストスイートとバンドル再生成

**Files:**
- Build: `scripts/doc-driven-dev/` で `pnpm build`

- [ ] **Step 1: 全テストを実行**

```
cd scripts/doc-driven-dev
pnpm test
```

Expected: 全テスト PASS（新規テスト含む）

- [ ] **Step 2: バンドルを再生成する**

ソースを変更したので `packages/doc-driven-dev/.apm/skills/` 内のコンパイル済み `.js` ファイルを更新する。

```
cd scripts/doc-driven-dev
pnpm build
```

Expected: エラーなし。以下のファイルが更新される:
- `packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/scripts/scan.js`
- `packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/scripts/infer.js`

- [ ] **Step 3: バンドル後のテストを再実行（統合確認）**

テストは `packages/doc-driven-dev/.apm/skills/` のバンドル済みスクリプトを実行するため、バンドル後も正しく動くことを確認する。

```
cd scripts/doc-driven-dev
pnpm test
```

Expected: 全テスト PASS

- [ ] **Step 4: コミット**

```bash
git add packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/scripts/scan.js
git add packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/scripts/infer.js
git commit -m "build: regenerate SDP bundles after scanner/schema fixes"
```

---

## Self-Review チェックリスト

### Spec coverage

| 要件 | 対応タスク |
|------|-----------|
| SKILL.md に `: ` が含まれてもスキャンリストにフォールバック登録される | Task 1, 2 |
| `upsert-skill` ops で `review_status: "reviewed"` が反映される | Task 3, 4 |
| 後方互換（既存 ops JSONL / `set-skill` が壊れない） | `optional()` により保証。Task 5 の全テスト実行で確認 |
| バンドル再生成 | Task 5 |

### Placeholder チェック

問題なし。全ステップにコード・コマンド・期待結果を記載済み。

### 型整合チェック

- `RawScannedSkill` 型: `scanner.ts` のフォールバックが返す `{ name, description, body, skill_path, scope }` は既存型に合致する。
- `SkillSchema` への `optional()` 追加: `upsertSkill()` の `skillSpec` は `any` 型なので、zod が strip しなければそのままマージされる。`InferOp` の `skill` フィールドの型が `z.infer<typeof SkillSchema>` に更新されるが、呼び出し元で型を直接使っている箇所はない（`infer_edit.ts` の `upsertSkill` の第3引数は `any`）。問題なし。
