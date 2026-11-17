import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadBuildConfig } from "./config.js";
import { buildPlugin } from "./build.js";
import { workTreeRoot } from "./gittools.js";
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

/** Verify the committed devin-plugin tree equals a fresh rebuild. Rebuilds
 *  into `<pkg>/build/check-out`, compares it byte-for-byte (path set +
 *  sha256 per file) against `<pkg>/devin-plugin`, then — only when
 *  `repoRoot` is a git work-tree root — stages the generated tree, restores
 *  exec bits in the index, and requires `git diff --cached` to be clean so
 *  regenerated-but-uncommitted output is caught. The mode set of
 *  `100755` index entries must equal provenance `executables`.
 *  Non-work-tree roots skip the git gates with a warning; the content
 *  compare always applies. The temp rebuild is removed on every path.
 *
 *  `opts.preCommit` (or env `PSTACK_DEVIN_CHECK_PRECOMMIT=1`) runs the
 *  pipeline's pre-commit mode: the index-vs-HEAD clean gate asserts that
 *  COMMITTED output equals a fresh rebuild, which is unsatisfiable while
 *  an update's regenerated tree is legitimately uncommitted — the atomic
 *  apply-update commit has not happened yet, and differing from HEAD is
 *  the update's purpose. Everything else still applies: the rebuild
 *  byte-compare, the staging pass, and the exec-bit set equality. The
 *  env spelling exists so the nested `check-generated` inside
 *  `pnpm run verify`'s `verify:l1` can inherit it from the apply-update
 *  process (no CLI flag can reach a package.json script composition);
 *  `tsx src/cli.ts check --pre-commit` is the explicit surface. */
export async function checkGenerated(
  repoRoot: string,
  opts: { preCommit?: boolean } = {},
): Promise<void> {
  // An explicit option wins over the env var: apply-update's env reaches
  // every spawned child (verify's tests included), so a caller that means
  // the default post-commit semantics must be able to force them off.
  const preCommit =
    opts.preCommit ??
    process.env.PSTACK_DEVIN_CHECK_PRECOMMIT === "1";
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
      // Pre-commit mode (apply-update): the staged tree legitimately
      // differs from HEAD — the single atomic commit comes later — so
      // this gate is skipped while its siblings still run.
      if (!preCommit) {
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
      }
      // `-z` emits NUL-terminated records with verbatim paths — no
      // C-quoting of non-ASCII names (core.quotepath) and newline-safe.
      const ls = execFileSync(
        "git",
        ["-C", top, "ls-files", "-s", "-z", "--", PLUGIN_REL],
        { encoding: "utf8" },
      );
      const execInIndex = new Set<string>();
      for (const rec of ls.split("\0")) {
        if (rec === "") continue;
        const m = /^(\d{6}) [0-9a-f]{40} \d\t([\s\S]+)$/.exec(rec);
        if (m === null) {
          throw new Error(
            `malformed git ls-files -s record: ${JSON.stringify(rec)}`,
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
