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

(filled by plan Task 3)

## 4. Coverage and pack probes

(filled by plan Task 4)

## 5. Local consumer probe

(filled by plan Task 5)

## 6. Constraints and acceptance

(filled by plan Tasks 5–6)
