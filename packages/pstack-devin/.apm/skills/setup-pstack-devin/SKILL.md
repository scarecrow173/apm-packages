---
name: setup-pstack-devin
description: Configure which models pstack uses per role and at what reasoning budget on Devin. Detects models via `devin models list` and writes an always-on Devin rule plus model-pinned custom subagent profiles that override the skill defaults. Use for /pstack:setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

# Setup pstack on Devin

If this skill arrived via the pstack plugin, read [the Devin adapter](../../docs/harness/devin.md) once per session before you follow this skill — it is the adapter of record.

Write `~/.devin/rules/pstack-models.md`, a Devin rule with `trigger: always_on` frontmatter that sets pstack's model per role, plus one `pstack-<slug>` custom subagent profile and one `pstack-<slug>-ro` read-only variant per used slug under the Devin agents dir — `~/.config/devin/agents/` (Windows: `%APPDATA%\devin\agents\` `[unverified]`).

All arithmetic and file writes are deterministic: `scripts/setup.mjs` in this skill's directory does them (`<skill>` below names that directory). Never edit a generated file by hand — each carries a `# pstack-generated:` sha256 marker the script uses to tell its own output from user edits.

## Steps

### 1. Detect available models

Run `devin models list`, save its raw output to a models file in a scratch dir (step 3 passes it to `plan --models`), and pipe the same output to `node <skill>/scripts/setup.mjs parse` — model list in on stdin, detected slugs out as JSON. If it yields zero slugs, ask the user to paste the slugs they can use and feed that text through `parse` the same way; a bare-slug list also parses.

`fusion-*` slugs never enter the detected set: each names a lead + `sidekick` pair for the main chat, not a single subagent model, so a user who wants the pair picks its concrete slugs. The aliases `inherit-parent` and `auto` are always valid even though they are never detected — both mean the role runs on the parent chat model. Never write a real slug the detection step did not produce: an unknown model fails closed, it is never guessed.

### 2. Load current state

If `~/.devin/rules/pstack-models.md` exists, read it: its `# budget` line and `role: slug[, slug…]` lines are the current choices. List `pstack-*.md` under the agents dir so step 4 can show what changes. With no rule, start from the defaults in `scripts/roles.json` beside `setup.mjs`.

A rule line whose role is not in the canonical schema is a retired role. Keep the line in the choices file you build in step 3 — the plan reports unknown keys as `droppedRoles`. Report each dropped role to the user; never silently keep one.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Prefer `ask_user_question` over free text. Offer these four options with these exact labels, and name the current budget when the rule records one. With no rule, say that `large` matches the skill defaults.

- `unlimited — max reasoning`
- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(b) Build the inputs.** Write a choices file of shape `{"budget": "<label>", "choices": {"<role>": "<slug-or-alias>[, <slug>…]"}}` — every schema role set to its current rule value, or its `roles.json` default when there is no rule; keep any value the user already changed, `inherit-parent` and `auto` included. For panel roles (`arena runners`, `arena cross-judge pool`, `architect runners`, `interrogate reviewers`) the value is a comma-separated list and one subagent runs per entry, so keep the list length. `arena cross-judge pool` is ordered by preference, and an `inherit-parent` or `auto` entry never judges. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

**(c) Plan.** Run `node <skill>/scripts/setup.mjs plan --choices <file> --models <file>` and save the plan JSON — step 4 applies it. The plan resolves the budget arithmetic per role (`resolved`), marks each role needing a decision (`needsChoice`), reports `droppedRoles`, and lists every file change under `changes`.

**(d) Confirm.** Show every role with its `resolved` model, marking `needsChoice` entries, and name each dropped role. For each `needsChoice` role offer the detected models plus `inherit-parent` and `auto` via `ask_user_question`, update the choices file, and re-run `plan` until no role needs a choice or the user accepts the suggestion shown. Before applying, write each role's accepted `resolved` value back into the choices file — the plan emits `resolved` under the chosen budget, and `apply` writes what `choices` carries.

### 4. Apply

Show the plan's `changes`: which files are new (`write`), which differ on disk (`diff`, flagging `userModified`), which are already correct (`unchanged`), and which stale `pstack-*.md` files are `removeCandidates`. On a yes, run `node <skill>/scripts/setup.mjs apply --plan <file> --yes` — `--yes` only after the user has seen the diffs. `apply` refuses a stale plan (a target changed on disk since planning), so re-run `plan` and show the fresh diff. Delete remove candidates only after listing them and getting an explicit yes, by re-running `apply` with `--remove`.

### 5. Confirm

Tell the user the rule and profiles were written and that they load at session start — the change applies to NEW sessions; this session keeps its current models. Cloud sessions cannot load plugin profiles — `pstack-*` profiles are local-only. Re-running this skill updates the files.

Explain the model semantics once:

- With `sidekick` (a Fusion plan), one hands-on delegate goes to `sidekick`. Every fan-out role — arena runners, swarm workers, reviewers, poteto-mode delegates — spawns one `run_subagent` per entry on the generated `pstack-*` profiles: `pstack-<slug>` for write work, `pstack-<slug>-ro` for review.
- A `-ro` profile is read-only intent declared through `allowed-tools` — for a hard read-only guarantee spawn `subagent_explore` instead.
- An unknown model fails closed — the skill never guesses a slug.

### 6. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /pstack:create-verification-skill." On yes, invoke `/pstack:create-verification-skill`. On no, move on without pushing.

### 7. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with /pstack:create-formal-verification-skill." On yes, invoke `/pstack:create-formal-verification-skill`. On no, move on without pushing.
