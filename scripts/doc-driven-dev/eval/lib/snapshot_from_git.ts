/**
 * Reconstruct a materialize-time tree snapshot from a repo's git history.
 * Use when a candidate run happened before the snapshotFile argument was
 * passed to materialize_env.ts: hashes every blob in the env's root commit
 * into the same {relpath: sha256} map check_env.ts consumes.
 *
 * Usage: tsx eval/lib/snapshot_from_git.ts <envDir> <snapshotFile>
 *
 * Only git-tracked files are covered. Baseline .apm/state/ content is
 * git-ignored by design, so anything under it appears as `added` in the
 * post-run diff — which is what the checkers want anyway.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [repo, out] = process.argv.slice(2);
if (!repo || !out) {
  console.error("usage: snapshot_from_git.ts <envDir> <snapshotFile>");
  process.exit(2);
}
const root = spawnSync("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim().split("\n")[0];
const files = spawnSync("git", ["ls-tree", "-r", "--name-only", root], { cwd: repo, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
const snap: Record<string, string> = {};
for (const f of files) {
  const buf = spawnSync("git", ["show", `${root}:${f}`], { cwd: repo, encoding: null, maxBuffer: 64 * 1024 * 1024 }).stdout;
  snap[f] = crypto.createHash("sha256").update(buf).digest("hex");
}
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(path.resolve(out), JSON.stringify(snap, null, 2), "utf8");
console.log(`${repo}: root=${root.slice(0, 7)} files=${files.length}`);
