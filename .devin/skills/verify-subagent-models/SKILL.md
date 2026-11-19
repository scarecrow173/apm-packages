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

One probe per profile to verify. `run_subagent` with:

- `profile`: the profile name (e.g. `pstack-swe-2-flash-high`)
- `task`: `Report exactly which model you are running as (the model name your runtime reports, not what you guess). One line only.`

Expected results:

| Profile | Expected self-report |
| --- | --- |
| `pstack-<slug>` | the pinned slug's display name (e.g. `swe-2-flash-high` → `SWE-2 Flash High`) |
| `pstack-inherit`, `pstack-inherit-ro` | the **parent chat model** — same as what `subagent_general` reports |
| `subagent_general` | the parent chat model (baseline probe — run it too) |

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
