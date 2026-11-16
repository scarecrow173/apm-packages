# pstack-devin Runtime Compatibility Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Devin runtime compatibility layer to `pstack-devin` — a `docs/harness/devin.md` adapter doc, Devin-native agent profile overwrites, precedence/boundary rules in the plugin root `AGENTS.md`, and a machine-checkable compatibility audit — without forking the upstream tree.

**Architecture:** Upstream bytes stay identical except an explicit `allow_overwrite` list (grown to cover `agents/poteto-agent.md`, which is machine-parsed and cannot be adapted by instructions). Everything else is adapter-layer additions via `overlay/`: the Devin harness doc (mapping Cursor→Devin names, precedence over `claude-code.md`), the always-on root `AGENTS.md` (activation boundary + adapter pointer), and a token-scan `audit-compat` script that classifies every upstream harness-API reference and fails on unknown/new ones.

**Tech Stack:** TypeScript + tsx --test (existing `scripts/pstack-devin` harness), Node fs/path, upstream tree at `packages/pstack-devin/devin-plugin/` (generated, byte-verified by #213).

## Global Constraints

- Upstream files are byte-identical to the pinned tree; the ONLY overwrite authority is `overlay.yml` `allow_overwrite`. This plan may extend it to `agents/poteto-agent.md` (and `agents/comment-sicko.md` ONLY if its body contains harness-specific references — verify first).
- All additions live under `packages/pstack-devin/overlay/` mirroring output paths; never hand-edit `devin-plugin/` — rebuild via `build-plugin`.
- Never claim a check passed unless it was actually run. Repository-managed tools run via `mise exec --` where a shim exists (node/pnpm come from `scripts/pstack-devin` pnpm workspace — run tests with `pnpm --dir scripts/pstack-devin test` from repo root, which already works).
- Do not implement #215 (setup-pstack model config), #216 (L1–L3 runtime tests), #217 (distribution), #218 (real Devin validation), or #219 (update PR automation). This issue defines the adapter contract + audit that later issues build on.
- Keep EN/JA docs synchronized where localized counterparts exist (README.md / README.ja.md).
- External GitHub issue references use inline code (no auto-references).
- Devin-side facts that could not be verified from authoritative docs are marked `VERIFY:` in Task 1; the implementer must resolve them against `https://docs.devin.ai/cli/llms.txt` pages before writing tables — never guess runtime behavior.

## File Map

| Path | Responsibility |
| --- | --- |
| `packages/pstack-devin/overlay/docs/harness/devin.md` | The adapter doc: precedence, tool/field/model/path mapping tables, routing rules, unsupported-feature policy, external deps. THE deliverable. |
| `packages/pstack-devin/overlay/AGENTS.md` | Always-on root instructions: adapter pointer + "don't activate pstack unprompted" boundary. Extends the #213 minimal file. |
| `packages/pstack-devin/overlay/agents/poteto-agent.md` | Devin-native overwrite: `name`/`description`/`max-nesting` frontmatter, `subagent_general`, `/pstack:` names, `~/.local/share/devin/cli/plugins/` paths, full `poteto-mode` SKILL.md read contract preserved verbatim. |
| `packages/pstack-devin/overlay/agents/comment-sicko.md` | Conditional overwrite — only if body contains Cursor-specific refs (verify in Task 3). |
| `packages/pstack-devin/overlay.yml` | `allow_overwrite` extended with `agents/poteto-agent.md` (+ `comment-sicko.md` iff needed). |
| `packages/pstack-devin/docs/devin-adapter-decisions.md` | Decision record: per-mapping classification (supported/alternative/skip/error), external dep decision + rationale, precedence rule. |
| `scripts/pstack-devin/src/compat-audit.ts` | Token-scan audit: classifies every harness-API reference in the upstream tree against `src/compat-vocabulary.ts`; unknown token/file → exit 1. |
| `scripts/pstack-devin/src/compat-vocabulary.ts` | The classified vocabulary: every known Cursor/Claude API name, path, feature token → category + classification. Shared by audit and tests. |
| `scripts/pstack-devin/tests/compat-audit.test.ts` | Fixture-tree tests: known tokens pass, unknown API token fails, new unclassified file flagged. |
| `scripts/pstack-devin/tests/adapter-contract.test.ts` | Asserts `devin-plugin/docs/harness/devin.md` contains every required mapping row, precedence line, boundary line, and that overwrites carry required Devin forms. |
| `packages/pstack-devin/README.md` + `README.ja.md` | Adapter section update (EN/JA sync). |

## Key Verified Facts (from source research — do NOT re-derive)

- Devin custom subagents: markdown under plugin `agents/`, frontmatter fields = `name`, `description`, `model`, `allowed-tools` (alias `tools`), `max-nesting`. `is_background` is NOT a profile field — background is a `run_subagent` runtime param. `ask_user_question` is always withheld from subagents. Built-ins: `subagent_explore` (read-only), `subagent_general` (inherits parent model). Custom profiles namespaced `pstack:<name>`; conflicts with built-in names are skipped with a warning.
- Upstream `agents/poteto-agent.md` frontmatter is `is_background: true`; its body references `generalPurpose`, `~/.cursor/plugins/`, `.cursor-plugin/plugin.json` — all wrong on Devin, and the file is machine-parsed so instruction-level adaptation cannot fix it → allowlist overwrite (the `pstack-ports/devin-pstack` port does exactly this, using `max-nesting: 3` + `subagent_general` + `~/.local/share/devin/cli/plugins/`).
- `agents/comment-sicko.md` frontmatter is `name`+`description` only (both valid Devin fields); overwrite needed ONLY if body has harness refs (check full file).
- External skill deps: `deslop`, `control-cli`, `control-ui` all come from `cursor-team-kit` (same repo, `.cursor-plugin/` manifest only → not installable as a Devin plugin). `technical-writing`, `unslop`, `no-comments` are INTERNAL pstack skills. Upstream already documents a plain-words fallback for missing `deslop`.
- Prior-art port `pstack-ports/devin-pstack`: evidence for `~/.devin/rules/pstack-models.md` (with `trigger: always_on` frontmatter), `~/.config/devin/agents/pstack-M.md` model-pinned profiles, `devin models list` for slug detection, `inherit-parent`/`auto` aliases, drop `fusion-*` slugs for subagents, Fusion `sidekick` tool for single hands-on delegates. Port is UNOFFICIAL — treat as evidence, verify against Devin docs.
- Upstream tree contains NO `commands/` or `automations/` dirs (546 files: agents/, assets/, docs/, skills/ + plugin.json/README/LICENSE). Cursor Automations/Bugbot/Cloud appear only as feature references in skill bodies.
- 38 upstream files reference `cursor`/`.cursor` — all must be classified by the audit vocabulary.
- `run_subagent` Devin tool params relevant here: `task`, `profile`, `is_background`, `resume`, `title`. Devin `todo_write`, `ask_user_question`, `read_subagent`, `get_output`, `skill` (invoke), `exec`, `read`, `grep`, `find_file_by_name` exist as first-class tools.

---

### Task 1: Compatibility vocabulary + audit scanner

The audit is the machine-checkable contract: it scans the GENERATED tree's upstream files (546 files — everything except `.devin-plugin/`, `AGENTS.md`, `provenance.json`) and classifies every harness-API token. Unknown token or new file referencing unclassified API-shaped text → fail. This is what detects new required APIs when upstream changes (#219's hook).

**Files:**
- Create: `scripts/pstack-devin/src/compat-vocabulary.ts`
- Create: `scripts/pstack-devin/src/compat-audit.ts`
- Create: `scripts/pstack-devin/tests/compat-audit.test.ts`
- Modify: `scripts/pstack-devin/package.json` (add `audit:compat` script)

**Interfaces:**
- Produces: `export type TokenClass = "supported" | "alternative" | "skip" | "error" | "unavailable-external" | "devin-only"`
- Produces: `export interface VocabEntry { pattern: RegExp; label: string; cls: TokenClass; note: string }`
- Produces: `export const VOCABULARY: VocabEntry[]` — the classification table (Task 2's devin.md MUST cover every label here)
- Produces: `export interface AuditFinding { file: string; line: number; match: string; cls: TokenClass; label: string }`
- Produces: `export function auditTree(root: string, upstreamFiles: string[]): { findings: AuditFinding[]; unknowns: AuditFinding[] }` — scans each file line-by-line against `VOCABULARY` plus an `unknowns` pass for API-shaped tokens not in the vocabulary
- Consumes: `listTreeEntries`/`TreeEntry` from `src/inventory.ts` is NOT needed — audit operates on the materialized `devin-plugin/` tree (walk with `fs.readdirSync`, skip `.devin-plugin/`, `AGENTS.md`, `provenance.json`, `LICENSE`, `README.md`, `plugin.json`, `assets/` binaries; scan only `.md`/`.sh`/`.mdc`/`.json` text files)

**Vocabulary seed** (must exist before tests; grow only via audit failures):

```typescript
// src/compat-vocabulary.ts
export type TokenClass =
  | "supported"            // maps to a real Devin tool/param
  | "alternative"          // mapped to a documented workaround
  | "skip"                 // intentionally not performed; must be said aloud
  | "error"                // required by the workflow but impossible on Devin — stop, don't pretend
  | "unavailable-external" // external skill not installable on Devin (cursor-team-kit)
  | "devin-only";          // our own overlay additions — never flagged

export interface VocabEntry {
  pattern: RegExp;   // matched case-insensitively per line
  label: string;     // stable identifier asserted by devin.md contract test
  cls: TokenClass;
  note: string;      // one-line rationale surfaced in audit output
}

export const VOCABULARY: VocabEntry[] = [
  // --- Tool names (upstream skill bodies use Cursor names) ---
  { pattern: /\bTask\b(?!\s*force)/i, label: "tool:Task", cls: "supported", note: "→ run_subagent" },
  { pattern: /AskQuestion|AskUserQuestion/i, label: "tool:AskQuestion", cls: "supported", note: "→ ask_user_question (parent only)" },
  { pattern: /TodoWrite/i, label: "tool:TodoWrite", cls: "supported", note: "→ todo_write" },
  { pattern: /subagent_type/i, label: "field:subagent_type", cls: "supported", note: "→ run_subagent profile" },
  { pattern: /generalPurpose/i, label: "value:generalPurpose", cls: "supported", note: "→ subagent_general" },
  { pattern: /readonly/i, label: "field:readonly", cls: "supported", note: "true→subagent_explore, false→subagent_general" },
  { pattern: /run_in_background/i, label: "field:run_in_background", cls: "supported", note: "→ is_background" },
  { pattern: /\bresume\b/i, label: "field:resume", cls: "supported", note: "→ run_subagent resume param" },
  { pattern: /file_attachments/i, label: "field:file_attachments", cls: "alternative", note: "list paths inline in task brief" },
  { pattern: /environment:\s*["']?cloud/i, label: "field:environment:cloud", cls: "error", note: "no Devin cloud subagent for local plugins" },
  { pattern: /environment:\s*["']?local/i, label: "field:environment:local", cls: "supported", note: "omit — default" },
  { pattern: /cloud_base_branch/i, label: "field:cloud_base_branch", cls: "alternative", note: "instruct worker to check out branch" },
  // --- Cursor-only features ---
  { pattern: /Automations?\b|update_state|webhook|routine wakeup/i, label: "feature:automations", cls: "skip", note: "Cursor-only; state it and skip" },
  { pattern: /Bugbot/i, label: "feature:bugbot", cls: "alternative", note: "forge-cmd triage when check exists; skip setup/wait" },
  { pattern: /SendToUser/i, label: "feature:sendtouser", cls: "error", note: "secrets must not transit the agent — refuse" },
  { pattern: /cloud (agent|VM|dashboard|machine)|environment:\s*"cloud"/i, label: "feature:cloud-agent", cls: "error", note: "no equivalent; error when mandatory, skip when optional" },
  // --- External skills (cursor-team-kit — not Devin-installable) ---
  { pattern: /\bdeslop\b/i, label: "extskill:deslop", cls: "unavailable-external", note: "cursor-team-kit; fallback = plain-words pass" },
  { pattern: /control-cli/i, label: "extskill:control-cli", cls: "unavailable-external", note: "cursor-team-kit; fallback = user-driven or exec verification" },
  { pattern: /control-ui/i, label: "extskill:control-ui", cls: "unavailable-external", note: "cursor-team-kit; fallback = user-driven verification" },
  // --- Paths/settings ---
  { pattern: /~?\.?\/\.cursor\/|~\/\.cursor/i, label: "path:.cursor", cls: "alternative", note: "map to Devin equivalents per paths table" },
  { pattern: /\.cursor-plugin/i, label: "path:.cursor-plugin", cls: "alternative", note: "→ .devin-plugin/plugin.json" },
  { pattern: /~\/\.claude|\.claude-plugin|CLAUDE\.md|AskUserQuestion|isolation:\s*"worktree"|pstack-models\.md/i, label: "devin-only:claude-adapter", cls: "devin-only", note: "claude-code.md adapter content — not ours to adapt" },
];
```

The `unknowns` pass flags lines matching `/(?:^|\s)(Grep|Glob|WebFetch|WebSearch|Write|Edit|NotebookEdit|LS|Bash)\b/` or `/subagent_type:\s*["']?(\w[\w-]*)/` where the captured value isn't `generalPurpose`/`poteto-agent`/`comment-sicko`, or `/^\s*[\w-]+:/` frontmatter lines in `agents/*.md` whose key isn't in `name|description|model|allowed-tools|tools|max-nesting|is_background` — anything shaped like a harness API with no vocabulary row.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/compat-audit.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditTree, VOCABULARY } from "../src/compat-audit.js";

function fixture(files: Record<string, string>): { root: string; files: string[] } {
  const root = mkdtempSync(join(tmpdir(), "compat-audit-"));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body, "utf8");
  }
  return { root, files: Object.keys(files) };
}

test("known tokens classify, no unknowns", () => {
  const { root, files } = fixture({
    "skills/x/SKILL.md": 'Use Task with subagent_type: generalPurpose and readonly: true\nRun /deslop first.\n',
  });
  const r = auditTree(root, files);
  assert.equal(r.unknowns.length, 0);
  const labels = r.findings.map((f) => f.label);
  assert.ok(labels.includes("tool:Task") && labels.includes("extskill:deslop"));
});

test("unknown API-shaped token fails audit", () => {
  const { root, files } = fixture({
    "skills/x/SKILL.md": "Spawn with subagent_type: megaReviewer\n",
  });
  const r = auditTree(root, files);
  assert.equal(r.unknowns.length, 1);
  assert.match(r.unknowns[0].match, /megaReviewer/);
});

test("cloud environment requirement classified error", () => {
  const { root, files } = fixture({
    "skills/y/SKILL.md": 'spawn: { environment: "cloud" }\n',
  });
  const r = auditTree(root, files);
  assert.equal(r.findings.find((f) => f.label === "field:environment:cloud")?.cls, "error");
});
```

- [ ] **Step 2: Run — expect FAIL** (`auditTree`/`VOCABULARY` don't exist)

```bash
pnpm --dir scripts/pstack-devin test
```

- [ ] **Step 3: Implement `compat-vocabulary.ts` + `compat-audit.ts`**

`auditTree(root, files)`: for each rel path, skip non-text extensions (`png|svg|ico|woff|ttf`), read utf8, scan lines against `VOCABULARY` (collect `findings`), then the `unknowns` regexes for unclassified API shapes. Return `{ findings, unknowns }`. CLI wrapper `audit-compat`: walks `packages/pstack-devin/devin-plugin/` (skipping `.devin-plugin/`, `AGENTS.md`, `provenance.json`, `LICENSE`, `README.md`, `plugin.json`, `assets/`), prints findings grouped by `cls`, exits 1 iff `unknowns.length > 0`. Add `"audit:compat": "tsx src/compat-audit.ts"` to `scripts/pstack-devin/package.json`.

- [ ] **Step 4: Run tests + run audit against the real generated tree**

```bash
pnpm --dir scripts/pstack-devin test
pnpm --dir scripts/pstack-devin exec tsx src/compat-audit.ts
```

Expected: tests PASS; real tree audit exits 0, prints classified findings (≈38 cursor-referencing files). Iterate the vocabulary until zero unknowns — every iteration is a REAL upstream usage being classified (record counts in `docs/devin-adapter-decisions.md`).

- [ ] **Step 5: Commit**

```bash
git add scripts/pstack-devin/src/compat-*.ts scripts/pstack-devin/tests/compat-audit.test.ts scripts/pstack-devin/package.json
git commit -m "feat(pstack-devin): add compatibility audit vocabulary and scanner"
```

### Task 2: `docs/harness/devin.md` adapter doc + decision record

The core deliverable — mirrors `claude-code.md`'s structure (Tools / Subagent fields / Models / setup-pstack / Paths / Cursor-only features) mapping Cursor names → Devin. Precedence: devin.md applies to Devin sessions and OVERRIDES claude-code.md wherever they conflict (Devin never reads `.claude`/`CLAUDE.md` rows).

**VERIFY before writing tables** (fetch `https://docs.devin.ai/cli/llms.txt` → relevant pages): (a) exact global rules dir — port says `~/.devin/rules/`; docs may say `~/.config/devin/rules/` — use the docs answer and note the port discrepancy; (b) plugin install dir (`~/.local/share/devin/cli/plugins/` vs `~/.config/devin/plugins/`); (c) whether `%APPDATA%\devin\` is the Windows equivalent of `~/.config/devin/`; (d) `devin models list` exists; (e) `trigger: always_on` frontmatter valid in Devin rules. Each unverifiable item → mark `[unverified]` in the doc rather than guess.

**Files:**
- Create: `packages/pstack-devin/overlay/docs/harness/devin.md`
- Create: `packages/pstack-devin/docs/devin-adapter-decisions.md`
- Create: `scripts/pstack-devin/tests/adapter-contract.test.ts`

**Interfaces:**
- Consumes: `VOCABULARY` labels — contract test asserts every non-`devin-only` label's target appears in the built `devin.md`
- Produces: adapter precedence rule text (asserted verbatim by contract test): `"When running on Devin, this file is the adapter of record. Where docs/harness/claude-code.md and this file disagree, this file wins — Devin never reads .claude paths or CLAUDE.md."`
- Produces: activation boundary (asserted): `"Do not run pstack skills, spawn pstack subagents, or apply these mappings unless the user invoked a pstack skill or /pstack:<name> command."`

**Required devin.md sections & rows** (write the full doc around these — row text is the contract):

```text
# pstack in Devin
- read-once-per-session preamble (mirrors claude-code.md): map Cursor names per tables; field with no row → drop it and say so; never pass a field the tool schema rejects.

## Tools
| Cursor/Claude             | Devin                                        |
| Task                      | run_subagent                                 |
| AskQuestion               | ask_user_question — parent only; subagents return the question text to the parent instead |
| TodoWrite                 | todo_write                                   |
| Grep / Glob               | grep / find_file_by_name / exec rg           |
| run another pstack skill  | invoke via skill tool if cataloged; else read <pstack>/skills/<name>/SKILL.md and follow it. Tell the user to type /pstack:<name>. |

## Subagent fields (Task → run_subagent)
| subagent_type: generalPurpose | profile: "subagent_general" |
| poteto-agent / comment-sicko  | profile: "pstack:poteto-agent" / "pstack:comment-sicko" |
| readonly: true   | profile: "subagent_explore" (hard read-only — stronger than Claude's Explore; no edit tools exist) |
| readonly: false  | profile: "subagent_general" |
| run_in_background: true | is_background: true |
| resume           | resume param — pass the previous agent_id |
| environment: "local" | omit |
| environment: "cloud" | ERROR — no Devin cloud subagent can load a local plugin profile. Stop and report; never silently substitute a local run when the workflow requires cloud isolation. |
| cloud_base_branch | tell the worker to check out that branch first (alternative) |
| file_attachments | list the paths in the task brief (alternative) |
| max depth / nesting | profile's max-nesting frontmatter (poteto-agent ships max-nesting: 3) |

## Routing (single vs fan-out)
- One hands-on delegate AND Fusion plan (tools include `sidekick`) → sidekick.
- Every fan-out — Arena arms, Swarm workers, independent reviewers, poteto-mode delegates → one run_subagent per entry, on the named profile/model.
- NEVER reduce the reviewer/arm count or collapse distinct models into one to fit a perceived limit — if a count can't be honored, report it, don't silently shrink it.

## Models
| claude-* slugs | model: on the spawning custom profile, or inherit-parent |
| non-model slugs (gemini etc.) | omit → session model; say so |
| ~/.cursor/rules/pstack-models.mdc | ~/.devin/rules/pstack-models.md (trigger: always_on) — written by setup-pstack (#215) |
| model diversity | preserved via model:-pinned custom profiles under ~/.config/devin/agents/ (setup-pstack writes pstack-M / pstack-M-ro) |

## Paths
| ~/.cursor/plugins/ | <verified plugin install dir> |
| .cursor-plugin/plugin.json | .devin-plugin/plugin.json |
| .cursor/skills/ | .devin/skills/ (project) |
| ~/.cursor/skills/ | <verified global skills dir> |
| .cursor/rules/*.mdc | <verified rules dir>/pstack-models.md or AGENTS.md when no rules dir exists |
| ~/.cursor/projects/<slug>/agent-transcripts/ | Devin session transcripts (no stable path — say so) |

## Cursor-only features
| Automations / update_state / webhooks / routine wakeups | skip — name the step skipped and why |
| Bugbot | triage existing PR threads via the forge command; skip setup/wait/config when no Bugbot check exists |
| cloud agents / cloud dashboard / cloud VM | ERROR when the workflow requires it; skip with a line when optional |
| SendToUser secret requests | ERROR — never route secrets through the agent |
| custom modes / fusion-* slugs as subagent models | drop fusion-* (lead+sidekick pair, not a subagent model) |

## External skills
| /deslop, control-cli, control-ui (cursor-team-kit) | unavailable-external: cursor-team-kit ships only a .cursor-plugin manifest — not installable on Devin. Fallback: perform the equivalent pass in plain words (upstream documents this for deslop: remove narrating comments, unsupported guards, dead compatibility paths, unrelated edits); say the skill was substituted. Bundling is rejected — see docs/devin-adapter-decisions.md. |
```

`docs/devin-adapter-decisions.md`: the audit's real findings counts per `cls`, the per-row rationale, the bundling-vs-external decision with MIT license/attribution notes (MIT permits bundling; rejected anyway to keep "no fork, no duplication" and avoid name collisions when upstream later ships Devin support — the `pstack` plugin name is already claimed by our manifest, a bundled `deslop` would collide if cursor-team-kit ever gets a Devin build), and the VERIFY resolutions.

- [ ] **Step 1: Write the failing contract test**

```typescript
// tests/adapter-contract.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PLUGIN = join(__dirname, "../../packages/pstack-devin/devin-plugin");

test("devin.md exists in generated plugin with required contract rows", () => {
  const doc = readFileSync(join(PLUGIN, "docs/harness/devin.md"), "utf8");
  for (const row of [
    "run_subagent", "ask_user_question", "todo_write",
    "subagent_general", "subagent_explore", "pstack:poteto-agent", "pstack:comment-sicko",
    "is_background", "resume", "file_attachments", "environment", "cloud",
    "sidekick", "deslop", "control-cli", "control-ui",
    ".devin-plugin/plugin.json", "pstack-models.md", "/pstack:",
  ]) assert.ok(doc.includes(row), `missing row: ${row}`);
  assert.match(doc, /this file is the adapter of record/i);
  assert.match(doc, /unless the user invoked a pstack skill/i);
  assert.match(doc, /ERROR|error/, "unsupported-required policy present");
  assert.match(doc, /skip/i, "skip policy present");
  assert.match(doc, /alternative|Fallback/i, "alternative policy present");
});
```

(The built file won't exist until Task 5's rebuild — test against `overlay/docs/harness/devin.md` source instead; adjust PLUGIN path to the overlay file.)

- [ ] **Step 2: Run — FAIL** (file absent)
- [ ] **Step 3: Resolve VERIFY items via docs.devin.ai pages; write `overlay/docs/harness/devin.md` + `docs/devin-adapter-decisions.md`**
- [ ] **Step 4: Run tests — PASS**
- [ ] **Step 5: Commit**

### Task 3: `agents/poteto-agent.md` (+ conditional `comment-sicko.md`) overwrite

Machine-parsed profile files can't be adapted by instructions. Extend `overlay.yml` `allow_overwrite` and add Devin-native versions under `overlay/agents/` preserving the upstream contract verbatim.

**Files:**
- Modify: `packages/pstack-devin/overlay.yml` (`allow_overwrite`)
- Create: `packages/pstack-devin/overlay/agents/poteto-agent.md`
- Maybe create: `packages/pstack-devin/overlay/agents/comment-sicko.md`
- Modify: `scripts/pstack-devin/tests/adapter-contract.test.ts`

- [ ] **Step 1:** Read full upstream `agents/comment-sicko.md` — if body contains only persona prose (no `~/.cursor`, `generalPurpose`, `/poteto` names, Task fields), NO overwrite; record decision. (Upstream frontmatter `name`+`description` is already valid Devin.)
- [ ] **Step 2: Failing test** — assert built `overlay/agents/poteto-agent.md` contains `max-nesting`, `subagent_general`, `~/.local/share/devin/cli/plugins/` (or verified path), `/pstack:` references, and the full-read contract phrase ("Read the `poteto-mode` skill's `SKILL.md` in full"), and contains NO `~/.cursor`, `generalPurpose`, `is_background`, `.cursor-plugin`.
- [ ] **Step 3: Write overwrite + extend allowlist**

```yaml
# overlay.yml — allow_overwrite becomes:
overlay:
  allow_overwrite:
    - skills/setup-pstack/SKILL.md   # reserved for #215
    - agents/poteto-agent.md         # Devin-native profile (machine-parsed; Cursor refs removed)
```

```markdown
---
name: poteto-agent
description: Delegate subagent for code-writing and helper tasks spawned during a `/pstack:poteto-mode` run. Use for delegates, not as the runner for `/pstack:poteto-mode` itself. Spawn a fresh `poteto-agent` for each new task, and resume one only in the strict cases that poteto-mode's Subagents section names. Reads the `poteto-mode` skill's `SKILL.md` in full before any work, including its inline Principles index. Substituting `subagent_general` skips that read and drifts.
max-nesting: 3
---

# Poteto subagent
<upstream body, verbatim, with ONLY these substitutions: generalPurpose→subagent_general, /poteto-mode→/pstack:poteto-mode, Task spawn→run_subagent spawn, ~/.cursor/plugins/→<verified plugin dir>, .cursor-plugin/plugin.json→.devin-plugin/plugin.json — keep the full-read contract, Principles index navigation, and "stop and tell your parent" failure mode word-for-word>
```

- [ ] **Step 4: Run tests — PASS; run `audit:compat` — still zero unknowns**
- [ ] **Step 5: Commit**

### Task 4: Root `AGENTS.md` — precedence + activation boundary

**Files:**
- Modify: `packages/pstack-devin/overlay/AGENTS.md`
- Modify: `scripts/pstack-devin/tests/adapter-contract.test.ts`

- [ ] **Step 1: Failing test** — assert `overlay/AGENTS.md` contains: (a) pointer "on Devin, read `docs/harness/devin.md` once before running any pstack skill"; (b) boundary "Do not run pstack skills, spawn pstack subagents, or apply these mappings unless the user invoked a pstack skill or `/pstack:<name>` command"; (c) precedence "docs/harness/devin.md is the adapter of record on Devin".
- [ ] **Step 2: Rewrite `overlay/AGENTS.md`** — keep the #213 "generated file, do not edit" header + provenance line; add the three contract blocks.
- [ ] **Step 3: Tests PASS — Commit**

### Task 5: Rebuild, docs sync, sweep, issue comment

- [ ] **Step 1:** `pnpm --dir scripts/pstack-devin run build` (rebuilds `devin-plugin/` with overlay applied) → `git status` shows only expected diffs: `docs/harness/devin.md` (new), `AGENTS.md`, `agents/poteto-agent.md`, `provenance.json` (overwrites list), maybe `agents/comment-sicko.md`.
- [ ] **Step 2:** `pnpm --dir scripts/pstack-devin run check-generated` → PASS (staged diff empty, provenance verifies).
- [ ] **Step 3:** Full suite `pnpm --dir scripts/pstack-devin test` + `run lint:md` + `pnpm --dir scripts/pstack-devin exec tsx src/compat-audit.ts` → all PASS/zero unknowns.
- [ ] **Step 4:** Update `packages/pstack-devin/README.md` + `README.ja.md` — adapter section: devin.md exists, precedence rule, external-deps decision one-liner, audit command. Keep EN/JA mirrored.
- [ ] **Step 5:** Commit all; post Issue `#214` comment with mapping-table summary + audit counts.

## Self-Review

- **Spec coverage**: mapping rows (all issue-named fields) → Task 2 table + contract test; precedence → Task 2 doc + Task 4 AGENTS.md; poteto-agent init contract → Task 3; sidekick vs fan-out routing + no silent model/count reduction → Task 2 Routing section; Profile discovery + cloud non-support → Tools/fields tables + VERIFY (b); Automations/Bugbot/Cloud/custom-modes classification → Cursor-only table + vocabulary; external deps decision + license/attribution → Task 2 decisions doc; path/CLI/`pstack`-name collisions → Paths table + decisions doc (name collision: our manifest claims `pstack`; document that a second plugin named `pstack` conflicts and `/pstack:` prefix is ours); AGENTS.md non-activation → Task 4; compat audit for new APIs → Task 1; "unsupported produce diagnostics not silent" → skip/error policy + devin.md preamble. Non-goals respected: no Cursor automation implementation, no whole-tree fork, #215–#219 untouched.
- **Type consistency**: `VocabEntry.cls` ↔ devin.md policy words (supported/alternative/skip/error/unavailable-external); `auditTree` signature matches test usage; `pstack:poteto-agent` naming consistent across table, overwrite, tests.
- **Placeholders**: VERIFY items are explicit verification steps with authoritative source named, not TBDs.
