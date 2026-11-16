# pstack-devin Deterministic L1–L3 Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining gaps in deterministic, free, local validation — an L1→L3 verification suite that fails loudly on upstream incompatibilities, broken references, new required APIs, unsafe distribution content, and packaging drift — while explicitly separating static checks from paid-runtime validation.

**Architecture:** Most of L1–L3 already exists (`check-generated`, `compat-audit`, adapter/setup/apm-sync contracts, inventory/overlay/build tests). This issue ADDS: (a) `link-check` — every reference inside shipped skill/agent docs resolves to a real path/name; (b) `role-registry` — role labels referenced by upstream consumers ⊆ `roles.json` and vice versa; (c) `safety-scan` — secrets/size/exec-bit scan of the generated tree; (d) `l3-dist` — Devin plugin schema + `apm pack` observed-behavior + scratch-consumer probe (documented, network-separated); (e) unified `verify:l1|l2|l3` scripts + a verification matrix doc. Negative fixtures prove each check actually fires.

**Tech Stack:** TypeScript + tsx --test, Node fs, existing `scripts/pstack-devin` harness, `apm` CLI via `mise exec --` (documented/manual where network is needed).

## Global Constraints

- Deterministic + free: no model invocations, no paid APIs, no network in `verify:l1`/`verify:l2`; `verify:l3` splits into `l3:local` (deterministic manifest/pack-shape checks) and `l3:consumer` (network install probe — documented as manual/not-CI).
- Never claim static checks prove agent runtime quality — docs state the boundary explicitly (issue's non-goal).
- Every new checker gets a negative fixture proving it fires.
- Keep upstream bytes byte-identical; all checks are read-only against `devin-plugin/` or fixtures.
- `mise exec --` for repo-managed tools (`apm`); `pnpm --dir scripts/pstack-devin` for the harness.

## Existing Coverage (verify, don't duplicate)

- `check-generated`: pinned-commit rebuild, path-set + sha256 equality, git modes, staged diff, provenance verify — L1 core.
- `build.test.ts`: `failed build preserves a previous output dir` (atomicity), executables, staging.
- `overlay.test.ts`/`inventory.test.ts`: traversal/collision/symlink-submodule rejection, case-fold.
- `compat-audit.ts`: API vocabulary + unknowns → L2 required-API registry.
- `adapter-contract.test.ts`/`setup-pstack.test.ts`/`apm-sync.test.ts`: L2 doc/setup/.apm contracts.
- `package-structure.test.ts`: manifest/pin/file-set — partial L3.

## File Map

| Path | Responsibility |
| --- | --- |
| `scripts/pstack-devin/src/link-check.ts` | L2: resolve every reference in shipped `.md`/`.mdc` — markdown `](rel)`, backticked `skills/<n>/...`/`playbooks/`/`references/`/`scripts/` paths, `/<plugin>:<skill>`/`principle-*` skill names, `pstack:<agent>` agent names → targets exist. Unknown ref kinds → report not silently pass. |
| `scripts/pstack-devin/src/role-registry.ts` | L2: role labels consumed by upstream skills (`arena runners` etc. found near `pstack-models.mdc` refs) ⊆ `roles.json` keys; every `roles.json` key referenced by ≥1 consumer or flagged dead. |
| `scripts/pstack-devin/src/safety-scan.ts` | L1: generated tree — secret-pattern regexes (ghp_/sk-/AKIA/BEGIN.*PRIVATE KEY/JWT-ish), file-size cap (default 5 MiB, configurable), exec-bit set == provenance.executables, no symlinks/dirs other than files (already enforced — re-assert), `.devin-plugin/plugin.json` name=`pstack`+`platforms:["local"]`. |
| `scripts/pstack-devin/src/l3-dist.ts` | L3: manifest schema assertions + `apm pack --dry-run` observed-behavior check + optional `--consumer` network probe writing `docs/l3-verification.md` evidence. |
| `scripts/pstack-devin/tests/{link-check,role-registry,safety-scan,l3-dist}.test.ts` | Fixture tests incl. negative cases. |
| `scripts/pstack-devin/package.json` | `verify:l1`, `verify:l2`, `verify:l3` script wiring. |
| `packages/pstack-devin/docs/verification-matrix.md` | L1/L2/L3 table: what each command proves, what's deferred to #218 (real Devin runs), CI policy. |

### Task 1: `link-check` (L2 references)

**Interfaces:** `export interface RefFinding {file, line, ref, kind: "mdlink"|"path"|"skill"|"agent"|"url"}`, `export function checkLinks(root): {broken: RefFinding[], unresolved: RefFinding[]}`; CLI exits 1 on `broken`>0 OR `unresolved`>0 (unknown ref kinds must not silently pass — that's the "未対応機能を勝手に成功扱いしない" rule).

Kinds: `](relpath)`+backticked relative paths → fs.exists under the file's dir (anchors `#...` stripped); `/<plugin>:<skill>`+`/pstack:<name>` and bare `principle-*`/`poteto-*`/`the **name** skill` mentions → `skills/<name>/SKILL.md` exists; `pstack:<agent>` → `agents/<agent>.md`; `http(s)`/`mailto:` → kind `url` (skip — external); `~/`-rooted paths → skip (runtime paths, not tree refs). Scan all `.md` in `devin-plugin/` incl. `docs/`, `agents/`, `skills/**/playbooks`, `references`.

- [ ] Tests: fixture tree with good mdlink/skill/agent refs → 0 broken; broken mdlink → named; `pstack:nonexistent` → broken; unknown ref like `](weird://x)` → unresolved not pass; real tree → 0 broken 0 unresolved (iterate vocabulary of skip patterns until clean — every suppression must be a real, justified ref kind).

### Task 2: `role-registry` (L2)

**Interfaces:** `export function checkRoles(root, rolesJson): {unknown: string[], dead: string[]}`; CLI exit 1 on either non-empty.

Consumer scan: upstream skill `.md` files mentioning `pstack-models` — for each, extract role-label literals: known approach = match lines `Use the \`<label>\` line` / backticked quoted role names; PLUS a general check that any backticked string exactly matching `roles.json` key format is counted. Simplest robust impl: build the set of role labels REFERENCED by scanning for each `roles.json` key's literal presence in consumer files (dead-role check), and extract `\`([\w -]+)\`` tokens that appear adjacent to `pstack-models`/`line in` context then assert ⊆ keys (unknown-role check). A role a consumer names that isn't in roles.json → unknown (new upstream role = loud failure = the issue's requirement).

- [ ] Tests: roles.json fixture + consumer fixture; upstream real tree → 0 unknown 0 dead; consumer naming `new-role` → unknown; roles.json extra role → dead.

### Task 3: `safety-scan` (L1)

**Interfaces:** `export function scanSafety(root, {maxBytes=5*1024*1024}): {secrets:[], oversized:[], execMismatch:[], pluginJson:[]}`; CLI exit 1 on any non-empty.

Secret patterns (each a labeled regex): `ghp_[A-Za-z0-9]{36}`, `gho_`, `github_pat_`, `sk-[A-Za-z0-9]{20,}`, `AKIA[0-9A-Z]{16}`, `BEGIN [A-Z ]*PRIVATE KEY`, `xox[baprs]-`, `AIza[0-9A-Za-z_-]{35}`, `-----BEGIN`, `eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.` (JWT). Whitelist file `scripts/pstack-devin/src/safety-scan-allowlist.ts` with per-file justification — start EMPTY; any real-tree hit → justify loudly or fail.

- [ ] Tests: fixture w/ fake `ghp_…` token → flagged; >5MiB file → flagged; exec-bit fixture vs provenance; plugin.json name/platforms assertion; real tree → clean.

### Task 4: `l3-dist` + matrix + wiring

- `l3:local` (deterministic): `plugin.json` schema (name,version,description,author,license,keywords,platforms=`["local"]`), `devin-plugin/` layout (`.devin-plugin/`+`AGENTS.md`+`skills/`+`agents/`), APM vs Devin outputs not conflated (`.apm/` ≠ `devin-plugin/`), `apm pack --dry-run` observed behavior recorded (currently emits `.github/plugin/`+`.claude-plugin/` manifests for the `.apm` skill — assert the observed set and fail on drift, documenting actual behavior in `docs/l3-verification.md`), `apm compile --validate` recorded N/A result (skill-only package — "No instruction files found", consistent with siblings).
- `l3:consumer` (network, manual): script `apm install` a scratch consumer from `path:` + git ref, records deployment evidence to `docs/l3-verification.md` — known Windows `apm_modules` path-length caveat from #212 documented; NOT part of default verify.
- `verification-matrix.md`: L1 (build+check-generated+inventory/overlay/safety), L2 (compat-audit+adapter/setup/apm-sync/link-check/role-registry), L3-local, L3-consumer(manual), deferred-to-#218 (real Devin session runs) table + CI policy "deterministic commands only".
- `package.json` scripts: `"verify:l1": "pnpm run check-generated && tsx src/safety-scan.ts"`, `"verify:l2": "tsx src/compat-audit.ts && tsx src/link-check.ts && tsx src/role-registry.ts"`, `"verify:l3": "tsx src/l3-dist.ts"`, `"verify": "pnpm run verify:l1 && pnpm run verify:l2 && pnpm run verify:l3 && pnpm test"`.

- [ ] Tests: `l3-dist.test.ts` manifest/layout/apm-vs-devin assertions (+ `apm pack --dry-run` run via mise exec where available, skipped with notice where not); docs.

### Task 5: sweep + issue comment

- [ ] All green: test + lint:md + verify:l1 + verify:l2 + verify:l3.
- [ ] README EN/JA: verification section update (commands).
- [ ] `#216` comment with the matrix + negative-fixture evidence list.

## Self-Review

- **Spec coverage**: L1 (pin/tree/sha/count — existing + safety-scan adds secrets/size); L2 (links/roles/API-registry/setup fixtures — link-check + role-registry + existing); L3 (manifest/pack/consumer/matrix + scripts in `scripts/pstack-devin/` + mise); fixtures (every new checker has negative cases + existing fixtures enumerated); non-goals respected (no paid E2E in CI; no runtime-quality claims).
- **Consistency**: `checkLinks`/`checkRoles`/`scanSafety` signatures match CLI usage; `verify:*` names consistent; `docs/l3-verification.md` + `verification-matrix.md` distinct (evidence vs policy).
- **Placeholders**: none — ref-kind taxonomy and regex lists are concrete.
