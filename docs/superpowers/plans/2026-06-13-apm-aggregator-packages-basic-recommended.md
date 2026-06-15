# APM Aggregator Packages Basic and Recommended Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two independent APM aggregator packages, `basic-dev-foundation` and `recommended-dev-suite`, under `packages/` and wire them into the repository index.

**Architecture:** Each package is a small manifest-driven bundle with its own README, AGENTS guidance, and package manifest. `basic-dev-foundation` carries the foundational set; `recommended-dev-suite` carries the broader set without depending on the foundation package, so either package can be installed independently.

**Tech Stack:** APM package manifests, Markdown docs, repository-root `apm.yml`.

---

### Task 1: Create the `basic-dev-foundation` package

**Files:**
- Create: `packages/basic-dev-foundation/apm.yml`
- Create: `packages/basic-dev-foundation/README.md`
- Create: `packages/basic-dev-foundation/README.ja.md`
- Create: `packages/basic-dev-foundation/AGENTS.md`
- Create: `packages/basic-dev-foundation/AGENTS.ja.md`

- [ ] **Step 1: Write the package manifest and docs**

```yaml
name: basic-dev-foundation
version: 0.1.0
description: Basic APM aggregator package for foundational skills and workflow helpers.
author: Akiyoshi Koyama
license: MIT
includes:
  - .apm/
targets:
  - codex
  - copilot
  - cursor
  - claude
  - agent-skills
devDependencies:
  apm:
    - microsoft/apm/packages/apm-guide
    - github/awesome-copilot/skills/git-commit
    - github/awesome-copilot/skills/conventional-branch
    - github/awesome-copilot/skills/commit-message-storyteller
    - github/awesome-copilot/skills/agentic-eval
```

```md
# basic-dev-foundation

This package aggregates the foundational APM skills and workflow helpers.

It ships a minimal `.apm/instructions/` entry so the package compiles as a
real APM bundle rather than a manifest-only shell.

## Included packages

- `microsoft/apm/packages/apm-guide`
- `github/awesome-copilot/skills/git-commit`
- `github/awesome-copilot/skills/conventional-branch`
- `github/awesome-copilot/skills/commit-message-storyteller`
- `github/awesome-copilot/skills/agentic-eval`
```

```md
# basic-dev-foundation

この package は、基礎的な APM skill と workflow helper をまとめた aggregator です。

`.apm/instructions/` に最小の entry を持たせているため、manifest だけの
shell ではなく、実際に compile できる APM bundle になっています。

## 同梱 package

- `microsoft/apm/packages/apm-guide`
- `github/awesome-copilot/skills/git-commit`
- `github/awesome-copilot/skills/conventional-branch`
- `github/awesome-copilot/skills/commit-message-storyteller`
- `github/awesome-copilot/skills/agentic-eval`
```

```md
# AGENTS.md

This file is a practical guide for AI agents modifying `packages/basic-dev-foundation`.

## Scope

- Edit `packages/basic-dev-foundation/apm.yml`
- Edit `packages/basic-dev-foundation/README.md`
- Edit `packages/basic-dev-foundation/README.ja.md`
- Edit `packages/basic-dev-foundation/AGENTS.md`
- Edit `packages/basic-dev-foundation/AGENTS.ja.md`

## Workflow

1. Keep `README.md` and `README.ja.md` aligned in meaning and structure.
2. Keep package descriptions honest about the package as an aggregator.
3. Run `apm compile --dry-run` and `apm compile --validate` from `packages/basic-dev-foundation/` after edits.
```

```md
# AGENTS.ja.md

このファイルは、`packages/basic-dev-foundation` を変更する AI エージェント向けの実務ガイドです。

## 範囲

- `packages/basic-dev-foundation/apm.yml`
- `packages/basic-dev-foundation/README.md`
- `packages/basic-dev-foundation/README.ja.md`
- `packages/basic-dev-foundation/AGENTS.md`
- `packages/basic-dev-foundation/AGENTS.ja.md`

## 作業フロー

1. `README.md` と `README.ja.md` の意味と構造を揃える。
2. package 説明は aggregator であることを正確に記述する。
3. 変更後は `packages/basic-dev-foundation/` で `apm compile --dry-run` と `apm compile --validate` を実行する。
```

- [ ] **Step 2: Verify the package reads cleanly**

Run:
```bash
apm compile --dry-run
apm compile --validate
```

Expected: PASS or a clearly documented package-structure warning that matches the existing APM behavior.

### Task 2: Create the `recommended-dev-suite` package

**Files:**
- Create: `packages/recommended-dev-suite/apm.yml`
- Create: `packages/recommended-dev-suite/README.md`
- Create: `packages/recommended-dev-suite/README.ja.md`
- Create: `packages/recommended-dev-suite/AGENTS.md`
- Create: `packages/recommended-dev-suite/AGENTS.ja.md`

- [ ] **Step 1: Write the package manifest and docs**

```yaml
name: recommended-dev-suite
version: 0.1.0
description: Recommended APM aggregator package for the broader workflow bundle.
author: Akiyoshi Koyama
license: MIT
includes:
  - .apm/
targets:
  - codex
  - copilot
  - cursor
  - claude
  - agent-skills
devDependencies:
  apm:
    - microsoft/apm/packages/apm-guide
    - github/awesome-copilot/skills/git-commit
    - github/awesome-copilot/skills/conventional-branch
    - github/awesome-copilot/skills/commit-message-storyteller
    - github/awesome-copilot/skills/agentic-eval
    - ../doc-driven-dev
    - ../steer-enterprise-web-research
    - ../apm-package-judge
    - github/awesome-copilot/skills/github-actions-efficiency
    - softaworks/agent-toolkit/skills/skill-judge
    - obra/superpowers
```

```md
# recommended-dev-suite

This package aggregates the broader recommended APM skill set.

It ships a minimal `.apm/instructions/` entry so the package compiles as a
real APM bundle rather than a manifest-only shell.

## Included packages

- `microsoft/apm/packages/apm-guide`
- `github/awesome-copilot/skills/git-commit`
- `github/awesome-copilot/skills/conventional-branch`
- `github/awesome-copilot/skills/commit-message-storyteller`
- `github/awesome-copilot/skills/agentic-eval`
- `packages/doc-driven-dev`
- `packages/steer-enterprise-web-research`
- `packages/apm-package-judge`
- `github/awesome-copilot/skills/github-actions-efficiency`
- `softaworks/agent-toolkit/skills/skill-judge`
- `obra/superpowers`
```

```md
# recommended-dev-suite

この package は、より広い推奨 APM skill セットをまとめた aggregator です。

`.apm/instructions/` に最小の entry を持たせているため、manifest だけの
shell ではなく、実際に compile できる APM bundle になっています。

## 同梱 package

- `microsoft/apm/packages/apm-guide`
- `github/awesome-copilot/skills/git-commit`
- `github/awesome-copilot/skills/conventional-branch`
- `github/awesome-copilot/skills/commit-message-storyteller`
- `github/awesome-copilot/skills/agentic-eval`
- `packages/doc-driven-dev`
- `packages/steer-enterprise-web-research`
- `packages/apm-package-judge`
- `github/awesome-copilot/skills/github-actions-efficiency`
- `softaworks/agent-toolkit/skills/skill-judge`
- `obra/superpowers`
```

```md
# AGENTS.md

This file is a practical guide for AI agents modifying `packages/recommended-dev-suite`.

## Scope

- Edit `packages/recommended-dev-suite/apm.yml`
- Edit `packages/recommended-dev-suite/README.md`
- Edit `packages/recommended-dev-suite/README.ja.md`
- Edit `packages/recommended-dev-suite/AGENTS.md`
- Edit `packages/recommended-dev-suite/AGENTS.ja.md`

## Workflow

1. Keep `README.md` and `README.ja.md` aligned in meaning and structure.
2. Keep the dependency list honest about the package being a recommendation bundle.
3. Run `apm compile --dry-run` and `apm compile --validate` from `packages/recommended-dev-suite/` after edits.
```

```md
# AGENTS.ja.md

このファイルは、`packages/recommended-dev-suite` を変更する AI エージェント向けの実務ガイドです。

## 範囲

- `packages/recommended-dev-suite/apm.yml`
- `packages/recommended-dev-suite/README.md`
- `packages/recommended-dev-suite/README.ja.md`
- `packages/recommended-dev-suite/AGENTS.md`
- `packages/recommended-dev-suite/AGENTS.ja.md`

## 作業フロー

1. `README.md` と `README.ja.md` の意味と構造を揃える。
2. dependency list は recommendation bundle であることを正確に保つ。
3. 変更後は `packages/recommended-dev-suite/` で `apm compile --dry-run` と `apm compile --validate` を実行する。
```

- [ ] **Step 2: Verify the package reads cleanly**

Run:
```bash
apm compile --dry-run
apm compile --validate
```

Expected: PASS or a clearly documented package-structure warning that matches the existing APM behavior.

### Task 3: Wire the new packages into the repository index

**Files:**
- Modify: `apm.yml`
- Modify: `README.md`
- Modify: `README.ja.md`

- [ ] **Step 1: Add the package entries to the root manifest**

```yaml
devDependencies:
  apm:
    - ./packages/basic-dev-foundation
    - ./packages/recommended-dev-suite
    - ./packages/steer-enterprise-web-research
    - ./packages/doc-driven-dev
    - ./packages/apm-package-judge
    - microsoft/apm/packages/apm-guide
    - github/awesome-copilot/skills/git-commit
    - github/awesome-copilot/skills/commit-message-storyteller
    - github/awesome-copilot/skills/conventional-branch
    - github/awesome-copilot/skills/agentic-eval
    - github/awesome-copilot/skills/github-actions-efficiency
    - addyosmani/agent-skills
    - softaworks/agent-toolkit/skills/skill-judge
    - obra/superpowers
```

```yaml
  packages:
  - name: basic-dev-foundation
    source: ./packages/basic-dev-foundation
    version: 0.1.0
  - name: recommended-dev-suite
    source: ./packages/recommended-dev-suite
    version: 0.1.0
```

```md
packages/
  basic-dev-foundation/
    apm.yml
    README.md
    README.ja.md
    AGENTS.md
    AGENTS.ja.md
  recommended-dev-suite/
    apm.yml
    README.md
    README.ja.md
    AGENTS.md
    AGENTS.ja.md
```

- [ ] **Step 2: Update the repository README files**

Add a short note that `basic-dev-foundation` and `recommended-dev-suite` are the two aggregator packages, and update the tree view to show the new directories.

- [ ] **Step 3: Verify the index is consistent**

Run:
```bash
rg -n "basic-dev-foundation|recommended-dev-suite|packages/basic-dev-foundation|packages/recommended-dev-suite" apm.yml README.md README.ja.md packages/basic-dev-foundation packages/recommended-dev-suite
```

Expected: the new package names appear in the root index and in the two package READMEs, with no stale references or missing localized siblings.
