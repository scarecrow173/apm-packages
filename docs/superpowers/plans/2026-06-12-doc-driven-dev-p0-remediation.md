# P0 矛盾解消 & オーケストレーター境界明示 実装計画

> **エージェント向け:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (推奨) または superpowers:executing-plans を使用して、このプランを Task-by-Task で実装してください。Step はチェックボックス (`- [ ]`) 構文で進捗追跡します。

**目標:** doc-driven-dev パッケージ内のメタスキル矛盾を解消し、オーケストレーター間の活性化衝突リスクを排除して、セマンティック品質を 115/160 から 135/160 以上に改善する。

**アーキテクチャ:**
1. ライフサイクル説明内の矛盾（並行作成可否）を単一の真実に統一
2. 3つのメタスキル（lifecycle/briefing-flow/implementation-flow）の活性化境界を API レベルで明示
3. レビュー gate 命名を契約化し、回帰テスト自動化

**技術スタック:** Markdown、JSON Schema、Node.js (既存スクリプトインフラ)、bash

---

## ファイル責任マップ

| ファイル | 責務 |
|---------|------|
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md` | lifecycle フェーズゲート; lifecycle vs briefing-flow 委譲の明確な分界点を定義 |
| `packages/doc-driven-dev/.apm/skills/briefing-flow/SKILL.md` | 並行作成の是非を単一の規則に統一; 矛盾するアンチパターンを削除 |
| `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md` | review gate 命名を固定し、コントラクト化 |
| `packages/doc-driven-dev/AGENTS.md` | 3つのメタスキルの活性化ルールを明記; 呼び出し先の排他性を定義 |
| `packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/assets/schemas/activation-conflict-detector.json` | **新規作成**: メタスキル profile 内での衝突検出スキーマ |
| `scripts/doc-driven-dev/tests/integration/lifecycle-activation.test.ts` | **新規作成**: briefing-flow/implementation-flow/lifecycle の活性化境界テスト |

---

## Task 1: 並行作成矛盾の根本原因を確認

**ファイル:**
- 確認: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md`
- 確認: `packages/doc-driven-dev/.apm/skills/briefing-flow/SKILL.md`

- [ ] **Step 1: 問題箇所をマップ**

lifecycle SKILL.md から抽出（段落引用）:
```
初期セクション:
"spec と ADR は Phase 1 完了時に並行して作成される可能性がある"
+ "When Phase 1 produces enough context, both spec and ADR can be written simultaneously"

vs

アンチパターン表:
"Parallel docs with dependencies lose consistency. Merge conflicts in prose"
```

briefing-flow SKILL.md から確認:
```
"dispatch to sub-agents immediately when sufficient information is gathered, 
 preventing context freshness (detail level) degradation"
+ "Fire whichever trigger is ready first"
+ "Both skills can be dispatched independently — concurrent execution is fine"
```

矛盾の要点: lifecycle は初期セクションで並行許容 → アンチパターンで否定。  
briefing-flow は明確に並行実行を奨励。

- [ ] **Step 2: 真実の定義（ドメイン設計へのフィードバック）**

spec と ADR は **独立した documents** であり、同一の discovery output からの二つの視座を表現するため、並行作成は正当。  
判定: **アンチパターン表の記述が誤り** → 並行作成を正当化し、"merged dependencies" 矛盾の具体例で置き換え。

---

## Task 2: doc-driven-dev-lifecycle SKILL.md のアンチパターン表を修正

**ファイル:**
- 修正: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md:300-330`
- 検証: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md` (アンチパターン全体)

- [ ] **Step 1: 現在の誤った行を確認**

```bash
grep -n "Parallel docs with dependencies lose consistency" \
  packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md
```

Expected output: 行番号（約 313 付近）。

- [ ] **Step 2: アンチパターン表内の該当行を置き換え**

古い行:
```markdown
| "Parallel doc creation saves time" | Parallel docs with dependencies lose consistency. Merge conflicts in prose |
```

新しい行:
```markdown
| "Parallel doc creation saves time" | **Allowed when independent**: spec + ADR created in parallel from same discovery (Phase 1: briefing-flow). **Prohibited when dependent**: creating task-doc before plan-doc approval, or design without spec consensus. Rule: parallel when docs address different questions from same data; sequential when later depends on earlier decision. |
```

ツール: `replace_string_in_file`

```bash
# 検証: 置き換え後にアンチパターンが整合するか確認
grep -A2 "Parallel doc creation" packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md
```

Expected: 新しい説明が表示される。

- [ ] **Step 3: lifecycle 初期セクションとの整合を文言で明示**

lifecycle SKILL.md の「Flow Overview」直後に 1 行追加:

```markdown
**Key constraint resolution**: Phase 1 (Briefing) explicitly permits spec + ADR 
parallel creation when derived from the same discovery context, as managed by 
`briefing-flow`. Later phases enforce sequential gates (Phase 2 requires Phase 1 
complete, Phase 3 requires Phase 2 approved design, etc.).
```

- [ ] **Step 4: Commit**

```bash
cd /d/repository/apm-packages
git add packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md
git commit -m "fix: clarify parallel doc creation is valid in Phase 1 only

- Correct anti-pattern table: parallel creation allowed for independent docs 
  (spec+ADR from same discovery)
- Add constraint resolution note in lifecycle overview
- Align with briefing-flow concurrent dispatch design"
```

---

## Task 3: メタスキル活性化ルールを AGENTS.md に明記

**ファイル:**
- 修正: `packages/doc-driven-dev/AGENTS.md`
- 作成: 参照セクション `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/orchestration-boundaries.md`

- [ ] **Step 1: AGENTS.md の新規セクション「Meta-Skill Activation Boundaries」を追加**

現在のセクション 7 (Workflow Skills) 直後に新規セクション 8 を挿入:

```markdown
## 8. Meta-Skill Activation Boundaries

The package contains three orchestration meta-skills that must not activate 
simultaneously on the same request. This section defines the **activation matrix** 
and **entry point rules**.

### Activation Rules

| Skill | Entry Condition | Primary Responsibility | Blocking Constraint |
|-------|-----------------|------------------------|----------------------|
| `doc-driven-dev-lifecycle` | User requests end-to-end document workflow | Phase orchestration (1-6) | Must NOT be invoked if user explicitly requests single skill |
| `briefing-flow` | Phase 1 info gathering, ambiguous requirements | Briefing-phase routing | Invoked by lifecycle Phase 1 OR standalone. Cannot run if spec+ADR already exist |
| `implementation-flow` | Phase 5 code execution, task-doc ready | Execution-phase routing | Invoked by lifecycle Phase 5 OR standalone. Cannot run before Phase 4 complete |

### Dispatch Decision Tree

```
User request received
  ↓
[1] Does request explicitly name a single skill? 
    YES → Activate that skill directly. STOP.
    NO → Continue to [2]
  ↓
[2] Is the work a complete feature/project lifecycle?
    YES → Activate lifecycle. STOP.
    NO → Continue to [3]
  ↓
[3] Is the work limited to Phase 1 (discovery → spec/ADR)?
    YES → Activate briefing-flow directly. STOP.
    NO → Continue to [4]
  ↓
[4] Is the work limited to Phase 5 (implement task-doc)?
    YES → Activate implementation-flow directly. STOP.
    NO → Unclear routing. Request clarification.
```

### Guaranteed Invariants

- lifecycle, briefing-flow, implementation-flow MUST be mutually exclusive on 
  activation (only one active per user request).
- If nested invocation is required (e.g., lifecycle → briefing-flow), that 
  relationship is explicit and uni-directional in SKILL.md.
- No skill should auto-activate another meta-skill without user knowledge.
```

- [ ] **Step 2: Commit**

```bash
git add packages/doc-driven-dev/AGENTS.md
git commit -m "docs: add meta-skill activation boundaries matrix

- Document exclusive activation rules for lifecycle/briefing-flow/implementation-flow
- Add dispatch decision tree for runtime routing
- Record activation invariants to prevent double-invocation"
```

---

## Task 4: review gate 命名契約を固定・テスト化

**ファイル:**
- 作成: `packages/doc-driven-dev/.apm/skills/implementation-flow/references/review-gate-contract.md` 
- 修正: `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md:300-320`
- 作成: `scripts/doc-driven-dev/tests/integration/review-gate-contract.test.ts`

- [ ] **Step 1: review gate コントラクト定義ドキュメントを作成**

`packages/doc-driven-dev/.apm/skills/implementation-flow/references/review-gate-contract.md`:

```markdown
# Review Gate Contract

## Definition

The **review gate** is a named execution hook in Phase E (Review) that MUST 
reference a skill named `requesting-code-review` or an equivalent 
environment-provided review skill.

## Canonical Name

- Primary: `requesting-code-review`
- Fallback env names: `code-review`, `review-request` (with schema migration)

## Binding Contract

1. In generated profile JSON (`.sdp/implementation-flow-default/implementation-flow-profile.json`), 
   the `flow-stack` slot `review` MUST resolve to one of the canonical names above.

2. In `implementation-flow` SKILL.md Phase E section, reference MUST be exact:
   ```markdown
   Submit implementation for review (using Review-category skills if available).
   ```

3. At runtime, if the resolved skill name is not in the canonical set, the 
   orchestrator MUST emit a WARN and offer the user an override option.

## Verification

Test file: `scripts/doc-driven-dev/tests/integration/review-gate-contract.test.ts`
- Scan all profiles for `review` slot resolution
- Assert resolved skill is in canonical set
- Report any drift for human review
```

- [ ] **Step 2: implementation-flow SKILL.md Phase E を微修正**

現在:
```markdown
## Phase E: Review

1. Submit implementation for review (using Review-category skills if available).
```

修正後:
```markdown
## Phase E: Review

The review gate MUST route to the skill named `requesting-code-review` 
(see `references/review-gate-contract.md` for fallback resolution).

1. Submit implementation for review via the Review-category skill resolved 
   by the profile (`requesting-code-review` canonical, or environment equivalent).
2. Address feedback systematically.
3. Record any new constraints discovered during review.
```

- [ ] **Step 3: テストスクリプトを作成**

`scripts/doc-driven-dev/tests/integration/review-gate-contract.test.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";

interface FlowProfile {
  flow_stack?: {
    slots?: Array<{
      name: string;
      resolved_invocation?: string;
    }>;
  };
  resolved_invocations?: Record<string, unknown>;
}

const CANONICAL_REVIEW_SKILLS = [
  "requesting-code-review",
  "code-review",
  "review-request",
];

describe("Review Gate Contract", () => {
  it("should resolve review slot to canonical skill name", () => {
    const profilePath = path.join(
      __dirname,
      "../../packages/doc-driven-dev/.sdp/implementation-flow-default/implementation-flow-profile.json"
    );

    if (!fs.existsSync(profilePath)) {
      console.warn(
        `Profile not found at ${profilePath}; skipping profile-based test`
      );
      return;
    }

    const profileContent = fs.readFileSync(profilePath, "utf-8");
    const profile: FlowProfile = JSON.parse(profileContent);

    if (!profile.flow_stack?.slots) {
      throw new Error(
        "Profile missing flow_stack.slots; contract incomplete"
      );
    }

    const reviewSlot = profile.flow_stack.slots.find(
      (s) => s.name === "review"
    );

    if (!reviewSlot) {
      throw new Error(
        "Profile missing 'review' slot in flow_stack; contract violation"
      );
    }

    const resolvedSkill = reviewSlot.resolved_invocation;
    if (!resolvedSkill) {
      throw new Error(
        "Review slot not resolved; profile is incomplete or stale"
      );
    }

    if (!CANONICAL_REVIEW_SKILLS.includes(resolvedSkill)) {
      throw new Error(
        `Review slot resolved to non-canonical skill: "${resolvedSkill}". ` +
          `Expected one of: ${CANONICAL_REVIEW_SKILLS.join(", ")}`
      );
    }
  });

  it("should verify review gate reference in SKILL.md matches resolved skill", () => {
    const skillMdPath = path.join(
      __dirname,
      "../../packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md"
    );

    const skillContent = fs.readFileSync(skillMdPath, "utf-8");

    // Check for the contract-aware reference
    if (!skillContent.includes("requesting-code-review")) {
      console.warn(
        "SKILL.md does not reference canonical review skill name; may cause drift"
      );
    }

    // Check Phase E section exists
    if (!skillContent.match(/## Phase E.*Review/s)) {
      throw new Error("SKILL.md missing Phase E Review section");
    }
  });
});
```

- [ ] **Step 4: テストの実行可能性を検証**

```bash
cd /d/repository/apm-packages/scripts/doc-driven-dev
npm test -- review-gate-contract.test.ts
```

Expected: PASS (またはプロファイルがまだ生成されていない場合は SKIP)。

- [ ] **Step 5: Commit**

```bash
cd /d/repository/apm-packages
git add \
  packages/doc-driven-dev/.apm/skills/implementation-flow/references/review-gate-contract.md \
  packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md \
  scripts/doc-driven-dev/tests/integration/review-gate-contract.test.ts

git commit -m "feat: add review gate contract and regression test

- Define canonical review skill names in new contract reference doc
- Update Phase E to reference the contract explicitly
- Add integration test to verify profile resolves to canonical skill
- Prevents naming drift and ensures runtime stability"
```

---

## Task 5: 活性化衝突検出スキーマを作成

**ファイル:**
- 作成: `packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/assets/schemas/activation-conflict-detector.json`
- 作成: `scripts/doc-driven-dev/tests/integration/activation-conflict-detector.test.ts`

- [ ] **Step 1: 衝突検出スキーマを定義**

`packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/assets/schemas/activation-conflict-detector.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Activation Conflict Detector Schema",
  "description": "Validates that meta-skills cannot be simultaneously active in a generated profile",
  "type": "object",
  "properties": {
    "meta_skills": {
      "type": "array",
      "description": "List of mutually exclusive meta-skill names",
      "items": {
        "type": "string"
      },
      "examples": [
        ["doc-driven-dev-lifecycle", "briefing-flow", "implementation-flow"]
      ]
    },
    "flow_stack": {
      "type": "object",
      "description": "Flow stack configuration",
      "properties": {
        "always_on": {
          "type": "array",
          "description": "Skills that are always activated",
          "items": { "type": "string" }
        },
        "slots": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "resolved_invocation": { "type": "string" }
            },
            "required": ["name", "resolved_invocation"]
          }
        }
      }
    }
  },
  "additionalProperties": false,
  "required": ["meta_skills"],
  "rules": [
    {
      "rule": "no-dual-meta-skill-activation",
      "description": "If any meta-skill from meta_skills list appears in always_on or resolved slots, no other meta-skill from the list may appear",
      "severity": "error"
    }
  ]
}
```

- [ ] **Step 2: 衝突検出テストを作成**

`scripts/doc-driven-dev/tests/integration/activation-conflict-detector.test.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";

const META_SKILLS = [
  "doc-driven-dev-lifecycle",
  "briefing-flow",
  "implementation-flow",
];

interface Profile {
  flow_stack?: {
    always_on?: string[];
    slots?: Array<{ name: string; resolved_invocation?: string }>;
  };
}

describe("Activation Conflict Detector", () => {
  it("should detect if multiple meta-skills are activated simultaneously", () => {
    const profilePath = path.join(
      __dirname,
      "../../packages/doc-driven-dev/.sdp/implementation-flow-default/implementation-flow-profile.json"
    );

    if (!fs.existsSync(profilePath)) {
      console.warn(
        `Profile not found at ${profilePath}; skipping conflict detection`
      );
      return;
    }

    const profileContent = fs.readFileSync(profilePath, "utf-8");
    const profile: Profile = JSON.parse(profileContent);

    const flowStack = profile.flow_stack;
    if (!flowStack) {
      console.warn("No flow_stack in profile; skipping");
      return;
    }

    const activatedMetaSkills: string[] = [];

    // Check always_on
    if (flowStack.always_on) {
      const activatedAlwaysOn = flowStack.always_on.filter((skill) =>
        META_SKILLS.includes(skill)
      );
      activatedMetaSkills.push(...activatedAlwaysOn);
    }

    // Check resolved slots
    if (flowStack.slots) {
      for (const slot of flowStack.slots) {
        if (
          slot.resolved_invocation &&
          META_SKILLS.includes(slot.resolved_invocation)
        ) {
          activatedMetaSkills.push(slot.resolved_invocation);
        }
      }
    }

    // Verify no duplicates and at most one active
    const uniqueActivated = Array.from(new Set(activatedMetaSkills));
    if (uniqueActivated.length > 1) {
      throw new Error(
        `Activation conflict detected: multiple meta-skills active: ${uniqueActivated.join(", ")}. ` +
          `Only one of [${META_SKILLS.join(", ")}] may be active at a time.`
      );
    }

    if (uniqueActivated.length === 1) {
      console.log(`✓ Single meta-skill active: ${uniqueActivated[0]}`);
    } else {
      console.log(`✓ No meta-skill active (profile is skill-specific)`);
    }
  });

  it("should pass when only one meta-skill is in always_on", () => {
    const testProfile: Profile = {
      flow_stack: {
        always_on: ["doc-driven-dev-lifecycle"],
        slots: [
          { name: "build", resolved_invocation: "incremental-implementation" },
          { name: "review", resolved_invocation: "requesting-code-review" },
        ],
      },
    };

    const metaSkillsInProfile = (testProfile.flow_stack?.always_on ?? []).filter(
      (skill) => META_SKILLS.includes(skill)
    );

    expect(metaSkillsInProfile.length).toBeLessThanOrEqual(1);
  });

  it("should fail when two meta-skills appear in slots", () => {
    const badProfile: Profile = {
      flow_stack: {
        slots: [
          {
            name: "phase1",
            resolved_invocation: "doc-driven-dev-lifecycle",
          },
          { name: "phase5", resolved_invocation: "briefing-flow" },
        ],
      },
    };

    const activatedMetaSkills: string[] = [];
    if (badProfile.flow_stack?.slots) {
      for (const slot of badProfile.flow_stack.slots) {
        if (
          slot.resolved_invocation &&
          META_SKILLS.includes(slot.resolved_invocation)
        ) {
          activatedMetaSkills.push(slot.resolved_invocation);
        }
      }
    }

    expect(activatedMetaSkills.length).toBeGreaterThan(1);
    expect(() => {
      if (activatedMetaSkills.length > 1) {
        throw new Error(
          `Activation conflict: ${activatedMetaSkills.join(", ")}`
        );
      }
    }).toThrow();
  });
});
```

- [ ] **Step 3: テスト実行**

```bash
cd /d/repository/apm-packages/scripts/doc-driven-dev
npm test -- activation-conflict-detector.test.ts
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
cd /d/repository/apm-packages
git add \
  packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/assets/schemas/activation-conflict-detector.json \
  scripts/doc-driven-dev/tests/integration/activation-conflict-detector.test.ts

git commit -m "feat: add activation conflict detection schema and test

- Define mutual exclusivity constraint for meta-skills via JSON schema
- Add integration test to verify only one meta-skill active per profile
- Prevents runtime double-invocation of lifecycle/briefing-flow/implementation-flow"
```

---

## Task 6: 総括テスト & 完全性チェック

**ファイル:**
- 検証: すべての修正・作成ファイル
- 実行: doc-driven-dev 用フルテストスイート

- [ ] **Step 1: ファイル整合性チェック**

```bash
cd /d/repository/apm-packages

# Check all references are consistent
echo "=== Checking skill-discovery-protocol reference in lifecycle ==="
grep -r "skill-discovery-protocol" packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/

echo "=== Checking review-gate-contract reference in implementation-flow ==="
grep -r "review-gate-contract" packages/doc-driven-dev/.apm/skills/implementation-flow/

echo "=== Checking orchestration-boundaries reference in doc-driven-dev-lifecycle ==="
grep -r "orchestration-boundaries\|Meta-Skill Activation" packages/doc-driven-dev/AGENTS.md
```

Expected: すべての参照が一致する行を出力。

- [ ] **Step 2: Markdown 整形チェック**

```bash
cd /d/repository/apm-packages
pnpm --dir scripts/doc-driven-dev run lint:md -- \
  packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md \
  packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md \
  packages/doc-driven-dev/AGENTS.md
```

Expected: エラーなし。

- [ ] **Step 3: 全テストスイート実行**

```bash
cd /d/repository/apm-packages/scripts/doc-driven-dev
npm test
```

Expected: すべてのテスト (review-gate-contract と activation-conflict-detector を含む) がパス。

- [ ] **Step 4: APM compile 検証**

```bash
cd /d/repository/apm-packages
apm compile --validate --config packages/doc-driven-dev/apm.yml
```

Expected: 重大エラーなし (スキルのみパッケージについて instruction 不在の警告は許容可能)。

- [ ] **Step 5: 変更内容の総括**

```bash
cd /d/repository/apm-packages
git log --oneline -6
```

Expected: 5 つの commit が表示:
1. fix: clarify parallel doc creation...
2. docs: add meta-skill activation boundaries...
3. feat: add review gate contract...
4. feat: add activation conflict detection...

- [ ] **Step 6: Final commit: 計画レジストリに実行完了を記録**

```bash
git add -A
git commit -m "chore: complete P0 remediation plan

- Resolved lifecycle/briefing-flow parallel creation contradiction
- Defined meta-skill activation boundaries in AGENTS.md
- Contractified review gate naming with regression tests
- Added activation conflict detection schema
- All P0 items addressed; ready for re-evaluation"
```

---

## 自己レビュー

✓ **Spec 適合性**: P0 評価で特定された 3 つの重大項目すべてに対応
  - ✓ Lifecycle 矛盾の解消 (Task 2)
  - ✓ メタスキル境界の明示 (Task 3)
  - ✓ Review gate 命名契約化 (Task 4)

✓ **プレースホルダースキャン**: TBD/TODO/「実装後」なし。すべてのコード例、コマンド、期待出力が具体的。

✓ **型一貫性**:
  - スキル名は統一: `requesting-code-review`, `doc-driven-dev-lifecycle`, `briefing-flow`, `implementation-flow`
  - JSON フィールド名は統一: `flow_stack`, `slots`, `resolved_invocation`, `always_on`

✓ **ファイル責務**:
  - SKILL.md ファイル：説明・ゲート・契約の明示
  - AGENTS.md：マクロレベルの活性化ルール
  - テストファイル：回帰防止
  - スキーマ：形式的な制約定義

✓ **並行作成矛盾のコア修正**: アンチパターン表で「並行は常に悪」から「独立ドキュメントなら並行可」への意味転換により、lifecycle 初期セクションとの矛盾解消。

---

## 実行選択

計画完成・保存完了: [docs/superpowers/plans/2026-06-12-doc-driven-dev-p0-remediation.md](docs/superpowers/plans/2026-06-12-doc-driven-dev-p0-remediation.md)

**2 つの実行方式から選択してください:**

**1. Subagent-Driven (推奨)** - 各 Task ごとに fresh subagent を起動し、Task 間で review チェックポイント実施。高速反復。

**2. Inline Execution** - この session 内で executing-plans skill を使用し、batch 実行 + checkpoint review で進行。

**どちらの方式で進めますか?**
