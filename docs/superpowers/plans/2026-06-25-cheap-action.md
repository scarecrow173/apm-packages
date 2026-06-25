# Cheap Action Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) superpowers:executing-plans implement plan task-by-task. Steps use checkbox (`- [ ]`) syntax tracking.

**Goal:** Add `cheap-action` as a local cross-harness advisory skill in `packages/token-compression`.

**Architecture:** Keep `token-compression` portable by shipping a local `.apm/skills/cheap-action/SKILL.md` with a capability-dependent routing contract instead of a harness-specific model-switching implementation. Wire the package with `includes: [.apm/]` and update English/Japanese docs so users understand the package is now external `genshijin` dependencies plus one local cost-routing skill.

**Tech Stack:** APM package manifest YAML, Agent Skill Markdown, package README/AGENTS Markdown, repository APM validation commands.

---

### Task 1: Add the local `cheap-action` skill

**Files:**

- Create: `packages/token-compression/.apm/skills/cheap-action/SKILL.md`

- [ ] **Step 1: Create the skill file with a cross-harness contract**

Create `packages/token-compression/.apm/skills/cheap-action/SKILL.md` with this content:

```markdown
---
name: cheap-action
description: Route simple, mechanically verifiable actions to the lowest-cost selectable model when the current harness supports model selection.
---

# Cheap Action

Use this skill when a user asks for a simple, bounded operation that can be completed and verified mechanically with little or no semantic reasoning.

## Purpose

Reduce model cost for low-risk work. If the current harness exposes a lower-cost model or low-cost delegation path that can still use the required tools, switch to that option for the bounded action. If the harness does not expose model selection, continue on the current model and keep the work mechanical.

This skill is advisory and cross-harness. Do not claim that a model switch happened unless the harness actually provides and confirms that switch.

## Cheap-Eligible Work

Use the cheapest available capable model for:

- Running a named command or script and reporting the result.
- Mechanical variable, function, file, import, or include renames where matches are scoped and detectable.
- Simple import or include resolution by matching existing local patterns.
- Simple type annotations inferred from immediate usage.
- Comment updates derived from function signatures or nearby behavior.
- Minor structured configuration edits in YAML, JSON, TOML, INI, or similar files.
- Routine Git operations such as status checks, diff summaries, staging, commits, and branch checks.
- Grep-style search and file listing.
- Straight syntax-level fixes with clear parser, compiler, or linter errors.
- File move or copy operations with mechanical import updates.

## Do Not Use Cheap Routing

Stay on the current/default reasoning model when the task needs:

- Architecture, product, security, legal, medical, financial, or policy judgment.
- Ambiguous intent inference across many files or natural-language requirements.
- Broad code comprehension before the action can be scoped.
- Destructive operations, permission changes, secret handling, publication, deployment, or external side effects.
- A plan, design, code review, threat model, or root-cause analysis.
- Any action where you cannot name a deterministic verification step before acting.

## Routing Procedure

Before acting, run this short check:

1. Name the bounded action.
2. Name the mechanical verification step.
3. Decide whether the action is cheap-eligible.
4. If cheap-eligible and the harness exposes a lower-cost capable model, switch or delegate to it.
5. If no lower-cost capable model is available, continue on the current model without pretending a switch happened.
6. Execute only the bounded action.
7. Verify the result mechanically.
8. Escalate back to the current/default reasoning model if verification fails, scope expands, or ambiguity appears.

## Communication

Keep user-facing text short. For routine actions, one sentence is enough:

`Cheap action: running the existing script and reporting the result.`

Do not explain model economics unless the user asks. Do not mention an unavailable model switch.

## Output Expectations

Report:

- What bounded action ran.
- Whether verification passed.
- Any exact output or file path the user needs.
- Any reason the task had to escalate out of cheap routing.
```

- [ ] **Step 2: Verify the skill file is discoverable by path**

Run:

```powershell
Test-Path 'packages/token-compression/.apm/skills/cheap-action/SKILL.md'
```

Expected output:

```text
True
```

- [ ] **Step 3: Commit checkpoint**

Run:

```powershell
git add packages/token-compression/.apm/skills/cheap-action/SKILL.md
git commit -m "feat(token-compression): add cheap-action skill"
```

Expected result: commit succeeds and includes only the new skill file.

### Task 2: Wire `cheap-action` into the token-compression package manifest

**Files:**

- Modify: `packages/token-compression/apm.yml`

- [ ] **Step 1: Update the manifest to include local APM assets**

Change `packages/token-compression/apm.yml` to:

```yaml
name: token-compression
version: 0.1.0
description: Token compression optimization strategies efficient language model usage.
author: Akiyoshi Koyama
license: MIT
targets:
  - codex
  - copilot
  - cursor
  - claude
  - agent-skills
includes:
  - .apm/
dependencies:
  apm:
    - InterfaceX-co-jp/genshijin/skills/genshijin#main
    - InterfaceX-co-jp/genshijin/skills/genshijin-compress#main
    - InterfaceX-co-jp/genshijin/skills/genshijin-crew#main
    - InterfaceX-co-jp/genshijin/skills/genshijin-review#main
```

- [ ] **Step 2: Validate YAML parses**

Run:

```powershell
apm compile --validate
```

from `packages/token-compression`.

Expected result: validation succeeds. If `apm compile --validate` requires repository root execution, run it from `F:\repositry\apm-packages` and record that package-level validation is unsupported.

- [ ] **Step 3: Commit checkpoint**

Run:

```powershell
git add packages/token-compression/apm.yml
git commit -m "chore(token-compression): include local apm assets"
```

Expected result: commit succeeds and includes only the manifest update.

### Task 3: Update English package documentation

**Files:**

- Modify: `packages/token-compression/README.md`
- Modify: `packages/token-compression/AGENTS.md`

- [ ] **Step 1: Update `README.md` package shape**

Replace the dependency-first paragraph in `packages/token-compression/README.md` with:

```markdown
This package combines external compression-focused dependencies with one local advisory skill. The external `genshijin` suite covers prompt and context compression. The local `cheap-action` skill helps agents route simple, mechanically verifiable work to the lowest-cost capable model when the current harness supports model selection.
```

Add this section after `## What It Covers`:

```markdown
## Local Skills

- `cheap-action` — routes simple, mechanically verifiable work to the lowest-cost selectable model when the current harness supports model selection. If no model switch is available, it keeps the action bounded and verifies it mechanically in the current harness.
```

Add `cheap-action` under `## Dependencies source truth` so the section reads:

```markdown
## Dependencies source truth

[apm.yml](./apm.yml) is the source of truth for external dependencies and local package assets.

External dependencies:

- `InterfaceX-co-jp/genshijin/skills/genshijin`
- `InterfaceX-co-jp/genshijin/skills/genshijin-compress`
- `InterfaceX-co-jp/genshijin/skills/genshijin-crew`
- `InterfaceX-co-jp/genshijin/skills/genshijin-review`

Local assets:

- `.apm/skills/cheap-action`
```

- [ ] **Step 2: Update `AGENTS.md` overview**

Add this section after `genshijin-review` in `packages/token-compression/AGENTS.md`:

```markdown
### cheap-action

- **Purpose:** Advisory low-cost routing for simple, mechanically verifiable work
- **Use Cases:** Running named commands, grep-based search, scoped renames, routine Git operations, structured config edits, syntax-level fixes
- **Boundary:** Use only when the action has a deterministic verification step and does not need deep reasoning
```

Add this integration bullet:

```markdown
- `basic-dev-foundation` — applying cheap routing to routine Git and repository operations
```

- [ ] **Step 3: Verify stale English claims are gone**

Run:

```powershell
rg -n "dependency-first|does not add local skills|local skills, agents" packages/token-compression/README.md packages/token-compression/AGENTS.md
```

Expected result: no matches.

- [ ] **Step 4: Commit checkpoint**

Run:

```powershell
git add packages/token-compression/README.md packages/token-compression/AGENTS.md
git commit -m "docs(token-compression): document cheap-action skill"
```

Expected result: commit succeeds and includes only English docs.

### Task 4: Update Japanese package documentation with UTF-8 verification

**Files:**

- Modify: `packages/token-compression/README.ja.md`
- Modify: `packages/token-compression/AGENTS.ja.md`

- [ ] **Step 1: Read Japanese docs with explicit UTF-8**

Run:

```powershell
Get-Content -Encoding utf8 packages/token-compression/README.ja.md
Get-Content -Encoding utf8 packages/token-compression/AGENTS.ja.md
```

Expected result: Japanese text is readable. If terminal display looks broken, verify by re-reading with UTF-8 before editing.

- [ ] **Step 2: Update `README.ja.md` package shape**

Replace the dependency-first paragraph in `packages/token-compression/README.ja.md` with:

```markdown
このパッケージは、外部の圧縮特化依存関係とローカルの advisory skill を組み合わせます。外部の `genshijin` スイートはプロンプトとコンテキスト圧縮を扱います。ローカルの `cheap-action` は、現在のハーネスがモデル選択をサポートする場合に、単純で機械的に検証できる作業を最も低コストな対応モデルへルーティングするためのスキルです。
```

Add this section after `## カバー範囲`:

```markdown
## ローカルスキル

- `cheap-action` — 現在のハーネスがモデル選択をサポートする場合に、単純で機械的に検証できる作業を最も低コストな選択可能モデルへルーティングします。モデル切り替えが利用できない場合は、現在のハーネスで作業を小さく保ち、機械的に検証します。
```

Update the dependency section to:

```markdown
## 依存関係

外部依存関係とローカルパッケージ資産の信頼できる情報源は [apm.yml](./apm.yml) です。

外部依存関係：

- `InterfaceX-co-jp/genshijin/skills/genshijin`
- `InterfaceX-co-jp/genshijin/skills/genshijin-compress`
- `InterfaceX-co-jp/genshijin/skills/genshijin-crew`
- `InterfaceX-co-jp/genshijin/skills/genshijin-review`

ローカル資産：

- `.apm/skills/cheap-action`
```

- [ ] **Step 3: Update `AGENTS.ja.md` overview**

Add this section after `genshijin-review` in `packages/token-compression/AGENTS.ja.md`:

```markdown
### cheap-action

- **目的:** 単純で機械的に検証できる作業の advisory な低コストルーティング
- **用途:** 名前付きコマンドの実行、grep ベースの検索、スコープ済み rename、routine な Git 操作、構造化 config 編集、構文レベルの修正
- **境界:** 決定的な検証手順があり、深い推論を必要としない場合だけ使う
```

Add this integration bullet:

```markdown
- `basic-dev-foundation` — routine な Git と repository 操作に cheap routing を適用する
```

- [ ] **Step 4: Verify stale Japanese claims are gone**

Run:

```powershell
rg -n "依存関係を優先|独自のスキル|含めず" packages/token-compression/README.ja.md packages/token-compression/AGENTS.ja.md
```

Expected result: no matches.

- [ ] **Step 5: Commit checkpoint**

Run:

```powershell
git add packages/token-compression/README.ja.md packages/token-compression/AGENTS.ja.md
git commit -m "docs(token-compression): add cheap-action Japanese docs"
```

Expected result: commit succeeds and includes only Japanese docs.

### Task 5: Validate package and repository consistency

**Files:**

- Check: `packages/token-compression/.apm/skills/cheap-action/SKILL.md`
- Check: `packages/token-compression/apm.yml`
- Check: `packages/token-compression/README.md`
- Check: `packages/token-compression/README.ja.md`
- Check: `packages/token-compression/AGENTS.md`
- Check: `packages/token-compression/AGENTS.ja.md`

- [ ] **Step 1: Verify all cheap-action references**

Run:

```powershell
rg -n "cheap-action|lowest-cost|低コスト|model selection|モデル選択" packages/token-compression
```

Expected result: matches exist in the new skill, manifest-connected docs, and English/Japanese package docs.

- [ ] **Step 2: Validate APM output**

Run:

```powershell
apm compile --validate
```

Expected result: validation succeeds. If the command needs root context, run it from `F:\repositry\apm-packages` and ensure `packages/token-compression` does not produce validation errors.

- [ ] **Step 3: Run repository whitespace check**

Run:

```powershell
git diff --check
```

Expected result: no whitespace errors.

- [ ] **Step 4: Review final diff**

Run:

```powershell
git diff -- packages/token-compression docs/superpowers/specs/2026-06-25-cheap-action-design.md docs/superpowers/plans/2026-06-25-cheap-action.md
```

Expected result: diff contains only `cheap-action` skill packaging, synchronized docs, and planning artifacts.

- [ ] **Step 5: Final commit**

If previous task commits were not created separately, make one scoped commit:

```powershell
git add packages/token-compression docs/superpowers/specs/2026-06-25-cheap-action-design.md docs/superpowers/plans/2026-06-25-cheap-action.md
git commit -m "feat(token-compression): add cheap-action skill"
```

Expected result: commit succeeds and does not include unrelated files.

### Task 6: Optional marketplace check

**Files:**

- Check: `apm.yml`

- [ ] **Step 1: Confirm root marketplace already lists `token-compression`**

Run:

```powershell
Select-String -Path apm.yml -Pattern "name: token-compression" -Context 2,3
```

Expected result: root marketplace package metadata includes `token-compression`. If it is missing, add:

```yaml
  - name: token-compression
    category: optimization
    source: scarecrow173/apm-packages
    subdir: packages/token-compression
```

- [ ] **Step 2: Validate root manifest only if changed**

Run:

```powershell
apm compile --validate
```

Expected result: validation succeeds.

- [ ] **Step 3: Commit root marketplace fix only if changed**

Run:

```powershell
git add apm.yml
git commit -m "chore: list token-compression in marketplace"
```

Expected result: commit succeeds only if `apm.yml` was actually changed.

## Self-Review

- Spec coverage: Tasks cover local skill creation, manifest wiring, English/Japanese docs, validation, and optional root marketplace consistency.
- Placeholder scan: No unfinished-marker wording or unspecified edge-handling steps remain.
- Type and path consistency: All paths use the existing `packages/token-compression` package layout and the new `.apm/skills/cheap-action/SKILL.md` asset path consistently.
