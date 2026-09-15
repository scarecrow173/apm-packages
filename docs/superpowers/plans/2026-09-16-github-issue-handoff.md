# github-issue-handoff APM Package Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. This plan is executed inline in the authoring session; each task ends with a commit.

**Goal:** Add a new self-contained APM package `github-issue-handoff` that lets a local coding agent (Requester) persist a reviewable repository state on GitHub — dedicated branch, pushed checkpoint commits, structured handoff Issue, linked Draft PR — show the user a repository-wide Responder prompt, and later resume from plain Issue comments until the PR merges and the Issue closes.

**Architecture:** Documentation-only Skill package. No custom runtime — the protocol is executed with Skill instructions + `git` + GitHub CLI (`gh`) + GitHub Issues + Pull Requests. `SKILL.md` holds the dense operating contract; `references/` carry protocol details; `assets/templates/` carry the reusable Responder prompt. A tests-only workspace under `scripts/github-issue-handoff/` runs structural contract tests (no runtime source, no build).

**Tech Stack:** Markdown + YAML frontmatter (Agent Skills spec), `git`, `gh` CLI, `node:test` + `tsx` + `gray-matter` for structural tests, `markdownlint-cli2` for lint.

## Global Constraints

- Run repo-managed tools via `mise exec -- <command>` (per root `AGENTS.md`).
- Package name and primary skill name: `github-issue-handoff`.
- Every English doc has a `.ja.md` sibling synchronized in meaning and structure (root `AGENTS.md` §2).
- No custom runtime, CLI, server, daemon, GitHub App, or proprietary AI API (spec §5, §65, §69). Responder must not depend on any specific person, AI product, service, or model.
- Handoff mandatory artifacts: reviewable branch + pushed checkpoint commit + handoff Issue + linked (Draft) PR + user-visible rendered Responder prompt. Issue-only or PR-only handoffs are forbidden (§8, §27, §30, §32).
- Standard labels: `handoff`, `handoff:needs-response`, `handoff:needs-requester`, `handoff:blocking` (§22). `needs-response` and `needs-requester` are mutually exclusive.
- Responder prompt is repository-wide: it targets ALL open Issues labeled `handoff:needs-response`, never a single Issue (§34, §38). Placeholders: `{{repository}}` (required), `{{label}}` (default `handoff:needs-response`) (§36).
- PR body must contain a closing reference to the Issue (`Closes #<n>` / `Fixes` / `Resolves`), not merely "Related to" (§30). Success path: PR merged → Issue closed → verify closed (§51, §52).
- Never embed secrets in Issues, PRs, commit messages, or prompts (§20, §58). Never commit unrelated files (§17).
- `apm compile --validate`, `apm compile --dry-run`, markdownlint, package tests, and `git diff --check` must pass before completion (§67).
- No push/PR creation against real remotes in tests — all tests are offline structural checks.

## File Structure

```
packages/github-issue-handoff/
├── apm.yml                                  # package manifest (mirrors doc-driven-dev shape)
├── .markdownlint-cli2.jsonc                 # lint config (same rules as doc-driven-dev)
├── README.md / README.ja.md                 # purpose, install, prerequisites, workflow, security, troubleshooting
├── AGENTS.md / AGENTS.ja.md                 # maintainer guide: invariants + validation commands
└── .apm/skills/github-issue-handoff/
    ├── SKILL.md / SKILL.ja.md               # operating contract: trigger → investigate → handoff → resume → close
    ├── references/
    │   ├── protocol.md / protocol.ja.md     # full Requester lifecycle: branch/commit/push, labels, rounds, resume, errors
    │   ├── issue-format.md / issue-format.ja.md   # Issue title/body, metadata comment, PR body, label semantics
    │   └── responder-guide.md / responder-guide.ja.md  # Responder protocol description (not the prompt itself)
    └── assets/templates/
        ├── responder-prompt.md              # repo-wide prompt template, {{repository}} {{label}}
        └── responder-prompt.ja.md

scripts/github-issue-handoff/                # tests-only workspace (no src/, no build output)
├── package.json                             # test + lint:md scripts
├── pnpm-workspace.yaml                      # standalone workspace: packages: ["."]
├── tsconfig.json                            # mirrors scripts/doc-driven-dev/tsconfig.json
└── tests/
    ├── package-structure.test.ts            # file existence, frontmatter, EN/JA pairing, manifest, marketplace
    └── protocol-contract.test.ts            # labels, issue/PR format, prompt contract, invariants wording

root apm.yml                                 # + devDependencies.apm entry, + marketplace.packages entry (category: automation)
```

**Why no `scripts/` runtime:** spec §5/§65 — `gh` is sufficient and deterministic; a custom CLI is YAGNI. The workspace exists only to host structural tests and the markdownlint script, matching the repo convention that tests live under `scripts/<name>/`.

---

### Task 1: Package manifest and lint config

**Files:**
- Create: `packages/github-issue-handoff/apm.yml`
- Create: `packages/github-issue-handoff/.markdownlint-cli2.jsonc`

**Interfaces:**
- Produces: manifest `name: github-issue-handoff`, `includes: [.apm/]`, scripts `validate`/`preview`/`test`/`lint-md` consumed by Task 7 validation.

- [ ] **Step 1: Create `apm.yml`** modeled on `packages/doc-driven-dev/apm.yml`:

```yaml
name: github-issue-handoff
version: 0.1.0
description: GitHub Issue and Draft PR based async handoff protocol for requesting independent review of coding decisions from any responder.
author: Akiyoshi Koyama
license: MIT
targets:
  - codex
  - copilot
  - cursor
  - claude
  - windsurf
  - agent-skills
includes:
  - .apm/
scripts:
  validate: "apm compile --validate"
  preview: "apm compile --dry-run"
  test: "pnpm test"
  lint-md: "pnpm run lint:md"
```

- [ ] **Step 2: Create `.markdownlint-cli2.jsonc`** — copy verbatim from `packages/doc-driven-dev/.markdownlint-cli2.jsonc` (globs `**/*.md`, `!node_modules/**`; MD013 off, MD024 siblings_only, MD025 off, MD033 off).

- [ ] **Step 3: Commit**

```bash
git add packages/github-issue-handoff/apm.yml packages/github-issue-handoff/.markdownlint-cli2.jsonc
git commit -m "feat(github-issue-handoff): add package manifest and lint config"
```

---

### Task 2: Test workspace scaffold + failing structural tests (RED)

**Files:**
- Create: `scripts/github-issue-handoff/package.json`
- Create: `scripts/github-issue-handoff/pnpm-workspace.yaml`
- Create: `scripts/github-issue-handoff/tsconfig.json`
- Test: `scripts/github-issue-handoff/tests/package-structure.test.ts`
- Test: `scripts/github-issue-handoff/tests/protocol-contract.test.ts`

**Interfaces:**
- Consumes: file list from File Structure above.
- Produces: test suites that every later task must make pass. Test script: `pnpm --dir scripts/github-issue-handoff test`.

- [ ] **Step 1: Create `package.json`** (deps mirror doc-driven-dev: `tsx`, `typescript`, `@types/node`, `gray-matter`, `markdownlint-cli2`; no runtime deps):

```json
{
  "name": "github-issue-handoff-tests",
  "version": "0.1.0",
  "private": true,
  "description": "Structural contract tests for the github-issue-handoff APM package",
  "scripts": {
    "test": "tsx --test tests/*.test.ts",
    "lint:md": "markdownlint-cli2 --no-globs --config ../../packages/github-issue-handoff/.markdownlint-cli2.jsonc \"../../packages/github-issue-handoff/**/*.md\""
  },
  "packageManager": "pnpm@11.2.2",
  "dependencies": {
    "gray-matter": "^4.0.3"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "markdownlint-cli2": "^0.22.1",
    "tsx": "^4.20.6",
    "typescript": "^5.6.3"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml` and `tsconfig.json`**

```yaml
packages:
  - "."
```

`tsconfig.json`: copy `scripts/doc-driven-dev/tsconfig.json` verbatim (tests-only: `"include": ["tests/**/*.ts"]`).

- [ ] **Step 3: Write `tests/package-structure.test.ts`**

Asserts (all currently failing — files do not exist yet):

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../../..");
const pkgRoot = path.join(repoRoot, "packages/github-issue-handoff");
const skillDir = path.join(pkgRoot, ".apm/skills/github-issue-handoff");

const requiredFiles = [
  "apm.yml", "README.md", "README.ja.md", "AGENTS.md", "AGENTS.ja.md",
  ".apm/skills/github-issue-handoff/SKILL.md",
  ".apm/skills/github-issue-handoff/SKILL.ja.md",
  ".apm/skills/github-issue-handoff/references/protocol.md",
  ".apm/skills/github-issue-handoff/references/protocol.ja.md",
  ".apm/skills/github-issue-handoff/references/issue-format.md",
  ".apm/skills/github-issue-handoff/references/issue-format.ja.md",
  ".apm/skills/github-issue-handoff/references/responder-guide.md",
  ".apm/skills/github-issue-handoff/references/responder-guide.ja.md",
  ".apm/skills/github-issue-handoff/assets/templates/responder-prompt.md",
  ".apm/skills/github-issue-handoff/assets/templates/responder-prompt.ja.md",
];

test("all required package files exist", () => {
  for (const rel of requiredFiles) {
    assert.ok(fs.existsSync(path.join(pkgRoot, rel)), `missing ${rel}`);
  }
});

test("SKILL frontmatter has name and trigger-scoped description", () => {
  const { data } = matter(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"));
  assert.equal(data.name, "github-issue-handoff");
  assert.ok(typeof data.description === "string" && data.description.length > 0);
  assert.ok(data.description.length <= 1024);
  // trigger-scoped: mentions external review / handoff triggers, not a generic dev task
  assert.match(data.description, /handoff|second opinion|independent review|resum/i);
});

test("SKILL.ja.md has identical frontmatter name", () => {
  const en = matter(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8")).data;
  const ja = matter(fs.readFileSync(path.join(skillDir, "SKILL.ja.md"), "utf8")).data;
  assert.equal(ja.name, en.name);
});

test("package manifest is valid and named github-issue-handoff", () => {
  const text = fs.readFileSync(path.join(pkgRoot, "apm.yml"), "utf8");
  assert.match(text, /^name: github-issue-handoff$/m);
  assert.match(text, /^  - \.apm\/$/m);
});

test("root apm.yml registers package in devDependencies and marketplace", () => {
  const text = fs.readFileSync(path.join(repoRoot, "apm.yml"), "utf8");
  assert.match(text, /- \.\/packages\/github-issue-handoff/);
  assert.match(text, /- name: github-issue-handoff\n\s+category: automation\n\s+source: scarecrow173\/apm-packages\n\s+subdir: packages\/github-issue-handoff/);
});
```

- [ ] **Step 4: Write `tests/protocol-contract.test.ts`**

Asserts protocol invariants are documented (content checks, normalized whitespace):

```ts
// helpers: read(rel) -> utf8 file text under pkgRoot; concept(text, /re/, label)
```

Checks:
- **Labels:** `handoff`, `handoff:needs-response`, `handoff:needs-requester`, `handoff:blocking` appear in `SKILL.md`, `references/protocol.md`, `references/issue-format.md`, and `references/responder-guide.md`; issue-format documents `needs-response`/`needs-requester` mutual exclusivity.
- **Mandatory artifacts:** `SKILL.md` states all five: branch, pushed commit, Issue, linked Draft PR, shown Responder prompt (`/draft/i`, `/push/i`, `/issue/i`, `/pull request|pr\b/i`, `/prompt/i`).
- **Issue format:** `references/issue-format.md` contains headings `## Question`, `## Context`, `## Findings`, `## Current assessment`, `## Repository state`, `## Requested review`, `## Blocking`; contains metadata comment fields `protocol:`, `round:`, `branch:`, `commit:`, `blocking:` inside `<!-- github-issue-handoff`; contains closing linkage `/Closes #|Fixes #|Resolves #/` and forbids `/Related to/` alone.
- **Responder prompt (EN):** contains `{{repository}}`, `{{label}}`, `handoff:needs-response`; instructs processing ALL matching open issues (`/all|every/i` near `issue`); explicitly says not to stop after one (`/not.*(only|single|one)|do not stop/i`); requires reading linked PR/diff/commits (`/pull request|diff|commit/i`); requires writing a response comment per issue (`/comment/i`); requires avoiding duplicate responses (`/duplicate/i`); permits optional label swap to `handoff:needs-requester` without making it mandatory (`/permission|if (you )?can|able/i`).
- **Responder prompt (JA):** contains `{{repository}}`, `handoff:needs-response`, and `/すべて|全て/` (all issues) plus `/一件だけ|1件だけ/` negation context.
- **No product lock-in:** prompt + responder-guide do not require any specific responder product — assert absence of `/copilot|chatgpt|claude|gemini|devin|codex/i` inside the prompt template files. (Skill docs may mention target runtimes elsewhere; templates must not.)
- **No silent fallbacks:** `references/protocol.md` documents: no local-only handoff (`/push/i` required before Issue), no Issue-only fallback when push is forbidden (`/cannot be completed|fail/i`), and Issue close verification after merge (`/verify|confirm.*clos/i`).
- **EN/JA heading parity:** for each paired file (`SKILL`, `references/*`, `assets/templates/*`, `README`, `AGENTS`), extract `^##+ ` heading lines from both; assert EN and JA heading counts are equal (headings may be translated, count+order must match).

- [ ] **Step 5: Run tests — confirm RED**

```bash
mise exec -- pnpm --dir scripts/github-issue-handoff install
mise exec -- pnpm --dir scripts/github-issue-handoff test
```

Expected: FAIL — `missing packages/github-issue-handoff/README.md` etc.

- [ ] **Step 6: Commit** (tests stay red until Task 6; feature-branch TDD checkpoint)

```bash
git add scripts/github-issue-handoff
git commit -m "test(github-issue-handoff): add structural contract tests for package"
```

---

### Task 3: `SKILL.md` / `SKILL.ja.md` — operating contract

**Files:**
- Create: `packages/github-issue-handoff/.apm/skills/github-issue-handoff/SKILL.md`
- Create: `packages/github-issue-handoff/.apm/skills/github-issue-handoff/SKILL.ja.md`

**Interfaces:**
- Produces: the skill's public contract. References `references/protocol.md`, `references/issue-format.md`, `references/responder-guide.md`, `assets/templates/responder-prompt.md` by repo-relative path so Tasks 4–5 know the link targets.

- [ ] **Step 1: Write `SKILL.md`** — dense operating contract, not a README. Required content:

Frontmatter:
```yaml
---
name: github-issue-handoff
description: Use when a coding task needs an independent judgment that local investigation cannot settle — architecture or API/data-model decisions with multiple defensible options, unresolved root causes after real debugging, requirement-vs-behavior contradictions, security-sensitive or hard-to-reverse changes — or when resuming work from responses on an existing handoff Issue. Not for routine tasks, syntax/lint/test-fixable problems, or anything repo docs already answer.
license: MIT
---
```

Body sections (each concise; details delegated to references):
1. `# GitHub Issue Handoff` + overview: what a handoff IS — durable, reviewable repository state (branch + pushed commits + Issue + linked Draft PR) plus a repo-wide Responder prompt; Requester/Responder roles; Responder is ANY GitHub-Issue-commenting entity (human, another agent, review AI, automation) — no product dependency.
2. `## When to Use` — handoff candidates list (§11) and do-not-handoff list (§12: syntax errors, formatter/lint/test-resolvable, doc-documented, safely-tryable details, already-evidenced decisions).
3. `## Investigate Before Handoff` — the local-investigation gate (§10): reproduce → inspect code/tests/errors/docs → hypotheses → cheap verification → decide escalation value.
4. `## Handoff Lifecycle` — the ordered flow (§7): branch check → commit relevant state only → push → create Issue (format: see issue-format.md) → create linked Draft PR (`Closes #N`) → render + SHOW the Responder prompt to the user → continue independent work → yield only if truly blocking → resume → evaluate response against repo evidence → implement/verify → merge → verify Issue closed.
5. `## Invariants` — bullet list of hard rules: five mandatory artifacts; push before Issue; PR required (Draft by default) with closing reference; repo-wide prompt shown to user rendered (not just a path); `needs-response`/`needs-requester` exclusivity; plain comments are valid responses; responses are evidence-ranked below verified repo facts (§48); Issue closes via merge, verified, explicit close fallback; unmerged PR ≠ done; no secrets anywhere; no unrelated files in commits.
6. `## Blocking` — `handoff:blocking` only when ALL remaining meaningful work depends on the response (§44).
7. `## References` — table: `references/protocol.md` (full Requester lifecycle), `references/issue-format.md` (Issue/PR/metadata contract), `references/responder-guide.md` (Responder protocol), `assets/templates/responder-prompt.md` (prompt template).
8. `## Failure Reporting` — on partial failure, report created artifacts + failure point; never report partial as complete (§32, §57).

- [ ] **Step 2: Write `SKILL.ja.md`** — same frontmatter `name`, translated `description`, identical section structure/heading count (required by Task 2 parity test).

- [ ] **Step 3: Re-run structure tests for frontmatter parity**

```bash
mise exec -- pnpm --dir scripts/github-issue-handoff test
```

Expected: frontmatter/pairing tests pass for SKILL; file-existence still fails on references/templates.

- [ ] **Step 4: Commit**

```bash
git add packages/github-issue-handoff/.apm/skills/github-issue-handoff/SKILL.md packages/github-issue-handoff/.apm/skills/github-issue-handoff/SKILL.ja.md
git commit -m "feat(github-issue-handoff): add skill operating contract (en/ja)"
```

---

### Task 4: `references/` — protocol, issue-format, responder-guide

**Files:**
- Create: `references/protocol.md` + `.ja.md` — Requester lifecycle detail.
- Create: `references/issue-format.md` + `.ja.md` — artifact formats.
- Create: `references/responder-guide.md` + `.ja.md` — Responder protocol.

**Interfaces:**
- Consumes: paths linked from SKILL.md.
- Produces: verbatim contracts the contract tests grep: heading names, metadata comment schema, label semantics, prompt behavior rules.

- [ ] **Step 1: Write `references/protocol.md`** covering, in order:
   1. `## Roles` — Requester duties (§13); Responder = any commenting entity, no required runtime/identity/marker/label rights (§40).
   2. `## Preconditions` — `git` + `gh` available/authenticated, GitHub remote, Issues enabled; detection order: explicit repo → `gh repo view` → `git remote` (§56); fail explicitly on ambiguity.
   3. `## Local Investigation Gate` — §10 checklist.
   4. `## Branch` — reuse appropriate task branch else create one; verify repo/current-branch/base/tree/HEAD first (§14, §15); no unrelated changes.
   5. `## Checkpoint Commit` — relevant files only (§17), inspect `git status`/`git diff`/`git diff --cached` first (§18), message convention: repo convention first, else imperative subject + body covering why/what-verified/what-uncertain (§19); no secrets (§20).
   6. `## Push` — mandatory before Issue (§21); if policy forbids push → stop with "handoff protocol cannot be completed under current repository policy", never Issue-only fallback (§59).
   7. `## Issue + Draft PR` — create Issue per issue-format.md, then Draft PR with closing reference (§27–30); base = final merge target (§29).
   8. `## Responder Prompt` — render `assets/templates/responder-prompt.md` with actual `owner/repo` + label; show the full rendered prompt to the user plus Issue URL, PR URL, branch, commit SHA, blocking flag (§37); re-show rules (§39).
   9. `## Continue or Yield` — independent work continues (§43); `handoff:blocking` criteria (§44).
   10. `## Follow-up Rounds` — same Issue, new round ID, `needs-requester`→`needs-response`, commit/push first if code changed (§45, §46).
   11. `## Resume` — §47 sequence; labels are hints, comments are evidence.
   12. `## Evaluating Responses` — evidence hierarchy §48.
   13. `## Completion` — final validation → final commit → push → PR update → merge → verify Issue closed; auto-close failure → final `## Resolution` comment + explicit close (§49–54); unmerged PR handling (§53).
   14. `## Error Handling` — §57 list as table: failure → required behavior.
   15. `## Secret Safety` — §58 list.
   16. `## Concurrency` — per-Issue lifecycle vs repo-wide Responder invocation (§60).

- [ ] **Step 2: Write `references/issue-format.md`** covering:
   1. `## Labels` — the four labels + semantics + exclusivity rule (§22).
   2. `## Issue Title` — `[Handoff] <concise problem summary>` (§23).
   3. `## Issue Body` — the full §24 section contract with the exact headings (`## Question`, `## Context`, `## Findings`, `## Options considered`, `## Current assessment`, `## Repository state`, `## Verification performed`, `## Requested review`, `## Blocking`) and which are mandatory.
   4. `## Metadata Comment` — the `<!-- github-issue-handoff ... -->` schema: `protocol: 1`, `round:` ID format `<UTC timestamp>-<short id>` (§25, §26), `requester`, `branch`, `commit`, `blocking`; must not disturb rendering; no product names in schema.
   5. `## Pull Request` — Draft default (§28), base rule (§29), mandatory closing reference (§30) with the exact body template from §31 (`## Summary`, `## Handoff` with `Closes #<n>` + round id, `## Review context`, `## Current status` checklist, `## Known uncertainty`); existing repo PR templates take precedence while carrying this info.
   6. `## Follow-up Comment Format` — §45 block.

- [ ] **Step 3: Write `references/responder-guide.md`** — protocol description (distinct from the executable prompt, §42): find ALL open `handoff:needs-response` Issues; per Issue read body + all comments + linked PR (base/head, commits, diff, files, checks) + reconcile described vs actual repo state; independent re-evaluation of Requester assessment; repo evidence over assertion; ask for missing info rather than guess; response comment structure (`## Assessment`/`## Recommendation`/`## Reasoning`/`## Risks / edge cases`/`## Suggested next step`); optional PR review comments; optional `<!-- github-issue-handoff-response -->` marker (§41); optional label update if permitted — never required; deduplication rule; treat each Issue independently; final summary of per-Issue disposition.

- [ ] **Step 4: Write the three `.ja.md` files** — same heading structure/count, synchronized meaning.

- [ ] **Step 5: Run tests**

```bash
mise exec -- pnpm --dir scripts/github-issue-handoff test
```

Expected: reference-content checks pass; template checks still fail.

- [ ] **Step 6: Commit**

```bash
git add packages/github-issue-handoff/.apm/skills/github-issue-handoff/references
git commit -m "feat(github-issue-handoff): add protocol, issue format, and responder guide references (en/ja)"
```

---

### Task 5: Responder prompt templates + package docs (GREEN)

**Files:**
- Create: `assets/templates/responder-prompt.md` + `.ja.md`
- Create: `packages/github-issue-handoff/README.md` + `.ja.md`
- Create: `packages/github-issue-handoff/AGENTS.md` + `.ja.md`

**Interfaces:**
- Consumes: response-comment structure and label semantics from Task 4 (must match verbatim).
- Produces: the rendered-prompt contract used at handoff time; README required-topic coverage (§63).

- [ ] **Step 1: Write `responder-prompt.md`** — portable instruction to ANY responder. Required elements: `{{repository}}` placeholder; instruct to list ALL open Issues labeled `{{label}}` (documented default `handoff:needs-response`); explicit "do not stop after a single issue"; per-issue steps matching the §35 list (read body, all comments, linked PR incl. base/head/commits/diff/files/checks, reconcile repo state, independent assessment, evidence priority, ask-don't-guess, comment per issue, independent per-issue handling, skip already-answered latest round, optional label swap if permitted — comment mandatory regardless); response structure headings from §35; contradiction rule (repo evidence wins, flag it); final per-issue disposition summary. Comment at top noting placeholders and defaults.

- [ ] **Step 2: Write `responder-prompt.ja.md`** — the §35 Japanese contract verbatim in meaning; same structure.

- [ ] **Step 3: Write `README.md` + `README.ja.md`** covering §63: purpose; install (`apm install` + local path note); prerequisites (git, `gh`, `gh auth status`, GitHub remote, Issues enabled); branch/commit/push requirement; Issue workflow; mandatory Draft PR; `Closes #` linkage and merge→close semantics (incl. manual-close fallback); labels; Requester/Responder roles; repo-wide Responder prompt + template location + "shown to user at handoff, rendered" contract; blocking semantics; security (no secrets); troubleshooting table (gh missing/unauthenticated, non-GitHub remote, Issues disabled, permission errors, push forbidden → explicit protocol failure).

- [ ] **Step 4: Write `AGENTS.md` + `AGENTS.ja.md`** — maintainer scope (§64): package scope; `.apm/` is the distributed authority; EN/JA sync rule; protocol invariants (five artifacts, push-before-Issue, closing link, repo-wide prompt shown rendered, exclusivity, merge→verify-close); validation commands (`apm compile --validate`, `apm compile --dry-run`, `pnpm --dir scripts/github-issue-handoff test`, `pnpm --dir scripts/github-issue-handoff run lint:md`); do not duplicate root AGENTS generalities.

- [ ] **Step 5: Run full test suite — GREEN**

```bash
mise exec -- pnpm --dir scripts/github-issue-handoff test
```

Expected: all pass except root-registration test (Task 6).

- [ ] **Step 6: Commit**

```bash
git add packages/github-issue-handoff/.apm/skills/github-issue-handoff/assets packages/github-issue-handoff/README.md packages/github-issue-handoff/README.ja.md packages/github-issue-handoff/AGENTS.md packages/github-issue-handoff/AGENTS.ja.md
git commit -m "feat(github-issue-handoff): add responder prompt templates and package docs (en/ja)"
```

---

### Task 6: Root `apm.yml` registration

**Files:**
- Modify: `apm.yml` — add `- ./packages/github-issue-handoff` to `devDependencies.apm` (alphabetical position: after `doc-driven-dev`, before `github-automation`) and a marketplace entry after `doc-driven-dev`:

```yaml
  - name: github-issue-handoff
    category: automation
    source: scarecrow173/apm-packages
    subdir: packages/github-issue-handoff
```

- [ ] **Step 1: Edit `apm.yml`** in both places.
- [ ] **Step 2: Regenerate lockfile if the repo tracks one** — check for `apm.lock.yaml`; if present run `mise exec -- apm install` (never hand-edit). If absent, note that in the commit message.
- [ ] **Step 3: Run tests** — all green now.
- [ ] **Step 4: Commit**

```bash
git add apm.yml apm.lock.yaml 2>/dev/null; git commit -m "feat(github-issue-handoff): register package in marketplace index"
```

---

### Task 7: Validation + final review

- [ ] **Step 1:** `mise exec -- pnpm --dir scripts/github-issue-handoff install` (if not done), then `test` — all pass.
- [ ] **Step 2:** `mise exec -- pnpm --dir scripts/github-issue-handoff run lint:md` — clean.
- [ ] **Step 3:** `cd packages/github-issue-handoff && mise exec -- apm compile --dry-run` then `apm compile --validate` — clean (check `apm compile --help` first for actual flags).
- [ ] **Step 4:** `git diff --check` on the branch; re-read full diff against spec §71 review list.
- [ ] **Step 5:** Root README update decision — README.md structure tree already lists only 4 of 9 packages (illustrative, not exhaustive) → no update needed per spec §68; note in final report.
- [ ] **Step 6:** Final report per spec §72 format.
