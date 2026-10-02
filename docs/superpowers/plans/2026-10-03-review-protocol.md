# review-protocol APM Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new self-contained APM package `review-protocol` that turns the レビュープロトコル (a bounded, evidence-gated review protocol: parallel independent reviewers → Issue Candidates → Validator → Judge → severity-gated fixes → explicit stop conditions) into a distributable Agent Skill.

**Architecture:** Documentation-only Skill package, mirroring `packages/github-issue-handoff`. No runtime — the protocol is executed through skill instructions plus whatever reviewer/subagent mechanism the consumer's harness provides. `SKILL.md` holds the dense operating contract; `references/` carry the full protocol and the report-format contract. A tests-only workspace under `scripts/review-protocol/` runs structural contract tests (no runtime source, no build).

**Tech Stack:** Markdown + YAML frontmatter (Agent Skills spec), `node:test` + `tsx` + `gray-matter` for structural tests, `markdownlint-cli2` for lint, `mise` + `pnpm` for the toolchain.

## Global Constraints

- Run repo-managed tools via `mise exec -- <command>` (per root `AGENTS.md` §0). `mise` shims are NOT on PATH.
- Package name and skill name: `review-protocol`.
- Every English doc has a `.ja.md` sibling with identical heading structure and synchronized meaning (root `AGENTS.md` §2). Update both in the same change.
- Protocol invariants that must survive into the skill (from the source spec):
  - Reviewer output is **Issue Candidates** only — the artifact is never modified on a claim alone; only a Validator `CONFIRMED` verdict authorizes a fix.
  - At least **two** independent reviewers run **in parallel** and do not share findings before their own exploration completes: Reviewer A (cooperative — purpose fit, sufficiency), Reviewer B (adversarial — "how does this fail"; every finding needs a concrete Failure Scenario).
  - Reviewer, Validator, and Judge are **separate roles**. The Judge never starts a new review; new observations become new Issue Candidates routed to the Validator.
  - Verdicts: `CONFIRMED` / `REJECTED` / `UNVERIFIED`. `REJECTED` is excluded; `UNVERIFIED` is non-blocking unless the potential impact is severe (then escalate to a human).
  - Severity: `P0`/`P1` = blocking; `P2`/`P3` = non-blocking. Severity is decided by actual impact, never by reviewer confidence.
  - Automatic fixes are limited to `CONFIRMED P0/P1`, scoped to the confirmed root cause. P2/P3 are recorded and reported, never iterated unless explicitly requested.
  - Full re-review is capped at **two** cycles; unresolved blocking issues after that are escalated to a human.
  - Stop when acceptance criteria hold, objective checks pass, and no unresolved CONFIRMED P0/P1 remain — leftover P2/P3 never block. The goal is zero evidence-confirmed blocking issues, not zero comments.
  - Final verdict is exactly one of `ACCEPT`, `ACCEPT WITH NON-BLOCKING NOTES`, `BLOCKED`.
- The skill must be **harness-agnostic**: never require a specific product, runtime, or subagent mechanism. Where a runtime supports parallel subagents, use them; otherwise the roles are separated passes. Do not name AI products in distributed docs (contract test asserts this for templates; apply the same discipline everywhere).
- The protocol source text is Japanese; English is the primary doc language in this repo. `SKILL.ja.md` / `*.ja.md` keep protocol tokens verbatim in English (role names, field names, verdicts, severities, labels) — same convention as `github-issue-handoff` keeping `handoff:needs-response` literal in Japanese text.
- ASCII-only CLI output; files are UTF-8. Do not report Japanese docs as mojibake based on console rendering (root `AGENTS.md` §2).
- `apm compile --validate`, `apm compile --dry-run`, markdownlint, package tests, and `git diff --check` must pass before completion.
- All tests are offline structural checks — no network, no subagent dispatch.

## File Structure

```
packages/review-protocol/
├── apm.yml                                  # package manifest (mirrors github-issue-handoff shape)
├── .markdownlint-cli2.jsonc                 # lint config (same rules as github-issue-handoff)
├── README.md / README.ja.md                 # purpose, install, lifecycle, roles, severity, verdicts, validate
├── AGENTS.md / AGENTS.ja.md                 # maintainer guide: scope, localization, invariants, validation
└── .apm/skills/review-protocol/
    ├── SKILL.md / SKILL.ja.md               # operating contract: when-to-use, roles, lifecycle, invariants
    └── references/
        ├── protocol.md / protocol.ja.md     # full eleven-phase protocol
        └── report-format.md / report-format.ja.md  # Issue Candidate schema, verdicts, severity, final report

scripts/review-protocol/                     # tests-only workspace (no src/, no build output)
├── package.json                             # test + lint:md scripts
├── pnpm-workspace.yaml                      # standalone workspace: packages: ["."], allowBuilds esbuild
├── tsconfig.json                            # mirrors scripts/github-issue-handoff/tsconfig.json
└── tests/
    ├── package-structure.test.ts            # file existence, frontmatter, EN/JA parity, manifest, marketplace
    └── protocol-contract.test.ts            # roles, verdicts, severity, candidate schema, stop conditions

root apm.yml                                 # + devDependencies.apm entry, + marketplace.packages entry (category: workflow)
```

**Why no `scripts/` runtime:** the protocol is orchestration guidance for an agent, not executable code — the harness's own subagent/review mechanisms are sufficient; a custom CLI is YAGNI. The workspace exists only to host structural tests and the markdownlint script, matching the repo convention that tests live under `scripts/<name>/`.

**Why two reference files:** `protocol.md` is the process (phases 1–11); `report-format.md` is the data contract passed between roles (Issue Candidate fields, verdicts, severity table, final report). Splitting keeps the "schema" doc independently loadable when an executor is dispatching reviewers mid-review.

---

### Task 1: Package manifest and lint config

**Files:**
- Create: `packages/review-protocol/apm.yml`
- Create: `packages/review-protocol/.markdownlint-cli2.jsonc`

**Interfaces:**
- Produces: manifest `name: review-protocol`, `includes: [.apm/]`, scripts `validate`/`preview` consumed by Task 7 validation. Asserted by `package-structure.test.ts` in Task 2.

- [ ] **Step 1: Create `packages/review-protocol/apm.yml`** modeled on `packages/github-issue-handoff/apm.yml`:

```yaml
name: review-protocol
version: 0.1.0
description: Evidence-gated review protocol for agent artifacts — parallel independent reviewers produce issue candidates, a Validator verifies them against evidence, a Judge assigns severity, and only confirmed blocking issues are fixed.
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
```

- [ ] **Step 2: Create `packages/review-protocol/.markdownlint-cli2.jsonc`** — verbatim copy of `packages/github-issue-handoff/.markdownlint-cli2.jsonc`:

```jsonc
{
  "globs": [
    "**/*.md",
    "!node_modules/**"
  ],
  "config": {
    "default": true,
    "MD013": false,
    "MD024": {
      "siblings_only": true
    },
    "MD025": false,
    "MD033": false
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/review-protocol/apm.yml packages/review-protocol/.markdownlint-cli2.jsonc
git commit -m "feat(review-protocol): add package manifest and lint config"
```

---

### Task 2: Test workspace scaffold + failing structural tests (RED)

**Files:**
- Create: `scripts/review-protocol/package.json`
- Create: `scripts/review-protocol/pnpm-workspace.yaml`
- Create: `scripts/review-protocol/tsconfig.json`
- Create: `scripts/review-protocol/tests/package-structure.test.ts`
- Create: `scripts/review-protocol/tests/protocol-contract.test.ts`

**Interfaces:**
- Consumes: `packages/review-protocol/apm.yml` from Task 1 (manifest test passes; file-existence test fails on the missing skill/docs).
- Produces: the contract every later task implements against — required file list, frontmatter rules, EN/JA heading parity, `mise exec --` doc rule, root `apm.yml` registration, and the protocol's verbatim tokens (`Reviewer A`, `Reviewer B`, `Validator`, `Judge`, `Issue Candidate`, `CONFIRMED`, `REJECTED`, `UNVERIFIED`, `P0`–`P3`, `Failure Scenario`, `ACCEPT`, `ACCEPT WITH NON-BLOCKING NOTES`, `BLOCKED`).

- [ ] **Step 1: Create `scripts/review-protocol/package.json`**

```json
{
  "name": "review-protocol-tests",
  "version": "0.1.0",
  "private": true,
  "description": "Structural contract tests for the review-protocol APM package",
  "scripts": {
    "test": "tsx --test tests/*.test.ts",
    "lint:md": "markdownlint-cli2 --no-globs --config ../../packages/review-protocol/.markdownlint-cli2.jsonc \"../../packages/review-protocol/**/*.md\""
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

- [ ] **Step 2: Create `scripts/review-protocol/pnpm-workspace.yaml`** — verbatim copy of the github-issue-handoff one:

```yaml
packages:
  - "."
allowBuilds:
  esbuild: true
```

- [ ] **Step 3: Create `scripts/review-protocol/tsconfig.json`** — verbatim copy of the github-issue-handoff one:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["tests/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `scripts/review-protocol/tests/package-structure.test.ts`**

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../../..");
const pkgRoot = path.join(repoRoot, "packages", "review-protocol");
const skillDir = path.join(pkgRoot, ".apm", "skills", "review-protocol");

const requiredFiles = [
  "apm.yml",
  "README.md",
  "README.ja.md",
  "AGENTS.md",
  "AGENTS.ja.md",
  ".apm/skills/review-protocol/SKILL.md",
  ".apm/skills/review-protocol/SKILL.ja.md",
  ".apm/skills/review-protocol/references/protocol.md",
  ".apm/skills/review-protocol/references/protocol.ja.md",
  ".apm/skills/review-protocol/references/report-format.md",
  ".apm/skills/review-protocol/references/report-format.ja.md",
];

test("all required package files exist", () => {
  for (const rel of requiredFiles) {
    assert.ok(
      fs.existsSync(path.join(pkgRoot, rel)),
      `missing required file: ${rel}`,
    );
  }
});

test("SKILL.md frontmatter has name and trigger-scoped description", () => {
  const { data } = matter(
    fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"),
  );
  assert.equal(data.name, "review-protocol");
  assert.ok(
    typeof data.description === "string" && data.description.length > 0,
    "SKILL.md description missing",
  );
  assert.ok(
    data.description.length <= 1024,
    "SKILL.md description exceeds 1024 characters",
  );
  assert.match(
    data.description,
    /review|spec|design|plan|code|document/i,
    "description should describe the review trigger conditions",
  );
  assert.match(
    data.description,
    /when/i,
    "description should state when to use the skill",
  );
});

test("SKILL.ja.md frontmatter name matches SKILL.md", () => {
  const en = matter(
    fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"),
  ).data;
  const ja = matter(
    fs.readFileSync(path.join(skillDir, "SKILL.ja.md"), "utf8"),
  ).data;
  assert.equal(ja.name, en.name);
  assert.ok(typeof ja.description === "string" && ja.description.length > 0);
});

test("package manifest declares review-protocol with .apm includes", () => {
  const text = fs.readFileSync(path.join(pkgRoot, "apm.yml"), "utf8");
  assert.match(text, /^name: review-protocol$/m);
  assert.match(text, /^includes:\s*\r?\n\s+- \.apm\//m);
  assert.doesNotMatch(
    text,
    /^  (test|lint-md):/m,
    "manifest scripts must not reference the repo-only pnpm workspace",
  );
});

test("maintainer docs run repo-managed tools through mise exec", () => {
  for (const rel of [
    "AGENTS.md",
    "AGENTS.ja.md",
    "README.md",
    "README.ja.md",
  ]) {
    const text = fs.readFileSync(path.join(pkgRoot, rel), "utf8");
    assert.ok(
      text.includes("mise exec -- pnpm --dir scripts/review-protocol"),
      `${rel}: validation commands must go through mise exec`,
    );
  }
});

test("root apm.yml registers package in devDependencies and marketplace", () => {
  const text = fs.readFileSync(path.join(repoRoot, "apm.yml"), "utf8");
  assert.match(
    text,
    /- \.\/packages\/review-protocol/,
    "missing devDependencies.apm entry",
  );
  assert.match(
    text,
    /- name: review-protocol\s+category: workflow\s+source: scarecrow173\/apm-packages\s+subdir: packages\/review-protocol/,
    "missing marketplace entry with category workflow",
  );
});

function headings(rel: string): string[] {
  const text = fs.readFileSync(path.join(pkgRoot, rel), "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => /^#{1,6} /.test(line))
    .map((line) => line.replace(/^(#{1,6}) .*/, "$1"));
}

const pairedDocs = [
  "README",
  "AGENTS",
  ".apm/skills/review-protocol/SKILL",
  ".apm/skills/review-protocol/references/protocol",
  ".apm/skills/review-protocol/references/report-format",
];

test("English and Japanese docs share heading structure", () => {
  for (const base of pairedDocs) {
    const en = headings(`${base}.md`);
    const ja = headings(`${base}.ja.md`);
    assert.deepEqual(
      ja,
      en,
      `heading structure mismatch between ${base}.md and ${base}.ja.md`,
    );
  }
});
```

- [ ] **Step 5: Create `scripts/review-protocol/tests/protocol-contract.test.ts`**

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../../..");
const pkgRoot = path.join(repoRoot, "packages", "review-protocol");
const skillDir = path.join(pkgRoot, ".apm", "skills", "review-protocol");

function read(rel: string): string {
  return fs.readFileSync(path.join(skillDir, rel), "utf8");
}

function concepts(text: string, patterns: RegExp[], label: string) {
  const normalized = text.replace(/\s+/g, " ");
  for (const pattern of patterns) {
    assert.match(normalized, pattern, `${label}: expected ${pattern}`);
  }
}

const ROLES = [/Reviewer A/i, /Reviewer B/i, /Validator/i, /Judge/i];
const SEVERITIES = [/\bP0\b/, /\bP1\b/, /\bP2\b/, /\bP3\b/];
const VERDICTS = [/CONFIRMED/, /REJECTED/, /UNVERIFIED/];

test("SKILL.md documents roles, verdicts, and severities", () => {
  concepts(
    read("SKILL.md"),
    [
      ...ROLES,
      /Issue Candidate/i,
      ...VERDICTS,
      ...SEVERITIES,
      /blocking/i,
      /parallel|independent/i,
      /acceptance criteria/i,
    ],
    "SKILL.md",
  );
});

test("SKILL.md invariants gate fixes on CONFIRMED P0/P1 and bound iteration", () => {
  const skill = read("SKILL.md").replace(/\s+/g, " ");
  assert.match(
    skill,
    /P0\/P1|P0.*P1/,
    "fix scope limited to confirmed P0/P1 not documented",
  );
  assert.match(
    skill,
    /two cycles|at most.*(two|2).*(cycle|review)|(two|2).*cycles/i,
    "full re-review cycle cap not documented",
  );
});

test("protocol.md fixes evaluation criteria before reviewing", () => {
  const protocol = read("references/protocol.md").replace(/\s+/g, " ");
  assert.match(protocol, /evaluation criteria|acceptance criteria/i);
  assert.match(protocol, /before/i);
  concepts(
    protocol,
    [/requirement/i, /constraint/i, /scope/i, /assumption/i],
    "protocol.md",
  );
});

test("protocol.md requires objective verification before subjective review", () => {
  const protocol = read("references/protocol.md").replace(/\s+/g, " ");
  concepts(
    protocol,
    [
      /objective|mechanical|deterministic/i,
      /build|type ?check|lint|test/i,
      /static analysis|schema/i,
    ],
    "protocol.md",
  );
});

test("protocol.md defines cooperative Reviewer A and adversarial Reviewer B", () => {
  const protocol = read("references/protocol.md").replace(/\s+/g, " ");
  assert.match(protocol, /Reviewer A/i);
  assert.match(protocol, /cooperative/i);
  assert.match(protocol, /Reviewer B/i);
  assert.match(protocol, /adversarial/i);
  assert.match(
    protocol,
    /at least two|minimum (of )?two/i,
    "minimum two independent reviewers not documented",
  );
  assert.match(
    protocol,
    /do not share|without sharing|never share|independent/i,
    "no-cross-talk rule not documented",
  );
  assert.match(protocol, /Failure Scenario/i);
});

test("protocol.md separates Validator and Judge from reviewers", () => {
  const protocol = read("references/protocol.md").replace(/\s+/g, " ");
  concepts(
    protocol,
    [
      /Validator/i,
      /Judge/i,
      ...VERDICTS,
      /root cause/i,
      /duplicat|dedup/i,
      /candidate/i,
    ],
    "protocol.md",
  );
});

test("protocol.md bounds iteration and defines stop conditions", () => {
  const protocol = read("references/protocol.md").replace(/\s+/g, " ");
  assert.match(
    protocol,
    /(two|2).*(cycle|re-?review)/i,
    "re-review cycle cap missing",
  );
  concepts(
    protocol,
    [/stop condition/i, /escalat|human/i, /\bP0\b/, /\bP1\b/],
    "protocol.md",
  );
});

test("report-format.md defines the Issue Candidate schema", () => {
  const format = read("references/report-format.md").replace(/\s+/g, " ");
  for (const field of [
    "Claim",
    "Location",
    "Failure Scenario",
    "Impact",
    "Evidence",
    "Proposed Severity",
    "Validation Method",
  ]) {
    assert.ok(
      format.includes(field),
      `report-format.md: missing Issue Candidate field "${field}"`,
    );
  }
});

test("report-format.md defines severities, verdicts, and the final report", () => {
  const format = read("references/report-format.md").replace(/\s+/g, " ");
  concepts(
    format,
    [
      ...SEVERITIES,
      ...VERDICTS,
      /ACCEPT WITH NON-BLOCKING NOTES/,
      /\bACCEPT\b/,
      /\bBLOCKED\b/,
      /residual risk/i,
      /blocking/i,
      /non-?blocking/i,
    ],
    "report-format.md",
  );
});

test("no secrets-shaped content in package docs", () => {
  const files = [
    "SKILL.md",
    "SKILL.ja.md",
    "references/protocol.md",
    "references/protocol.ja.md",
    "references/report-format.md",
    "references/report-format.ja.md",
  ];
  for (const rel of files) {
    const text = read(rel);
    assert.doesNotMatch(
      text,
      /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      `${rel}: looks like it embeds a credential`,
    );
  }
});
```

- [ ] **Step 6: Install workspace dependencies**

```bash
mise exec -- pnpm --dir scripts/review-protocol install
```

Expected: lockfile `scripts/review-protocol/pnpm-lock.yaml` generated. `node_modules/` is covered by root `.gitignore` (`**/node_modules/`) — do not commit it.

- [ ] **Step 7: Run tests to verify they fail (RED)**

```bash
mise exec -- pnpm --dir scripts/review-protocol test
```

Expected: FAIL — `all required package files exist` reports the missing `SKILL*`/`references*`/`README*`/`AGENTS*` files; the manifest test passes (Task 1); frontmatter/parity/registration tests fail on missing files.

- [ ] **Step 8: Commit**

```bash
git add scripts/review-protocol/package.json scripts/review-protocol/pnpm-workspace.yaml scripts/review-protocol/tsconfig.json scripts/review-protocol/pnpm-lock.yaml scripts/review-protocol/tests
git commit -m "test(review-protocol): add structural contract test workspace"
```

---

### Task 3: `SKILL.md` / `SKILL.ja.md` — operating contract

**Files:**
- Create: `packages/review-protocol/.apm/skills/review-protocol/SKILL.md`
- Create: `packages/review-protocol/.apm/skills/review-protocol/SKILL.ja.md`

**Interfaces:**
- Consumes: nothing from other content tasks (this is the entry point).
- Produces: the skill's public contract. Links `references/protocol.md` and `references/report-format.md` by skill-relative path — those are the Task 4 targets. Frontmatter `name: review-protocol` and a "Use when…" description are asserted by Task 2 tests; every token in `ROLES`/`VERDICTS`/`SEVERITIES` must appear.

- [ ] **Step 1: Write `SKILL.md`** — dense operating contract, not a README. Full content:

````markdown
---
name: review-protocol
description: Use when reviewing a spec, design, plan, implementation, code, or document before accepting it — especially when a missed defect is expensive, when reviews tend to rubber-stamp or nitpick without end, or when findings need evidence before they justify changes. Not for trivial changes that a diff read, linter, type check, or test run already settles.
license: MIT
---

# Review Protocol

A bounded, evidence-gated protocol for reviewing artifacts — specs, designs,
plans, implementations, code, and documents. The goal is to find and verify
important problems efficiently, not to iterate until reviewers run out of
comments.

- **Coordinator**: the agent running the review — fixes evaluation criteria,
  dispatches reviewers, routes candidates, applies approved fixes, decides
  when to stop.
- **Reviewer A / Reviewer B**: two independent reviewers who explore different
  failure space and never see each other's findings before finishing.
- **Validator**: a separate role that verifies each Issue Candidate against
  objective evidence.
- **Judge**: a separate role that integrates verified results and decides
  severity and blocking status.

Dispatch the roles as independent subagents where the runtime supports it;
otherwise run them as clearly separated passes. Never collapse Reviewer,
Validator, and Judge into a single actor.

## When to Use

- reviewing an artifact against explicit acceptance criteria before sign-off
- high-stakes artifacts where a missed blocking defect is expensive
- review loops that risk endless polish or unverified findings

Do NOT use for:

- trivial changes a diff read, linter, type check, or test run settles
- open-ended improvement with no acceptance criteria — define criteria first
- style preferences with no concrete failure scenario

## Lifecycle

1. **Fix the evaluation criteria** — purpose, must requirements, constraints,
   assumptions, consistency requirements, unacceptable failures, scope.
   Unclear criteria are themselves risks; do not invent ideals.
2. **Objective checks first** — run every mechanical, deterministic check
   available (spec diff, schema validation, build, type check, lint, tests,
   static analysis) before any subjective review.
3. **Dispatch at least two independent reviewers in parallel** — Reviewer A
   (cooperative) and Reviewer B (adversarial). Their output is Issue
   Candidates only.
4. **Validate every candidate** — the Validator classifies each as
   `CONFIRMED`, `REJECTED`, or `UNVERIFIED`. `REJECTED` is dropped;
   `UNVERIFIED` is non-blocking unless the potential impact is severe —
   then escalate to a human.
5. **Judge** — evaluate evidence, drop false positives, dedupe by root
   cause, assign severity `P0`–`P3`, decide Blocking / Non-blocking.
6. **Fix only CONFIRMED P0/P1** — scoped to the confirmed root cause.
   P2/P3 are reported, not iterated.
7. **Re-verify the fix** — targeted checks only; a full re-review happens
   at most two cycles, only when a fix changed assumptions, structure,
   responsibilities, boundaries, or key decisions.
8. **Stop** — when acceptance criteria hold and no unresolved CONFIRMED
   P0/P1 remain. Emit the final report with verdict `ACCEPT`,
   `ACCEPT WITH NON-BLOCKING NOTES`, or `BLOCKED`.

## Invariants

- A reviewer's claim never modifies the artifact — only a Validator's
  `CONFIRMED` verdict authorizes a fix.
- Automatic fixes are limited to CONFIRMED P0/P1; P2/P3 produce no fix loop
  unless explicitly requested.
- Every Issue Candidate carries a concrete Failure Scenario — "this could
  be better" is not an issue.
- Severity is decided by actual impact, never by reviewer confidence.
- Full re-review is capped at two cycles; unresolved blocking issues after
  that are escalated to a human, not retried forever.
- The Judge never starts a new review on its own — new observations become
  new Issue Candidates routed to the Validator.
- The goal is no remaining evidence-confirmed blocking issues — not zero
  comments.

## References

- `references/protocol.md` — the full eleven-phase protocol: evaluation
  criteria, objective checks, reviewer scopes, validation, judgment,
  severity, fix scope, re-verification, stop conditions, final report.
- `references/report-format.md` — the Issue Candidate field contract,
  verdict and severity definitions, and the final report format.
````

- [ ] **Step 2: Write `SKILL.ja.md`** — identical heading structure (`#`, then `## When to Use`-equivalent headings at the same levels in the same order; the parity test checks heading *levels* only). Keep protocol tokens verbatim in English: `Coordinator`, `Reviewer A`, `Reviewer B`, `Validator`, `Judge`, `Issue Candidate`, `CONFIRMED`, `REJECTED`, `UNVERIFIED`, `P0`–`P3`, `Failure Scenario`, `Blocking`, `ACCEPT`, `ACCEPT WITH NON-BLOCKING NOTES`, `BLOCKED`. Frontmatter:

```yaml
---
name: review-protocol
description: 仕様・設計・計画・実装・コード・ドキュメントを受け入れる前にレビューするときに使います。見逃した欠陥のコストが高い場合、レビューが形だけの承認や際限のない指摘に堕ちやすい場合、指摘を変更の根拠にする前に証拠で検証したい場合に有効です。diff・lint・type check・test で確定できる些末な変更には使いません。
license: MIT
---
```

Body: faithful Japanese translation of the SKILL.md body, same heading sequence (`# Review Protocol`, `## いつ使うか`, `## ライフサイクル`, `## 不変条件`, `## 参照`).

- [ ] **Step 3: Re-run tests**

```bash
mise exec -- pnpm --dir scripts/review-protocol test
```

Expected: SKILL frontmatter tests and the two SKILL contract tests pass; file-existence still fails on `references/*`, `README*`, `AGENTS*`; registration test still fails.

- [ ] **Step 4: Commit**

```bash
git add packages/review-protocol/.apm/skills/review-protocol/SKILL.md packages/review-protocol/.apm/skills/review-protocol/SKILL.ja.md
git commit -m "feat(review-protocol): add skill operating contract (en/ja)"
```

---

### Task 4: `references/` — full protocol and report format

**Files:**
- Create: `packages/review-protocol/.apm/skills/review-protocol/references/protocol.md`
- Create: `packages/review-protocol/.apm/skills/review-protocol/references/protocol.ja.md`
- Create: `packages/review-protocol/.apm/skills/review-protocol/references/report-format.md`
- Create: `packages/review-protocol/.apm/skills/review-protocol/references/report-format.ja.md`

**Interfaces:**
- Consumes: paths linked from `SKILL.md` `## References`.
- Produces: the verbatim contracts the Task 2 tests grep — the seven Issue Candidate field names, verdict tokens, severity tokens, and the eleven-phase structure.

- [ ] **Step 1: Write `references/protocol.md`** — the authoritative process doc. Full content:

````markdown
# Review Protocol

## Overview

Applies when reviewing artifacts: specs, designs, plans, implementations,
code, and documents. The purpose is to find and verify important problems
efficiently — not to idealize the artifact without limit.

Never loop fixes until reviewers have nothing left to say.

## 1. Establish evaluation criteria first

Before reviewing, confirm the artifact's purpose and acceptance criteria.
At minimum, make explicit:

- what the artifact is meant to achieve
- must requirements
- constraints
- assumptions
- consistency requirements with existing specs, designs, and systems
- unacceptable failures
- the scope of this review

If evaluation criteria are unclear, do not invent an ideal on your own.
Treat the unknowns themselves as risks.

## 2. Verify objectively verifiable properties first

Prefer mechanical, deterministic, objective verification over subjective
LLM review. Examples:

- cross-checking against specs and requirements
- schema / format validation
- consistency checks
- computation and data validation
- prototypes and simulation
- build, type check, lint
- automated tests
- static analysis
- security scans
- diff review against existing artifacts

Do not judge by LLM guesswork what can be judged objectively.

## 3. Independent parallel reviewers

Launch at least two independent reviewers in parallel. Reviewers do not
share findings with each other until each one's exploration is complete.

### Reviewer A — cooperative review

Checks whether the artifact achieves its purpose correctly and is
necessary and sufficient. Hunt for:

- mismatches with requirements and purpose
- missing required items
- internal contradictions
- incorrect assumptions
- inconsistency with existing specs, designs, or systems
- feasibility problems
- unnecessary complexity
- design defects that become serious problems in later phases

The goal is judging whether the artifact is acceptable for its current
purpose — not idealizing it. Preferences, taste, and arbitrary improvements
whose concrete impact cannot be explained are not reported as blocking
issues.

### Reviewer B — adversarial review

Asks: "if this artifact fails, how does it fail?" Hunt for:

- edge cases
- failure modes
- implicit assumptions
- boundary conditions
- unexpected usage, input, or state
- contradictions
- security and safety problems
- operational problems
- breakage on extension or integration
- unrecoverable or high-cost failures
- overlooked risks

Every finding must include a concrete **Failure Scenario**. Do not treat
something as a problem merely because "it might be possible" or "it could
be better".

## 4. Reviewers do not confirm problems

Everything a reviewer outputs is an **Issue Candidate**. Each candidate
carries the seven fields defined in `report-format.md`: Claim, Location,
Failure Scenario, Impact, Evidence, Proposed Severity, Validation Method.

Never change the artifact based on a reviewer's claim alone.

## 5. The Validator verifies Issue Candidates

A Validator separate from the reviewers verifies every candidate. Use the
most objective method available for the artifact type:

- cross-checking against primary sources and original requirements
- checking against existing specs
- constructing concrete examples and counterexamples
- computation and simulation
- prototypes
- tests
- running the actual code
- static analysis
- data validation
- checking logical reachability

Classify each candidate:

- `CONFIRMED` — verified against evidence
- `REJECTED` — a false positive; excluded from further processing
- `UNVERIFIED` — could not be sufficiently verified; non-blocking in
  principle, but if the potential impact is severe, surface it to a human
  as an unresolved risk

Deduplicate candidates that share the same root cause before reporting.

## 6. The Judge makes the final call

A Judge — separate from both the reviewers and the Validator — integrates
the verified results:

- evaluates the evidence
- excludes false positives
- deduplicates by root cause
- decides severity
- decides Blocking / Non-blocking

The Judge never starts a new review. If the Judge notices a new problem,
it is not decided on the spot — it becomes a new Issue Candidate routed
to the Validator.

## 7. Severity levels

### P0 — Critical

Accepting the artifact leads to a severe, hard-to-recover failure.

**Blocking**

### P1 — Major

Unmet requirements, serious contradictions, realistic failures, or
important design defects that materially prevent the purpose.

**Blocking**

### P2 — Minor

Limited-scope problems, or improvements that do not prevent the purpose.

**Non-blocking**

### P3 — Nit

Expression, style, preference, optional cleanup or optimization.

**Non-blocking**

Severity is determined by actual impact, not by reviewer confidence.

## 8. Fix only CONFIRMED P0/P1

Automatic fixes are limited to `CONFIRMED P0` and `CONFIRMED P1`. P2/P3
may be recorded and reported, but produce no fix loop unless explicitly
requested.

Fixes are limited to the confirmed root cause — do not expand scope or
attach unrelated improvements.

## 9. Verify the fix

After fixing, run targeted verification first — not a full review:

- is the original problem resolved?
- are the acceptance criteria met?
- did the fix introduce new contradictions or regressions?
- do the relevant objective checks pass?

Do not restart every reviewer from scratch for each small fix. A full
re-review happens only when a fix significantly changed assumptions,
structure, responsibilities, boundaries, or key decisions.

A full review runs at most **two** cycles. If blocking issues still cannot
be resolved, stop the autonomous fix loop and defer to a human.

## 10. Stop conditions

End the review when all of the following hold:

- acceptance criteria are met
- required objective verifications pass
- no unresolved CONFIRMED P0
- no unresolved CONFIRMED P1
- no severe regression caused by the fixes

Remaining P2/P3 do not prevent completion. Do not continue a review only
because "more improvement is possible", "another reviewer might find
something", or "a more ideal form exists". The goal is not zero Issue
Candidates — it is an artifact that meets its purpose and acceptance
criteria with no evidence-confirmed blocking issues remaining.

## 11. Final report

Report concisely (format: `report-format.md`):

- confirmed P0/P1 and their resolutions
- notable rejected false positives
- remaining P2/P3
- validations performed
- residual risk and uncertainty
- final verdict: `ACCEPT`, `ACCEPT WITH NON-BLOCKING NOTES`, or `BLOCKED`

Stop when reaching `ACCEPT` or `ACCEPT WITH NON-BLOCKING NOTES`. Do not
start additional review cycles without an explicit request.
````

- [ ] **Step 2: Write `references/report-format.md`** — the data contract between roles. Full content:

````markdown
# Report Format

Contracts for the artifacts passed between roles in the review protocol.

## Issue Candidate

Every reviewer finding is an **Issue Candidate** — a hypothesis, not a
confirmed problem. Required fields:

| Field | Content |
| --- | --- |
| Claim | What is wrong, in one sentence. |
| Location | Where in the artifact the problem lives (file, section, line). |
| Failure Scenario | A concrete description of how this fails in practice. |
| Impact | What happens if the artifact is accepted as-is. |
| Evidence | The basis for the claim — quotes, diffs, reproduction, references. |
| Proposed Severity | The reviewer's suggested severity (P0–P3). |
| Validation Method | How the claim can be checked objectively. |

A candidate without a concrete Failure Scenario is not an issue — send it
back or drop it. The artifact is never modified on a reviewer's claim
alone.

## Validator Verdicts

| Verdict | Meaning | Disposition |
| --- | --- | --- |
| CONFIRMED | Verified against evidence. | Enters severity judgment; P0/P1 are blocking. |
| REJECTED | False positive. | Excluded from further processing. |
| UNVERIFIED | Cannot be sufficiently verified. | Non-blocking in principle; escalate to a human if the potential impact is severe. |

Deduplicate candidates that share the same root cause before reporting
verdicts.

## Severity Levels

| Severity | Meaning | Blocking |
| --- | --- | --- |
| P0 — Critical | Accepting the artifact leads to a severe, hard-to-recover failure. | Blocking |
| P1 — Major | Unmet requirements, serious contradictions, realistic failures, or important design defects that materially prevent the purpose. | Blocking |
| P2 — Minor | Limited-scope problems, or improvements that do not prevent the purpose. | Non-blocking |
| P3 — Nit | Expression, style, preference, optional cleanup or optimization. | Non-blocking |

Severity is assigned by actual impact — never by reviewer confidence.

## Final Verdicts

- `ACCEPT` — the artifact meets its acceptance criteria and no unresolved
  CONFIRMED P0/P1 remain.
- `ACCEPT WITH NON-BLOCKING NOTES` — same, with P2/P3 findings recorded.
- `BLOCKED` — unresolved CONFIRMED P0/P1 remain, or the review cycles were
  exhausted. Escalate to a human.

## Final Report

The Coordinator's final report contains, in order:

- **Confirmed P0/P1** — each confirmed blocking issue and how it was
  resolved.
- **Rejected false positives** — notable REJECTED candidates and why they
  were rejected.
- **Remaining P2/P3** — recorded, not fixed (unless explicitly requested).
- **Validation performed** — the objective checks that ran.
- **Residual Risk / Uncertainty** — unresolved UNVERIFIED items and open
  risks.
- **Final verdict** — `ACCEPT`, `ACCEPT WITH NON-BLOCKING NOTES`, or
  `BLOCKED`.
````

- [ ] **Step 3: Write `references/protocol.ja.md`** — same heading-level sequence as `protocol.md`. Use the source Japanese protocol text (reproduced below for the implementer — the executor may not have seen the original spec) organized under these headings:

```text
# Review Protocol
## 概要
## 1. 評価基準を先に確定する
## 2. 客観的に検証できるものを先に検証する
## 3. 独立したサブエージェントで並列レビューする
### Reviewer A — 協調的レビュー
### Reviewer B — 敵対的レビュー
## 4. Reviewerは問題を確定しない
## 5. Validatorが問題候補を検証する
## 6. Judgeが最終判定する
## 7. Severityを決定する
## 8. CONFIRMED P0/P1だけを修正する
## 9. 修正結果を検証する
## 10. 停止条件
## 11. 最終報告
```

The English heading "Overview" maps to `## 概要`; the two `###` reviewer headings keep `Reviewer A` / `Reviewer B` tokens verbatim. The source text is the user's original spec — adapt it nearly verbatim, keeping protocol tokens in English (`Issue Candidate`, `CONFIRMED`, `REJECTED`, `UNVERIFIED`, `P0`–`P3`, `Failure Scenario`, `Blocking`, `Non-blocking`, `ACCEPT`, `ACCEPT WITH NON-BLOCKING NOTES`, `BLOCKED`, `Claim`, `Location`, `Impact`, `Evidence`, `Proposed Severity`, `Validation Method`):

````text
仕様、設計、計画、実装、コード、ドキュメントなどの成果物をレビューする場合は、以下のプロトコルに従うこと。

目的は**重要な問題を効率よく発見・検証すること**であり、成果物を際限なく理想化することではない。

レビュー指摘がなくなるまで修正を繰り返してはならない。

## 1. 評価基準を先に確定する

レビュー前に、成果物の目的と受け入れ条件を確認する。

最低限、以下を明確にする。

- 何を達成する成果物か
- 必須要件
- 制約条件
- 前提条件
- 既存仕様・設計・システムとの整合条件
- 許容できないFailure
- 今回のスコープ

評価基準が不明確な場合は、勝手に理想像を設定してレビューしない。

不明点そのものをリスクとして扱う。

## 2. 客観的に検証できるものを先に検証する

利用可能な機械的・決定論的・客観的検証を、LLMによる主観的レビューより優先する。

例：

- 仕様・要求との照合
- schema / format validation
- consistency check
- 計算・データ検証
- prototype / simulation
- build / type check / lint
- automated test
- static analysis
- security scan
- 既存成果物との差分確認

客観的に判定できる問題を、LLMの推測だけで判断しない。

## 3. 独立したサブエージェントで並列レビューする

最低2つの独立したReviewerを並列起動する。

問題探索が終了するまで、Reviewer同士で指摘を共有しない。

### Reviewer A — 協調的レビュー

成果物が**目的を正しく、必要十分に達成しているか**を確認する。

重点的に探索する。

- 要求・目的との不一致
- 必要事項の欠落
- 内部矛盾
- 誤った前提
- 既存仕様・設計・システムとの不整合
- 実現性の問題
- 不必要な複雑性
- 将来の工程で重大な問題につながる設計上の欠陥

目的は成果物を理想化することではなく、**現在の目的に対して受け入れ可能か判断すること**である。

具体的な影響を説明できない好み、表現上の趣味、任意の改善はBlocking Issueとして報告しない。

### Reviewer B — 敵対的レビュー

「この成果物が失敗するとしたら、どのように失敗するか」という観点で確認する。

重点的に探索する。

- edge case
- failure mode
- 暗黙の前提
- 境界条件
- 想定外の利用・入力・状態
- 矛盾
- security / safety上の問題
- 運用上の問題
- 拡張時・統合時の破綻
- 回復不能または高コストな失敗
- 見落とされているリスク

各指摘には、具体的な**Failure Scenario**を必須とする。

単に「可能性がある」「もっと良くできる」という理由だけで問題として扱わない。

## 4. Reviewerは問題を確定しない

Reviewerの出力はすべて**Issue Candidate（問題候補）**として扱う。

各候補には最低限、以下を含める。

- Claim — 何が問題か
- Location — どこに問題があるか
- Failure Scenario — どう失敗するか
- Impact — 何が起きるか
- Evidence — 根拠
- Proposed Severity — 想定重大度
- Validation Method — どう検証できるか

Reviewerの指摘だけを根拠に成果物を変更してはならない。

## 5. Validatorが問題候補を検証する

Reviewerとは別のValidatorがIssue Candidateを検証する。

成果物の種類に応じて、可能な限り客観的な方法を使用する。

例：

- 原要求・一次資料との照合
- 既存仕様との照合
- 具体例・反例の作成
- 計算・シミュレーション
- prototype
- test
- 実コード実行
- static analysis
- データ検証
- 論理的な到達可能性の確認

各候補を以下に分類する。

- `CONFIRMED` — 根拠によって確認された
- `REJECTED` — False Positive
- `UNVERIFIED` — 十分に検証できない

`REJECTED`は除外する。

同じRoot Causeから発生する指摘は重複排除する。

`UNVERIFIED`は原則Blockingにしない。ただし潜在的影響が重大な場合は、未解決リスクとして人間に判断を求める。

## 6. Judgeが最終判定する

検証後、Reviewer・Validatorとは別のJudgeが結果を統合する。

Judgeが行うこと：

- Evidenceの評価
- False Positiveの除外
- Root Cause単位の重複排除
- Severityの決定
- Blocking / Non-blockingの決定

Judge自身が新しいレビューを開始してはならない。

Judgeが新しい問題に気付いた場合は、確定せず、新しいIssue CandidateとしてValidatorへ送る。

## 7. Severityを決定する

### P0 — Critical

成果物を受け入れると重大かつ回復困難なFailureにつながる。

**Blocking**

### P1 — Major

要求未達、重大な矛盾、現実的なFailure、重要な設計欠陥など、目的達成を実質的に妨げる。

**Blocking**

### P2 — Minor

限定的な問題や、改善価値はあるが目的達成を妨げない問題。

**Non-blocking**

### P3 — Nit

表現、style、好み、任意のcleanup・最適化。

**Non-blocking**

SeverityはReviewerのConfidenceではなく、**実際のImpact**に基づいて決定する。

## 8. CONFIRMED P0/P1だけを修正する

原則として自動修正対象は以下だけとする。

- `CONFIRMED P0`
- `CONFIRMED P1`

P2/P3は記録・報告してよいが、明示的に要求されない限り修正ループを発生させない。

修正は確認されたRoot Causeに限定する。

修正のついでにスコープを拡大したり、無関係な改善を行ったりしない。

## 9. 修正結果を検証する

修正後は全面レビューではなく、まず対象を絞って確認する。

確認すること：

- 元の問題が解消されたか
- Acceptance Criteriaを満たしているか
- 修正によって新しい矛盾やRegressionが発生していないか
- 関連する客観的検証を通過するか

小さな修正のたびに、すべてのReviewerを再起動してゼロから探索してはならない。

全面再レビューは、修正によって前提・構造・責務・境界・重要な判断などが大きく変化した場合のみ行う。

全面レビューは原則最大2サイクルとする。

それでもBlocking Issueが解消できない場合は、自律的な修正ループを停止し、人間へ判断を委ねる。

## 10. 停止条件

以下を満たした時点でレビューを終了する。

- Acceptance Criteriaを満たしている
- 必要な客観的検証を通過している
- 未解決の`CONFIRMED P0`がない
- 未解決の`CONFIRMED P1`がない
- 修正による重大なRegressionが確認されていない

P2/P3が残っていても終了する。

「さらに改善できる」
「別のReviewerなら何か見つけるかもしれない」
「より理想的な形にできる」

という理由だけでレビューを継続してはならない。

目標は問題候補をゼロにすることではない。

> **成果物が目的と受け入れ条件を満たし、Evidenceによって確認されたBlocking Issueが残っていない状態**

を完了条件とする。

## 11. 最終報告

最後に以下を簡潔に報告する。

- Confirmed P0/P1と対応内容
- Rejectedされた重要なFalse Positive
- 残っているP2/P3
- 実施したValidation
- Residual Risk / Uncertainty
- 最終判定

最終判定：

- `ACCEPT`
- `ACCEPT WITH NON-BLOCKING NOTES`
- `BLOCKED`

`ACCEPT`または`ACCEPT WITH NON-BLOCKING NOTES`に到達したら終了する。

明示的な要求がない限り、追加のレビューサイクルを開始しない。
````

Heading-parity note: the source text has `### P0 — Critical` … `### P3 — Nit` subheadings inside section 7, and the `### Reviewer A` / `### Reviewer B` subheadings inside section 3. The English `protocol.md` in Step 1 already uses `###` subsections in both places, so the heading-level sequences of `protocol.md` and `protocol.ja.md` match exactly (`#`, `##` ×12 — Overview plus sections 1–11, `###` ×2 in section 3, `###` ×4 in section 7).

- [ ] **Step 4: Write `references/report-format.ja.md`** — same heading-level sequence as `report-format.md` (`#`, `## Issue Candidate`, `## Validator Verdicts`, `## Severity Levels`, `## Final Verdicts`, `## Final Report` — the `##` titles may be translated but must stay `##`). Keep all protocol tokens verbatim in English (field names, verdicts, severities, final verdicts). Translate the table descriptions into Japanese.

- [ ] **Step 5: Run tests**

```bash
mise exec -- pnpm --dir scripts/review-protocol test
```

Expected: all `references/` contract tests and reference heading-parity pass; file-existence still fails on `README*`/`AGENTS*`; registration test still fails.

- [ ] **Step 6: Commit**

```bash
git add packages/review-protocol/.apm/skills/review-protocol/references
git commit -m "feat(review-protocol): add protocol and report-format references (en/ja)"
```

---

### Task 5: Package docs — README + AGENTS (GREEN)

**Files:**
- Create: `packages/review-protocol/README.md`
- Create: `packages/review-protocol/README.ja.md`
- Create: `packages/review-protocol/AGENTS.md`
- Create: `packages/review-protocol/AGENTS.ja.md`

**Interfaces:**
- Consumes: the role names, severity table, verdict list, and validation commands established in Tasks 2–4 — reuse them verbatim.
- Produces: maintainer-facing invariants and the `mise exec -- pnpm --dir scripts/review-protocol` command string asserted by the structure test; README coverage asserted indirectly by lint.

- [ ] **Step 1: Write `README.md`**. Full content:

````markdown
# review-protocol

`review-protocol` is an APM package containing a single skill of the same
name. It turns artifact review — specs, designs, plans, implementations,
code, documents — into a bounded, evidence-gated process instead of an
open-ended comment loop.

## Install

Register this repository as a marketplace, then install the package by name:

```bash
apm marketplace add scarecrow173/apm-packages
apm install review-protocol@apm-packages
```

Or reference the monorepo subdirectory directly with a version selector:

```yaml
dependencies:
  apm:
    - scarecrow173/apm-packages/packages/review-protocol#main
```

The distributed skill lives under `.apm/skills/review-protocol/`.

## How it works

1. **Fix the evaluation criteria** — purpose, must requirements,
   constraints, assumptions, unacceptable failures, and scope. Unclear
   criteria become risks, never invented ideals.
2. **Objective checks first** — build, type check, lint, tests, schema
   validation, diff review — before any subjective review.
3. **Two independent reviewers in parallel** — Reviewer A checks the
   artifact is necessary and sufficient for its purpose; Reviewer B hunts
   failure modes. They never see each other's findings mid-review.
4. **Findings are Issue Candidates** — each carries Claim, Location,
   Failure Scenario, Impact, Evidence, Proposed Severity, and Validation
   Method. Nothing changes on a claim alone.
5. **Validator** — a separate role verifies each candidate as `CONFIRMED`,
   `REJECTED`, or `UNVERIFIED` using the most objective method available.
6. **Judge** — a separate role drops false positives, dedupes by root
   cause, assigns severity, and decides blocking.
7. **Fix only CONFIRMED P0/P1** — scoped to the confirmed root cause;
   P2/P3 are reported, not iterated.
8. **Stop** — when acceptance criteria hold and no confirmed blocking
   issues remain. Full re-review is capped at two cycles before human
   escalation.

## Roles

| Role | Responsibility |
| --- | --- |
| Coordinator | Runs the protocol; the agent holding the artifact. |
| Reviewer A | Cooperative review — purpose fit, sufficiency, consistency. |
| Reviewer B | Adversarial review — edge cases, failure modes, hidden assumptions. |
| Validator | Verifies Issue Candidates against evidence. |
| Judge | Integrates verified results; decides severity and blocking. |

## Severity

| Level | Meaning | Blocking |
| --- | --- | --- |
| P0 | Severe, hard-to-recover failure if accepted | Yes |
| P1 | Materially prevents the artifact's purpose | Yes |
| P2 | Limited problem or non-blocking improvement | No |
| P3 | Style, preference, optional cleanup | No |

## Final verdicts

`ACCEPT`, `ACCEPT WITH NON-BLOCKING NOTES`, or `BLOCKED`. Reaching either
`ACCEPT` verdict ends the review; `BLOCKED` escalates to a human.

## Validate

From the repository root:

```bash
mise exec -- pnpm --dir scripts/review-protocol test
mise exec -- pnpm --dir scripts/review-protocol run lint:md
```

From this package directory:

```bash
mise exec -- apm compile --dry-run
mise exec -- apm compile --validate
```
````

- [ ] **Step 2: Write `README.ja.md`** — identical heading-level sequence, synchronized meaning. Keep `review-protocol`, role names, field names, verdicts, severities, the install commands, and the validation commands verbatim.

- [ ] **Step 3: Write `AGENTS.md`**. Full content:

````markdown
# AGENTS.md

Guide for agents maintaining `packages/review-protocol`.

## Scope

This directory is the distributed `review-protocol` APM package: a
documentation-only skill package (no runtime). Distributed assets under
`.apm/` are the authority; there is no generated code to rebuild.
Structural tests live in `scripts/review-protocol/tests/`.

## Localization

Every English document has a `.ja.md` sibling with identical heading
structure and synchronized meaning: `README`, `AGENTS`, `SKILL`, and all
`references/*`. Update both in the same change.

## Protocol invariants

When editing skill content, preserve:

- **Evidence gate** — reviewer output is Issue Candidates only; the
  artifact is never modified on a claim alone. Only a Validator's
  `CONFIRMED` verdict authorizes a fix.
- **Role separation** — at least two independent reviewers (A cooperative,
  B adversarial) in parallel with no cross-talk before exploration
  completes; Validator and Judge are separate roles and never start a
  review on their own initiative.
- **Issue Candidate contract** — every candidate carries Claim, Location,
  Failure Scenario, Impact, Evidence, Proposed Severity, and Validation
  Method; a candidate without a concrete Failure Scenario is not an issue.
- **Severity contract** — P0/P1 blocking, P2/P3 non-blocking; severity by
  actual impact, never by reviewer confidence.
- **Bounded iteration** — automatic fixes only for CONFIRMED P0/P1, scoped
  to the confirmed root cause; full re-review capped at two cycles, then
  human escalation.
- **Stop conditions** — done means acceptance criteria met + objective
  checks pass + no unresolved CONFIRMED P0/P1; leftover P2/P3 never block.
- **Verdict contract** — the final verdict is exactly one of `ACCEPT`,
  `ACCEPT WITH NON-BLOCKING NOTES`, `BLOCKED`.
- **Harness neutrality** — the skill never requires a specific product,
  runtime, or subagent mechanism and never names AI products.

## Validation

From the repository root:

```bash
mise exec -- pnpm --dir scripts/review-protocol test
mise exec -- pnpm --dir scripts/review-protocol run lint:md
```

From this package directory:

```bash
mise exec -- apm compile --dry-run
mise exec -- apm compile --validate
```

Then inspect `git diff --check`.
````

- [ ] **Step 4: Write `AGENTS.ja.md`** — identical heading-level sequence, synchronized meaning, same protocol tokens verbatim.

- [ ] **Step 5: Run tests — package files GREEN**

```bash
mise exec -- pnpm --dir scripts/review-protocol test
```

Expected: all pass except `root apm.yml registers package in devDependencies and marketplace` (Task 6).

- [ ] **Step 6: Run markdownlint**

```bash
mise exec -- pnpm --dir scripts/review-protocol run lint:md
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/review-protocol/README.md packages/review-protocol/README.ja.md packages/review-protocol/AGENTS.md packages/review-protocol/AGENTS.ja.md
git commit -m "feat(review-protocol): add package readme and maintainer guide (en/ja)"
```

---

### Task 6: Root `apm.yml` registration

**Files:**
- Modify: `apm.yml` — `devDependencies.apm` and `marketplace.packages`
- Possibly modify: `apm.lock.yaml` (regenerate, never hand-edit)

**Interfaces:**
- Consumes: `packages/review-protocol/` from Tasks 1–5.
- Produces: the registration asserted by `package-structure.test.ts`.

- [ ] **Step 1: Add the devDependency entry** in root `apm.yml` — append after `- ./packages/agent-intelligence` in `devDependencies.apm` (before the `mcp:` block):

```yaml
  - ./packages/review-protocol
```

- [ ] **Step 2: Add the marketplace entry** — append at the end of `marketplace.packages` (after the `agent-intelligence` entry):

```yaml
  - name: review-protocol
    category: workflow
    source: scarecrow173/apm-packages
    subdir: packages/review-protocol
```

- [ ] **Step 3: Regenerate the lockfile** — `apm.lock.yaml` exists at repo root and is tracked; run:

```bash
mise exec -- apm install
```

Never hand-edit `apm.lock.yaml`. If `apm install` fails or is unavailable, leave the lockfile unchanged, keep the test green anyway, and note it in the final report.

- [ ] **Step 4: Run tests — all green**

```bash
mise exec -- pnpm --dir scripts/review-protocol test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apm.yml apm.lock.yaml
git commit -m "feat(review-protocol): register package in marketplace index"
```

---

### Task 7: Validation + final review

- [ ] **Step 1: Full test suite**

```bash
mise exec -- pnpm --dir scripts/review-protocol test
```

Expected: all pass.

- [ ] **Step 2: Markdown lint**

```bash
mise exec -- pnpm --dir scripts/review-protocol run lint:md
```

Expected: clean.

- [ ] **Step 3: APM compile checks** — from `packages/review-protocol/`:

```bash
cd packages/review-protocol && mise exec -- apm compile --dry-run && mise exec -- apm compile --validate
```

Expected: clean. If a flag differs, check `mise exec -- apm compile --help` first.

- [ ] **Step 4: Whitespace + diff review**

```bash
git diff --check
```

Re-read the full branch diff against the Global Constraints list.

- [ ] **Step 5: Root README decision** — `README.md`'s structure tree lists only a subset of packages (illustrative, not exhaustive); no update needed. `README.ja.md` likewise. Note the decision in the final report.

- [ ] **Step 6: Final report** — files added, tests/lint/compile results, lockfile state, any deviations.

---

## Self-Review Notes

- **Spec coverage:** §1 evaluation criteria → protocol.md §1 + SKILL.md lifecycle 1. §2 objective-first → protocol.md §2 + lifecycle 2. §3 parallel independent reviewers → protocol.md §3 + roles. §4 Issue Candidates (7 fields) → report-format.md + protocol.md §4. §5 Validator verdicts → protocol.md §5 + report-format.md. §6 Judge constraints → protocol.md §6 + invariants. §7 severity → protocol.md §7 + report-format.md. §8 fix scope → protocol.md §8 + invariants. §9 fix verification / two-cycle cap → protocol.md §9 + invariants. §10 stop conditions → protocol.md §10 + invariants. §11 final report + verdicts → protocol.md §11 + report-format.md.
- **Placeholder scan:** all code/doc steps carry actual content; `*.ja.md` steps carry explicit heading lists, verbatim-token rules, and the full Japanese source text where it exists (protocol.ja.md).
- **Type consistency:** tokens used across tests and docs are identical — `review-protocol`, `Reviewer A`, `Reviewer B`, `Validator`, `Judge`, `Issue Candidate`, `CONFIRMED`, `REJECTED`, `UNVERIFIED`, `P0`–`P3`, `Failure Scenario`, `Claim`, `Location`, `Impact`, `Evidence`, `Proposed Severity`, `Validation Method`, `Blocking`, `ACCEPT`, `ACCEPT WITH NON-BLOCKING NOTES`, `BLOCKED`, category `workflow`, command string `mise exec -- pnpm --dir scripts/review-protocol`.
