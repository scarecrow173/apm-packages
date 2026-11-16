# pstack-devin User Guide + Real Devin CLI Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Synchronize EN/JA user-facing docs and verify on the REAL `devin` CLI that the major pstack skills work — with per-case evidence (input, output/log, subagent count+model, fallback, verdict). Unverified items are marked unverified, never "done".

**Architecture:** Fixture scratch repo (throwaway, outside the package) + `devin -p/--print` non-interactive sessions + installed `--local` plugin (proven in `#217`) + session-log capture for subagent/model evidence. Verification results land in `docs/runtime-verification.md`; guides in README/AGENTS EN/JA. Manual/paid checks stay optional and separate from `verify` (L1–L3).

## Verified Facts (from `devin --help` + `#217` evidence)

- Non-interactive: `devin -p "<prompt>"` or `--prompt-file`, in a cwd; `--respect-workspace-trust false` needed for untrusted fixture dirs; `-m/--model` selects model.
- Plugin install `--local` works; `devin plugins info pstack` shows skills/agents/rule. Remove scope must match install scope.
- Sessions list via `devin list`; logs under the CLI data dir (locate in Task 1).
- pstack skills to verify: `poteto-help`, `setup-pstack` (→ `setup-pstack-devin`), `how`, `poteto-mode`, `arena`, `interrogate`, `tdd`.

## File Map

| Path | Responsibility |
| --- | --- |
| `packages/pstack-devin/docs/runtime-verification.md` | per-skill evidence matrix + environment notes |
| `packages/pstack-devin/README.{md,ja.md}` | quickstart + verification pointers |
| `packages/pstack-devin/AGENTS.{md,ja.md}` | session-start guidance + constraints |
| `README.md`/`README.ja.md` (root) | package list sync |
| `packages/pstack-devin/docs/migration.md` | collision/backup/remove/migrate guidance |
| `scripts/pstack-devin/src/fixture-repo.mjs` (or plain bash steps in docs) | throwaway fixture repo generator |

### Task 1: harness probe — how to run + capture

- [ ] Build fixture repo `fixtures/pstack-devin-smoke/` (tiny: `apm.yml` + `AGENTS.md` + a couple of source files + git init). It must NOT live in the distributed package; scripts dir or a scratch path + gitignored.
- [ ] `devin plugins install <devin-plugin abs path> --local -y`; confirm `devin plugins list`.
- [ ] Probe ONE non-mutating skill end-to-end in print mode: `devin -p "/pstack:poteto-help" --respect-workspace-trust false` inside the fixture; capture stdout/stderr exit code; locate session logs/transcript and how to extract subagent spawns + model used.
- [ ] Record the working invocation pattern (prompt quoting, output capture, log location) as the reusable harness in `docs/runtime-verification.md` §harness. If print mode can't invoke plugin skills, try `--prompt-file`, or fall back to interactive `devin` session scripted via stdin — record whichever works with evidence.
- [ ] Commit `test(pstack-devin): establish real-CLI verification harness`.

### Task 2: per-skill verification runs

- [ ] For each skill `poteto-help`, `setup-pstack-devin`(=`/pstack:setup-pstack` mapping), `how`, `poteto-mode`, `arena`, `interrogate`, `tdd`: run `devin -p "/pstack:<skill>"` in the fixture (fresh `-p` session each; disposable git worktree for mutating skills like `tdd`/`setup-pstack-devin`).
- [ ] Per case record in `docs/runtime-verification.md`: exact input, key output excerpt (verbatim, small), subagent count + model(s) observed in logs, fallback/skip behavior, verdict pass/partial/fail/unverified with reason. Mutating cases also note file diff or git status.
- [ ] Read-only profile check: run one skill that should be read-only and assert no fixture file changed (git status clean).
- [ ] `poteto-mode`/`arena` fan-out: record actual subagent count vs doc claim; Fusion sidekick presence/absence noted, NOT silently collapsed.
- [ ] AGENTS.md non-interference: in fixture WITHOUT invoking pstack, run a neutral `devin -p` task (e.g. "list files") and confirm the plugin's always-on rule does not derail the session (output stays on-task).
- [ ] Commit `docs(pstack-devin): record real Devin CLI verification results`.

### Task 3: guides + migration + compatibility matrix

- [ ] `docs/migration.md` (+ JA sibling): namespace collision with upstream `pstack`, backup (`devin plugins list` before), remove/migrate steps, config file locations (`~/.devin/rules/pstack-models.md`, profiles dir), new-session-required note.
- [ ] Compatibility/support matrix doc or README section: upstream commit `bf0c7cd8`/version `0.15.42`, distribution `0.1.0`, devin `3000.12.57` tested, supported (CLI/Desktop local) vs unsupported (Cloud subagent profiles), external cursor-team-kit skill limitations.
- [ ] Package README EN/JA + AGENTS EN/JA sync; root README package list sync. EN/JA structure identical.
- [ ] Commit `docs(pstack-devin): guides, migration, compatibility matrix`.

### Task 4: sweep + issue comment

- [ ] `pnpm test` + `lint:md` + `verify:l2/l3` green; flip plan checkboxes; post `#218` comment linking runtime-verification evidence + marking any unverified items.

## Global Constraints

- Real-CLI runs are OPTIONAL-manual artifacts recorded in docs — they do NOT join `verify`/`pnpm test` (L1–L3 stays free/deterministic). Harness scripts may exist in `scripts/pstack-devin/` but only as opt-in probes (`probe:*` naming).
- Never claim a run happened without recorded output. Partial/failed/unverified marked explicitly.
- Fixture repo is throwaway and gitignored — never distributed.
- No claims about Devin Cloud or Cursor-only features working.
