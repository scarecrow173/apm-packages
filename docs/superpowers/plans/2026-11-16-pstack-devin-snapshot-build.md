# pstack-devin Deterministic Snapshot Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a small TypeScript builder in `scripts/pstack-devin` that fetches the pinned upstream `cursor/plugins` `harness/pstack/claude-code` tree byte-identically, applies an allowlist-guarded Devin overlay, writes `provenance.json`, and atomically produces the git-tracked `packages/pstack-devin/devin-plugin/` distribution — issue `#213`.

**Architecture:** Fetch the pinned commit with `git fetch --depth 1 --filter=blob:none` (verified against GitHub 2026-11-16), materialize only the target subtree via `cat-file --batch` directly to the output staging dir (no checkout — blobs are written verbatim, so eol/attribute interference is impossible by construction), then overlay → provenance → validate → atomic rename-swap. Tests run fully offline against plumbing-built fixture git repos.

**Tech Stack:** Node 24 + pnpm 11 + tsx + node:test (existing `scripts/pstack-devin` workspace), js-yaml (installed), `git` plumbing commands via `child_process`, `node:crypto` SHA-256. No new npm dependencies.

## Global Constraints

- All repo tool commands run via `mise exec --` (`mise exec -- pnpm --dir scripts/pstack-devin ...`). `git` is on PATH directly.
- Pin authority (`#212` contract): `upstream.yml.upstream.commit` == `apm.yml` devDep `ref` == `apm.lock.yaml` `resolved_commit` = `bf0c7cd80abdbf7fe47b634978a7d1b4071f71a7`. The builder hard-fails on divergence and names which side moved.
- Upstream files ship **byte-identical** except `overlay.yml` `allow_overwrite` entries. Non-allowlisted overwrite attempts hard-fail.
- Reject traversal (`..`, absolute, drive-prefix, backslash escape, NUL), symlinks (mode `120000`), submodules (`160000`), and case-insensitive path collisions in BOTH upstream inventory and overlay paths — with the offending path in the error.
- `devin-plugin/` output is **byte-stable** for a given upstream SHA + overlay sources: no timestamps or run-specific data in `provenance.json` or anywhere else.
- Build order: temp staging → validate → atomic swap. A failed build MUST NOT corrupt the previous `devin-plugin/`.
- `devin-plugin/` is generated and git-tracked — never hand-edited; it is not in any `.gitignore`.
- Builder temp lives in `packages/pstack-devin/build/` (already gitignored package- and root-level). `.apm-pin` or other cache files must never leak into output.
- Verified upstream facts (issue `#212`, do not re-derive): subtree `c1b4ae4da06c9815864bc7fe609cc5fb5324108c`, 546 blob files, upstream `plugin.json` version `0.15.42`, license MIT, 6 files with mode `100755`, zero symlinks/submodules, no root `AGENTS.md`, top level = `.claude-plugin/ LICENSE README.md agents/ docs/ plugin.json skills/`.
- Exec-mode bits: `packages/pstack-devin` is committed from a Windows repo where `core.fileMode=false`. `provenance.json.executables` records every `100755` path, and `build` applies `git update-index --chmod=+x` so committed trees keep exec bits on POSIX consumers.
- Devin manifest contract (docs.devin.ai plugins overview, fetched 2026-11-16): `.devin-plugin/plugin.json` wins precedence over `.claude-plugin/` and root `plugin.json`; only `name` is required; `platforms: ["local"]` scopes to CLI/Desktop; `skills` defaults to `skills/`; name must match `[a-z0-9]+([-.][a-z0-9]+)*`.
- Keep `README.md`/`README.ja.md` and `AGENTS.md`/`AGENTS.ja.md` synchronized; `docs/` maintainer records may stay English-only.
- In commit messages and docs, no auto-linking refs to repos we don't own (`cursor/plugins#N`); `#<n>` = this repo's issues.
- Do not touch root `apm.yml`/`apm.lock.yaml`/marketplace (`#217`), other packages, or `packages/pstack-devin/apm.lock.yaml` (regenerate only via `apm install`).
- Add `**/devin-plugin/**` to `packages/pstack-devin/.markdownlint-cli2.jsonc` `ignores` (generated vendored bytes; `**/`-anchored per the cwd-resolution rule proven in `#212`).

## File Map

| Path | Responsibility |
| --- | --- |
| `scripts/pstack-devin/src/config.ts` | `loadBuildConfig()` — parse `upstream.yml`/`apm.yml`/`apm.lock.yaml`/`overlay.yml`, enforce 3-way equality + `assertSafeRelPath()` |
| `scripts/pstack-devin/src/gittools.ts` | `fetchAtCommit()`, `listTree()`, `treeSha()`, `catFileBlobs()` — thin `git` plumbing wrappers |
| `scripts/pstack-devin/src/inventory.ts` | `scanTree()` — reject symlink/submodule/unknown modes, case-collision, collect executables |
| `scripts/pstack-devin/src/overlay.ts` | `applyOverlay()` — walk `overlay/`, classify addition vs overwrite, enforce allowlist, write files |
| `scripts/pstack-devin/src/provenance.ts` | `buildProvenance()` + `stableStringify()` — sorted, timestamp-free `provenance.json` |
| `scripts/pstack-devin/src/build.ts` | `buildPlugin()` — orchestrate fetch→scan→materialize→overlay→provenance→validate→atomic swap; `stageOutput()` |
| `scripts/pstack-devin/src/check.ts` | `checkGenerated()` — rebuild to temp + content compare + `git diff --exit-code` gate + exec-mode check |
| `scripts/pstack-devin/src/cli.ts` | arg dispatch `build`/`check`; resolves `repoRoot` from script location |
| `scripts/pstack-devin/src/fsx.ts` | `sha256File()`, `sha256Bytes()`, `writeFileSafe()` (win32 `\\?\` aware), `rmrf()` |
| `scripts/pstack-devin/tests/helpers.ts` | `makeFixtureRepo()` (plumbing-built git repos), `writeFixturePackage()`, `hashOf()` |
| `scripts/pstack-devin/tests/*.test.ts` | per-module tests (offline) + e2e fixture build |
| `packages/pstack-devin/overlay.yml` | overlay policy: `allow_overwrite` list |
| `packages/pstack-devin/overlay/.devin-plugin/plugin.json` | Devin-native manifest (addition) |
| `packages/pstack-devin/overlay/AGENTS.md` | plugin-root always-on rule (addition; upstream has none) |
| `packages/pstack-devin/devin-plugin/` | **generated** committed output (549 files expected: 546 + 2 additions + provenance) |
| `packages/pstack-devin/docs/build-verification.md` | real-run evidence: build log, determinism double-build, `check-generated` PASS |

## Interfaces

```ts
// fsx.ts
export function sha256Bytes(b: Buffer): string;
export function sha256File(p: string): string;               // hex, streaming
export function writeFileSafe(dest: string, data: Buffer): void; // mkdir -p + win32 \\?\ + NUL/traversal assert
export function rmrf(p: string): void;

// config.ts
export interface BuildConfig {
  packageDir: string;            // <repoRoot>/packages/pstack-devin
  upstream: { repo: string; host: string; repoUrl: string; path: string; commit: string; };
  overlay: { dir: string; allowOverwrite: string[] };
  distribution: { packageName: string; pluginName: string; version: string }; // version from apm.yml
}
export function loadBuildConfig(repoRoot: string): BuildConfig;  // throws naming divergent side
export function assertSafeRelPath(p: string, kind: string): void;

// gittools.ts
export interface TreeEntry { path: string; mode: "100644" | "100755"; type: "blob"; sha: string; }
export function fetchAtCommit(repoUrl: string, commit: string, workDir: string): string; // returns repoDir
export function listTree(repoDir: string, commit: string, subpath: string): TreeEntry[]; // ls-tree -r -z, sorted
export function treeSha(repoDir: string, commit: string, subpath: string): string;       // rev-parse commit:path
export function catFileBlobs(repoDir: string, entries: TreeEntry[], outDir: string): void; // one --batch process

// inventory.ts
export interface Inventory { entries: TreeEntry[]; executables: string[] }
export function scanTree(entries: TreeEntry[]): Inventory; // throws on bad modes/collisions

// overlay.ts
export interface OverlayResult {
  additions: { path: string; sha256: string }[];
  overwrites: { path: string; sha256: string; upstreamSha256: string }[];
}
export function applyOverlay(cfg: BuildConfig, outDir: string, upstreamHash: Map<string, string>): OverlayResult;

// provenance.ts
export function buildProvenance(cfg: BuildConfig, u: { version: string; treeSha: string; fileCount: number }, inv: Inventory, ov: OverlayResult): unknown;
export function stableStringify(v: unknown): string; // key-sorted, 2-space, LF, trailing \n

// build.ts
export interface BuildResult { outDir: string; fileCount: number; treeSha: string }
export function buildPlugin(cfg: BuildConfig, opts?: { outDir?: string; keepPrev?: boolean }): BuildResult;
export function stageOutput(repoRoot: string, executables: string[]): void; // git add + chmod

// check.ts
export function checkGenerated(repoRoot: string): void; // throws on any drift
```

---

### Task 1: Config loader + fs helpers + failing tests

**Files:**
- Create: `scripts/pstack-devin/src/fsx.ts`
- Create: `scripts/pstack-devin/src/config.ts`
- Create: `scripts/pstack-devin/tests/helpers.ts`
- Create: `scripts/pstack-devin/tests/config.test.ts`

**Interfaces:** Consumes the real `packages/pstack-devin/*.yml` files (read-only). Produces `BuildConfig`/`assertSafeRelPath`/`sha256File`/`writeFileSafe`/`rmrf` used by every later task; `writeFixturePackage()` reused by all test files.

- [ ] **Step 1: Write `tests/helpers.ts`**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export interface FixtureFile { path: string; content: string | Buffer; mode?: string }

export function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pstack-test-"));
}

export function git(repoDir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8" }).trim();
}

/** Build a git repo via pure plumbing (no checkout — Windows/exec-bit safe). */
export function makeFixtureRepo(files: FixtureFile[]): { dir: string; commit: string } {
  const dir = tmpdir();
  git(dir, "init", "-q", ".");
  git(dir, "config", "user.name", "fixture");
  git(dir, "config", "user.email", "fixture@test");
  git(dir, "config", "uploadpack.allowAnySHA1InWant", "true");
  const treeSha = writeTree(dir, files);
  const commit = git(dir, "commit-tree", treeSha, "-m", "fixture");
  git(dir, "update-ref", "refs/heads/main", commit);
  return { dir, commit };
}

/** Write nested trees bottom-up; returns the root tree SHA. Entries are
 *  sorted in git tree order: by name, directories as "name/". */
function writeTree(repoDir: string, files: FixtureFile[], prefix = ""): string {
  const filesHere: FixtureFile[] = [];
  const nested = new Map<string, FixtureFile[]>();
  for (const f of files) {
    const rest = prefix ? f.path.slice(prefix.length + 1) : f.path;
    const seg = rest.split("/")[0];
    if (rest.includes("/")) {
      const arr = nested.get(seg) ?? [];
      arr.push(f);
      nested.set(seg, arr);
    } else {
      filesHere.push(f);
    }
  }
  const entries: { sortKey: string; line: string }[] = [];
  for (const f of filesHere) {
    const sha = execFileSync(
      "git", ["-C", repoDir, "hash-object", "-w", "--stdin"],
      { input: f.content, encoding: "utf8" },
    ).trim();
    const name = f.path.split("/").pop()!;
    entries.push({ sortKey: name, line: `${f.mode ?? "100644"} blob ${sha}\t${name}` });
  }
  for (const [seg, group] of nested) {
    const sub = writeTree(repoDir, group, `${prefix}/${seg}`.replace(/^\//, ""));
    entries.push({ sortKey: `${seg}/`, line: `040000 tree ${sub}\t${seg}` });
  }
  entries.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return execFileSync(
    "git", ["-C", repoDir, "mktree"],
    { input: entries.map((e) => e.line).join("\n") + "\n", encoding: "utf8" },
  ).trim();
}
```

`writeFixturePackage(root, opts)` — the shared fixture used by config/overlay/build tests. It creates `packages/pstack-devin/` under `root` with four minimal files mirroring the real package's shape; `opts` overrides `commit`, `devDepRef`, `lockCommit`, `upstreamRepoUrl`, `overlayFiles` (a `FixtureFile[]` written under `overlay/`):

```ts
export function writeFixturePackage(
  root: string,
  opts: {
    commit?: string; devDepRef?: string; lockCommit?: string;
    upstreamRepoUrl?: string; overlayFiles?: FixtureFile[];
  },
): string {
  const commit = opts.commit ?? "f".repeat(40);
  const pkg = path.join(root, "packages", "pstack-devin");
  fs.mkdirSync(path.join(pkg, "overlay"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "upstream.yml"), [
    "upstream:",
    "  repo: cursor/plugins",
    "  host: github.com",
    "  path: harness/pstack/claude-code",
    `  commit: ${commit}`,
    "observed:",
    '  upstream_version: "0.15.42"',
  ].join("\n"));
  fs.writeFileSync(path.join(pkg, "apm.yml"), [
    "name: pstack-devin",
    "version: 0.1.0",
    "description: fixture",
    "license: MIT",
    "targets: [codex, copilot, cursor, claude, windsurf, agent-skills]",
    "devDependencies:",
    "  apm:",
    `    - git: ${opts.upstreamRepoUrl ?? "https://github.com/cursor/plugins.git"}`,
    "      path: harness/pstack/claude-code",
    `      ref: ${opts.devDepRef ?? commit}`,
    "      targets: [copilot]",
  ].join("\n"));
  fs.writeFileSync(path.join(pkg, "apm.lock.yaml"), [
    "lockfile_version: '1'",
    "dependencies:",
    `  - resolved_commit: ${opts.lockCommit ?? commit}`,
    `    resolved_ref: ${opts.lockCommit ?? commit}`,
    "    content_hash: sha256:fixture",
    "    package_type: agent_plugin",
    "    is_dev: true",
    "    target_subset: [copilot]",
    "    deployments: []",
  ].join("\n"));
  fs.writeFileSync(path.join(pkg, "overlay.yml"),
    "allow_overwrite:\n  - skills/setup-pstack/SKILL.md\n");
  for (const f of opts.overlayFiles ?? []) {
    const dest = path.join(pkg, "overlay", f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content);
  }
  return root;
}
```

> Build/buildPlugin tests also pass `upstreamRepoUrl` = the fixture repo's local path AND need `upstream.commit` to equal the fixture commit — `writeFixturePackage` accepts a single `commit` used for all three refs; pass `repo.commit` when composing e2e fixtures. If the e2e path needs `repoUrl` to differ from the derived `https://{host}/{repo}.git`, config loading must use the devDep `git:` URL as the fetch source (it is the same repo — use `devDep.git` as `repoUrl`, falling back to host/repo derivation when absent). This is the intended precedence: **`repoUrl` comes from `devDependencies.apm[0].git`, not from host/repo reconstruction.**

- [ ] **Step 2: Write `tests/config.test.ts` (failing — `src/config.ts` does not exist yet)**

Test cases (each builds a fixture package dir under `tmpdir()`; helper writes `upstream.yml`, `apm.yml`, `apm.lock.yaml`, `overlay.yml`):

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { loadBuildConfig, assertSafeRelPath } from "../src/config.js";
import { writeFixturePackage, tmpdir } from "./helpers.js";

test("loadBuildConfig parses the real package and enforces 3-way equality", () => {
  const cfg = loadBuildConfig(writeFixturePackage(tmpdir(), {}));
  assert.equal(cfg.upstream.commit.length, 40);
  assert.equal(cfg.upstream.repoUrl, "https://github.com/cursor/plugins.git");
  assert.equal(cfg.overlay.dir.endsWith("overlay"), true);
});

test("loadBuildConfig hard-fails when devDep ref diverges and names the side", () => {
  const root = writeFixturePackage(tmpdir(), { devDepRef: "0".repeat(40) });
  assert.throws(() => loadBuildConfig(root), /devDep.*ref.*does not match|mismatch/i);
});

test("loadBuildConfig hard-fails when lockfile resolved_commit diverges", () => {
  const root = writeFixturePackage(tmpdir(), { lockCommit: "1".repeat(40) });
  assert.throws(() => loadBuildConfig(root), /resolved_commit/i);
});

test("assertSafeRelPath rejects traversal and absolute forms", () => {
  for (const bad of ["../x", "a/../../b", "/abs", "C:\\win", "a\\..\\b", "a\0b", ""]) {
    assert.throws(() => assertSafeRelPath(bad, "test"), /unsafe|traversal|invalid/i, bad);
  }
  assertSafeRelPath("skills/setup-pstack/SKILL.md", "test"); // no throw
});
```

`writeFixturePackage(root, opts)` writes `packages/pstack-devin/{upstream.yml,apm.yml,apm.lock.yaml,overlay.yml}` mirroring the real files, with `opts` overriding `commit`, `devDepRef`, `lockCommit`. `loadBuildConfig(repoRoot)` resolves `<repoRoot>/packages/pstack-devin` — pass the fixture root as `repoRoot`.

- [ ] **Step 3: Run tests to verify failure**

Run: `mise exec -- pnpm --dir scripts/pstack-devin test`
Expected: existing 4 structural tests PASS; `config.test.ts` fails (module not found).

- [ ] **Step 4: Implement `src/fsx.ts` and `src/config.ts`**

`fsx.ts`: `sha256Bytes`/`sha256File` (`createHash("sha256")`), `writeFileSafe(dest, data)` (reject NUL/`..` outside parent via resolved-path prefix check; `mkdirSync(dirname, {recursive:true})`; on `win32` write via `\\\\?\\` + resolved absolute path to tolerate deep upstream paths), `rmrf` (`fs.rmSync(p, {recursive:true, force:true})`).

`config.ts`:
- `loadBuildConfig(repoRoot)` loads YAML via `js-yaml` (`load()`), requires:
  - `upstream.yml` → `upstream.{repo,host,path,commit}`; `commit` matches `/^[0-9a-f]{40}$/`; `assertSafeRelPath(upstream.path, "upstream path")`.
  - `apm.yml` → `devDependencies.apm[0]` object form: `{git, path, ref, targets}`; `ref === upstream.commit` else throw naming `apm.yml devDependencies ref`; `targets` deep-equals `["copilot"]`; `path === upstream.path`; `version` present → `distribution.version`; `distribution.packageName` = `name`, `pluginName` = `"pstack"`. **`repoUrl` = `devDependencies.apm[0].git`** (fallback `https://{host}/{repo}.git` when the field is absent) — this lets e2e tests point `git:` at a local fixture repo without touching upstream.yml semantics.
  - `apm.lock.yaml` → `dependencies[0].resolved_commit === upstream.commit` else throw naming `apm.lock.yaml resolved_commit`; `is_dev === true`; `package_type === "agent_plugin"` (warn to stderr if differs, not fail).
  - `overlay.yml` → `allow_overwrite: string[]` (may be empty); each entry passes `assertSafeRelPath` + has a `/` (file, not dir-level policy).
- `assertSafeRelPath(p, kind)`: reject empty, NUL, `/` or `\` or drive-prefix start, `..` segments, trailing `/`, non-portable chars `<>"|?*`, and any segment that is `.`/`..` after backslash→slash normalization.

- [ ] **Step 5: Run tests → green**

Run: `mise exec -- pnpm --dir scripts/pstack-devin test`
Expected: all tests pass (4 structural + ~4 config).

- [ ] **Step 6: Commit**

```bash
git add scripts/pstack-devin
git commit -m "feat(pstack-devin): add build config loader with pin-equality enforcement"
```

---

### Task 2: Git fetch + tree inventory + blob materialization

**Files:**
- Create: `scripts/pstack-devin/src/gittools.ts`
- Create: `scripts/pstack-devin/src/inventory.ts`
- Create: `scripts/pstack-devin/tests/git.test.ts`
- Create: `scripts/pstack-devin/tests/inventory.test.ts`
- Modify: `scripts/pstack-devin/tests/helpers.ts` (refine if tests expose fixture bugs)

**Interfaces:** Consumes `TreeEntry`/`assertSafeRelPath`/`writeFileSafe`/`rmrf`. Produces `fetchAtCommit`, `listTree`, `treeSha`, `catFileBlobs`, `scanTree` for Task 3.

- [ ] **Step 1: Write failing tests**

`tests/git.test.ts` — fixture repo `{dir, commit}` via `makeFixtureRepo`:

```ts
test("fetchAtCommit resolves the fixture commit in a fresh clone", () => {
  const repo = makeFixtureRepo([{ path: "a.txt", content: "hello" }]);
  const fetched = fetchAtCommit(repo.dir, repo.commit, tmpdir());
  // listTree(repoDir, commit, "") sees a.txt
});

test("catFileBlobs writes blob bytes verbatim including exec-bit files", () => {
  const repo = makeFixtureRepo([
    { path: "skills/x/run.sh", content: "#!/bin/sh\necho hi\n", mode: "100755" },
    { path: "skills/x/SKILL.md", content: "---\nname: x\n---\nbody\n" },
  ]);
  // fetch → listTree → catFileBlobs → read back outDir files: byte-equal inputs;
  // entry.mode for run.sh is "100755"
});

test("listTree surfaces non-blob modes for the scanner to reject", () => {
  // fixture containing a symlink entry (mode "120000") built via writeTree with mode override
  // listTree returns it; scanTree (next file's test) rejects
});
```

`tests/inventory.test.ts`:

```ts
test("scanTree rejects symlinks, submodules, and unknown modes with the path in the error", () => {
  assert.throws(() => scanTree([{ path: "x", mode: "120000", type: "blob", sha: "a" }]), /x/);
  assert.throws(() => scanTree([{ path: "y", mode: "160000", type: "commit", sha: "a" }]), /y/);
});

test("scanTree rejects case-insensitive path collisions", () => {
  assert.throws(
    () => scanTree([
      { path: "skills/A.md", mode: "100644", type: "blob", sha: "a" },
      { path: "skills/a.md", mode: "100644", type: "blob", sha: "b" },
    ]),
    /collision|case/i,
  );
});

test("scanTree collects executables and sorts entries", () => {
  const inv = scanTree([
    { path: "b.sh", mode: "100755", type: "blob", sha: "b" },
    { path: "a.md", mode: "100644", type: "blob", sha: "a" },
  ]);
  assert.deepEqual(inv.executables, ["b.sh"]);
  assert.deepEqual(inv.entries.map((e) => e.path), ["a.md", "b.sh"]);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `mise exec -- pnpm --dir scripts/pstack-devin test` — Expected: new tests fail (missing modules).

- [ ] **Step 3: Implement `src/gittools.ts` and `src/inventory.ts`**

`gittools.ts` — all git calls via `execFileSync("git", args)` (never shell):

```ts
export function fetchAtCommit(repoUrl: string, commit: string, workDir: string): string {
  const repoDir = path.join(workDir, "fetch.git"); // non-bare fine; objects only
  execFileSync("git", ["init", "-q", repoDir]);
  execFileSync("git", ["-C", repoDir, "remote", "add", "origin", repoUrl]);
  try {
    execFileSync("git", ["-C", repoDir, "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", commit], { stdio: ["ignore","pipe","pipe"] });
  } catch {
    execFileSync("git", ["-C", repoDir, "fetch", "-q", "--filter=blob:none", "origin"]); // reachable-SHA fallback
  }
  execFileSync("git", ["-C", repoDir, "cat-file", "-e", commit]); // hard-fail if absent
  return repoDir;
}
```

`listTree`: `git -C repoDir ls-tree -r -z <commit>:<subpath>` → parse NUL-separated `mode SP type SP sha TAB path` records; assert all `type === "blob"` (dirs are flattened by `-r`); sort by `path`. `subpath` empty → `<commit>` treeish.
`treeSha`: `git -C repoDir rev-parse -q --verify <commit>:<subpath>`.
`catFileBlobs(repoDir, entries, outDir)`: one `git -C repoDir cat-file --batch` child (`spawnSync` or `execFileSync` won't stream — use `spawn`/`execFile` with stdin/stdout piping): write `<sha>\n` per entry, read `<sha> blob <size>\n` header then exactly `size` bytes + `\n`, `writeFileSafe(join(outDir, entry.path), bytes)`. Any header mismatch or missing object → throw. (Blob lazy-backfill: in `--filter=blob:none` clones `cat-file` triggers per-object fetch — acceptable: one `--batch` session batches the protocol. If it proves slow, Task 4's real build is the measurement point.)

`inventory.ts` `scanTree(entries)`: allowed modes `100644`/`100755`; reject mode `120000` (`symlink rejected: <path>`), `160000` (`submodule rejected: <path>`), anything else (`unsupported mode <mode>: <path>`); `assertSafeRelPath` each path; lowercase-fold map for case-collision (`path collision (case-insensitive): a vs b`); return sorted entries + `executables` (sorted `100755` paths).

- [ ] **Step 4: Run tests → green** — `mise exec -- pnpm --dir scripts/pstack-devin test`

- [ ] **Step 5: Commit**

```bash
git add scripts/pstack-devin
git commit -m "feat(pstack-devin): add git fetch, tree scan, and verbatim blob materialization"
```

---

### Task 3: Overlay + provenance + build orchestrator

**Files:**
- Create: `scripts/pstack-devin/src/overlay.ts`
- Create: `scripts/pstack-devin/src/provenance.ts`
- Create: `scripts/pstack-devin/src/build.ts`
- Create: `scripts/pstack-devin/tests/overlay.test.ts`
- Create: `scripts/pstack-devin/tests/provenance.test.ts`
- Create: `scripts/pstack-devin/tests/build.test.ts`
- Create: `packages/pstack-devin/overlay.yml`

**Interfaces:** Consumes all of Tasks 1–2. Produces `buildPlugin()` consumed by `cli.ts` (Task 4) and `checkGenerated()`'s rebuild path.

`packages/pstack-devin/overlay.yml`:

```yaml
# Overlay policy for the generated devin-plugin/ tree (issue #213).
# Only paths listed here may replace an upstream file; every other overlay
# path must be an addition (a path absent upstream). #214/#215 add overlay
# content; this file is the allowlist authority.
allow_overwrite:
  - skills/setup-pstack/SKILL.md # Devin delegation entry — content lands in #215
```

- [ ] **Step 1: Write failing tests**

`overlay.test.ts` (fixture package with `overlay/`):

```ts
test("non-allowlisted overwrite of an upstream path hard-fails and names the path", () => {
  // outDir already contains upstream "skills/x/SKILL.md"; overlay has same path, not in allowlist
  assert.throws(() => applyOverlay(cfg, outDir, hashes), /allowlist|overwrite.*skills\/x\/SKILL.md/i);
});

test("allowlisted overwrite is applied and records upstreamSha256", () => { /* expect overwrites[0].path === "skills/setup-pstack/SKILL.md", upstreamSha256 = sha256 of original */ });
test("additions are written and hashed; unused allowlist entries warn only", () => { /* additions sorted; stderr/console warn captured */ });
test("overlay path traversal is rejected before any write", () => { /* overlay file named ..%2f.. — actually test assertSafeRelPath via a crafted overlay entry */ });
```

`provenance.test.ts`:

```ts
test("provenance is deterministic: sorted keys, sorted lists, no timestamps", () => {
  const p1 = stableStringify(buildProvenance(cfg, u, inv, ov));
  const p2 = stableStringify(buildProvenance(cfg, u, inv, ov));
  assert.equal(p1, p2);
  assert.ok(!/timestamp|builtAt|date|time/i.test(p1));
  assert.ok(p1.endsWith("\n"));
});

test("provenance records upstream coords, distribution, overlay diff, executables", () => {
  const p = JSON.parse(stableStringify(...));
  assert.equal(p.upstream.commit, cfg.upstream.commit);
  assert.equal(p.upstream.tree_sha, u.treeSha);
  assert.equal(p.distribution.plugin_name, "pstack");
  assert.deepEqual(p.executables, inv.executables);
});
```

`build.test.ts` — e2e via `makeFixtureRepo` + `writeFixturePackage` (with `upstream.repoUrl` pointing at the fixture dir path):

```ts
test("buildPlugin produces upstream-verbatim output + overlay + provenance", () => {
  // fixture: plugin.json ({"version":"9.9.9"}), skills/x/SKILL.md, exec script
  // result: outDir files byte-equal fixture contents; provenance.upstream.version === "9.9.9";
  // file_count === input count + additions + 1 (provenance.json)
});

test("rebuild is byte-identical (determinism)", () => {
  const a = buildPlugin(cfg, { outDir: join(tmpdir(), "a") });
  const b = buildPlugin(cfg, { outDir: join(tmpdir(), "b") });
  // recursive sha256 map of both dirs → deepEqual
});

test("failed validation preserves a previous output dir", () => {
  // pre-seed devin-plugin/ with sentinel file; sabotage overlay (non-allowlisted overwrite)
  // buildPlugin throws; sentinel still present & identical
});
```

- [ ] **Step 2: Run to verify failure** — new tests fail (missing modules).

- [ ] **Step 3: Implement `src/overlay.ts`, `src/provenance.ts`, `src/build.ts`**

`applyOverlay(cfg, outDir, upstreamHash)`: walk `cfg.overlay.dir` (recursive, relative paths, `assertSafeRelPath` each); for each overlay file: `key = relPath`; if `upstreamHash.has(key)` → require `cfg.overlay.allowOverwrite.includes(key)` else throw `overlay overwrite not allowlisted: <key>`; copy bytes → `overwrites.push({path, sha256, upstreamSha256: upstreamHash.get(key)})`. Else → copy → `additions.push({path, sha256})`. Sorted output. Unused allowlist entries → `console.warn`. Reject overlay files that would escape root; reject hidden traversal in filenames (`readdir` can't produce `..` but overlay could contain absolute-named files — `assertSafeRelPath` covers).

`buildProvenance(cfg, u, inv, ov)` returns:

```ts
{
  schema: "pstack-devin/provenance@1",
  upstream: { repo, host, path, commit, version, tree_sha, file_count },
  distribution: { name: cfg.distribution.packageName, plugin_name: "pstack", version: cfg.distribution.version },
  overlay: { additions: ov.additions, overwrites: ov.overwrites },
  executables: inv.executables,
  generator: "scripts/pstack-devin build",
}
```

`stableStringify(v)`: recursively sort object keys, `JSON.stringify(v, 2)` + `"\n"`, LF.

`buildPlugin(cfg, {outDir = <pkg>/devin-plugin, keepPrev = false})`:
1. `staging = <pkg>/build/staging`, `rmrf(staging)`, `mkdir -p`.
2. `repoDir = fetchAtCommit(cfg.upstream.repoUrl, cfg.upstream.commit, <pkg>/build)` (fetch dir `build/fetch.git`).
3. `rawEntries = listTree(repoDir, commit, upstream.path)`; `inv = scanTree(rawEntries)`; `sha = treeSha(...)`.
4. `catFileBlobs(repoDir, inv.entries, staging)`; build `upstreamHash` map (sha256File per staged file).
5. `upstreamVersion` = parse staged `plugin.json` `.version` (or `.claude-plugin/plugin.json`) — warn if ≠ `upstream.yml observed.upstream_version` (informational).
6. `ov = applyOverlay(cfg, staging, upstreamHash)`.
7. Validate: `.devin-plugin/plugin.json` exists, parses, `name === "pstack"`, `version === cfg.distribution.version` (throw naming drift); `assertSafeRelPath` on every written rel path already guaranteed; count staged files.
8. `writeFileSafe(staging/provenance.json, stableStringify(buildProvenance(...)))`.
9. Atomic swap: `prev = <pkg>/build/devin-plugin.prev`; `rmrf(prev)`; if `outDir` exists → `rename(outDir, prev)`; `rename(staging, outDir)`; `rmrf(prev)` unless `keepPrev`. Any throw before final rename leaves `outDir` untouched. On rename failure → attempt rollback `rename(prev, outDir)`.
10. `stageOutput(repoRoot, inv.executables)` — best-effort: `git -C repoRoot add -A -- <pkgRel>/devin-plugin` then `git update-index --chmod=+x <each>`; skip quietly when not in a work tree (tests pass `outDir` outside repo → stageOutput no-ops via try/catch).
11. Return `{outDir, fileCount, treeSha}`; `rmrf(build/fetch.git)`.

- [ ] **Step 4: Run tests → green** — all new tests + earlier suites.

- [ ] **Step 5: Commit**

```bash
git add scripts/pstack-devin packages/pstack-devin/overlay.yml
git commit -m "feat(pstack-devin): implement overlay, provenance, and atomic snapshot build"
```

---

### Task 4: CLI + check-generated + real build

**Files:**
- Create: `scripts/pstack-devin/src/cli.ts`
- Create: `scripts/pstack-devin/src/check.ts`
- Create: `packages/pstack-devin/overlay/.devin-plugin/plugin.json`
- Create: `packages/pstack-devin/overlay/AGENTS.md`
- Create: `packages/pstack-devin/devin-plugin/` (generated — committed)
- Modify: `scripts/pstack-devin/package.json` (scripts)
- Modify: `packages/pstack-devin/.markdownlint-cli2.jsonc` (ignores)
- Test: `scripts/pstack-devin/tests/check.test.ts`

`overlay/.devin-plugin/plugin.json` (version MUST equal `apm.yml` `0.1.0` — builder validates):

```json
{
  "name": "pstack",
  "version": "0.1.0",
  "description": "if you want to go fast, go deep first. pstack helps you write less, but higher quality code. rigorous agent workflows you can parallelize with confidence.",
  "author": { "name": "Lauren Tan" },
  "homepage": "https://github.com/scarecrow173/apm-packages/tree/main/packages/pstack-devin",
  "repository": "https://github.com/scarecrow173/apm-packages",
  "license": "MIT",
  "keywords": ["pstack", "poteto-mode", "workflow", "principles", "agent-style", "subagents", "unslop"],
  "platforms": ["local"]
}
```

`overlay/AGENTS.md` (always-on rule — deliberately minimal):

````markdown
# pstack

This plugin is a byte-pinned Devin distribution of upstream `pstack`
(`cursor/plugins` `harness/pstack/claude-code`), generated by
`scripts/pstack-devin`. The exact upstream commit is in `provenance.json`.

Upstream skills are exposed as `/pstack:<skill>`; agent profiles under
`agents/` load as `pstack:<agent>` on local platforms only.
````

- [ ] **Step 1: Write `tests/check.test.ts` (failing)**

```ts
test("checkGenerated passes on a freshly built tree and fails after tamper", () => {
  // fixture package + fixture repo + buildPlugin → devin-plugin/
  // checkGenerated(fixtureRoot) → no throw
  // append byte to devin-plugin/skills/x/SKILL.md → checkGenerated throws /drift|diff/i
});
```

(Inside fixtures, `check`'s git-diff gates must degrade gracefully when the fixture root isn't a git repo — `check` treats "not a git work tree" as skip-with-warning, content compare still applies.)

- [ ] **Step 2: Implement `src/cli.ts` + `src/check.ts`**

`cli.ts`: `repoRoot = fileURLToPath(new URL("../../../", import.meta.url))` (src/ → scripts/pstack-devin → repo root); `argv[2]` ∈ `build | check`; on error → stderr + exit 1.

`checkGenerated(repoRoot)`:
1. `cfg = loadBuildConfig(repoRoot)`; `tmp = <pkg>/build/check-out`; `buildPlugin(cfg, { outDir: tmp, keepPrev: false })`.
2. Recursive compare `tmp` vs `<pkg>/devin-plugin`: path sets equal + `sha256File` per file equal → throw listing first N diffs.
3. If inside a git work tree (`git -C repoRoot rev-parse --is-inside-work-tree`): `git add -A -- <pkg>/devin-plugin` (stage), `git update-index --chmod=+x` per new provenance executables, then `git diff --cached --exit-code -- <pkg>/devin-plugin` must be clean (`generated output out of sync — run pnpm --dir scripts/pstack-devin build and commit`), and `git ls-files -s <pkg>/devin-plugin` mode `100755` set == provenance `executables` set.
4. `rmrf(tmp)`; print PASS summary (file_count, tree_sha).

`package.json` scripts add:

```json
"build": "tsx src/cli.ts build",
"check-generated": "tsx src/cli.ts check"
```

`.markdownlint-cli2.jsonc` `ignores` becomes `["**/apm_modules/**", "**/devin-plugin/**"]` (extend the comment: generated `devin-plugin/` vendored bytes).

- [ ] **Step 3: Create overlay files, run the REAL build**

```bash
mise exec -- pnpm --dir scripts/pstack-devin run build
```

Expected: fetches `cursor/plugins@bf0c7cd8`, writes `packages/pstack-devin/devin-plugin/` = 546 upstream + `.devin-plugin/plugin.json` + `AGENTS.md` + `provenance.json` (549 files), stages them, prints summary. Verify: `git status --porcelain packages/pstack-devin/devin-plugin | wc -l` = 549 `A` entries; `provenance.json` shows `tree_sha: c1b4ae4da06c9815864bc7fe609cc5fb5324108c`, `file_count: 546`, `executables` = 6 paths.

- [ ] **Step 4: Verify determinism + check**

```bash
mise exec -- pnpm --dir scripts/pstack-devin run check-generated
```

Expected: PASS — rebuild identical, `git diff --cached` clean, exec modes match.

- [ ] **Step 5: Run full test suite + lint**

```bash
mise exec -- pnpm --dir scripts/pstack-devin test
mise exec -- pnpm --dir scripts/pstack-devin run lint:md
```

- [ ] **Step 6: Commit**

```bash
git add scripts/pstack-devin packages/pstack-devin
git commit -m "feat(pstack-devin): generate devin-plugin distribution via deterministic builder"
```

---

### Task 5: Docs sync + acceptance sweep

**Files:**
- Modify: `packages/pstack-devin/README.md`, `README.ja.md` (status: generated; structure listing now real)
- Modify: `packages/pstack-devin/AGENTS.md`, `AGENTS.ja.md` (build/regenerate commands; overlay authority; provenance rules)
- Create: `packages/pstack-devin/docs/build-verification.md`
- Modify: `packages/pstack-devin/.gitignore` (comment only if needed — `/build/` already covered)

**Interfaces:** Consumes everything. Produces #213 acceptance evidence and the documented regeneration contract #219 will automate.

- [ ] **Step 1: Write `docs/build-verification.md`**

Record verbatim: the real `pnpm --dir scripts/pstack-devin run build` output tail; `provenance.json` summary fields (`tree_sha`, `file_count: 546`, 6 executables, upstream version `0.15.42`); `check-generated` PASS output; the determinism double-build evidence (`check`'s internal rebuild IS the second build — record its compare result); file-count `find devin-plugin -type f | wc -l` = 549.

- [ ] **Step 2: Update bilingual docs**

`README.md`/`README.ja.md`: change the Devin-plugin row status from "not yet present" to generated; structure block shows `devin-plugin/` real; add regeneration pointer (`pnpm --dir scripts/pstack-devin run build`). `AGENTS.md`/`AGENTS.ja.md`: add builder rules — regenerate via build only; `overlay.yml` is the overwrite authority; provenance has no timestamps; exec bits staged via `git update-index`; keep `.markdownlint` ignores covering `devin-plugin/**`.

- [ ] **Step 3: Acceptance sweep**

```bash
mise exec -- pnpm --dir scripts/pstack-devin test
mise exec -- pnpm --dir scripts/pstack-devin run lint:md
mise exec -- pnpm --dir scripts/pstack-devin run check-generated
git status --porcelain   # only intended files
git diff --check
```

Acceptance mapping (issue `#213`): snapshot+overlay+provenance one pipeline ✅; allowlist enforcement + fixture tamper detection ✅ (tests); all 546 upstream files + assets present ✅ (file_count + real build); previous artifact survives failed build ✅ (swap test + code); byte-stability ✅ (`check-generated` rebuild compare); `build`/`check-generated` entries with `git diff --exit-code` gate ✅.

- [ ] **Step 4: Commit + issue comment**

```bash
git add packages/pstack-devin scripts/pstack-devin
git commit -m "docs(pstack-devin): record build verification and sync bilingual docs"
```

Then post `#213` comment (controller does this after final review): builder landed, generated tree committed (549 files, `tree_sha` pinned, 6 exec files mode-preserved), determinism proven by `check-generated`, next = #214/#215 overlay content.

---

## Self-Review Notes (resolved before writing)

- **Fetch path verified**: `git fetch --depth 1 origin <full-sha>` works against github.com for this repo (ran 2026-11-16). `--filter=blob:none` added for economy; fallback covers servers without it.
- **Why `cat-file --batch` not checkout**: eliminates `core.autocrlf`/attribute/eol interference as a *class* — output bytes equal blob bytes by construction, not by post-hoc verification.
- **Exec-bit preservation**: `provenance.executables` + `git update-index --chmod=+x` in `stageOutput`/`check` — required because the repo is committed on Windows (`core.fileMode=false`); without it POSIX consumers get non-executable scripts.
- **Overlay boundary**: `#213` ships the mechanism + 2 real additions (`plugin.json`, `AGENTS.md`); the declared allowlist's first real overwrite belongs to `#215`, adapter content to `#214`.
