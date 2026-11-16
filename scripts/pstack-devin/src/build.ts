import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { load } from "js-yaml";
import type { BuildConfig } from "./config.js";
import { sha256File, writeFileSafe, rmrf } from "./fsx.js";
import { fetchAtCommit, listTree, treeSha, catFileBlobs } from "./gittools.js";
import { scanTree } from "./inventory.js";
import type { Inventory } from "./inventory.js";
import { applyOverlay } from "./overlay.js";
import { buildProvenance, stableStringify } from "./provenance.js";

export interface BuildResult {
  outDir: string;
  fileCount: number;
  treeSha: string;
}

/** `.version` from the staged upstream manifest — root `plugin.json` first,
 *  then `.claude-plugin/plugin.json`. "" when no manifest/version is found. */
function readUpstreamVersion(staging: string): string {
  for (const rel of ["plugin.json", ".claude-plugin/plugin.json"]) {
    const p = path.join(staging, rel);
    if (!fs.existsSync(p)) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(p, "utf8")) as {
        version?: unknown;
      };
      if (typeof doc.version === "string") return doc.version;
    } catch {
      /* fall through to the next candidate */
    }
  }
  return "";
}

/** `observed.upstream_version` from the package's upstream.yml — the
 *  informational audit field the staged version is compared against. */
function readObservedUpstreamVersion(pkg: string): string | null {
  try {
    const doc = load(
      fs.readFileSync(path.join(pkg, "upstream.yml"), "utf8"),
    ) as { observed?: { upstream_version?: unknown } } | null;
    const v = doc?.observed?.upstream_version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Parse a required JSON manifest; throw naming the path on any failure. */
function readJsonManifest(p: string): Record<string, unknown> {
  let doc: unknown;
  try {
    doc = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    throw new Error(
      `required manifest ${p} is missing or invalid JSON: ` +
        `${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`required manifest ${p} must be a JSON object`);
  }
  return doc as Record<string, unknown>;
}

function countFiles(dir: string): number {
  let n = 0;
  for (const de of fs.readdirSync(dir, { withFileTypes: true })) {
    if (de.isDirectory()) {
      n += countFiles(path.join(dir, de.name));
    } else if (de.isFile()) {
      n += 1;
    }
  }
  return n;
}

/** Best-effort git staging of the generated tree: `git add -A` the
 *  devin-plugin pathspec, then `update-index --chmod=+x` each executable so
 *  the committed tree keeps exec bits even though the repo is committed
 *  from Windows (`core.fileMode=false`). Silently no-ops when `repoRoot`
 *  is not inside a git work tree (tests build into tmpdirs). */
export function stageOutput(repoRoot: string, executables: string[]): void {
  try {
    execFileSync(
      "git",
      ["-C", repoRoot, "rev-parse", "--is-inside-work-tree"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch {
    return;
  }
  const pluginRel = "packages/pstack-devin/devin-plugin";
  try {
    execFileSync(
      "git",
      ["-C", repoRoot, "add", "-A", "--", pluginRel],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch {
    return;
  }
  for (const rel of executables) {
    try {
      execFileSync(
        "git",
        ["-C", repoRoot, "update-index", "--chmod=+x", `${pluginRel}/${rel}`],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      /* best-effort per file */
    }
  }
}

/** Build the devin-plugin tree: fetch the pinned upstream commit, scan and
 *  materialize its subtree verbatim, apply the allowlist-guarded overlay,
 *  validate the generated Devin manifest, write provenance.json, then
 *  atomically rename-swap into `outDir`. Any failure before the final rename
 *  leaves a previous `outDir` untouched; a failed rename attempts rollback. */
export async function buildPlugin(
  cfg: BuildConfig,
  opts: { outDir?: string; keepPrev?: boolean } = {},
): Promise<BuildResult> {
  const pkg = cfg.packageDir;
  const outDir = opts.outDir ?? path.join(pkg, "devin-plugin");
  const buildDir = path.join(pkg, "build");
  const staging = path.join(buildDir, "staging");
  rmrf(staging);
  fs.mkdirSync(staging, { recursive: true });

  // Remove any leftover object store first — a previous crashed run leaves
  // an `origin` remote that would make `remote add` fail — then hold the
  // path outside the try so the finally removes `fetch.git` even when the
  // fetch itself throws.
  const repoDir = path.join(buildDir, "fetch.git");
  rmrf(repoDir);
  const { inv, sha } = await (async (): Promise<{
    inv: Inventory;
    sha: string;
  }> => {
    try {
      fetchAtCommit(
        cfg.upstream.repoUrl,
        cfg.upstream.commit,
        buildDir,
      );
      const inventory = scanTree(
        listTree(repoDir, cfg.upstream.commit, cfg.upstream.path),
      );
      const subtree = treeSha(
        repoDir,
        cfg.upstream.commit,
        cfg.upstream.path,
      );
      await catFileBlobs(repoDir, inventory.entries, staging);
      return { inv: inventory, sha: subtree };
    } finally {
      rmrf(repoDir);
    }
  })();

  const upstreamHash = new Map<string, string>();
  for (const e of inv.entries) {
    upstreamHash.set(e.path, sha256File(path.join(staging, e.path)));
  }

  const upstreamVersion = readUpstreamVersion(staging);
  const observed = readObservedUpstreamVersion(pkg);
  if (upstreamVersion === "") {
    console.warn("no upstream plugin.json version found in staged tree");
  } else if (observed !== null && upstreamVersion !== observed) {
    console.warn(
      `upstream plugin.json version (${upstreamVersion}) differs from ` +
        `upstream.yml observed.upstream_version (${observed})`,
    );
  }

  const ov = applyOverlay(cfg, staging, upstreamHash);

  const manifest = readJsonManifest(
    path.join(staging, ".devin-plugin", "plugin.json"),
  );
  if (manifest.name !== cfg.distribution.pluginName) {
    throw new Error(
      `.devin-plugin/plugin.json name drift: expected ` +
        `${JSON.stringify(cfg.distribution.pluginName)}, ` +
        `got ${JSON.stringify(manifest.name)}`,
    );
  }
  if (manifest.version !== cfg.distribution.version) {
    throw new Error(
      `.devin-plugin/plugin.json version drift: expected ` +
        `${JSON.stringify(cfg.distribution.version)}, ` +
        `got ${JSON.stringify(manifest.version)}`,
    );
  }

  writeFileSafe(
    path.join(staging, "provenance.json"),
    stableStringify(
      buildProvenance(
        cfg,
        {
          version: upstreamVersion,
          treeSha: sha,
          fileCount: inv.entries.length,
        },
        inv,
        ov,
      ),
    ),
  );
  const fileCount = countFiles(staging);

  const prev = path.join(buildDir, "devin-plugin.prev");
  rmrf(prev);
  const hadPrev = fs.existsSync(outDir);
  if (hadPrev) {
    fs.renameSync(outDir, prev);
  }
  try {
    fs.renameSync(staging, outDir);
  } catch (e) {
    if (hadPrev) {
      try {
        fs.renameSync(prev, outDir);
      } catch {
        /* best-effort rollback */
      }
    }
    throw e;
  }
  if (!opts.keepPrev) {
    // Best-effort cleanup — on win32 a lingering file lock can fail rmrf
    // with EPERM; that must not mask a swap that already succeeded.
    try {
      rmrf(prev);
    } catch (e) {
      console.warn(
        `warning: could not remove previous output ${prev}: ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  stageOutput(path.resolve(pkg, "..", ".."), inv.executables);
  return { outDir, fileCount, treeSha: sha };
}
