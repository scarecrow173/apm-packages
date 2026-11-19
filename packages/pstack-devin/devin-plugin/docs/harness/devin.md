# pstack in Devin

pstack skills use Cursor names. In Devin, read this file once per session, then map each Cursor name in a skill with the tables below. `<pstack>` means the folder that holds `skills/` and `docs/`. If a Cursor field has no row, drop it and say so. Never pass a field or value the tool schema rejects.

When running on Devin, this file is the adapter of record. Where docs/harness/claude-code.md and this file disagree, this file wins — Devin never reads .claude paths or CLAUDE.md. (Devin still imports `~/.claude/CLAUDE.md` as a global instructions file; that import is not a pstack adapter and carries no Cursor-name mappings.)

Do not run pstack skills, spawn pstack subagents, or apply these mappings unless the user invoked a pstack skill or /pstack:<name> command.

## Tools

| Cursor | Devin |
| --- | --- |
| `Task` | `run_subagent` |
| `AskQuestion` | `ask_user_question` — parent only; Devin withholds it from subagents, so a subagent that needs an answer returns the question text to the parent instead. |
| `TodoWrite` | `todo_write` |
| `Grep`, `Glob` | `grep`, `find_file_by_name`, or `exec` with `rg` |
| `Bash`, `Shell` | `exec` |
| `Read` | `read` |
| Run another pstack skill (`/name` or "the **name** skill") | Invoke it with the `skill` tool when it is cataloged. Otherwise `read` `<pstack>/skills/<name>/SKILL.md` and follow it. When you tell the user to type it, write `/pstack:<name>` — the `/pstack:` prefix (`pstack-prefix`) namespaces every pstack skill and `pstack:<agent>` profile on Devin. |
| MCP server lookups | MCP availability is environment-dependent on Devin. When a step needs one and none is connected, the parent performs the lookup itself or skips the step with a line — say which (alternative). |

If `run_subagent` is absent — `subagents_enabled: false` in config, or org policy sets subagents to None — pstack delegation cannot run. Say so; never emulate a subagent with a plain reply.

## Subagent fields

Cursor `Task` fields map onto `run_subagent` params or the spawned profile.

| Cursor | Devin |
| --- | --- |
| `subagent_type: generalPurpose` | `profile: "subagent_general"`. It inherits the parent model unless the profile's `model` or `agent.subagent_model` config says otherwise. |
| `subagent_type: poteto-agent`, `subagent_type: comment-sicko` | `profile: "pstack:poteto-agent"`, `profile: "pstack:comment-sicko"` |
| `readonly: true` | `profile: "subagent_explore"`. It is a hard read-only — stronger than Claude's Explore, which kept `Bash`. It has web search but no arbitrary URL fetch and no edit tools. |
| `readonly: false` | `profile: "subagent_general"` |
| `run_in_background: true` | `is_background: true` — a `run_subagent` runtime param. `is_background` is not a Devin profile frontmatter field; never write it into `agents/*.md`. |
| `resume` | `resume` param — pass the previous `agent_id`. |
| `environment: "local"` | Omit — local is the default and the only place plugin subagents run. |
| `environment: "cloud"` | ERROR. Plugin subagents load in local Devin agents only — the CLI and Devin Desktop — not in cloud Devin sessions, so no cloud run can load a `pstack:*` profile. Stop and report; never silently substitute a local run when the workflow requires cloud isolation. |
| `cloud_base_branch: <b>` | Tell the worker to check out `<b>` first (alternative). |
| `file_attachments` | List the paths in the task brief (alternative). |
| Max depth / nesting | The profile's `max-nesting` frontmatter bounds nested spawns — `pstack:poteto-agent` ships `max-nesting: 3`. |

## Routing

- One hands-on delegate, when the session has `sidekick` (a Fusion plan): use `sidekick` for it.
- Every fan-out — Arena arms, Swarm workers, independent reviewers, poteto-mode delegates: one `run_subagent` per entry, on the profile and model the step names.
- Never reduce the reviewer or arm count, and never collapse distinct models into one, to fit a perceived limit. If a count or model cannot be honored, report it — do not silently shrink it.

## Models

| Cursor | Devin |
| --- | --- |
| `claude-<family>-<version>-<effort>[-fast]`, such as `claude-opus-5-5-xhigh` | `model:` on the spawning custom profile, or `inherit-parent`. Devin slugs come from `devin models list`; `run_subagent` takes no model param, so a model is pinned by the profile you spawn. |
| `gemini-*` or another non-Devin slug | Omit `model` so the subagent runs on the session model, and say so. |
| `auto`, `inherit-parent` | Omit `model` — the subagent inherits the parent model. |
| `fusion-*` as a subagent model slug | Drop it — Fusion is a lead + `sidekick` pair, not a subagent model. See Routing. |
| `~/.cursor/rules/pstack-models.mdc` | `~/.devin/rules/pstack-models.md` with `trigger: always_on` frontmatter. Devin loads each `~/.devin/rules/*.md` rule per its `trigger` frontmatter, and `always_on` puts the role lines in every session's context; if they are not there, `read` the file. Written by setup-pstack — `#215`. |
| Per-role model diversity (arena runners, panels, per-arm models) | `model:`-pinned custom profiles in `agents/` under your Devin config root (`~/.config/devin/` or `%APPDATA%\devin\`) — setup-pstack writes one `pstack-M` profile per detected slug plus a read-only `pstack-M-ro` variant. Spawn `profile: "pstack-M"` so each fan-out entry keeps its own model. |

`agent.subagent_model` in config is the user-level lever that sets the default model for every subagent.

## setup-pstack

Devin loads every `.md` file in `~/.devin/rules/` per its `trigger` frontmatter, so `setup-pstack` writes its rule there with `trigger: always_on`. Follow its steps with these changes:

- Detect. `devin models list` prints the model families and slugs this session can use — that is the detected set. `inherit-parent` and `auto` are always valid aliases.
- Defaults. Map each default slug with the rows above: write a real Devin slug for each role, or `inherit-parent`.
- Write. Write `~/.devin/rules/pstack-models.md` with `trigger: always_on` frontmatter, then the comment lines, the `# budget` line, and one line per role. Overwrite the whole file. Never put the role lines in `~/.devin/global_rules.md` or project `AGENTS.md`.
- Profiles. For each real slug the rule names, write a `model:`-pinned profile in `agents/` under your Devin config root (`~/.config/devin/` or `%APPDATA%\devin\`): a `pstack-M` profile and a read-only `pstack-M-ro` variant with `allowed-tools` restricted. Fan-out steps spawn these profiles so each entry keeps its own model.

## Paths

| Cursor | Devin |
| --- | --- |
| `~/.cursor/plugins/` | The Devin plugins directory under the config root — `~/.config/devin/cli/plugins/` (Linux/macOS) or `%APPDATA%\devin\cli\plugins\` (Windows). When a search finds nothing there, also check `~/.local/share/devin/cli/plugins/` before reporting failure. |
| `.cursor-plugin/plugin.json` | `.devin-plugin/plugin.json`. When several manifests exist, Devin prefers `.devin-plugin/` over `.claude-plugin/` and root `plugin.json`. |
| `.cursor/skills/` | `.devin/skills/` (project). |
| `~/.cursor/skills/` | Global rules and skills live under the `~/.devin` home root — `~/.devin/rules/` is confirmed; a dedicated global skills dir is `[unverified]`, so prefer project `.devin/skills/`. |
| `.cursor/rules/*.mdc`, always-applied rules | `~/.devin/rules/<name>.md` with `trigger` frontmatter (`always_on`, `manual`, `model_decision`, `agent`, `glob`), or the project's `AGENTS.md` (`agents-md`) — Devin reads `AGENTS.md` natively. |
| `https://github.com/cursor/plugins/blob/main/pstack/<path>` | `<pstack>/<path>` when that file exists. The plugin ships the skills, `docs/guide/`, and `README.md`. Read the local copy and never fetch it. Give the user the URL when they need a link. |
| Transcripts in `~/.cursor/projects/<slug>/agent-transcripts/` | Devin keeps session transcripts but has no stable documented path — say so. When a step needs the transcript, report that it cannot be located rather than globbing the home directory. |

## Cursor-only features

Devin has no Cursor Automations, Bugbot, Cursor cloud agents, Cursor custom modes, or Cursor plugin CLI. When a step needs one, put one line in your reply, `Skipped on Devin: <step>. <reason>.`, then go on to the next step. Do not stop, ask, or retry — unless the row is marked ERROR, where you stop and report instead. When a later step needs what a skipped step made, such as a URL or a key, leave a placeholder and name it in the line.

| Cursor | Devin |
| --- | --- |
| Cursor Automations: routines, `update_state` routine calls, routine wakeups | Skip with the line. |
| `api2.cursor.sh` webhooks | Skip with the line — it is the `cursor-api` backend, and nothing on Devin answers it. |
| `SendToUser` secret requests | ERROR — secrets never transit the agent. Refuse; do not relay, store, or type them. |
| Bugbot | Bugbot comments on a GitHub PR are ordinary review threads, so triage them with the forge command the step gives (alternative). Skip a step that starts, waits for, or configures Bugbot when the PR has no Bugbot check or comment. |
| Cursor cloud agents (`cloud-agent`), the cloud dashboard, a cloud VM | ERROR when the workflow requires the cloud resource itself; skip with the line when optional. For `environment: "cloud"` on a spawn, see Subagent fields — always ERROR on Devin. |
| Cursor custom modes (`custom-mode`), `/loop` | Skip with the line. |
| Cursor `plugin-install` commands: `/add-plugin`, `/plugin marketplace`, `claude plugin update` | `devin plugins install owner/repo#sub/dir` installs a Devin plugin from a repo subfolder (alternative). |

## External skills

| Cursor | Devin |
| --- | --- |
| `/deslop`, `control-cli`, `control-ui` (the `cursor-team-kit` plugin) | If a real `deslop`/`control-cli`/`control-ui` skill is available, invoke it — the pstack-devin APM package ships all three as `claude_skill` dependencies into `.agents/skills/` (unavailable-external otherwise). `cursor-team-kit` ships only a `.cursor-plugin/` manifest, so it is not installable as a Devin plugin. Fallback: perform the equivalent pass in plain words and say the skill was substituted. For `deslop`: remove narrating comments, unsupported guards, dead compatibility paths, and unrelated edits. For `control-cli` and `control-ui`: drive the check yourself with `exec`, or hand the verification step to the user. Bundling them into the devin-plugin tree was rejected — see `docs/devin-adapter-decisions.md` in the pstack-devin package. |
