import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { writeFileSafe } from "./fsx.js";

/** One `ls-tree -r -z` record. `mode`/`type` are kept verbatim (unvalidated)
 *  so `scanTree` — the single rejection authority — sees symlink/submodule
 *  modes and can name them in its errors. */
export interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

const MAX_BUFFER = 64 * 1024 * 1024;

const args = (repoDir: string, rest: string[]): string[] => ["-C", repoDir, ...rest];

/** Fetch exactly `commit` (blobless, depth 1) into a fresh object store at
 *  `<workDir>/fetch.git`. When the remote refuses want-by-SHA (e.g. the
 *  commit is not advertised and allowAnySHA1InWant is off), falls back to a
 *  full reachable-refs fetch, then hard-fails via `cat-file -e` if the
 *  commit is still absent. Returns the repo dir. `repoUrl` may be an
 *  https URL or a local path (test fixtures). */
export function fetchAtCommit(repoUrl: string, commit: string, workDir: string): string {
  const repoDir = path.join(workDir, "fetch.git");
  execFileSync("git", ["init", "-q", repoDir]);
  execFileSync("git", args(repoDir, ["remote", "add", "origin", repoUrl]));
  try {
    execFileSync(
      "git",
      args(repoDir, ["fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", commit]),
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch {
    execFileSync("git", args(repoDir, ["fetch", "-q", "--filter=blob:none", "origin"]));
  }
  execFileSync("git", args(repoDir, ["cat-file", "-e", commit]));
  return repoDir;
}

/** `ls-tree -r -z <commit>:<subpath>`. With `-r`, subtrees are flattened so
 *  output paths are relative to `subpath`; gitlinks are not recursed and
 *  surface as `160000 commit` records for `scanTree` to reject. An empty (or
 *  slash-only) `subpath` lists the commit's whole root tree. Records are
 *  returned verbatim, sorted by path. */
export function listTree(repoDir: string, commit: string, subpath: string): TreeEntry[] {
  const clean = subpath.replace(/^\/+|\/+$/g, "");
  const treeish = clean === "" ? commit : `${commit}:${clean}`;
  const out = execFileSync(
    "git",
    args(repoDir, ["ls-tree", "-r", "-z", treeish]),
    { maxBuffer: MAX_BUFFER },
  );
  const entries: TreeEntry[] = [];
  for (const rec of out.toString("utf8").split("\0")) {
    if (rec === "") continue;
    const tab = rec.indexOf("\t");
    const meta = rec.slice(0, tab).split(" ");
    if (tab < 0 || meta.length !== 3) {
      throw new Error(`malformed ls-tree record: ${JSON.stringify(rec)}`);
    }
    entries.push({ mode: meta[0], type: meta[1], sha: meta[2], path: rec.slice(tab + 1) });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

/** Resolve `<commit>:<subpath>` (or the commitish itself when `subpath` is
 *  empty) to an object SHA via `rev-parse -q --verify`. Throws when the
 *  path does not exist in the commit. */
export function treeSha(repoDir: string, commit: string, subpath: string): string {
  const clean = subpath.replace(/^\/+|\/+$/g, "");
  const spec = clean === "" ? commit : `${commit}:${clean}`;
  return execFileSync(
    "git",
    args(repoDir, ["rev-parse", "-q", "--verify", spec]),
    { encoding: "utf8" },
  ).trim();
}

/** Stream every entry's blob payload out of `repoDir` through ONE
 *  `git cat-file --batch` process and write each verbatim to
 *  `<outDir>/<entry.path>`. Rejects when git reports a missing object, a
 *  non-blob object, or a desynchronized stream — always naming the entry
 *  path. A single batch process keeps lazy backfill (promisor fetch in a
 *  `--filter=blob:none` clone) amortized over one protocol session. */
export function catFileBlobs(
  repoDir: string,
  entries: TreeEntry[],
  outDir: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (entries.length === 0) {
      resolve();
      return;
    }
    const child = spawn(
      "git",
      ["-C", repoDir, "cat-file", "--batch"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const stderrChunks: Buffer[] = [];
    child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
    child.stdin.on("error", () => { /* EPIPE after kill — the real error is reported via fail() */ });

    let pending: Buffer = Buffer.alloc(0);
    let idx = 0;
    /** -1 while reading a `<sha> blob <size>\n` header; otherwise the number
     *  of payload bytes expected before the trailing `\n`. */
    let want = -1;
    let done = false;

    const fail = (err: unknown): void => {
      if (done) return;
      done = true;
      child.kill();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const drain = (): void => {
      while (!done && idx < entries.length) {
        const entry = entries[idx];
        if (want < 0) {
          const nl = pending.indexOf(0x0a);
          if (nl < 0) return;
          const header = pending.toString("utf8", 0, nl);
          pending = pending.subarray(nl + 1);
          if (header === `${entry.sha} missing`) {
            fail(new Error(`cat-file --batch: object ${entry.sha} missing for ${entry.path}`));
            return;
          }
          const m = /^([0-9a-f]{40}) (\S+) (\d+)$/.exec(header);
          if (m === null || m[1] !== entry.sha) {
            fail(new Error(
              `cat-file --batch: unexpected header for ${entry.path}: ${JSON.stringify(header)}`,
            ));
            return;
          }
          if (m[2] !== "blob") {
            fail(new Error(
              `cat-file --batch: ${entry.path} resolves to ${m[2]}, expected blob`,
            ));
            return;
          }
          want = Number(m[3]);
        }
        if (pending.length < want + 1) return;
        if (pending[want] !== 0x0a) {
          fail(new Error(
            `cat-file --batch: stream desynchronized after blob for ${entry.path}`,
          ));
          return;
        }
        try {
          writeFileSafe(path.join(outDir, entry.path), pending.subarray(0, want));
        } catch (e) {
          fail(e);
          return;
        }
        pending = pending.subarray(want + 1);
        want = -1;
        idx += 1;
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      drain();
    });
    child.on("error", fail);
    child.on("close", (code) => {
      if (done) return;
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (idx !== entries.length) {
        fail(new Error(
          `cat-file --batch exited early (code ${code}) after ${idx}/${entries.length} objects` +
          (stderr === "" ? "" : `: ${stderr}`),
        ));
        return;
      }
      if (code !== 0) {
        fail(new Error(
          `cat-file --batch exited with code ${code}` +
          (stderr === "" ? "" : `: ${stderr}`),
        ));
        return;
      }
      done = true;
      resolve();
    });

    for (const e of entries) child.stdin.write(`${e.sha}\n`);
    child.stdin.end();
  });
}

/** `git cat-file blob <spec>` → blob bytes, or null when `spec` does not
 *  resolve to a blob. Lazy-backfills through the promisor in a blobless
 *  (`--filter=blob:none`) clone, so readers never materialize the tree. */
export function blobBytes(repoDir: string, spec: string): Buffer | null {
  try {
    return execFileSync(
      "git",
      args(repoDir, ["cat-file", "blob", spec]),
      // A missing path is an expected outcome (returns null) — capture
      // stderr so git's `fatal:` line does not pollute the caller's output.
      { maxBuffer: MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch {
    return null;
  }
}

/** `.version` of the plugin manifest inside `<commit>:<subpath>` — root
 *  `plugin.json` first, then `.claude-plugin/plugin.json`, the same probe
 *  order `build.ts` applies to the staged tree. "" when absent or
 *  unparseable (a missing version is a report datum, not a failure). */
export function manifestVersion(
  repoDir: string,
  commit: string,
  subpath: string,
): string {
  const clean = subpath.replace(/^\/+|\/+$/g, "");
  for (const rel of ["plugin.json", ".claude-plugin/plugin.json"]) {
    const spec = clean === "" ? `${commit}:${rel}` : `${commit}:${clean}/${rel}`;
    const buf = blobBytes(repoDir, spec);
    if (buf === null) continue;
    try {
      const doc = JSON.parse(buf.toString("utf8")) as { version?: unknown };
      if (typeof doc.version === "string" && doc.version !== "") {
        return doc.version;
      }
    } catch {
      /* try the next manifest location */
    }
  }
  return "";
}

/** The network surface the upstream-watch tools depend on — injectable so
 *  tests substitute fixture remotes (or recording stubs) instead of
 *  touching a real host. */
export interface UpstreamRemote {
  /** Resolve a remote ref (e.g. `refs/heads/main`) to a 40-hex commit sha
   *  via `git ls-remote`. Throws when the ref is not advertised. */
  resolveRef(ref: string): string;
  /** Blobless-fetch `commit` into a fresh object store at
   *  `<workDir>/fetch.git`; returns the repo dir. */
  fetchCommit(commit: string, workDir: string): string;
}

/** The production remote: `git ls-remote` for refs and the existing
 *  blobless `fetchAtCommit` for objects. `repoUrl` may be an https URL or
 *  a local path (test fixtures). */
export function gitRemote(repoUrl: string): UpstreamRemote {
  return {
    resolveRef(ref: string): string {
      const out = execFileSync(
        "git",
        ["ls-remote", repoUrl, ref],
        { encoding: "utf8", maxBuffer: MAX_BUFFER },
      );
      // Match the exact ref field — ls-remote patterns can also tail-match
      // longer ref names we did not ask for.
      const line = out.split("\n").find((l) => l.endsWith(`\t${ref}`));
      if (line === undefined) {
        throw new Error(`ls-remote: ${ref} not advertised by ${repoUrl}`);
      }
      const sha = line.slice(0, line.indexOf("\t"));
      if (!/^[0-9a-f]{40}$/.test(sha)) {
        throw new Error(
          `ls-remote: malformed record for ${ref}: ${JSON.stringify(line)}`,
        );
      }
      return sha;
    },
    fetchCommit(commit: string, workDir: string): string {
      return fetchAtCommit(repoUrl, commit, workDir);
    },
  };
}

/** The repo root if it is the top of a git work tree, else null. Requiring
 *  the toplevel to equal `repoRoot` (not merely "inside some work tree")
 *  keeps fixture tmpdirs from mutating a foreign index when the temp dir
 *  happens to sit inside an unrelated repository. */
export function workTreeRoot(repoRoot: string): string | null {
  try {
    const inside = execFileSync(
      "git",
      ["-C", repoRoot, "rev-parse", "--is-inside-work-tree"],
      { encoding: "utf8" },
    ).trim();
    if (inside !== "true") return null;
    const top = execFileSync(
      "git",
      ["-C", repoRoot, "rev-parse", "--show-toplevel"],
      { encoding: "utf8" },
    ).trim();
    // Textual compare on purpose — no realpath: on win32 a subst/mapped
    // drive would resolve to a different spelling than git's cwd-derived
    // toplevel and silently disable the gates in the real repo.
    const norm = (p: string): string => {
      const n = path.resolve(p);
      return process.platform === "win32" ? n.toLowerCase() : n;
    };
    return norm(top) === norm(repoRoot) ? top : null;
  } catch {
    return null;
  }
}
