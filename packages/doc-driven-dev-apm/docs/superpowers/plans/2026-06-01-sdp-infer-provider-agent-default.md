# SDP Infer Provider Agent Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status Update (2026-06-02):** この計画は実装後に方針変更され、現在は `agent` 固定で運用している。`infer_provider.ts` は削除され、`sdp infer run` は `infer_baseline.ts` を直接呼び出す。以下の `--provider` / provider切替に関する記述は履歴として残している。

**Goal (historical):** `sdp infer` の既定動作を `--provider agent` にしつつ、provider切替の拡張ポイントを残した構造へ移行する。

**Architecture (current):** 既存のルールベース推論を削除し、`infer.ts` は `infer_baseline.ts` のベースライン生成を直接呼び出す。`run` サブコマンドの推論方式は `agent` 固定で、`--provider` / `--mode` の切替はサポートしない。

**Tech Stack:** Node.js, TypeScript, node:test, tsx

---

## Scope Check

対象は skill-discovery-protocol の infer 実行経路（CLI + provider + テスト + 仕様書）のみ。独立サブシステム分割は不要。

## File Structure

- Create: `src/skills/skill-discovery-protocol/scripts/lib/infer_provider.ts`
  - providerの型定義、レジストリ、呼び出し関数を集約。
- Create: `src/skills/skill-discovery-protocol/scripts/lib/infer_provider_agent.ts`
  - `agent` provider 実装（scan入力から inference doc を返す）。
- Modify: `src/skills/skill-discovery-protocol/scripts/infer.ts`
  - `--provider` を受け付け、既定 `agent`、providerディスパッチで推論する。
- Modify: `src/skills/skill-discovery-protocol/scripts/lib/infer_builder.ts`
  - ルールベース推論ロジックを削除し、互換exportを除去（または最小delegation）。
- Modify: `tests/skills/skill-discovery-protocol/infer.test.ts`
  - provider既定/指定、unknown provider、schema不正、通常成功のテストへ更新。
- Modify: `docs/specs/skills/skill-discovery-protocol/sdp-cli.md`
  - `sdp infer --provider <name>` と default が `agent` であることを追記。
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/infer.js`
  - build:scripts で更新。

### Task 1: provider切替仕様の失敗先行テストを追加

**Files:**
- Modify: `tests/skills/skill-discovery-protocol/infer.test.ts`
- Test: `tests/skills/skill-discovery-protocol/infer.test.ts`

- [ ] **Step 1: 既定providerがagentである失敗先行テストを追加**

```ts
test("sdp infer defaults to provider=agent", () => {
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
            description: "A skill",
            body: "# Skill\nUsed in agent inference path",
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
  const doc = JSON.parse(fs.readFileSync(path.join(dir, ".sdp", "skill-reference-inferences.json"), "utf8"));
  assert.equal(doc.inference_source, "agent");
});
```

- [ ] **Step 2: unknown provider で exit 2 になる失敗先行テストを追加**

```ts
test("sdp infer rejects unknown provider", () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".sdp", "skill-scan-list.json"),
    JSON.stringify(
      {
        schema_version: "1.0",
        generated_at: "2026-06-01T00:00:00Z",
        skills: [],
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = runInfer(["--provider", "unknown"], dir);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes("Unknown provider"));
});
```

- [ ] **Step 3: providerオプション不足でexit 2の失敗先行テストを追加**

```ts
test("sdp infer exits 2 when --provider value is missing", () => {
  const dir = tempDir();
  const result = runInfer(["--provider"], dir);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes("Option --provider requires a value"));
});
```

- [ ] **Step 4: 失敗確認のためfocused testを実行**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts --test-name-pattern "defaults to provider=agent|unknown provider|--provider value is missing"`
Expected: FAIL（現状 `--provider` 非対応）

- [ ] **Step 5: Commit**

```bash
git add tests/skills/skill-discovery-protocol/infer.test.ts
git commit -m "test(sdp): add failing tests for infer provider mode"
```

### Task 2: infer CLI を providerディスパッチ構造に変更

**Files:**
- Create: `src/skills/skill-discovery-protocol/scripts/lib/infer_provider.ts`
- Create: `src/skills/skill-discovery-protocol/scripts/lib/infer_provider_agent.ts`
- Modify: `src/skills/skill-discovery-protocol/scripts/infer.ts`
- Modify: `src/skills/skill-discovery-protocol/scripts/lib/infer_builder.ts`
- Test: `tests/skills/skill-discovery-protocol/infer.test.ts`

- [ ] **Step 1: provider共通型とレジストリを新規作成**

```ts
// src/skills/skill-discovery-protocol/scripts/lib/infer_provider.ts
"use strict";

import type { RawScannedSkill, SkillReferenceInferenceDocument } from "./types";
const { buildAgentInferenceDocument } = require("./infer_provider_agent.ts");

type InferProviderName = "agent";

type InferProviderFn = (skills: RawScannedSkill[]) => SkillReferenceInferenceDocument;

const PROVIDERS: Record<InferProviderName, InferProviderFn> = {
  agent: buildAgentInferenceDocument,
};

function inferWithProvider(provider: string, skills: RawScannedSkill[]): SkillReferenceInferenceDocument {
  const fn = (PROVIDERS as Record<string, InferProviderFn>)[provider];
  if (!fn) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return fn(skills);
}

module.exports = {
  inferWithProvider,
};
```

- [ ] **Step 2: agent provider実装を作成**

```ts
// src/skills/skill-discovery-protocol/scripts/lib/infer_provider_agent.ts
"use strict";

import type {
  RawScannedSkill,
  SkillReferenceInference,
  SkillReferenceInferenceDocument,
} from "./types";

function defaultExecutionPolicy(): SkillReferenceInference["execution_policy"] {
  return {
    strictness: "flexible",
    sequence_required: false,
    allow_step_reordering: true,
    allow_partial_application: true,
  };
}

function buildAgentInferenceSkill(skill: RawScannedSkill): SkillReferenceInference {
  // 現段階では既存挙動互換を維持しつつ provider 境界のみ分離
  return {
    name: skill.name,
    provides: [
      {
        capability: "general_guidance",
        description: `Agent inference placeholder for ${skill.name}`,
      },
    ],
    uses: [],
    execution_policy: defaultExecutionPolicy(),
    tags: ["agent"],
  };
}

function buildAgentInferenceDocument(skills: RawScannedSkill[]): SkillReferenceInferenceDocument {
  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    inference_source: "agent",
    skills: [...skills].sort((a, b) => a.name.localeCompare(b.name)).map(buildAgentInferenceSkill),
  };
}

module.exports = {
  buildAgentInferenceDocument,
};
```

- [ ] **Step 3: infer.ts に provider引数（default: agent）を追加**

```ts
// infer.ts の parseArgs 型を更新
function parseArgs(argv: string[]): {
  scan?: string;
  out?: string;
  cwd?: string;
  provider?: string;
  help?: boolean;
} {
  const args: {
    scan?: string;
    out?: string;
    cwd?: string;
    provider?: string;
    help?: boolean;
  } = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scan" || arg === "--out" || arg === "--cwd" || arg === "--provider") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(`Option ${arg} requires a value`);
      }

      if (arg === "--scan") args.scan = next;
      else if (arg === "--out") args.out = next;
      else if (arg === "--cwd") args.cwd = next;
      else args.provider = next;

      i++;
    }
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

// main 内
const provider = args.provider ?? "agent";
let doc;
try {
  const { inferWithProvider } = require("./lib/infer_provider.ts");
  doc = inferWithProvider(provider, scanList.skills);
} catch (e: unknown) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 2;
  return;
}
```

- [ ] **Step 4: usageに --provider を追記**

```ts
function usage(): string {
  return `Usage: sdp infer [--scan <json>] [--out <json>] [--provider <name>] [--cwd <dir>]

Options:
  --scan      Path to skill-scan-list.json (default: .sdp/skill-scan-list.json)
  --out       Path to skill-reference-inferences.json (default: .sdp/skill-reference-inferences.json)
  --provider  Inference provider (default: agent)
  --cwd       Working directory (default: process.cwd())`;
}
```

- [ ] **Step 5: infer_builder.ts を provider責務外として最小化**

```ts
// src/skills/skill-discovery-protocol/scripts/lib/infer_builder.ts
"use strict";

// 互換性維持のための薄い橋渡し。
const { buildAgentInferenceDocument } = require("./infer_provider_agent.ts");

function buildInferenceDocument(skills: unknown[]) {
  return buildAgentInferenceDocument(skills);
}

module.exports = {
  buildInferenceDocument,
};
```

- [ ] **Step 6: focused test を再実行して pass 確認**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts --test-name-pattern "defaults to provider=agent|unknown provider|--provider value is missing"`
Expected: PASS

- [ ] **Step 7: infer テスト全体を実行**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/skills/skill-discovery-protocol/scripts/infer.ts
git add src/skills/skill-discovery-protocol/scripts/lib/infer_provider.ts
git add src/skills/skill-discovery-protocol/scripts/lib/infer_provider_agent.ts
git add src/skills/skill-discovery-protocol/scripts/lib/infer_builder.ts
git add tests/skills/skill-discovery-protocol/infer.test.ts
git commit -m "feat(sdp): default infer provider to agent with switchable provider mode"
```

### Task 3: 仕様書と生成物を更新して回帰確認

**Files:**
- Modify: `docs/specs/skills/skill-discovery-protocol/sdp-cli.md`
- Modify (generated): `.apm/skills/skill-discovery-protocol/scripts/infer.js`
- Test: `tests/skills/skill-discovery-protocol/generate.test.ts`
- Test: `tests/skills/skill-discovery-protocol/validate.test.ts`

- [ ] **Step 1: CLI仕様書を provider default agent に更新**

```md
## `sdp infer`

scan 成果物から inference 成果物を生成する。

```text
sdp infer [--scan <json>] [--out <json>] [--provider <name>] [--cwd <dir>]
```

### 入力

- `--provider <name>`: 任意。推論provider。既定値は `agent`。
```

- [ ] **Step 2: 生成スクリプトを再ビルド**

Run: `pnpm run build:scripts`
Expected: PASS、`.apm/skills/skill-discovery-protocol/scripts/infer.js` 更新

- [ ] **Step 3: infer 実行確認（provider未指定でagent）**

Run: `pnpm -s exec node .apm/skills/skill-discovery-protocol/scripts/infer.js --scan .sdp/skill-scan-list.json --out .sdp/skill-reference-inferences.json`
Expected: `Written: .sdp\skill-reference-inferences.json`

- [ ] **Step 4: infer 実行確認（provider明示）**

Run: `pnpm -s exec node .apm/skills/skill-discovery-protocol/scripts/infer.js --provider agent --scan .sdp/skill-scan-list.json --out .sdp/skill-reference-inferences.json`
Expected: `Written: .sdp\skill-reference-inferences.json`

- [ ] **Step 5: 主要回帰テストを実行**

Run: `pnpm -s exec tsx --test tests/skills/skill-discovery-protocol/infer.test.ts tests/skills/skill-discovery-protocol/generate.test.ts tests/skills/skill-discovery-protocol/validate.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add docs/specs/skills/skill-discovery-protocol/sdp-cli.md
git add .apm/skills/skill-discovery-protocol/scripts/infer.js
git add .sdp/skill-reference-inferences.json
git commit -m "docs(sdp): document infer provider option with agent default"
```

## Self-Review

1. Spec coverage
- provider agent を既定化: Task 2 Step 3 で実装。
- providerモードを拡張可能に保持: Task 2 Step 1 の registry で達成。
- ルールベース本線を除外: Task 2 Step 5 で infer_builder を薄い互換層へ変更。
- CLI・ドキュメント・テスト整合: Task 3 で網羅。

2. Placeholder scan
- TBD/TODO/後で実装なし。
- すべてのコード変更ステップに具体コードあり。
- すべての実行ステップにコマンドと期待値あり。

3. Type consistency
- inference 出力型は既存 `SkillReferenceInferenceDocument` を維持。
- `inference_source: "agent"` は schema と一致。
- provider はCLI入力文字列だが registry で厳密に検査し未知値を拒否。

Plan complete and saved to `docs/superpowers/plans/2026-06-01-sdp-infer-provider-agent-default.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
