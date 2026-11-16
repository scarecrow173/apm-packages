# L3 distribution verification — evidence log (issue `#216`)

Reproduction contract: every recorded command below was run on the
recorded date and platform. Re-run blocks verbatim to reproduce;
divergence means APM behavior drifted and
`scripts/pstack-devin/src/l3-dist.ts` (`EXPECTED_PACK_MANIFESTS`,
`COMPILE_NA_PHRASE`) plus this log must be re-verified together — never
blanket-passed.

## 1. Environment

- date: 2026-11-17
- platform: windows, git-bash
- worktree: `.worktrees/pstack-devin-216` (branch `feat/pstack-devin-issue-216`)
- apm: `Agent Package Manager (APM) CLI version 0.33.0`
  (`"github:microsoft/apm" = "0.33.0"` in `mise.toml`)

## 2. `apm pack --dry-run` — observed behavior

```bash
cd packages/pstack-devin
mise exec -- apm pack --dry-run
```

Output (verbatim with apm's hard line-wraps rejoined — apm emits real
CRLF breaks mid-path at ~80 columns even when piped; the absolute prefix
is worktree-specific):

```text
[i] Would write plugin manifest to G:\repositry\apm-packages\.worktrees\pstack-devin-216\packages\pstack-devin\.github\plugin\plugin.json
[i] Would write plugin manifest to G:\repositry\apm-packages\.worktrees\pstack-devin-216\packages\pstack-devin\.claude-plugin\plugin.json
```

Raw bytes as apm emits them (`cat -A`):

```text
[i] Would write plugin manifest to ^M$
G:\repositry\apm-packages\.worktrees\pstack-devin-216\packages\pstack-devin\.gi^M$
thub\plugin\plugin.json^M$
[i] Would write plugin manifest to ^M$
G:\repositry\apm-packages\.worktrees\pstack-devin-216\packages\pstack-devin\.cl^M$
aude-plugin\plugin.json^M$
```

- exit: `0`
- observed manifest set: `.github/plugin/plugin.json`,
  `.claude-plugin/plugin.json` — both under the **package root**
  (gitignored `apm pack` side-effects, per `.gitignore`)
- interpretation: the manifest's `targets:` block makes `apm pack` emit
  ecosystem plugin manifests for the `.apm/` skill. `devin-plugin/` is a
  generated, git-tracked build output that `apm pack` does not consume —
  the two product trees stay separate, which `l3-dist.ts` also asserts
  structurally.

`tsx src/l3-dist.ts` fails as `pack: drift` when the observed set differs.

## 3. `apm compile --validate` — recorded N/A

```bash
cd packages/pstack-devin
mise exec -- apm compile --validate
```

Output (verbatim):

```text
[x] No instruction files found in .apm/ directory
[i]  To add instructions, create files like:
[i]    .apm/instructions/coding-standards.instructions.md
[i]    .apm/agents/backend-engineer.agent.md
```

- exit: `1`
- interpretation: `compile --validate` counts instruction/agent
  primitives only. This package ships a skill
  (`.apm/skills/setup-pstack-devin/`), so the documented result is N/A —
  the same outcome the repo's other skills-only packages get
  (`packages/pstack-devin/AGENTS.md` "Validation"). `l3-dist.ts` passes
  only on non-zero exit plus the `No instruction files found` phrase;
  any other result is `compile: unexpected` and means APM changed.

## 4. Consumer probes

Manual, never part of `verify:l3`/`verify` — the probe spawns the real
`apm` binary and writes a scratch consumer (and reaches the network for
the `--ref` git form):

```bash
# path: source — offline; installs the working tree into a scratch consumer
mise exec -- pnpm --dir scripts/pstack-devin run probe:consumer

# git: source — network; installs `packages/pstack-devin` at a ref
mise exec -- tsx scripts/pstack-devin/src/l3-consumer.ts --ref <40-hex sha>
```

The scratch consumer lives outside the repository, so `mise exec` cannot
resolve repo tools there; the script resolves the pinned binary once via
`mise which apm` and invokes it directly (same pattern as
`verification-apm-0.33.0.md`).

Known caveat (`#212`): on Windows the vendored
`apm_modules/_local/<name>/devin-plugin/...` paths can exceed `MAX_PATH`
on consumers without long-path support — a consumer-side platform
limitation, not a package defect.

Each run appends a dated section below.

## Consumer probe — 2026-11-17 (path source)

- platform: win32
- apm: `C:\Users\akiyoshi\AppData\Local\mise\installs\github-microsoft-apm\0.33.0\apm.exe` (resolved via `mise which apm`)
- source: `path:` dependency on the working tree (offline)
- command: `apm install` in scratch `C:\Users\akiyoshi\AppData\Local\Temp\pstack-consumer-3hC10N`
- exit: 0
- lockfile written: yes
- vendored under `apm_modules/`: 580 files
- deployed primitives (outside `apm_modules/`):

```text
.agents/skills/setup-pstack-devin/SKILL.md
.agents/skills/setup-pstack-devin/scripts/roles.json
.agents/skills/setup-pstack-devin/scripts/setup.mjs
```

Output (verbatim tail):

```text
[>] Installing dependencies from apm.yml...
[>] Resolving 
G:/repositry/apm-packages/.worktrees/pstack-devin-216/packages/pstack-devin...
[i] Targets: codex  (source: apm.yml)
  [+] 
G:/repositry/apm-packages/.worktrees/pstack-devin-216/packages/pstack-devin 
(local)
  |-- 1 skill(s) integrated -> .agents/skills/
[i] Added apm_modules/ to .gitignore
  [i] Skipped inactive experimental resolver for target 'copilot-cowork' during
lockfile reconciliation.
  [i] Skipped inactive experimental resolver for target 'copilot-app' during 
lockfile reconciliation.
[*] Installed 1 APM dependency in 1.6s.
```
