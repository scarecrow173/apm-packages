import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadBuildConfig } from "./config.js";
import { buildPlugin } from "./build.js";
import { sha256File, rmrf } from "./fsx.js";

/** Pathspec of the generated tree, relative to the repo root. Matches the
 *  hardcoded spec in `stageOutput` — check stages the real directory, never
 *  the temporary rebuild. */
const PLUGIN_REL = "packages/pstack-devin/devin-plugin";
const MAX_LISTED_DIFFS = 10;

/** Recursive rel-path list (forward slashes, sorted). Rejects non-regular
 *  entries — the generated tree must contain only files and directories. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    const dirents = fs
      .readdirSync(abs, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const de of dirents) {
      const r = rel === "" ? de.name : `${rel}/${de.name}`;
      if (de.isDirectory()) {
        walk(path.join(abs, de.name), r);
      } else if (de.isFile()) {
        out.push(r);
      } else {
        throw new Error(`generated tree entry is not a regular file: ${r}`);
      }
    }
  };
  walk(dir, "");
  return out;
}

/** Compare a fresh rebuild (`expected`) against the committed working tree
 *  (`actual`): path sets must be equal and every shared file's sha256 must
 *  match. Returns human-readable drift descriptions, sorted. */
function diffTrees(expected: string, actual: string): string[] {
  const expectedFiles = new Set(listFiles(expected));
  const actualFiles = new Set(listFiles(actual));
  const diffs: string[] = [];
  for (const p of expectedFiles) {
    if (!actualFiles.has(p)) diffs.push(`missing from devin-plugin: ${p}`);
  }
  for (const p of actualFiles) {
    if (!expectedFiles.has(p)) diffs.push(`not produced by rebuild: ${p}`);
  }
  for (const p of expectedFiles) {
    if (!actualFiles.has(p)) continue;
    if (
      sha256File(path.join(expected, p)) !==
      sha256File(path.join(actual, p))
    ) {
      diffs.push(`content differs: ${p}`);
    }
  }
  return diffs.sort();
}

/** The repo root if it is the top of a git work tree, else null. Requiring
 *  the toplevel to equal `repoRoot` (not merely "inside some work tree")
 *  keeps fixture tmpdirs from mutating a foreign index when the temp dir
 *  happens to sit inside an unrelated repository. */
function workTreeRoot(repoRoot: string): string | null {
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

/** Verify the committed devin-plugin tree equals a fresh rebuild. Rebuilds
 *  into `<pkg>/build/check-out`, compares it byte-for-byte (path set +
 *  sha256 per file) against `<pkg>/devin-plugin`, then — only when
 *  `repoRoot` is a git work-tree root — stages the generated tree, restores
 *  exec bits in the index, and requires `git diff --cached` to be clean so
 *  regenerated-but-uncommitted output is caught. The mode set of
 *  `100755` index entries must equal provenance `executables`.
 *  Non-work-tree roots skip the git gates with a warning; the content
 *  compare always applies. The temp rebuild is removed on every path. */
export async function checkGenerated(repoRoot: string): Promise<void> {
  const cfg = loadBuildConfig(repoRoot);
  const pkg = cfg.packageDir;
  const committedDir = path.join(pkg, "devin-plugin");
  const tmp = path.join(pkg, "build", "check-out");
  try {
    const res = await buildPlugin(cfg, { outDir: tmp, keepPrev: false });
    if (!fs.existsSync(committedDir)) {
      throw new Error(
        `${PLUGIN_REL} does not exist — run ` +
          "`pnpm --dir scripts/pstack-devin run build` and commit",
      );
    }
    const diffs = diffTrees(tmp, committedDir);
    if (diffs.length > 0) {
      const listed = diffs.slice(0, MAX_LISTED_DIFFS).join("\n  ");
      const more =
        diffs.length > MAX_LISTED_DIFFS
          ? `\n  ... and ${diffs.length - MAX_LISTED_DIFFS} more`
          : "";
      throw new Error(
        `generated output drift: a fresh rebuild differs from ` +
          `${PLUGIN_REL}:\n  ${listed}${more}`,
      );
    }

    const top = workTreeRoot(repoRoot);
    if (top === null) {
      console.warn(
        "warning: repo root is not a git work tree — skipping " +
          "index/commit gates (content compare only)",
      );
    } else {
      // Stage the verified working-tree bytes, then restore exec bits so
      // the index records the modes the byte-compare cannot see.
      execFileSync("git", ["-C", top, "add", "-A", "--", PLUGIN_REL]);
      const prov = JSON.parse(
        fs.readFileSync(path.join(committedDir, "provenance.json"), "utf8"),
      ) as { executables?: unknown };
      const executables = Array.isArray(prov.executables)
        ? (prov.executables as string[])
        : [];
      for (const rel of executables) {
        execFileSync(
          "git",
          ["-C", top, "update-index", "--chmod=+x", `${PLUGIN_REL}/${rel}`],
        );
      }
      // The staged tree IS the verified rebuild, so a non-empty cached
      // diff means the committed output is out of sync with the pin.
      try {
        execFileSync(
          "git",
          ["-C", top, "diff", "--cached", "--exit-code", "--", PLUGIN_REL],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
      } catch {
        throw new Error(
          "generated output out of sync — run " +
            "`pnpm --dir scripts/pstack-devin run build` and commit",
        );
      }
      const ls = execFileSync(
        "git",
        ["-C", top, "ls-files", "-s", "--", PLUGIN_REL],
        { encoding: "utf8" },
      );
      const execInIndex = new Set<string>();
      for (const line of ls.split("\n")) {
        if (line === "") continue;
        const m = /^(\d{6}) [0-9a-f]{40} \d\t(.+)$/.exec(line);
        if (m === null) {
          throw new Error(
            `malformed git ls-files -s record: ${JSON.stringify(line)}`,
          );
        }
        if (m[1] === "100755") {
          execInIndex.add(m[2].slice(PLUGIN_REL.length + 1));
        }
      }
      const expected = new Set(executables);
      const missing = [...expected].filter((p) => !execInIndex.has(p));
      const extra = [...execInIndex].filter((p) => !expected.has(p));
      if (missing.length > 0 || extra.length > 0) {
        throw new Error(
          `executable-bit drift in git index for ${PLUGIN_REL} — ` +
            `missing +x: [${missing.join(", ") || "none"}], ` +
            `unexpected +x: [${extra.join(", ") || "none"}] — run ` +
            "`pnpm --dir scripts/pstack-devin run build` and commit",
        );
      }
    }
    console.log(
      `check-generated PASS: ${res.fileCount} files, ` +
        `upstream tree ${res.treeSha}`,
    );
  } finally {
    rmrf(tmp);
  }
}
