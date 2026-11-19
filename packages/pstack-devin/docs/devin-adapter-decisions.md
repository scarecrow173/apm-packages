# Devin adapter decisions — `docs/harness/devin.md` (issue `#214`)

Maintainer-facing record of the Cursor-to-Devin mapping decisions behind
`overlay/docs/harness/devin.md`. The adapter doc itself is the agent-facing
contract; this file records why each class of mapping was chosen and how to
regenerate the audit evidence.

## 1. Audit counts

Regenerate with:

```bash
pnpm --dir scripts/pstack-devin exec tsx src/compat-audit.ts
```

Run 2026-11-17 against the generated `devin-plugin/` tree at the pinned
upstream commit (`upstream.commit` in `upstream.yml`): **547 files scanned,
610 findings, 0 unknowns.** The scanner covers the 546 upstream files plus
the generated `docs/harness/devin.md` itself (it skips only
`.devin-plugin/`, `AGENTS.md`, and `provenance.json`); the adapter doc's own
Cursor-side token mentions classify against the same vocabulary, and its
Devin-side names are lowercase `snake_case` that the API-shaped unknowns
pass intentionally never flags. The pre-overlay run (before `devin.md` and
the `poteto-agent` overwrite landed) scanned 546 files with 547 findings —
the delta is entirely the adapter doc's own classified tokens plus the
overwrite removing upstream's `is_background`/`generalPurpose`/`~/.cursor`
references. A finding is one vocabulary-pattern match on one line, so
labels share lines and the count is findings, not files.

| `cls` | findings | Meaning |
| --- | --- | --- |
| `supported` | 310 | maps to a real Devin tool/param |
| `alternative` | 108 | mapped to a documented workaround |
| `skip` | 73 | intentionally not performed; must be said aloud |
| `error` | 24 | required by the workflow but impossible on Devin — stop, don't pretend |
| `unavailable-external` | 29 | external skill not installable on Devin (`cursor-team-kit`) |
| `devin-only` | 66 | `claude-code.md` adapter content + prose identifiers — never adapted |
| **total** | **610** | 0 unknowns |

Per-label counts (from the same run) — `supported`:
`tool:Task` 125, `value:claude-slug` 35, `value:inherit-parent` 23,
`field:resume` 17, `field:subagent_type` 15, `field:readonly` 13,
`name:pstack-prefix` 13, `tool:Grep` 11, `tool:Glob` 10, `tool:Bash` 9,
`tool:AskQuestion` 8, `value:generalPurpose` 8, `tool:Read` 5,
`field:run_in_background` 5, `tool:Shell` 4, `path:agents-md` 4,
`field:environment:local` 3, `tool:TodoWrite` 2.

`alternative`: `path:.cursor` 30, `feature:mcp` 25, `feature:bugbot` 25,
`value:gemini-slug` 13, `feature:plugin-install` 6,
`field:cloud_base_branch` 3, `path:.cursor-plugin` 3,
`field:file_attachments` 2, `field:is_background` 1.

`skip`: `feature:automations` 39, `feature:loop` 21, `feature:custom-mode` 10,
`feature:cursor-api` 3.

`error`: `feature:cloud-agent` 15, `field:environment:cloud` 6,
`feature:sendtouser` 3.

`unavailable-external`: `extskill:deslop` 11, `extskill:control-cli` 9,
`extskill:control-ui` 9.

`devin-only`: `prose:no-deadlock` 30, `devin-only:claude-adapter` 25,
`tool:Agent` 2, `value:general-purpose` 2, `prose:return-type` 2,
`tool:Skill` 1, `value:Explore` 1, `prose:branded-ids` 1,
`prose:derived-data` 1, `prose:pele-error` 1.

## 2. Per-row classification rationale

### `supported` — maps to a real Devin tool/param

- `Task` → `run_subagent`; `AskQuestion` → `ask_user_question`;
  `TodoWrite` → `todo_write`; `Grep`/`Glob` → `grep`/`find_file_by_name`/
  `exec rg`; `Bash`/`Shell` → `exec`; `` `Read` `` → `read`. Devin exposes all
  of these as first-class tools.
- `subagent_type: generalPurpose` → `profile: "subagent_general"`;
  `poteto-agent`/`comment-sicko` → `profile: "pstack:<name>"`. Custom plugin
  profiles namespace as `pstack:` on Devin, matching the `/pstack:` skill
  prefix, so upstream's namespacing survives (`name:pstack-prefix`).
- `readonly: true` → `profile: "subagent_explore"` — a hard read-only
  built-in (web search but no arbitrary URL fetch, no edit tools), strictly
  stronger than Claude's `Explore`, which retained `Bash`. `readonly: false`
  → `subagent_general`.
- `run_in_background` → `is_background` and `resume` → `resume` are
  `run_subagent` runtime params, not profile fields.
- `environment: "local"` → omit; local is the default and the only place
  plugin subagents run.
- `claude-*` slugs → `model:` on the spawning custom profile or
  `inherit-parent`; `auto`/`inherit-parent` → omit `model`. `run_subagent`
  takes no `model` param, so model diversity is expressed through
  `model:`-pinned profiles under `~/.config/devin/agents/`.
- `AGENTS.md` is read natively by Devin — no mapping needed.

### `alternative` — documented workaround

- `file_attachments` → list paths inline in the task brief;
  `cloud_base_branch` → instruct the worker to check out the branch first.
- `is_background` in `agents/poteto-agent.md` frontmatter is not a Devin
  profile field — the `#214` Task 3 overwrite moves background intent to the
  `run_subagent` `is_background` param.
- `.cursor` paths map per the Paths table (`~/.config/devin/cli/plugins/` or
  `%APPDATA%\devin\cli\plugins\`, `.devin-plugin/plugin.json`,
  `~/.devin/rules/`, `.devin/skills/`).
- Bugbot PR comments are ordinary review threads → triage via the forge
  command; skip setup/wait when no Bugbot check exists.
- MCP references → environment-dependent; the parent performs the lookup or
  the step says so.
- Cursor/Claude plugin CLI (`/add-plugin`, `/plugin marketplace`,
  `claude plugin update`) → `devin plugins install owner/repo#sub/dir`.
- Non-Devin model slugs (`gemini-*`) → omit `model` → session model; say so.

### `skip` — intentionally not performed, said aloud

- Cursor Automations (`update_state` routine calls, routine wakeups,
  `api2.cursor.sh` webhooks), Cursor custom modes, `/loop`. No Devin
  equivalent exists; the adapter emits a `Skipped on Devin: <step>. <reason>.`
  line and continues.

### `error` — required by the workflow, impossible on Devin

- `environment: "cloud"` — plugin subagents load in local Devin agents only
  (the CLI and Devin Desktop), not in cloud Devin sessions, so no cloud run
  can load a `pstack:*` profile. Stop and report; never silently substitute a
  local run.
- Cursor cloud agents/dashboard/VM — `error` when the workflow requires the
  cloud resource itself; `skip`-with-line when optional.
- `SendToUser` secret requests — secrets must never transit the agent;
  refuse outright.

### `unavailable-external` — cursor-team-kit

See §3.

### `devin-only` — not adapted

`docs/harness/claude-code.md` content (`.claude-plugin`, `CLAUDE.md`,
`AskUserQuestion`, `isolation: "worktree"`, `general-purpose`, `Explore`,
`Agent`, `Skill`, `pstack-models.md`) is the Claude adapter's target, not
Devin-facing. Backticked CamelCase prose identifiers (`NoDeadlock`,
`ReturnType`, `PeleError`, `UserId`/`OrderId`, `DerivedData`) are domain
names, not harness APIs.

## 3. External dependency decision — `deslop`, `control-cli`, `control-ui`

All three ship in `cursor-team-kit` (same `cursor/plugins` repo, a
`.cursor-plugin/` manifest only), so the kit is **not installable as a Devin
plugin**. Options considered:

- **Bundle the skills into pstack-devin's overlay.** `cursor-team-kit` is
  MIT-licensed, so bundling is legally permitted. **Rejected**: it duplicates
  upstream content into the overlay (breaking the no-fork / no-duplication
  boundary), and a bundled `deslop` would collide by name if
  `cursor-team-kit` ever ships Devin support.
- **`unavailable-external` + documented fallback** (chosen). The adapter
  instructs the agent to perform the equivalent pass in plain words — for
  `deslop`: remove narrating comments, unsupported guards, dead compatibility
  paths, and unrelated edits (the fallback upstream itself documents); for
  `control-cli`/`control-ui`: drive the check with `exec` or hand it to the
  user — and to say the skill was substituted.

**Revised (2026-11):** `apm.yml` now declares all three as `dependencies:`
entries — `cursor/plugins/cursor-team-kit/skills/<name>#<upstream.commit>`
— which APM resolves as virtual `claude_skill` packages deploying to target
skill dirs on every declared target, including `.agents/skills/` (Devin
reads it). APM consumers therefore get the real skills; the fallback and
the no-bundling decision still stand for the `devin plugins install`
route, which cannot express dependencies. Verified by a scratch-consumer
`apm install`: `is_virtual: true`, `package_type: claude_skill`, deployed
to `.agents/skills/deslop` + `.claude/skills/deslop`.

## 4. `pstack` plugin-name collision

`devin plugins install cursor/plugins#harness/pstack/claude-code` installs
upstream pstack **directly** — its root `plugin.json` is an Agent Plugins
manifest. Both upstream-direct and this package claim the `pstack` plugin
name. Install only one; the `/pstack:` prefix belongs to whichever is
installed. (When multiple manifest layouts coexist, Devin prefers
`.devin-plugin/plugin.json` > `.claude-plugin/plugin.json` > root
`plugin.json` — our package ships `.devin-plugin/`, so it wins inside our own
tree, but two installed `pstack` plugins still collide at the command level.)

## 5. Precedence rationale

`docs/harness/devin.md` is the adapter of record on Devin and wins over
`docs/harness/claude-code.md` wherever they disagree. Scope: the claim covers
the **pstack adapter files**, not Devin's import behavior — Devin does read
`~/.claude/CLAUDE.md` as a global import and tolerates `.claude/` dirs as
compatible imports, but those contain no Cursor-name mappings for pstack
skills, so nothing in them can serve as the Devin adapter.

## 6. VERIFY resolutions (2026-11-17 — docs.devin.ai + local `devin 3000.12.57`)

- **(a) Global rules dir**: `~/.devin/rules/*.md` and
  `~/.devin/global_rules.md` are the Devin-native per-user locations;
  project-level is `.devin/rules/*.md`. `trigger` frontmatter values
  `always_on`, `manual`, `model_decision`, `agent`, `glob` are valid, so
  `~/.cursor/rules/pstack-models.mdc` → `~/.devin/rules/pstack-models.md`
  with `trigger: always_on`.
- **(b) Plugin install dir**: not documented; verified empirically —
  `%APPDATA%\devin\cli\plugins\` exists on Windows. Linux/macOS by
  config-root convention is `~/.config/devin/cli/plugins/`; the doc's
  fallback search also lists `~/.local/share/devin/cli/plugins/` so the
  search survives either layout. A dedicated global skills dir stays
  `[unverified]` — global config lives under the `~/.devin` home root.
- **(c) Windows config dir**: `%APPDATA%\devin\` — confirmed.
- **(d) `devin models list`**: confirmed on `devin 3000.12.57` — prints 51
  model families with real slugs (`swe-2-max`, `swe-2-high`, `adaptive`, …).
  setup-pstack (`#215`) uses it as the detected set.
- **(e) `trigger: always_on`**: confirmed valid Devin rule frontmatter.

Additional verified facts baked into the tables: `run_subagent` params
`task`/`profile`/`is_background`/`resume`/`title`; custom profile frontmatter
`name`/`description`/`model`/`allowed-tools`(alias `tools`)/`max-nesting`;
built-ins `subagent_explore` (read-only) and `subagent_general` (inherits
parent model); `ask_user_question` withheld from subagents;
`subagents_enabled: false` or org "None" removes `run_subagent`/`read_subagent`
entirely; plugin subagents load locally only, which is why
`environment: "cloud"` is `error`.

## 7. Agent-profile overwrite decisions

- `agents/poteto-agent.md` — **overwritten** (`overlay/agents/poteto-agent.md`,
  allowlisted in `overlay.yml`). The file is machine-parsed profile
  frontmatter plus a delegate contract: upstream carries `is_background`
  (not a Devin profile field — background is a `run_subagent` runtime param)
  and body references to `generalPurpose`, `~/.cursor/plugins/`, and
  `.cursor-plugin/plugin.json`. Instruction-level adaptation cannot fix a
  parsed field, so the overwrite ships `max-nesting: 3` (the prior-art port
  value), `subagent_general`, `/pstack:poteto-mode`, the Devin plugins
  directory paths, and `.devin-plugin/plugin.json`, preserving the
  full-`SKILL.md`-read contract, the highest-version multi-match rule, the
  "stop and tell your parent" failure mode, and `principle-*` navigation
  verbatim.
  - Re-reviewed at the `b4a4f61` re-pin (`#219` first run): upstream added
    `model: claude-opus-5-5-xhigh-fast` to the frontmatter — poteto-mode's
    Subagents section now reads "spawn `generalPurpose`, because
    `poteto-agent` defaults to Opus 5.5". `model:` is a real Devin
    profile field and the slug is a `value:claude-slug` vocabulary row,
    so the overwrite carries the pin verbatim. Without it a
    `pstack:poteto-agent` spawn would inherit the parent model — the
    `subagent_general` behavior upstream reserves for alias roles —
    silently diverging from upstream's delegate default.
- `agents/comment-sicko.md` — **stays byte-identical** (no overwrite, no
  allowlist entry). A full read shows pure persona prose: zero Cursor or
  harness references — no `~/.cursor` paths, no `Task`/`subagent_type`
  fields, no `generalPurpose`. Its `name`/`description` frontmatter is
  already valid Devin as-is, and its `/why` mention resolves through the
  generic skill-invocation row in `devin.md`. Adding it to
  `allow_overwrite` would only warn as an unused entry.

## 8. setup-pstack decisions — `setup-pstack-devin` (issue `#215`)

Upstream `skills/setup-pstack/SKILL.md` is instruction-level: the agent does
model detection, budget arithmetic, and file writes itself. The Devin port
splits into a thin delegation overwrite at `skills/setup-pstack/SKILL.md`
(upstream frontmatter preserved, body delegates to `setup-pstack-devin`) and
a new `skills/setup-pstack-devin/` skill — orchestration prose plus a
deterministic `scripts/setup.mjs` generator driven by
`scripts/roles.json`. Decisions:

- **Script over pure instructions.** The issue requires unit tests for
  mapping, budget, fan-out, and re-run behavior — real logic tests, not
  content greps. Instruction-level arithmetic cannot be unit-tested, so
  `setup.mjs` owns every computation and file emission as exported,
  dependency-free Node ESM; the skill's prose owns only the
  detect → confirm → apply UX. Tests import the `.mjs` from the overlay
  path directly.
- **9 roles at schema 3** (was 13 at schema 2). `roles.json` mirrors
  upstream step 5's `# defaults:` block verbatim — role keys keep their
  literal commas — and pins its sha256 as `defaults_sha`, so an upstream
  role/schema change fails the schema test loudly instead of drifting
  silently. The `b4a4f61` re-pin moved upstream to `# defaults: 3`:
  four roles retired (`hardest tasks`, `reflect tooling`,
  `reflect judgment, divergent, synthesizer`, `architect runners`),
  Opus defaults moved to their `-fast` slugs, and `arena cross-judge
  pool` shrank to two entries (upstream dropped the Fable seat — Fable
  and Opus are one vendor). Three of the retired keys stayed backticked
  only inside upstream's own `setup-pstack/SKILL.md` (its retired-role
  examples), which the delegation stub replaces — so in the generated
  tree all four are dead registry entries and all four were dropped.
- **Fallback family = the role default's family, per position.** When a
  budget-moved effort rewrite lands on an undetected slug, the detected
  substitute is the highest-effort slug at or below the target within
  the *role default's* family — not the configured slug's family. For
  panel roles this resolves per list position (position `i` falls back
  within `default[i]`'s family), keeping fan-out width: one subagent
  per entry, never collapsed.
- **`needsChoice` covers configured roles only.** Roles absent from the
  choices file keep their documented defaults and produce no
  `resolved`/`needsChoice` entry. A substitution and an empty fallback
  pool both flag for confirmation; a keep that lands on the unchanged
  input (upstream's "gemini tops out at high" case) does not.
- **Schema-3 arithmetic (`b4a4f61` re-pin).** Upstream dropped the
  `unlimited` budget tier (`+1`) — the three labels are now
  `large`/`medium`/`small`, and a stored `# budget: unlimited` is read
  as `large` at load time (the skill's step 2 says so; the script only
  accepts the three labels). `max` stays in the effort ladder so a
  stored `*-max` slug still ranks and gets rewritten down, but no
  budget targets it. The choices gate (`assertWritable`, née
  `assertDetected`) also enforces upstream's new write rule — every
  real slug must be in the detected set AND at `xhigh` or below — so
  the generator can never emit a rule upstream calls invalid.
- **`rulesFile` emits only configured lines.** One `role: slug[, slug…]`
  line per configured role in `roles.json` order — upstream's exact line
  format so consumer-skill reads through the `#214` path mapping keep
  working — under Devin `trigger: always_on` frontmatter. Combined with
  `assertDetected` failing closed on any choice outside the detected set
  (aliases `inherit-parent`/`auto` excepted), a generated rule can never
  carry an undetected slug.
- **`# pstack-generated:` marker + diskSha stale-refusal.** Every
  generated file ends with a marker line carrying the sha256 of its own
  body, which `planChanges` uses to tell own prior output (unflagged
  `diff`) from user edits (`userModified: true`). Each `diff` also
  records `diskSha` — the on-disk sha at plan time — so `apply` refuses
  a plan whose targets drifted after the diff was shown, even with
  `--yes`. Re-runs over own output are byte-stable `unchanged`; obsolete
  `pstack-*.md` profiles surface as `removeCandidates`, deleted only via
  explicit `--remove`.
- **ro profile = declared intent, not a guarantee.** `pstack-<slug>-ro`
  restricts `allowed-tools` to the doc-verified read set (`read`,
  `grep`, `glob` — the docs.devin.ai/cli/subagents.md example tokens)
  and states the residual risk in the body; the hard read-only
  guarantee stays `subagent_explore`. The profile never claims
  "完全read-only"/"fully read-only" because `allowed-tools` expresses
  intent a model could still violate.
- **`.apm/` duplicates the overlay skill on purpose.** APM deploys
  `.apm/` primitives independently of the generated `devin-plugin/`
  tree, so `.apm/skills/setup-pstack-devin/` ships the same three files
  byte-for-byte. `overlay/` is the edit authority; the `apm-sync` test
  enforces recursive sha256 equality and names the divergent file, so
  the copy cannot silently rot.
