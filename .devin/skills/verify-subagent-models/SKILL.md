---
name: verify-subagent-models
description: "Prove pstack subagent model resolution end-to-end — that every pstack-* profile registers and that a spawned delegate actually runs its pinned model (or the parent model for pstack-inherit). Use after /pstack:setup-pstack, after editing generated profiles, or when a run_subagent spawn fails to start."
---

# Verify subagent model resolution

The surface under test is the live Devin session's `run_subagent`
profile registry. Profiles live under `%APPDATA%\devin\agents\` (Windows)
and load **at session start only** — a profile written mid-session never
spawns in that session, no matter how valid it is. Verification
therefore splits into what this session can prove (parse + registration
via `devin doctor`) and what requires a session that started *after* the
profiles were written (live spawn probes).

**Surface:** `devin doctor` (offline parse/registration report) plus one
`run_subagent` self-report probe per profile.

## Doctor

```bash
devin doctor
```

Exit `0` and a line like
`N profile(s) loaded: ..., pstack-inherit, pstack-inherit-ro, pstack-swe-2-*, ...`
means every profile file parses and registers. Any `CFG005` line names a
file whose frontmatter does not parse — fix the generator template
(`packages/pstack-devin/overlay/skills/setup-pstack-devin/scripts/setup.mjs`)
and re-run `plan`/`apply`; never hand-edit the generated profile (the
`# pstack-generated:` sha marker would flag it as user-modified).

If a profile was written *after* this session started, doctor already
lists it (it scans the dir live) but `run_subagent` will still fail to
start it — that failure is expected in-session, not a defect. Re-check
by spawning after a restart.

## Drive

The canonical drive is a **separate headless Devin process**, because
profiles load at session start — a probe in the current session cannot
see files written mid-session, and a child session's `--model` flag
gives a known parent to check inheritance against:

```bash
mkdir -p "$TEMP/devin-probe-models" && cd "$TEMP/devin-probe-models" && \
devin -p "Use the run_subagent tool exactly two times, sequentially. \
First call: profile \"pstack-inherit\", task \"Report exactly which \
model you are running as, the model name your runtime reports. One \
line only.\" Second call: profile \"pstack-swe-2-flash-high\", same \
task text. Then report each subagent's exact self-reported model \
string, one line per profile, formatted: <profile> -> <reported \
model>. If a spawn fails to start, report that failure explicitly." \
  --model swe-2-max --permission-mode dangerous \
  --respect-workspace-trust false --verbosity 1
```

The child session runs with a pinned parent (`--model swe-2-max`), so
the expectations are unambiguous:

| Profile | Expected self-report |
| --- | --- |
| `pstack-inherit` | `swe-2-max` — the parent chat model, proving the model-free profile inherited |
| `pstack-<slug>` | the pinned slug (e.g. `swe-2-flash-high`), proving the pin is honored |

Measured 2026-11-19 against a fresh headless session:

```text
pstack-inherit            -> swe-2-max
pstack-swe-2-flash-high   -> swe-2-flash-high
```

In-session alternative (only for profiles that existed at this
session's start): `run_subagent` with the same self-report task, plus a
`subagent_general` baseline to learn the parent model.

A spawn that fails to start means the profile is not registered this
session (see Doctor). A self-report that disagrees with the pin is a
real finding — the pin is being ignored or overridden; record it.

## Evidence

Proof = the doctor output plus the self-report string per profile,
recorded in the report that commissioned the verification. For a PR,
paste the table of `profile → reported model` into the test plan.

Known-good baseline (measured 2026-11-19, parent `swe-2-max`):

- `pstack-swe-2-flash-high` → `SWE-2 Flash High` (pin honored)
- `subagent_general` → `swe-2-max` (parent inherited)
- `pstack-inherit` → registered by doctor; live spawn pending a
  post-write session start

## Cleanup

Nothing to stop — probes are one-shot subagents. `devin doctor` and
`run_subagent` leave no residue.
