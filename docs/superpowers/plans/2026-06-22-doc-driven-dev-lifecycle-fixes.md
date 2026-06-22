# doc-driven-dev ライフサイクル問題修正 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2026-06-22 のセッションで発見された `doc-driven-dev-lifecycle` スキル動作問題（9件）をドキュメント修正で解消する。

**Architecture:** 修正対象はすべてドキュメント（Markdown / テンプレート）であり、コード変更なし。実装と乖離しているドキュメントを実装に合わせて更新し、不明瞭なゲート定義を明確化する。

**Tech Stack:** Markdown, YAML front matter（`infer.js` の Zod スキーマが実装の正となる）

---

## 修正対象ファイル一覧

| ファイル | 問題 |
|---------|------|
| `.agents/skills/skill-discovery-protocol/references/schema-reference.md` | `execution_policy` スキーマが実装と乖離（§5.1–§5.2） |
| `.agents/skills/skill-discovery-protocol/references/protocol-contract.md` | `provides[]`/`uses[]` の要素型が §4 に未記載 |
| `.agents/skills/skill-discovery-protocol/references/cli-reference.md` | `sdp` 直接実行前提・`--adapter` 省略・Windows 注意事項なし |
| `.agents/skills/briefing-flow/SKILL.md` | アダプターパス `.apm/` ハードコード・Phase D ゲートが `alternatives:` / `acceptance_criteria:` front matter を誤参照 |
| `.agents/skills/doc-driven-dev-lifecycle/SKILL.md` | Phase 1 Exit チェックリストのゲート記述が front matter 前提で不明確 |

---

## Task 1: `execution_policy` スキーマ修正（schema-reference.md §5.1–§5.2）

**Files:**
- Modify: `.agents/skills/skill-discovery-protocol/references/schema-reference.md:181-219`

実装（`infer.js:15149–15154`）の実際の Zod スキーマ：
```typescript
{
  strictness: enum(["rigid", "flexible"]),
  sequence_required: boolean,
  allow_step_reordering: boolean,
  allow_partial_application: boolean,
  guidance: string (optional)
}
```

文書の §5.1 は古いフィールド（`requires_human_review`, `max_parallel` 等）を示している。

- [ ] **Step 1: schema-reference.md §5.1 のコード例を実装に合わせて書き換える**

現在の §5.1（181–195行）：
```json
{
  "execution_policy": {
    "requires_human_review": false,
    "max_parallel": 1,
    "timeout_seconds": null,
    "retry_on_failure": false,
    "idempotent": true
  }
}
```

書き換え後：
```json
{
  "execution_policy": {
    "strictness": "flexible",
    "sequence_required": false,
    "allow_step_reordering": true,
    "allow_partial_application": true,
    "guidance": "optional explanation text"
  }
}
```

- [ ] **Step 2: §5.2 Fields テーブルを実装に合わせて書き換える**

現在の Fields テーブル（198–205行）を以下に置き換える：

```markdown
| Field | Type | Description |
| ----- | ---- | ----------- |
| `strictness` | `"rigid"` \| `"flexible"` | Execution mode — `rigid`: follow exactly, no reordering; `flexible`: apply spirit, adapt to context |
| `sequence_required` | boolean | Steps must be executed in declared sequence |
| `allow_step_reordering` | boolean | Steps may be reordered to fit context |
| `allow_partial_application` | boolean | Skill may be applied partially without covering all steps |
| `guidance` | string (optional) | Free-text note for execution-time context |
```

- [ ] **Step 3: §5.4 `runtime_guidance` に必須フィールドを追記する**

`RuntimeGuidanceSchema`（`infer.js:15156–15165`）には `skill`, `context`, `guidance` という必須フィールドがある。現行 §5.4 には Common fields のみ列挙されており、必須フィールドが明示されていない。

§5.4 の冒頭に以下を追加する（現行の Common fields テーブルの前）：

```markdown
Required fields per entry:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `skill` | string | Skill name this guidance applies to |
| `context` | string | Scenario or condition under which this guidance applies |
| `guidance` | string | Instruction or recommendation for the executor |
```

- [ ] **Step 4: ファイルを保存して前後の行を目視確認する**

Run: `Select-String -Path ".agents\skills\skill-discovery-protocol\references\schema-reference.md" -Pattern "strictness|sequence_required|requires_human_review" | Select-Object LineNumber, Line`  
Expected: `strictness` が登場し、`requires_human_review` が存在しないこと

- [ ] **Step 5: コミット**

```bash
git add .agents/skills/skill-discovery-protocol/references/schema-reference.md
git commit -m "docs(sdp): align execution_policy schema docs with Zod implementation"
```

---

## Task 2: `provides[]`/`uses[]` 要素型をドキュメントに追記（protocol-contract.md §4）

**Files:**
- Modify: `.agents/skills/skill-discovery-protocol/references/protocol-contract.md:69-98`

実装（`infer.js:15139–15147`）の実際の型：
```typescript
// CapabilitySchema (provides[])
{ capability: string, description?: string }

// UsesSchema (uses[])
{ capability: string, required: boolean, override_allowed: boolean, default_skill?: string }
```

現行 §4 の Inference Contract テーブルには `provides` と `uses` が "Capabilities offered/consumed"（配列）とだけ書かれており要素の型がない。

- [ ] **Step 1: §4 テーブルの後に要素型テーブルを追記する**

テーブルの直後（`Every scanned skill MUST...` の前）に追記：

```markdown
### `provides[]` Element Schema

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `capability` | string | Yes | `snake_case` capability identifier |
| `description` | string | No | Human-readable explanation of the capability |

### `uses[]` Element Schema

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `capability` | string | Yes | `snake_case` capability identifier consumed by this skill |
| `required` | boolean | Yes | Whether this capability must be satisfied for the skill to execute |
| `override_allowed` | boolean | Yes | Whether the invoker may substitute a different skill for this capability |
| `default_skill` | string | No | Preferred skill to satisfy this capability, if known |
```

- [ ] **Step 2: §5 の `provides[]` 説明に §4 へのリンクを追記する**

§5（`provides[].capability` の一意性の制約の後）に以下の注記を追加する：

```markdown
For `provides[]` and `uses[]` element schemas, see §4 Inference Contract above.
```

- [ ] **Step 3: ファイルを保存して確認**

Run: `Select-String -Path ".agents\skills\skill-discovery-protocol\references\protocol-contract.md" -Pattern "override_allowed|default_skill" | Select-Object LineNumber, Line`  
Expected: 両フィールドが §4 に存在すること

- [ ] **Step 4: コミット**

```bash
git add .agents/skills/skill-discovery-protocol/references/protocol-contract.md
git commit -m "docs(sdp): document provides[] and uses[] element schemas in protocol-contract"
```

---

## Task 3: CLI リファレンス修正（cli-reference.md）

**Files:**
- Modify: `.agents/skills/skill-discovery-protocol/references/cli-reference.md`

3つの問題を1ファイルでまとめて修正する。

- [ ] **Step 1: Operator Recipe セクションに `sdp` コマンドの実際の起動方法を注記として追加する**

Operator Recipe コードブロック（15–22行）の直前に以下の注記を追加する：

````markdown
> **Note:** `sdp` is not a globally installed binary. Invoke it via your runtime manager:
>
> ```powershell
> # Example: mise (recommended)
> mise exec -- node <skill-root>/skill-discovery-protocol/scripts/sdp.js <subcommand>
> ```
>
> Where `<skill-root>` is the directory containing your installed skills (e.g., `.agents/skills/`, `.apm/skills/`, or `.claude/skills/`).
> In examples below, `sdp` is used as shorthand for the full invocation above.
````

- [ ] **Step 2: §1.4 `sdp validate` を更新して、全ゲート実行には両フラグが必要な旨を明示する**

現行の §1.4（65–72行）を以下に置き換える：

```markdown
### 1.4 `sdp validate`

```text
sdp validate --profile <flow-profile-json> --adapter <adapter-yaml>
sdp validate --profile <flow-profile-json>
sdp validate --adapter <adapter-yaml>
```

- `--profile --adapter` (both): Full 4-gate validation (Schema, Staleness, Deterministic, Blocking)
- `--profile` only: Schema and Staleness gates run; Deterministic and Blocking gates are **skipped**
- `--adapter` only: Schema-only validation of adapter YAML configuration
```

- [ ] **Step 3: Windows 注意事項セクションを末尾に追加する**

ファイル末尾に以下を追加：

````markdown
---

## Windows PowerShell Notes

When generating JSON for `sdp infer set-skill` from PowerShell, two pitfalls apply.

### BOM-encoded UTF-8

PowerShell `Out-File -Encoding utf8` writes UTF-8 with BOM. Node.js `JSON.parse` cannot read BOM-prefixed JSON and throws:

```
Unexpected token '﻿', "﻿{..." is not valid JSON
```

Use `System.Text.UTF8Encoding($false)` to write without BOM:

```powershell
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tempFile, $json, $utf8NoBom)
```

### Single-element array serialized as object

`ConvertTo-Json` flattens a single-element array to a bare object:

```powershell
# Produces: {"capability":"problem_framing"}  ← NOT an array
@(@{capability="problem_framing"}) | ConvertTo-Json
```

Build the JSON as a literal string instead:

```powershell
$prov = '[{"capability":"problem_framing"}]'
$json = "{`"review_status`":`"reviewed`",`"provides`":$prov,...}"
```
````

- [ ] **Step 4: ファイルを保存して確認**

Run: `Select-String -Path ".agents\skills\skill-discovery-protocol\references\cli-reference.md" -Pattern "BOM|utf8NoBom|both\):" | Select-Object LineNumber, Line`  
Expected: 3つのキーワードが見つかること

- [ ] **Step 5: コミット**

```bash
git add .agents/skills/skill-discovery-protocol/references/cli-reference.md
git commit -m "docs(sdp): add sdp invocation note, validate gate clarification, Windows PowerShell tips"
```

---

## Task 4: briefing-flow SKILL.md のパス参照とゲート記述を修正

**Files:**
- Modify: `.agents/skills/briefing-flow/SKILL.md:96-97, 107`

アダプターパスの `.apm/` ハードコードをプレースホルダーに変更する（ゲート記述の修正は Task 5 で行う）。

- [ ] **Step 1: Phase A のアダプターパス参照（96–97行）を修正する**

現行（96–97行）：
```markdown
- If it does not exist → invoke `skill-discovery-protocol` and pass the adapter path `.apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml`
- If it exists but is stale/corrupted → invoke `skill-discovery-protocol` again with the same adapter path to regenerate it
```

書き換え後：
```markdown
- If it does not exist → invoke `skill-discovery-protocol` and pass the adapter path `<skill-root>/briefing-flow/assets/adapters/briefing-adapter.yaml`  
  (`<skill-root>` is one of `.agents/skills/`, `.apm/skills/`, or `.claude/skills/` depending on your APM installation)
- If it exists but is stale/corrupted → invoke `skill-discovery-protocol` again with the same adapter path to regenerate it
```

- [ ] **Step 2: Skill Discovery Protocol セクション（107行）のアダプターパスを修正する**

現行（107行）：
```markdown
- Adapter path: `.apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml`
```

書き換え後：
```markdown
- Adapter path: `<skill-root>/briefing-flow/assets/adapters/briefing-adapter.yaml`  
  (where `<skill-root>` is `.agents/skills/`, `.apm/skills/`, or `.claude/skills/`)
```

- [ ] **Step 3: ファイルを保存して確認**

Run: `Select-String -Path ".agents\skills\briefing-flow\SKILL.md" -Pattern "\.apm/skills/briefing-flow" | Select-Object LineNumber, Line`  
Expected: 0件（ハードコードパスが残っていないこと）

- [ ] **Step 4: コミット**

```bash
git add .agents/skills/briefing-flow/SKILL.md
git commit -m "docs(briefing-flow): replace hardcoded adapter path with environment-agnostic placeholder"
```

---

## Task 5: briefing-flow と doc-driven-dev-lifecycle のゲート記述を修正（body セクション参照に統一）

**Files:**
- Modify: `.agents/skills/briefing-flow/SKILL.md:219`
- Modify: `.agents/skills/doc-driven-dev-lifecycle/SKILL.md:48-49, 103`

`acceptance_criteria:` と `alternatives:` はどちらも本文セクション（`## Acceptance Criteria`, `## Considered Options`）に記述する慣例であり、front matter フィールドではない。ゲート記述を本文セクション参照に統一する。

- [ ] **Step 1: briefing-flow Phase D ゲートの `spec-doc` 条件を修正する（219行）**

現行：
```markdown
- [ ] `spec-doc` has at least 1 `acceptance_criteria:` entry
```

書き換え後：
```markdown
- [ ] `spec-doc` has at least 1 entry in `## Acceptance Criteria`
```

- [ ] **Step 2: briefing-flow Phase D ゲートの `adr-doc` 条件を修正する（220行）**

現行：
```markdown
- [ ] `adr-doc` exists with at least 2 `alternatives:`
```

書き換え後：
```markdown
- [ ] `adr-doc` exists with at least 2 entries under `## Considered Options`
```

- [ ] **Step 3: briefing-flow Phase 1 Skill Interface テーブルの `adr-doc` 完了条件を修正する（103行）**

現行：
```markdown
| `adr-doc` | Document | Architecture decision record | `alternatives:` ≥2, rationale documented |
```

書き換え後：
```markdown
| `adr-doc` | Document | Architecture decision record | ≥2 entries in `## Considered Options`, rationale documented |
```

- [ ] **Step 4: ファイルを保存して確認**

Run: `Select-String -Path ".agents\skills\briefing-flow\SKILL.md" -Pattern "acceptance_criteria:|alternatives:" | Select-Object LineNumber, Line`  
Expected: 0件（front matter キー形式の記述が残っていないこと）

- [ ] **Step 5: doc-driven-dev-lifecycle Phase 1 Exit チェックリスト（48–49行）を修正する**

現行（48行）：
```markdown
- [ ] spec-doc has `acceptance_criteria:` with ≥1 item
```
書き換え後：
```markdown
- [ ] spec-doc has ≥1 entry in `## Acceptance Criteria`
```

現行（49行）：
```markdown
- [ ] adr-doc exists with `alternatives:` ≥2
```
書き換え後：
```markdown
- [ ] adr-doc exists with ≥2 entries in `## Considered Options`
```

- [ ] **Step 6: doc-driven-dev-lifecycle Phase 1 Skill Interface テーブル（103行）の `adr-doc` 完了条件を修正する**

現行（103行）：
```markdown
| `adr-doc` | Document | Architecture decision record | `alternatives:` ≥2, rationale documented |
```

書き換え後：
```markdown
| `adr-doc` | Document | Architecture decision record | ≥2 entries in `## Considered Options`, rationale documented |
```

- [ ] **Step 7: 保存して確認**

Run: `Select-String -Path ".agents\skills\doc-driven-dev-lifecycle\SKILL.md" -Pattern "acceptance_criteria:|'alternatives:'" | Select-Object LineNumber, Line`  
Expected: 0件（front matter キー形式の記述が残っていないこと）

- [ ] **Step 8: コミット**

```bash
git add .agents/skills/briefing-flow/SKILL.md .agents/skills/doc-driven-dev-lifecycle/SKILL.md
git commit -m "docs: fix gate conditions to reference body sections instead of front matter fields"
```

---

## スコープ外として据え置いた問題

| 問題 | 理由 |
|------|------|
| 1-2: スキャン範囲設計見直し | フローアダプターの設計変更を要する。別 Issue として追跡推奨 |
| 4-1: 複数カテゴリ重複分類 | アダプター taxonomy の定義変更が必要。動作に直接影響しないため別途対応 |
| 4-2: uncategorized 多数 | briefing 用途外スキルであり機能的問題なし。warn 表示改善は別途 |
| 5: `resolved_invocations` 2件 | conditional スロットは設計通り。ドキュメントの誤解を招く説明があれば別タスク |
