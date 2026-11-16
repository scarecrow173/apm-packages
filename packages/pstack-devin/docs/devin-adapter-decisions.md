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

Run 2026-11-17 against the pinned upstream tree (`upstream.commit` in
`upstream.yml`): **546 files scanned, 547 findings, 0 unknowns.** A finding is
one vocabulary-pattern match on one line, so labels share lines and the count
is findings, not files.

| `cls` | findings | Meaning |
| --- | --- | --- |
| `supported` | 278 | maps to a real Devin tool/param |
| `alternative` | 97 | mapped to a documented workaround |
| `skip` | 66 | intentionally not performed; must be said aloud |
| `error` | 18 | required by the workflow but impossible on Devin — stop, don't pretend |
| `unavailable-external` | 26 | external skill not installable on Devin (`cursor-team-kit`) |
| `devin-only` | 62 | `claude-code.md` adapter content + prose identifiers — never adapted |
| **total** | **547** | 0 unknowns |

Per-label counts (from the same run) — `supported`:
`tool:Task` 123, `value:claude-slug` 34, `value:inherit-parent` 19,
`field:resume` 16, `field:subagent_type` 13, `field:readonly` 11,
`tool:Grep` 10, `value:generalPurpose` 8, `tool:Glob` 8, `tool:AskQuestion` 7,
`tool:Bash` 7, `name:pstack-prefix` 6, `tool:Read` 4,
`field:run_in_background` 4, `tool:Shell` 3, `field:environment:local` 2,
`path:agents-md` 2, `tool:TodoWrite` 1.

`alternative`: `path:.cursor` 27, `feature:mcp` 24, `feature:bugbot` 23,
`value:gemini-slug` 12, `feature:plugin-install` 5,
`field:cloud_base_branch` 2, `path:.cursor-plugin` 2,
`field:file_attachments` 1, `field:is_background` 1.

`skip`: `feature:automations` 36, `feature:loop` 20, `feature:custom-mode` 8,
`feature:cursor-api` 2.

`error`: `feature:cloud-agent` 12, `field:environment:cloud` 4,
`feature:sendtouser` 2.

`unavailable-external`: `extskill:deslop` 10, `extskill:control-cli` 8,
`extskill:control-ui` 8.

`devin-only`: `prose:no-deadlock` 30, `devin-only:claude-adapter` 21,
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
