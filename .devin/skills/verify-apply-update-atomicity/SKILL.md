---
name: verify-apply-update-atomicity
description: "Re-verify that a failed apply-update run leaves the repo exactly as it found it. Use when changing scripts/pstack-devin/src/apply-update.ts (the steps list, rollback, commitAll, or the TOUCHED pathspecs), its test fixtures, or before merging any change that could leave packages/pstack-devin half-updated after a failed pin bump."
---

# Verify apply-update rollback atomicity

`pnpm run apply:update <sha>` promises all-or-nothing: if any pipeline step
fails, `packages/pstack-devin` returns to its pre-run state — no half-edited
pin files, no staged leftovers, no partial generated tree, no stray commit.
This skill re-checks that promise against the real code whenever the
pipeline changes.

## What is verified

**Property (plain words):** for every step in `applyUpdate`'s `steps[]`
list — upstream.yml, apm.yml, apm install, build, observed refresh,
check-generated, verify, commit — if that step fails, then after rollback
every pipeline-touched path is byte-for-byte what it was before the run:
tracked file contents on disk, the git index, untracked files under
`devin-plugin/`, and HEAD itself.

**Tool:** bounded-exhaustive enumeration against the real `applyUpdate`
function — not a hand model. The single-failure space is small enough to
check every case: the driver builds a fixture git repo per scenario,
snapshots repo state, injects a failure at each step in each failure mode
the step can physically realize ("clean": throws before its side-effects
land; "dirty": throws after mutating tracked files, dropping untracked
files, and staging an edit inside TOUCHED), runs the pipeline, and asserts
the post-rollback snapshot equals the pre-run snapshot byte-for-byte.
Failing at step k means steps 1..k-1 ran for real, so accumulated earlier
side-effects are covered by construction.

**Bounds — what a pass does NOT claim:**
- At most one step fails per run; steps are sequential (that is the
  pipeline's real control flow).
- Rollback's own three git commands (reset / checkout / clean) are assumed
  to work; a rollback-internal failure surfaces as `rolledBack:false` and
  is reported, not enumerated.
- Side-effects outside the `TOUCHED` pathspecs are out of scope: e.g. an
  `apm_modules/` install artifact is gitignored and may legitimately
  pre-date the run, so rollback correctly does not remove it.
- A commit that was successfully created but left the worktree dirty is a
  post-commit consistency check in `applyUpdate` (it returns `ok:false`
  WITHOUT rollback by design); the model covers failures thrown by steps.

## Coverage record

Covers `scripts/pstack-devin/src/apply-update.ts`:

- `applyUpdate` — the step loop, failure reporting, rollback invocation.
- `rollback` — `git reset -q HEAD -- TOUCHED`, `checkout -- <tracked>`,
  `clean -fdq -- devin-plugin`.
- `commitAll` — `git add -A -- TOUCHED`, provenance exec-bit re-stage,
  foreign-staged-path refusal.
- The `TOUCHED` pathspec set — mirrored into the test's snapshot scope.
- The 8-entry `steps[]` list — the test derives step names from the source
  and fails if a step has no failure scenario, so a new step cannot join
  the pipeline unverified.

Verification last confirmed against the covered file as of commit
`23071e502332334f3e917af08d072e9dae004ab4`
(`git log -1 --format=%H -- scripts/pstack-devin/src/apply-update.ts`).
If that file now has a newer commit, the verification has not been
re-confirmed — run the check and move this record forward only after it
passes against the new code.

## How to run

```bash
mise exec -- pnpm --dir scripts/pstack-devin exec tsx --test tests/apply-update-atomicity.test.ts
```

Or just `mise exec -- pnpm --dir scripts/pstack-devin test` — the file runs
inside the normal suite. Expect ~40s standalone, exit 0 on a clean pass.

## Reading a failure

Every scenario asserts `post-rollback snapshot == pre-run snapshot` and
prints the differing paths on violation, e.g.:

```
atomicity violation — step "build" failed (dirty) but post-rollback state
differs from pre-run state:
  file content differs after rollback: packages/pstack-devin/devin-plugin/tracked.md
  untracked leftover on disk: packages/pstack-devin/devin-plugin/leftover.md/
```

Counterexample reading: the named step failed; rollback ran; the listed
paths are what it failed to restore.

- **`file content differs`** on a tracked path → `checkout --` in
  `rollback()` is not restoring worktree bytes (removed, reordered, or the
  `ls-files` filter dropped the path).
- **`untracked leftover` / leftover dir** under `devin-plugin/` → the
  `clean -fdq` pathspec is wrong or missing.
- **`index differs`** → `reset -q HEAD -- TOUCHED` is not unstaging
  (a pathspec was renamed but TOUCHED was not).
- **`HEAD moved`** → something created a commit after the failing step —
  most likely the step ordering or error propagation broke.
- **`git status --porcelain differs`** with paths outside TOUCHED → the
  pipeline touched state it does not own; that is a real bug, never a
  modeling gap.

**Real bug vs modeling error.** A real bug shows a plausible leftover:
a modified pin file that survived, an unstaged edit, an untracked build
artifact, a commit that exists. A modeling error usually shows the harness
tripping over itself: a scenario named `step X` reporting a different
`failedStep`, `rolledBack:false` with rollback-problem text about git
itself, or fixture corruption leaking between scenarios. If the
counterexample names paths only your change introduced, suspect the model;
if it names pipeline-owned paths, suspect the code — and per this
verification's contract, findings stay findings: do not weaken the
property or the fixture to force a pass.

## Updating on an intended change

- **New pipeline step:** add a `Scenario` row per realizable failure mode
  (the coverage test fails until every `steps[]` name has one) — runner
  steps take `failAt`/`mutateAt` command-suffixes; internal steps take a
  `setup` that commits a breaking precondition.
- **Changed TOUCHED set:** update the `TOUCHED` mirror at the top of
  `tests/apply-update-atomicity.test.ts` to match `src/apply-update.ts`.
- **Deliberately changed rollback scope** (e.g. rollback stops restoring
  some path): the check will fail — that failure IS the verification
  working. Update the property statement above and the scenario/snapshot
  scope together, and call the weaker guarantee out in the commit message.
- **After any pass on changed code:** move the sync commit in "Coverage
  record" to the commit you verified against.
