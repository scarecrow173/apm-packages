# Safety scan

The maintainer audits the committed `devin-plugin/` tree for
distribution safety — no secret-shaped tokens, no oversized files,
provenance executables present and executable, and the
`.devin-plugin/plugin.json` name/version/platforms contract — with one
read-only, fully local command.

## Sub-features

- `scan-secrets` scans every shipped file for prefix- and
  identifier-anchored secret patterns; `safety-scan-allowlist.ts` is
  the only suppression path.
- `scan-oversized` flags files larger than `--max-bytes` (default
  5 MiB).
- `scan-exec` requires every provenance `executables` entry to exist
  and carry an exec-capable form.
- `scan-manifest` asserts the `.devin-plugin/plugin.json`
  name/version/platforms contract.

## How to get to it (user POV)

- `pnpm --dir scripts/pstack-devin run check:safety`.
- `tsx src/safety-scan.ts --max-bytes=N` — the same scan with a custom
  size ceiling (direct `tsx` entry, no package script).
- Second leg of `pnpm --dir scripts/pstack-devin run verify:l1`.

## Driving it with run-drive

Preconditions:

- Launch complete, `doctor.mjs` exit `0` (generated tree present).
- Fully local and read-only — no network, no fixture, no clean-baseline
  requirement. Writes nothing.

- **Scan.** Run `mise exec -- node .devin/skills/verify-pstack-devin/scripts/run-drive.mjs scripts/pstack-devin/fixtures/evidence/<run-id> check:safety`.
- **Result.** Exit `0`; stdout ends `safety scan: <N> files scanned, 0
  findings (0 secrets, 0 oversized, 0 exec, 0 manifest)`. Any finding
  prints a `<kind>: <count> findings` block and flips the exit to `1`.
- **Proof.** `check-safety.log` shows the command, exit `0`, the
  zero-findings summary, and identical before/after `git status` — a
  read-only drive leaves no git state.

## Gotchas

- It scans the COMMITTED `devin-plugin/` working tree — after a `build`
  but before its commit it measures the working tree. Know which you
  meant to prove.
- The scan requires `devin-plugin/` to exist; a missing tree exits `1`
  with the "run build" hint — that is a launch problem, not a finding.
- A secret-shaped allowlist entry is the deliberate escape hatch — a
  finding that is a known-example token goes through
  `safety-scan-allowlist.ts`, never through regex weakening.
- The direct `tsx` form (`--max-bytes`) is not wrapped by run-drive;
  drive it with the same evidence discipline by hand
  (`mise exec -- pnpm --dir scripts/pstack-devin exec tsx src/safety-scan.ts --max-bytes=N`).
