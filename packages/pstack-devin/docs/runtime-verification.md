# Runtime verification — real `devin` CLI harness + evidence log (issue `#218`)

Reproduction contract: every recorded command below was run on the
recorded date and platform against the real `devin` CLI inside the
throwaway fixture described under [Harness](#harness). Re-run blocks
verbatim to reproduce; divergence means `devin` CLI behavior drifted and
this log must be re-verified — never blanket-passed.

## 1. Environment

- date: 2026-11-17
- platform: windows, git-bash
- worktree: `.worktrees/pstack-devin-218` (branch `feat/pstack-devin-issue-218`)
- devin: `devin 3000.12.57 (96542e930752)`
- resolved chat model during probes: `swe-2-flash-high`
  ("SWE-2 Flash High"); selectable via `-m/--model`
- plugin under test: `packages/pstack-devin/devin-plugin` installed
  `--local` as `pstack v0.1.0`

## Harness

This section is the reusable invocation pattern for every per-skill probe
in this log. Probes are optional manual runs (`probe:*` scripts) — they
are NOT part of `verify`/`pnpm test`.

### Fixture — throwaway consumer repo

```bash
pnpm --dir scripts/pstack-devin run probe:fixture
# equivalent: node scripts/pstack-devin/scripts/make-fixture.mjs [dir]
```

Creates/recreates `scripts/pstack-devin/fixtures/smoke-repo/`:
`package.json`, `AGENTS.md`, `README.md`, `src/index.js`, `src/util.js`,
then `git init -b main` + one baseline commit (`fixture baseline`, author
`pstack-devin-probe`). `scripts/pstack-devin/.gitignore` ignores
`/fixtures/` — it is never distributed or committed. The baseline commit
exists so probes can diff `git status` before/after a run.

### Plugin install

```bash
devin plugins install "G:/repositry/apm-packages/.worktrees/pstack-devin-218/packages/pstack-devin/devin-plugin" --local -y
devin plugins list        # -> • pstack v0.1.0
devin plugins info pstack # -> all /pstack:* skills + "rule: AGENTS.md (always on)"
```

Full verbatim install output is already recorded in
`distribution-verification.md` §3 (issue `#217`); this run reproduced it
identically.

### Working invocation — print mode

```bash
cd scripts/pstack-devin/fixtures/smoke-repo
devin -p "/pstack:poteto-help" --respect-workspace-trust false
```

- Exit code 0; final agent message goes to stdout.
- `/pstack:<skill>` slash syntax DOES resolve in `-p` mode: the skill body
  is injected into the session as a `role: "user"` message (verified in
  `message_nodes`, see below). No `--prompt-file` or stdin fallback was
  needed.
- `--respect-workspace-trust false` is required: print mode cannot show
  the trust prompt and fails in an untrusted directory.
- Add `--export ./probe-transcript.json` to also write an ATIF-v1.7
  transcript file (refreshed after each turn).
- `--permission-mode` defaults to `auto` (read-only tools auto-approved).
  Mutating probes may need `--permission-mode accept-edits`.
- Sessions are keyed to the cwd: run each probe in the fixture dir so
  `devin list` and `sessions.db` queries find it.

### Session + transcript locations

| What | Where |
| --- | --- |
| Session ids/titles | `devin list --format json` in the probe cwd (default output is an interactive TUI — always pass `--format json` in scripts) |
| Full message store | `%APPDATA%\devin\cli\sessions.db` (SQLite, WAL) |
| Per-run transcript file | `--export <path>` argument (ATIF-v1.7 JSON) |
| Per-process CLI log | `%APPDATA%\devin\cli\logs\devin_<yyyymmdd>-<hhmmss>_<pid>.log` (newest plain text, older rotated to `.log.gz`) |
| `transcripts/<name>.json` | interactive sessions only — print-mode sessions do NOT create one; they persist in `sessions.db` |

Caution: `sessions.db` on this machine is ~29 GiB. Always filter by
`session_id`; never full-scan.

### Subagent / model extraction

Session id first, then evidence rows:

```bash
cd fixtures/smoke-repo
devin list --format json          # -> [{"id":"foul-gauge","title":"...",...}]
```

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.env.APPDATA+'/devin/cli/sessions.db',{readOnly:true});
console.log(db.prepare(\"SELECT id,model,title FROM sessions WHERE id='foul-gauge'\").all());
console.log('subagents:',db.prepare(\"SELECT agent_id FROM subagent_heads WHERE session_id='foul-gauge'\").all());
"
```

- `sessions.model` → chat model (`swe-2-flash-high`).
- `subagent_heads` → one row per spawned subagent (`agent_id` is the
  profile, e.g. `pstack:poteto-agent`; `chain_node_id` links into
  `message_nodes`). Empty set = zero subagents.
- `message_nodes.chat_message` → JSON messages incl. tool calls and tool
  results; per-message `metadata` carries token counts.
- In an `--export` file: `agent.model_name`/`agent.version` at top level,
  per-step `model_name`, `tool_calls[].function_name` (subagent spawns
  appear as `run_subagent`), `final_metrics` for token totals.
- In per-process logs: `resolved_model=SWE-2 Flash resolved_model_uid=swe-2-flash-high Model resolution complete`.

### Cleanup

```bash
devin plugins remove pstack --local    # scope must match the --local install
rm -rf scripts/pstack-devin/fixtures   # or regenerate via probe:fixture
```

## 2. Probe evidence — `/pstack:poteto-help` (2026-11-17)

### Run A — bare skill invocation

Input (cwd = fixture):

```bash
devin -p "/pstack:poteto-help" --respect-workspace-trust false
```

stdout verbatim, exit 0:

```text
Ready when you are — tell me what you want to know about pstack (setup, picking a skill, how `/poteto-mode` works, or fixing a run that went wrong) and I'll point you at the right file with a prompt you can send.
```

Session `just-fighter`, title `Get help for the pstack command`, model
`swe-2-flash-high`, `subagent_heads`: 0 rows (no subagents — correct for
poteto-help).

Transcript internals from `message_nodes` (verbatim `chat_message`
excerpts):

- Skill expansion confirmed: `role: "user"` node whose content begins
  `# Poteto help\n\nIn Claude Code, read [the Claude Code adapter]...` —
  the SKILL.md body verbatim.
- Assistant issued `ask_user_question` with the skill's 5-option menu →
  tool result: `Tool 'ask_user_question' validation failed: Question 1
  must have 2-4 options, got 5.` → retried → tool result:
  `Tool execution was rejected: User canceled the question` (print mode
  auto-cancels questions) → final text answer above.
- System context included plugin agent profiles:
  `Available subagent profiles for the run_subagent tool ... pstack:comment-sicko ... pstack:poteto-agent`.

### Run B — skill + question, with `--export`

Input (cwd = fixture):

```bash
devin -p "/pstack:poteto-help What is /poteto-mode?" --respect-workspace-trust false --export ./probe-transcript.json
```

stdout verbatim excerpt, exit 0 (session `foul-gauge`, 15 steps,
`final_metrics.total_prompt_tokens` 145625):

```text
`/poteto-mode` is pstack's main skill and the default way to start real work. On Devin it's typed `/pstack:poteto-mode`. You give it a goal and a check that can pass or fail. It matches the task to a playbook (bug fix, feature, investigation, babysit a PR, ship a stack, and more), copies that playbook's steps into the todo list verbatim, and runs the other pstack skills the steps need. Steps it skips stay in the list marked `skip: <reason>`.

Don't list skills in your prompt. A hand-written sequence tends to drop or reorder steps the playbook would keep. Name a skill directly only when you want more or less rigor than the playbook gives.

One Devin caveat. Cursor's Custom Mode keeps the skill attached every turn, but Custom Modes are Cursor-only and skipped on Devin. So start each new task with `/pstack:poteto-mode` at the front of the prompt.

Example, adapted from the recipes file:

    /pstack:poteto-mode <symptom>. repro first, then fix and verify.

Sources:

- `skills/poteto-mode/SKILL.md`: https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/SKILL.md
- `skills/poteto-help/references/prompting.md`: https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-help/references/prompting.md
- `skills/poteto-help/references/recipes.md`: https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-help/references/recipes.md
- Guide page 2: https://github.com/cursor/plugins/blob/main/pstack/docs/guide/02-poteto-mode.md
```

Export transcript (`probe-transcript.json`, ATIF-v1.7) evidence:

- `agent`: `{"name":"devin","version":"3000.12.57","model_name":"SWE-2 Flash High"}`.
- The model globbed/read the INSTALLED plugin under the plugin cache
  (`find_file_by_name` on
  `%APPDATA%\devin\cli\plugins\cache\G__repositry_..._devin-plugin-adb7f065\0.1.0\skills\**\SKILL.md`
  and `docs/harness/*.md`), i.e. it followed `docs/harness/devin.md` —
  consistent with the "Custom Modes are Cursor-only and skipped on
  Devin" caveat and the `/pstack:` prefix in the answer.
- Skill behavior matched `poteto-help`'s contract: routed to the owning
  files, handed back a sendable prompt, linked public GitHub copies.

Verdict for `/pstack:poteto-help` in print mode: **pass** (skill
resolves, body loads, routing + file reads + reply format all observed;
0 subagents as expected).

## 3. Deviations observed

1. `ask_user_question` accepts 2-4 options per question; poteto-help's
   menu has 5 → the first call failed validation, the model retried
   successfully. Adapter-relevant when evaluating question flows.
2. Print mode auto-cancels `ask_user_question` (`User canceled the
   question`). Runs never block on questions, but question-gated flows
   exercise only the fallback path in `-p`.
3. A globally configured MCP server auto-creates `.serena/` inside any
   workspace, and `--export` writes its file into the cwd — `git status`
   in the fixture is NOT clean even on read-only probes. Read-only
   assertions must diff tracked files or pre-clean these artifacts.
4. `devin list` defaults to an interactive TUI; scripted extraction
   requires `--format json` (or `--format csv`).
5. Print-mode sessions create no `transcripts/<name>.json`; session
   evidence lives in `sessions.db` (+ `--export` file when requested).
