# Upstream watch & pin update

The maintainer watches `cursor/plugins` `main` for upstream drift —
`check:upstream` resolves remote HEAD and compares subtree tree SHAs
after a blobless fetch of both commits — reports the diff with
`report:update`, and moves the pin atomically with `apply:update
<sha>`: pin files + `apm install` lockfile + rebuilt tree + verify +
one commit, with rollback on failure.

## Sub-features

- `watch-check` — `check:upstream` prints `up to date` + exit `0`, or
  JSON coordinates (current/candidate/candidateTree/upstreamVersion) +
  exit `42`.
- `watch-report` — `report:update <sha>` renders the markdown update
  report (diff categories, blocking findings) to stdout.
- `apply-pin` — `apply:update <40-hex>` runs the atomic pipeline over
  the TOUCHED pathspecs: `upstream.yml`, `apm.yml`, `apm.lock.yaml`,
  `.gitignore`, `devin-plugin/`.
- `apply-rollback` — a failed step rolls the TOUCHED paths back;
  `rolledBack: false` in the result means "inspect the worktree".

## How to get to it (user POV)

- `pnpm --dir scripts/pstack-devin run check:upstream`.
- `pnpm --dir scripts/pstack-devin run report:update` — needs a
  `<40-hex>` candidate sha argument.
- `pnpm --dir scripts/pstack-devin run apply:update <40-hex>` — the
  pin move; also run by the weekly upstream-watch workflow.

## Driving it with run-drive

Preconditions:

- Launch complete, `doctor.mjs` exit `0`; github.com reachable — all
  three commands fetch upstream commits.
- For `apply:update`: a REAL target sha (from a `check:upstream` exit
  `42` JSON block or the weekly workflow) and a clean baseline — this
  drive creates a commit.

- **Check.** `mise exec -- node .devin/skills/verify-pstack-devin/scripts/run-drive.mjs scripts/pstack-devin/fixtures/evidence/<run-id> check:upstream`
  → exit `0` with `up to date`, OR exit `42` with a one-line JSON block
  — both are verdicts (the helper re-emits `42`; treat it as the
  update-available signal, not a failure).
- **Report.** `run-drive.mjs <evidence-dir> report:update
  <candidate-sha>` → stdout is the markdown report (`# pstack-devin
  upstream update report`, Summary/Blocking/Categories sections).
- **Apply.** `run-drive.mjs <evidence-dir> apply:update <sha>` →
  5-9 minutes of inherited-stdio pipeline output; exit `0` means the
  atomic commit landed — `git log -1` is the commit proof and
  after-status is clean (all changes inside the commit).
- **Proof.** Watch logs show the verdict + coordinates; an apply log
  shows the pipeline steps and a clean after-status.

## Gotchas

- `check:upstream` fetches into an `os.tmpdir()` `pstack-upstream-*`
  dir it always removes — no repo residue; `report:update` uses
  `pstack-update-report-*` the same way.
- `apply:update` accepts only a full 40-hex sha and refuses a dirty
  baseline on the TOUCHED paths — never run it "to see what happens";
  it writes a real commit on success.
- The pipeline exports `PSTACK_DEVIN_CHECK_PRECOMMIT=1` for its nested
  `check-generated` — do not set/unset it yourself mid-pipeline (see
  deterministic-build-check).
- Never bump `upstream.yml`/`apm.yml`/`apm.lock.yaml` pins by hand —
  the pin move is `apply:update` or the weekly workflow, nothing else
  (package AGENTS.md).
- `report:update` and `apply:update` take arguments — always pass them
  verbatim through run-drive's `[args...]`; a missing sha exits `1`
  with a usage line, which is a malformed drive, not a verdict.
