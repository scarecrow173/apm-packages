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

/** Build a minimal `packages/pstack-devin` fixture under `root`, mirroring the
 *  real package's four config files. A single `commit` (default 40 × "f") is
 *  used for upstream.yml, the apm.yml devDep ref, and the lockfile
 *  resolved_commit so the fixture satisfies 3-way pin equality by default;
 *  pass `repo.commit` from makeFixtureRepo when composing e2e fixtures. */
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
