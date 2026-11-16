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

- `sessions.model` → chat model (`swe-2-flash-high`). Stays empty when a
  run is killed before its final persistence pass.
- `subagent_heads` → one row per spawned subagent (`agent_id` is an
  opaque hex id, NOT the profile name; `chain_node_id` links into
  `message_nodes`). The profile is recorded in the `run_subagent` call's
  `arguments.profile` (`pstack:poteto-agent`, `subagent_general`,
  `subagent_explore`). Empty set = zero subagents.
- `--export` writes the transcript only after a completed turn — a
  killed/hung run leaves no export file; use `sessions.db` +
  `message_nodes` for evidence then.
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

## 3. Per-skill results — Task 2 probes (2026-11-17)

All probes ran in the fixture (`scripts/pstack-devin/fixtures/smoke-repo`,
baseline `d86527a`) with the plugin still installed `--local`. Evidence
was extracted per [Harness](#harness); `before-*.json`/`after-*.json`
`devin list` diffs identified each new session. Unless noted otherwise,
`git status`/`git diff` on tracked files stayed clean and all mutating
probes ran on a disposable `probe/*` branch that was deleted after
capture.

| Skill | Session | Model | Subagents (profile) | Verdict |
| --- | --- | --- | --- | --- |
| `/pstack:poteto-help` | `just-fighter`, `foul-gauge` | `swe-2-flash-high` | 0 | pass (§2) |
| `/pstack:setup-pstack` | `blushing-march` | `swe-2-flash-high` | 0 | partial |
| `/pstack:how` | `noble-lamp` | `swe-2-flash-high` | 1 (`subagent_explore`) | pass |
| `/pstack:tdd` | `synonymous-nurse` | blank — killed mid-run | 0 | partial |
| `/pstack:poteto-mode` | `tourmaline-shape` | `swe-2-flash-high` | 1 (`pstack:poteto-agent`) | pass |
| `/pstack:arena` | `learned-canoe` | `swe-2-flash-high` | 4 (3 `subagent_general` + 1 `subagent_explore`) | pass |
| `/pstack:interrogate` | `harmonious-slider` | `swe-2-flash-high` | 3 (`subagent_general`) | pass |
| non-interference control | `bronzed-ocean` | `swe-2-flash-high` | 0 | pass |

### 3.1 `/pstack:setup-pstack` → `setup-pstack-devin`

```bash
devin -p "/pstack:setup-pstack" --respect-workspace-trust false --export ./probe-setup-pstack.json
```

stdout verbatim excerpt, exit 0:

```text
I'll invoke the setup-pstack-devin skill.I'll first read the Devin adapter doc as required, then follow the skill steps.Now following the skill. Step 1: detect available models via `devin models list`.warning: rejected a tool call that requires confirmation. Running in non-interactive mode. Use --permission-mode dangerous to auto-approve all tools.
It looks like `devin models list` can't be run from this session. To continue setup, I need the model slugs you can use.
Please paste either:
- the output of `devin models list`, or
- a bare list of the slugs you'd like pstack roles to use
```

Evidence:

- Export `tool_calls`: `skill` → `{"skill":"setup-pstack-devin"}` (the
  Devin delegation entry resolves through the `skill` tool), `read` of
  the installed `docs/harness/devin.md`, `exec` `devin models list` +
  `which devin; devin --version` — both exec calls auto-rejected in
  non-interactive mode.
- `subagent_heads`: 0 rows (setup runs in the main thread — correct).
- Fallback observed: the skill's documented zero-slugs path ("ask the
  user to paste the slugs… and feed that text through `parse`") fired
  verbatim. In `-p` the paste cannot be answered, so the run ended there.
- No mutation: `~/.devin/rules/` did not exist before or after;
  `%APPDATA%\devin\agents\` and `~/.config/devin/agents/` absent before
  and after — nothing was written without confirmation.

Verdict: **partial** — delegation, adapter read, step-1 attempt, and the
spec-compliant fallback are all verified; the interactive remainder
(budget question, plan/apply) is unreachable in print mode.

### 3.2 `/pstack:how`

```bash
devin -p "/pstack:how how does this repo's entry point work?" --respect-workspace-trust false --export ./probe-how.json
```

stdout verbatim excerpt, exit 0:

```text
I've read the Devin adapter. Per the skill, I'll spawn one read-only explore subagent to explain how the entry point works.## How this repo's entry point works
This is a **fixture repository** — a throwaway consumer used by the parent project (`scripts/pstack-devin`) to run real-CLI probes. Its `package.json` description says so explicitly ("Throwaway consumer fixture for pstack-devin real-CLI probes")…
```

Evidence:

- `subagent_heads`: 1 row (`agent_id c3e082e2`); export shows one
  `run_subagent` call, `profile: "subagent_explore"`, `is_background` not
  set, task = the skill's senior-engineer brief verbatim — the adapter's
  `readonly: true` → `subagent_explore` mapping observed.
- Parent presented the subagent's explanation as its answer (skill step
  2), including correct findings (no `main`/`exports`, `npm test` →
  `node src/index.js`, `src/util.js` unreferenced).
- Read-only assertion: `git diff` empty and `git status --porcelain`
  clean on tracked files (fixture unchanged).

Verdict: **pass**.

### 3.3 `/pstack:tdd`

```bash
git checkout -b probe/tdd
devin -p "/pstack:tdd add a subtract(a,b) util to src/util.js" --respect-workspace-trust false --permission-mode accept-edits --export ./probe-tdd.json
```

stdout verbatim excerpt:

```text
This is a tiny fixture repo with no test framework — `npm test` just runs `node src/index.js`. The narrowest executable check is a direct `node` import assertion. Following the TDD flow:
**1. Failing check first** — verify `subtract` doesn't exist yet:warning: rejected a tool call that requires confirmation. Running in non-interactive mode. Use --permission-mode dangerous to auto-approve all tools.
The command was rejected, so I'll skip the executable check and make the edit directly.
```

Evidence (from `sessions.db`; the run was killed before the export was
written — sessions `model` column stayed blank):

- Tool calls: `exec` `ls -la && find …` (allowed — read-only classified),
  `read` ×2, `exec` `node --input-type=module -e "import { subtract } …"`
  → **rejected** (`Tool execution was rejected: User rejected this tool
  call`), `edit` `src/util.js` → applied under `accept-edits`.
- `subagent_heads`: 0 rows — TDD does not fan out (correct).
- Mutation captured on `probe/tdd` (then deleted): `src/util.js` +4
  lines, `subtract(a,b)` added — the production change landed even
  though the fail-first check could not run.
- After the edit's tool result, the print-mode driver injected a bare
  `role:"user"` `continue` message; the next assistant reply was empty
  (1 token) and the process made no further progress for >9 min
  (log shows only periodic skills-discovery polls) — killed and recorded
  as a hang. Whether the stall is a CLI print-mode edge or a model-side
  issue is undetermined; the skill's steps before it behaved per spec.

Verdict: **partial** — skill resolved, chose the spec's "closest
executable regression check", degraded honestly on the exec rejection,
and applied the edit; the fail-first/rerun loop and final report were
unreachable under print-mode permissions + the observed stall.

### 3.4 `/pstack:poteto-mode`

```bash
git checkout -b probe/poteto
devin -p "/pstack:poteto-mode change greet() to say hi instead of hello and prove it" --respect-workspace-trust false --permission-mode accept-edits --export ./probe-poteto.json
```

stdout verbatim excerpt (final report), exit 0:

```text
**Verification.** I read the real file and ran `git diff -- src/index.js` plus `git diff --check`. The diff is only `- return \`hello ${name}\`;` to `+ return \`hi ${name}\`;`, and `git diff --check` exited 0. I attempted runtime proof with `mise exec -- npm test`, `mise exec -- node src/index.js`, and `node src/index.js`. Each was rejected by the session's non-interactive tool permissions, so I could not capture `hi fixture` from a live run.
**Principles.** `principle-laziness-protocol` kept the diff to one literal … `principle-prove-it-works` made me check the actual file and diff instead of trusting the delegate, and it also blocks claiming runtime proof I did not observe.
```

Evidence:

- `subagent_heads`: 1 row (`agent_id 0834bebc`); one `run_subagent`
  call, `profile: "pstack:poteto-agent"`, `is_background: true`, task
  brief opens with the absolute plugin path of `poteto-mode/SKILL.md`
  and restates the user goal — exactly the skill's delegate contract.
- Non-negotiables observed in the reply: goal restatement ("Your goal
  was to…"), named principles with the decisions they changed, a
  throughput checkpoint, a "Blocked" section listing the rejected
  commands, and honest non-claiming of unobserved runtime proof.
- Fan-out accounting: skill claims "one `run_subagent` per entry" for
  delegates → observed 1 delegate for 1 unit of work. **No `sidekick`/
  Fusion**: session model `swe-2-flash-high` is not a Fusion pair and
  `run_subagent` was used, per the adapter's Routing rule.
- Mutation captured on `probe/poteto` (then deleted): `src/index.js`
  `hello` → `hi`, 1 line; no commit (git mutations rejected).

Verdict: **pass** — delegation profile, principle citation, and verified-
work honesty all confirmed live; only the runtime proof was
permission-blocked and the skill said so.

### 3.5 `/pstack:arena`

```bash
devin -p "/pstack:arena write a one-line README tagline for this repo" --respect-workspace-trust false --permission-mode accept-edits --export ./probe-arena.json
```

stdout verbatim excerpt, exit 0:

```text
**Arena summary**
- **Candidates**: 3 parallel `subagent_general` runners (Cursor model slugs in `pstack-models.mdc` aren't selectable on Devin — `run_subagent` takes profiles, not models; noted as a substitution). No dropouts.
- **Cross-judge**: one read-only `subagent_explore` judge. Vendor check couldn't run (model slugs unreadable/unsettable); parent is SWE-2 anyway, outside the claude/gemini pool.
- **Base**: candidate 1 — verbatim `package.json` description, strongest provenance. Judge agreed (C1/C2 tied at 25, C3 at 22).
```

Evidence:

- `subagent_heads`: 4 rows (`38729299`, `4087a10c`, `724cc117`,
  `a2020cfe`); 4 `run_subagent` calls — 3 × `subagent_general`
  `is_background: true` candidates + 1 × `subagent_explore` judge —
  matching the claimed fan-out (N=3 runners + 1 judge). No `sidekick`/
  Fusion present; all agents on the session model.
- Full phase flow observed in output: Frame (artifact + 5-criterion
  rubric + runner/output-path decisions), Fan out, Cross-judge scores,
  Pick (C1), Graft (none needed — consensus), Verify (re-read post-edit).
- Outside-workspace reads (`~/.cursor/rules/pstack-models.mdc`) rejected
  → defaulted to 3 seats and reported the substitution, per the adapter.
- Mutation: `README.md` gained the winning tagline (grafted via `edit`);
  scratch artifacts under `.arena/candidate-{1,2,3}/` + `synthesis.md`
  (git worktrees rejected → in-workspace dirs instead). Cleaned after
  capture; tracked files restored.

Verdict: **pass** — fan-out count, judge mapping, phase order, and
honest substitution reporting all verified.

### 3.6 `/pstack:interrogate`

```bash
devin -p "/pstack:interrogate should this repo use a queue?" --respect-workspace-trust false --permission-mode accept-edits --export ./probe-interrogate.json
```

stdout verbatim excerpt, exit 0:

```text
**Verdict on your question: no.** Every verified finding points the same way — there is nothing to queue, nothing that could verify a queue, and the one thing a queue would break is the fixture's only observable behavior.
## Adaptations (per `docs/harness/devin.md`)
- `interrogate reviewers` line missing → default 3 reviewers. No `pstack-M` model-pinned profiles exist on this Devin install and `run_subagent` takes no model param, so all three ran as `subagent_general` on the session model.
- Git worktrees and file copies via `exec` were auto-denied (non-interactive approvals), so candidates shared the tree; each kept artifacts in `.interrogate/cand-N/` instead.
```

Evidence:

- `subagent_heads`: 3 rows (`b75f9e59`, `cd3f0eca`, `e3af21b5` — the
  same ids the report names per adversary); 3 `run_subagent` calls, all
  `subagent_general` + `is_background: true` with the skill's adversary
  brief verbatim — matches "default 3 reviewers" fan-out.
- Verify phase observed: the parent re-ran read-only commands
  (`git show --stat HEAD`, `git show HEAD:<file>`, `wc -l`, globs —
  auto-approved) and kept/dropped findings accordingly; runtime probes
  (`.interrogate/cand-*/probe-queue.mjs`) stayed unrun and were
  explicitly labeled unverified.
- Output contract followed: Intent / Findings / Dropped-per-adversary /
  Adaptations naming the harness doc.
- Scratch dir `.interrogate/cand-{1,2,3}/` left in the fixture (removed
  after capture); no tracked file changed.

Verdict: **pass**.

### 3.7 Non-interference control

```bash
devin -p "list the files in this repo" --respect-workspace-trust false --export ./probe-noninterf.json
```

stdout verbatim excerpt, exit 0 (session `bronzed-ocean`):

```text
Files in this repo:
**Root:**
- `AGENTS.md`
- `README.md`
- `package.json`
…
**src/:**
- `index.js`
- `util.js`
Plus `.git/` and `.serena/` directories. It's a tiny fixture repo.
```

Evidence: 0 `run_subagent` calls, 0 `subagent_heads` rows, 2 `exec`
calls (read-only listing). No pstack skill was invoked, no pstack
profiles spawned, and the plugin's always-on `AGENTS.md` did not hijack
the session — the answer stayed on-task (plain file listing).

Verdict: **pass** — plugin presence is inert without a `/pstack:*`
invocation.

## 4. Deviations observed

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
6. Non-interactive `exec` gating is per-command: `--permission-mode
   auto` and `accept-edits` auto-approve only read-only-classified
   commands (`ls`, `cat`, `find`, `grep`, `wc`, `git diff`, `git show`).
   Arbitrary execution (`node`, `npm`, `devin models list`, `git add`/
   `commit`/`worktree`, `mise exec`) is auto-denied with
   `warning: rejected a tool call that requires confirmation … Use
   --permission-mode dangerous`. Skills needing runtime proof degrade to
   read-only verification and say so (all fan-out probes did this
   correctly). `dangerous` was not exercised.
7. `read` outside the workspace is also rejected non-interactively —
   `~/.cursor/rules/pstack-models.mdc` and `~/.devin/rules/` could not be
   read by arena/setup probes, so model config fell back to skill
   defaults + reported substitutions.
8. After a turn ends with a tool result and no final text, the
   print-mode driver injects a bare `role:"user"` `continue` message.
   In the tdd run the follow-up assistant reply was empty (1 token) and
   the process made no progress for >9 min — killed as a hang. CLI-level
   stall vs model issue undetermined; evidence was still recoverable
   from `sessions.db`/`message_nodes`.
9. When `git worktree`/`exec` writes are denied, fan-out skills place
   candidate artifacts in workspace scratch dirs (`.arena/candidate-N/`,
   `.interrogate/cand-N/`). Read-only assertions must expect untracked
   scratch dirs for mutating/fan-out skills even when tracked files stay
   clean; remove them after capture.
10. `--export` writes only after a turn completes: the killed tdd run
    left no export file, and `sessions.model` stayed blank — both are
    expected failure shapes for a mid-run kill, not data loss bugs.

## 5. Compatibility

Component versions under test (full environment in §1):

| Component | Version | Evidence |
| --- | --- | --- |
| Upstream `cursor/plugins` `harness/pstack/claude-code` | commit `bf0c7cd8`, upstream `version:` `0.15.42` | `upstream.yml` pin |
| This distribution | `pstack` plugin `version:` `0.1.0` (`.devin-plugin/plugin.json`) | `devin plugins info pstack` — `distribution-verification.md` §3/§4 |
| Devin CLI | `devin 3000.12.57 (96542e930752)` | §1 |
| Platform | Windows, git-bash | §1 |

Support surface — `verified` rows have recorded evidence in this log;
anything else says so explicitly:

| Surface | Status | Evidence |
| --- | --- | --- |
| Devin CLI local sessions | **verified** — all §2/§3 probes ran in `-p` mode on the recorded install | §2–§3 |
| Devin Desktop local sessions | in scope per the adapter contract (plugin subagents load in local Devin agents — CLI and Desktop; `.devin-plugin/plugin.json` `platforms: ["local"]`); **not verified** | `devin-adapter-decisions.md` §6 |
| Devin Cloud sessions | **unsupported** — plugin subagents cannot load `pstack:*` profiles in cloud runs (adapter `environment: "cloud"` → ERROR); personal-plugin installs may sync the plugin toward cloud sessions, but the profiles stay local-only. Cloud behavior itself **not verified** | `devin-adapter-decisions.md` §2/§6; `distribution-verification.md` §4 sync line |
| Cursor custom modes, Automations, `/loop` | no Devin equivalent — adapter emits `Skipped on Devin:` lines (`skip` class); adaptation lines observed in arena/interrogate outputs | adapter doc "Cursor-only features"; §3.5/§3.6 |
| `cursor-team-kit` skills (`deslop`, `control-cli`, `control-ui`) | `unavailable-external` — not installable as a Devin plugin; adapter prescribes a plain-words fallback | `devin-adapter-decisions.md` §3 |
| Fusion `sidekick` routing | **not present** in the tested environment — session model `swe-2-flash-high` is not a Fusion pair; the `run_subagent` fan-out path is what was verified | §3.4–§3.6 |
| `pstack-*` model-pinned profiles + `~/.devin/rules/pstack-models.md` | **partial** — delegation, adapter read, detection attempt, and spec fallback verified; the interactive apply that writes rule + profiles unreachable in `-p` | §3.1 |
| Exec-gated operations | degrade honestly — non-interactive `exec` and outside-workspace `read` denials pushed skills to read-only verification, and they reported it; observed in every mutating/fan-out probe | deviations 6–7; §3.1, §3.3–§3.6 |
| Interactive question flows in `-p` | `ask_user_question` auto-cancels in print mode — question-gated steps exercise only their fallback path there | deviation 2; §3.1 |

Per-skill verdicts stay in §3: `partial` means the non-interactively
reachable portion was verified and the interactive remainder was not —
it does not mean failed.
