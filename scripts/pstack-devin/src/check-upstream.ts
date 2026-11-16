import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BuildConfig } from "./config.js";
import { loadBuildConfig } from "./config.js";
import { gitRemote, manifestVersion, treeSha } from "./gittools.js";
import type { UpstreamRemote } from "./gittools.js";
import { rmrf } from "./fsx.js";

export interface UpstreamCheck {
  status: "up-to-date" | "update-available";
  /** The pinned commit (upstream.yml — single authority). */
  current: string;
  /** Remote `refs/heads/main` HEAD. */
  candidate: string;
  /** Tree sha of `<candidate>:<upstream.path>` — present once fetched. */
  candidateTree?: string;
  /** `.version` from the candidate's plugin manifest, when parseable. */
  upstreamVersion?: string;
}

/** Idempotent upstream watch: resolve `main` HEAD, and when it differs
 *  from the pin, blobless-fetch BOTH commits and compare subtree tree
 *  SHAs. A new commit whose subtree is byte-identical (docs-only churn
 *  outside our path, rebases, merges) is still "up-to-date" — the tree
 *  SHA, not the commit SHA, is the adoption boundary. The remote is
 *  injected so tests never touch a network. */
export function checkUpstream(
  cfg: BuildConfig,
  remote: UpstreamRemote,
  workDir: string,
): UpstreamCheck {
  const current = cfg.upstream.commit;
  const candidate = remote.resolveRef("refs/heads/main");
  if (candidate === current) {
    return { status: "up-to-date", current, candidate };
  }
  const candRepo = remote.fetchCommit(
    candidate,
    path.join(workDir, "candidate"),
  );
  const candidateTree = treeSha(candRepo, candidate, cfg.upstream.path);
  const curRepo = remote.fetchCommit(
    current,
    path.join(workDir, "current"),
  );
  const currentTree = treeSha(curRepo, current, cfg.upstream.path);
  if (candidateTree === currentTree) {
    return { status: "up-to-date", current, candidate, candidateTree };
  }
  const version = manifestVersion(candRepo, candidate, cfg.upstream.path);
  return {
    status: "update-available",
    current,
    candidate,
    candidateTree,
    ...(version === "" ? {} : { upstreamVersion: version }),
  };
}

/** CLI contract: "up to date" + exit 0, or the JSON coordinates the
 *  workflow/update-report consume + exit 42. `out` is injectable so tests
 *  assert output and the exit code without spawning a subprocess. */
export function checkUpstreamMain(
  cfg: BuildConfig,
  remote: UpstreamRemote,
  workDir: string,
  out: (s: string) => void,
): number {
  const res = checkUpstream(cfg, remote, workDir);
  if (res.status === "up-to-date") {
    out("up to date\n");
    return 0;
  }
  const json: Record<string, string> = {
    current: res.current,
    candidate: res.candidate,
    candidateTree: res.candidateTree ?? "",
  };
  if (res.upstreamVersion !== undefined) {
    json.upstreamVersion = res.upstreamVersion;
  }
  out(JSON.stringify(json) + "\n");
  return 42;
}

// src/ → scripts/pstack-devin/ → scripts/ → repo root.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function main(): void {
  const cfg = loadBuildConfig(repoRoot);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-upstream-"));
  try {
    const code = checkUpstreamMain(
      cfg,
      gitRemote(cfg.upstream.repoUrl),
      workDir,
      (s) => process.stdout.write(s),
    );
    process.exitCode = code;
  } finally {
    rmrf(workDir);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
