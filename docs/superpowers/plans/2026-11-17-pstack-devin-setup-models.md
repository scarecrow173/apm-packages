# pstack-devin setup-pstack Devin Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt `/pstack:setup-pstack` for Devin — detect models via `devin models list`, generate `~/.devin/rules/pstack-models.md` plus model-pinned custom subagent profiles under `~/.config/devin/agents/`, with deterministic, unit-tested generation logic and user-change protection.

**Architecture:** A thin delegation overwrite at `skills/setup-pstack/SKILL.md` (already allowlisted) points to a new `skills/setup-pstack-devin/` skill carrying: `SKILL.md` (orchestration UX: detect → confirm → apply), `scripts/setup.mjs` (deterministic Node generator — parses `devin models list`, applies upstream budget/effort arithmetic, emits rules file + profiles, computes diffs, protects user edits), and `scripts/roles.json` (canonical role schema mirroring upstream step-5). Unit tests import `setup.mjs` directly — the issue's "unit tests for mapping/budget/fan-out/re-run" are real logic tests, not content greps. The `.apm/skills/setup-pstack-devin/` copy ships the same skill to APM consumers (byte-sync-tested).

**Tech Stack:** Node ESM `.mjs` (zero deps — runs anywhere Devin does), tsx --test harness, upstream pinned tree as schema authority.

## Global Constraints

- Never write to `~/.cursor`, `~/.claude`, `.cursor/`, `.claude/` — script and skill must assert paths resolve under Devin roots only (`~/.devin/`, `~/.config/devin/` or `%APPDATA%\devin\`).
- Never write an undetected model slug into a profile or rule — `inherit-parent`/`auto` aliases excepted; `fusion-*` slugs are dropped from the detectable set (lead+sidekick pair, not a subagent model).
- Preserve upstream's 12 roles, panel fan-out (list length = subagent count), budget labels `unlimited/large/medium/small`, effort ladder `max > xhigh > high > medium > low`, `# defaults: 2` schema line, and retire-notice behavior for unknown role lines.
- Re-runs are byte-stable; existing files differing from last-generated output get a diff shown and require explicit confirmation (generated files carry a `# pstack-generated:` sha256 marker to distinguish own output from user edits); obsolete `pstack-*.md` profiles are listed as removal candidates, deleted only on explicit `--remove`.
- A role profile named read-only must not claim "完全read-only"/"fully read-only" unless the guarantee is real — `allowed-tools` omits `exec`/`write`/`edit`/`mcp_call_tool`-adjacent entries but the doc states the residual risk and offers `subagent_explore` as the hard guarantee.
- VERIFY: real `allowed-tools` token names for Devin custom profiles (docs example shows `read, grep, glob, exec`; our `find_file_by_name`/`web_search` names unverified — check `docs.devin.ai/cli/subagents.md` + `extensibility/` pages; use only verified tokens and note the verification source).
- Do not rebuild `devin-plugin/` until Task 4. `check-generated` drift is expected mid-branch.
- Keep EN/JA package docs synchronized.

## Verified Facts (do NOT re-derive)

- Upstream `skills/setup-pstack/SKILL.md` (85 lines): writes `~/.cursor/rules/pstack-models.mdc` w/ `alwaysApply: true`; detects slugs; retired-role lines dropped with notice; `grok-*` old-slug migration; budget moves effort on the ladder; panel roles = `arena runners`, `arena cross-judge pool`, `architect runners`, `interrogate reviewers` (one subagent per list entry); cross-judge pool ordered by preference, `inherit-parent`/`auto` never judges.
- Canonical roles (upstream step-5, `# defaults: 2`): `feature, refactoring` / `bug-fix` / `perf-issue` / `hillclimb` / `judgment and prose` / `hardest tasks` / `reflect tooling` / `reflect judgment, divergent, synthesizer` / `arena runners` / `arena cross-judge pool` / `swarm workers` / `architect runners` / `interrogate reviewers`. Defaults: opus-xhigh for most, `hardest tasks`=fable-max, `reflect tooling`=opus-high-fast, panels=fable-high+opus-high-fast+gemini-high.
- Family rules (arena Phase A): longest prefix wins `claude-fable-*` > `claude-*` > `gemini-*`; drop leading `cursor-`; else text before first `-`. Vendor = family except `claude-fable-*`+`claude-*` are one vendor.
- Effort token: last token, or one before a trailing `fast`. Families w/o fast slugs (fable, gemini) never get `-fast` written.
- Devin-verified (from #214 verify-resolutions): `~/.devin/rules/*.md` global rules w/ `trigger: always_on`; `~/.config/devin/agents/` custom profiles (`%APPDATA%\devin\agents\` Windows analog — mark `[unverified]`); `devin models list` confirmed on devin 3000.12.57 (51 families, slugs like `swe-2-max`, `swe-2-high`, `adaptive`); plugin subagents local-only; profiles load at session start.
- Consumer skills read `~/.cursor/rules/pstack-models.mdc` — the #214 adapter's path mapping resolves it to `~/.devin/rules/pstack-models.md`. Our generated file must use upstream's exact line format (`role: slug[, slug…]`, `# budget: label (effort)`, `# defaults: 2`) so mapped reads work.
- Prior-art port generates `pstack-M.md` (write) + `pstack-M-ro.md` (ro) profiles — same shape we adopt.

## File Map

| Path | Responsibility |
| --- | --- |
| `packages/pstack-devin/overlay/skills/setup-pstack-devin/SKILL.md` | Devin orchestration skill (addition) |
| `packages/pstack-devin/overlay/skills/setup-pstack-devin/scripts/setup.mjs` | Deterministic generator + CLI (addition) |
| `packages/pstack-devin/overlay/skills/setup-pstack-devin/scripts/roles.json` | Canonical role schema (`{schema:2, roles:[{key, default, panel}]}`) |
| `packages/pstack-devin/overlay/skills/setup-pstack/SKILL.md` | Thin delegation overwrite (allowlisted) |
| `packages/pstack-devin/.apm/skills/setup-pstack-devin/` | APM-shipped copy — byte-sync with overlay dir |
| `scripts/pstack-devin/tests/setup-pstack.test.ts` | Unit tests importing `setup.mjs` from overlay path |
| `scripts/pstack-devin/tests/adapter-contract.test.ts` | extend: delegation overwrite + no-cursor-writes assertions |

## `setup.mjs` Contract (all exported for tests)

```js
export function parseModels(raw)      // devin models list text → slug[]; drops fusion-*, keeps first-token slugs incl. `adaptive`
export function familyOf(slug)        // longest-prefix family rules above
export function effortOf(slug)        // last token, or token before trailing `fast` → effort+hasFast
export function applyBudget(roles, choices, detected, budget) // → {resolved, needsChoice[]}; ladder move, family fallback (highest effort ≤ target), aliases passthrough, never writes undetected slug
export function rulesFile(choices, budget)                    // → string; upstream exact shape w/ Devin frontmatter `trigger: always_on`
export function profileFile(model, {ro})                      // → `pstack-<slug>[-ro].md` content; ro omits exec/write tools via allowed-tools + honest capability note
export function planChanges(fs_state, desired)                // → {write:[], diff:[], removeCandidates:[], unchanged:[]}; `# pstack-generated:` sha marker decides own-vs-user edits
export function detectRolesSchema(upstreamSkillText)          // → {schemaN, roleKeys[]}; used by the new-role test
export function main(argv)                                    // CLI: `plan|apply` subcommands; apply requires --yes for diffs, --remove for deletions
```

---

### Task 1: `setup.mjs` + `roles.json` + unit tests

**Files:**
- Create: `packages/pstack-devin/overlay/skills/setup-pstack-devin/scripts/roles.json`
- Create: `packages/pstack-devin/overlay/skills/setup-pstack-devin/scripts/setup.mjs`
- Create: `scripts/pstack-devin/tests/setup-pstack.test.ts`

- [ ] **Step 1: roles.json** — encode the 12 canonical roles + defaults + `panel: true` on the 4 panel roles + `schema: 2` + `defaults_sha` of upstream step-5 block.

- [ ] **Step 2: failing tests** covering every completion criterion:

```typescript
// scripts/pstack-devin/tests/setup-pstack.test.ts (representative — write ~12 tests)
const SETUP = "../../../packages/pstack-devin/overlay/skills/setup-pstack-devin/scripts/setup.mjs";
test("parseModels drops fusion-* and keeps real slugs", () => {
  const slugs = parseModels("SWE-2 (swe-2)\n  swe-2-high\n  swe-2-max\nFusion\n  fusion-claude-opus-5-5-max-sidekick-swe-2-high\nAdaptive\n  adaptive\n");
  assert.deepEqual(slugs.sort(), ["adaptive", "swe-2-high", "swe-2-max"]);
});
test("applyBudget moves effort on ladder with clamp", () => {
  const r = applyBudget(roles, { "bug-fix": "swe-2-xhigh" }, ["swe-2-max","swe-2-xhigh","swe-2-high"], "unlimited");
  assert.equal(r.resolved["bug-fix"], "swe-2-max"); // +1 clamped at top
});
test("small budget drops effort two rungs incl. fast suffix", () => {
  const r = applyBudget(roles, {"swarm workers":"m-xhigh-fast"}, ["m-xhigh-fast","m-low-fast","m-medium"], "small");
  assert.equal(r.resolved["swarm workers"], "m-low-fast");
});
test("undetected slug → needsChoice, never written", () => {
  const r = applyBudget(roles, {"bug-fix":"swe-2-high"}, ["swe-2-high"], "large");
  // high→xhigh has no detected slug and no same-family slug ≤ target → needsChoice
  assert.deepEqual(r.needsChoice, ["bug-fix"]);
});
test("panel list: one slug per entry, fan-out preserved", () => {
  const r = applyBudget(roles, {"arena runners":"f-high, o-high-fast, g-high"}, ["f-high","o-high-fast","g-high"], "medium");
  assert.equal(r.resolved["arena runners"].split(",").length, 3); // never collapse
});
test("rulesFile is byte-stable across identical calls", () => {
  assert.equal(rulesFile(c, "large"), rulesFile(c, "large"));
  assert.match(rulesFile(c,"large"), /trigger: always_on|# defaults: 2|# budget: large \(xhigh\)/);
});
test("ro profile has no exec/write in allowed-tools and no 完全read-only claim", () => {
  const p = profileFile("swe-2-max", {ro: true});
  assert.doesNotMatch(p, /exec|write|edit/i && /allowed-tools[\s\S]*exec/);
  assert.doesNotMatch(p, /完全read-only|fully read-only/i);
});
test("planChanges: own output unchanged → skip; user-edited → diff flag", () => {
  const st = {"pstack-x.md": gen("x"), "pstack-y.md": "user edited"};
  const pl = planChanges(st, {"pstack-x.md": gen("x"), "pstack-y.md": gen("y")});
  assert.equal(pl.unchanged.length, 1); assert.equal(pl.diff.length, 1);
});
test("obsolete profiles → removeCandidates only", () => { /* st has extra pstack-old.md → candidates, never auto-delete */ });
test("detectRolesSchema parses upstream step-5 block", () => {
  const up = readFileSync(join(PLUGIN, "skills/setup-pstack/SKILL.md"), "utf8"); // pinned upstream? NO — the generated file is OUR overwrite. Read the git blob: `git show <base>:devin-plugin/skills/setup-pstack/SKILL.md` or keep a test fixture copy of upstream step-5 under tests/fixtures/.
});
test("schema test: every upstream step-5 role key ∈ roles.json (new upstream role → explicit failure)", () => { /* parse upstream fixture block; assert subset; failure message demands schema+config update */ });
test("paths never escape Devin roots", () => { /* rulesFile destination + profile dir resolve under ~/.devin, ~/.config/devin or %APPDATA%\devin; a cursor path input → throw */ });
```

For the upstream schema source: ship `tests/fixtures/setup-pstack-upstream-step5.txt` — extract the upstream step-5 code block now (byte copy from `devin-plugin/skills/setup-pstack/SKILL.md` BEFORE Task 4's rebuild overwrites it — or `git show HEAD:packages/.../setup-pstack/SKILL.md` in test since the blob is the pinned upstream until rebuild; simplest robust: extract to fixture file in Step 2).

- [ ] **Step 3: implement `setup.mjs`** per contract; `main(argv)`: `plan` prints JSON diff plan to stdout; `apply` writes only confirmed sets; `--remove` deletes removeCandidates explicitly.
- [ ] **Step 4:** `pnpm --dir scripts/pstack-devin test` green; commit `feat(pstack-devin): add deterministic setup-pstack model/profile generator`.

### Task 2: `setup-pstack-devin` skill + thin delegation overwrite + contract tests

**Files:**
- Create: `packages/pstack-devin/overlay/skills/setup-pstack-devin/SKILL.md`
- Create: `packages/pstack-devin/overlay/skills/setup-pstack/SKILL.md` (overwrite — allowlist already contains it)

`setup-pstack-devin/SKILL.md` structure (frontmatter `name: setup-pstack-devin`, description mirroring upstream's w/ Devin trigger words `/pstack:setup-pstack`):
1. Detect: run `devin models list` → `parseModels` (or run `setup.mjs parse`); zero slugs → ask user to paste; `fusion-*` explained as excluded.
2. Current state: read `~/.devin/rules/pstack-models.md` + list `~/.config/devin/agents/pstack-*.md` if present; unknown role lines → drop with notice (retired-role behavior).
3. ask_user_question: budget (4 exact upstream labels) → per-role confirmation w/ needsChoice roles marked.
4. Apply: `node <skill>/scripts/setup.mjs plan --choices <json>` → show diff → confirm → `apply --yes`; `--remove` only after listing candidates and explicit yes.
5. Explain: profiles load at session start (new session reflects); cloud sessions unsupported (local-only plugin subagents); Fusion `sidekick` covers single hands-on delegates while fan-out roles spawn `run_subagent` on these profiles; unknown model → fail closed, never guessed.
6. Preserve upstream steps 7-8 offers (`/pstack:create-verification-skill`, `/pstack:create-formal-verification-skill`).

`setup-pstack/SKILL.md` overwrite: keep upstream frontmatter verbatim (`name`+`description` — description references `/setup-pstack`; add `pstack:`-namespaced mention allowed but keep upstream text for discovery parity), body: "Devin distribution: the upstream Cursor instructions this file held are tracked in provenance. On Devin, read `skills/setup-pstack-devin/SKILL.md` in full and follow it."

Contract test additions (`adapter-contract.test.ts`): delegation file exists, frontmatter name `setup-pstack`, body points to `setup-pstack-devin`; NEITHER file contains `~/.cursor`/`~/.claude` write instructions (the delegation file may reference provenance only); `setup.mjs` contains no `cursor`/`claude` path writes.

- [ ] TDD → commit `feat(pstack-devin): add Devin setup-pstack skill and delegation entry`.

### Task 3: `.apm` copy + sync + docs

- [ ] Copy `overlay/skills/setup-pstack-devin/` → `packages/pstack-devin/.apm/skills/setup-pstack-devin/` (SKILL.md + scripts/ verbatim).
- [ ] Sync test: byte-equality recursive between the two dirs (`setup-pstack.test.ts` or new `apm-sync.test.ts`).
- [ ] `packages/pstack-devin/docs/devin-adapter-decisions.md` append §8: setup-pstack decisions (script-vs-instruction rationale = issue's unit-test requirement; ro honesty rule; `# pstack-generated:` marker scheme; `.apm` duplication + sync).
- [ ] README EN/JA: setup-pstack section — `/pstack:setup-pstack` → `setup-pstack-devin` delegation, generated artifacts (`~/.devin/rules/pstack-models.md` + `~/.config/devin/agents/pstack-*.md`), session-start load + cloud caveat.
- [ ] Commit `feat(pstack-devin): ship setup-pstack-devin via APM primitives`.

### Task 4: rebuild + sweep + issue comment

- [ ] `pnpm --dir scripts/pstack-devin run build` → expected diffs ONLY: `skills/setup-pstack/SKILL.md` (now actually overwritten — allowlist entry consumed, unused-warning gone), new `skills/setup-pstack-devin/` files, `provenance.json` (overwrites + additions).
- [ ] `check-generated` PASS after commit (ordering per #214 note).
- [ ] `test` + `lint:md` + `audit:compat` green (new skill files scanned — Devin-side names must not produce unknowns; if they do, add `devin-tool:*` vocab rows).
- [ ] Post `#215` completion comment.

## Self-Review

- **Spec coverage**: `.apm` skill + delegation entry (Tasks 2,3); `devin models list` + fusion drop + no undetected slugs (Task 1 parseModels/applyBudget + Task 2 step 1); roles/panels/budget preserved + new-role error (roles.json + schema test); `~/.devin/rules` + `~/.config/devin/agents` + Windows detection (setup.mjs path resolution + VERIFY); ro/write separation + honest labeling (profileFile ro + contract test); byte-stable re-run + diff + remove-candidates (planChanges); profile-load-at-start/cloud/fusion/fail-closed docs (SKILL.md step 5); no cursor/claude writes (contract test); unit tests (Task 1); upstream-name collision (delegation keeps `/pstack:setup-pstack`).
- **Consistency**: `setup.mjs` exports match test imports; `roles.json` key `key` matches upstream labels verbatim (commas inside labels are literal); `# defaults: 2` ↔ `roles.json schema: 2`.
- **Placeholders**: none — VERIFY item has named doc pages; upstream fixture extraction has exact source.
