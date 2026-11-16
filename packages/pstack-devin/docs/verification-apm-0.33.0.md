# APM 0.33.0 verification log — pstack-devin (issue `#212`)

Reproduction contract: every command below was run on the recorded date and
platform. Re-run blocks verbatim to reproduce; divergence means the
verification is stale and `upstream-source-decision.md` must be revisited.

In-repo commands run via `mise exec --`. Scratch directories outside the
repo cannot resolve mise tools; resolve the pinned binary once per shell:

```bash
APM="$(cd /g/repositry/apm-packages && mise which apm)"
# -> C:\Users\akiyoshi\AppData\Local\mise\installs\github-microsoft-apm\0.33.0\apm.exe
```

## 1. Environment

- date: 2026-11-16
- platform: windows, git-bash
- `mise exec -- apm --version` -> `Agent Package Manager (APM) CLI version 0.33.0`
- pinned by `mise.toml`: `"github:microsoft/apm" = "0.33.0"`

## 2. Upstream pin

```bash
gh api repos/cursor/plugins/commits/main --jq '.sha + " " + .commit.committer.date'
# -> bf0c7cd80abdbf7fe47b634978a7d1b4071f71a7 2026-11-15T03:36:17Z

gh api "repos/cursor/plugins/git/trees/bf0c7cd80abdbf7fe47b634978a7d1b4071f71a7:harness/pstack/claude-code?recursive=1" \
  --jq '.tree[] | select(.type=="blob") | .path' | sort | wc -l
# -> 546
```

Observed upstream metadata at that commit (via APM lockfile):
`version: 0.15.42`, `declared_license: MIT`, `package_type: agent_plugin`,
`content_hash: sha256:cedc7e3791f374b6b47f9b379670438704219baaa507845a4f680ce4f66b44ec`.

## 3. APM dependency probes

Probe 3a — file inventory. `gh api git/trees?recursive=1` vs
`apm_modules/.../claude-code` file lists.

- observed: 546 upstream / 547 cached files; delta (verbatim `diff` output,
  `DIFF_EXIT=1`):

  ```diff
  0a1
  > .apm-pin
  ```

  `.apm-pin` is an APM-side marker; every upstream blob is present in the
  cache — no upstream file is missing.

Probe 3b — non-copilot target (`targets: [claude]`, `dependencies:` object
form, scratch consumer outside the repo).

```bash
apm install --only apm
```

- observed (verbatim tail; line wraps joined, elided where marked):

  ```text
  [i] Targets: claude  (source: apm.yml)
    [+] github.com/cursor/plugins/harness/pstack/claude-code#bf0c7cd8... @bf0c7cd8
    [!] [cursor/plugins/harness/pstack/claude-code] Agent Plugins v1.0.0 packages
    install natively only for the 'copilot' target; selected target(s): claude.
    Re-run with --target copilot. No selected target received this package. To
    install available skill 'architect' as a plain skill bundle, use (POSIX shell):
    apm install 'cursor/plugins/harness/pstack/claude-code/skills/architect#bf0c7cd80abdbf7fe47b634978a7d1b4071f71a7'
    --target claude
  [x] Installation failed in 4.2s. No install transaction changes were committed.
  ```

  `ls apm.lock.yaml` -> `ls: cannot access 'apm.lock.yaml': No such file or
  directory` — no `apm.lock.yaml` written (transaction rolled back).

Probe 3c — shorthand `owner/repo/path#sha` canonicalization.

```bash
apm install 'cursor/plugins/harness/pstack/claude-code#bf0c7cd80abdbf7fe47b634978a7d1b4071f71a7' --target copilot
```

- observed: install OK — `[+] Registered 1 Agent Plugin with GitHub Copilot
  via the 'apm' marketplace (pstack)`, `[*] Installed 1 APM dependency in
  10.8s.` Running `apm install <spec> --target copilot` in an empty dir
  bootstraps a new `apm.yml` (`targets: [copilot]`); the dependency entry is
  written as a shorthand string, not the object form:

  ```yaml
  dependencies:
    apm:
      - cursor/plugins/harness/pstack/claude-code#bf0c7cd80abdbf7fe47b634978a7d1b4071f71a7
  ```

  Scratch `apm.lock.yaml` confirms
  `resolved_commit: bf0c7cd80abdbf7fe47b634978a7d1b4071f71a7`,
  `resolved_ref` identical, `version: 0.15.42`,
  `virtual_path: harness/pstack/claude-code`, `is_virtual: true`,
  `package_type: agent_plugin`, `deployments: []`.

Probe 3d — `apm audit` integrity.

```bash
mise exec -- apm audit
```

- observed baseline: `[*] 1 file(s) scanned -- no issues found`, but
  preceded by `[!] drift check could not run: drift replay blocked: Native
  Agent Plugin canonical IR is missing, so deployment was blocked.` The 1
  scanned file is the copilot marketplace-registration artifact (an install
  side-effect), not part of the pinned tree.
- after appending `tamper-probe` to the cached `README.md`: **identical
  output — the tamper is NOT detected.** `apm audit` scans deployed files
  only; with `deployments: []` there is no upstream deployment surface to
  scan, and drift replay cannot run for `agent_plugin` packages at all.
- after `rm -rf apm_modules && mise exec -- apm install --only apm`:
  `[*] Installed 1 APM dependency in 7.5s.` — tree restored (546 upstream
  files + `.apm-pin`, no tamper residue); audit output returns to the same
  "clean" line.

Conclusions:

- The upstream subdir resolves as `package_type: agent_plugin`; it installs
  only for `copilot` and deploys zero files (`deployments: []`).
- `deployments: []` means `apm pack` can never ship upstream files — bundles
  are built exclusively from lockfile-attested `deployed_files`.
- The only safe manifest form for the pin is `devDependencies:` + `targets:
  [copilot]` on a manifest whose `targets:` includes `copilot` (verified in
  Task 2).
- `apm audit` provides **no** drift detection for this pin: replay is blocked
  for `agent_plugin`, and audit covers deployed files only. The byte-fidelity
  contract must rely on rebuild-time recompute against the lockfile
  `content_hash` (`sha256:cedc…44ec`) and the probe-3a file-inventory diff —
  not on `apm audit`.

Probe-to-evidence mapping (input to issues `#214` / `#216`):

| Probe | Evidence produced |
| --- | --- |
| 3a file inventory | `apm_modules` cache is the upstream tree plus exactly one `.apm-pin` marker; usable as snapshot source for pack-time comparison |
| 3b non-copilot failure | `dependencies:` can never carry the upstream tree — non-copilot targets fail atomically with no lockfile written |
| 3c shorthand form | Canonical dependency declaration is `cursor/plugins/harness/pstack/claude-code#<sha>`; object `git`/`path`/`ref` form also accepted |
| 3d audit | Drift detection via `apm audit` is unavailable for `agent_plugin`; mismatch detection must be rebuild-time recompute |

## 4. Coverage and pack probes

Probe 4a — `apm pack -o build` bundle contents.

```bash
mise exec -- apm pack -o build 2>&1 | tail -12
```

- observed (verbatim tail; line wraps joined):

  ```text
  [i] Writing generated plugin manifest under .github/: G:\repositry\apm-packages\.worktrees\pstack-devin-212\packages\pstack-devin\.github\plugin\plugin.json
  [+] Generated plugin manifest: G:\repositry\apm-packages\.worktrees\pstack-devin-212\packages\pstack-devin\.github\plugin\plugin.json
  [+] Generated plugin manifest: G:\repositry\apm-packages\.worktrees\pstack-devin-212\packages\pstack-devin\.claude-plugin\plugin.json
  ```

```bash
find build -type f | sort
# -> find: 'build': No such file or directory
```

- observed files: **none — `build/` was never created.** `apm pack` reads the
  `dependencies:` block to decide bundle contents (per `apm pack --help`:
  "`dependencies:` block -> bundle"); this manifest carries the pin under
  `devDependencies:` only, and the lockfile's `deployments: []` attests
  nothing to pack, so the bundle stage emitted no output directory at all.
  `--dry-run --verbose` prints the same plugin-manifest lines with no bundle
  stage mentioned.
- observed: **0** upstream files in bundle (expected: 0 — `deployments: []`
  attests nothing to pack). Stronger than expected: not an empty bundle, but
  no bundle artifact whatsoever.
- side-effect: `.claude-plugin/plugin.json` generated in package dir: **yes**
  (plus `.github/plugin/plugin.json`). Both are bare
  `name`/`version`/`description`/`author`/`license` manifests generated from
  the `targets:` block; both paths are already gitignored (`/.github/`,
  `/.claude-plugin/` in the package `.gitignore`).

Probe 4b — update-visibility commands on a SHA-pinned devDep.

```bash
mise exec -- apm outdated 2>&1 | tail -10
```

- observed (verbatim; trailing table border clipped by terminal width):

  ```text
                                     Dependency Status
  ┌──────────────────────┬────────────┬────────────┬──────────────┬──────────────
  │ Package              │ Current    │ Latest     │ Status       │ Source
  ├──────────────────────┼────────────┼────────────┼──────────────┼──────────────
  │ cursor/plugins/harn… │ bf0c7cd8   │ -          │ unknown      │ git tags
  └──────────────────────┴────────────┴────────────┴──────────────┴──────────────
  [i] Some dependencies could not be checked
  ```

```bash
mise exec -- apm deps list 2>&1 | tail -10
```

- observed (verbatim):

  ```text
                                             APM Dependencies (Project)
  ┌───────────────────────────────────────────┬─────────┬────────┬─────────┬──────────────┬────────┬────────┬───────┐
  │ Package                                   │ Version │ Source │ Prompts │ Instructions │ Agents │ Skills │ Hooks │
  ├───────────────────────────────────────────┼─────────┼────────┼─────────┼──────────────┼────────┼────────┼───────┤
  │ cursor/plugins/harness/pstack/claude-code │ 0.15.42 │ github │    -    │      -       │   -    │   -    │   -   │
  └───────────────────────────────────────────┴─────────┴────────┴─────────┴──────────────┴────────┴────────┴───────┘
  [i] 1 Agent Plugin registered natively with GitHub Copilot: pstack
  ```

```bash
mise exec -- apm deps tree 2>&1 | tail -10
```

- observed (verbatim):

  ```text
  pstack-devin (local)
  └── cursor/plugins/harness/pstack/claude-code@0.15.42
  ```

Conclusions:

- `apm pack` cannot distribute the upstream tree; the Devin plugin artifact
  must be produced by a build-side snapshot (issue `#213`). The only outputs
  pack produces for this manifest are generated plugin manifests under
  `.github/plugin/` and `.claude-plugin/`.
- Staleness detection for the pin requires comparing `upstream.yml.commit`
  against upstream `main` directly (`gh api`/`git ls-remote`); `apm outdated`
  **does not** surface it — it checks `git tags` only, so a full-SHA pin
  reports `Status: unknown`, `Latest: -`, and "Some dependencies could not be
  checked". `apm deps list`/`tree` confirm the pin resolves as version
  `0.15.42` (from the lockfile) but expose no staleness signal either. This
  is the update-procedure input for issue `#219`.

## 5. Local consumer probe

(filled by plan Task 5)

## 6. Constraints and acceptance

(filled by plan Tasks 5–6)
