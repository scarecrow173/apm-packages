# SDP Infer Uses Inference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sdp infer が skill-reference-inferences.json の uses を空配列固定ではなく、スキル本文の依存ヒントから最小限かつ安定的に推論できるようにする。

**Architecture:** infer_builder に uses 専用の推論ルールを追加し、provides 推論とは分離して扱う。依存を示す語彙（requires, depends, benefits from, with review など）に限定して uses を生成し、過剰推論を抑える。CLI レベルでは既存 infer コマンドをそのまま使い、出力ドキュメントの中身だけを強化する。

**Tech Stack:** Node.js, TypeScript, node:test, tsx

---

## Scope Check

対象は skill-discovery-protocol の infer ロジック（1サブシステム）に限定するため、サブプロジェクト分割は不要。

## File Structure

- Modify: `src/skills/skill-discovery-protocol/scripts/lib/infer_builder.ts`
  - uses 推論ルール、依存文脈判定、uses エントリ生成を実装する中核。
- Modify: `tests/skills/skill-discovery-protocol/infer.test.ts`
  - uses 推論の失敗先行テストと回帰テストを追加する。
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/infer.js`
  - build:scripts 実行で更新される配布スクリプト。
- Optional Verify Artifact: `.sdp/skill-reference-inferences.json`
  - 手動検証で uses 出力を確認（コミット対象外）。

### Task 1: uses 推論の失敗先行テストを追加

**Files:**
- Modify: `tests/skills/skill-discovery-protocol/infer.test.ts`
- Test: `tests/skills/skill-discovery-protocol/infer.test.ts`

- [ ] **Step 1: 失敗先行テストを追加する（depends/requires 文脈）**

```ts
test("sdp infer derives uses when skill text declares dependency cues", () => {
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
            name: "dep-skill",
            description: "Use this skill when design work depends on code review and verification",
            body: "# Skill\nThis workflow requires code review before finalization.",
            skill_path: "/tmp/dep-skill/SKILL.md",
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

  const doc = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "skill-reference-inferences.json"), "utf8"),
  );

  assert.deepEqual(
    doc.skills[0].uses,
    [
      {
        capability: "code_review",
        required: true,
        override_allowed: true,
      },
      {
        capability: "test_planning",
        required: false,
        override_allowed: true,
      },
    ],
  );
});
```

- [ ] **Step 2: 過剰推論防止テストを追加する（依存語彙なしなら uses 空）**

```ts
test("sdp infer keeps uses empty when dependency cues are absent", () => {
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
            name: "plain-skill",
            description: "Draft specs and review outcomes",
            body: "# Skill\nGeneral guidance without dependency declaration.",
            skill_path: "/tmp/plain-skill/SKILL.md",
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

  const doc = JSON.parse(
    fs.readFileSync(path.join(dir, ".sdp", "skill-reference-inferences.json"), "utf8"),
  );

  assert.deepEqual(doc.skills[0].uses, []);
});
```

- [ ] **Step 3: 失敗確認のためテストを実行する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts --test-name-pattern "derives uses|keeps uses empty"`
Expected: FAIL（現状 uses は常に `[]`）

- [ ] **Step 4: Commit**

```bash
git add tests/skills/skill-discovery-protocol/infer.test.ts
git commit -m "test(sdp): add failing tests for infer uses dependencies"
```

### Task 2: infer_builder に uses 推論を実装

**Files:**
- Modify: `src/skills/skill-discovery-protocol/scripts/lib/infer_builder.ts`
- Test: `tests/skills/skill-discovery-protocol/infer.test.ts`

- [ ] **Step 1: uses 推論ルールと判定ヘルパーを追加する**

```ts
type UsesRule = {
  capability: string;
  dependencyPatterns: RegExp[];
  requiredPatterns: RegExp[];
};

const USES_RULES: UsesRule[] = [
  {
    capability: "code_review",
    dependencyPatterns: [
      /depends on .*review/i,
      /requires? .*review/i,
      /benefits? from .*review/i,
      /with .*code review/i,
      /before .*review/i,
    ],
    requiredPatterns: [
      /requires? .*review/i,
      /must .*review/i,
      /before .*review/i,
    ],
  },
  {
    capability: "test_planning",
    dependencyPatterns: [
      /depends on .*verification/i,
      /requires? .*verification/i,
      /test strategy/i,
      /validation steps?/i,
      /verification steps?/i,
    ],
    requiredPatterns: [
      /requires? .*verification/i,
      /must .*validation/i,
    ],
  },
];

function inferUses(text: string): SkillReferenceInference["uses"] {
  const uses = USES_RULES
    .filter((rule) => rule.dependencyPatterns.some((pattern) => pattern.test(text)))
    .map((rule) => ({
      capability: rule.capability,
      required: rule.requiredPatterns.some((pattern) => pattern.test(text)),
      override_allowed: true,
    }))
    .sort((a, b) => a.capability.localeCompare(b.capability));

  return uses;
}
```

- [ ] **Step 2: inferSkill で uses を固定配列から推論結果に置換する**

```ts
function inferSkill(skill: RawScannedSkill): SkillReferenceInference {
  const text = normalizedSkillText(skill);

  return {
    name: skill.name,
    provides: inferProvides(text),
    uses: inferUses(text),
    execution_policy: defaultExecutionPolicy(),
    tags: inferTags(text),
  };
}
```

- [ ] **Step 3: 追加テストを実行して pass を確認する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts --test-name-pattern "derives uses|keeps uses empty"`
Expected: PASS

- [ ] **Step 4: infer テスト全体を実行する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/skills/skill-discovery-protocol/scripts/lib/infer_builder.ts tests/skills/skill-discovery-protocol/infer.test.ts
git commit -m "feat(sdp): infer uses from dependency cues in skill text"
```

### Task 3: 生成スクリプト更新と実データ検証

**Files:**
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/infer.js`
- Verify: `.sdp/skill-reference-inferences.json`

- [ ] **Step 1: build で配布スクリプトを再生成する**

Run: `pnpm run build:scripts`
Expected: PASS として `.apm/skills/skill-discovery-protocol/scripts/infer.js` が更新される

- [ ] **Step 2: 実データで infer を再実行する**

Run: `pnpm -s exec node .apm/skills/skill-discovery-protocol/scripts/infer.js --scan .sdp/skill-scan-list.json --out .sdp/skill-reference-inferences.json`
Expected: `Written: .sdp\skill-reference-inferences.json`

- [ ] **Step 3: uses 推論が反映されたことを spot check する**

Run: `pnpm -s exec node -e "const fs=require('node:fs');const d=JSON.parse(fs.readFileSync('.sdp/skill-reference-inferences.json','utf8'));const withUses=d.skills.filter(s=>Array.isArray(s.uses)&&s.uses.length>0).slice(0,5).map(s=>({name:s.name,uses:s.uses}));console.log(JSON.stringify({count:withUses.length,samples:withUses},null,2));"`
Expected: `count` が 1 以上、`samples[*].uses` に capability が入る

- [ ] **Step 4: 回帰防止のため主要テストを再実行する**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts tests/skills/skill-discovery-protocol/generate.test.ts tests/skills/skill-discovery-protocol/validate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .apm/skills/skill-discovery-protocol/scripts/infer.js .sdp/skill-reference-inferences.json
git add tests/skills/skill-discovery-protocol/infer.test.ts src/skills/skill-discovery-protocol/scripts/lib/infer_builder.ts
git commit -m "build(sdp): regenerate infer script and verify uses inference output"
```

## Self-Review

1. Spec coverage
- uses が空固定の原因を解消: Task 2 で実装。
- 推論の妥当性と過剰推論防止: Task 1 の2系統テストで担保。
- CLI経由の実運用確認: Task 3 で infer.js を実行して spot check。
- 回帰確認: Task 3 Step 4 で infer/generate/validate を再実行。

2. Placeholder scan
- TBD/TODO、曖昧表現は未使用。
- 各コード変更ステップに具体コードを記載。
- 各実行ステップにコマンドと期待結果を記載。

3. Type consistency
- uses 型は既存 schema/types に合わせて `{ capability, required, override_allowed }` を維持。
- default_skill は optional のため今回の最小実装では未設定に統一。

Plan complete and saved to `docs/superpowers/plans/2026-06-01-sdp-infer-uses-inference.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
